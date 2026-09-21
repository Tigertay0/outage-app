import "server-only";
import webpush from "web-push";
import { MILES_TO_METERS, SEVERITY_META } from "./constants";
import { isSupabaseConfigured } from "./data";
import { haversineMeters } from "./geo";
import { createServiceRoleClient } from "./supabase/server";
import type { Json } from "./supabase/database.types";
import type { NotificationSettings, Outage, Severity } from "./types";
import { isPushServiceEndpoint } from "./validation";

/**
 * Web Push (PRD section 4.7).
 *
 * Push is optional: without VAPID keys the subscribe endpoint reports that it
 * is unavailable and the UI hides the toggle, rather than failing at runtime.
 * Generate a key pair with:
 *
 *   npx web-push generate-vapid-keys
 *
 * Where subscriptions live
 *
 * With Supabase configured they are rows in `push_subscriptions` (migration
 * 007), matched to an outage by distance in SQL. They used to live in a Map on
 * the server process, which on serverless meant every cold start forgot every
 * subscriber and each instance knew only the browsers that had registered
 * through it — alerts were close to never delivered. The Map remains only for
 * the local no-database backend, where one process is all there is.
 *
 * Writes use the service-role client. Reads for fan-out must see every
 * subscriber, which RLS forbids to a user session by design; and an endpoint
 * that moves between users when someone signs in cannot be re-owned through a
 * per-user RLS update. Identity is still established from the session before
 * anything is written.
 */

export interface SubscriptionInput {
  identity: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  settings: NotificationSettings;
  center: { latitude: number; longitude: number } | null;
  /** IANA zone, e.g. "America/Chicago". Quiet hours are local wall-clock. */
  timezone: string | null;
}

interface Target {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  settings: NotificationSettings;
  timezone: string | null;
}

export function pushConfigured(): boolean {
  const vapid = Boolean(
    process.env.VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim() &&
      process.env.VAPID_PUBLIC_KEY !== "YOUR_VAPID_PUBLIC_KEY",
  );
  if (!vapid) return false;

  // Against Supabase the subscriptions are stored and read with the service
  // role. Without it the toggle would accept a subscription it can never use.
  return !isSupabaseConfigured() || usesDatabase();
}

function usesDatabase(): boolean {
  return (
    isSupabaseConfigured() &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().length > 0
  );
}

export function publicVapidKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

let vapidSet = false;

function ensureVapid() {
  if (vapidSet) return;

  webpush.setVapidDetails(
    // Push services use this to contact the operator. The old default was an
    // address at a domain this project does not own.
    process.env.VAPID_SUBJECT ?? "https://github.com/Tigertay0/outage-app",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidSet = true;
}

// ---------------------------------------------------------------------------
// Local backend: one process, so a Map is the whole truth.
// ---------------------------------------------------------------------------

const globalSubs = globalThis as unknown as {
  __pushSubs?: Map<string, SubscriptionInput>;
};

function memory(): Map<string, SubscriptionInput> {
  if (!globalSubs.__pushSubs) globalSubs.__pushSubs = new Map();
  return globalSubs.__pushSubs;
}

function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_META[severity].rank >= SEVERITY_META[threshold].rank;
}

function memoryTargets(outage: Outage): Target[] {
  return [...memory().values()]
    .filter((sub) => {
      if (!sub.settings.enabled || !sub.center) return false;
      if (sub.identity === outage.reportedBy) return false;
      if (!meetsThreshold(outage.severity, sub.settings.severityThreshold)) {
        return false;
      }
      const distance = haversineMeters(sub.center, outage);
      return distance <= sub.settings.radiusMiles * MILES_TO_METERS;
    })
    .map(({ endpoint, keys, settings, timezone }) => ({
      endpoint,
      keys,
      settings,
      timezone,
    }));
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Register or update this browser's subscription. Idempotent per endpoint. */
export async function saveSubscription(sub: SubscriptionInput): Promise<void> {
  if (!usesDatabase()) {
    memory().set(sub.endpoint, sub);
    return;
  }

  const { error } = await createServiceRoleClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: sub.identity,
        endpoint: sub.endpoint,
        keys: sub.keys as unknown as Json,
        settings: sub.settings as unknown as Json,
        center: sub.center
          ? `SRID=4326;POINT(${sub.center.longitude} ${sub.center.latitude})`
          : null,
        timezone: sub.timezone,
      },
      // One row per browser; a sign-in re-owns it rather than duplicating it.
      { onConflict: "endpoint" },
    );

  if (error) throw new Error(`saveSubscription: ${error.message}`);
}

/**
 * Remove a subscription by endpoint.
 *
 * Endpoints are unguessable capability URLs issued to one browser, so holding
 * one is proof of being that browser — no owner check is needed, and requiring
 * one would strand the row whenever the owning identity had changed.
 */
export async function removeSubscription(endpoint: string): Promise<void> {
  if (!usesDatabase()) {
    memory().delete(endpoint);
    return;
  }

  const { error } = await createServiceRoleClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) throw new Error(`removeSubscription: ${error.message}`);
}

async function targetsFor(outage: Outage): Promise<Target[]> {
  if (!usesDatabase()) return memoryTargets(outage);

  const { data, error } = await createServiceRoleClient().rpc("push_targets", {
    outage_lat: outage.latitude,
    outage_lng: outage.longitude,
    outage_severity: outage.severity,
    exclude_user: outage.reportedBy ?? undefined,
  });

  if (error) throw new Error(`push_targets: ${error.message}`);

  return (data ?? []).map((row) => ({
    endpoint: row.endpoint,
    keys: row.keys as unknown as Target["keys"],
    settings: row.settings as unknown as NotificationSettings,
    timezone: row.timezone,
  }));
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

/** Current wall-clock minutes past midnight in a given IANA zone. */
function minutesNowIn(timezone: string | null, now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone ?? "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);

    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    // An unrecognised zone string: fall back to UTC rather than dropping the
    // alert entirely.
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Quiet hours are "HH:MM" in the subscriber's own time zone.
 *
 * This used to compare against the server clock, which on Vercel is UTC — so
 * someone in Chicago with 22:00–07:00 quiet hours was silenced from 5pm to 2am
 * local time and woken up overnight.
 */
export function inQuietHours(
  settings: NotificationSettings,
  timezone: string | null,
  now = new Date(),
): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (!start || !end) return false;

  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  const minutes = minutesNowIn(timezone, now);
  const from = toMinutes(start);
  const to = toMinutes(end);

  // A window like 22:00–07:00 wraps past midnight.
  return from <= to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function send(target: Target, payload: PushPayload): Promise<boolean> {
  // Checked again here, not only at the edge: a row written before endpoint
  // validation existed, or by anything other than the subscribe route, must
  // still never turn a report into a request to an arbitrary host.
  if (!isPushServiceEndpoint(target.endpoint)) {
    console.error("[push] refusing non-push-service endpoint; removing it");
    await removeSubscription(target.endpoint).catch(() => undefined);
    return false;
  }

  ensureVapid();

  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(payload),
    );
    return true;
  } catch (error) {
    // 404/410 mean the browser dropped the subscription; stop sending to it.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await removeSubscription(target.endpoint).catch((cause) =>
        console.error("[push] could not prune dead subscription", cause),
      );
    } else {
      // Not the error object: web-push attaches the endpoint to it, and an
      // endpoint is the whole credential for a subscription (see saveSubscription).
      console.error(
        "[push] send failed",
        status ?? "no status",
        error instanceof Error ? error.message.slice(0, 200) : "unknown error",
      );
    }
    return false;
  }
}

/**
 * Fan out a new-outage alert.
 *
 * Must run inside `after()`, not as a floating promise: Vercel freezes the
 * function once the response is sent, and a `void` promise started before
 * that is simply abandoned partway through the recipient list.
 */
export async function notifyNewOutage(outage: Outage): Promise<number> {
  if (!pushConfigured()) return 0;

  const targets = (await targetsFor(outage)).filter(
    (target) => !inQuietHours(target.settings, target.timezone),
  );
  if (targets.length === 0) return 0;

  const where = outage.city ? ` in ${outage.city}` : "";
  const what = outage.providerName ?? outage.serviceType;

  const results = await Promise.all(
    targets.map((target) =>
      send(target, {
        title: `${SEVERITY_META[outage.severity].label}: ${what}`,
        body: `Reported${where}. Tap to see details.`,
        url: `/?outage=${outage.id}`,
        tag: `outage-${outage.id}`,
      }),
    ),
  );

  return results.filter(Boolean).length;
}
