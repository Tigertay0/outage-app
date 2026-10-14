import { MILES_TO_METERS } from "./constants";
import type { BoundingBox } from "./types";

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isWithinBounds(
  point: { latitude: number; longitude: number },
  bounds: BoundingBox,
): boolean {
  if (point.latitude < bounds.minLat || point.latitude > bounds.maxLat) {
    return false;
  }

  // A viewport that crosses the antimeridian arrives with minLng > maxLng.
  if (bounds.minLng <= bounds.maxLng) {
    return point.longitude >= bounds.minLng && point.longitude <= bounds.maxLng;
  }
  return point.longitude >= bounds.minLng || point.longitude <= bounds.maxLng;
}

export const WORLD_BOUNDS: BoundingBox = {
  minLng: -180,
  minLat: -90,
  maxLng: 180,
  maxLat: 90,
};

const mod360 = (n: number) => ((n % 360) + 360) % 360;

/**
 * Put a viewport into the form search_outages / search_advisories expect:
 * latitudes within [-90, 90], longitudes within [-180, 180], and anything
 * covering every longitude as the whole world.
 *
 * MapLibre's getBounds() is not wrapped. Zoomed out it reports spans like
 * -250..250, and a view over the Pacific reports 170..200. Clamping those
 * would drop part of the view, so longitudes are wrapped instead. A view that
 * then crosses the antimeridian comes out with minLng > maxLng, which the SQL
 * functions (migration 011) and isWithinBounds both read as "wraps around".
 */
export function normalizeBounds(bounds: BoundingBox): BoundingBox {
  const minLat = Math.max(-90, Math.min(bounds.minLat, bounds.maxLat));
  const maxLat = Math.min(90, Math.max(bounds.minLat, bounds.maxLat));

  const span =
    bounds.minLng <= bounds.maxLng
      ? bounds.maxLng - bounds.minLng
      : bounds.maxLng - bounds.minLng + 360;
  if (span >= 360) {
    return { ...WORLD_BOUNDS, minLat, maxLat };
  }

  if (bounds.minLng >= -180 && bounds.maxLng <= 180) {
    return { ...bounds, minLat, maxLat };
  }

  // West edge into [-180, 180), east edge into (-180, 180], so a box ending
  // exactly on the antimeridian keeps 180 rather than flipping to -180.
  const minLng = mod360(bounds.minLng + 180) - 180;
  const maxLng = 180 - mod360(180 - bounds.maxLng);
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Parse "minLng,minLat,maxLng,maxLat" as used by the /api/outages query.
 * Missing or malformed means no viewport filter.
 */
export function parseBboxParam(raw: string | null): BoundingBox | undefined {
  if (!raw) return undefined;

  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  return normalizeBounds({ minLng, minLat, maxLng, maxLat });
}

export function formatDistance(meters: number): string {
  const miles = meters / MILES_TO_METERS;
  if (miles < 0.1) return "nearby";
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}
