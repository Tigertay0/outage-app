import "server-only";
import type { Severity } from "@/lib/types";
import type { IngestedAdvisory, OutageSource, SourceResult } from "./source";

/**
 * National Weather Service active alerts.
 *
 * Free, no key, documented, and — unlike every other free feed I could find —
 * it actually has US coverage: a couple of hundred active alerts at any moment.
 * See docs at https://www.weather.gov/documentation/services-web-api
 *
 * These become advisories, not outages. A High Wind Warning is a reason to
 * expect an outage, not evidence of one, and filing it as an outage would put
 * events on the map that nobody has lost service to.
 *
 * Two filters keep the layer meaningful:
 *
 *   - Only event types that plausibly take out power, internet or phones.
 *     The feed is dominated by marine and heat advisories, which are real
 *     warnings but not this app's subject.
 *   - Only alerts we can place on the map. Storm-based warnings carry a
 *     polygon; the rest — including most wind and winter warnings, which are
 *     exactly the outage-causing ones — reference NWS forecast zones instead,
 *     so those are resolved to a centroid through the zones endpoint. Zone
 *     geometry never moves, so it is cached for the life of the process.
 */

const API = "https://api.weather.gov/alerts/active";

/**
 * How many zone geometries to resolve in one run.
 *
 * Each is a separate request. The cache below means a warm instance pays this
 * once, and anything missed is picked up by the next run fifteen minutes later,
 * so a bound here costs coverage only briefly and keeps a cold start from
 * firing a hundred requests at a public service.
 */
const ZONE_LOOKUP_BUDGET = 40;

/** Zone id -> centroid. Zones are static, so this never needs invalidating. */
const globalZones = globalThis as unknown as {
  __nwsZoneCentroids?: Map<string, [number, number] | null>;
};

function zoneCache(): Map<string, [number, number] | null> {
  if (!globalZones.__nwsZoneCentroids) {
    globalZones.__nwsZoneCentroids = new Map();
  }
  return globalZones.__nwsZoneCentroids;
}

/**
 * Event types worth showing. NWS event names are a controlled vocabulary, so
 * matching them exactly is safe and keeps unrelated warnings out.
 */
const OUTAGE_RELEVANT = new Map<string, Severity>([
  // Wind and storms bring lines down.
  ["Tornado Warning", "complete"],
  ["Tornado Watch", "degraded"],
  ["Hurricane Warning", "complete"],
  ["Hurricane Watch", "degraded"],
  ["Tropical Storm Warning", "complete"],
  ["Tropical Storm Watch", "degraded"],
  ["Severe Thunderstorm Warning", "complete"],
  ["Severe Thunderstorm Watch", "degraded"],
  ["High Wind Warning", "complete"],
  ["High Wind Watch", "degraded"],
  ["Wind Advisory", "intermittent"],

  // Ice and snow load are the classic cause of multi-day power loss.
  ["Ice Storm Warning", "complete"],
  ["Blizzard Warning", "complete"],
  ["Winter Storm Warning", "degraded"],
  ["Winter Storm Watch", "intermittent"],

  // Fire and flood take out infrastructure directly.
  ["Extreme Fire Danger", "degraded"],
  ["Red Flag Warning", "intermittent"],
  ["Flash Flood Warning", "degraded"],

  // Utilities themselves announce these through NWS in some regions.
  ["Extreme Heat Warning", "intermittent"],
]);

interface NwsZone {
  geometry: { type: string; coordinates: unknown } | null;
}

interface NwsFeature {
  id: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    event: string;
    headline: string | null;
    description: string | null;
    areaDesc: string | null;
    affectedZones?: string[];
    onset: string | null;
    effective: string | null;
    ends: string | null;
    expires: string | null;
    "@id"?: string;
  };
}

/**
 * Average the outer ring's vertices.
 *
 * A true centroid would need the shoelace formula, and for the small, convex
 * warning polygons NWS emits the difference is a few hundred metres on a marker
 * that already represents a whole county.
 */
function centroid(geometry: NwsFeature["geometry"]): [number, number] | null {
  if (!geometry) return null;

  const rings =
    geometry.type === "Polygon"
      ? [(geometry.coordinates as number[][][])[0]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][]).map((p) => p[0])
        : null;

  if (!rings) return null;

  let sumLng = 0;
  let sumLat = 0;
  let count = 0;

  for (const ring of rings) {
    if (!ring) continue;
    for (const [lng, lat] of ring) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      sumLng += lng;
      sumLat += lat;
      count += 1;
    }
  }

  if (count === 0) return null;
  return [sumLat / count, sumLng / count];
}

function headers(): HeadersInit {
  return {
    // NWS blocks requests without a contactable User-Agent.
    "User-Agent":
      process.env.NWS_USER_AGENT ??
      "OutageTracker/1.0 (https://github.com/Tigertay0/outage-app)",
    Accept: "application/geo+json",
  };
}

/**
 * Centroid of an NWS forecast zone, cached.
 *
 * Returns null — and caches that — for a zone that cannot be resolved, so a
 * missing or malformed one is not retried on every run.
 */
async function zoneCentroid(
  url: string,
  budget: { left: number },
): Promise<[number, number] | null> {
  const cache = zoneCache();
  if (cache.has(url)) return cache.get(url) ?? null;
  if (budget.left <= 0) return null;

  budget.left -= 1;

  try {
    const response = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!response.ok) {
      cache.set(url, null);
      return null;
    }

    const zone = (await response.json()) as NwsZone;
    const point = centroid(zone.geometry);
    cache.set(url, point);
    return point;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export class NwsSource implements OutageSource {
  readonly name = "nws";
  readonly label = "National Weather Service";

  isConfigured(): boolean {
    // No key. NWS asks for an identifying User-Agent instead, which is sent
    // below and falls back to the repository URL.
    return true;
  }

  async fetch(): Promise<SourceResult> {
    const response = await fetch(`${API}?status=actual&message_type=alert`, {
      headers: headers(),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`NWS responded ${response.status}`);
    }

    const body = (await response.json()) as { features?: NwsFeature[] };
    const advisories: IngestedAdvisory[] = [];
    const budget = { left: ZONE_LOOKUP_BUDGET };

    for (const feature of body.features ?? []) {
      const severity = OUTAGE_RELEVANT.get(feature.properties.event);
      if (!severity) continue;

      // Prefer the alert's own polygon; fall back to the zones it names.
      let point = centroid(feature.geometry);

      if (!point) {
        for (const zone of feature.properties.affectedZones ?? []) {
          point = await zoneCentroid(zone, budget);
          if (point) break;
        }
      }

      if (!point) continue;

      advisories.push({
        sourceId: feature.id,
        kind: feature.properties.event,
        severity,
        headline: feature.properties.headline,
        // The full description runs to several paragraphs of forecast prose.
        description: feature.properties.description?.slice(0, 1000) ?? null,
        areaDescription: feature.properties.areaDesc,
        url: feature.properties["@id"] ?? null,
        latitude: point[0],
        longitude: point[1],
        startsAt: feature.properties.onset ?? feature.properties.effective,
        endsAt: feature.properties.ends ?? feature.properties.expires,
      });
    }

    return { advisories };
  }
}
