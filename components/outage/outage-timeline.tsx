"use client";

import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Flag,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { dayAndTime } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types";

const ICONS = {
  reported: Flag,
  verified: BadgeCheck,
  comment: MessageSquare,
  resolution: CheckCircle2,
  escalation: TrendingUp,
  eta: Clock,
} as const;

const ACCENT: Record<TimelineEvent["kind"], string> = {
  reported: "var(--severity-complete)",
  verified: "var(--primary)",
  comment: "var(--muted-foreground)",
  resolution: "var(--severity-resolved)",
  escalation: "var(--severity-degraded)",
  eta: "var(--muted-foreground)",
};

/**
 * Vertical timeline (PRD section 4.9). The connecting rule is drawn per-item
 * rather than as one absolutely positioned line, so it stops cleanly at the
 * last event instead of trailing past it.
 */
export function OutageTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const Icon = ICONS[event.kind];
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                style={{ color: ACCENT[event.kind] }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {!isLast && <span className="w-px flex-1 bg-border" />}
            </div>

            <div className={isLast ? "pb-1" : "pb-5"}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{event.title}</span>
                <time className="text-xs text-muted-foreground">
                  {dayAndTime(event.at)}
                </time>
              </div>
              {event.detail && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {event.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
