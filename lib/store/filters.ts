"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SERVICE_TYPES, SEVERITIES } from "@/lib/types";
import type { ServiceType, Severity } from "@/lib/types";

/**
 * Filter state (PRD section 4.2).
 *
 * Persisted to localStorage so a returning visitor sees their own view
 * immediately, before the server round-trip that loads saved preferences. The
 * server copy wins once it arrives — `hydrateFromServer` merges it in.
 */

interface FilterState {
  serviceTypes: ServiceType[];
  severities: Severity[];
  /** Empty means "all providers", which keeps new providers visible by default. */
  providerIds: string[];
  /** Hours of recently-resolved outages to keep on the map. 0 hides them. */
  resolvedHours: number;
  /** Storm and hazard warnings layer. On by default: it is usually the only
   *  thing on the map in a quiet area, and it explains outages that follow. */
  showAdvisories: boolean;

  toggleServiceType: (type: ServiceType) => void;
  toggleSeverity: (severity: Severity) => void;
  toggleProvider: (id: string) => void;
  setProviders: (ids: string[]) => void;
  setResolvedHours: (hours: number) => void;
  setShowAdvisories: (show: boolean) => void;
  selectAll: (allProviderIds: string[]) => void;
  deselectAll: () => void;
  hydrateFromServer: (partial: {
    serviceTypes?: ServiceType[];
    severities?: Severity[];
    providerIds?: string[];
  }) => void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export const useFilters = create<FilterState>()(
  persist(
    (set) => ({
      serviceTypes: [...SERVICE_TYPES],
      severities: [...SEVERITIES],
      providerIds: [],
      resolvedHours: 0,
      showAdvisories: true,

      toggleServiceType: (type) =>
        set((s) => ({ serviceTypes: toggle(s.serviceTypes, type) })),

      toggleSeverity: (severity) =>
        set((s) => ({ severities: toggle(s.severities, severity) })),

      toggleProvider: (id) =>
        set((s) => ({ providerIds: toggle(s.providerIds, id) })),

      setProviders: (ids) => set({ providerIds: ids }),

      setResolvedHours: (hours) => set({ resolvedHours: hours }),

      setShowAdvisories: (show) => set({ showAdvisories: show }),

      selectAll: () =>
        set({
          serviceTypes: [...SERVICE_TYPES],
          severities: [...SEVERITIES],
          // Back to the implicit "all", rather than pinning today's list.
          providerIds: [],
        }),

      deselectAll: () => set({ serviceTypes: [], severities: [] }),

      hydrateFromServer: (partial) =>
        set((s) => ({
          serviceTypes: partial.serviceTypes ?? s.serviceTypes,
          severities: partial.severities ?? s.severities,
          providerIds: partial.providerIds ?? s.providerIds,
        })),
    }),
    // Bumped when showAdvisories was added; a v1 blob rehydrates with the
    // default rather than an undefined toggle.
    { name: "outage-filters", version: 2 },
  ),
);

/** True when nothing is filtered out — used to label the filter button. */
export function isDefaultFilter(state: {
  serviceTypes: ServiceType[];
  severities: Severity[];
  providerIds: string[];
}): boolean {
  return (
    state.serviceTypes.length === SERVICE_TYPES.length &&
    state.severities.length === SEVERITIES.length &&
    state.providerIds.length === 0
  );
}

/** How many dimensions are narrowed, for the badge on the filter button. */
export function activeFilterCount(state: {
  serviceTypes: ServiceType[];
  severities: Severity[];
  providerIds: string[];
}): number {
  let count = 0;
  if (state.serviceTypes.length !== SERVICE_TYPES.length) count += 1;
  if (state.severities.length !== SEVERITIES.length) count += 1;
  if (state.providerIds.length > 0) count += 1;
  return count;
}
