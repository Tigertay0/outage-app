import "server-only";
import webpush from "web-push";
import { haversineMeters } from "./geo";
import type { NotificationSettings, Outage, Severity } from "./types";
import { MILES_TO_METERS, SEVERITY_META } from "./constants";

/**
 * Web Push (PRD section 4.7).
 *
 * Push is optional: without VAPID keys the subscribe endpoint reports that it
 * is unavailable and the UI hides the toggle, rather than failing at runtime.
 * Generate a key pair with:
 *
 *   npx web-push generate-vapid-keys
 */

export interface StoredSubscription {
  identity: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  settings: NotificationSettings;
  center: { latitude: number; longitude: number } | null;
}

const globalSubs = globalThis as unknown as {
  __pushSubs?: Map<string, StoredSubscription>;
};

function subscriptions(): Map<string, StoredSubscription> {
  if (!globalSubs.__pushSubs) globalSubs.__pushSubs = new Map();
  return globalSubs.__pushSubs;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_PUBLIC_KEY !== "YOUR_VAPID_PUBLIC_KEY",
  );
}

export function publicVapidKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

let configured = false;

function ensureConfigured() {
  if (configured || !pushConfigured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:alerts@outage-tracker.app",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export function saveSubscription(sub: StoredSubscription): void {
  subscriptions().set(sub.endpoint, sub);
}

export function removeSubscription(endpoint: string): void {
  subscriptions().delete(endpoint);
}

/** Quiet hours are stored as "HH:MM" in the viewer's local time. */
function inQuietHours(settings: NotificationSettings, now = new Date()): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (!start || !end) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  const from = toMinutes(start);
  const to = toMinutes(end);

  // A window like 22:00–07:00 wraps past midnight.
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_META[severity].rank >= SEVERITY_META[threshold].rank;
}

/** Which subscribers should hear about this outage. */
export function matchingSubscriptions(outage: Outage): StoredSubscription[] {
  return [...subscriptions().values()].filter((sub) => {
    if (!sub.settings.enabled) return false;
    if (!meetsThreshold(outage.severity, sub.settings.severityThreshold)) {
      return false;
    }
    if (inQuietHours(sub.settings)) return false;
    if (!sub.center) return false;

    const distance = haversineMeters(sub.center, outage);
    return distance <= sub.settings.radiusMiles * MILES_TO_METERS;
  });
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export async function sendPush(
  sub: StoredSubscription,
  payload: PushPayload,
): Promise<boolean> {
  if (!pushConfigured()) return false;
  ensureConfigured();

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
    );
    return true;
  } catch (error) {
    // 404/410 mean the browser dropped the subscription; stop retrying it.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) removeSubscription(sub.endpoint);
    else console.error("[push] send failed", error);
    return false;
  }
}

/** Fan out a new-outage alert. Best effort; never blocks the report itself. */
export async function notifyNewOutage(outage: Outage): Promise<number> {
  if (!pushConfigured()) return 0;

  const targets = matchingSubscriptions(outage);
  const where = outage.city ? ` in ${outage.city}` : "";
  const what = outage.providerName ?? outage.serviceType;

  const results = await Promise.all(
    targets.map((sub) =>
      sendPush(sub, {
        title: `${SEVERITY_META[outage.severity].label}: ${what}`,
        body: `Reported${where}. Tap to see details.`,
        url: `/?outage=${outage.id}`,
        tag: `outage-${outage.id}`,
      }),
    ),
  );

  return results.filter(Boolean).length;
}
