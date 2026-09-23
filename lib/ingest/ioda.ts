import "server-only";
import type { Severity } from "@/lib/types";
import type { IngestedOutage, OutageSource, SourceResult } from "./source";
import { US_STATE_CENTROIDS } from "./us-regions";

/**
 * IODA — Internet Outage Detection and Analysis, Georgia Tech.
 *
 * Three independent measurements of whether a region is reachable — BGP
 * routing, active probing of /24 blocks, and Google transparency traffic — each
 * compared against that region's own recent history. When they drop together,
 * something between the region and the rest of the internet has broken.
 *
 *   https://ioda.inetintel.cc.gatech.edu
 *
 * Free and keyless, which is why it is here. Be clear about what it is not: it
 * detects region-scale loss of connectivity, so it catches a hurricane taking a
 * state offline and says nothing about one ISP failing in one neighbourhood.
 * In the US, where the network is dense and redundant, that means this source
 * is silent most days. An empty internet layer is the honest answer on a day
 * when no US region is measurably offline, not a bug.
 */

const API = "https://api.ioda.inetintel.cc.gatech.edu/v2";

/**
 * How far back to read alerts.
 *
 * IODA emits one alert per entity per datasource per five-minute bucket, and an
 * ongoing outage keeps re-alerting. Reading a window and keeping the newest
 * alert per entity gives the current state; too short a window and a brief gap
 * in reporting looks like recovery.
 */
const WINDOW_MS = 3 * 60 * 60 * 1000;

/** Alerts older than this are stale even if they were the newest we saw. */
const MAX_AGE_MS = 90 * 60 * 1000;

/**
 * How far connectivity must fall before it is an outage, as a fraction of that
 * region's own normal.
 *
 * IODA's "critical" level is relative to a region's recent history and fires on
 * drops far too small to be an outage: over a sample month of US alerts, nine
 * of them were at 80-99% of normal — Indiana at 98.8%, New York at 96% — which
 * is ordinary variation, not a state losing the internet. Those would have been
 * published as statewide outages. Everything at or below this ratio in the same
 * sample (63 alerts) was a genuine collapse, mostly to under 20%.
 */
const MAX_NORMAL_RATIO = 0.5;

interface IodaAlert {
  datasource: string;
  entity: { code: string; name: string; type: string };
  time: number; // unix seconds
  level: string; // "normal" | "warning" | "critical"
  value: number | null;
  historyValue: number | null;
}

/**
 * How far below normal this region is now, or null when the alert carries no
 * usable numbers — in which case there is no way to tell an outage from a
 * rounding wobble, and the alert is dropped rather than guessed at.
 */
function normalRatio(alert: IodaAlert): number | null {
  const { value, historyValue } = alert;
  if (value === null || historyValue === null || historyValue <= 0) return null;
  return value / historyValue;
}

/** Almost nothing getting through is a blackout; the rest is degraded. */
function severityFor(ratio: number): Severity {
  return ratio <= 0.2 ? "complete" : "degraded";
}

const SEVERITY_RANK: Record<Severity, number> = {
  intermittent: 1,
  degraded: 2,
  complete: 3,
};

/** Plain-language name for what IODA measured, for the outage description. */
const SOURCE_NAMES: Record<string, string> = {
  bgp: "global routing tables",
  "ping-slash24": "direct network probes",
  gtr: "Google traffic levels",
  "merit-nt": "darknet telescope traffic",
};

function describe(state: string, alert: IodaAlert, ratio: number): string {
  const measured = SOURCE_NAMES[alert.datasource] ?? alert.datasource;

  return (
    `Internet connectivity across ${state} has dropped to about ` +
    `${Math.round(ratio * 100)}% of normal for this area.` +
    ` Detected by IODA from ${measured}, not reported by a provider,` +
    ` so the cause is unknown and individual providers may be unaffected.`
  );
}

export class IodaSource implements OutageSource {
  readonly name = "ioda";
  readonly label = "IODA (Georgia Tech)";

  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<SourceResult> {
    const until = Math.floor(Date.now() / 1000);
    const from = Math.floor((Date.now() - WINDOW_MS) / 1000);

    const url =
      `${API}/outages/alerts?entityType=region&relatedTo=country/US` +
      `&from=${from}&until=${until}&limit=1000`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`IODA responded ${response.status}`);
    }

    const body = (await response.json()) as { data?: IodaAlert[] };
    const alerts = body.data ?? [];

    // Newest alert per region per datasource. A region is only reported as out
    // while its latest reading still says so, which is what makes the snapshot
    // self-clearing: once IODA returns to normal the region drops out of this
    // map, and the sync resolves it.
    const latest = new Map<string, IodaAlert>();
    for (const alert of alerts) {
      const key = `${alert.entity.code}:${alert.datasource}`;
      const held = latest.get(key);
      if (!held || alert.time > held.time) latest.set(key, alert);
    }

    const cutoff = (Date.now() - MAX_AGE_MS) / 1000;
    const worstByRegion = new Map<
      string,
      { alert: IodaAlert; severity: Severity; ratio: number }
    >();

    for (const alert of latest.values()) {
      if (alert.level === "normal") continue;
      if (alert.time < cutoff) continue;

      // IODA also reports an "Unknown Region in United States" bucket, which has
      // no location to draw and is skipped along with any name we lack.
      const state = alert.entity.name;
      if (!(state in US_STATE_CENTROIDS)) continue;

      const ratio = normalRatio(alert);
      if (ratio === null || ratio > MAX_NORMAL_RATIO) continue;

      const severity = severityFor(ratio);
      const held = worstByRegion.get(state);
      if (!held || SEVERITY_RANK[severity] > SEVERITY_RANK[held.severity]) {
        worstByRegion.set(state, { alert, severity, ratio });
      }
    }

    const outages: IngestedOutage[] = [];
    for (const [state, { alert, severity, ratio }] of worstByRegion) {
      const centroid = US_STATE_CENTROIDS[state];

      outages.push({
        sourceId: `region:${alert.entity.code}`,
        providerSlug: null,
        utilityName: null,
        customersAffected: null,
        reportedAt: new Date(alert.time * 1000).toISOString(),
        serviceType: "internet",
        severity,
        latitude: centroid.lat,
        longitude: centroid.lng,
        description: describe(state, alert, ratio),
        city: null,
        state,
        estimatedRestoration: null,
        active: true,
      });
    }

    return { outages };
  }
}
