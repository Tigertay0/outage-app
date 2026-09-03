-- Outage Tracker - Migration 002
--
-- Fixes and additions on top of 001:
--   1. verification_count no longer drifts when a confirmation is withdrawn.
--   2. A single filter-capable viewport RPC, so the map does not have to fetch
--      every outage in view and filter client-side.
--   3. A resolution vote table, so "resolved for me" is a real signal rather
--      than a unilateral status flip by whoever taps first.
--   4. Provider ids become human-readable slugs, matching lib/data/seed.ts.

-- ============================================================================
-- 1. VERIFICATION COUNT: handle DELETE as well as INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_outage_verification()
RETURNS TRIGGER AS $$
DECLARE
  target_outage UUID;
  confirm_count INTEGER;
BEGIN
  target_outage := COALESCE(NEW.outage_id, OLD.outage_id);

  SELECT COUNT(*) INTO confirm_count
  FROM outage_confirmations
  WHERE outage_id = target_outage;

  UPDATE outages
  SET verification_count = confirm_count,
      is_verified = confirm_count >= 5
  WHERE id = target_outage;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_verification_on_confirm ON outage_confirmations;
CREATE TRIGGER update_verification_on_confirm
  AFTER INSERT ON outage_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION update_outage_verification();

DROP TRIGGER IF EXISTS update_verification_on_unconfirm ON outage_confirmations;
CREATE TRIGGER update_verification_on_unconfirm
  AFTER DELETE ON outage_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION update_outage_verification();

-- ============================================================================
-- 2. PROVIDER SLUGS
-- ============================================================================

-- The app addresses providers by stable slug ("xfinity") rather than a random
-- UUID, so seed data and filter state stay readable and portable.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS slug VARCHAR(64);

UPDATE providers SET slug = CASE name
  WHEN 'AT&T' THEN 'att'
  WHEN 'Verizon' THEN 'verizon'
  WHEN 'T-Mobile' THEN 'tmobile'
  WHEN 'US Cellular' THEN 'uscellular'
  WHEN 'Cricket Wireless' THEN 'cricket'
  WHEN 'Metro by T-Mobile' THEN 'metro'
  WHEN 'Comcast/Xfinity' THEN 'xfinity'
  WHEN 'Comcast / Xfinity' THEN 'xfinity'
  WHEN 'Spectrum' THEN 'spectrum'
  WHEN 'AT&T Internet' THEN 'att-internet'
  WHEN 'Verizon Fios' THEN 'fios'
  WHEN 'Cox' THEN 'cox'
  WHEN 'CenturyLink' THEN 'centurylink'
  WHEN 'Google Fiber' THEN 'google-fiber'
  WHEN 'Frontier' THEN 'frontier'
  ELSE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
END
WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_slug ON providers(slug);

-- ============================================================================
-- 3. RESOLUTION VOTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS outage_resolutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outage_id UUID NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(outage_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_resolutions_outage_id
  ON outage_resolutions(outage_id);

ALTER TABLE outage_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for resolutions" ON outage_resolutions;
CREATE POLICY "Public read access for resolutions"
  ON outage_resolutions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can vote resolved" ON outage_resolutions;
CREATE POLICY "Authenticated users can vote resolved"
  ON outage_resolutions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can withdraw own resolution" ON outage_resolutions;
CREATE POLICY "Users can withdraw own resolution"
  ON outage_resolutions FOR DELETE USING (user_id = auth.uid());

-- An outage flips to resolved once two people independently say it is back, or
-- immediately if the original reporter says so.
CREATE OR REPLACE FUNCTION apply_resolution_votes()
RETURNS TRIGGER AS $$
DECLARE
  votes INTEGER;
  reporter UUID;
BEGIN
  SELECT COUNT(*) INTO votes
  FROM outage_resolutions WHERE outage_id = NEW.outage_id;

  SELECT reported_by INTO reporter FROM outages WHERE id = NEW.outage_id;

  IF votes >= 2 OR reporter = NEW.user_id THEN
    UPDATE outages
    SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
    WHERE id = NEW.outage_id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS apply_resolution_votes_trigger ON outage_resolutions;
CREATE TRIGGER apply_resolution_votes_trigger
  AFTER INSERT ON outage_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION apply_resolution_votes();

-- ============================================================================
-- 4. FILTERED VIEWPORT SEARCH
-- ============================================================================

-- Replaces find_outages_in_bounds for app use. Pushes the service/provider/
-- severity filters and the resolved-window into SQL, joins the provider name so
-- the client needs one request rather than two, and caps the result set.
--
-- NULL for any filter array means "no filter on this dimension".
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
  -- Lets the detail view fetch one known outage without a second function.
  -- When set, the viewport, status and resolved-window filters are all
  -- bypassed: an id was asked for by name, so a resolved outage somewhere
  -- off-screen should still come back.
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
  is_verified BOOLEAN
) AS $$
DECLARE
  -- ST_MakeEnvelope spanning a full 360 degrees produces an antipodal edge,
  -- which geography cannot represent — it raises "Antipodal (180 degrees long)
  -- edge detected!". The defaults below are exactly that span, so clamp just
  -- inside the antimeridian and the poles. The excluded sliver is open ocean.
  west  DOUBLE PRECISION := GREATEST(min_lng, -179.999999);
  east  DOUBLE PRECISION := LEAST(max_lng, 179.999999);
  south DOUBLE PRECISION := GREATEST(min_lat, -89.999999);
  north DOUBLE PRECISION := LEAST(max_lat, 89.999999);
  box GEOGRAPHY := ST_MakeEnvelope(west, south, east, north, 4326)::geography;
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.provider_id,
    p.slug,
    p.name,
    o.service_type,
    o.severity,
    o.status,
    ST_Y(o.location::geometry),
    ST_X(o.location::geometry),
    o.address,
    o.city,
    o.state,
    o.zip_code,
    o.description,
    o.reported_by,
    o.reported_at,
    o.resolved_at,
    o.estimated_restoration,
    o.verification_count,
    o.is_verified
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

-- ============================================================================
-- 5. RATE LIMITING SUPPORT
-- ============================================================================

-- Backs the abuse check in lib/rate-limit.ts: how many reports has this account
-- filed in the last hour?
CREATE OR REPLACE FUNCTION recent_report_count(
  reporter UUID,
  window_minutes INTEGER DEFAULT 60
)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM outages
  WHERE reported_by = reporter
    AND reported_at > NOW() - (window_minutes || ' minutes')::INTERVAL;
$$ LANGUAGE sql STABLE;

INSERT INTO schema_version (version, description) VALUES
  ('002', 'Confirmation-delete fix, provider slugs, resolution votes, filtered search RPC')
ON CONFLICT DO NOTHING;
