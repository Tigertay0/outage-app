import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured } from "@/lib/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Who is acting on a request.
 *
 * The PRD wants guest browsing plus accounts (sections 4.3, 7). Rather than
 * gating writes behind sign-up — which would kill the crowdsourcing the whole
 * app depends on — a guest gets a random id in an httpOnly cookie. That is
 * enough to enforce one-confirmation-per-person and to attribute comments,
 * while signing in upgrades the same actions to a durable account.
 */

export const GUEST_COOKIE = "outage_guest_id";
const GUEST_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface Identity {
  id: string;
  /** True when backed by a real Supabase account rather than a guest cookie. */
  isAuthenticated: boolean;
  email: string | null;
}

/**
 * Resolve the caller. Never returns null: an unrecognised visitor is issued a
 * guest id. Note that cookie writes are only possible in Route Handlers and
 * Server Actions, so a guest id minted during a Server Component render is
 * returned but not persisted — `ensureGuestCookie` handles that case.
 */
export async function getIdentity(): Promise<Identity> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        return { id: user.id, isAuthenticated: true, email: user.email ?? null };
      }
    } catch {
      // Misconfigured Supabase should degrade to guest mode, not 500 the page.
    }
  }

  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;

  if (existing) {
    return { id: existing, isAuthenticated: false, email: null };
  }

  const fresh = `guest_${randomUUID()}`;
  try {
    store.set(GUEST_COOKIE, fresh, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_MAX_AGE_SECONDS,
    });
  } catch {
    // Called from a Server Component — the value is still usable for this
    // request, it just will not stick until a route handler sets it.
  }

  return { id: fresh, isAuthenticated: false, email: null };
}

/**
 * Writes that need a durable identity. Guests are allowed, because report and
 * confirm are the product's core loop, but the caller can require an account
 * by checking `isAuthenticated`.
 */
export async function requireIdentity(): Promise<Identity> {
  return getIdentity();
}
