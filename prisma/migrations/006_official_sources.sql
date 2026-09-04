-- Outage Tracker - Migration 006
--
-- Ingestion of public data (PRD section 6.1, "hybrid: crowdsourced + official").
--
-- Two additions, deliberately kept apart:
--
--   1. `origin` on outages, so a row fetched from an upstream feed is
--      distinguishable from one a person reported. Confirmation counts mean
--      something different for each, and the UI has to be able to say which it
--      is showing.
--
--   2. An `advisories` table, separate from outages. The free public feed that
--      actually covers the US is the National Weather Service, and a storm
--      warning is not an outage — it is a reason to expect one. Filing them as
--      outages would inflate the map with events nobody has lost service to and
--      make the verification counts meaningless. They get their own layer.
--
-- Power outage data specifically has no free live feed: PowerOutage.us
-- aggregates every US utility and charges for it, and the DOE's EAGLE-I is
-- bulk historical. The source interface in lib/ingest exists so a paid feed can
-- be added later without touching anything above it.

-- ============================================================================
-- 1. OUTAGE PROVENANCE
-- ============================================================================

ALTER TABLE outages
  ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'crowdsourced'
    CHECK (origin IN ('crowdsourced', 'official'));

-- Which feed produced this row, and that feed's own identifier for it, so a
-- repeated poll updates rather than duplicates.
ALTER TABLE outages ADD COLUMN IF NOT EXISTS source_name VARCHAR(64);
ALTER TABLE outages ADD COLUMN IF NOT EXISTS source_id VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outages_source
  ON outages (source_name, source_id)
  WHERE source_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outages_origin ON outages(origin);

-- Nobody may edit or delete an ingested row through the public API; the feed
-- owns it. The existing "own outages" policies already restrict by reported_by,
-- which is NULL for these, but be explicit rather than relying on that.
DROP POLICY IF EXISTS "Users can update own outages" ON outages;
CREATE POLICY "Users can update own outages"
  ON outages FOR UPDATE
  USING (reported_by = auth.uid() AND origin = 'crowdsourced');

DROP POLICY IF EXISTS "Users can delete own recent outages" ON outages;
CREATE POLICY "Users can delete own recent outages"
  ON outages FOR DELETE
  USING (
    reported_by = auth.uid()
    AND origin = 'crowdsourced'
    AND reported_at > NOW() - INTERVAL '1 hour'
  );

-- ============================================================================
-- 2. ADVISORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS advisories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  source_name VARCHAR(64) NOT NULL,
  source_id VARCHAR(200) NOT NULL,

  -- The upstream event name, e.g. "High Wind Warning".
  kind VARCHAR(120) NOT NULL,
  -- Upstream severity, normalised to the same vocabulary the map already uses
  -- for colour so advisories do not need a second legend.
  severity VARCHAR(20) NOT NULL
    CHECK (severity IN ('complete', 'degraded', 'intermittent')),

  headline TEXT,
  description TEXT,
  area_description TEXT,
  url TEXT,

  -- Centroid of the affected area. The full polygon is not stored: the map
  -- shows these as a single marker, and keeping the geometry would mean
  -- shipping a lot of coordinates for a layer that is context, not detail.
  location GEOGRAPHY(POINT, 4326) NOT NULL,

  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE (source_name, source_id)
);

CREATE INDEX IF NOT EXISTS idx_advisories_location
  ON advisories USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_advisories_ends_at ON advisories(ends_at);

DROP TRIGGER IF EXISTS update_advisories_updated_at ON advisories;
CREATE TRIGGER update_advisories_updated_at
  BEFORE UPDATE ON advisories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE advisories ENABLE ROW LEVEL SECURITY;

-- Public data in, public data out. Writes happen only through the ingest route,
-- which uses the service-role key and so bypasses RLS entirely.
DROP POLICY IF EXISTS "Public read access for advisories" ON advisories;
CREATE POLICY "Public read access for advisories"
  ON advisories FOR SELECT USING (true);

-- ============================================================================
-- 3. VIEWPORT QUERY FOR ADVISORIES
-- ============================================================================

CREATE OR REPLACE FUNCTION search_advisories(
  min_lat DOUBLE PRECISION DEFAULT -90,
  min_lng DOUBLE PRECISION DEFAULT -180,
  max_lat DOUBLE PRECISION DEFAULT 90,
  max_lng DOUBLE PRECISION DEFAULT 180,
  max_results INTEGER DEFAULT 300
)
RETURNS TABLE (
  id UUID,
  source_name VARCHAR(64),
  source_id VARCHAR(200),
  kind VARCHAR(120),
  severity VARCHAR(20),
  headline TEXT,
  description TEXT,
  area_description TEXT,
  url TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  starts_at TIMESTAMP WITH TIME ZONE,
  ends_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  -- Same antipodal clamp as search_outages; see migration 002.
  west  DOUBLE PRECISION := GREATEST(min_lng, -179.999999);
  east  DOUBLE PRECISION := LEAST(max_lng, 179.999999);
  south DOUBLE PRECISION := GREATEST(min_lat, -89.999999);
  north DOUBLE PRECISION := LEAST(max_lat, 89.999999);
  box GEOGRAPHY := ST_MakeEnvelope(west, south, east, north, 4326)::geography;
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.source_name, a.source_id, a.kind, a.severity,
    a.headline, a.description, a.area_description, a.url,
    ST_Y(a.location::geometry), ST_X(a.location::geometry),
    a.starts_at, a.ends_at
  FROM advisories a
  WHERE ST_Intersects(a.location, box)
    AND (a.ends_at IS NULL OR a.ends_at > NOW())
  ORDER BY a.starts_at DESC NULLS LAST
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Expired advisories are noise; the ingest run calls this after each poll.
CREATE OR REPLACE FUNCTION prune_expired_advisories()
RETURNS INTEGER AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM advisories
  WHERE ends_at IS NOT NULL AND ends_at < NOW() - INTERVAL '6 hours';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. EXPOSE PROVENANCE THROUGH THE VIEWPORT QUERY
-- ============================================================================

-- search_outages gains origin and source_name so the map can mark which rows
-- came from a feed. Everything else is unchanged from migration 002.
DROP FUNCTION IF EXISTS search_outages(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[], INTEGER, INTEGER, UUID[]
);

CREATE FUNCTION search_outages(
  min_lat DOUBLE PRECISION DEFAULT -90,
  min_lng DOUBLE PRECISION DEFAULT -180,
  max_lat DOUBLE PRECISION DEFAULT 90,
  max_lng DOUBLE PRECISION DEFAULT 180,
  service_types TEXT[] DEFAULT NULL,
  provider_slugs TEXT[] DEFAULT NULL,
  severities TEXT[] DEFAULT NULL,
  resolved_within_hours INTEGER DEFAULT 0,
  max_results INTEGER DEFAULT 1000,
  outage_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  provider_id UUID,
  provider_slug VARCHAR(64),
  provider_name VARCHAR(100),
  service_type VARCHAR(50),
  severity VARCHAR(20),
  status VARCHAR(20),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip_code VARCHAR(10),
  description TEXT,
  reported_by UUID,
  reported_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  estimated_restoration TIMESTAMP WITH TIME ZONE,
  verification_count INTEGER,
  is_verified BOOLEAN,
  origin VARCHAR(20),
  source_name VARCHAR(64)
) AS $
DECLARE
  west  DOUBLE PRECISION := GREATEST(min_lng, -179.999999);
  east  DOUBLE PRECISION := LEAST(max_lng, 179.999999);
  south DOUBLE PRECISION := GREATEST(min_lat, -89.999999);
  north DOUBLE PRECISION := LEAST(max_lat, 89.999999);
  box GEOGRAPHY := ST_MakeEnvelope(west, south, east, north, 4326)::geography;
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.provider_id, p.slug, p.name,
    o.service_type, o.severity, o.status,
    ST_Y(o.location::geometry), ST_X(o.location::geometry),
    o.address, o.city, o.state, o.zip_code, o.description,
    o.reported_by, o.reported_at, o.resolved_at, o.estimated_restoration,
    o.verification_count, o.is_verified,
    o.origin, o.source_name
  FROM outages o
  LEFT JOIN providers p ON p.id = o.provider_id
  WHERE
    (outage_ids IS NOT NULL OR ST_Intersects(o.location, box))
    AND (
      outage_ids IS NOT NULL
      OR o.status = 'active'
      OR (
        o.status = 'resolved'
        AND resolved_within_hours > 0
        AND o.resolved_at > NOW() - (resolved_within_hours || ' hours')::INTERVAL
      )
    )
    AND (outage_ids IS NULL OR o.id = ANY(outage_ids))
    AND (service_types IS NULL OR o.service_type = ANY(service_types))
    AND (severities IS NULL OR o.severity = ANY(severities))
    AND (
      provider_slugs IS NULL
      OR array_length(provider_slugs, 1) IS NULL
      OR p.slug = ANY(provider_slugs)
    )
  ORDER BY o.reported_at DESC
  LIMIT max_results;
END;
$ LANGUAGE plpgsql STABLE;

INSERT INTO schema_version (version, description) VALUES
  ('006', 'Outage provenance plus an advisories layer for public feeds')
ON CONFLICT DO NOTHING;
