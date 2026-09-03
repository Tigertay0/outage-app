"use client";

import { useMemo } from "react";
import { SERVICE_META, SEVERITY_META } from "@/lib/constants";
import { useProviders } from "@/lib/hooks/use-outages";
import { useFilters } from "@/lib/store/filters";
import { SERVICE_TYPES, SEVERITIES } from "@/lib/types";
import type { Provider, ServiceType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ServiceIcon } from "@/components/map/markers";

/**
 * Filter menu (PRD section 4.2).
 *
 * Two levels: service-type groups, then individual providers grouped under the
 * type they belong to. Providers are stored as an allow-list that is empty by
 * default, which means "all" — so a provider added later shows up for everyone
 * instead of being silently excluded by a stale saved list.
 */
export function FilterSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: providers = [] } = useProviders();

  const serviceTypes = useFilters((s) => s.serviceTypes);
  const severities = useFilters((s) => s.severities);
  const providerIds = useFilters((s) => s.providerIds);
  const resolvedHours = useFilters((s) => s.resolvedHours);
  const toggleServiceType = useFilters((s) => s.toggleServiceType);
  const toggleSeverity = useFilters((s) => s.toggleSeverity);
  const toggleProvider = useFilters((s) => s.toggleProvider);
  const setProviders = useFilters((s) => s.setProviders);
  const setResolvedHours = useFilters((s) => s.setResolvedHours);
  const selectAll = useFilters((s) => s.selectAll);
  const deselectAll = useFilters((s) => s.deselectAll);

  const byService = useMemo(() => {
    const grouped = new Map<ServiceType, Provider[]>();
    for (const type of SERVICE_TYPES) grouped.set(type, []);
    for (const provider of providers) {
      grouped.get(provider.serviceType)?.push(provider);
    }
    return grouped;
  }, [providers]);

  const allSelected = providerIds.length === 0;

  /** Selecting every provider in a group is the same as clearing that group. */
  function toggleGroup(type: ServiceType) {
    const group = byService.get(type) ?? [];
    const ids = group.map((p) => p.id);
    const anySelected = ids.some((id) => providerIds.includes(id));

    setProviders(
      anySelected
        ? providerIds.filter((id) => !ids.includes(id))
        : [...providerIds, ...ids],
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Choose what appears on the map.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <section className="py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Service
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {SERVICE_TYPES.map((type) => {
                const active = serviceTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleServiceType(type)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    <ServiceIcon type={type} className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {SERVICE_META[type].shortLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Severity
            </h3>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((severity) => {
                const active = severities.includes(severity);
                return (
                  <button
                    key={severity}
                    type="button"
                    onClick={() => toggleSeverity(severity)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-transparent bg-secondary"
                        : "border-input bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      aria-hidden
                      style={{ backgroundColor: SEVERITY_META[severity].token }}
                      className="h-2.5 w-2.5 rounded-full"
                    />
                    {SEVERITY_META[severity].label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Providers
              </h3>
              {allSelected ? (
                <Badge variant="secondary">All providers</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setProviders([])}
                >
                  Show all
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {SERVICE_TYPES.map((type) => {
                const group = byService.get(type) ?? [];
                if (group.length === 0) return null;

                return (
                  <div key={type}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(type)}
                      className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ServiceIcon type={type} className="h-3.5 w-3.5" />
                      {SERVICE_META[type].label}
                    </button>

                    <ul className="space-y-0.5">
                      {group.map((provider) => {
                        const checked =
                          allSelected || providerIds.includes(provider.id);
                        return (
                          <li key={provider.id}>
                            <Label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 hover:bg-accent">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => {
                                  // Leaving "all" means materialising the list
                                  // first, minus the one just unchecked.
                                  if (allSelected) {
                                    setProviders(
                                      providers
                                        .map((p) => p.id)
                                        .filter((id) => id !== provider.id),
                                    );
                                  } else {
                                    toggleProvider(provider.id);
                                  }
                                }}
                              />
                              <span className="text-sm font-normal">
                                {provider.name}
                              </span>
                            </Label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="border-t py-3">
            <Label className="flex cursor-pointer items-center justify-between gap-3 py-2">
              <span>
                <span className="text-sm font-medium">
                  Show recently resolved
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Outages fixed in the last 6 hours
                </span>
              </span>
              <Checkbox
                checked={resolvedHours > 0}
                onCheckedChange={(checked) =>
                  setResolvedHours(checked ? 6 : 0)
                }
              />
            </Label>
          </section>
        </div>

        {/* One row rather than the stacked default: three full-width buttons
            would eat most of a phone screen that is already short on room. */}
        <SheetFooter className="flex-row gap-2">
          <Button variant="outline" onClick={deselectAll} className="flex-1">
            Clear all
          </Button>
          <Button
            variant="outline"
            onClick={() => selectAll(providers.map((p) => p.id))}
            className="flex-1"
          >
            Select all
          </Button>
          <Button onClick={() => onOpenChange(false)} className="flex-1">
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
