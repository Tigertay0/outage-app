import type { NextRequest } from "next/server";
import { badRequest, ok, serverError, tooMany } from "@/lib/api";
import { getIdentity } from "@/lib/identity";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import type { GeocodeResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Geocoding proxy (PRD section 4.4).
 *
 * Uses OpenStreetMap's Nominatim, which needs no API key. It is proxied rather
 * than called from the browser for three reasons: Nominatim requires an
 * identifying User-Agent, its usage policy caps request rate per source, and
 * keeping it server-side means the user's typed address never appears in a
 * third-party request that carries their referrer.
 *
 * For production traffic, swap NOMINATIM_BASE for a self-hosted instance or a
 * commercial geocoder; nothing else in the app changes.
 */

const NOMINATIM_BASE =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";

const USER_AGENT =
  process.env.GEOCODER_USER_AGENT ??
  "OutageTracker/1.0 (https://github.com/Tigertay0/outage-app)";

interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    road?: string;
    house_number?: string;
  };
}

/**
 * Zoom appropriate to how specific the matched place is.
 *
 * Biased one or two levels wider than the place's literal extent. Landing on
 * the exact centroid of a neighbourhood at street level usually shows an empty
 * map even when there are outages a mile away, and "no outages" is the wrong
 * answer to give someone who just searched their own city.
 */
function zoomForType(type: string | undefined): number {
  switch (type) {
    case "house":
    case "building":
    case "address":
      return 16;
    case "road":
      return 14;
    case "postcode":
    case "suburb":
    case "neighbourhood":
    case "village":
      return 13;
    case "city":
    case "town":
      return 11;
    case "county":
      return 9;
    case "state":
      return 6;
    default:
      return 12;
  }
}

function toResult(place: NominatimPlace): GeocodeResult {
  const address = place.address ?? {};
  return {
    id: String(place.place_id),
    label: place.display_name,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    zoom: zoomForType(place.addresstype ?? place.type),
    city: address.city ?? address.town ?? address.village ?? null,
    state: address.state ?? null,
    zipCode: address.postcode ?? null,
  };
}

async function callNominatim(path: string, params: URLSearchParams) {
  const response = await fetch(`${NOMINATIM_BASE}${path}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // Nominatim results are stable enough to cache at the edge for a while.
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Nominatim responded ${response.status}`);
  }
  return response.json();
}

/**
 * GET /api/geocode?q=90210        forward search, returns up to 5 suggestions
 * GET /api/geocode?lat=..&lng=..  reverse lookup, returns 0 or 1 result
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await getIdentity();
    const limit = rateLimit(
      `geocode:${identity.id}`,
      LIMITS.geocode.limit,
      LIMITS.geocode.windowMs,
    );
    if (!limit.allowed) return tooMany(limit);

    const params = request.nextUrl.searchParams;
    const lat = params.get("lat");
    const lng = params.get("lng");

    if (lat && lng) {
      const latitude = Number(lat);
      const longitude = Number(lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return badRequest("lat and lng must be numbers");
      }

      const place = (await callNominatim(
        "/reverse",
        new URLSearchParams({
          lat: String(latitude),
          lon: String(longitude),
          format: "jsonv2",
          zoom: "18",
          addressdetails: "1",
        }),
      )) as NominatimPlace & { error?: string };

      if (!place || place.error) return ok({ results: [] });
      return ok({ results: [toResult(place)] });
    }

    const query = params.get("q")?.trim();
    if (!query) return badRequest("Provide q, or lat and lng");
    if (query.length < 2) return ok({ results: [] });

    const places = (await callNominatim(
      "/search",
      new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: "5",
        addressdetails: "1",
        countrycodes: process.env.GEOCODER_COUNTRY_CODES ?? "us",
      }),
    )) as NominatimPlace[];

    return ok({ results: (places ?? []).map(toResult) });
  } catch (error) {
    return serverError(error, "GET /api/geocode");
  }
}
