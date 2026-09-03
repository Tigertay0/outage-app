"use client";

import { ChevronUp, Loader2 } from "lucide-react";
import { SEVERITY_META } from "@/lib/constants";
import { formatDistance, haversineMeters } from "@/lib/geo";
import { locationLabel, timeAgo } from "@/lib/format";
import type { Outage } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ServiceIcon } from "@/components/map/markers";
import { cn } from "@/lib/utils";

/**
 * The list companion to the map.
 *
 * A map alone answers "where", badly, on a 5-inch screen — the list answers
 * "what is near me, worst first", which is the actual question most visitors
 * arrive with. Collapsed to a summary bar by default so the map keeps the
 * 70-80% of the screen the PRD asks for (section 5.1).
 */
export function NearbyPanel({
  outages,
  loading,
  center,
  expanded,
  onExpandedChange,
  onSelect,
}: {
  outages: Outage[];
  loading: boolean;
  center: { latitude: number; longitude: number } | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (outage: Outage) => void;
}) {
  const sorted = center
    ? [...outages].sort(
        (a, b) => haversineMeters(center, a) - haversineMeters(center, b),
      )
    : outages;

  const visible = sorted.slice(0, 50);
  const active = outages.filter((o) => o.status === "active").length;

  return (
    <div
      className={cn(
        "pointer-events-auto overflow-hidden rounded-t-2xl border-t bg-background shadow-[0_-4px_20px_rgba(0,0,0,0.08)] transition-[max-height] duration-300",
        expanded ? "max-h-[55vh]" : "max-h-14",
      )}
    >
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {active === 0
            ? "No outages in view"
            : `${active} outage${active === 1 ? "" : "s"} in view`}
        </span>
        <ChevronUp
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <ul className="max-h-[calc(55vh-3.5rem)] divide-y overflow-y-auto overscroll-contain">
          {visible.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing reported here. Pan the map or widen your filters.
            </li>
          )}

          {visible.map((outage) => {
            const resolved = outage.status === "resolved";

            return (
              <li key={outage.id}>
                <button
                  type="button"
                  onClick={() => onSelect(outage)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent"
                >
                  <span
                    aria-hidden
                    style={{
                      backgroundColor: resolved
                        ? "var(--severity-resolved)"
                        : SEVERITY_META[outage.severity].token,
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                  >
                    <ServiceIcon
                      type={outage.serviceType}
                      className="h-3.5 w-3.5"
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {outage.providerName ?? "Unknown provider"}
                      </span>
                      {outage.isVerified && (
                        <Badge variant="outline" className="shrink-0 px-1.5 py-0">
                          Verified
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {locationLabel(outage)}
                      {center && ` · ${formatDistance(haversineMeters(center, outage))}`}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">
                      {timeAgo(outage.reportedAt)}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {outage.verificationCount} confirmed
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
