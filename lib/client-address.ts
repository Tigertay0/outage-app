import "server-only";
import { createHash } from "node:crypto";

/**
 * Identify the client for rate-limiting purposes.
 *
 * The address is hashed before it is used as a bucket key and never stored in
 * the clear: the app only needs to know whether two requests came from the same
 * place, not where that is. PRD section 6.3 asks for minimal personal data.
 */

/**
 * `x-forwarded-for` is a client-supplied header everywhere except behind a
 * proxy that overwrites it. Vercel does overwrite it, and puts the real client
 * first. Anywhere else, treat it as a hint rather than a fact — which is why
 * this is a throttle layered on top of the per-identity limit, not the only
 * control.
 */
export function clientAddress(request: Request): string | null {
  const headers = request.headers;

  // Vercel's own header is not client-settable, so prefer it where present.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return headers.get("x-real-ip");
}

/**
 * Stable, non-reversible bucket key for an address.
 *
 * Salted so the hashes are not a rainbow-table lookup away from the addresses
 * that produced them. Without RATE_LIMIT_SALT the hash is still one-way, just
 * more guessable for a known address — acceptable, since nothing here is
 * retained beyond the rate-limit window.
 */
export function addressBucket(prefix: string, request: Request): string | null {
  const address = clientAddress(request);
  if (!address) return null;

  const salt = process.env.RATE_LIMIT_SALT ?? "outage-tracker";
  const digest = createHash("sha256")
    .update(`${salt}:${address}`)
    .digest("hex")
    .slice(0, 32);

  return `${prefix}:${digest}`;
}
