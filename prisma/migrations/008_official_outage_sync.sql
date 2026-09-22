-- Outage Tracker - Migration 008
--
-- Real power outages from ODIN (Outage Data Initiative Nationwide), the
-- DOE / Oak Ridge National Laboratory programme through which utilities publish
-- near-real-time outage counts by county. Free, no key, and at the time of
-- writing about 90 utilities across 30-odd states.
--
-- Two changes:
--
--   1. sync_official_outages() writes a whole feed snapshot atomically: upsert
--      every row it contains, resolve every row it no longer contains. Doing
--      this from the client library did not work — the unique index on
--      (source_name, source_id) is partial, and PostgREST cannot name a partial
--      index's predicate in ON CONFLICT, so the upsert path in lib/ingest/run.ts
--      would have failed the first time a source returned outages. It had never
--      been exercised because NWS only produces advisories.
--
--   2. search_outages() returns the utility's own name and the customer count
--      for ingested rows, which live in outages.metadata. Without this every
--      ODIN outage rendered as "Unknown provider" with no sense of scale.

-- ============================================================================
-- 1. ATOMIC FEED SYNC
-- ============================================================================

/**
 * Apply one complete snapshot from an upstream feed.
 *
 * `feed_rows` is a JSON array of objects with: source_id, service_type,
 * severity, latitude, longitude, city, state, description,
 * estimated_restoration, reported_at (null when the feed does not say), and
 * metadata.
 *
 * reported_at: the earliest start we have wins — a feed-supplied start time, or
 * failing that the first time we saw the outage, kept across polls rather than
 * reset to now on every run. A later value never replaces an earlier one, so a
 * displayed duration never shrinks.
 * An outage that had been resolved and reappears is reopened with a fresh start.
 *
 * The caller must pass the *whole* snapshot. Anything absent is resolved, so a
 * truncated fetch would wrongly close real outages — lib/ingest/odin.ts uses the
 * bulk export endpoint for exactly this reason.
 */
CREATE OR REPLACE FUNCTION sync_official_outages(
  feed_source TEXT,
  feed_rows JSONB
)
RETURNS TABLE (upserted INTEGER, resolved INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n_upserted INTEGER;
  n_resolved INTEGER;
BEGIN
  WITH incoming AS (
    SELECT *
    FROM jsonb_to_recordset(feed_rows) AS r(
      source_id TEXT,
      service_type TEXT,
      severity TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      city TEXT,
      state TEXT,
      description TEXT,
      estimated_restoration TIMESTAMPTZ,
      reported_at TIMESTAMPTZ,
      metadata JSONB
    )
    -- Without an id a row can neither be upserted nor resolved; it would be
    -- inserted afresh on every poll.
    WHERE r.source_id IS NOT NULL
  ),
  written AS (
    INSERT INTO outages AS o (
      source_name, source_id, origin, service_type, severity, status,
      location, city, state, description, estimated_restoration,
      reported_at, metadata
    )
    SELECT
      feed_source, i.source_id, 'official', i.service_type, i.severity, 'active',
      ST_SetSRID(ST_MakePoint(i.longitude, i.latitude), 4326)::geography,
      i.city, i.state, i.description, i.estimated_restoration,
      COALESCE(i.reported_at, NOW()), COALESCE(i.metadata, '{}'::jsonb)
    FROM incoming i
    ON CONFLICT (source_name, source_id) WHERE source_name IS NOT NULL
    DO UPDATE SET
      severity = EXCLUDED.severity,
      location = EXCLUDED.location,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      description = EXCLUDED.description,
      estimated_restoration = EXCLUDED.estimated_restoration,
      metadata = EXCLUDED.metadata,
      reported_at = CASE
        WHEN o.status = 'resolved' THEN EXCLUDED.reported_at
        ELSE LEAST(o.reported_at, EXCLUDED.reported_at)
      END,
      status = 'active',
      resolved_at = NULL
    RETURNING 1
  )
  SELECT count(*) INTO n_upserted FROM written;

  UPDATE outages o
  SET status = 'resolved', resolved_at = NOW()
  WHERE o.source_name = feed_source
    AND o.status = 'active'
    -- NOT IN over a subquery is hashed once, rather than re-scanning the JSON
    -- array for every active row. The IS NOT NULL stops a null id from making
    -- NOT IN match nothing.
    AND o.source_id NOT IN (
      SELECT r->>'source_id'
      FROM jsonb_array_elements(feed_rows) AS r
      WHERE r->>'source_id' IS NOT NULL
    );
  GET DIAGNOSTICS n_resolved = ROW_COUNT;

  RETURN QUERY SELECT n_upserted, n_resolved;
END;
$$;

-- Writes outages on behalf of an upstream feed; only the server-side ingest,
-- running as the service role, may call it.
REVOKE ALL ON FUNCTION sync_official_outages(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. PROVIDER NAME AND SCALE FOR INGESTED ROWS
-- ============================================================================

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
  source_name VARCHAR(64),
  customers_affected INTEGER,
  -- False when reported_at is only when we first saw the row, so the UI does
  -- not claim an outage has lasted "1 min" when it may be hours old.
  start_known BOOLEAN
) AS $$
DECLARE
  west  DOUBLE PRECISION := GREATEST(min_lng, -179.999999);
  east  DOUBLE PRECISION := LEAST(max_lng, 179.999999);
  south DOUBLE PRECISION := GREATEST(min_lat, -89.999999);
  north DOUBLE PRECISION := LEAST(max_lat, 89.999999);
  box GEOGRAPHY := ST_MakeEnvelope(west, south, east, north, 4326)::geography;
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.provider_id, p.slug,
    -- A feed's own utility name when the row has no provider in our table.
    COALESCE(p.name, LEFT(o.metadata->>'utility_name', 100))::VARCHAR(100),
    o.service_type, o.severity, o.status,
    ST_Y(o.location::geometry), ST_X(o.location::geometry),
    o.address, o.city, o.state, o.zip_code, o.description,
    o.reported_by, o.reported_at, o.resolved_at, o.estimated_restoration,
    o.verification_count, o.is_verified,
    o.origin, o.source_name,
    -- Type-checked before casting: one malformed row must not make the cast
    -- throw and fail the search for everyone.
    CASE WHEN jsonb_typeof(o.metadata->'customers_affected') = 'number'
      THEN (o.metadata->>'customers_affected')::NUMERIC::INTEGER END,
    CASE WHEN jsonb_typeof(o.metadata->'start_known') = 'boolean'
      THEN (o.metadata->>'start_known')::BOOLEAN ELSE TRUE END
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
$$ LANGUAGE plpgsql STABLE;

INSERT INTO schema_version (version, description) VALUES
  ('008', 'Atomic feed sync for official outages; utility name and scale in search')
ON CONFLICT DO NOTHING;
