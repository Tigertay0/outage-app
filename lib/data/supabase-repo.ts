import { VERIFICATION_THRESHOLD } from "@/lib/constants";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type {
  CreateOutageInput,
  Outage,
  OutageComment,
  OutageDetail,
  OutageQuery,
  Provider,
  ServiceType,
  Severity,
  UserPreferences,
} from "@/lib/types";
import { DEFAULT_PREFERENCES, type Repository } from "./repository";

/**
 * Supabase/PostGIS backend. Requires migrations 001 and 002 to be applied.
 *
 * Everything goes through the SSR client, so Row Level Security applies with
 * the caller's session — the service-role client is deliberately not used here.
 */

/** Row shape returned by the search_outages RPC (migration 002). */
interface SearchRow {
  id: string;
  provider_id: string | null;
  provider_slug: string | null;
  provider_name: string | null;
  service_type: ServiceType;
  severity: Severity;
  status: Outage["status"];
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  description: string | null;
  reported_by: string | null;
  reported_at: string;
  resolved_at: string | null;
  estimated_restoration: string | null;
  verification_count: number;
  is_verified: boolean;
}

function toOutage(row: SearchRow): Outage {
  return {
    id: row.id,
    // The app addresses providers by slug; the UUID stays server-side.
    providerId: row.provider_slug,
    providerName: row.provider_name,
    serviceType: row.service_type,
    severity: row.severity,
    status: row.status,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    description: row.description,
    reportedBy: row.reported_by,
    reportedAt: row.reported_at,
    resolvedAt: row.resolved_at,
    estimatedRestoration: row.estimated_restoration,
    verificationCount: row.verification_count,
    isVerified: row.is_verified,
  };
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;

  private async client() {
    return createServerSupabaseClient();
  }

  /** Slug -> UUID, needed because writes still reference the real key. */
  private async providerUuid(slug: string | null): Promise<string | null> {
    if (!slug) return null;

    const supabase = await this.client();
    const { data } = await supabase
      .from("providers")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    return (data as { id: string } | null)?.id ?? null;
  }

  async listProviders(): Promise<Provider[]> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from("providers")
      .select("slug, name, service_type, logo_url, official_status_url")
      .order("name");

    if (error) throw new Error(`listProviders: ${error.message}`);

    return (data ?? []).map((row) => {
      const r = row as {
        slug: string;
        name: string;
        service_type: ServiceType;
        logo_url: string | null;
        official_status_url: string | null;
      };
      return {
        id: r.slug,
        name: r.name,
        serviceType: r.service_type,
        logoUrl: r.logo_url,
        officialStatusUrl: r.official_status_url,
      };
    });
  }

  async listOutages(query: OutageQuery): Promise<Outage[]> {
    const supabase = await this.client();
    const bounds = query.bounds;

    const { data, error } = await supabase.rpc("search_outages", {
      min_lat: bounds?.minLat ?? -90,
      min_lng: bounds?.minLng ?? -180,
      max_lat: bounds?.maxLat ?? 90,
      max_lng: bounds?.maxLng ?? 180,
      service_types: query.serviceTypes ?? null,
      provider_slugs:
        query.providerIds && query.providerIds.length > 0
          ? query.providerIds
          : null,
      severities: query.severities ?? null,
      resolved_within_hours: query.includeResolvedHours ?? 0,
      max_results: query.limit ?? 1000,
    });

    if (error) throw new Error(`listOutages: ${error.message}`);
    return ((data ?? []) as SearchRow[]).map(toOutage);
  }

  async getOutage(
    id: string,
    identity: string | null,
  ): Promise<OutageDetail | null> {
    const supabase = await this.client();

    const [{ data: rows }, { data: commentRows }, { data: mine }] =
      await Promise.all([
        // outage_ids bypasses the viewport and status filters, so a resolved
        // outage opened from a link or a notification still loads.
        supabase.rpc("search_outages", { outage_ids: [id], max_results: 1 }),
        supabase
          .from("outage_comments")
          .select("id, outage_id, user_id, comment, comment_type, created_at")
          .eq("outage_id", id)
          .order("created_at"),
        identity
          ? supabase
              .from("outage_confirmations")
              .select("id")
              .eq("outage_id", id)
              .eq("user_id", identity)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    const row = ((rows ?? []) as SearchRow[])[0];
    if (!row) return null;

    const comments: OutageComment[] = (commentRows ?? []).map((c) => {
      const r = c as {
        id: string;
        outage_id: string;
        user_id: string | null;
        comment: string;
        comment_type: OutageComment["commentType"];
        created_at: string;
      };
      return {
        id: r.id,
        outageId: r.outage_id,
        userId: r.user_id,
        authorLabel: r.user_id === identity ? "You" : "Neighbor",
        comment: r.comment,
        commentType: r.comment_type,
        createdAt: r.created_at,
      };
    });

    return { ...toOutage(row), comments, confirmedByMe: Boolean(mine) };
  }

  async createOutage(
    input: CreateOutageInput,
    identity: string,
  ): Promise<Outage> {
    const supabase = await this.client();
    const providerUuid = await this.providerUuid(input.providerId);

    const { data, error } = await supabase
      .from("outages")
      .insert({
        provider_id: providerUuid,
        service_type: input.serviceType,
        severity: input.severity,
        status: "active",
        // PostGIS accepts EWKT for a geography column.
        location: `SRID=4326;POINT(${input.longitude} ${input.latitude})`,
        address: input.address ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        zip_code: input.zipCode ?? null,
        description: input.description ?? null,
        reported_by: identity,
        estimated_restoration: input.estimatedRestoration ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`createOutage: ${error.message}`);

    const id = (data as { id: string }).id;

    // The reporter implicitly confirms their own report, which also fires the
    // verification trigger and sets verification_count to 1.
    await supabase
      .from("outage_confirmations")
      .insert({ outage_id: id, user_id: identity });

    const created = await this.getOutage(id, identity);
    if (!created) throw new Error("createOutage: row vanished after insert");
    return created;
  }

  async confirmOutage(id: string, identity: string): Promise<number | null> {
    const supabase = await this.client();

    const { error } = await supabase
      .from("outage_confirmations")
      .upsert({ outage_id: id, user_id: identity }, {
        onConflict: "outage_id,user_id",
        ignoreDuplicates: true,
      });

    if (error) throw new Error(`confirmOutage: ${error.message}`);
    return this.confirmationCount(id);
  }

  async unconfirmOutage(id: string, identity: string): Promise<number | null> {
    const supabase = await this.client();

    const { error } = await supabase
      .from("outage_confirmations")
      .delete()
      .eq("outage_id", id)
      .eq("user_id", identity);

    if (error) throw new Error(`unconfirmOutage: ${error.message}`);
    return this.confirmationCount(id);
  }

  private async confirmationCount(id: string): Promise<number | null> {
    const supabase = await this.client();
    const { count, error } = await supabase
      .from("outage_confirmations")
      .select("id", { count: "exact", head: true })
      .eq("outage_id", id);

    if (error) throw new Error(`confirmationCount: ${error.message}`);
    return count ?? 0;
  }

  async addComment(
    outageId: string,
    identity: string,
    comment: string,
    commentType: OutageComment["commentType"],
  ): Promise<OutageComment | null> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from("outage_comments")
      .insert({
        outage_id: outageId,
        user_id: identity,
        comment,
        comment_type: commentType,
      })
      .select("id, outage_id, user_id, comment, comment_type, created_at")
      .single();

    if (error) throw new Error(`addComment: ${error.message}`);

    const r = data as {
      id: string;
      outage_id: string;
      user_id: string | null;
      comment: string;
      comment_type: OutageComment["commentType"];
      created_at: string;
    };

    return {
      id: r.id,
      outageId: r.outage_id,
      userId: r.user_id,
      authorLabel: "You",
      comment: r.comment,
      commentType: r.comment_type,
      createdAt: r.created_at,
    };
  }

  async resolveOutage(id: string, identity: string): Promise<Outage | null> {
    const supabase = await this.client();

    // A vote, not a unilateral flip: the trigger in migration 002 decides when
    // enough people agree to actually change the status.
    const { error } = await supabase
      .from("outage_resolutions")
      .upsert({ outage_id: id, user_id: identity }, {
        onConflict: "outage_id,user_id",
        ignoreDuplicates: true,
      });

    if (error) throw new Error(`resolveOutage: ${error.message}`);

    await this.addComment(id, identity, "Service is back for me.", "resolution");
    return this.getOutage(id, identity);
  }

  async getPreferences(identity: string): Promise<UserPreferences | null> {
    const supabase = await this.client();

    const { data } = await supabase
      .from("user_preferences")
      .select("saved_providers, saved_locations, notification_settings, default_zoom")
      .eq("user_id", identity)
      .maybeSingle();

    if (!data) return null;

    const row = data as {
      saved_providers: string[] | null;
      saved_locations: UserPreferences["savedLocations"] | null;
      notification_settings: Partial<UserPreferences["notifications"]> | null;
      default_zoom: number | null;
    };

    return {
      ...DEFAULT_PREFERENCES,
      providerIds: row.saved_providers ?? [],
      savedLocations: row.saved_locations ?? [],
      notifications: {
        ...DEFAULT_PREFERENCES.notifications,
        ...(row.notification_settings ?? {}),
      },
    };
  }

  async savePreferences(
    identity: string,
    preferences: UserPreferences,
  ): Promise<UserPreferences> {
    const supabase = await this.client();

    // saved_locations and notification_settings are jsonb columns; the generated
    // types call them Json, which our structured shapes satisfy structurally but
    // TypeScript will not infer without the cast.
    const { error } = await supabase.from("user_preferences").upsert(
      {
        user_id: identity,
        saved_providers: preferences.providerIds,
        saved_locations: preferences.savedLocations as unknown as Json,
        notification_settings: preferences.notifications as unknown as Json,
      },
      { onConflict: "user_id" },
    );

    if (error) throw new Error(`savePreferences: ${error.message}`);
    return preferences;
  }
}

export { VERIFICATION_THRESHOLD };
