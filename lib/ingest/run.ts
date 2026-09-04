import "server-only";
import { isSupabaseConfigured } from "@/lib/data";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NwsSource } from "./nws";
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

const SOURCES: OutageSource[] = [new NwsSource()];

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

async function upsertOutages(
  client: ReturnType<typeof createServiceRoleClient>,
  sourceName: string,
  outages: IngestedOutage[],
): Promise<number> {
  const live = outages.filter((o) => o.active);
  if (live.length === 0) return 0;

  // Provider slugs are resolved in one pass rather than per row.
  const slugs = [...new Set(live.map((o) => o.providerSlug).filter(Boolean))];
  const providerIds = new Map<string, string>();

  if (slugs.length > 0) {
    const { data } = await client
      .from("providers")
      .select("id, slug")
      .in("slug", slugs as string[]);

    for (const row of (data ?? []) as Array<{ id: string; slug: string }>) {
      providerIds.set(row.slug, row.id);
    }
  }

  const rows = live.map((o) => ({
    source_name: sourceName,
    source_id: o.sourceId,
    origin: "official" as const,
    provider_id: o.providerSlug
      ? (providerIds.get(o.providerSlug) ?? null)
      : null,
    service_type: o.serviceType,
    severity: o.severity,
    status: "active" as const,
    location: `SRID=4326;POINT(${o.longitude} ${o.latitude})`,
    city: o.city,
    state: o.state,
    description: o.description,
    estimated_restoration: o.estimatedRestoration,
  }));

  const { error } = await client
    .from("outages")
    .upsert(rows as never, { onConflict: "source_name,source_id" });

  if (error) throw new Error(`outages upsert: ${error.message}`);
  return rows.length;
}

/**
 * Close ingested outages the source has stopped reporting.
 *
 * Only rows this source owns, and only ones it did not just send: an upstream
 * feed dropping a row is how it says "restored". Crowdsourced reports are never
 * touched.
 */
async function resolveMissing(
  client: ReturnType<typeof createServiceRoleClient>,
  sourceName: string,
  stillPresent: string[],
): Promise<number> {
  let query = client
    .from("outages")
    .update({ status: "resolved", resolved_at: new Date().toISOString() } as never)
    .eq("source_name", sourceName)
    .eq("status", "active");

  if (stillPresent.length > 0) {
    // PostgREST needs the list quoted for `not.in`.
    query = query.not(
      "source_id",
      "in",
      `(${stillPresent.map((id) => `"${id}"`).join(",")})`,
    );
  }

  // `select()` after an update returns the affected rows, which is how many
  // this closed. The count option is not available on an update builder.
  const { data, error } = await query.select("id");
  if (error) throw new Error(`resolve missing: ${error.message}`);
  return (data ?? []).length;
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
      const written = await upsertOutages(client, source.name, outages);

      if (outages.length > 0) {
        outagesResolved += await resolveMissing(
          client,
          source.name,
          outages.filter((o) => o.active).map((o) => o.sourceId),
        );
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
};

/**
 * Run the feeds if what we would serve is stale.
 *
 * Safe to call on a read path: it returns immediately when the data is fresh,
 * when a run is already going, or when the service-role key is absent. The
 * caller should not await it — see the `after()` call in /api/advisories.
 */
export async function refreshIfStale(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

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
