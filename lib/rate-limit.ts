import "server-only";
import { addressBucket } from "./client-address";
import { isSupabaseConfigured } from "./data";
import { createServerSupabaseClient, createServiceRoleClient } from "./supabase/server";

/** Whether the server can act for itself rather than as the calling user. */
function serviceRoleAvailable(): boolean {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().length > 0;
}

/**
 * Fixed-window rate limiting.
 *
 * PRD section 6.3 asks for rate limiting to prevent abuse, and section 9 names
 * spam reports as the top data-quality risk.
 *
 * Two implementations behind one call:
 *
 *   - `rateLimit` counts in process memory. On serverless that means each warm
 *     instance enforces its own copy of the limit, so treat it as a courtesy
 *     throttle. It needs no database, so it is what the local backend uses.
 *   - `consumeRateLimit` counts in Postgres (migration 005), shared across
 *     every instance. This is the one that actually constrains a determined
 *     caller, and it is used wherever Supabase is configured.
 *
 * The distinction matters because anonymous sign-in requires CAPTCHA to be off,
 * so a bot can mint a fresh identity per request; a per-address limit that only
 * holds within one instance would not slow that down.
 */

interface Window {
  count: number;
  resetAt: number;
}

const globalBuckets = globalThis as unknown as {
  __rateBuckets?: Map<string, Window>;
};

function buckets(): Map<string, Window> {
  if (!globalBuckets.__rateBuckets) {
    globalBuckets.__rateBuckets = new Map();
  }
  return globalBuckets.__rateBuckets;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const store = buckets();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: limit - existing.count, retryAfter };
}

/** Opportunistic cleanup so the map does not grow without bound. */
export function pruneRateLimits(): void {
  const now = Date.now();
  for (const [key, window] of buckets()) {
    if (window.resetAt <= now) buckets().delete(key);
  }
}

/**
 * Durable limit, shared across instances. Falls back to the in-memory counter
 * when there is no database, and — deliberately — when the database call fails:
 * a rate limiter that is down should not take reporting down with it.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!isSupabaseConfigured()) {
    return rateLimit(key, limit, windowMs);
  }

  try {
    // Service role, not the caller's session. consume_rate_limit takes the
    // bucket key as an argument, so a client able to call it directly could
    // spend someone else's quota — name their bucket, burn their allowance,
    // and they can no longer report an outage. Counting is the server's job,
    // and migration 010 revokes the function from anon and authenticated to
    // match. Without a service-role key the catch below falls back to the
    // in-process limiter, which is the same degradation as a database outage.
    const supabase = serviceRoleAvailable()
      ? createServiceRoleClient()
      : await createServerSupabaseClient();

    const { data, error } = await supabase.rpc("consume_rate_limit", {
      bucket_key: key,
      max_hits: limit,
      window_seconds: Math.ceil(windowMs / 1000),
    });

    if (error) throw new Error(error.message);

    const row = (data as Array<{
      allowed: boolean;
      remaining: number;
      retry_after: number;
    }>)[0];

    if (!row) throw new Error("consume_rate_limit returned no row");

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfter: row.retry_after,
    };
  } catch (cause) {
    console.error("[rate-limit] durable check failed, using in-memory:", cause);
    return rateLimit(key, limit, windowMs);
  }
}

/**
 * Per-address layer over a per-identity limit. Anonymous identities are free to
 * mint, so the address is what actually bounds a script. Returns the blocking
 * result, or null when the request may proceed (including when the address is
 * unknown).
 */
export async function consumeAddressLimit(
  prefix: string,
  request: Request,
  config: { limit: number; windowMs: number },
): Promise<RateLimitResult | null> {
  const bucket = addressBucket(prefix, request);
  if (!bucket) return null;

  const result = await consumeRateLimit(bucket, config.limit, config.windowMs);
  return result.allowed ? null : result;
}

export const LIMITS = {
  /** Reports are the expensive, abusable action. */
  createOutage: { limit: 5, windowMs: 60 * 60 * 1000 },
  /**
   * Per client address, layered over the per-identity limit above. Higher,
   * because one address can legitimately be a household, an office or a whole
   * carrier NAT — the point is to stop a flood, not to police a building.
   */
  createOutageByAddress: { limit: 20, windowMs: 60 * 60 * 1000 },
  commentByAddress: { limit: 60, windowMs: 60 * 60 * 1000 },
  /**
   * Each subscription is a recipient on every nearby report, so unbounded
   * creation multiplies outbound sends. A browser legitimately re-posts on
   * every settings save, hence room for a few per hour.
   */
  pushSubscribe: { limit: 12, windowMs: 60 * 60 * 1000 },
  pushSubscribeByAddress: { limit: 30, windowMs: 60 * 60 * 1000 },
  /** Shared by confirm and unconfirm, so toggling cannot sidestep the cap. */
  confirm: { limit: 60, windowMs: 60 * 60 * 1000 },
  confirmByAddress: { limit: 150, windowMs: 60 * 60 * 1000 },
  /**
   * Two votes from distinct identities resolve an outage, and anonymous
   * identities are free, so the address layer is what protects real outages
   * from being closed by one script.
   */
  resolve: { limit: 20, windowMs: 60 * 60 * 1000 },
  resolveByAddress: { limit: 30, windowMs: 60 * 60 * 1000 },
  comment: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** Nominatim's usage policy is one request per second, per source. */
  geocode: { limit: 30, windowMs: 60 * 1000 },
} as const;
