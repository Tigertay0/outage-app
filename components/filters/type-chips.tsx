"use client";

import { Info } from "lucide-react";
import { SERVICE_COVERAGE, SERVICE_META } from "@/lib/constants";
import { useFilters } from "@/lib/store/filters";
import { SERVICE_TYPES } from "@/lib/types";
import type { ServiceType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ServiceIcon } from "@/components/map/markers";

/**
 * Service-type filter, on the map rather than inside the filter sheet.
 *
 * The same toggles exist in the sheet, two taps and a scroll away, grouped with
 * providers and severities. That is the right home for the full set, and the
 * wrong one for the question people actually arrive with — "show me the power
 * cuts, not everything". This is that question, as one tap.
 *
 * "All" is the cleared state, not a fourth filter: with every type selected the
 * map is unfiltered, so a service type added later appears for everyone instead
 * of being excluded by a stale saved selection.
 */
export function TypeChips({ className }: { className?: string }) {
  const serviceTypes = useFilters((s) => s.serviceTypes);
  const setServiceTypes = useFilters((s) => s.setServiceTypes);

  const allSelected = serviceTypes.length === SERVICE_TYPES.length;
  // Reachable from "Clear all" in the filter sheet. The map is then correctly
  // empty, which is indistinguishable from "nothing is broken near you" unless
  // the control says which it is.
  const noneSelected = serviceTypes.length === 0;

  /**
   * Tapping a type selects only that type — the common case, and one tap
   * instead of three deselections. Tapping the type that is already alone
   * returns to everything, so the control is its own undo.
   */
  function pick(type: ServiceType) {
    const isOnlyOne = serviceTypes.length === 1 && serviceTypes[0] === type;
    setServiceTypes(isOnlyOne ? [...SERVICE_TYPES] : [type]);
  }

  // Only when a single type is selected: with everything on, the map is the
  // sum of every feed and no one note describes it.
  const lone = serviceTypes.length === 1 ? serviceTypes[0] : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <ChipRow
        allSelected={allSelected}
        noneSelected={noneSelected}
        serviceTypes={serviceTypes}
        onPick={pick}
        onShowAll={() => setServiceTypes([...SERVICE_TYPES])}
      />

      {lone && <CoverageNote type={lone} />}
    </div>
  );
}

/**
 * What this layer can and cannot see.
 *
 * Without it, filtering to Cellular shows an empty map that looks identical to
 * a broken one. The honest answer is that nothing free reports cellular, and
 * that is worth one line of text rather than leaving someone to guess.
 */
function CoverageNote({ type }: { type: ServiceType }) {
  const coverage = SERVICE_COVERAGE[type];

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg border border-border/60 bg-background/85",
        "px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground shadow-sm backdrop-blur",
      )}
    >
      <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{coverage.note}</span>
    </p>
  );
}

function ChipRow({
  allSelected,
  noneSelected,
  serviceTypes,
  onPick,
  onShowAll,
}: {
  allSelected: boolean;
  noneSelected: boolean;
  serviceTypes: ServiceType[];
  onPick: (type: ServiceType) => void;
  onShowAll: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto pb-0.5",
        // The scrollbar would sit across the map on desktop; the row fits
        // without one at every width we support.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      role="group"
      aria-label="Filter by service type"
    >
      <Chip
        label={noneSelected ? "Show all" : "All"}
        active={allSelected}
        highlighted={noneSelected}
        onClick={onShowAll}
      />

      {SERVICE_TYPES.map((type) => (
        <Chip
          key={type}
          label={SERVICE_META[type].shortLabel}
          icon={<ServiceIcon type={type} className="h-3.5 w-3.5" />}
          active={!allSelected && serviceTypes.includes(type)}
          onClick={() => onPick(type)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  icon,
  active,
  highlighted = false,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  /** Draws attention to this chip as the way out of an empty selection. */
  highlighted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // py-2 keeps the row a 36px target: not the 44px a primary button gets,
        // but this sits directly under the search field and cannot grow without
        // eating the map on a phone.
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2",
        "text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border/60 bg-background/85 text-muted-foreground hover:text-foreground",
        highlighted && "border-primary/70 text-foreground ring-2 ring-primary/30",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
