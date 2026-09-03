import { VERIFICATION_THRESHOLD } from "./constants";
import { clockTime, timeAgo } from "./format";
import type { OutageDetail, TimelineEvent } from "./types";

/**
 * Build the outage timeline (PRD section 4.9).
 *
 * Derived rather than stored: every event already exists as a timestamp on the
 * outage or one of its comments, so a separate events table would be a second
 * source of truth to keep in sync for no gain.
 */
export function buildTimeline(outage: OutageDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "reported",
      at: outage.reportedAt,
      kind: "reported",
      title: "Reported",
      detail: outage.description,
    },
  ];

  // Verification has no timestamp of its own — the threshold crossing is
  // attributed to the comment stream's midpoint only when we have nothing
  // better, so show it as a summary pinned after the report instead.
  if (outage.isVerified) {
    events.push({
      id: "verified",
      at: outage.reportedAt,
      kind: "verified",
      title: `Verified by ${outage.verificationCount} people`,
      detail: `${VERIFICATION_THRESHOLD} confirmations needed`,
    });
  }

  if (outage.estimatedRestoration) {
    events.push({
      id: "eta",
      at: outage.reportedAt,
      kind: "eta",
      title: `Estimated restoration ${clockTime(outage.estimatedRestoration)}`,
    });
  }

  for (const comment of outage.comments) {
    events.push({
      id: comment.id,
      at: comment.createdAt,
      kind: comment.commentType === "resolution" ? "resolution" : "comment",
      title:
        comment.commentType === "resolution"
          ? "Reported as restored"
          : comment.authorLabel,
      detail: comment.comment,
    });
  }

  if (outage.resolvedAt) {
    events.push({
      id: "resolved",
      at: outage.resolvedAt,
      kind: "resolution",
      title: `Resolved ${timeAgo(outage.resolvedAt)}`,
    });
  }

  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
