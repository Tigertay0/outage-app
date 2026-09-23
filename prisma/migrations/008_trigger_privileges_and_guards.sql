-- Outage Tracker - Migration 008
--
-- Fixes to how outage rows are written.
--
--   1. The verification and resolution triggers (002) ran as the calling user.
--      RLS lets only the reporter UPDATE an outage, so a confirmation or "it's
--      back" vote from anyone else updated zero rows, silently: counts stayed
--      at 1, nothing ever became verified, and only the reporter could resolve.
--      Both now run as the owner, and lock the outage row first so two votes
--      arriving together cannot each miss the other.
--
--   2. The INSERT and "own outages" UPDATE policies constrain which row, not
--      which columns. With the publishable key a reporter could call PostgREST
--      directly and set verification_count, is_verified, status or origin on
--      their own report. A BEFORE trigger now pins those columns for the anon
--      and authenticated roles; the service role (ingest) and the triggers in
--      section 1 are unaffected.
--
--   3. consume_rate_limit (005) counted and inserted without a lock, so a burst
--      of concurrent requests on one bucket all saw the same count and all got
--      through. It now serializes per bucket.
--
--   4. Any signed-in user, including an anonymous one, could insert providers,
--      which every client lists. Nothing in the app does; the policy is dropped.

-- ============================================================================
-- 1. TRIGGERS RUN AS OWNER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_outage_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_outage UUID;
  confirm_count INTEGER;
BEGIN
  target_outage := COALESCE(NEW.outage_id, OLD.outage_id);

  -- Serialize concurrent confirmations on one outage so the count below sees
  -- every committed row.
  PERFORM 1 FROM outages WHERE id = target_outage FOR UPDATE;

  SELECT COUNT(*) INTO confirm_count
  FROM outage_confirmations
  WHERE outage_id = target_outage;

  UPDATE outages
  SET verification_count = confirm_count,
      is_verified = confirm_count >= 5
  WHERE id = target_outage;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION apply_resolution_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  votes INTEGER;
  reporter UUID;
BEGIN
  -- Without the lock, two simultaneous votes each counted only themselves and
  -- neither reached the threshold.
  SELECT reported_by INTO reporter
  FROM outages WHERE id = NEW.outage_id
  FOR UPDATE;

  SELECT COUNT(*) INTO votes
  FROM outage_resolutions WHERE outage_id = NEW.outage_id;

  IF votes >= 2 OR reporter = NEW.user_id THEN
    UPDATE outages
    SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
    WHERE id = NEW.outage_id AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

-- Repair rows the old triggers failed to update.
UPDATE outages o
SET verification_count = c.n,
    is_verified = c.n >= 5
FROM (
  SELECT outage_id, COUNT(*)::INTEGER AS n
  FROM outage_confirmations
  GROUP BY outage_id
) c
WHERE c.outage_id = o.id
  AND o.verification_count IS DISTINCT FROM c.n;

UPDATE outages o
SET status = 'resolved', resolved_at = COALESCE(o.resolved_at, NOW())
WHERE o.status = 'active'
  AND (SELECT COUNT(*) FROM outage_resolutions r WHERE r.outage_id = o.id) >= 2;

-- ============================================================================
-- 2. PIN SERVER-OWNED COLUMNS FOR DIRECT API CALLERS
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_outage_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only requests made directly as the API roles are constrained. Inside the
  -- SECURITY DEFINER triggers above current_user is their owner, and ingest
  -- runs as service_role, so both pass through.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_count := 0;
    NEW.is_verified := FALSE;
    NEW.status := 'active';
    NEW.resolved_at := NULL;
    NEW.reported_at := NOW();
    NEW.origin := 'crowdsourced';
    NEW.source_name := NULL;
    NEW.source_id := NULL;
  ELSE
    NEW.verification_count := OLD.verification_count;
    NEW.is_verified := OLD.is_verified;
    NEW.status := OLD.status;
    NEW.resolved_at := OLD.resolved_at;
    NEW.reported_by := OLD.reported_by;
    NEW.reported_at := OLD.reported_at;
    NEW.origin := OLD.origin;
    NEW.source_name := OLD.source_name;
    NEW.source_id := OLD.source_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_outage_columns_trigger ON outages;
CREATE TRIGGER guard_outage_columns_trigger
  BEFORE INSERT OR UPDATE ON outages
  FOR EACH ROW
  EXECUTE FUNCTION guard_outage_columns();

-- ============================================================================
-- 3. RATE LIMIT: SERIALIZE PER BUCKET
-- ============================================================================

CREATE OR REPLACE FUNCTION consume_rate_limit(
  bucket_key TEXT,
  max_hits INTEGER,
  window_seconds INTEGER
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMP WITH TIME ZONE := NOW() - make_interval(secs => window_seconds);
  hits INTEGER;
  oldest TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Held until the transaction ends, so concurrent calls on one bucket count
  -- and insert one at a time.
  PERFORM pg_advisory_xact_lock(hashtext(bucket_key));

  DELETE FROM rate_limit_events
  WHERE bucket = bucket_key AND occurred_at < cutoff;

  SELECT count(*), min(occurred_at)
  INTO hits, oldest
  FROM rate_limit_events
  WHERE bucket = bucket_key AND occurred_at >= cutoff;

  IF hits >= max_hits THEN
    RETURN QUERY SELECT
      FALSE,
      0,
      GREATEST(
        1,
        CEIL(
          EXTRACT(
            EPOCH FROM (oldest + make_interval(secs => window_seconds)) - NOW()
          )
        )::INTEGER
      );
    RETURN;
  END IF;

  INSERT INTO rate_limit_events (bucket) VALUES (bucket_key);

  RETURN QUERY SELECT TRUE, max_hits - hits - 1, 0;
END;
$$;

-- ============================================================================
-- 4. NO CLIENT-SIDE PROVIDER INSERTS
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can suggest providers" ON providers;

INSERT INTO schema_version (version, description) VALUES
  ('008', 'Owner-run verification/resolution triggers, outage column guard, locked rate limit')
ON CONFLICT DO NOTHING;
