import "server-only";
import type { IngestedOutage, OutageSource, SourceResult } from "./source";

/**
 * ODIN — the Outage Data Initiative Nationwide.
 *
 * A DOE / Oak Ridge National Laboratory programme through which utilities
 * publish near-real-time outage counts by county, in a common format. It is the
 * free, keyless source of *actual power outages* that this app lacked: when it
 * was added, about 90 utilities across 30-odd states were reporting, refreshed
 * roughly hourly.
 *
 *   https://odin.ornl.gov
 *   https://openenergyhub.ornl.gov/explore/dataset/odin-real-time-outages-county/
 *
 * Unlike NWS alerts these are genuine outages — customers with no power — so
 * they go into `outages` with origin 'official', not into the advisory layer.
 */

// The bulk export endpoint, not the paged records endpoint. A sync resolves
// anything missing from the snapshot, so a truncated page would wrongly close
// real outages; the export returns every row in one response.
const EXPORT_URL =
  "https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/" +
  "odin-real-time-outages-county/exports/json" +
  "?select=utility_id,name,communitydescriptor,county,state," +
  "metersaffected,centroid,reportedstarttime,estimatedrestorationtime,cause";

/**
 * Smallest outage shown, in customers per utility per county.
 *
 * About 40% of ODIN rows are a single customer. At county granularity a lone
 * household is almost always its own service line — a fuse or a drop, not
 * something a neighbour can confirm or plan around — and hundreds of them turn
 * the national map into uniform red noise. Lower this to 1 to include them.
 */
export const ODIN_MIN_CUSTOMERS = 5;

/**
 * A snapshot this far below the previous one is treated as a failed fetch
 * rather than as mass restoration, so it cannot resolve everything at once.
 * See `sanityCheck`.
 */
const MIN_PLAUSIBLE_ROWS = 20;

interface OdinRecord {
  utility_id: string | null;
  name: string | null;
  communitydescriptor: string | null; // county FIPS
  county: string | null;
  state: string | null;
  metersaffected: number | null;
  centroid: { lat: number; lon: number } | null;
  reportedstarttime: string | null;
  estimatedrestorationtime: string | null; // JSON string: {"ert": "..."}
  cause: string | null;
}

/** "MONONGAHELA POWER CO,12796" → "Monongahela Power Co". */
function utilityName(raw: string | null): string | null {
  if (!raw) return null;

  const name = raw.replace(/,\s*\d+\s*$/, "").trim();
  if (!name) return null;

  // Feed names are uppercase. Title-case each word, except ones that are plainly
  // codes rather than words: anything with "&" ("PG&E") or in parentheses
  // ("(NC)").
  return name
    .split(/(\s+)/)
    .map((word) =>
      /[&()]/.test(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

/** The ETR field is JSON encoded as a string: '{"ert": "2026-09-22T20:30:00Z"}'. */
function restorationTime(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ert?: string };
    if (!parsed.ert) return null;
    const time = Date.parse(parsed.ert);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  } catch {
    return null;
  }
}

/** Feed causes are free text of uneven quality; drop the non-answers. */
function meaningfulCause(cause: string | null): string | null {
  if (!cause) return null;
  const trimmed = cause.trim();
  if (/^(unknown|pending investigation|investigating|analy[sz]ing problem)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

interface Aggregate {
  utilityId: string;
  fips: string;
  name: string | null;
  county: string | null;
  state: string | null;
  customers: number;
  incidents: number;
  latitude: number;
  longitude: number;
  start: string | null;
  restoration: string | null;
  causes: Set<string>;
}

/**
 * One row per utility per county.
 *
 * ODIN reports individual incidents, and a county often has several from the
 * same utility, so utility + county is not unique in the raw feed. The map works
 * at county granularity anyway, and the sync needs one row per key — ON
 * CONFLICT cannot update the same row twice in one statement.
 */
function aggregate(records: OdinRecord[]): Aggregate[] {
  const byKey = new Map<string, Aggregate>();

  for (const record of records) {
    if (!record.utility_id || !record.communitydescriptor || !record.centroid) {
      continue;
    }
    const customers = Math.max(0, record.metersaffected ?? 0);
    const key = `${record.utility_id}:${record.communitydescriptor}`;
    const cause = meaningfulCause(record.cause);
    const restoration = restorationTime(record.estimatedrestorationtime);

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        utilityId: record.utility_id,
        fips: record.communitydescriptor,
        name: utilityName(record.name),
        county: record.county,
        state: record.state,
        customers,
        incidents: 1,
        latitude: record.centroid.lat,
        longitude: record.centroid.lon,
        start: record.reportedstarttime,
        restoration,
        causes: new Set(cause ? [cause] : []),
      });
      continue;
    }

    existing.customers += customers;
    existing.incidents += 1;
    if (cause) existing.causes.add(cause);

    // Earliest start: the county has been affected since the first incident.
    if (
      record.reportedstarttime &&
      (!existing.start || record.reportedstarttime < existing.start)
    ) {
      existing.start = record.reportedstarttime;
    }
    // Latest estimate: the county is not fully restored until the last one is.
    if (restoration && (!existing.restoration || restoration > existing.restoration)) {
      existing.restoration = restoration;
    }
  }

  return [...byKey.values()];
}

function describe(group: Aggregate): string {
  const who = `${group.customers.toLocaleString("en-US")} ${
    group.customers === 1 ? "customer" : "customers"
  } without power`;

  const causes = [...group.causes];
  const why =
    causes.length === 1
      ? ` — ${causes[0]}`
      : causes.length > 1
        ? ` — ${causes.slice(0, 2).join(", ")}${causes.length > 2 ? "…" : ""}`
        : "";

  const across =
    group.incidents > 1 ? ` across ${group.incidents} incidents` : "";

  return `${who}${across}${why}. Reported by the utility via ODIN.`;
}

export class OdinSource implements OutageSource {
  readonly name = "odin";
  readonly label = "ODIN (Oak Ridge National Laboratory)";

  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<SourceResult> {
    const response = await fetch(EXPORT_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`ODIN responded ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      // A shape change must fail the run, not be read as "no outages" — which
      // would resolve every ODIN outage on the map.
      throw new Error("ODIN export was not an array");
    }

    const records = body as OdinRecord[];
    if (records.length < MIN_PLAUSIBLE_ROWS) {
      throw new Error(
        `ODIN returned ${records.length} rows, below the ${MIN_PLAUSIBLE_ROWS} ` +
          "treated as a plausible national snapshot; skipping this run.",
      );
    }

    const outages: IngestedOutage[] = aggregate(records)
      .filter((group) => group.customers >= ODIN_MIN_CUSTOMERS)
      .map((group) => ({
        sourceId: `${group.utilityId}:${group.fips}`,
        providerSlug: null,
        utilityName: group.name,
        customersAffected: group.customers,
        serviceType: "power",
        // Every customer counted here has no power at all. Scale is carried in
        // the description and customer count, not by bending the severity.
        severity: "complete",
        latitude: group.latitude,
        longitude: group.longitude,
        description: describe(group),
        city: group.county ? `${group.county} County` : null,
        state: group.state,
        estimatedRestoration: group.restoration,
        reportedAt: group.start,
        active: true,
      }));

    return { outages };
  }
}
