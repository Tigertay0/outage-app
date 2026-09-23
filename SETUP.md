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
6. [`prisma/migrations/006_official_sources.sql`](prisma/migrations/006_official_sources.sql)
   — outage provenance and the weather-advisory layer.
7. [`prisma/migrations/007_push_subscriptions.sql`](prisma/migrations/007_push_subscriptions.sql)
   — push subscriptions stored and matched in Postgres.
8. [`prisma/migrations/008_trigger_privileges_and_guards.sql`](prisma/migrations/008_trigger_privileges_and_guards.sql)
   — confirmations and resolution votes from other users actually update the
   outage, server-owned outage columns are locked, rate limits are race-free.
9. [`prisma/migrations/009_official_outage_sync.sql`](prisma/migrations/009_official_outage_sync.sql)
   — atomic snapshot sync for official feeds, plus the utility's own name and
   customer count in search results.

All nine are idempotent, so re-running them is safe.

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

### 5. Configure SMTP before anyone else signs up

**Authentication → Emails → SMTP Settings.**

Accounts are created by confirming an email address, so every signup depends on
Supabase being able to send one. The built-in sender exists for development and
is capped at a couple of messages per hour across the whole project — past that,
signups fail with:

```
email rate limit exceeded
```

The app surfaces that message rather than swallowing it, but there is nothing it
can do about the cause. Point the project at your own SMTP provider (Resend,
Postmark, SES, anything) before real users arrive.

**Also set the redirect allow list** under **Authentication → URL Configuration**
so confirmation links come back to the app: add your deployed origin, and
`http://localhost:3000` for development. Links land on
[`/auth/callback`](app/auth/callback/route.ts), which exchanges the code for a
session and redirects to the map either way — a bad or expired link produces a
message, not an error page.

If you would rather skip email entirely while testing, turn on
**Confirm email → off** in the same section. Accounts then work immediately, and
anyone can claim any address, so do not leave it that way.

### 6. Restart and check

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

Put the pair in `.env.local` and in the host's environment:

```bash
VAPID_PUBLIC_KEY=BN...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=https://github.com/you/your-repo
```

`VAPID_SUBJECT` is sent to the browser vendors' push services as a way to
contact the operator. It may be a `mailto:` or an `https:` URL; use one you
control. The private key is a secret.

Without these, the Alerts section of Settings explains that push is unavailable
rather than showing a switch that cannot work. Against Supabase, push also needs
`SUPABASE_SERVICE_ROLE_KEY`: subscriptions are stored and matched with it, since
the fan-out has to read every subscriber and RLS rightly forbids that to a user.

How it works (migration 007):

- Subscriptions are rows in `push_subscriptions`, one per browser endpoint, with
  the alert settings, a centre point and the browser's IANA time zone.
- `push_targets()` does the matching in SQL — within radius, at or above the
  severity threshold, excluding whoever filed the report. Execute is revoked
  from everyone but the service role, because it returns subscriber keys.
- Quiet hours are checked in the subscriber's own time zone.
- Fan-out runs in `after()` so serverless does not freeze it mid-list.
- Endpoints the push service reports as gone (404/410) are deleted.

The service worker only registers in production builds, so test with
`npm run build && npm start`.

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

To check a deployment without holding the secret:

```bash
curl -I https://your-app/api/ingest
```

`x-ingest-writable: false` means `SUPABASE_SERVICE_ROLE_KEY` is missing or
blank. A blank value is the likely case and is falsy, so the feature looks
configured while writing nothing.

### What it currently pulls

**National Weather Service** — free, no key, good US coverage. Filtered to the
event types that take out power, internet or phones: wind, ice, thunderstorm,
tornado, hurricane, fire, and flooding. Flooding is included in full rather than
flash events alone, because substations and street cabinets sit at grade — and
on a quiet weather day flood warnings are often the only relevant US alerts
active at all. That keeps roughly 25–35 of the 215–245 alerts live at any
moment. Alerts carrying a polygon are placed directly; the rest name NWS
forecast zones, which are resolved to a centroid and cached.

These land in `advisories`, **not** `outages`. A storm warning is a reason to
expect an outage, not evidence of one, and filing it as an outage would put
events on the map nobody has lost service to. The map shows them as a separate,
toggleable layer.

**ODIN** (Outage Data Initiative Nationwide, DOE / Oak Ridge National
Laboratory) — free, no key, the actual power outages. Utilities publish
near-real-time customer counts by county in a common format; about 90 of them
across 30-odd states were reporting when this was added, refreshed hourly. The
bulk export is fetched rather than the paged endpoint, because a sync resolves
whatever is missing from the snapshot and a truncated page would wrongly close
live outages. Rows are aggregated per utility per county, and single-customer
incidents are dropped (see `ODIN_MIN_CUSTOMERS`) — at county granularity one
household is its own service line, not something a neighbour can confirm.

**IODA** (Internet Outage Detection and Analysis, Georgia Tech) — free, no key,
internet rather than power. It compares BGP routing, active probing and Google
traffic against each region's own history, so it detects a *region* losing
connectivity and says nothing about one ISP on one street. Two consequences
worth knowing before you judge the layer broken:

- **It is usually empty in the US.** A dense, redundant network rarely drops a
  whole state. Roughly two qualifying events a day nationwide, and quiet weeks
  are normal.
- **Its "critical" is not our "outage".** The level is relative to that region's
  own baseline and fires on drops far too small to matter — in a sample month of
  US alerts, nine sat at 80–99% of normal, including Indiana at 98.8%. Only
  alerts at or below `MAX_NORMAL_RATIO` (50% of normal) are published; the
  remaining 63 of 75 in that sample were genuine collapses, mostly under 20%.

Region-level rows are placed at the state centroid in
[`lib/ingest/us-regions.ts`](lib/ingest/us-regions.ts), since IODA carries no
geometry of its own.

**Cloudflare Radar** — internet again, and the only feed here that says *why*.
Cloudflare publishes the outages it observes as curated annotations carrying a
cause: cable cut, power outage, government action, maintenance. It complements
IODA rather than replacing it — IODA infers an outage from measurements within
minutes, Radar describes it once a human has characterised it.

This one needs a free token, and is skipped entirely without it:

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
2. **Create Token → Create Custom Token.**
3. Permissions: **Account → Radar → Read**. Nothing else is needed.
4. Put it in `.env.local` and in the host's environment:

   ```bash
   CLOUDFLARE_RADAR_TOKEN=...
   ```

Radar names places rather than giving coordinates, so a US annotation is drawn
at the first state its scope or description names, and a genuinely nationwide
event is drawn at the centre of the country with a description that says so.
Only annotations with no end date are published: Radar closes one when the
outage recovers, which is what lets the sync resolve the row automatically.

### What it does not pull

Street-level detail, and the utilities that stay out of ODIN. PowerOutage.us
aggregates every US utility and charges for it; the DOE's EAGLE-I is bulk
historical. Individual utility outage maps have undocumented JSON endpoints, but
scraping them is fragile and generally against their terms. For internet, the
per-ISP "is Comcast down in my neighbourhood" signal is sold commercially
(Downdetector and similar) and has no free equivalent — IODA answers a coarser
question, and crowdsourced reports cover the rest.

`lib/ingest/source.ts` defines the interface a feed implements, and
`lib/ingest/run.ts` holds the registry — adding a paid source means writing an
adapter and listing it, with nothing above the data layer changing. An
`IngestedOutage` goes into `outages` with `origin = 'official'`, deduplicated
on `(source_name, source_id)`, and rows the feed stops reporting are resolved
automatically.

`lib/ingest/run.ts` runs every source on the same schedule, and one failing feed
never stops the others: a source that throws is reported in the response and its
existing rows are left alone, rather than being resolved as though the outages
had ended.

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
