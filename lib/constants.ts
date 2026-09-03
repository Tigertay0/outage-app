import type { ServiceType, Severity } from "./types";

/** Confirmations required before an outage is badged as verified. */
export const VERIFICATION_THRESHOLD = 5;

/** Zoom at which clusters give way to individual markers (PRD §4.1 "Level 3"). */
export const MARKER_ZOOM = 13;

export const DEFAULT_VIEW = {
  latitude: 39.8283,
  longitude: -98.5795, // Geographic centre of the contiguous US.
  zoom: 3.6,
};

/**
 * Fitted on load instead of using DEFAULT_VIEW's fixed zoom, so a phone in
 * portrait and a desktop window both open showing the whole country rather
 * than an arbitrary crop of the Midwest. [west, south, east, north]
 */
export const HOME_BOUNDS: [number, number, number, number] = [
  -125.0, 24.4, -66.9, 49.4,
];

export const SERVICE_META: Record<
  ServiceType,
  { label: string; shortLabel: string; icon: string }
> = {
  power: { label: "Power", shortLabel: "Power", icon: "zap" },
  internet: { label: "Internet / WiFi", shortLabel: "Internet", icon: "wifi" },
  cellular: { label: "Cellular", shortLabel: "Cellular", icon: "signal" },
  other: { label: "Other services", shortLabel: "Other", icon: "circle-help" },
};

export const SEVERITY_META: Record<
  Severity,
  { label: string; description: string; rank: number; token: string }
> = {
  complete: {
    label: "Complete outage",
    description: "Service is entirely down",
    rank: 3,
    token: "var(--severity-complete)",
  },
  degraded: {
    label: "Degraded",
    description: "Working, but slow or unreliable",
    rank: 2,
    token: "var(--severity-degraded)",
  },
  intermittent: {
    label: "Intermittent",
    description: "Cuts out and comes back",
    rank: 1,
    token: "var(--severity-intermittent)",
  },
};

/** Highest severity in a set — drives cluster colour. */
export function dominantSeverity(severities: Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, s) => (SEVERITY_META[s].rank > SEVERITY_META[worst].rank ? s : worst),
    "intermittent",
  );
}

export const MILES_TO_METERS = 1609.344;
