"use client";

import { useState } from "react";
import { Bell, BellOff, Loader2, MapPin, Trash2 } from "lucide-react";
import { SEVERITY_META } from "@/lib/constants";
import { usePreferences, useSavePreferences } from "@/lib/hooks/use-preferences";
import { usePush } from "@/lib/hooks/use-push";
import type { SavedLocation, Severity, UserPreferences } from "@/lib/types";
import { SEVERITIES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";

const RADIUS_OPTIONS = [1, 5, 10, 25];

/**
 * Alerts and saved places (PRD sections 4.3, 4.7).
 *
 * The notification block only appears when the browser supports Push and the
 * deployment has VAPID keys — offering a switch that cannot work is worse than
 * not offering one.
 */
export function SettingsSheet({
  open,
  onOpenChange,
  currentView,
  onGoToPlace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentView: { latitude: number; longitude: number; zoom: number } | null;
  onGoToPlace: (place: SavedLocation) => void;
}) {
  const { data, isLoading } = usePreferences();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {data ? (
        // Keyed on the loaded copy, so opening the sheet again after a change
        // elsewhere remounts the form with fresh values. Syncing props into
        // state with an effect would render stale values first.
        <SettingsForm
          key={`${open}:${JSON.stringify(data.preferences)}`}
          initial={data.preferences}
          isAuthenticated={data.isAuthenticated}
          currentView={currentView}
          onOpenChange={onOpenChange}
          onGoToPlace={onGoToPlace}
        />
      ) : (
        <SheetContent side="bottom" className="sm:mx-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>
              {isLoading ? "Loading your settings…" : "Settings unavailable."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex justify-center py-10">
            {isLoading && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

function SettingsForm({
  initial,
  isAuthenticated,
  currentView,
  onOpenChange,
  onGoToPlace,
}: {
  initial: UserPreferences;
  isAuthenticated: boolean;
  currentView: { latitude: number; longitude: number; zoom: number } | null;
  onOpenChange: (open: boolean) => void;
  onGoToPlace: (place: SavedLocation) => void;
}) {
  const savePreferences = useSavePreferences();
  const push = usePush();
  const { toast } = useToast();

  const [draft, setDraft] = useState<UserPreferences>(initial);
  const [placeName, setPlaceName] = useState("");

  const notifications = draft.notifications;

  function update(patch: Partial<UserPreferences>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateNotifications(patch: Partial<UserPreferences["notifications"]>) {
    setDraft((current) => ({
      ...current,
      notifications: { ...current.notifications, ...patch },
    }));
  }

  async function toggleAlerts(enabled: boolean) {
    updateNotifications({ enabled });

    if (!enabled) {
      await push.unsubscribe();
      return;
    }

    const ok = await push.subscribe(
      { ...notifications, enabled: true },
      currentView
        ? { latitude: currentView.latitude, longitude: currentView.longitude }
        : null,
    );

    // Roll the switch back if the browser refused, rather than showing an "on"
    // toggle that sends nothing.
    if (!ok) updateNotifications({ enabled: false });
  }

  function saveCurrentPlace() {
    if (!currentView) return;

    const name = placeName.trim() || "Saved place";
    const location: SavedLocation = {
      id: `${Date.now()}`,
      name,
      latitude: currentView.latitude,
      longitude: currentView.longitude,
      zoom: currentView.zoom,
    };

    update({ savedLocations: [...draft.savedLocations, location].slice(0, 20) });
    setPlaceName("");
  }

  async function persist() {
    try {
      await savePreferences.mutateAsync(draft);
      toast({ title: "Settings saved" });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <SheetContent
      side="bottom"
      className="flex max-h-[85vh] flex-col sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
    >
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            {isAuthenticated
              ? "Synced to your account."
              : "Saved to this browser. Sign in later to sync across devices."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-3">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Alerts
            </h3>

            {!push.available ? (
              <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
                Push alerts are not available here. They need a browser that
                supports Web Push and VAPID keys configured on the server — see
                SETUP.md.
              </p>
            ) : (
              <div className="space-y-4">
                <Label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    <span>
                      <span className="block">Alert me about new outages</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        Near the area you are viewing now
                      </span>
                    </span>
                  </span>
                  <Switch
                    checked={notifications.enabled}
                    disabled={push.busy}
                    onCheckedChange={toggleAlerts}
                  />
                </Label>

                {push.error && (
                  <p className="text-sm text-destructive">{push.error}</p>
                )}

                {notifications.enabled && (
                  <>
                    <div>
                      <Label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
                        Only tell me about
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {SEVERITIES.map((severity) => (
                          <button
                            key={severity}
                            type="button"
                            onClick={() =>
                              updateNotifications({
                                severityThreshold: severity as Severity,
                              })
                            }
                            aria-pressed={
                              notifications.severityThreshold === severity
                            }
                            className={`rounded-full border px-3 py-2 text-sm ${
                              notifications.severityThreshold === severity
                                ? "border-primary bg-secondary"
                                : "border-input text-muted-foreground"
                            }`}
                          >
                            {SEVERITY_META[severity].label} and worse
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground">
                        Within
                      </Label>
                      <div className="flex gap-2">
                        {RADIUS_OPTIONS.map((miles) => (
                          <button
                            key={miles}
                            type="button"
                            onClick={() =>
                              updateNotifications({ radiusMiles: miles })
                            }
                            aria-pressed={notifications.radiusMiles === miles}
                            className={`flex-1 rounded-lg border py-2 text-sm ${
                              notifications.radiusMiles === miles
                                ? "border-primary bg-secondary"
                                : "border-input text-muted-foreground"
                            }`}
                          >
                            {miles} mi
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label
                          htmlFor="quiet-start"
                          className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground"
                        >
                          Quiet from
                        </Label>
                        <Input
                          id="quiet-start"
                          type="time"
                          value={notifications.quietHoursStart ?? ""}
                          onChange={(event) =>
                            updateNotifications({
                              quietHoursStart: event.target.value || null,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="quiet-end"
                          className="mb-1.5 block text-xs uppercase tracking-wide text-muted-foreground"
                        >
                          Until
                        </Label>
                        <Input
                          id="quiet-end"
                          type="time"
                          value={notifications.quietHoursEnd ?? ""}
                          onChange={(event) =>
                            updateNotifications({
                              quietHoursEnd: event.target.value || null,
                            })
                          }
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="border-t pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved places
            </h3>

            {draft.savedLocations.length > 0 && (
              <ul className="mb-3 space-y-1">
                {draft.savedLocations.map((location) => (
                  <li
                    key={location.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onGoToPlace(location);
                        onOpenChange(false);
                      }}
                      className="flex min-h-0 flex-1 items-center gap-2 truncate text-left"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{location.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          savedLocations: draft.savedLocations.filter(
                            (l) => l.id !== location.id,
                          ),
                        })
                      }
                      aria-label={`Remove ${location.name}`}
                      className="min-h-0 rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <Input
                value={placeName}
                onChange={(event) => setPlaceName(event.target.value)}
                placeholder="Name this view, e.g. Home"
                maxLength={60}
                aria-label="Name for the current map view"
              />
              <Button
                type="button"
                variant="outline"
                onClick={saveCurrentPlace}
                disabled={!currentView}
              >
                Save
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Saves wherever the map is pointing right now.
            </p>
          </section>
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={persist}
            disabled={savePreferences.isPending}
            className="flex-1"
          >
            {savePreferences.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save
          </Button>
      </SheetFooter>
    </SheetContent>
  );
}
