-- Outage Tracker - Migration 010
--
-- Hardening found by a security review and Supabase's own database linter.
-- No behaviour changes for a well-behaved client; every change closes a path
-- that only a direct PostgREST caller with the publishable key could take.
--
--   1. Rate-limit buckets stop being spendable by the people they limit.
--   2. Trigger functions stop being callable as RPCs.
--   3. Every remaining function gets a pinned search_path.
--   4. schema_version stops being world-readable through the API.

-- ============================================================================
-- 1. RATE LIMITING IS THE SERVER'S JOB
-- ============================================================================

-- consume_rate_limit takes the bucket key as an argument, and until now anon
-- and authenticated could call it directly. Knowing or guessing another
-- caller's bucket — they are derived from an identity id or a hashed address —
-- was enough to spend their allowance and lock them out of reporting, without
-- touching their account. The server now calls this as the service role
-- (lib/rate-limit.ts), so nobody else needs to.
REVOKE ALL ON FUNCTION consume_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. TRIGGER FUNCTIONS ARE NOT AN API
-- ============================================================================

-- These run as the table owner on INSERT/DELETE of a vote. PostgREST exposes
-- every function in the public schema, so both were also reachable at
-- /rest/v1/rpc/... by anyone with the publishable key. Called outside a trigger
-- they error rather than do damage, but a SECURITY DEFINER function that no
-- client is meant to call should not be callable by one.
REVOKE ALL ON FUNCTION update_outage_verification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_resolution_votes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. PIN search_path ON THE REMAINING FUNCTIONS
-- ============================================================================

-- A function without a pinned search_path resolves unqualified names using the
-- caller's, so anything that can create a type or function in an earlier schema
-- can change what the body means. The newer functions already set this; these
-- are the ones written before that was the house rule.
--
-- ALTER ... SET is used rather than rewriting each body: the definitions are
-- unchanged, and restating them here would mean two copies to keep in step.
ALTER FUNCTION search_outages(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT[], TEXT[], TEXT[], INTEGER, INTEGER, UUID[]
) SET search_path = public, pg_temp;

ALTER FUNCTION search_advisories(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) SET search_path = public, pg_temp;

ALTER FUNCTION prune_expired_advisories() SET search_path = public, pg_temp;
ALTER FUNCTION update_updated_at_column() SET search_path = public, pg_temp;

-- Written in 001/002 and superseded by search_outages, but still present and
-- still callable, so they are pinned rather than left as the weakest link.
-- Found by name and altered by their real identity, rather than by a signature
-- written out here: these predate the current schema, exist in some databases
-- and not others, and naming an argument list that does not match is an error
-- that fails the whole migration.
DO $$
DECLARE
  target regprocedure;
BEGIN
  FOR target IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'recent_report_count',
        'find_outages_in_bounds',
        'find_outages_within_radius'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', target);
  END LOOP;
END;
$$;

-- ============================================================================
-- 4. schema_version IS OPERATIONAL DATA
-- ============================================================================

-- It lists which migrations have run, which tells an attacker exactly which
-- fixes a deployment does and does not have. Nothing in the app reads it at
-- runtime; migrations write it as the owner, and the service role bypasses RLS,
-- so enabling RLS with no policy closes it to the API without breaking anything.
ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_version (version, description) VALUES
  ('010', 'Server-only rate limiting, non-callable triggers, pinned search_path')
ON CONFLICT DO NOTHING;
