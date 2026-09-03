# Outage Tracker

Power, internet and cellular outages on one live map. Report what is down where
you are, confirm what other people report, and find out whether the problem is
your router or your whole street.

The product spec lives in [PRD/outage_tracker_prd.md](PRD/outage_tracker_prd.md).

## Run it

```bash
npm install
npm run dev
```

That is the whole setup. With no configuration the app runs against a seeded
in-process store and a no-token basemap, so every feature — map, clustering,
filters, reporting, confirming, comments, timeline, search — works immediately.
A banner makes it clear the outages you see are demo data.

To connect a real database and enable accounts and push notifications, see
[SETUP.md](SETUP.md) and copy [.env.example](.env.example) to `.env.local`.

## What is built

| Feature | Where |
| --- | --- |
| Zoom-based clustering, severity colouring, verification state | `components/map/` |
| Service, provider and severity filters, persisted per browser | `components/filters/`, `lib/store/filters.ts` |
| Three-step outage report with map-centre pin and reverse geocoding | `components/report/` |
| Confirm, comment, "it's back", derived timeline | `components/outage/` |
| Address / ZIP / city search with autocomplete | `components/search/`, `app/api/geocode/` |
| Distance-sorted list of what is in view | `components/layout/nearby-panel.tsx` |
| Alerts, quiet hours, saved places | `components/layout/settings-sheet.tsx` |
| Web Push fan-out on new reports | `lib/push.ts`, `public/sw.js` |
| Public-feed ingestion, on a schedule | `lib/ingest/`, `app/api/ingest/` |
| Storm-warning layer from the National Weather Service | `components/outage/advisory-sheet.tsx` |

## How it is put together

**Two interchangeable backends.** Everything above the data layer talks to the
`Repository` interface in `lib/data/repository.ts`. `getRepository()` returns the
Supabase/PostGIS implementation when the environment is configured and a seeded
in-memory one otherwise. Nothing else in the app knows which it got, which is
why a fresh clone runs without an account anywhere.

**MapLibre, not Mapbox.** `react-map-gl` supports both. MapLibre with
OpenFreeMap tiles needs no access token and has no request quota, so the map is
not a billing relationship or a signup wall. Point
`NEXT_PUBLIC_MAP_STYLE_URL` at any MapLibre-compatible style — including a
Mapbox one — to change it.

**Guests are first-class.** An unrecognised visitor gets a random id in an
httpOnly cookie. That is enough to enforce one confirmation per person and to
attribute comments, so reporting works before anyone signs up — which matters
for an app whose data comes entirely from its users. Signing in with Supabase
Auth upgrades the same actions to a durable account.

**Filters and viewport are pushed into SQL.** The map queries
`search_outages` (migration 002) with the viewport bounding box and every active
filter, so panning fetches only what is on screen rather than filtering a full
table client-side.

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run icons      # regenerate the PWA icon set
```

**Two kinds of data, kept apart.** Reports come from people; a separate
ingestion layer polls public feeds every fifteen minutes. Anything ingested is
marked `origin: 'official'` and badged in the UI, because a confirmation count
means something different for a neighbour's report than for a utility's feed.
Weather warnings go further and live in their own table — a storm is a reason to
expect an outage, not evidence of one.

## Not built yet

- Sign-in and sign-up screens. The Supabase Auth session is read everywhere it
  matters, but there is no UI to create one yet — guests can do everything
  except sync across devices.
- Live power-outage data. No free feed exists — PowerOutage.us aggregates every
  US utility and charges for it. `lib/ingest/source.ts` is the interface a paid
  source would implement; nothing above the data layer would change.
- The analytics, heatmap and history views (PRD 4.10–4.12).
- Automated tests.
- Push subscriptions are held in server memory, so they do not survive a restart
  or span multiple instances. The `push_subscriptions` table is already in the
  schema for this.
