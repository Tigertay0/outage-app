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

        const response = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            settings,
            center,
          }),
        });

        if (!response.ok) throw new Error("Server rejected the subscription");

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

  const unsubscribe = useCallback(async () => {
    if (!supported) return;

    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setSubscribed(false);
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
    unsubscribe,
  };
}
