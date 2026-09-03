"use client";

import { useMemo } from "react";
import Supercluster from "supercluster";
import { MARKER_ZOOM } from "@/lib/constants";
import type { Outage, Severity, ServiceType } from "@/lib/types";

/**
 * Zoom-dependent clustering (PRD section 4.1).
 *
 * Supercluster indexes the points once per data change, then answers viewport
 * queries in constant-ish time as the user pans. Clusters carry aggregate
 * severity and service-type counts so a cluster bubble can be coloured by its
 * worst member without a second pass over the raw points.
 */

/**
 * What `map`/`reduce` accumulate onto a cluster. Supercluster's generic wants
 * only the added properties — it supplies cluster_id, point_count and friends
 * itself — so this is separate from the full ClusterProperties below.
 */
export interface ClusterAggregates {
  /** Count per severity, so the worst one can colour the bubble. */
  severityCounts: Record<Severity, number>;
  serviceCounts: Record<ServiceType, number>;
}

export interface ClusterProperties extends ClusterAggregates {
  cluster: true;
  cluster_id: number;
  point_count: number;
  point_count_abbreviated: string | number;
}

export interface PointProperties extends ClusterAggregates {
  cluster: false;
  outage: Outage;
}

export type ClusterFeature = GeoJSON.Feature<
  GeoJSON.Point,
  ClusterProperties | PointProperties
>;

const emptySeverity = (): Record<Severity, number> => ({
  complete: 0,
  degraded: 0,
  intermittent: 0,
});

const emptyService = (): Record<ServiceType, number> => ({
  power: 0,
  internet: 0,
  cellular: 0,
  other: 0,
});

/** Stable identity, so an empty result never re-renders the marker layer. */
const EMPTY_CLUSTERS: ClusterFeature[] = [];

export interface Viewport {
  bounds: [number, number, number, number]; // west, south, east, north
  zoom: number;
}

export function useClusters(outages: Outage[], viewport: Viewport | null) {
  // Rebuilding the index is the expensive part, so it is keyed on the data
  // alone — panning and zooming reuse the same index.
  const index = useMemo(() => {
    const supercluster = new Supercluster<PointProperties, ClusterAggregates>({
      radius: 60,
      maxZoom: MARKER_ZOOM,
      minPoints: 2,

      map: (props) => ({
        severityCounts: { ...props.severityCounts },
        serviceCounts: { ...props.serviceCounts },
      }),

      reduce: (accumulated, props) => {
        for (const key of Object.keys(props.severityCounts) as Severity[]) {
          accumulated.severityCounts[key] += props.severityCounts[key];
        }
        for (const key of Object.keys(props.serviceCounts) as ServiceType[]) {
          accumulated.serviceCounts[key] += props.serviceCounts[key];
        }
      },
    });

    supercluster.load(
      outages.map((outage) => {
        const severityCounts = emptySeverity();
        severityCounts[outage.severity] = 1;

        const serviceCounts = emptyService();
        serviceCounts[outage.serviceType] = 1;

        return {
          type: "Feature" as const,
          properties: {
            cluster: false as const,
            outage,
            severityCounts,
            serviceCounts,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [outage.longitude, outage.latitude],
          },
        };
      }),
    );

    return supercluster;
  }, [outages]);

  // Empty until the map reports its first viewport, which happens on load
  // before any outage data has arrived — so nothing is ever visibly blanked.
  const clusters = useMemo(() => {
    if (!viewport) return EMPTY_CLUSTERS;

    return index.getClusters(
      viewport.bounds,
      Math.round(viewport.zoom),
    ) as ClusterFeature[];
  }, [index, viewport]);

  return {
    clusters,
    /** Zoom that breaks a given cluster into its children. */
    expansionZoom: (clusterId: number) =>
      Math.min(index.getClusterExpansionZoom(clusterId), 18),
    /** The individual outages inside a cluster, for the spider list. */
    leaves: (clusterId: number, limit = 25): Outage[] =>
      index
        .getLeaves(clusterId, limit)
        .map((leaf) => (leaf.properties as PointProperties).outage),
  };
}
