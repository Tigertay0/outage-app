"use client";

import type { LayerProps } from "react-map-gl/maplibre";
import type { Outage } from "@/lib/types";

/**
 * The zoomed-out view of where service is out.
 *
 * At country and state zoom the map holds hundreds of points, and one pin per
 * outage is unreadable: the pins collide, the clusters become numbers floating
 * over nothing, and the thing a reader actually wants — where is this
 * concentrated — is the one thing the display hides. A heat map answers that
 * directly, and hands over to individual pins once the zoom is close enough for
 * them to stand apart.
 *
 * The two layers overlap for one zoom level so neither pops in against an empty
 * map; see HEAT_MAX_ZOOM and MARKERS_MIN_ZOOM.
 */

/** Above this zoom the heat map has faded out entirely. */
export const HEAT_MAX_ZOOM = 7;

/** Below this zoom no individual markers are drawn. */
export const MARKERS_MIN_ZOOM = 6;

/**
 * Heat weight for one outage.
 *
 * Customer counts span four orders of magnitude — a 3-customer line fault and a
 * 12,000-customer substation failure sit in the same feed — so a linear weight
 * would render the entire country invisible next to one bad day in Texas. The
 * log keeps a large outage clearly hotter than a small one without erasing it.
 * An outage with no count still registers: somebody has no power either way.
 */
function weightFor(outage: Outage): number {
  const customers = outage.customersAffected;
  if (customers === null || customers <= 0) return 0.35;
  return Math.min(1, Math.log10(customers + 1) / 4);
}

export function outagesToGeoJSON(outages: Outage[]) {
  return {
    type: "FeatureCollection" as const,
    features: outages.map((outage) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [outage.longitude, outage.latitude],
      },
      properties: { weight: weightFor(outage) },
    })),
  };
}

/**
 * Colour ramp, low to high density.
 *
 * Fixed hex rather than the theme's CSS custom properties: MapLibre paint
 * expressions are evaluated by the GL renderer, which cannot resolve a CSS
 * variable. These are picked to hold up on both the light and dark basemap —
 * amber through red, the same vocabulary the severity colours use, starting
 * fully transparent so low density fades into the map instead of banding.
 */
export const heatLayer: LayerProps = {
  id: "outage-heat",
  type: "heatmap",
  maxzoom: HEAT_MAX_ZOOM,
  paint: {
    "heatmap-weight": [
      "interpolate",
      ["linear"],
      ["get", "weight"],
      0,
      0.2,
      1,
      1,
    ],
    // Density reads differently as the points spread apart, so intensity rises
    // with zoom to keep the picture comparable rather than washing out.
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 7, 2.2],
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0,0,0,0)",
      0.15,
      "rgba(250, 204, 21, 0.45)",
      0.35,
      "rgba(251, 146, 60, 0.6)",
      0.6,
      "rgba(249, 115, 22, 0.75)",
      0.85,
      "rgba(239, 68, 68, 0.85)",
      1,
      "rgba(220, 38, 38, 0.95)",
    ],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 16, 5, 30, 7, 48],
    // Fades out as the marker layer fades in, so the handover is a crossfade
    // rather than a flash of bare map.
    "heatmap-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      0.85,
      MARKERS_MIN_ZOOM,
      0.7,
      HEAT_MAX_ZOOM,
      0,
    ],
  },
};
