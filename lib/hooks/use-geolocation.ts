"use client";

import { useCallback, useState } from "react";

/**
 * On-demand geolocation.
 *
 * Deliberately not automatic on mount: a permission prompt the instant the page
 * opens is the fastest way to get denied, and the PRD's privacy stance
 * (section 6.3) is that location is opt-in. The map centres on the country
 * until the user taps "Use my location".
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface State {
  coords: Coordinates | null;
  loading: boolean;
  error: string | null;
}

function messageFor(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. You can still search for a place.";
    case error.POSITION_UNAVAILABLE:
      return "Could not determine your location.";
    case error.TIMEOUT:
      return "Locating took too long. Try again.";
    default:
      return "Could not get your location.";
  }
}

export function useGeolocation() {
  const [state, setState] = useState<State>({
    coords: null,
    loading: false,
    error: null,
  });

  const locate = useCallback((): Promise<Coordinates | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        coords: null,
        loading: false,
        error: "This browser cannot share a location.",
      });
      return Promise.resolve(null);
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
          setState({ coords, loading: false, error: null });
          resolve(coords);
        },
        (error) => {
          setState({ coords: null, loading: false, error: messageFor(error) });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }, []);

  return { ...state, locate };
}
