"use client";

import { CheckCircle2, ChevronUp, CloudAlert, Loader2, Plus } from "lucide-react";
import { SEVERITY_META } from "@/lib/constants";
import { formatDistance, haversineMeters } from "@/lib/geo";
import { locationLabel, timeAgo } from "@/lib/format";
import { useFilters } from "@/lib/store/filters";
import type { Advisory, Outage } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  advisories,
  loading,
  center,
  expanded,
  onExpandedChange,
  onSelect,
  onSelectAdvisory,
  onReport,
}: {
  outages: Outage[];
  advisories: Advisory[];
  loading: boolean;
  center: { latitude: number; longitude: number } | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (outage: Outage) => void;
  onSelectAdvisory: (advisory: Advisory) => void;
  onReport: () => void;
}) {
  const sorted = center
    ? [...outages].sort(
        (a, b) => haversineMeters(center, a) - haversineMeters(center, b),
      )
    : outages;

  const visible = sorted.slice(0, 50);
  const active = outages.filter((o) => o.status === "active").length;

  /**
   * What the collapsed bar says when there is nothing to report.
   *
   * "No outages in view" alone reads like the app failed to load. Naming the
   * warnings that *are* in view says the opposite — the map is working, and
   * this is what it found.
   */
  const summary =
    active > 0
      ? `${active} outage${active === 1 ? "" : "s"} in view`
      : advisories.length > 0
        ? `${advisories.length} weather warning${advisories.length === 1 ? "" : "s"} in view`
        : "No outages reported nearby";

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
          {active === 0 && advisories.length === 0 && !loading && (
            <CheckCircle2 className="h-3.5 w-3.5 text-severity-resolved" />
          )}
          {summary}
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
            <li>
              <EmptyState
                advisories={advisories}
                onSelectAdvisory={onSelectAdvisory}
                onReport={onReport}
              />
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
                      {outage.origin === "official" ? (
                        <Badge variant="outline" className="shrink-0 px-1.5 py-0">
                          Official
                        </Badge>
                      ) : (
                        outage.isVerified && (
                          <Badge variant="outline" className="shrink-0 px-1.5 py-0">
                            Verified
                          </Badge>
                        )
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
                      {outage.origin === "official"
                        ? (outage.sourceName ?? "feed")
                        : `${outage.verificationCount} confirmed`}
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

/**
 * What the list shows when nothing is in view.
 *
 * This is the state a new visitor is most likely to land in, and the one most
 * likely to lose them: PRD section 9 names the chicken-and-egg problem as the
 * top product risk. A bare "nothing here" reads as a broken app, so this screen
 * has three jobs, in order:
 *
 *   1. Say that no outages is a *result*, not a failure.
 *   2. Show whatever else the map does know — weather warnings are usually the
 *      only thing on a calm day, and they explain outages that follow.
 *   3. Offer the one action that fixes an empty map: reporting.
 */
function EmptyState({
  advisories,
  onSelectAdvisory,
  onReport,
}: {
  advisories: Advisory[];
  onSelectAdvisory: (advisory: Advisory) => void;
  onReport: () => void;
}) {
  const resolvedHours = useFilters((s) => s.resolvedHours);
  const setResolvedHours = useFilters((s) => s.setResolvedHours);

  return (
    <div className="px-4 py-6">
      <div className="flex flex-col items-center text-center">
        <span
          aria-hidden
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-severity-resolved/10 text-severity-resolved"
        >
          <CheckCircle2 className="h-5 w-5" />
        </span>

        <p className="text-sm font-medium">No outages reported here</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          {advisories.length > 0
            ? "Nobody has reported losing service, but conditions below make it more likely."
            : "Either everything is working, or nobody has reported it yet."}
        </p>

        <Button onClick={onReport} className="mt-4">
          <Plus className="h-4 w-4" />
          Report an outage
        </Button>

        {resolvedHours === 0 && (
          <button
            type="button"
            onClick={() => setResolvedHours(6)}
            className="mt-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Show outages resolved in the last 6 hours
          </button>
        )}
      </div>

      {advisories.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CloudAlert className="h-3.5 w-3.5" />
            Weather in this area
          </h3>

          <ul className="-mx-2 space-y-0.5">
            {advisories.slice(0, 5).map((advisory) => (
              <li key={advisory.id}>
                <button
                  type="button"
                  onClick={() => onSelectAdvisory(advisory)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                >
                  <span
                    aria-hidden
                    style={{
                      backgroundColor: SEVERITY_META[advisory.severity].token,
                    }}
                    className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {advisory.kind}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {advisory.areaDescription ?? "Nearby"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {advisories.length > 5 && (
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              and {advisories.length - 5} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}
