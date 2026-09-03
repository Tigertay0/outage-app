import type { Provider, ServiceType, Severity } from "@/lib/types";

/**
 * Providers mirror the seed block in prisma/migrations/001_initial_schema.sql,
 * with stable ids so the local and Supabase repositories agree on identifiers
 * during development.
 */
const PROVIDER_ROWS: Array<[string, string, ServiceType]> = [
  ["att", "AT&T", "cellular"],
  ["verizon", "Verizon", "cellular"],
  ["tmobile", "T-Mobile", "cellular"],
  ["uscellular", "US Cellular", "cellular"],
  ["cricket", "Cricket Wireless", "cellular"],
  ["metro", "Metro by T-Mobile", "cellular"],
  ["xfinity", "Comcast / Xfinity", "internet"],
  ["spectrum", "Spectrum", "internet"],
  ["att-internet", "AT&T Internet", "internet"],
  ["fios", "Verizon Fios", "internet"],
  ["cox", "Cox", "internet"],
  ["centurylink", "CenturyLink", "internet"],
  ["google-fiber", "Google Fiber", "internet"],
  ["frontier", "Frontier", "internet"],
  ["coned", "Con Edison", "power"],
  ["pge", "PG&E", "power"],
  ["duke", "Duke Energy", "power"],
  ["oncor", "Oncor", "power"],
  ["fpl", "Florida Power & Light", "power"],
  ["local-power", "Local power company", "power"],
  ["water", "Municipal water", "other"],
  ["voip", "VoIP provider", "other"],
];

export const SEED_PROVIDERS: Provider[] = PROVIDER_ROWS.map(
  ([id, name, serviceType]) => ({
    id,
    name,
    serviceType,
    logoUrl: null,
    officialStatusUrl: null,
  }),
);

interface SeedOutage {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  providerId: string;
  serviceType: ServiceType;
  severity: Severity;
  /** Hours before "now" that this outage was reported. */
  agoHours: number;
  confirmations: number;
  description: string;
  /** Hours after "now" that service is expected back, if known. */
  etaHours?: number;
  resolvedAgoHours?: number;
}

/**
 * Demo data for the zero-configuration local mode. Clustered around real metros
 * so the map has something meaningful to show at every zoom level, which is the
 * whole point of the clustering behaviour in PRD section 4.1.
 */
export const SEED_OUTAGES: SeedOutage[] = [
  // New York metro: a dense cluster, the clustering showcase.
  { city: "New York", state: "NY", latitude: 40.7128, longitude: -74.006, providerId: "coned", serviceType: "power", severity: "complete", agoHours: 2.5, confirmations: 34, description: "Whole block dark since the transformer blew on Church St.", etaHours: 3 },
  { city: "New York", state: "NY", latitude: 40.7218, longitude: -73.9975, providerId: "coned", serviceType: "power", severity: "complete", agoHours: 2.2, confirmations: 18, description: "No power in SoHo, traffic lights out too." },
  { city: "Brooklyn", state: "NY", latitude: 40.6782, longitude: -73.9442, providerId: "xfinity", serviceType: "internet", severity: "complete", agoHours: 1.1, confirmations: 12, description: "Modem has been flashing orange for an hour." },
  { city: "Brooklyn", state: "NY", latitude: 40.6892, longitude: -73.9782, providerId: "spectrum", serviceType: "internet", severity: "degraded", agoHours: 4, confirmations: 6, description: "Speeds under 2 Mbps, video calls unusable." },
  { city: "Queens", state: "NY", latitude: 40.7282, longitude: -73.7949, providerId: "verizon", serviceType: "cellular", severity: "intermittent", agoHours: 0.6, confirmations: 3, description: "One bar, calls dropping every few minutes." },
  { city: "Jersey City", state: "NJ", latitude: 40.7178, longitude: -74.0431, providerId: "fios", serviceType: "internet", severity: "complete", agoHours: 6, confirmations: 21, description: "Fiber cut during roadwork on Grove St.", etaHours: 8 },

  // Bay Area
  { city: "San Francisco", state: "CA", latitude: 37.7749, longitude: -122.4194, providerId: "pge", serviceType: "power", severity: "complete", agoHours: 5, confirmations: 47, description: "Planned safety shutoff, whole neighborhood affected.", etaHours: 10 },
  { city: "San Francisco", state: "CA", latitude: 37.7849, longitude: -122.4094, providerId: "att", serviceType: "cellular", severity: "degraded", agoHours: 3, confirmations: 9, description: "Data barely works downtown, texts fine." },
  { city: "Oakland", state: "CA", latitude: 37.8044, longitude: -122.2712, providerId: "xfinity", serviceType: "internet", severity: "complete", agoHours: 0.4, confirmations: 4, description: "Just went out, no lights on the router at all." },
  { city: "Berkeley", state: "CA", latitude: 37.8715, longitude: -122.273, providerId: "pge", serviceType: "power", severity: "intermittent", agoHours: 7, confirmations: 5, description: "Lights flickering on and off since the storm started." },
  { city: "San Jose", state: "CA", latitude: 37.3382, longitude: -121.8863, providerId: "google-fiber", serviceType: "internet", severity: "degraded", agoHours: 9, confirmations: 7, description: "Packet loss on anything outside the local network." },

  // Texas
  { city: "Houston", state: "TX", latitude: 29.7604, longitude: -95.3698, providerId: "oncor", serviceType: "power", severity: "complete", agoHours: 12, confirmations: 63, description: "Storm knocked out lines across the east side.", etaHours: 6 },
  { city: "Houston", state: "TX", latitude: 29.7504, longitude: -95.3598, providerId: "tmobile", serviceType: "cellular", severity: "complete", agoHours: 11.5, confirmations: 28, description: "No service at all, likely tower on backup power." },
  { city: "Austin", state: "TX", latitude: 30.2672, longitude: -97.7431, providerId: "spectrum", serviceType: "internet", severity: "degraded", agoHours: 2, confirmations: 11, description: "Constant buffering, speed test shows 3 Mbps down." },
  { city: "Dallas", state: "TX", latitude: 32.7767, longitude: -96.797, providerId: "att-internet", serviceType: "internet", severity: "complete", agoHours: 1.5, confirmations: 16, description: "Out across several apartment buildings on Ross Ave." },

  // Florida
  { city: "Miami", state: "FL", latitude: 25.7617, longitude: -80.1918, providerId: "fpl", serviceType: "power", severity: "complete", agoHours: 8, confirmations: 52, description: "Power out since the squall came through.", etaHours: 4 },
  { city: "Miami", state: "FL", latitude: 25.7717, longitude: -80.1818, providerId: "cricket", serviceType: "cellular", severity: "intermittent", agoHours: 7.5, confirmations: 4, description: "Service comes and goes, mostly goes." },
  { city: "Orlando", state: "FL", latitude: 28.5383, longitude: -81.3792, providerId: "cox", serviceType: "internet", severity: "intermittent", agoHours: 5, confirmations: 3, description: "Drops for about a minute every half hour." },

  // Midwest and elsewhere, so the zoomed-out view is not all coastal.
  { city: "Chicago", state: "IL", latitude: 41.8781, longitude: -87.6298, providerId: "xfinity", serviceType: "internet", severity: "complete", agoHours: 3.5, confirmations: 24, description: "Whole building has no internet, provider confirms an area outage.", etaHours: 2 },
  { city: "Chicago", state: "IL", latitude: 41.8881, longitude: -87.6198, providerId: "duke", serviceType: "power", severity: "degraded", agoHours: 3, confirmations: 6, description: "Brownout, lights dim and the fridge keeps clicking." },
  { city: "Denver", state: "CO", latitude: 39.7392, longitude: -104.9903, providerId: "centurylink", serviceType: "internet", severity: "complete", agoHours: 4.5, confirmations: 13, description: "DSL sync light has been red all afternoon." },
  { city: "Seattle", state: "WA", latitude: 47.6062, longitude: -122.3321, providerId: "att", serviceType: "cellular", severity: "degraded", agoHours: 1.2, confirmations: 8, description: "Calls connect but audio cuts out both ways." },
  { city: "Atlanta", state: "GA", latitude: 33.749, longitude: -84.388, providerId: "duke", serviceType: "power", severity: "complete", agoHours: 0.8, confirmations: 15, description: "Transformer fire on Peachtree, fire department on scene." },
  { city: "Phoenix", state: "AZ", latitude: 33.4484, longitude: -112.074, providerId: "cox", serviceType: "internet", severity: "degraded", agoHours: 6.5, confirmations: 5, description: "Latency over 800ms, unusable for anything live." },
  { city: "Boston", state: "MA", latitude: 42.3601, longitude: -71.0589, providerId: "fios", serviceType: "internet", severity: "intermittent", agoHours: 2.8, confirmations: 2, description: "Cuts out for 30 seconds at a time." },
  { city: "Philadelphia", state: "PA", latitude: 39.9526, longitude: -75.1652, providerId: "verizon", serviceType: "cellular", severity: "complete", agoHours: 1.9, confirmations: 19, description: "No signal anywhere in Center City." },
  { city: "Portland", state: "OR", latitude: 45.5152, longitude: -122.6784, providerId: "water", serviceType: "other", severity: "complete", agoHours: 10, confirmations: 9, description: "Water main break, no supply on the block.", etaHours: 12 },
  { city: "Nashville", state: "TN", latitude: 36.1627, longitude: -86.7816, providerId: "local-power", serviceType: "power", severity: "intermittent", agoHours: 5.5, confirmations: 3, description: "Power blipping every so often since the wind picked up." },

  // Recently resolved, so the history and timeline views have content.
  { city: "Las Vegas", state: "NV", latitude: 36.1699, longitude: -115.1398, providerId: "spectrum", serviceType: "internet", severity: "complete", agoHours: 26, confirmations: 31, description: "Regional fiber fault.", resolvedAgoHours: 20 },
  { city: "San Diego", state: "CA", latitude: 32.7157, longitude: -117.1611, providerId: "tmobile", serviceType: "cellular", severity: "degraded", agoHours: 30, confirmations: 12, description: "Tower maintenance overnight.", resolvedAgoHours: 25 },
  { city: "Minneapolis", state: "MN", latitude: 44.9778, longitude: -93.265, providerId: "local-power", serviceType: "power", severity: "complete", agoHours: 48, confirmations: 40, description: "Ice brought down lines across the north side.", resolvedAgoHours: 38 },
];

const SEED_COMMENTS: Record<number, string[]> = {
  0: ["Same here on Church St, been out since about 2.", "Utility truck just pulled up."],
  6: ["This is the planned shutoff, they emailed about it yesterday.", "Still out as of just now."],
  11: ["Confirmed, whole east side is dark.", "Power came back for us but went out again 10 min later."],
  16: ["Ours came back around 20 minutes ago.", "Still out two streets over."],
};

export function commentsForSeedIndex(index: number): string[] {
  return SEED_COMMENTS[index] ?? [];
}
