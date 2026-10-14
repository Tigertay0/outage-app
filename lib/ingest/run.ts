import "server-only";
import { isSupabaseConfigured } from "@/lib/data";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { CloudflareRadarSource } from "./cloudflare-radar";
import { IodaSource } from "./ioda";
import { NwsSource } from "./nws";
import { OdinSource } from "./odin";
import type { IngestedAdvisory, IngestedOutage, OutageSource } from "./source";

/**
 * Ingestion runner.
 *
 * Writes with the service-role client, which bypasses RLS. That is necessary
 * rather than convenient: ingested rows have no `reported_by`, and every write
 * policy on `outages` is written in terms of `auth.uid()`. The route that calls
 * this is the only thing holding that key, and it is behind a shared secret.
 *
 * Each source is isolated — one feed being down or changing shape must not stop
 * the others — and every upsert is keyed on (source_name, source_id) so a poll
 * every few minutes updates in place instead of duplicating.
 */

const SOURCES: OutageSource[] = [
  new NwsSource(),
  new OdinSource(),
  new IodaSource(),
  new CloudflareRadarSource(),
];

export interface SourceReport {
  source: string;
  ok: boolean;
  outages: number;
  advisories: number;
  /** The feed's page may have been cut off, so nothing was resolved for it. */
  truncated?: boolean;
  error?: string;
}

export interface IngestReport {
  ran: string;
  sources: SourceReport[];
  advisoriesPruned: number;
  outagesResolved: number;
}

async function upsertAdvisories(
  client: ReturnType<typeof createServiceRoleClient>,
  sourceName: string,
  advisories: IngestedAdvisory[],
): Promise<void> {
  if (advisories.length === 0) return;

  const rows = advisories.map((a) => ({
    source_name: sourceName,
    source_id: a.sourceId,
    kind: a.kind,
    severity: a.severity,
    headline: a.headline,
    description: a.description,
    area_description: a.areaDescription,
    url: a.url,
    location: `SRID=4326;POINT(${a.longitude} ${a.latitude})`,
    starts_at: a.startsAt,
    ends_at: a.endsAt,
  }));

  const { error } = await client
    .from("advisories")
    .upsert(rows as never, { onConflict: "source_name,source_id" });

  if (error) throw new Error(`advisories upsert: ${error.message}`);
}

type FeedRow = {
  source_id: string;
  service_type: IngestedOutage["serviceType"];
  severity: IngestedOutage["severity"];
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  description: string | null;
  estimated_restoration: string | null;
  reported_at: string | null;
  metadata: Json;
};

/**
 * Longitude/latitude of a stored point. PostgREST returns PostGIS geography as
 * hex EWKB; GeoJSON is accepted too. Null for anything that is not a point.
 */
export function pointFromGeography(value: unknown): { lat: number; lng: number } | null {
  if (value && typeof value === "object") {
    const geo = value as { type?: unknown; coordinates?: unknown };
    if (geo.type !== "Point" || !Array.isArray(geo.coordinates)) return null;
    const [lng, lat] = geo.coordinates as unknown[];
    return typeof lng === "number" && typeof lat === "number" ? { lat, lng } : null;
  }
  if (typeof value !== "string" || !/^([0-9a-f]{2})+$/i.test(value)) return null;
  const bytes = Buffer.from(value, "hex");
  if (bytes.length < 21) return null;
  const little = bytes[0] === 1;
  const type = little ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  if ((type & 0xffff) !== 1) return null; // not a 2D point
  const offset = type & 0x20000000 ? 9 : 5; // skip the SRID when present
  if (bytes.length < offset + 16) return null;
  const lng = little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
  const lat = little ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * This source's active outages that are missing from `seen`, as feed rows
 * carrying their stored values unchanged — so passing them back through the
 * sync keeps them open without altering them.
 *
 * Throws rather than return a partial list: any row left out would be resolved.
 */
async function activeRowsNotIn(
  client: ReturnType<typeof createServiceRoleClient>,
  sourceName: string,
  seen: Set<string>,
): Promise<FeedRow[]> {
  const { data, error, count } = await client
    .from("outages")
    .select(
      "source_id, service_type, severity, location, city, state, description, estimated_restoration, reported_at, metadata",
      { count: "exact" },
    )
    .eq("source_name", sourceName)
    .eq("status", "active");

  if (error) throw new Error(`active ${sourceName} outages: ${error.message}`);
  const stored = (data ?? []) as Array<{
    source_id: string | null;
    service_type: FeedRow["service_type"];
    severity: FeedRow["severity"];
    location: unknown;
    city: string | null;
    state: string | null;
    description: string | null;
    estimated_restoration: string | null;
    reported_at: string;
    metadata: Json;
  }>;
  if (count !== null && count !== stored.length) {
    throw new Error(`active ${sourceName} outages: read ${stored.length} of ${count}`);
  }

  const rows: FeedRow[] = [];
  for (const row of stored) {
    if (row.source_id === null || seen.has(row.source_id)) continue;
    const point = pointFromGeography(row.location);
    if (!point) throw new Error(`active ${sourceName} outage ${row.source_id}: unreadable location`);
    rows.push({
      source_id: row.source_id,
      service_type: row.service_type,
      severity: row.severity,
      latitude: point.lat,
      longitude: point.lng,
      city: row.city,
      state: row.state,
      description: row.description,
      estimated_restoration: row.estimated_restoration,
      reported_at: row.reported_at,
      metadata: row.metadata,
    });
  }
  return rows;
}

/**
 * Apply a source's full outage snapshot: upsert what it reports, resolve what
 * it no longer does.
 *
 * With `keepMissing` (a truncated feed page) nothing is resolved: the source's
 * other active outages are passed back unchanged alongside the new rows, so
 * the same atomic call upserts what came back and leaves the rest open.
 *
 * One atomic SQL call (migration 008) rather than an upsert plus a cleanup
 * query from here. The unique index on (source_name, source_id) is partial,
 * and PostgREST cannot express a partial index in ON CONFLICT, so the previous
 * client-side upsert would have failed on the first source that returned
 * outages. Doing both halves in one transaction also means a reader never sees
 * the snapshot half applied.
 */
async function syncOutages(
  client: ReturnType<typeof createServiceRoleClient>,
  sourceName: string,
  outages: IngestedOutage[],
  { keepMissing = false }: { keepMissing?: boolean } = {},
): Promise<{ upserted: number; resolved: number }> {
  // The SQL function upserts in one statement, so a repeated source_id or a row
  // with no usable coordinates would abort the whole snapshot. Keep the first
  // row per id and drop rows that cannot be placed on the map.
  const unique = new Map<string, IngestedOutage>();
  for (const o of outages) {
    if (!o.active || unique.has(o.sourceId)) continue;
    if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) continue;
    unique.set(o.sourceId, o);
  }

  const rows: FeedRow[] = [...unique.values()].map((o) => ({
    source_id: o.sourceId,
    service_type: o.serviceType,
    severity: o.severity,
    latitude: o.latitude,
    longitude: o.longitude,
    city: o.city,
    state: o.state,
    description: o.description,
    estimated_restoration: o.estimatedRestoration,
    reported_at: o.reportedAt,
    metadata: {
      utility_name: o.utilityName,
      customers_affected: o.customersAffected,
      // Without a feed start time, reported_at is only when we first saw it.
      start_known: o.reportedAt !== null,
    },
  }));

  const carried = keepMissing ? await activeRowsNotIn(client, sourceName, new Set(unique.keys())) : [];

  const { data, error } = await client.rpc("sync_official_outages", {
    feed_source: sourceName,
    feed_rows: [...rows, ...carried] as unknown as Json,
  });

  if (error) throw new Error(`sync_official_outages: ${error.message}`);

  const result = (data ?? [])[0];
  if (!result) throw new Error("sync_official_outages returned no result row");
  // Carried rows are re-written, not new: report only what the feed sent.
  return { upserted: result.upserted - carried.length, resolved: result.resolved };
}

export async function runIngest(): Promise<IngestReport> {
  if (!isSupabaseConfigured()) {
    throw new Error("Ingestion needs a database; Supabase is not configured.");
  }

  const client = createServiceRoleClient();
  const reports: SourceReport[] = [];
  let outagesResolved = 0;

  for (const source of SOURCES) {
    if (!source.isConfigured()) {
      reports.push({
        source: source.name,
        ok: false,
        outages: 0,
        advisories: 0,
        error: "not configured",
      });
      continue;
    }

    try {
      const result = await source.fetch();
      const advisories = result.advisories ?? [];
      const outages = result.outages ?? [];

      await upsertAdvisories(client, source.name, advisories);

      // Only sources that deal in outages get a sync. An advisory-only source
      // returning no outages must not be read as "every outage is resolved".
      let written = 0;
      if (result.outages !== undefined) {
        if (result.truncated) {
          console.warn(
            `[ingest] ${source.name}: response may be truncated (${outages.length} outages kept); ` +
              "not resolving outages missing from it this run.",
          );
        }
        const synced = await syncOutages(client, source.name, outages, {
          keepMissing: result.truncated === true,
        });
        written = synced.upserted;
        outagesResolved += synced.resolved;
      }

      reports.push({
        source: source.name,
        ok: true,
        outages: written,
        advisories: advisories.length,
        ...(result.truncated ? { truncated: true } : {}),
      });
    } catch (error) {
      // One bad feed must not stop the rest.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ingest] ${source.name} failed:`, message);
      reports.push({
        source: source.name,
        ok: false,
        outages: 0,
        advisories: 0,
        error: message,
      });
    }
  }

  // Sources are already written by now, so a failed prune is logged rather than
  // thrown: it must not turn a successful ingest into a failed run.
  const { data: pruned, error: pruneError } = await client.rpc(
    "prune_expired_advisories",
  );
  if (pruneError) {
    console.error("[ingest] prune_expired_advisories failed:", pruneError.message);
  }

  return {
    ran: new Date().toISOString(),
    sources: reports,
    advisoriesPruned: (pruned as number | null) ?? 0,
    outagesResolved,
  };
}

/**
 * How stale the advisory layer may get before a read triggers a refresh.
 *
 * Vercel's Hobby plan caps cron at one run per day, which is useless for
 * warnings that expire in hours. So the schedule is a floor and this is the
 * real refresh rate: a request that is about to serve stale data kicks off a
 * run in the background and serves what it has. On a paid plan the cron runs
 * often enough that this rarely fires.
 */
const STALE_AFTER_MS = 20 * 60 * 1000;

/** Guards against a burst of concurrent readers each starting their own run. */
const globalIngest = globalThis as unknown as {
  __ingestInFlight?: Promise<IngestReport> | null;
  __ingestLastAttempt?: number;
  __ingestWarnedUnwritable?: boolean;
};

/**
 * Whether ingestion can write at all.
 *
 * Both writers need the service-role key: ingested rows have no `reported_by`,
 * and every RLS write policy is expressed in terms of `auth.uid()`. An empty
 * string counts as missing — a blank value in an env file is the likeliest way
 * to get here, and it is falsy, so it would otherwise disable the whole feature
 * while looking configured.
 */
export function ingestCanWrite(): boolean {
  return (
    isSupabaseConfigured() &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().length > 0
  );
}

/**
 * Run the feeds if what we would serve is stale.
 *
 * Safe to call on a read path: it returns immediately when the data is fresh,
 * when a run is already going, or when it cannot write. The caller should not
 * await it — see the `after()` call in /api/advisories.
 */
export async function refreshIfStale(): Promise<void> {
  if (!ingestCanWrite()) {
    // Say so once per process. Returning silently here cost real debugging
    // time: a blank SUPABASE_SERVICE_ROLE_KEY left the advisory layer
    // permanently empty with nothing in the log to explain it.
    if (!globalIngest.__ingestWarnedUnwritable) {
      globalIngest.__ingestWarnedUnwritable = true;
      console.warn(
        "[ingest] skipped: SUPABASE_SERVICE_ROLE_KEY is missing or empty, so " +
          "public feeds cannot be written. The advisory layer will stay empty.",
      );
    }
    return;
  }

  // A failing run must not be retried on every single request. Claimed before
  // any await so concurrent readers cannot all pass the check together.
  const lastAttempt = globalIngest.__ingestLastAttempt ?? 0;
  if (Date.now() - lastAttempt < STALE_AFTER_MS) return;
  if (globalIngest.__ingestInFlight) return;
  globalIngest.__ingestLastAttempt = Date.now();

  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("advisories")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`freshness check: ${error.message}`);

    const newest = (data as { updated_at: string } | null)?.updated_at;
    const fresh =
      newest !== undefined &&
      newest !== null &&
      Date.now() - Date.parse(newest) < STALE_AFTER_MS;

    if (fresh) return;

    const run = runIngest();
    globalIngest.__ingestInFlight = run;
    try {
      await run;
    } finally {
      globalIngest.__ingestInFlight = null;
    }
  } catch (error) {
    console.error("[ingest] background refresh failed:", error);
  }
}

/** Names of the registered sources, for the status endpoint. */
export function registeredSources() {
  return SOURCES.map((s) => ({
    name: s.name,
    label: s.label,
    configured: s.isConfigured(),
  }));
}
