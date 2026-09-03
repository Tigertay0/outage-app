"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFilters } from "@/lib/store/filters";
import type {
  BoundingBox,
  CreateOutageInput,
  Outage,
  OutageComment,
  OutageDetail,
  Provider,
} from "@/lib/types";

/** Thin fetch wrapper that surfaces the API's error message to the caller. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (body as { error?: string }).error ?? `Request failed (${response.status})`,
    );
  }
  return body as T;
}

/**
 * Round the viewport before it becomes a cache key. Panning by a few pixels
 * would otherwise miss the cache on every frame; three decimals is roughly
 * 100m, far finer than the map ever needs.
 */
function roundBounds(bounds: BoundingBox): BoundingBox {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    minLat: r(bounds.minLat),
    minLng: r(bounds.minLng),
    maxLat: r(bounds.maxLat),
    maxLng: r(bounds.maxLng),
  };
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => request<{ providers: Provider[] }>("/api/providers"),
    staleTime: 60 * 60 * 1000,
    select: (data) => data.providers,
  });
}

export interface SessionInfo {
  identity: {
    id: string;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    email: string | null;
  };
  capabilities: {
    accounts: boolean;
    push: boolean;
    demoData: boolean;
    /** False when the backend cannot accept writes from this visitor. */
    write: boolean;
    /** Why, when write is false. */
    writeBlockedReason: string | null;
  };
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => request<SessionInfo>("/api/session"),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Outages in the current viewport, under the current filters.
 *
 * `bounds` is deliberately allowed to be null on first render — the map has not
 * reported a viewport yet, and querying the whole world would fetch data that
 * is immediately discarded.
 */
export function useOutages(bounds: BoundingBox | null) {
  const serviceTypes = useFilters((s) => s.serviceTypes);
  const severities = useFilters((s) => s.severities);
  const providerIds = useFilters((s) => s.providerIds);
  const resolvedHours = useFilters((s) => s.resolvedHours);

  const rounded = bounds ? roundBounds(bounds) : null;
  const nothingSelected =
    serviceTypes.length === 0 || severities.length === 0;

  return useQuery({
    queryKey: [
      "outages",
      rounded,
      serviceTypes,
      severities,
      providerIds,
      resolvedHours,
    ],
    enabled: rounded !== null && !nothingSelected,
    // Outages are live data; refetch often enough to feel current without
    // hammering the API while someone reads a detail sheet.
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
    queryFn: () => {
      const params = new URLSearchParams({
        services: serviceTypes.join(","),
        severities: severities.join(","),
      });

      if (rounded) {
        params.set(
          "bbox",
          [rounded.minLng, rounded.minLat, rounded.maxLng, rounded.maxLat].join(","),
        );
      }
      if (providerIds.length > 0) params.set("providers", providerIds.join(","));
      if (resolvedHours > 0) params.set("resolvedHours", String(resolvedHours));

      return request<{ outages: Outage[] }>(`/api/outages?${params}`);
    },
    select: (data) => data.outages,
  });
}

export function useOutageDetail(id: string | null) {
  return useQuery({
    queryKey: ["outage", id],
    enabled: id !== null,
    queryFn: () => request<{ outage: OutageDetail }>(`/api/outages/${id}`),
    select: (data) => data.outage,
  });
}

export function useCreateOutage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateOutageInput) =>
      request<{ outage: Outage }>("/api/outages", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outages"] });
    },
  });
}

export function useConfirmOutage(outageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (confirmed: boolean) =>
      request<{ verificationCount: number; confirmedByMe: boolean }>(
        `/api/outages/${outageId}/confirm`,
        { method: confirmed ? "POST" : "DELETE" },
      ),

    // Optimistic: the confirm button is the app's most-tapped control and a
    // round-trip of latency on it reads as a broken button.
    onMutate: async (confirmed) => {
      await queryClient.cancelQueries({ queryKey: ["outage", outageId] });
      const previous = queryClient.getQueryData<{ outage: OutageDetail }>([
        "outage",
        outageId,
      ]);

      if (previous) {
        queryClient.setQueryData(["outage", outageId], {
          outage: {
            ...previous.outage,
            confirmedByMe: confirmed,
            verificationCount:
              previous.outage.verificationCount + (confirmed ? 1 : -1),
          },
        });
      }

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["outage", outageId], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["outage", outageId] });
      queryClient.invalidateQueries({ queryKey: ["outages"] });
    },
  });
}

export function useAddComment(outageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (comment: string) =>
      request<{ comment: OutageComment }>(`/api/outages/${outageId}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment, commentType: "update" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outage", outageId] });
    },
  });
}

export function useResolveOutage(outageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      request<{ outage: OutageDetail }>(`/api/outages/${outageId}/resolve`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outage", outageId] });
      queryClient.invalidateQueries({ queryKey: ["outages"] });
    },
  });
}
