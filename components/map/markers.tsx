"use client";

import { CircleHelp, Signal, Wifi, Zap } from "lucide-react";
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
 * Marker design notes.
 *
 * Everything here is drawn against an unpredictable background — a basemap that
 * is pale in one theme and near-black in the other, under a marker layer that
 * can be dense. Three rules follow, and they are why the shapes look the way
 * they do:
 *
 *   1. Every mark carries its own contrast. A ring in the *surface* colour,
 *      not white, separates a marker from the map in both themes.
 *   2. Weight means something. Solid is confirmed, hollow is not; size means
 *      how many. Nothing is decorative.
 *   3. Colour is never the only signal, since roughly one man in twelve cannot
 *      separate the red and green ends of the severity ramp.
 */

/** Translucent halo in the marker's own colour — the glow, not a border. */
function halo(color: string, alpha: number) {
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
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

  const size = Math.min(56, 28 + Math.log2(count + 1) * 6);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: size,
        height: size,
        // One soft halo instead of the old opaque white ring: the ring read as
        // a sticker pasted on the map, and stacked badly when clusters overlap.
        boxShadow: `0 0 0 ${Math.round(size / 8)}px ${halo(color, 0.18)}`,
      }}
      className={cn(
        "group relative flex items-center justify-center rounded-full",
        "border border-white/70 dark:border-white/25",
        "font-medium text-white tabular-nums",
        "transition-[transform,box-shadow] duration-150 ease-out",
        "hover:scale-105 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-foreground focus-visible:ring-offset-2",
        // The generic 44px touch-target rule would inflate small bubbles, so
        // clusters opt out and rely on their own sizing.
        "min-h-0",
      )}
      aria-label={`${count} outages in this area. Zoom in to see them.`}
    >
      <span
        aria-hidden
        style={{ backgroundColor: color }}
        className="absolute inset-0 rounded-full"
      />
      <span
        className="relative"
        style={{ fontSize: size > 44 ? 14 : 12, letterSpacing: "-0.01em" }}
      >
        {count > 999 ? `${Math.round(count / 100) / 10}k` : count}
      </span>
    </button>
  );
}

/**
 * Individual outage marker.
 *
 * Solid fill means the outage is confirmed — by the crowd, or by the utility
 * that reported it. Unconfirmed reports are drawn hollow: the same shape and
 * colour, filled with the page surface instead. That reads as provisional at a
 * glance and, unlike the dashed border it replaces, survives being 20px wide on
 * a phone.
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

  const solid = isVerified || isResolved;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-8 w-8 items-center justify-center min-h-0 rounded-full",
        // A ring on the button itself, not just the scale-up on the dot inside:
        // over a busy map a size change alone is not a focus indicator.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      )}
      aria-label={`${SEVERITY_META[severity].label}: ${serviceType}${
        solid ? "" : ", unconfirmed"
      }`}
    >
      {isFresh && !isResolved && (
        <span
          aria-hidden
          style={{ backgroundColor: halo(color, 0.35) }}
          className="absolute inset-1 rounded-full animate-pulse-ring"
        />
      )}

      <span
        aria-hidden
        style={{
          backgroundColor: solid ? color : "var(--background)",
          borderColor: color,
          // Lucide strokes with currentColor, so the icon follows the fill and
          // stays legible whether the marker is solid or hollow.
          color: solid ? "white" : color,
          boxShadow: isSelected
            ? `0 0 0 4px ${halo(color, 0.3)}, 0 2px 6px rgb(0 0 0 / 0.28)`
            : "0 1px 3px rgb(0 0 0 / 0.3)",
        }}
        className={cn(
          "relative flex h-[18px] w-[18px] items-center justify-center rounded-full",
          "border-2 transition-transform duration-150 ease-out",
          "group-hover:scale-110 group-focus-visible:scale-110",
          isSelected && "scale-125",
        )}
      >
        <ServiceIcon type={serviceType} className="h-[9px] w-[9px]" />
      </span>
    </button>
  );
}

/**
 * Hazard advisory: a storm warning rather than a reported outage.
 *
 * Deliberately a different shape — a rotated square, not a circle — so the two
 * layers are told apart without relying on colour, and drawn quieter than the
 * outages so it reads as the context it is. The icon it used to carry was three
 * pixels across and only ever muddied the silhouette, so the shape carries the
 * meaning alone.
 */
export function AdvisoryMarker({
  severity,
  onClick,
}: {
  severity: Severity;
  onClick: () => void;
}) {
  const color = SEVERITY_META[severity].token;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-8 w-8 items-center justify-center min-h-0 rounded-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      )}
      aria-label={`Weather advisory: ${SEVERITY_META[severity].label}`}
    >
      <span
        aria-hidden
        style={{
          backgroundColor: halo(color, 0.55),
          borderColor: halo(color, 0.9),
        }}
        className={cn(
          "h-[13px] w-[13px] rotate-45 rounded-[2px] border",
          "shadow-sm transition-transform duration-150 ease-out",
          "group-hover:scale-125 group-focus-visible:scale-125",
        )}
      />
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
        "rounded-xl border bg-background/85 p-3 text-xs shadow-sm backdrop-blur",
        className,
      )}
    >
      <ul className="space-y-2">
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
        <li className="flex items-center gap-2 border-t pt-2">
          <span
            aria-hidden
            style={{ borderColor: SEVERITY_META.complete.token }}
            className="h-2.5 w-2.5 rounded-full border-2 bg-background"
          />
          <span className="text-muted-foreground">Unconfirmed report</span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-muted-foreground/50"
          />
          <span className="text-muted-foreground">Storm warning</span>
        </li>
        <li className="flex items-center gap-2 border-t pt-2">
          <span
            aria-hidden
            className="h-2.5 w-6 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(250,204,21,0.5), rgba(249,115,22,0.8), rgba(220,38,38,0.95))",
            }}
          />
          <span className="text-muted-foreground">Density. Zoom in for detail</span>
        </li>
      </ul>
    </div>
  );
}
