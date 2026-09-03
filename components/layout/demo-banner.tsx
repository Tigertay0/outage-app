"use client";

import { useState } from "react";
import { Info, X } from "lucide-react";

/**
 * Shown only when the app is running on the local seeded store. Being explicit
 * that the markers are demo data is the difference between a convincing prototype
 * and a misleading one — this map is about real emergencies.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    // Colours are set against the card surface rather than a tinted background,
    // so the text keeps its contrast in both themes.
    <div className="flex items-start gap-2 rounded-xl border border-severity-intermittent/40 bg-card px-3 py-2 text-xs shadow-lg">
      <Info
        aria-hidden
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-severity-intermittent"
      />
      <p className="flex-1 text-card-foreground">
        <span className="font-semibold">Demo data.</span> No database connected —
        these outages are samples, and anything you report resets when the server
        restarts. See SETUP.md to connect Supabase.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="-m-1 min-h-0 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
