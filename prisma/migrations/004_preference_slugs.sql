-- Outage Tracker - Migration 004
--
-- saved_providers stored UUIDs, but the app addresses providers by slug
-- everywhere else (002 introduced slugs; the filter store, the API and the
-- client all speak them). Saving a filter therefore failed with
-- "invalid input syntax for type uuid: coned".
--
-- Slugs win: they are stable, readable, and already what the client persists to
-- localStorage, so a preference set survives a database rebuild.
--
-- Done as add / backfill / swap rather than ALTER TYPE ... USING, because a
-- USING transform may not contain a subquery and the translation needs to look
-- up each id in providers.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS saved_provider_slugs TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Translate any existing rows rather than dropping someone's saved filters.
UPDATE user_preferences up
SET saved_provider_slugs = COALESCE(
  (
    SELECT array_agg(p.slug ORDER BY p.slug)
    FROM providers p
    WHERE p.id = ANY(up.saved_providers)
  ),
  ARRAY[]::TEXT[]
);

ALTER TABLE user_preferences DROP COLUMN saved_providers;
ALTER TABLE user_preferences RENAME COLUMN saved_provider_slugs TO saved_providers;

INSERT INTO schema_version (version, description) VALUES
  ('004', 'saved_providers stores provider slugs rather than UUIDs')
ON CONFLICT DO NOTHING;
