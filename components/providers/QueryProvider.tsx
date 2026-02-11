'use client'

/**
 * React Query Provider
 *
 * Wraps the application with React Query's QueryClientProvider
 * This enables data fetching, caching, and synchronization throughout the app
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

interface QueryProviderProps {
  children: ReactNode
}

export function QueryProvider({ children }: QueryProviderProps) {
  // Create a client instance
  // Using useState ensures the client is only created once per session
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data remains fresh for 30 seconds
            staleTime: 30 * 1000,
            // Cache data for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed queries once
            retry: 1,
            // Refetch on window focus (useful for real-time updates)
            refetchOnWindowFocus: true,
            // Refetch on reconnect
            refetchOnReconnect: true,
          },
          mutations: {
            // Retry failed mutations once
            retry: 1,
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
