"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Account actions (PRD section 4.3).
 *
 * The important case is the first one: a visitor who has already been using the
 * app is an *anonymous* Supabase user, not a session-less browser. Their
 * reports, confirmations and comments are all foreign-keyed to that user id. So
 * creating an account must attach credentials to the existing user rather than
 * making a new one — `updateUser` keeps the id, `signUp` would not, and would
 * silently orphan everything they had contributed.
 *
 * Signing in to a *different*, existing account is a different act and does
 * discard the anonymous session. That is correct — those contributions belong
 * to the guest identity, not to the account being opened — but it is worth
 * saying out loud in the UI, which `AuthSheet` does.
 */

export interface AuthOutcome {
  /** False when the account exists but the address still needs confirming. */
  signedIn: boolean;
  email: string | null;
  /** True when this upgraded an existing guest rather than creating a user. */
  upgraded: boolean;
}

/**
 * Treat Supabase's empty-string fields as absent.
 *
 * `user.email` is `""` — not null — while a confirmation is pending, so `??`
 * passes it straight through and the caller ends up with a falsy "address"
 * it then fails to display.
 */
function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Accounts are unavailable on this deployment.");
  }
  return supabase;
}

/** Every cached query is identity-scoped, so none of it survives a switch. */
function useResetIdentity() {
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries();
  };
}

/**
 * Create an account.
 *
 * Upgrades the current anonymous user in place when there is one. Supabase
 * returns a session immediately if the project auto-confirms addresses, and
 * withholds it pending a confirmation email otherwise — the caller is told
 * which happened rather than this guessing.
 */
export function useCreateAccount() {
  const reset = useResetIdentity();

  return useMutation<AuthOutcome, Error, { email: string; password: string }>({
    mutationFn: async ({ email, password }) => {
      const supabase = client();

      const {
        data: { user: current },
      } = await supabase.auth.getUser();

      if (current?.is_anonymous) {
        const { data, error } = await supabase.auth.updateUser({
          email,
          password,
        });
        if (error) throw new Error(error.message);

        // `is_anonymous` only clears once the address is confirmed, so it is
        // the honest signal for whether this account is fully live.
        const stillAnonymous = data.user?.is_anonymous ?? false;

        return {
          signedIn: !stillAnonymous,
          // Supabase leaves `email` as "" while a change is pending and puts
          // the new address in `new_email`. Note `||`, not `??`: the empty
          // string is the common case here and `??` would let it through.
          email: nonEmpty(data.user?.email) ?? email,
          upgraded: true,
        };
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message);

      return {
        signedIn: Boolean(data.session),
        email: nonEmpty(data.user?.email) ?? email,
        upgraded: false,
      };
    },
    onSuccess: reset,
  });
}

/** Sign in to an existing account, replacing whatever session is current. */
export function useSignIn() {
  const reset = useResetIdentity();

  return useMutation<AuthOutcome, Error, { email: string; password: string }>({
    mutationFn: async ({ email, password }) => {
      const supabase = client();

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(error.message);

      return {
        signedIn: Boolean(data.session),
        email: nonEmpty(data.user?.email) ?? email,
        upgraded: false,
      };
    },
    onSuccess: reset,
  });
}

/**
 * Sign out.
 *
 * The next request with no session mints a fresh anonymous user, so the app
 * stays usable — signing out returns someone to guest mode rather than to a
 * locked door.
 */
export function useSignOut() {
  const reset = useResetIdentity();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const { error } = await client().auth.signOut();
      if (error) throw new Error(error.message);
    },
    onSuccess: reset,
  });
}

/** Send a password reset email. */
export function useResetPassword() {
  return useMutation<void, Error, { email: string }>({
    mutationFn: async ({ email }) => {
      const { error } = await client().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (error) throw new Error(error.message);
    },
  });
}
