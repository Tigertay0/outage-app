import "server-only";
import { isSupabaseConfigured } from "@/lib/data";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
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

const SOURCES: OutageSource[] = [new NwsSource(), new OdinSource()];

export interface SourceReport {
  source: string;
  ok: boolean;
  outages: number;
  advisories: number;
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

/**
 * Apply a source's full outage snapshot: upsert what it reports, resolve what
 * it no longer does.
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
): Promise<{ upserted: number; resolved: number }> {
  const rows = outages
    .filter((o) => o.active)
    .map((o) => ({
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

  const { data, error } = await client.rpc("sync_official_outages", {
    feed_source: sourceName,
    feed_rows: rows as unknown as Json,
  });

  if (error) throw new Error(`sync_official_outages: ${error.message}`);

  const result = (data ?? [])[0];
  return { upserted: result?.upserted ?? 0, resolved: result?.resolved ?? 0 };
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
        const synced = await syncOutages(client, source.name, outages);
        written = synced.upserted;
        outagesResolved += synced.resolved;
      }

      reports.push({
        source: source.name,
        ok: true,
        outages: written,
        advisories: advisories.length,
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

  const { data: pruned } = await client.rpc("prune_expired_advisories");

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

  // A failing run must not be retried on every single request.
  const lastAttempt = globalIngest.__ingestLastAttempt ?? 0;
  if (Date.now() - lastAttempt < STALE_AFTER_MS) return;

  if (globalIngest.__ingestInFlight) return;

  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("advisories")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newest = (data as { updated_at: string } | null)?.updated_at;
    const fresh =
      newest !== undefined &&
      newest !== null &&
      Date.now() - Date.parse(newest) < STALE_AFTER_MS;

    if (fresh) return;

    globalIngest.__ingestLastAttempt = Date.now();
    globalIngest.__ingestInFlight = runIngest();

    await globalIngest.__ingestInFlight;
  } catch (error) {
    console.error("[ingest] background refresh failed:", error);
  } finally {
    globalIngest.__ingestInFlight = null;
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
