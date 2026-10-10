-- Outage Tracker - Migration 011
--
-- search_outages() and search_advisories() returned nothing for a world-sized
-- viewport, including the no-viewport defaults the API uses when no bbox is
-- sent.
--
-- Both built their search area as
--
--   ST_MakeEnvelope(west, south, east, north, 4326)::geography
--
-- A geography polygon's edges are great-circle arcs, and each arc takes the
-- shorter way between its two corners. Once east - west is more than 180
-- degrees the shorter way is across the antimeridian, so the north and south
-- edges run the wrong way round and the polygon covers the strip of Pacific
-- *outside* the requested longitudes instead of the area inside them. For the
-- defaults (-179.999999 .. 179.999999, the clamp migration 002 added to avoid
-- the "antipodal edge" error) that strip is 0.000002 degrees wide, so nothing
-- matched. A US-sized box (< 180 degrees) still worked, which hid it.
--
-- Even under 180 degrees the arcs bow toward the pole, so a box's southern
-- edge sat north of the latitude asked for, mid-span.
--
-- The fix is to test against a planar geometry envelope (SRID 4326), whose
-- edges are lines of constant latitude and longitude — which is what a map
-- viewport is. That also allows the full -180..180 range with no clamp. A
-- viewport crossing the antimeridian (min_lng > max_lng) is searched as two
-- envelopes, one each side.
--
-- Signatures, return columns and grants are unchanged, so CREATE OR REPLACE
-- keeps existing privileges. search_path is restated because CREATE OR
-- REPLACE resets the SET that migration 010 attached.

-- ============================================================================
-- 1. INDEXES FOR THE GEOMETRY PREDICATE
-- ============================================================================

-- The existing GIST indexes are on the geography column and cannot serve a
-- predicate on location::geometry. These match the expression used below.
CREATE INDEX IF NOT EXISTS idx_outages_location_geom
  ON outages USING GIST ((location::geometry));

CREATE INDEX IF NOT EXISTS idx_advisories_location_geom
  ON advisories USING GIST ((location::geometry));

-- ============================================================================
-- 2. search_outages
-- ============================================================================

CREATE OR REPLACE FUNCTION search_outages(
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
  source_name VARCHAR(64),
  customers_affected INTEGER,
  start_known BOOLEAN
) AS $$
DECLARE
  south DOUBLE PRECISION := GREATEST(LEAST(min_lat, max_lat), -90);
  north DOUBLE PRECISION := LEAST(GREATEST(min_lat, max_lat), 90);
  -- The API normalises longitudes into [-180, 180] (lib/geo.ts); the clamp is
  -- for direct callers. A span of 360 or more is the whole world.
  whole_world BOOLEAN := max_lng - min_lng >= 360;
  west  DOUBLE PRECISION := GREATEST(LEAST(min_lng, 180), -180);
  east  DOUBLE PRECISION := GREATEST(LEAST(max_lng, 180), -180);
  box   GEOMETRY;
  box2  GEOMETRY;
BEGIN
  IF whole_world THEN
    box := ST_MakeEnvelope(-180, south, 180, north, 4326);
  ELSIF west <= east THEN
    box := ST_MakeEnvelope(west, south, east, north, 4326);
  ELSE
    -- Crosses the antimeridian.
    box  := ST_MakeEnvelope(west, south, 180, north, 4326);
    box2 := ST_MakeEnvelope(-180, south, east, north, 4326);
  END IF;

  RETURN QUERY
  SELECT
    o.id, o.provider_id, p.slug,
    COALESCE(p.name, LEFT(o.metadata->>'utility_name', 100))::VARCHAR(100),
    o.service_type, o.severity, o.status,
    ST_Y(o.location::geometry), ST_X(o.location::geometry),
    o.address, o.city, o.state, o.zip_code, o.description,
    o.reported_by, o.reported_at, o.resolved_at, o.estimated_restoration,
    o.verification_count, o.is_verified,
    o.origin, o.source_name,
    CASE WHEN jsonb_typeof(o.metadata->'customers_affected') = 'number'
      THEN (o.metadata->>'customers_affected')::NUMERIC::INTEGER END,
    CASE WHEN jsonb_typeof(o.metadata->'start_known') = 'boolean'
      THEN (o.metadata->>'start_known')::BOOLEAN ELSE TRUE END
  FROM outages o
  LEFT JOIN providers p ON p.id = o.provider_id
  WHERE
    (
      outage_ids IS NOT NULL
      OR ST_Intersects(o.location::geometry, box)
      OR (box2 IS NOT NULL AND ST_Intersects(o.location::geometry, box2))
    )
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
$$ LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp;

-- ============================================================================
-- 3. search_advisories
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
  -- Same envelope handling as search_outages above.
  south DOUBLE PRECISION := GREATEST(LEAST(min_lat, max_lat), -90);
  north DOUBLE PRECISION := LEAST(GREATEST(min_lat, max_lat), 90);
  whole_world BOOLEAN := max_lng - min_lng >= 360;
  west  DOUBLE PRECISION := GREATEST(LEAST(min_lng, 180), -180);
  east  DOUBLE PRECISION := GREATEST(LEAST(max_lng, 180), -180);
  box   GEOMETRY;
  box2  GEOMETRY;
BEGIN
  IF whole_world THEN
    box := ST_MakeEnvelope(-180, south, 180, north, 4326);
  ELSIF west <= east THEN
    box := ST_MakeEnvelope(west, south, east, north, 4326);
  ELSE
    box  := ST_MakeEnvelope(west, south, 180, north, 4326);
    box2 := ST_MakeEnvelope(-180, south, east, north, 4326);
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.source_name, a.source_id, a.kind, a.severity,
    a.headline, a.description, a.area_description, a.url,
    ST_Y(a.location::geometry), ST_X(a.location::geometry),
    a.starts_at, a.ends_at
  FROM advisories a
  WHERE (
      ST_Intersects(a.location::geometry, box)
      OR (box2 IS NOT NULL AND ST_Intersects(a.location::geometry, box2))
    )
    AND (a.ends_at IS NULL OR a.ends_at > NOW())
  ORDER BY a.starts_at DESC NULLS LAST
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp;

INSERT INTO schema_version (version, description) VALUES
  ('011', 'Viewport search on geometry envelopes: world-wide and antimeridian boxes')
ON CONFLICT DO NOTHING;
