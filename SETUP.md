# Setup

## Nothing to set up

```bash
npm install
npm run dev
```

The app runs. No accounts, no API keys, no database.

That is deliberate. `getRepository()` in [lib/data/index.ts](lib/data/index.ts)
returns a seeded in-process store when Supabase is not configured, and the map
uses MapLibre with OpenFreeMap tiles, which need no token. Every feature works
against demo data, and a banner says so.

Everything below is optional, and each part can be added on its own.

---

## Real data: Supabase + PostGIS

Adds durability, real accounts, and shared data across everyone using the app.

### 1. Create the project

1. Create a project at [supabase.com](https://supabase.com). The free tier is
   enough.
2. **Project Settings → API** gives you three values.
3. Copy `.env.example` to `.env.local` and fill in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```

   The service-role key bypasses Row Level Security. Keep it server-side and
   never give it a `NEXT_PUBLIC_` prefix.

### 2. Enable PostGIS

**Database → Extensions**, search `postgis`, enable it. Outage locations are
`GEOGRAPHY(POINT, 4326)` and viewport queries use a GIST index, so nothing works
without it.

### 3. Run the migrations, in order

**SQL Editor → New Query**, then paste and run each file:

1. [`prisma/migrations/001_initial_schema.sql`](prisma/migrations/001_initial_schema.sql)
   — tables, indexes, RLS policies, triggers, seed providers.
2. [`prisma/migrations/002_search_and_fixes.sql`](prisma/migrations/002_search_and_fixes.sql)
   — the `search_outages` RPC the map actually calls, provider slugs, resolution
   votes, and a fix so withdrawing a confirmation decrements the count.
3. [`prisma/migrations/003_align_providers.sql`](prisma/migrations/003_align_providers.sql)
   — makes the database's provider list match `lib/data/seed.ts`.
4. [`prisma/migrations/004_preference_slugs.sql`](prisma/migrations/004_preference_slugs.sql)
   — `saved_providers` holds slugs, not UUIDs.
5. [`prisma/migrations/005_rate_limits.sql`](prisma/migrations/005_rate_limits.sql)
   — rate limiting that holds across serverless instances.

All five are idempotent, so re-running them is safe.

### 4. Enable anonymous sign-ins

**Authentication → Sign In / Providers → Anonymous sign-ins → on.**

This is not optional. `outages.reported_by` is a UUID with a foreign key to
`auth.users`, and every RLS policy tests `auth.role() = 'authenticated'` and
`auth.uid()`. A visitor without an account needs a real auth row to satisfy any
of that, so `lib/identity.ts` signs guests in anonymously. Without this,
browsing works and every write fails.

Anonymous users can later be upgraded to permanent accounts without losing the
reports and confirmations attached to them.

**Also turn CAPTCHA off** under **Authentication → Attack Protection**, if it is
on. The sign-in happens server-side in a Route Handler, where there is no
browser to solve a challenge — CAPTCHA and anonymous guests cannot both be
enabled with this design. The error is
`captcha protection: request disallowed (no captcha_token found)`.

That does remove Supabase's own defence against scripted sign-up floods, which
is why migration 005 adds a per-client-address limit in Postgres on top of the
per-identity one — a caller who can mint identities at will is still bounded by
where they are calling from. Client addresses are hashed before they are stored;
set `RATE_LIMIT_SALT` to something private so those hashes are not guessable.

### 5. Restart and check

```bash
npm run dev
```

The demo-data banner should be gone. `GET /api/session` reports which backend is
live:

```json
{ "capabilities": { "accounts": true, "push": false, "demoData": false } }
```

If `demoData` is still `true`, the URL or anon key is missing or still a
placeholder.

### Regenerating database types

`lib/supabase/database.types.ts` is hand-maintained. If you change the schema:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/supabase/database.types.ts
```

Note that every table needs a `Relationships` key and the schema needs
`CompositeTypes` for supabase-js to type queries at all — without them the
client silently falls back to untyped results and `rpc()` calls stop being
checked. The generator emits both; a hand-written file must not omit them.

---

## Push notifications

```bash
npx web-push generate-vapid-keys
```

Put the pair in `.env.local`:

```bash
VAPID_PUBLIC_KEY=BN...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Without these, the Alerts section of Settings explains that push is unavailable
rather than showing a switch that cannot work.

Two caveats:

- The service worker only registers in production builds, so test with
  `npm run build && npm start`.
- Subscriptions live in server memory (`lib/push.ts`), so they are lost on
  restart and are not shared between instances. The `push_subscriptions` table
  already exists for moving them into Postgres.

---

## Public-data ingestion

The map is not only crowdsourced: `/api/ingest` polls public feeds and writes
what they return.

```bash
CRON_SECRET=$(openssl rand -base64 32)
```

Put that in `.env.local` and in the host's environment. It is required — the
route refuses to run without it rather than defaulting to open, because it
writes with the service-role key. `SUPABASE_SERVICE_ROLE_KEY` must also be set,
since ingested rows have no `reported_by` and every RLS write policy is
expressed in terms of `auth.uid()`.

On Vercel, [`vercel.json`](vercel.json) schedules it and the platform sends the
secret automatically. The schedule is **daily**, because the Hobby plan rejects
anything more frequent — a deployment with `*/15 * * * *` fails to build. Daily
is useless on its own for warnings that expire in hours, so `/api/advisories`
also kicks off a run in the background whenever the data it is about to serve is
more than twenty minutes old. Real visitors therefore keep the layer fresh, and
the cron is only a floor.

On a paid plan, change the schedule to `*/15 * * * *`; the lazy path then
almost never fires.

Elsewhere, call it yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/ingest
```

### What it currently pulls

**National Weather Service** — free, no key, good US coverage. Filtered to the
event types that take out power, internet or phones (wind, ice, thunderstorm,
tornado, hurricane, fire, flood), which is roughly 25 of the ~215 alerts active
at any moment. Alerts carrying a polygon are placed directly; the rest name NWS
forecast zones, which are resolved to a centroid and cached.

These land in `advisories`, **not** `outages`. A storm warning is a reason to
expect an outage, not evidence of one, and filing it as an outage would put
events on the map nobody has lost service to. The map shows them as a separate,
toggleable layer.

### What it does not pull

There is no free live feed of US power outages. PowerOutage.us aggregates every
utility and charges for it; the DOE's EAGLE-I is bulk historical. Individual
utility outage maps have undocumented JSON endpoints, but scraping them is
fragile and generally against their terms.

`lib/ingest/source.ts` defines the interface a feed implements, and
`lib/ingest/run.ts` holds the registry — adding a paid source means writing an
adapter and listing it, with nothing above the data layer changing. An
`IngestedOutage` goes into `outages` with `origin = 'official'`, deduplicated
on `(source_name, source_id)`, and rows the feed stops reporting are resolved
automatically.

IODA (Georgia Tech) was evaluated and rejected: it is free and genuinely good,
but it detects country-scale internet blackouts. It had zero US alerts over a
24-hour sample.

---

## Basemap

Defaults to [OpenFreeMap](https://openfreemap.org) — no account, no quota. To
use something else, set a MapLibre-compatible style URL:

```bash
NEXT_PUBLIC_MAP_STYLE_URL=https://api.maptiler.com/maps/streets/style.json?key=...
NEXT_PUBLIC_MAP_STYLE_URL_DARK=...
```

If the tile host cannot be reached the map falls back to a blank canvas and
every marker, cluster and interaction still works.

---

## Geocoding

Search and reverse-geocoding proxy through
[`app/api/geocode/route.ts`](app/api/geocode/route.ts) to Nominatim. It is
proxied rather than called from the browser because Nominatim requires an
identifying `User-Agent`, its usage policy caps request rate per source, and
keeping it server-side means a typed address never leaves in a third-party
request carrying the user's referrer.

The public instance is fine for development. Before real traffic, point at a
self-hosted instance or a commercial geocoder:

```bash
NOMINATIM_BASE_URL=https://nominatim.example.com
GEOCODER_USER_AGENT="YourApp/1.0 (contact@example.com)"
GEOCODER_COUNTRY_CODES=us
```

---

## Icons

App icons are generated, not checked in by hand:

```bash
npm run icons
```

[`scripts/generate-icons.mjs`](scripts/generate-icons.mjs) writes the full PWA
set plus `apple-touch-icon.png`. Edit `BRAND` or the `BOLT` polygon in that file
and re-run to change the mark.

---

## Deploying

Any Node host works; Vercel needs no extra configuration. Set the same
environment variables in the host's dashboard.

Two things to know before carrying real traffic:

- **Set `RATE_LIMIT_SALT`.** Rate limiting is durable in Postgres once Supabase
  is configured (migration 005), but the address hashes are only unguessable if
  the salt is private.
- **Push subscriptions are still per-process.** `lib/push.ts` holds them in
  memory, so they are lost on restart and not shared between instances. The
  `push_subscriptions` table already exists for moving them into Postgres.

---

## Troubleshooting

**Every API route under `/api/outages/[id]/…` returns Next's HTML 404 page.**
A stale Turbopack dev cache. Stop the dev server, `rm -rf .next`, restart. Our
own 404s return JSON with an `error` field — an HTML body means the route was
never registered.

**Map is blank but markers and the list work.** The tile host is unreachable and
the fallback style is active. Check `NEXT_PUBLIC_MAP_STYLE_URL` or your network.

**`listOutages: function search_outages does not exist`.** Migration 002 has not
been run.

**Tailwind classes have no effect.** The project is on Tailwind v4, which reads
its theme from `@theme` in [`app/globals.css`](app/globals.css), not from a
`tailwind.config.ts`. Add tokens there.
