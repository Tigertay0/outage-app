import "server-only";

/**
 * Fixed-window rate limiting, in memory.
 *
 * PRD section 6.3 asks for rate limiting to prevent abuse, and section 9 names
 * spam reports as the top data-quality risk. This is the cheap first line: it
 * holds within a single server process, which is enough for development and a
 * single-instance deploy. Behind multiple instances, swap the store for Redis
 * or Supabase — the call sites do not change.
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

export const LIMITS = {
  /** Reports are the expensive, abusable action. */
  createOutage: { limit: 5, windowMs: 60 * 60 * 1000 },
  confirm: { limit: 60, windowMs: 60 * 60 * 1000 },
  comment: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** Nominatim's usage policy is one request per second, per source. */
  geocode: { limit: 30, windowMs: 60 * 1000 },
} as const;
