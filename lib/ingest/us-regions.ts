import "server-only";

/**
 * Centroids for US states, keyed by the name IODA uses for the region.
 *
 * IODA identifies a region by an opaque numeric code and a display name, and
 * carries no geometry, so a region-level outage has nowhere to sit on the map
 * without this table. Values are the geographic centre of each state, rounded
 * to three decimals — about 100m, far finer than a state-sized event needs.
 */
export const US_STATE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  Alabama: { lat: 32.789, lng: -86.829 },
  Alaska: { lat: 64.045, lng: -152.271 },
  Arizona: { lat: 34.293, lng: -111.664 },
  Arkansas: { lat: 34.899, lng: -92.439 },
  California: { lat: 37.181, lng: -119.468 },
  Colorado: { lat: 38.998, lng: -105.548 },
  Connecticut: { lat: 41.62, lng: -72.727 },
  Delaware: { lat: 38.993, lng: -75.507 },
  "District of Columbia": { lat: 38.905, lng: -77.016 },
  Florida: { lat: 28.628, lng: -82.445 },
  Georgia: { lat: 32.649, lng: -83.443 },
  Hawaii: { lat: 20.293, lng: -156.368 },
  Idaho: { lat: 44.389, lng: -114.659 },
  Illinois: { lat: 40.065, lng: -89.199 },
  Indiana: { lat: 39.907, lng: -86.276 },
  Iowa: { lat: 42.075, lng: -93.497 },
  Kansas: { lat: 38.484, lng: -98.38 },
  Kentucky: { lat: 37.527, lng: -85.292 },
  Louisiana: { lat: 31.049, lng: -91.996 },
  Maine: { lat: 45.368, lng: -69.238 },
  Maryland: { lat: 39.056, lng: -76.791 },
  Massachusetts: { lat: 42.259, lng: -71.799 },
  Michigan: { lat: 44.345, lng: -85.412 },
  Minnesota: { lat: 46.281, lng: -94.309 },
  Mississippi: { lat: 32.742, lng: -89.662 },
  Missouri: { lat: 38.365, lng: -92.478 },
  Montana: { lat: 47.034, lng: -109.645 },
  Nebraska: { lat: 41.527, lng: -99.811 },
  Nevada: { lat: 39.356, lng: -116.663 },
  "New Hampshire": { lat: 43.686, lng: -71.578 },
  "New Jersey": { lat: 40.191, lng: -74.67 },
  "New Mexico": { lat: 34.421, lng: -106.108 },
  "New York": { lat: 42.954, lng: -75.526 },
  "North Carolina": { lat: 35.56, lng: -79.389 },
  "North Dakota": { lat: 47.447, lng: -100.469 },
  Ohio: { lat: 40.293, lng: -82.791 },
  Oklahoma: { lat: 35.591, lng: -97.494 },
  Oregon: { lat: 43.937, lng: -120.558 },
  Pennsylvania: { lat: 40.874, lng: -77.799 },
  "Puerto Rico": { lat: 18.22, lng: -66.591 },
  "Rhode Island": { lat: 41.676, lng: -71.556 },
  "South Carolina": { lat: 33.858, lng: -80.945 },
  "South Dakota": { lat: 44.437, lng: -100.229 },
  Tennessee: { lat: 35.855, lng: -86.351 },
  Texas: { lat: 31.464, lng: -99.331 },
  Utah: { lat: 39.325, lng: -111.679 },
  Vermont: { lat: 44.076, lng: -72.665 },
  Virginia: { lat: 37.521, lng: -78.849 },
  Washington: { lat: 47.381, lng: -120.451 },
  "West Virginia": { lat: 38.642, lng: -80.622 },
  Wisconsin: { lat: 44.639, lng: -89.771 },
  Wyoming: { lat: 42.999, lng: -107.551 },
};
