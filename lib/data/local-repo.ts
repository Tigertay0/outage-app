import { randomUUID } from "node:crypto";
import { VERIFICATION_THRESHOLD } from "@/lib/constants";
import { isWithinBounds } from "@/lib/geo";
import type {
  CreateOutageInput,
  Outage,
  OutageComment,
  OutageDetail,
  OutageQuery,
  Provider,
  UserPreferences,
} from "@/lib/types";
import { DEFAULT_PREFERENCES, type Repository } from "./repository";
import { SEED_OUTAGES, SEED_PROVIDERS, commentsForSeedIndex } from "./seed";

/**
 * In-process repository so the app is usable with no Supabase project and no
 * API keys. Data lives for the lifetime of the server process; restarting
 * `next dev` re-seeds it.
 *
 * This is a development and demo backend, not a production one — it has no
 * durability and no cross-instance sharing. `getRepository()` prefers the
 * Supabase implementation whenever the environment is configured.
 */

interface Store {
  outages: Map<string, Outage>;
  comments: Map<string, OutageComment[]>;
  /** outageId -> set of identities that confirmed it. */
  confirmations: Map<string, Set<string>>;
  preferences: Map<string, UserPreferences>;
}

// Survives module reloads in dev, which otherwise wipe reports on every edit.
const globalStore = globalThis as unknown as { __outageStore?: Store };

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function hoursAhead(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function providerName(providerId: string | null): string | null {
  if (!providerId) return null;
  return SEED_PROVIDERS.find((p) => p.id === providerId)?.name ?? null;
}

function seed(): Store {
  const store: Store = {
    outages: new Map(),
    comments: new Map(),
    confirmations: new Map(),
    preferences: new Map(),
  };

  SEED_OUTAGES.forEach((row, index) => {
    const id = `seed-${index.toString().padStart(3, "0")}`;
    const resolved = row.resolvedAgoHours !== undefined;

    store.outages.set(id, {
      id,
      providerId: row.providerId,
      providerName: providerName(row.providerId),
      serviceType: row.serviceType,
      severity: row.severity,
      status: resolved ? "resolved" : "active",
      latitude: row.latitude,
      longitude: row.longitude,
      address: null,
      city: row.city,
      state: row.state,
      zipCode: null,
      description: row.description,
      reportedBy: null,
      reportedAt: hoursAgo(row.agoHours),
      resolvedAt: resolved ? hoursAgo(row.resolvedAgoHours!) : null,
      estimatedRestoration: row.etaHours ? hoursAhead(row.etaHours) : null,
      verificationCount: row.confirmations,
      isVerified: row.confirmations >= VERIFICATION_THRESHOLD,
    });

    // Seeded confirmations are attributed to synthetic identities so the
    // "already confirmed" check behaves correctly for the real visitor.
    const confirmers = new Set<string>();
    for (let i = 0; i < row.confirmations; i += 1) {
      confirmers.add(`seed-user-${index}-${i}`);
    }
    store.confirmations.set(id, confirmers);

    const comments = commentsForSeedIndex(index).map((text, i) => ({
      id: `${id}-c${i}`,
      outageId: id,
      userId: `seed-user-${index}-${i}`,
      authorLabel: "Neighbor",
      comment: text,
      commentType: "update" as const,
      createdAt: hoursAgo(Math.max(0.1, row.agoHours - (i + 1) * 0.4)),
    }));
    if (comments.length > 0) store.comments.set(id, comments);
  });

  return store;
}

function getStore(): Store {
  if (!globalStore.__outageStore) {
    globalStore.__outageStore = seed();
  }
  return globalStore.__outageStore;
}

function matches(outage: Outage, query: OutageQuery): boolean {
  if (query.bounds && !isWithinBounds(outage, query.bounds)) return false;

  if (query.serviceTypes && !query.serviceTypes.includes(outage.serviceType)) {
    return false;
  }
  if (query.severities && !query.severities.includes(outage.severity)) {
    return false;
  }
  if (
    query.providerIds &&
    query.providerIds.length > 0 &&
    (!outage.providerId || !query.providerIds.includes(outage.providerId))
  ) {
    return false;
  }

  if (outage.status === "active") return true;

  if (outage.status === "resolved") {
    const window = query.includeResolvedHours ?? 0;
    if (window <= 0) return false;
    if (!outage.resolvedAt) return false;
    return Date.now() - Date.parse(outage.resolvedAt) <= window * 3_600_000;
  }

  return false;
}

export class LocalRepository implements Repository {
  readonly kind = "local" as const;

  async listProviders(): Promise<Provider[]> {
    return SEED_PROVIDERS;
  }

  async listOutages(query: OutageQuery): Promise<Outage[]> {
    const store = getStore();
    const results = [...store.outages.values()].filter((o) => matches(o, query));

    results.sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt));

    return query.limit ? results.slice(0, query.limit) : results;
  }

  async getOutage(
    id: string,
    identity: string | null,
  ): Promise<OutageDetail | null> {
    const store = getStore();
    const outage = store.outages.get(id);
    if (!outage) return null;

    const comments = [...(store.comments.get(id) ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );

    return {
      ...outage,
      comments,
      confirmedByMe: identity
        ? (store.confirmations.get(id)?.has(identity) ?? false)
        : false,
    };
  }

  async createOutage(
    input: CreateOutageInput,
    identity: string,
  ): Promise<Outage> {
    const store = getStore();
    const id = randomUUID();

    const outage: Outage = {
      id,
      providerId: input.providerId,
      providerName: providerName(input.providerId),
      serviceType: input.serviceType,
      severity: input.severity,
      status: "active",
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zipCode: input.zipCode ?? null,
      description: input.description ?? null,
      reportedBy: identity,
      reportedAt: new Date().toISOString(),
      resolvedAt: null,
      estimatedRestoration: input.estimatedRestoration ?? null,
      // The reporter implicitly confirms their own report.
      verificationCount: 1,
      isVerified: false,
    };

    store.outages.set(id, outage);
    store.confirmations.set(id, new Set([identity]));
    return outage;
  }

  async confirmOutage(id: string, identity: string): Promise<number | null> {
    const store = getStore();
    const outage = store.outages.get(id);
    if (!outage) return null;

    const confirmers = store.confirmations.get(id) ?? new Set<string>();
    confirmers.add(identity);
    store.confirmations.set(id, confirmers);

    return this.syncVerification(id, confirmers.size);
  }

  async unconfirmOutage(id: string, identity: string): Promise<number | null> {
    const store = getStore();
    const outage = store.outages.get(id);
    if (!outage) return null;

    const confirmers = store.confirmations.get(id) ?? new Set<string>();
    confirmers.delete(identity);
    store.confirmations.set(id, confirmers);

    return this.syncVerification(id, confirmers.size);
  }

  private syncVerification(id: string, count: number): number {
    const store = getStore();
    const outage = store.outages.get(id)!;
    store.outages.set(id, {
      ...outage,
      verificationCount: count,
      isVerified: count >= VERIFICATION_THRESHOLD,
    });
    return count;
  }

  async addComment(
    outageId: string,
    identity: string,
    comment: string,
    commentType: OutageComment["commentType"],
  ): Promise<OutageComment | null> {
    const store = getStore();
    if (!store.outages.has(outageId)) return null;

    const entry: OutageComment = {
      id: randomUUID(),
      outageId,
      userId: identity,
      authorLabel: "You",
      comment,
      commentType,
      createdAt: new Date().toISOString(),
    };

    store.comments.set(outageId, [...(store.comments.get(outageId) ?? []), entry]);
    return entry;
  }

  async resolveOutage(id: string, identity: string): Promise<Outage | null> {
    const store = getStore();
    const outage = store.outages.get(id);
    if (!outage) return null;

    const resolved: Outage = {
      ...outage,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    };
    store.outages.set(id, resolved);

    await this.addComment(id, identity, "Service is back for me.", "resolution");
    return resolved;
  }

  async getPreferences(identity: string): Promise<UserPreferences | null> {
    return getStore().preferences.get(identity) ?? null;
  }

  async savePreferences(
    identity: string,
    preferences: UserPreferences,
  ): Promise<UserPreferences> {
    const merged = { ...DEFAULT_PREFERENCES, ...preferences };
    getStore().preferences.set(identity, merged);
    return merged;
  }
}
