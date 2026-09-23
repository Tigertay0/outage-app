"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationSettings } from "@/lib/types";

/**
 * Web Push subscription management (PRD section 4.7).
 *
 * Everything here degrades quietly: a browser without Push, a deployment with
 * no VAPID keys, or a denied permission all end in `available === false` and
 * the settings UI hides the toggle rather than offering a button that fails.
 */

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 *
 * Returns Uint8Array<ArrayBuffer> explicitly: the default Uint8Array type is
 * parameterised over ArrayBufferLike, which includes SharedArrayBuffer and so
 * does not satisfy applicationServerKey's BufferSource.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);

  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** The browser's IANA zone. Quiet hours are wall-clock times in this zone. */
function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

async function postSubscription(
  subscription: PushSubscription,
  settings: NotificationSettings,
  center: { latitude: number; longitude: number } | null,
): Promise<void> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      settings,
      center,
      timezone: browserTimezone(),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Server rejected the subscription");
  }
}

export function usePush() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/push/vapid");
        const body = (await response.json()) as { publicKey: string | null };
        if (cancelled) return;

        setPublicKey(body.publicKey);
        if (!body.publicKey) return;

        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(existing));
      } catch {
        // Push is optional; a failure here just leaves it unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(
    async (
      settings: NotificationSettings,
      center: { latitude: number; longitude: number } | null,
    ) => {
      if (!supported || !publicKey) return false;

      setBusy(true);
      setError(null);

      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setError(
            permission === "denied"
              ? "Notifications are blocked for this site in your browser settings."
              : "Notification permission was not granted.",
          );
          return false;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        // Shared with resync so the first subscribe also sends the browser's
        // time zone; without it quiet hours were evaluated in UTC.
        await postSubscription(subscription, settings, center);

        setSubscribed(true);
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not enable alerts.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [supported, publicKey],
  );

  /**
   * Push new alert settings to an existing subscription.
   *
   * Settings were captured once, when alerts were switched on, so changing the
   * radius, threshold or quiet hours afterwards and pressing Save updated the
   * preferences but not what the server used to decide who to notify. This
   * re-posts the same browser subscription with the current settings; the
   * server upserts on its endpoint. A no-op when not subscribed.
   */
  const resync = useCallback(
    async (
      settings: NotificationSettings,
      center: { latitude: number; longitude: number } | null,
    ) => {
      if (!supported || !publicKey) return;

      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;

      await postSubscription(subscription, settings, center);
    },
    [supported, publicKey],
  );

  /**
   * Returns false when the server did not remove the subscription. The local
   * browser subscription is kept in that case: dropping it while the server row
   * lives on would leave alerts arriving with the toggle showing "off".
   */
  const unsubscribe = useCallback(async () => {
    if (!supported) return true;

    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const response = await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Could not turn off alerts.");
        }
        await subscription.unsubscribe();
      }

      setSubscribed(false);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not turn off alerts.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return {
    /** True only when the browser supports push AND the server has VAPID keys. */
    available: supported && Boolean(publicKey),
    subscribed,
    busy,
    error,
    subscribe,
    resync,
    unsubscribe,
  };
}
