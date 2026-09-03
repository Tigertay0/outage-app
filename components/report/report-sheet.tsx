"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MapPin } from "lucide-react";
import { SERVICE_META, SEVERITY_META } from "@/lib/constants";
import { useCreateOutage, useProviders } from "@/lib/hooks/use-outages";
import { useToast } from "@/components/ui/use-toast";
import { SERVICE_TYPES, SEVERITIES } from "@/lib/types";
import type { GeocodeResult, ServiceType, Severity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ServiceIcon } from "@/components/map/markers";

/**
 * Report flow (PRD section 4.5): three steps, each one screen, no typing
 * required to finish. The description is optional and comes last so a report
 * can be filed in three taps.
 */

type Step = "service" | "location" | "severity";

const STEP_ORDER: Step[] = ["service", "location", "severity"];

export function ReportSheet({
  open,
  onOpenChange,
  pickedLocation,
  onRequestPicking,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live map centre while the user is positioning the pin. */
  pickedLocation: { latitude: number; longitude: number } | null;
  onRequestPicking: (picking: boolean) => void;
  onReported: (outageId: string) => void;
}) {
  const { data: providers = [] } = useProviders();
  const createOutage = useCreateOutage();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("service");
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState<GeocodeResult | null>(null);
  const [resolvingPlace, setResolvingPlace] = useState(false);

  const providerOptions = useMemo(
    () => providers.filter((p) => p.serviceType === serviceType),
    [providers, serviceType],
  );

  // Reset between reports so the next one starts clean.
  useEffect(() => {
    if (open) return;

    setStep("service");
    setServiceType(null);
    setProviderId(null);
    setSeverity(null);
    setDescription("");
    setPlace(null);
    onRequestPicking(false);
  }, [open, onRequestPicking]);

  useEffect(() => {
    onRequestPicking(open && step === "location");
  }, [open, step, onRequestPicking]);

  // Reverse-geocode once the pin settles, so the confirmation screen can name a
  // street rather than showing raw coordinates.
  useEffect(() => {
    if (step !== "location" || !pickedLocation) return;

    const timer = setTimeout(async () => {
      setResolvingPlace(true);
      try {
        const response = await fetch(
          `/api/geocode?lat=${pickedLocation.latitude}&lng=${pickedLocation.longitude}`,
        );
        const body = (await response.json()) as { results: GeocodeResult[] };
        setPlace(body.results[0] ?? null);
      } catch {
        setPlace(null);
      } finally {
        setResolvingPlace(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [step, pickedLocation]);

  const stepIndex = STEP_ORDER.indexOf(step);

  const canAdvance =
    (step === "service" && serviceType !== null) ||
    (step === "location" && pickedLocation !== null) ||
    (step === "severity" && severity !== null);

  async function submit() {
    if (!serviceType || !severity || !pickedLocation) return;

    try {
      const { outage } = await createOutage.mutateAsync({
        providerId,
        serviceType,
        severity,
        latitude: pickedLocation.latitude,
        longitude: pickedLocation.longitude,
        description: description.trim() || null,
        address: place?.label.split(",").slice(0, 2).join(",").trim() ?? null,
        city: place?.city ?? null,
        state: place?.state ?? null,
        zipCode: place?.zipCode ?? null,
      });

      toast({
        title: "Report submitted",
        description: "It is on the map now. Others can confirm it.",
      });

      onOpenChange(false);
      onReported(outage.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not submit report",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Content-sized, capped at 85vh. The location step's content is short,
        // so the sheet stays out of the way of the crosshair at the map centre
        // without needing a separate height rule that squeezes it into a
        // scrollbar.
        className="flex max-h-[85vh] flex-col sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>
            {step === "service" && "What is out?"}
            {step === "location" && "Where?"}
            {step === "severity" && "How bad is it?"}
          </SheetTitle>
          <SheetDescription>
            Step {stepIndex + 1} of {STEP_ORDER.length}
          </SheetDescription>

          <div
            className="mt-2 flex gap-1.5"
            role="progressbar"
            aria-valuenow={stepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={STEP_ORDER.length}
          >
            {STEP_ORDER.map((s, index) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full ${
                  index <= stepIndex ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {step === "service" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setServiceType(type);
                      setProviderId(null);
                    }}
                    aria-pressed={serviceType === type}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
                      serviceType === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:bg-accent"
                    }`}
                  >
                    <ServiceIcon type={type} className="h-6 w-6" />
                    <span className="text-sm font-medium">
                      {SERVICE_META[type].shortLabel}
                    </span>
                  </button>
                ))}
              </div>

              {serviceType && providerOptions.length > 0 && (
                <div>
                  <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Provider (optional)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {providerOptions.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() =>
                          setProviderId((current) =>
                            current === provider.id ? null : provider.id,
                          )
                        }
                        aria-pressed={providerId === provider.id}
                        className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                          providerId === provider.id
                            ? "border-primary bg-secondary"
                            : "border-input hover:bg-accent"
                        }`}
                      >
                        {provider.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "location" && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Drag the map to move the pin.
              </p>
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  {resolvingPlace ? (
                    <span className="text-muted-foreground">
                      Finding address…
                    </span>
                  ) : place ? (
                    <span className="break-words">{place.label}</span>
                  ) : pickedLocation ? (
                    <span className="text-muted-foreground">
                      {pickedLocation.latitude.toFixed(4)},{" "}
                      {pickedLocation.longitude.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Move the map to set a location
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === "severity" && (
            <div className="space-y-4">
              <div className="space-y-2">
                {SEVERITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSeverity(option)}
                    aria-pressed={severity === option}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                      severity === option
                        ? "border-primary bg-accent"
                        : "border-input hover:bg-accent"
                    }`}
                  >
                    <span
                      aria-hidden
                      style={{ backgroundColor: SEVERITY_META[option].token }}
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {SEVERITY_META[option].label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {SEVERITY_META[option].description}
                      </span>
                    </span>
                    {severity === option && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>

              <div>
                <Label htmlFor="report-description" className="mb-1.5 block">
                  Anything else? (optional)
                </Label>
                <Textarea
                  id="report-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Out since 2pm, whole street is dark"
                />
              </div>
            </div>
          )}
        </div>

        {/* Back and forward on one row: stacking them puts the primary action
            above the escape hatch, which reads backwards in a wizard. */}
        <SheetFooter className="flex-row items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (stepIndex === 0) onOpenChange(false);
              else setStep(STEP_ORDER[stepIndex - 1]);
            }}
          >
            {stepIndex === 0 ? "Cancel" : "Back"}
          </Button>

          {step === "severity" ? (
            <Button
              onClick={submit}
              disabled={!canAdvance || createOutage.isPending}
              className="flex-1"
            >
              {createOutage.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Submit report
            </Button>
          ) : (
            <Button
              onClick={() => setStep(STEP_ORDER[stepIndex + 1])}
              disabled={!canAdvance}
              className="flex-1"
            >
              Next
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
