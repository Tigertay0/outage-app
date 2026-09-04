"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  GeolocateControl,
  Marker,
  NavigationControl,
  ScaleControl,
  type MapRef,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import { DEFAULT_VIEW, HOME_BOUNDS, MARKER_ZOOM } from "@/lib/constants";
import { useNow } from "@/lib/hooks/use-now";
import type { Advisory, BoundingBox, Outage } from "@/lib/types";
import { FALLBACK_STYLE, basemapUrl } from "./basemap";
import { AdvisoryMarker, ClusterMarker, OutageMarker } from "./markers";
import { useClusters, type ClusterProperties, type PointProperties } from "./use-clusters";

/** Reported within this many minutes counts as "fresh" and gets a pulse ring. */
const FRESH_MINUTES = 15;

/**
 * Inset that keeps fitted content clear of the floating chrome — the search bar
 * on top, the list panel and report button below.
 *
 * Proportional rather than fixed: fixed pixel padding is most of the map on a
 * short viewport, which pushes a fitBounds out to hemisphere zoom.
 */
function chromePadding(map: MapRef | null) {
  const height = map?.getContainer().clientHeight ?? 800;
  const width = map?.getContainer().clientWidth ?? 400;

  return {
    top: Math.min(90, height * 0.12),
    bottom: Math.min(130, height * 0.16),
    left: Math.min(48, width * 0.08),
    right: Math.min(48, width * 0.08),
  };
}

export interface MapView {
  latitude: number;
  longitude: number;
  zoom: number;
}

interface OutageMapProps {
  outages: Outage[];
  advisories: Advisory[];
  onSelectAdvisory: (advisory: Advisory) => void;
  selectedId: string | null;
  onSelect: (outage: Outage) => void;
  onBoundsChange: (bounds: BoundingBox, zoom: number) => void;
  /** Imperative fly-to target: search results, "use my location", deep links. */
  flyTo: MapView | null;
  /** Report mode: the crosshair in the centre picks the location. */
  picking: boolean;
  onPickMove?: (center: { latitude: number; longitude: number }) => void;
  theme: "light" | "dark";
}

export function OutageMap({
  outages,
  advisories,
  onSelectAdvisory,
  selectedId,
  onSelect,
  onBoundsChange,
  flyTo,
  picking,
  onPickMove,
  theme,
}: OutageMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [viewport, setViewport] = useState<{
    bounds: [number, number, number, number];
    zoom: number;
  } | null>(null);
  const [styleFailed, setStyleFailed] = useState(false);

  const { clusters, expansionZoom, leaves } = useClusters(outages, viewport);

  /**
   * Reveal a cluster's contents.
   *
   * Zooming to Supercluster's expansion zoom alone lands on the cluster's
   * centroid, which for a spread-out cluster can be an empty street with every
   * member off-screen. Fitting the members' own bounding box always shows them.
   * Members sharing one location have a degenerate box, so that case falls back
   * to the expansion zoom.
   */
  const revealCluster = useCallback(
    (clusterId: number, longitude: number, latitude: number) => {
      const map = mapRef.current;
      if (!map) return;

      const members = leaves(clusterId, 100);
      const lngs = members.map((o) => o.longitude);
      const lats = members.map((o) => o.latitude);

      const west = Math.min(...lngs);
      const east = Math.max(...lngs);
      const south = Math.min(...lats);
      const north = Math.max(...lats);

      const degenerate = east - west < 0.0005 && north - south < 0.0005;

      if (members.length === 0 || degenerate) {
        map.flyTo({
          center: [longitude, latitude],
          zoom: Math.max(expansionZoom(clusterId), MARKER_ZOOM),
          duration: 700,
        });
        return;
      }

      map.fitBounds(
        [west, south, east, north],
        // maxZoom stops a tight pair of outages from slamming to building level.
        { padding: chromePadding(map), maxZoom: 15, duration: 700 },
      );
    },
    [leaves, expansionZoom],
  );

  /** Read the current viewport off the map and push it upward. */
  const syncViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom();

    setViewport({
      bounds: [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ],
      zoom,
    });

    onBoundsChange(
      {
        minLng: bounds.getWest(),
        minLat: bounds.getSouth(),
        maxLng: bounds.getEast(),
        maxLat: bounds.getNorth(),
      },
      zoom,
    );
  }, [onBoundsChange]);

  // Clustering keys off the rounded zoom, so recomputing on every animation
  // frame is wasted work; moveend is enough for the marker layer. Report mode
  // is the exception — its crosshair has to track the map continuously.
  const handleMove = useCallback(
    (event: ViewStateChangeEvent) => {
      if (picking && onPickMove) {
        onPickMove({
          latitude: event.viewState.latitude,
          longitude: event.viewState.longitude,
        });
      }
    },
    [picking, onPickMove],
  );

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;

    mapRef.current.flyTo({
      center: [flyTo.longitude, flyTo.latitude],
      zoom: flyTo.zoom,
      duration: 1200,
      essential: true,
    });
  }, [flyTo]);

  const mapStyle = useMemo(
    () => (styleFailed ? FALLBACK_STYLE : basemapUrl(theme)),
    [styleFailed, theme],
  );

  // Ticks once a minute rather than being read during render, so marker
  // freshness is stable state instead of an impure read.
  const now = useNow(60_000);

  return (
    <Map
      ref={mapRef}
      mapStyle={mapStyle}
      initialViewState={DEFAULT_VIEW}
      minZoom={2}
      maxZoom={19}
      // Rotation adds nothing to an outage map and makes one-handed panning
      // fiddly, so both gestures are off.
      dragRotate={false}
      touchZoomRotate
      pitchWithRotate={false}
      onLoad={() => {
        // Fit the country to whatever viewport this actually is, then report
        // the resulting bounds. Padding keeps markers clear of the search bar
        // above and the list panel below.
        if (!flyTo) {
          mapRef.current?.fitBounds(HOME_BOUNDS, {
            padding: chromePadding(mapRef.current),
            duration: 0,
          });
        }
        syncViewport();
      }}
      onMove={handleMove}
      onMoveEnd={syncViewport}
      onError={(event) => {
        // A tile-host failure should degrade to the blank style, not a blank page.
        if (String(event.error?.message ?? "").includes("style")) {
          setStyleFailed(true);
        }
      }}
      reuseMaps
      attributionControl={{ compact: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <GeolocateControl
        position="top-right"
        trackUserLocation
        positionOptions={{ enableHighAccuracy: true }}
      />
      <ScaleControl position="bottom-left" maxWidth={90} unit="imperial" />

      {/* Advisories render first so outage markers sit above them: a report of
          actual lost service outranks a forecast of possible lost service. */}
      {!picking &&
        advisories.map((advisory) => (
          <Marker
            key={`advisory-${advisory.id}`}
            longitude={advisory.longitude}
            latitude={advisory.latitude}
            onClick={(event) => {
              event.originalEvent.stopPropagation();
              onSelectAdvisory(advisory);
            }}
          >
            <AdvisoryMarker
              severity={advisory.severity}
              onClick={() => onSelectAdvisory(advisory)}
            />
          </Marker>
        ))}

      {!picking &&
        clusters.map((feature) => {
          const [longitude, latitude] = feature.geometry.coordinates;
          const props = feature.properties;

          if (props.cluster) {
            const cluster = props as ClusterProperties;
            return (
              <Marker
                key={`cluster-${cluster.cluster_id}`}
                longitude={longitude}
                latitude={latitude}
              >
                <ClusterMarker
                  count={cluster.point_count}
                  severityCounts={cluster.severityCounts}
                  onClick={() =>
                    revealCluster(cluster.cluster_id, longitude, latitude)
                  }
                />
              </Marker>
            );
          }

          const { outage } = props as PointProperties;
          // now === 0 until the first tick; treat that as "not fresh yet".
          const ageMinutes = now ? (now - Date.parse(outage.reportedAt)) / 60_000 : Infinity;

          return (
            <Marker
              key={outage.id}
              longitude={longitude}
              latitude={latitude}
              onClick={(event) => {
                // Otherwise the map treats it as a background click.
                event.originalEvent.stopPropagation();
                onSelect(outage);
              }}
            >
              <OutageMarker
                serviceType={outage.serviceType}
                severity={outage.severity}
                isVerified={outage.isVerified}
                isResolved={outage.status === "resolved"}
                isSelected={outage.id === selectedId}
                isFresh={ageMinutes <= FRESH_MINUTES}
                onClick={() => onSelect(outage)}
              />
            </Marker>
          );
        })}
    </Map>
  );
}
