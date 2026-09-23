import "server-only";
import type { Severity } from "@/lib/types";
import type { IngestedOutage, OutageSource, SourceResult } from "./source";
import { US_STATE_CENTROIDS } from "./us-regions";

/**
 * Cloudflare Radar — internet outage annotations.
 *
 * Cloudflare sees a large share of the world's HTTP traffic, and its Radar team
 * publishes the outages it observes as curated annotations: a start, usually an
 * end, the networks and places affected, and — unusually for an outage feed —
 * a stated cause, such as a cable cut, a power outage or government action.
 *
 *   https://radar.cloudflare.com/outage-center
 *
 * Why this sits alongside IODA rather than replacing it: IODA infers outages
 * from measurements and fires within minutes, while Radar's annotations are
 * curated and carry a cause. Radar is the better description of an event; IODA
 * is the faster signal. Both are region-or-network scale, so neither answers
 * "is my own ISP down" — only a person reporting it does.
 *
 * Needs a free API token (CLOUDFLARE_RADAR_TOKEN) with Account > Radar > Read.
 * Without one the source reports itself unconfigured and the run skips it, so
 * a deployment without the token behaves exactly as it did before.
 */

const API = "https://api.cloudflare.com/client/v4/radar/annotations/outages";

/**
 * How far back to look for outages that have not ended.
 *
 * Annotations are written when Cloudflare notices an event and closed when it
 * recovers, so an ongoing outage keeps an open end date. Reading a wide window
 * and keeping only the open ones is what makes the snapshot self-clearing: the
 * moment Radar closes an annotation it leaves this set, and the sync resolves
 * the row.
 */
const WINDOW = "28d";

/** Nothing sensible can be drawn for an outage still open after this long. */
const MAX_OPEN_DAYS = 14;

interface RadarOutage {
  id?: number | string;
  asns?: number[];
  asnsDetails?: Array<{ asn?: number; name?: string; locations?: { code?: string; name?: string } }>;
  locations?: string[];
  locationsDetails?: Array<{ code?: string; name?: string }>;
  startDate?: string;
  endDate?: string | null;
  eventType?: string;
  description?: string | null;
  linkedUrl?: string | null;
  scope?: string | null;
  outage?: { outageCause?: string | null; outageType?: string | null } | null;
}

/**
 * Where to draw it.
 *
 * Radar names places, not coordinates. A US annotation usually names the
 * country, and its `scope` often names states in prose ("Texas and Oklahoma").
 * The first state named wins the marker; a nationwide event with no state is
 * placed at the geographic centre of the country, which is honest only because
 * the description says it is nationwide.
 */
function placeFor(row: RadarOutage): { lat: number; lng: number; state: string | null } {
  const haystack = `${row.scope ?? ""} ${row.description ?? ""}`;

  for (const [state, centroid] of Object.entries(US_STATE_CENTROIDS)) {
    // Word-boundary match: "Washington" must not fire on "Washington, D.C." in
    // a sentence about somewhere else, and short names must not match inside
    // longer words.
    const pattern = new RegExp(`\\b${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(haystack)) {
      return { lat: centroid.lat, lng: centroid.lng, state };
    }
  }

  // Geographic centre of the contiguous US, matching DEFAULT_VIEW.
  return { lat: 39.8283, lng: -98.5795, state: null };
}

/**
 * Severity from the scale of the event.
 *
 * Radar's own types describe reach, not depth: a NATIONWIDE outage is one that
 * took a country off the internet, while NETWORK is one operator's customers.
 * Reach is the only thing the annotation states, so it is what this maps.
 */
function severityFor(outageType: string | null | undefined): Severity {
  switch ((outageType ?? "").toUpperCase()) {
    case "NATIONWIDE":
      return "complete";
    case "REGIONAL":
      return "complete";
    case "NETWORK":
      return "degraded";
    default:
      return "degraded";
  }
}

/** "CABLE_CUT" → "cable cut". */
function humanCause(cause: string | null | undefined): string | null {
  if (!cause) return null;
  return cause.toLowerCase().replace(/_/g, " ");
}

function describe(row: RadarOutage, state: string | null): string {
  const cause = humanCause(row.outage?.outageCause);
  const operators = (row.asnsDetails ?? [])
    .map((a) => a.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);

  const where = state ?? "the United States";
  const who =
    operators.length > 0 ? ` Affecting ${operators.join(", ")}.` : "";
  const why = cause ? ` Cause: ${cause}.` : "";

  // Cloudflare's own description is a sentence written by their team; when it
  // exists it beats anything assembled here.
  const summary = row.description?.trim();
  if (summary) return `${summary}${why}${who}`;

  return `Internet disruption affecting ${where}.${why}${who}`;
}

export class CloudflareRadarSource implements OutageSource {
  readonly name = "cloudflare-radar";
  readonly label = "Cloudflare Radar";

  isConfigured(): boolean {
    return Boolean(process.env.CLOUDFLARE_RADAR_TOKEN);
  }

  async fetch(): Promise<SourceResult> {
    const token = process.env.CLOUDFLARE_RADAR_TOKEN;
    if (!token) throw new Error("CLOUDFLARE_RADAR_TOKEN is not set");

    const url = `${API}?location=US&dateRange=${WINDOW}&limit=100&format=JSON`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      // A bad or under-scoped token comes back as 400 with code 9106, not the
      // 401/403 you would expect, so all three get the same hint: the run
      // report is the only place anyone will read this.
      const authish = [400, 401, 403].includes(response.status);
      const hint = authish
        ? " — check CLOUDFLARE_RADAR_TOKEN has Account > Radar > Read"
        : "";
      throw new Error(`Cloudflare Radar responded ${response.status}${hint}`);
    }

    const body = (await response.json()) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: { annotations?: RadarOutage[] };
    };

    if (body.success === false) {
      const message = body.errors?.[0]?.message ?? "unknown error";
      throw new Error(`Cloudflare Radar: ${message}`);
    }

    const annotations = body.result?.annotations ?? [];
    const cutoff = Date.now() - MAX_OPEN_DAYS * 24 * 60 * 60 * 1000;

    const outages: IngestedOutage[] = [];

    for (const row of annotations) {
      // Closed annotations are history, and this map is about now.
      if (row.endDate) continue;
      if (!row.startDate) continue;

      const started = Date.parse(row.startDate);
      if (!Number.isFinite(started) || started < cutoff) continue;

      const place = placeFor(row);
      const id = row.id ?? `${row.startDate}:${(row.asns ?? []).join("-")}`;

      outages.push({
        sourceId: String(id),
        providerSlug: null,
        utilityName: row.asnsDetails?.[0]?.name ?? null,
        customersAffected: null,
        reportedAt: new Date(started).toISOString(),
        serviceType: "internet",
        severity: severityFor(row.outage?.outageType),
        latitude: place.lat,
        longitude: place.lng,
        description: describe(row, place.state),
        city: null,
        state: place.state,
        estimatedRestoration: null,
        active: true,
      });
    }

    return { outages };
  }
}
