"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserPreferences } from "@/lib/types";

/**
 * Server-side preferences (PRD section 4.3).
 *
 * Keyed on the caller's identity, which is a guest cookie until they sign in —
 * so saved locations and alert settings survive a reload even without an
 * account, and carry over unchanged once one exists.
 */

interface PreferencesResponse {
  preferences: UserPreferences;
  isAuthenticated: boolean;
}

export function usePreferences() {
  return useQuery({
    queryKey: ["preferences"],
    queryFn: async (): Promise<PreferencesResponse> => {
      const response = await fetch("/api/preferences");
      if (!response.ok) throw new Error("Could not load your settings");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (preferences: UserPreferences) => {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (body as { error?: string }).error ?? "Could not save your settings",
        );
      }
      return body as { preferences: UserPreferences };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["preferences"], (previous: unknown) => ({
        ...(previous as PreferencesResponse),
        preferences: data.preferences,
      }));
    },
  });
}
