/**
 * Supabase Client (Browser/Client-side)
 *
 * This client is used in client components and browser contexts.
 * It uses the anonymous/public key and respects Row Level Security (RLS) policies.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

/**
 * Create a Supabase client for client-side use
 * This client automatically handles:
 * - Browser cookies for auth
 * - RLS policies
 * - Real-time subscriptions
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Export a singleton instance for convenience
export const supabase = createClient()

/**
 * Helper function to check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL'
  )
}

/**
 * Type exports for convenience
 */
export type SupabaseClient = ReturnType<typeof createClient>
