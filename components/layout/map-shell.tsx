"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { DEFAULT_VIEW } from "@/lib/constants";
import { useAdvisories, useOutages, useSession } from "@/lib/hooks/use-outages";
import { activeFilterCount, useFilters } from "@/lib/store/filters";
import type { Advisory, BoundingBox, GeocodeResult, Outage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { MapLegend } from "@/components/map/markers";
import { OutageMap, type MapView } from "@/components/map/outage-map";
import { NearbyPanel } from "@/components/layout/nearby-panel";
import { AdvisorySheet } from "@/components/outage/advisory-sheet";
import { OutageDetailSheet } from "@/components/outage/outage-detail-sheet";
import { ReportSheet } from "@/components/report/report-sheet";
import { SearchBar } from "@/components/search/search-bar";
import { DemoBanner } from "./demo-banner";
import { SettingsSheet } from "./settings-sheet";

/**
 * The application shell.
 *
 * Owns the pieces of state that more than one child needs — viewport, current
 * selection, which sheet is open — and nothing else. Data fetching lives in the
 * hooks; each sheet manages its own form state.
 */
export function MapShell() {
  const [bounds, setBounds] = useState<BoundingBox | null>(null);
  const [center, setCenter] = useState({
    latitude: DEFAULT_VIEW.latitude,
    longitude: DEFAULT_VIEW.longitude,
  });
  const [zoom, setZoom] = useState(DEFAULT_VIEW.zoom);
  const [flyTo, setFlyTo] = useState<MapView | null>(null);

  // Deep links are read once, when state is created, rather than in an effect:
  // /?outage=<id> comes from a push notification, /?action=report from the
  // manifest's app shortcut. Doing this in an effect would render the closed
  // state first and then immediately re-render with the sheet open.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("outage"),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("action") === "report",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedAdvisory, setSelectedAdvisory] = useState<Advisory | null>(null);
  const [picking, setPicking] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const { data: session } = useSession();
  const { data: outages = [], isFetching } = useOutages(bounds);
  const showAdvisories = useFilters((s) => s.showAdvisories);
  const { data: advisories = [] } = useAdvisories(bounds, showAdvisories);

  // Selected field by field. A selector returning a new object every call has
  // no stable identity, which makes useSyncExternalStore re-render forever.
  const selectedServiceTypes = useFilters((s) => s.serviceTypes);
  const selectedSeverities = useFilters((s) => s.severities);
  const selectedProviderIds = useFilters((s) => s.providerIds);

  const filterCount = activeFilterCount({
    serviceTypes: selectedServiceTypes,
    severities: selectedSeverities,
    providerIds: selectedProviderIds,
  });

  // Follow the OS colour scheme for the basemap. There is no in-app theme
  // switch yet, so matching the system is the least surprising behaviour.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      setTheme(query.matches ? "dark" : "light");
      document.documentElement.classList.toggle("dark", query.matches);
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const handleBoundsChange = useCallback(
    (next: BoundingBox, nextZoom: number) => {
      setBounds(next);
      setZoom(nextZoom);
      setCenter({
        latitude: (next.minLat + next.maxLat) / 2,
        longitude: (next.minLng + next.maxLng) / 2,
      });
    },
    [],
  );

  const handlePick = useCallback((result: GeocodeResult) => {
    setFlyTo({
      latitude: result.latitude,
      longitude: result.longitude,
      zoom: result.zoom,
    });
  }, []);

  const handleUseMyLocation = useCallback(
    (coords: { latitude: number; longitude: number }) => {
      setFlyTo({ ...coords, zoom: 13 });
    },
    [],
  );

  const handleSelect = useCallback((outage: Outage) => {
    setSelectedId(outage.id);
    setListExpanded(false);
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <OutageMap
        outages={outages}
        advisories={showAdvisories ? advisories : []}
        onSelectAdvisory={setSelectedAdvisory}
        selectedId={selectedId}
        onSelect={handleSelect}
        onBoundsChange={handleBoundsChange}
        flyTo={flyTo}
        picking={picking}
        onPickMove={setCenter}
        theme={theme}
      />

      {/* Crosshair for report mode. Fixed to the map centre so the user aims by
          moving the map, which is far steadier one-handed than dragging a pin. */}
      {picking && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full"
        >
          <svg width="34" height="42" viewBox="0 0 34 42" fill="none">
            <path
              d="M17 41C17 41 32 25.5 32 16.5C32 8.2 25.3 1.5 17 1.5S2 8.2 2 16.5C2 25.5 17 41 17 41Z"
              fill="var(--severity-complete)"
              stroke="white"
              strokeWidth="2.5"
            />
            <circle cx="17" cy="16.5" r="5" fill="white" />
          </svg>
        </div>
      )}

      {/* Above the bottom bar: the search suggestions drop down over the map
          and must not be painted on by the report button below them. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 p-3">
        <div className="pointer-events-auto mx-auto max-w-lg space-y-2">
          {session?.capabilities.demoData && <DemoBanner />}
          <SearchBar
            onPick={handlePick}
            onUseMyLocation={handleUseMyLocation}
            onOpenFilters={() => setFiltersOpen(true)}
            activeFilterCount={filterCount}
          />
        </div>
      </div>

      {/* Settings sits opposite the report button so the two primary actions
          do not crowd the same thumb zone. */}
      {!picking && (
        <div className="absolute bottom-20 left-3 z-10 flex flex-col items-start gap-2">
          <MapLegend className="hidden sm:block" />
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Alerts and saved places"
            className="h-11 w-11 rounded-full shadow-lg"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!picking && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
          <div className="pointer-events-auto mx-auto max-w-lg">
            <div className="flex justify-end px-3 pb-3">
              <Button
                size="lg"
                onClick={() => setReportOpen(true)}
                className="h-14 rounded-full pl-5 pr-6 shadow-xl"
              >
                <Plus className="h-5 w-5" />
                Report outage
              </Button>
            </div>

            <NearbyPanel
              outages={outages}
              loading={isFetching}
              center={center}
              expanded={listExpanded}
              onExpandedChange={setListExpanded}
              onSelect={handleSelect}
            />
          </div>
        </div>
      )}

      <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} />

      <ReportSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        pickedLocation={center}
        onRequestPicking={setPicking}
        onReported={setSelectedId}
      />

      <AdvisorySheet
        advisory={selectedAdvisory}
        onOpenChange={(open) => {
          if (!open) setSelectedAdvisory(null);
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentView={{ ...center, zoom }}
        onGoToPlace={(place) =>
          setFlyTo({
            latitude: place.latitude,
            longitude: place.longitude,
            zoom: place.zoom,
          })
        }
      />

      <OutageDetailSheet
        outageId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </main>
  );
}
