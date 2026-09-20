/**
 * Supabase client for the browser.
 *
 * Uses the publishable anon key and is subject to Row Level Security, so it is
 * safe to ship. It shares the auth cookies that `lib/supabase/server.ts` reads,
 * which is what lets a sign-in performed here be visible to the API routes on
 * the very next request.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import type { SupabaseClient as BaseClient } from "@supabase/supabase-js";

export type SupabaseClient = BaseClient<Database>;

const PLACEHOLDERS = new Set([
  "YOUR_SUPABASE_PROJECT_URL",
  "YOUR_SUPABASE_ANON_KEY",
  "your-project-url",
  "your-anon-key",
  "",
]);

function configured(value: string | undefined): boolean {
  return Boolean(value) && !PLACEHOLDERS.has(value!.trim());
}

/** Mirrors `isSupabaseConfigured` in lib/data, for client components. */
export function isSupabaseConfigured(): boolean {
  return (
    configured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

// One client per tab. Two instances would keep separate in-memory sessions and
// race each other refreshing the same token.
let cached: SupabaseClient | null = null;

/**
 * The browser client, or null when this deployment has no Supabase project.
 *
 * Returning null rather than throwing is deliberate: the app is designed to run
 * against a local in-memory store with no credentials at all, and importing an
 * auth-aware component must not break that. Callers check
 * `isSupabaseConfigured()` — or this return value — and hide account UI
 * instead. Previously this module built a client at import time, which threw
 * during module evaluation whenever the keys were absent.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;

  if (!cached) {
    cached = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  return cached;
}
