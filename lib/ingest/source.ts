import "server-only";
import type { Severity } from "@/lib/types";

/**
 * Public-data ingestion (PRD section 6.1).
 *
 * A source is a named adapter that fetches from one upstream feed and returns
 * rows in this app's own shape. Nothing above this file knows which feeds exist
 * or how they are shaped, so adding one — including a paid one like
 * PowerOutage.us — means writing an adapter and registering it.
 *
 * Two return kinds, deliberately distinct:
 *
 *   - IngestedOutage: service is actually down. Goes into `outages` with
 *     origin 'official'.
 *   - IngestedAdvisory: a condition that causes outages, such as a storm.
 *     Goes into `advisories`, a separate layer, because calling a wind warning
 *     an outage would mean the map showed events nobody has lost service to.
 */

export interface IngestedOutage {
  /** Stable within this source, so a repeated poll updates rather than adds. */
  sourceId: string;
  providerSlug: string | null;
  serviceType: "power" | "internet" | "cellular" | "other";
  severity: Severity;
  latitude: number;
  longitude: number;
  description: string | null;
  city: string | null;
  state: string | null;
  estimatedRestoration: string | null;
  /** Absent means the source no longer reports it; the runner resolves it. */
  active: boolean;
}

export interface IngestedAdvisory {
  sourceId: string;
  kind: string;
  severity: Severity;
  headline: string | null;
  description: string | null;
  areaDescription: string | null;
  url: string | null;
  latitude: number;
  longitude: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface SourceResult {
  outages?: IngestedOutage[];
  advisories?: IngestedAdvisory[];
}

export interface OutageSource {
  /** Stored on every row this source produces; changing it orphans its rows. */
  readonly name: string;
  readonly label: string;
  /** False when the source needs configuration this deployment does not have. */
  isConfigured(): boolean;
  fetch(): Promise<SourceResult>;
}
