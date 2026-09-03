"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks on an interval.
 *
 * Reading Date.now() during render makes a component impure — two renders with
 * identical props can disagree — which matters here because "reported 3 min
 * ago" and the fresh-report pulse both depend on the current time. This turns
 * the clock into ordinary state that changes on a schedule.
 *
 * Returns 0 on the first frame (and during server rendering) so the markup is
 * deterministic; callers treat 0 as "time not known yet".
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Date.now());

    // Deferred rather than called inline: a synchronous setState in an effect
    // body triggers a second render pass before paint.
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);

    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
