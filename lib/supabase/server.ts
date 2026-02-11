/**
 * Supabase Server Client (Server-side)
 *
 * This provides two types of server clients:
 * 1. Service Role Client - Bypasses RLS, for admin operations
 * 2. SSR Client - Respects RLS, for user-specific operations
 */

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

/**
 * Create a Supabase client for Server Components and API Routes
 * This client respects RLS policies and uses the user's session
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}

/**
 * Create a Supabase Service Role client (Admin/System operations)
 *
 * ⚠️ WARNING: This client bypasses Row Level Security (RLS)
 * Only use this for:
 * - Admin operations
 * - System tasks (e.g., scheduled jobs, notifications)
 * - Operations that need to access data across all users
 *
 * Never expose this client to the browser or use user input directly with it
 */
export function createServiceRoleClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/**
 * Helper function to get the current user from server context
 */
export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    console.error('Error fetching user:', error)
    return null
  }

  return user
}

/**
 * Helper function to check if user is authenticated on server
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser()
  return !!user
}

/**
 * Type exports
 */
export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
export type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>
