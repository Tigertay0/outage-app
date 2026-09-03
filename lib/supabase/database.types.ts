/**
 * Database TypeScript Types
 *
 * These types are generated from your Supabase database schema.
 * They provide type safety when querying the database.
 *
 * To regenerate these types, run:
 * npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/supabase/database.types.ts
 *
 * Or use the Supabase CLI:
 * supabase gen types typescript --local > lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      providers: {
        Row: {
          id: string
          name: string
          service_type: 'power' | 'internet' | 'cellular' | 'other'
          logo_url: string | null
          official_status_url: string | null
          slug: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          service_type: 'power' | 'internet' | 'cellular' | 'other'
          logo_url?: string | null
          official_status_url?: string | null
          slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          service_type?: 'power' | 'internet' | 'cellular' | 'other'
          logo_url?: string | null
          official_status_url?: string | null
          slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      outages: {
        Row: {
          id: string
          provider_id: string | null
          service_type: 'power' | 'internet' | 'cellular' | 'other'
          severity: 'complete' | 'degraded' | 'intermittent'
          status: 'active' | 'resolved' | 'disputed'
          location: unknown // PostGIS geography type
          address: string | null
          zip_code: string | null
          city: string | null
          state: string | null
          description: string | null
          reported_by: string | null
          reported_at: string
          resolved_at: string | null
          estimated_restoration: string | null
          verification_count: number
          is_verified: boolean
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider_id?: string | null
          service_type: 'power' | 'internet' | 'cellular' | 'other'
          severity: 'complete' | 'degraded' | 'intermittent'
          status?: 'active' | 'resolved' | 'disputed'
          location: unknown // Will be set as ST_Point(lng, lat)
          address?: string | null
          zip_code?: string | null
          city?: string | null
          state?: string | null
          description?: string | null
          reported_by?: string | null
          reported_at?: string
          resolved_at?: string | null
          estimated_restoration?: string | null
          verification_count?: number
          is_verified?: boolean
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          provider_id?: string | null
          service_type?: 'power' | 'internet' | 'cellular' | 'other'
          severity?: 'complete' | 'degraded' | 'intermittent'
          status?: 'active' | 'resolved' | 'disputed'
          location?: unknown
          address?: string | null
          zip_code?: string | null
          city?: string | null
          state?: string | null
          description?: string | null
          reported_by?: string | null
          reported_at?: string
          resolved_at?: string | null
          estimated_restoration?: string | null
          verification_count?: number
          is_verified?: boolean
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      outage_confirmations: {
        Row: {
          id: string
          outage_id: string
          user_id: string
          confirmed_at: string
        }
        Insert: {
          id?: string
          outage_id: string
          user_id: string
          confirmed_at?: string
        }
        Update: {
          id?: string
          outage_id?: string
          user_id?: string
          confirmed_at?: string
        }
        Relationships: []
      }
      /** Added in migration 002 — "it's back for me" votes. */
      outage_resolutions: {
        Row: {
          id: string
          outage_id: string
          user_id: string
          reported_at: string
        }
        Insert: {
          id?: string
          outage_id: string
          user_id: string
          reported_at?: string
        }
        Update: {
          id?: string
          outage_id?: string
          user_id?: string
          reported_at?: string
        }
        Relationships: []
      }
      outage_comments: {
        Row: {
          id: string
          outage_id: string
          user_id: string
          comment: string
          comment_type: 'update' | 'resolution' | 'escalation'
          created_at: string
        }
        Insert: {
          id?: string
          outage_id: string
          user_id: string
          comment: string
          comment_type?: 'update' | 'resolution' | 'escalation'
          created_at?: string
        }
        Update: {
          id?: string
          outage_id?: string
          user_id?: string
          comment?: string
          comment_type?: 'update' | 'resolution' | 'escalation'
          created_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          id: string
          user_id: string
          saved_providers: string[]
          saved_locations: Json
          notification_settings: Json
          default_map_center: unknown // PostGIS geography type
          default_zoom: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          saved_providers?: string[]
          saved_locations?: Json
          notification_settings?: Json
          default_map_center?: unknown
          default_zoom?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          saved_providers?: string[]
          saved_locations?: Json
          notification_settings?: Json
          default_map_center?: unknown
          default_zoom?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          keys: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          keys: Json
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          keys?: Json
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_outages_within_radius: {
        Args: {
          center_lat: number
          center_lng: number
          radius_meters: number
        }
        Returns: {
          id: string
          provider_id: string
          service_type: string
          severity: string
          status: string
          latitude: number
          longitude: number
          address: string
          city: string
          state: string
          description: string
          reported_at: string
          verification_count: number
          is_verified: boolean
          distance_meters: number
        }[]
      }
      find_outages_in_bounds: {
        Args: {
          min_lat: number
          min_lng: number
          max_lat: number
          max_lng: number
        }
        Returns: {
          id: string
          provider_id: string
          service_type: string
          severity: string
          status: string
          latitude: number
          longitude: number
          address: string
          city: string
          state: string
          description: string
          reported_at: string
          verification_count: number
          is_verified: boolean
        }[]
      }
      /** Added in migration 002 — the filtered viewport query the map uses. */
      search_outages: {
        Args: {
          min_lat?: number
          min_lng?: number
          max_lat?: number
          max_lng?: number
          service_types?: string[] | null
          provider_slugs?: string[] | null
          severities?: string[] | null
          resolved_within_hours?: number
          max_results?: number
          outage_ids?: string[] | null
        }
        Returns: {
          id: string
          provider_id: string | null
          provider_slug: string | null
          provider_name: string | null
          service_type: 'power' | 'internet' | 'cellular' | 'other'
          severity: 'complete' | 'degraded' | 'intermittent'
          status: 'active' | 'resolved' | 'disputed'
          latitude: number
          longitude: number
          address: string | null
          city: string | null
          state: string | null
          zip_code: string | null
          description: string | null
          reported_by: string | null
          reported_at: string
          resolved_at: string | null
          estimated_restoration: string | null
          verification_count: number
          is_verified: boolean
        }[]
      }
      /** Added in migration 002 — backs the report rate limit. */
      recent_report_count: {
        Args: {
          reporter: string
          window_minutes?: number
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    // Required for this type to satisfy supabase-js's GenericSchema. Without
    // it the client silently falls back to untyped queries, which is how the
    // rpc() calls in lib/data/supabase-repo.ts lose their argument types.
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

/**
 * Helper types for common operations
 */
export type Provider = Database['public']['Tables']['providers']['Row']
export type ProviderInsert = Database['public']['Tables']['providers']['Insert']
export type ProviderUpdate = Database['public']['Tables']['providers']['Update']

export type Outage = Database['public']['Tables']['outages']['Row']
export type OutageInsert = Database['public']['Tables']['outages']['Insert']
export type OutageUpdate = Database['public']['Tables']['outages']['Update']

export type OutageConfirmation = Database['public']['Tables']['outage_confirmations']['Row']
export type OutageConfirmationInsert = Database['public']['Tables']['outage_confirmations']['Insert']

export type OutageComment = Database['public']['Tables']['outage_comments']['Row']
export type OutageCommentInsert = Database['public']['Tables']['outage_comments']['Insert']

export type UserPreferences = Database['public']['Tables']['user_preferences']['Row']
export type UserPreferencesInsert = Database['public']['Tables']['user_preferences']['Insert']
export type UserPreferencesUpdate = Database['public']['Tables']['user_preferences']['Update']

export type PushSubscription = Database['public']['Tables']['push_subscriptions']['Row']
export type PushSubscriptionInsert = Database['public']['Tables']['push_subscriptions']['Insert']

/**
 * Outage with location as coordinates
 */
export interface OutageWithCoordinates extends Omit<Outage, 'location'> {
  latitude: number
  longitude: number
}

/**
 * Outage with provider information
 */
export interface OutageWithProvider extends OutageWithCoordinates {
  provider: Provider | null
}

/**
 * Service type enum
 */
export type ServiceType = 'power' | 'internet' | 'cellular' | 'other'

/**
 * Severity enum
 */
export type Severity = 'complete' | 'degraded' | 'intermittent'

/**
 * Status enum
 */
export type Status = 'active' | 'resolved' | 'disputed'

/**
 * Comment type enum
 */
export type CommentType = 'update' | 'resolution' | 'escalation'
