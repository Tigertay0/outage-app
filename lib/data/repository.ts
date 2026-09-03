import type {
  CreateOutageInput,
  Outage,
  OutageComment,
  OutageDetail,
  OutageQuery,
  Provider,
  UserPreferences,
} from "@/lib/types";

/**
 * The storage contract every backend must satisfy.
 *
 * Two implementations exist:
 *   - SupabaseRepository — Postgres + PostGIS, used when the project is configured.
 *   - LocalRepository    — in-process seeded store, so the app runs with no setup.
 *
 * `identity` is whoever is acting: a Supabase user id when signed in, or an
 * anonymous per-browser id issued by the guest cookie. Both are opaque strings
 * here; only the confirmation-uniqueness rule cares about them.
 */
export interface Repository {
  readonly kind: "supabase" | "local";

  listProviders(): Promise<Provider[]>;

  listOutages(query: OutageQuery): Promise<Outage[]>;

  getOutage(id: string, identity: string | null): Promise<OutageDetail | null>;

  createOutage(input: CreateOutageInput, identity: string): Promise<Outage>;

  /** Returns the new confirmation count, or null if the outage is gone. */
  confirmOutage(id: string, identity: string): Promise<number | null>;

  unconfirmOutage(id: string, identity: string): Promise<number | null>;

  addComment(
    outageId: string,
    identity: string,
    comment: string,
    commentType: OutageComment["commentType"],
  ): Promise<OutageComment | null>;

  /** Marks an outage resolved. Records who reported the restoration. */
  resolveOutage(id: string, identity: string): Promise<Outage | null>;

  getPreferences(identity: string): Promise<UserPreferences | null>;

  savePreferences(
    identity: string,
    preferences: UserPreferences,
  ): Promise<UserPreferences>;
}

/**
 * The caller sent something the backend cannot accept — an unknown provider,
 * say. Distinct from a genuine failure so the API layer can answer 400 instead
 * of 500: the request is wrong, not the server.
 */
export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  serviceTypes: ["power", "internet", "cellular", "other"],
  providerIds: [],
  severities: ["complete", "degraded", "intermittent"],
  savedLocations: [],
  notifications: {
    enabled: false,
    severityThreshold: "complete",
    radiusMiles: 5,
    quietHoursStart: null,
    quietHoursEnd: null,
  },
  defaultCenter: null,
};
