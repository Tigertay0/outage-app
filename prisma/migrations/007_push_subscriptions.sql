-- Outage Tracker - Migration 007
--
-- Push subscriptions move from server memory into Postgres.
--
-- lib/push.ts kept them in a Map on the server process. On serverless that
-- means every cold start forgot every subscriber, and each warm instance knew
-- only about the browsers that happened to subscribe through it — so an outage
-- reported via instance A never reached a subscriber registered on instance B.
-- In practice alerts were close to never delivered.
--
-- The table has existed since 001; this adds what matching needs.

ALTER TABLE push_subscriptions
  -- The NotificationSettings object as the client sent it: enabled,
  -- severityThreshold, radiusMiles, quietHoursStart, quietHoursEnd.
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Where the subscriber wants to hear about. Radius matching is done here in
  -- SQL rather than by loading every subscriber into the function.
  ADD COLUMN IF NOT EXISTS center GEOGRAPHY(POINT, 4326),
  -- IANA zone from the browser. Quiet hours are wall-clock times ("22:00"), and
  -- comparing them against the server's clock — UTC on Vercel — silenced the
  -- wrong hours for everyone not in UTC.
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_center
  ON push_subscriptions USING GIST(center);

-- An endpoint is one browser. 001 made it unique per user, which let the same
-- browser hold two rows after signing in to a different account, and receive
-- every alert twice. Keep the newest row per endpoint, then enforce it.
DELETE FROM push_subscriptions p
USING push_subscriptions q
WHERE p.endpoint = q.endpoint
  AND p.created_at < q.created_at;

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

/**
 * Subscribers who should hear about an outage at this point and severity.
 *
 * Returns endpoints and encryption keys, so it must never be callable from a
 * browser: execute is revoked from everyone and only the service role — which
 * the server-side fan-out uses — can run it. Postgres grants EXECUTE on new
 * functions to PUBLIC by default, hence the explicit revoke.
 *
 * Quiet hours are not applied here; they depend on each subscriber's own time
 * zone and are checked in lib/push.ts.
 *
 * `exclude_user` is the reporter. Without it, whoever files a report is always
 * inside their own radius and gets pushed about the outage they just typed in.
 */
DROP FUNCTION IF EXISTS push_targets(DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION push_targets(
  outage_lat DOUBLE PRECISION,
  outage_lng DOUBLE PRECISION,
  outage_severity TEXT,
  exclude_user UUID DEFAULT NULL
)
RETURNS TABLE (
  endpoint TEXT,
  keys JSONB,
  settings JSONB,
  timezone TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH severity_rank(name, rank) AS (
    VALUES ('intermittent', 1), ('degraded', 2), ('complete', 3)
  )
  SELECT s.endpoint, s.keys, s.settings, s.timezone
  FROM push_subscriptions s
  WHERE COALESCE((s.settings->>'enabled')::BOOLEAN, FALSE)
    AND (exclude_user IS NULL OR s.user_id <> exclude_user)
    AND s.center IS NOT NULL
    AND ST_DWithin(
      s.center,
      ST_SetSRID(ST_MakePoint(outage_lng, outage_lat), 4326)::geography,
      COALESCE((s.settings->>'radiusMiles')::DOUBLE PRECISION, 5) * 1609.344
    )
    AND (SELECT rank FROM severity_rank WHERE name = outage_severity)
        >= COALESCE(
             (SELECT rank FROM severity_rank
              WHERE name = s.settings->>'severityThreshold'),
             3
           )
  -- A ceiling on recipients per report, nearest first. Subscription creation is
  -- rate limited, but nothing else bounded how many sends one report could
  -- trigger inside a single serverless invocation.
  ORDER BY ST_Distance(
    s.center,
    ST_SetSRID(ST_MakePoint(outage_lng, outage_lat), 4326)::geography
  )
  LIMIT 500;
$;

REVOKE ALL ON FUNCTION push_targets(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

INSERT INTO schema_version (version, description) VALUES
  ('007', 'Push subscriptions persisted with location, settings and time zone')
ON CONFLICT DO NOTHING;
