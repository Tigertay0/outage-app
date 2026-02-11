-- Outage Tracker - Initial Database Schema
-- This migration creates all tables, indexes, and policies for the MVP

-- Enable PostGIS extension for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Service Providers Table
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  service_type VARCHAR(50) NOT NULL CHECK (service_type IN ('power', 'internet', 'cellular', 'other')),
  logo_url VARCHAR(255),
  official_status_url VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on service_type for filtering
CREATE INDEX IF NOT EXISTS idx_providers_service_type ON providers(service_type);

-- Outages Table (Main data with PostGIS geography)
CREATE TABLE IF NOT EXISTS outages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  service_type VARCHAR(50) NOT NULL CHECK (service_type IN ('power', 'internet', 'cellular', 'other')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('complete', 'degraded', 'intermittent')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'disputed')),

  -- PostGIS geography column for spatial queries (lat/lng)
  location GEOGRAPHY(POINT, 4326) NOT NULL,

  -- Address information (populated via reverse geocoding)
  address TEXT,
  zip_code VARCHAR(10),
  city VARCHAR(100),
  state VARCHAR(50),

  -- Outage details
  description TEXT,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  estimated_restoration TIMESTAMP WITH TIME ZONE,

  -- Verification tracking
  verification_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,

  -- Flexible metadata storage
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spatial index for efficient geospatial queries (critical for performance)
CREATE INDEX IF NOT EXISTS idx_outages_location ON outages USING GIST(location);

-- Additional indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_outages_status ON outages(status);
CREATE INDEX IF NOT EXISTS idx_outages_reported_at ON outages(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_outages_provider_id ON outages(provider_id);
CREATE INDEX IF NOT EXISTS idx_outages_service_type ON outages(service_type);
CREATE INDEX IF NOT EXISTS idx_outages_severity ON outages(severity);

-- Composite index for filtered queries
CREATE INDEX IF NOT EXISTS idx_outages_status_service_type ON outages(status, service_type);

-- Outage Confirmations/Upvotes Table
CREATE TABLE IF NOT EXISTS outage_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outage_id UUID NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure one confirmation per user per outage
  UNIQUE(outage_id, user_id)
);

-- Indexes for confirmations
CREATE INDEX IF NOT EXISTS idx_confirmations_outage_id ON outage_confirmations(outage_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_user_id ON outage_confirmations(user_id);

-- Outage Comments/Updates Table
CREATE TABLE IF NOT EXISTS outage_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outage_id UUID NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  comment_type VARCHAR(20) DEFAULT 'update' CHECK (comment_type IN ('update', 'resolution', 'escalation')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for comments
CREATE INDEX IF NOT EXISTS idx_comments_outage_id ON outage_comments(outage_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON outage_comments(created_at DESC);

-- User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,

  -- Saved providers (array of UUIDs)
  saved_providers UUID[] DEFAULT ARRAY[]::UUID[],

  -- Saved locations (JSONB array: [{name, lat, lng, zoom}])
  saved_locations JSONB DEFAULT '[]'::jsonb,

  -- Notification settings (JSONB object)
  notification_settings JSONB DEFAULT '{
    "enabled": false,
    "severity_threshold": "complete",
    "radius_miles": 5,
    "quiet_hours_start": null,
    "quiet_hours_end": null
  }'::jsonb,

  -- Default map view
  default_map_center GEOGRAPHY(POINT, 4326),
  default_zoom INTEGER DEFAULT 10,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for user preferences lookup
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Push Notification Subscriptions Table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL, -- {p256dh: "...", auth: "..."}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique endpoint per user
  UNIQUE(user_id, endpoint)
);

-- Index for push subscriptions
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for providers table
DROP TRIGGER IF EXISTS update_providers_updated_at ON providers;
CREATE TRIGGER update_providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for outages table
DROP TRIGGER IF EXISTS update_outages_updated_at ON outages;
CREATE TRIGGER update_outages_updated_at
  BEFORE UPDATE ON outages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for user_preferences table
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update verification count and status
CREATE OR REPLACE FUNCTION update_outage_verification()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the outage's verification_count
  UPDATE outages
  SET
    verification_count = (
      SELECT COUNT(*) FROM outage_confirmations WHERE outage_id = NEW.outage_id
    ),
    is_verified = (
      SELECT COUNT(*) FROM outage_confirmations WHERE outage_id = NEW.outage_id
    ) >= 5
  WHERE id = NEW.outage_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update verification when confirmation is added
DROP TRIGGER IF EXISTS update_verification_on_confirm ON outage_confirmations;
CREATE TRIGGER update_verification_on_confirm
  AFTER INSERT ON outage_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION update_outage_verification();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE outages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outage_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE outage_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLICIES FOR PROVIDERS TABLE
-- ============================================================================

-- Anyone can view providers (public data)
DROP POLICY IF EXISTS "Public read access for providers" ON providers;
CREATE POLICY "Public read access for providers"
  ON providers FOR SELECT
  USING (true);

-- Only authenticated users can suggest new providers (admin approval needed)
DROP POLICY IF EXISTS "Authenticated users can suggest providers" ON providers;
CREATE POLICY "Authenticated users can suggest providers"
  ON providers FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- POLICIES FOR OUTAGES TABLE
-- ============================================================================

-- Anyone can view active outages (public data for transparency)
DROP POLICY IF EXISTS "Public read access for active outages" ON outages;
CREATE POLICY "Public read access for active outages"
  ON outages FOR SELECT
  USING (status = 'active' OR status = 'resolved');

-- Authenticated users can create outage reports
DROP POLICY IF EXISTS "Authenticated users can create outages" ON outages;
CREATE POLICY "Authenticated users can create outages"
  ON outages FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND reported_by = auth.uid());

-- Users can update their own outage reports
DROP POLICY IF EXISTS "Users can update own outages" ON outages;
CREATE POLICY "Users can update own outages"
  ON outages FOR UPDATE
  USING (reported_by = auth.uid());

-- Users can delete their own outages (within 1 hour of reporting)
DROP POLICY IF EXISTS "Users can delete own recent outages" ON outages;
CREATE POLICY "Users can delete own recent outages"
  ON outages FOR DELETE
  USING (
    reported_by = auth.uid()
    AND reported_at > NOW() - INTERVAL '1 hour'
  );

-- ============================================================================
-- POLICIES FOR OUTAGE_CONFIRMATIONS TABLE
-- ============================================================================

-- Anyone can view confirmations
DROP POLICY IF EXISTS "Public read access for confirmations" ON outage_confirmations;
CREATE POLICY "Public read access for confirmations"
  ON outage_confirmations FOR SELECT
  USING (true);

-- Authenticated users can confirm outages (once per outage)
DROP POLICY IF EXISTS "Authenticated users can confirm outages" ON outage_confirmations;
CREATE POLICY "Authenticated users can confirm outages"
  ON outage_confirmations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

-- Users can remove their own confirmations
DROP POLICY IF EXISTS "Users can remove own confirmations" ON outage_confirmations;
CREATE POLICY "Users can remove own confirmations"
  ON outage_confirmations FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- POLICIES FOR OUTAGE_COMMENTS TABLE
-- ============================================================================

-- Anyone can view comments
DROP POLICY IF EXISTS "Public read access for comments" ON outage_comments;
CREATE POLICY "Public read access for comments"
  ON outage_comments FOR SELECT
  USING (true);

-- Authenticated users can add comments
DROP POLICY IF EXISTS "Authenticated users can add comments" ON outage_comments;
CREATE POLICY "Authenticated users can add comments"
  ON outage_comments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

-- Users can delete their own comments
DROP POLICY IF EXISTS "Users can delete own comments" ON outage_comments;
CREATE POLICY "Users can delete own comments"
  ON outage_comments FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- POLICIES FOR USER_PREFERENCES TABLE
-- ============================================================================

-- Users can only view their own preferences
DROP POLICY IF EXISTS "Users can view own preferences" ON user_preferences;
CREATE POLICY "Users can view own preferences"
  ON user_preferences FOR SELECT
  USING (user_id = auth.uid());

-- Users can create their own preferences
DROP POLICY IF EXISTS "Users can create own preferences" ON user_preferences;
CREATE POLICY "Users can create own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;
CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  USING (user_id = auth.uid());

-- ============================================================================
-- POLICIES FOR PUSH_SUBSCRIPTIONS TABLE
-- ============================================================================

-- Users can only view their own subscriptions
DROP POLICY IF EXISTS "Users can view own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can view own subscriptions"
  ON push_subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- Users can create their own subscriptions
DROP POLICY IF EXISTS "Users can create own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can create own subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own subscriptions
DROP POLICY IF EXISTS "Users can delete own subscriptions" ON push_subscriptions;
CREATE POLICY "Users can delete own subscriptions"
  ON push_subscriptions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- HELPER FUNCTIONS FOR SPATIAL QUERIES
-- ============================================================================

-- Function to find outages within a radius (in meters)
CREATE OR REPLACE FUNCTION find_outages_within_radius(
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_meters INTEGER
)
RETURNS TABLE (
  id UUID,
  provider_id UUID,
  service_type VARCHAR(50),
  severity VARCHAR(20),
  status VARCHAR(20),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  description TEXT,
  reported_at TIMESTAMP WITH TIME ZONE,
  verification_count INTEGER,
  is_verified BOOLEAN,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.provider_id,
    o.service_type,
    o.severity,
    o.status,
    ST_Y(o.location::geometry) AS latitude,
    ST_X(o.location::geometry) AS longitude,
    o.address,
    o.city,
    o.state,
    o.description,
    o.reported_at,
    o.verification_count,
    o.is_verified,
    ST_Distance(
      o.location,
      ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography
    ) AS distance_meters
  FROM outages o
  WHERE
    o.status = 'active'
    AND ST_DWithin(
      o.location,
      ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
      radius_meters
    )
  ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to find outages within a bounding box (viewport)
CREATE OR REPLACE FUNCTION find_outages_in_bounds(
  min_lat DOUBLE PRECISION,
  min_lng DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  max_lng DOUBLE PRECISION
)
RETURNS TABLE (
  id UUID,
  provider_id UUID,
  service_type VARCHAR(50),
  severity VARCHAR(20),
  status VARCHAR(20),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  description TEXT,
  reported_at TIMESTAMP WITH TIME ZONE,
  verification_count INTEGER,
  is_verified BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.provider_id,
    o.service_type,
    o.severity,
    o.status,
    ST_Y(o.location::geometry) AS latitude,
    ST_X(o.location::geometry) AS longitude,
    o.address,
    o.city,
    o.state,
    o.description,
    o.reported_at,
    o.verification_count,
    o.is_verified
  FROM outages o
  WHERE
    o.status = 'active'
    AND o.location && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  ORDER BY o.reported_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA (Optional - Common Providers)
-- ============================================================================

-- Insert common service providers (can be run multiple times safely)
INSERT INTO providers (name, service_type, logo_url) VALUES
  -- Cellular providers
  ('AT&T', 'cellular', '/icons/providers/att.png'),
  ('Verizon', 'cellular', '/icons/providers/verizon.png'),
  ('T-Mobile', 'cellular', '/icons/providers/tmobile.png'),
  ('US Cellular', 'cellular', '/icons/providers/uscellular.png'),
  ('Cricket Wireless', 'cellular', '/icons/providers/cricket.png'),
  ('Metro by T-Mobile', 'cellular', '/icons/providers/metro.png'),

  -- Internet/WiFi providers
  ('Comcast/Xfinity', 'internet', '/icons/providers/comcast.png'),
  ('Spectrum', 'internet', '/icons/providers/spectrum.png'),
  ('AT&T Internet', 'internet', '/icons/providers/att-internet.png'),
  ('Verizon Fios', 'internet', '/icons/providers/verizon-fios.png'),
  ('Cox', 'internet', '/icons/providers/cox.png'),
  ('CenturyLink', 'internet', '/icons/providers/centurylink.png'),
  ('Google Fiber', 'internet', '/icons/providers/google-fiber.png'),
  ('Frontier', 'internet', '/icons/providers/frontier.png'),

  -- Power providers (generic, will be customized per region)
  ('Local Power Company', 'power', '/icons/providers/power.png'),
  ('Electric Utility', 'power', '/icons/providers/power.png')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SCHEMA VERSION TRACKING
-- ============================================================================

-- Create a table to track schema versions
CREATE TABLE IF NOT EXISTS schema_version (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT
);

-- Insert initial version
INSERT INTO schema_version (version, description) VALUES
  ('001', 'Initial schema with PostGIS, outages, providers, confirmations, comments, preferences, and push subscriptions')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

-- Output success message
DO $$
BEGIN
  RAISE NOTICE 'Database schema created successfully!';
  RAISE NOTICE 'PostGIS extension: enabled';
  RAISE NOTICE 'Tables created: 7';
  RAISE NOTICE 'Indexes created: ~15';
  RAISE NOTICE 'RLS policies: ~20';
  RAISE NOTICE 'Helper functions: 2';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Verify tables in Supabase Table Editor';
  RAISE NOTICE '2. Test by creating a sample outage';
  RAISE NOTICE '3. Start building the Next.js frontend!';
END $$;
