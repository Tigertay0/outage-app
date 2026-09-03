-- Outage Tracker - Migration 003
--
-- Align the database's provider list with lib/data/seed.ts.
--
-- 001 seeded 16 providers whose slugs 002 derived from their names. That left
-- the two backends disagreeing: the local store offers named power utilities
-- (Con Edison, PG&E, Duke, Oncor, FPL) and the "other" category, while the
-- database offered only a generic "Local Power Company" and "Electric Utility"
-- and no "other" providers at all.
--
-- The practical effect was that a report naming a provider the database had
-- never heard of had its provider silently dropped — the report survived with
-- no attribution, which is most of its value gone. lib/data/supabase-repo.ts
-- now rejects an unknown slug outright; this migration makes sure the slugs the
-- app actually offers exist.

-- Slug is the identifier the app uses, so set it explicitly rather than
-- deriving it from a display name that may change.
INSERT INTO providers (name, service_type, slug) VALUES
  ('Con Edison',             'power', 'coned'),
  ('PG&E',                   'power', 'pge'),
  ('Duke Energy',            'power', 'duke'),
  ('Oncor',                  'power', 'oncor'),
  ('Florida Power & Light',  'power', 'fpl'),
  ('Local power company',    'power', 'local-power'),
  ('Municipal water',        'other', 'water'),
  ('VoIP provider',          'other', 'voip')
ON CONFLICT (slug) DO NOTHING;

-- The two placeholders 001 created are superseded by 'local-power'. Keep any
-- outage that already points at them by repointing it first.
UPDATE outages
SET provider_id = (SELECT id FROM providers WHERE slug = 'local-power')
WHERE provider_id IN (
  SELECT id FROM providers WHERE slug IN ('local-power-company', 'electric-utility')
);

DELETE FROM providers WHERE slug IN ('local-power-company', 'electric-utility');

-- 001 named this one "Comcast/Xfinity"; the app displays "Comcast / Xfinity".
-- The slug is unchanged, so this is cosmetic only.
UPDATE providers SET name = 'Comcast / Xfinity' WHERE slug = 'xfinity';

INSERT INTO schema_version (version, description) VALUES
  ('003', 'Align provider list and slugs with lib/data/seed.ts')
ON CONFLICT DO NOTHING;
