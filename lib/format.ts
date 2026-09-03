import { formatDistanceToNowStrict } from "date-fns";
import type { Outage } from "./types";

/** "12 min ago" / "3 hr ago" — short enough for a map marker popup. */
export function timeAgo(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
    .replace(" minutes", " min")
    .replace(" minute", " min")
    .replace(" hours", " hr")
    .replace(" hour", " hr")
    .replace(" seconds", "s")
    .replace(" second", "s");
}

/** Wall-clock time, for restoration estimates: "4:30 PM". */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dayAndTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return sameDay
    ? clockTime(iso)
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** How long an outage has run, or ran before it was resolved. */
export function outageDuration(outage: Outage): string {
  const start = Date.parse(outage.reportedAt);
  const end = outage.resolvedAt ? Date.parse(outage.resolvedAt) : Date.now();
  const minutes = Math.max(1, Math.round((end - start) / 60_000));

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours < 24) {
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** The one-line location label used across markers, lists and the detail sheet. */
export function locationLabel(outage: Outage): string {
  if (outage.address) return outage.address;
  if (outage.city && outage.state) return `${outage.city}, ${outage.state}`;
  if (outage.city) return outage.city;
  if (outage.zipCode) return outage.zipCode;
  return `${outage.latitude.toFixed(3)}, ${outage.longitude.toFixed(3)}`;
}

export function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
