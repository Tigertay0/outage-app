"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LocateFixed, Search, SlidersHorizontal, X } from "lucide-react";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import type { GeocodeResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Location search (PRD section 4.4).
 *
 * Debounced at 350ms: Nominatim's usage policy is roughly one request per
 * second, and firing on every keystroke would blow through that on a normal
 * typing speed while returning results nobody reads.
 */
const DEBOUNCE_MS = 350;

export function SearchBar({
  onPick,
  onUseMyLocation,
  onOpenFilters,
  activeFilterCount,
  className,
}: {
  onPick: (result: GeocodeResult) => void;
  onUseMyLocation: (coords: { latitude: number; longitude: number }) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { locate, loading: locating, error: locationError } = useGeolocation();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["geocode", debounced],
    enabled: debounced.length >= 2,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(debounced)}`,
      );
      if (!response.ok) return [];
      const body = (await response.json()) as { results: GeocodeResult[] };
      return body.results;
    },
  });

  // Close the suggestion list on an outside tap, the way a native picker would.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(result: GeocodeResult) {
    onPick(result);
    // Keep the short form in the box; the full display_name is unreadable.
    setValue(result.label.split(",").slice(0, 2).join(",").trim());
    setOpen(false);
  }

  async function handleLocate() {
    const coords = await locate();
    if (coords) {
      onUseMyLocation(coords);
      setValue("");
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* A real form, so Enter picks the top suggestion through the browser's
          own submit behaviour rather than a hand-rolled keydown handler. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (results[0]) choose(results[0]);
        }}
        className="flex items-center gap-2 rounded-xl border bg-background/95 p-1.5 shadow-lg backdrop-blur"
      >
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              // The form has no submit button (both icons are type="button"),
              // so implicit submission is not guaranteed — handle Enter here
              // as well and let the form's onSubmit be the fallback.
              if (event.key === "Enter") {
                event.preventDefault();
                if (results[0]) choose(results[0]);
              }
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="Address, city or ZIP"
            aria-label="Search for a location"
            autoComplete="off"
            enterKeyHint="search"
            className="border-0 pl-9 pr-9 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setOpen(false);
              }}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleLocate}
          disabled={locating}
          aria-label="Use my location"
          title="Use my location"
          className="shrink-0"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenFilters}
          aria-label={
            activeFilterCount > 0
              ? `Filters, ${activeFilterCount} active`
              : "Filters"
          }
          className="relative shrink-0"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </form>

      {open && (debounced.length >= 2 || locationError) && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border bg-popover shadow-xl">
          {locationError && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {locationError}
            </p>
          )}

          {isFetching && results.length === 0 && (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching…
            </p>
          )}

          {!isFetching && debounced.length >= 2 && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No places matched “{debounced}”.
            </p>
          )}

          <ul>
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => choose(result)}
                  className="block w-full px-4 py-3 text-left text-sm hover:bg-accent"
                >
                  <span className="block font-medium">
                    {result.label.split(",")[0]}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {result.label.split(",").slice(1).join(",").trim()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
