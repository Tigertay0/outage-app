import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured } from "@/lib/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Who is acting on a request.
 *
 * The PRD wants guest browsing plus accounts (sections 4.3, 7). Gating writes
 * behind sign-up would starve the crowdsourcing the app depends on, so a
 * visitor with no account still gets a durable identity — enough to enforce
 * one confirmation per person and to attribute comments.
 *
 * How that identity is minted depends on the backend:
 *
 *   - Supabase: an anonymous sign-in, which creates a real `auth.users` row.
 *     This matters because `outages.reported_by` is a UUID with a foreign key
 *     to that table, and every RLS policy tests `auth.role() = 'authenticated'`
 *     and `auth.uid()`. A synthetic id satisfies none of those. Anonymous users
 *     can later be upgraded to a permanent account without losing their
 *     history.
 *   - Local store: a random id in an httpOnly cookie, since there is no
 *     database to be consistent with.
 *
 * Anonymous sign-in must be enabled for the project (Authentication →
 * Sign In / Providers → Anonymous sign-ins). If it is off, this falls back to
 * the cookie identity so reads keep working, and `canWrite` reports false so
 * the caller can say something useful instead of surfacing a 500.
 */

export const GUEST_COOKIE = "outage_guest_id";
const GUEST_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface Identity {
  id: string;
  /** True for a real Supabase user, anonymous or not. */
  isAuthenticated: boolean;
  /** True when this identity is an anonymous Supabase user. */
  isAnonymous: boolean;
  email: string | null;
  /**
   * Whether writes will pass the database's constraints. False means the
   * identity is a cookie id that `auth.users` has never heard of.
   */
  canWrite: boolean;
}

function guestIdentity(id: string): Identity {
  return {
    id,
    isAuthenticated: false,
    isAnonymous: false,
    email: null,
    // A cookie id is not a UUID and has no auth.users row, so every insert
    // referencing it fails on the foreign key and on RLS.
    canWrite: !isSupabaseConfigured(),
  };
}

/** Read the guest cookie, minting and persisting one if absent. */
async function readOrCreateGuestCookie(): Promise<string> {
  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;
  if (existing) return existing;

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
    // Called from a Server Component, which cannot set cookies. The value is
    // still usable for this request; /api/session persists it properly.
  }

  return fresh;
}

/**
 * Resolve the caller.
 *
 * `allowSignIn` must only be true in Route Handlers and Server Actions.
 * Creating a session writes cookies, and a Server Component cannot — so
 * calling it there would mint a fresh anonymous user on every single render
 * instead of reusing one.
 */
export async function getIdentity(
  { allowSignIn = false }: { allowSignIn?: boolean } = {},
): Promise<Identity> {
  if (!isSupabaseConfigured()) {
    return guestIdentity(await readOrCreateGuestCookie());
  }

  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      return {
        id: user.id,
        isAuthenticated: true,
        isAnonymous: user.is_anonymous ?? false,
        email: user.email ?? null,
        canWrite: true,
      };
    }

    if (allowSignIn) {
      const { data, error } = await supabase.auth.signInAnonymously();

      if (!error && data.user) {
        return {
          id: data.user.id,
          isAuthenticated: true,
          isAnonymous: true,
          email: null,
          canWrite: true,
        };
      }

      if (error) {
        // Two project settings block this, and they report differently:
        //   "Anonymous sign-ins are disabled"
        //     -> Authentication / Sign In / Providers
        //   "captcha protection: request disallowed"
        //     -> Authentication / Attack Protection. A server-side sign-in has
        //        no browser to solve a challenge, so CAPTCHA and anonymous
        //        guests are mutually exclusive with this design.
        console.error(
          "[identity] anonymous sign-in failed:",
          error.message,
          "— check the Authentication settings for this Supabase project.",
        );
      }
    }
  } catch (error) {
    // A misconfigured project should degrade to read-only, not 500 the page.
    console.error("[identity] Supabase auth unavailable:", error);
  }

  return guestIdentity(await readOrCreateGuestCookie());
}

/**
 * Identity for a request that is about to write. Creates a session if there
 * is none, so this is only valid inside a Route Handler or Server Action.
 */
export async function getWritableIdentity(): Promise<Identity> {
  return getIdentity({ allowSignIn: true });
}
