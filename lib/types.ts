/**
 * Domain types shared by the API routes, the data layer and the UI.
 *
 * These are deliberately independent of the Supabase-generated row types: the
 * local (no-database) repository has to satisfy the same shapes, and the API
 * responses are what the client actually consumes.
 */

export const SERVICE_TYPES = ["power", "internet", "cellular", "other"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SEVERITIES = ["complete", "degraded", "intermittent"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["active", "resolved", "disputed"] as const;
export type OutageStatus = (typeof STATUSES)[number];

export type CommentType = "update" | "resolution" | "escalation";

export interface Provider {
  id: string;
  name: string;
  serviceType: ServiceType;
  logoUrl: string | null;
  officialStatusUrl: string | null;
}

export interface Outage {
  id: string;
  providerId: string | null;
  providerName: string | null;
  serviceType: ServiceType;
  severity: Severity;
  status: OutageStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  description: string | null;
  reportedBy: string | null;
  reportedAt: string;
  resolvedAt: string | null;
  estimatedRestoration: string | null;
  verificationCount: number;
  isVerified: boolean;
  origin: OutageOrigin;
  /** Which feed produced this, when origin is "official". */
  sourceName: string | null;
}

export interface OutageComment {
  id: string;
  outageId: string;
  userId: string | null;
  authorLabel: string;
  comment: string;
  commentType: CommentType;
  createdAt: string;
}

/** An outage plus everything the detail sheet needs, in one round trip. */
export interface OutageDetail extends Outage {
  comments: OutageComment[];
  /** Whether the requesting identity has already confirmed this outage. */
  confirmedByMe: boolean;
}

/** Where an outage came from: a person, or an upstream feed. */
export type OutageOrigin = "crowdsourced" | "official";

/**
 * A hazard that causes outages rather than an outage itself — a storm warning,
 * say. Kept apart from Outage so the map never implies someone has lost service
 * where nobody has reported losing it.
 */
export interface Advisory {
  id: string;
  sourceName: string;
  sourceId: string;
  /** Upstream event name, e.g. "High Wind Warning". */
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

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface OutageQuery {
  bounds?: BoundingBox;
  serviceTypes?: ServiceType[];
  providerIds?: string[];
  severities?: Severity[];
  /** Include outages resolved within the last N hours (0 = active only). */
  includeResolvedHours?: number;
  limit?: number;
}

export interface CreateOutageInput {
  providerId: string | null;
  serviceType: ServiceType;
  severity: Severity;
  latitude: number;
  longitude: number;
  description?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  estimatedRestoration?: string | null;
}

export interface UserPreferences {
  serviceTypes: ServiceType[];
  providerIds: string[];
  severities: Severity[];
  savedLocations: SavedLocation[];
  notifications: NotificationSettings;
  defaultCenter: { latitude: number; longitude: number; zoom: number } | null;
}

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface NotificationSettings {
  enabled: boolean;
  severityThreshold: Severity;
  radiusMiles: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface GeocodeResult {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  /** Suggested map zoom for this result's granularity. */
  zoom: number;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

/** Timeline events are derived, not stored — see lib/timeline.ts. */
export interface TimelineEvent {
  id: string;
  at: string;
  kind: "reported" | "verified" | "comment" | "resolution" | "escalation" | "eta";
  title: string;
  detail?: string | null;
}
