-- Outage Tracker - Migration 005
--
-- Durable rate limiting.
--
-- lib/rate-limit.ts keeps counters in process memory, which on serverless means
-- each instance enforces its own limit: the effective cap is the configured one
-- multiplied by however many instances happen to be warm. That is fine as a
-- courtesy throttle and useless as an abuse control.
--
-- It matters more here than it normally would. Anonymous sign-in requires
-- CAPTCHA to be off (a server-side sign-in cannot solve a challenge), so
-- Supabase's own defence against scripted sign-up floods is not available, and
-- a bot can mint a fresh identity per request. Limiting per client address is
-- what is left.

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  -- Opaque key, e.g. "outage:create:ip:<sha256>". Addresses are hashed before
  -- they get here: the app never needs to read one back, and PRD section 6.3
  -- asks for minimal personal data.
  bucket TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_time
  ON rate_limit_events (bucket, occurred_at DESC);

-- Nothing should touch this table directly; consume_rate_limit is the only
-- interface, and it is SECURITY DEFINER so it can write while the table stays
-- closed to the anon and authenticated roles.
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE rate_limit_events_id_seq FROM anon, authenticated;

/**
 * Record one hit against a bucket and report whether it was allowed.
 *
 * Fixed window over the trailing `window_seconds`. Returns retry_after as the
 * seconds until the oldest hit in the window ages out, so a caller that is
 * blocked is told when to come back rather than guessing.
 */
CREATE OR REPLACE FUNCTION consume_rate_limit(
  bucket_key TEXT,
  max_hits INTEGER,
  window_seconds INTEGER
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER runs as the owner, so pin the schema search path rather
-- than inheriting the caller's.
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMP WITH TIME ZONE := NOW() - make_interval(secs => window_seconds);
  hits INTEGER;
  oldest TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Expired rows for this bucket only: cheap, and keeps the table from growing
  -- without needing a scheduled job.
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

GRANT EXECUTE ON FUNCTION consume_rate_limit(TEXT, INTEGER, INTEGER)
  TO anon, authenticated;

INSERT INTO schema_version (version, description) VALUES
  ('005', 'Durable per-bucket rate limiting shared across instances')
ON CONFLICT DO NOTHING;
