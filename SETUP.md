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

Both are idempotent, so re-running them is safe.

### 4. Restart and check

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

- **Rate limiting is per-process.** [`lib/rate-limit.ts`](lib/rate-limit.ts)
  holds counters in memory, so behind several instances the effective limit is
  multiplied by the instance count. Move the store to Redis or Postgres before
  that matters.
- **Push subscriptions are per-process** for the same reason.

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
