"use client";

import { CircleHelp, Signal, TriangleAlert, Wifi, Zap } from "lucide-react";
import { SEVERITY_META, dominantSeverity } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ServiceType, Severity } from "@/lib/types";

/** Service icons, shared by markers, filters and the detail sheet. */
export const SERVICE_ICONS = {
  power: Zap,
  internet: Wifi,
  cellular: Signal,
  other: CircleHelp,
} as const satisfies Record<ServiceType, React.ComponentType<{ className?: string }>>;

export function ServiceIcon({
  type,
  className,
}: {
  type: ServiceType;
  className?: string;
}) {
  const Icon = SERVICE_ICONS[type];
  return <Icon className={className} />;
}

/**
 * Cluster bubble: a count, coloured by the worst severity it contains, sized by
 * how many outages it holds. Size is deliberately compressed (a log-ish scale)
 * so a 200-outage cluster does not swamp the map next to a 3-outage one.
 */
export function ClusterMarker({
  count,
  severityCounts,
  onClick,
}: {
  count: number;
  severityCounts: Record<Severity, number>;
  onClick: () => void;
}) {
  const present = (Object.keys(severityCounts) as Severity[]).filter(
    (s) => severityCounts[s] > 0,
  );
  const worst = dominantSeverity(present.length > 0 ? present : ["intermittent"]);
  const color = SEVERITY_META[worst].token;

  const size = Math.min(64, 34 + Math.log2(count + 1) * 7);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: size, height: size, backgroundColor: color }}
      className={cn(
        "relative flex items-center justify-center rounded-full",
        "font-semibold text-white tabular-nums shadow-lg",
        "ring-4 ring-white/45 transition-transform",
        "hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white",
        // The generic 44px touch-target rule would inflate small bubbles, so
        // clusters opt out and rely on their own sizing.
        "min-h-0",
      )}
      aria-label={`${count} outages in this area. Zoom in to see them.`}
    >
      <span style={{ fontSize: size > 46 ? 15 : 13 }}>
        {count > 999 ? `${Math.round(count / 100) / 10}k` : count}
      </span>
    </button>
  );
}

/**
 * Individual outage marker: a service-type pin coloured by severity. Unverified
 * reports are drawn at reduced opacity with a dashed ring, which is how the PRD
 * asks for verification state to read at a glance (section 4.5).
 */
export function OutageMarker({
  serviceType,
  severity,
  isVerified,
  isResolved,
  isSelected,
  isFresh,
  onClick,
}: {
  serviceType: ServiceType;
  severity: Severity;
  isVerified: boolean;
  isResolved: boolean;
  isSelected: boolean;
  /** Reported in the last 15 minutes — worth drawing the eye to. */
  isFresh: boolean;
  onClick: () => void;
}) {
  const color = isResolved
    ? "var(--severity-resolved)"
    : SEVERITY_META[severity].token;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center min-h-0"
      aria-label={`${SEVERITY_META[severity].label} — ${serviceType}`}
    >
      {isFresh && !isResolved && (
        <span
          aria-hidden
          style={{ backgroundColor: color }}
          className="absolute inset-0 rounded-full opacity-60 animate-pulse-ring"
        />
      )}

      <span
        style={{
          backgroundColor: color,
          opacity: isVerified || isResolved ? 1 : 0.72,
          borderStyle: isVerified || isResolved ? "solid" : "dashed",
        }}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-full",
          "border-2 border-white text-white shadow-md transition-transform",
          "hover:scale-115",
          isSelected && "scale-125 ring-4 ring-white",
        )}
      >
        <ServiceIcon type={serviceType} className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/**
 * Hazard advisory: a storm warning rather than a reported outage.
 *
 * Deliberately a different shape — a rotated square, not a circle — so the two
 * layers are told apart without relying on colour, and drawn semi-transparent
 * so it reads as background context behind the outages that matter more.
 */
export function AdvisoryMarker({
  severity,
  onClick,
}: {
  severity: Severity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center min-h-0"
      aria-label={`Weather advisory — ${SEVERITY_META[severity].label}`}
    >
      <span
        style={{ backgroundColor: SEVERITY_META[severity].token }}
        className="flex h-5 w-5 rotate-45 items-center justify-center rounded-[3px] border-2 border-white/90 opacity-80 shadow transition-transform hover:scale-125"
      >
        <TriangleAlert className="h-2.5 w-2.5 -rotate-45 text-white" />
      </span>
    </button>
  );
}

/** The map legend. Kept collapsed on small screens so it never fights the map. */
export function MapLegend({ className }: { className?: string }) {
  const rows: Array<[Severity, string]> = [
    ["complete", "Complete outage"],
    ["degraded", "Degraded"],
    ["intermittent", "Intermittent"],
  ];

  return (
    <div
      className={cn(
        "rounded-lg border bg-background/90 p-2.5 text-xs shadow-sm backdrop-blur",
        className,
      )}
    >
      <ul className="space-y-1.5">
        {rows.map(([severity, label]) => (
          <li key={severity} className="flex items-center gap-2">
            <span
              aria-hidden
              style={{ backgroundColor: SEVERITY_META[severity].token }}
              className="h-2.5 w-2.5 rounded-full"
            />
            <span className="text-muted-foreground">{label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t pt-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground"
          />
          <span className="text-muted-foreground">Unverified</span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-muted-foreground/60"
          />
          <span className="text-muted-foreground">Storm warning</span>
        </li>
      </ul>
    </div>
  );
}
