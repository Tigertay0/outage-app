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

/** Parse "minLng,minLat,maxLng,maxLat" as used by the /api/outages query. */
export function parseBboxParam(raw: string | null): BoundingBox | undefined {
  if (!raw) return undefined;

  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLng, minLat, maxLng, maxLat };
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return "nearby";
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}
