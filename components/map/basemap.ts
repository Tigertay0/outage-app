import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap styles.
 *
 * MapLibre + OpenFreeMap needs no access token and has no request quota, which
 * is why this app does not depend on Mapbox. If you would rather use a hosted
 * provider, set NEXT_PUBLIC_MAP_STYLE_URL (and its dark counterpart) to any
 * style URL and nothing else has to change.
 *
 * Positron and its dark sibling are deliberately low-contrast greyscale: the
 * outage markers are the only saturated colour on screen, so severity reads at
 * a glance instead of competing with the map.
 */

const LIGHT =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/positron";

const DARK =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK ??
  "https://tiles.openfreemap.org/styles/dark";

export function basemapUrl(theme: "light" | "dark"): string {
  return theme === "dark" ? DARK : LIGHT;
}

/**
 * A minimal offline style, used when the tile host cannot be reached. Markers,
 * clustering and every interaction still work against a blank canvas — the app
 * degrades to "no pretty backdrop" rather than to a broken page.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#9aa0a6" },
    },
  ],
};
