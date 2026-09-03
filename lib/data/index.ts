import "server-only";
import { LocalRepository } from "./local-repo";
import type { Repository } from "./repository";
import { SupabaseRepository } from "./supabase-repo";

/**
 * Backend selection.
 *
 * With Supabase credentials present the app talks to Postgres/PostGIS. Without
 * them it falls back to a seeded in-process store, so a fresh clone runs with
 * `npm run dev` and nothing else. Everything above this module is written
 * against the Repository interface and does not know which one it got.
 */

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

export function isSupabaseConfigured(): boolean {
  return (
    configured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

let cached: Repository | null = null;

export function getRepository(): Repository {
  if (!cached) {
    cached = isSupabaseConfigured()
      ? new SupabaseRepository()
      : new LocalRepository();
  }
  return cached;
}

export type { Repository };
export { DEFAULT_PREFERENCES } from "./repository";
