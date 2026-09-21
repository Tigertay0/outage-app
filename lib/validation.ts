import { z } from "zod";
import { SERVICE_TYPES, SEVERITIES } from "./types";

/**
 * Request schemas. Everything that reaches the data layer from the network goes
 * through one of these first — the local repository has no database constraints
 * to fall back on, so validation here is the only guard.
 */

export const serviceTypeSchema = z.enum(SERVICE_TYPES);
export const severitySchema = z.enum(SEVERITIES);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const createOutageSchema = z.object({
  providerId: z.string().min(1).max(64).nullable(),
  serviceType: serviceTypeSchema,
  severity: severitySchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  description: z.string().trim().max(500).nullish(),
  address: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(50).nullish(),
  zipCode: z.string().trim().max(10).nullish(),
  estimatedRestoration: z.string().datetime().nullish(),
});

export const commentSchema = z.object({
  comment: z.string().trim().min(1, "Say something").max(500),
  commentType: z.enum(["update", "resolution", "escalation"]).default("update"),
});

export const savedLocationSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  zoom: z.number().min(0).max(22),
});

export const preferencesSchema = z.object({
  serviceTypes: z.array(serviceTypeSchema),
  providerIds: z.array(z.string().max(64)).max(100),
  severities: z.array(severitySchema),
  savedLocations: z.array(savedLocationSchema).max(20),
  notifications: z.object({
    enabled: z.boolean(),
    severityThreshold: severitySchema,
    radiusMiles: z.number().min(1).max(50),
    quietHoursStart: z.string().nullable(),
    quietHoursEnd: z.string().nullable(),
  }),
  defaultCenter: z
    .object({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      zoom: z.number().min(0).max(22),
    })
    .nullable(),
});

/**
 * The push services browsers actually issue endpoints from.
 *
 * The server POSTs to a subscription's endpoint whenever an outage is reported
 * nearby. Accepting any URL made that a server-side request forgery primitive:
 * register an endpoint of http://169.254.169.254/… or an internal hostname,
 * report an outage next to it, and the server makes the request. Real
 * endpoints only ever come from these hosts, over HTTPS.
 */
const PUSH_SERVICE_HOSTS = new Set([
  "fcm.googleapis.com", // Chrome, Edge, Opera, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari
]);

export function isPushServiceEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  // Legacy Edge used Windows Notification Service across regional hosts.
  return PUSH_SERVICE_HOSTS.has(host) || host.endsWith(".notify.windows.com");
}

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(1024)
    .refine(isPushServiceEndpoint, "Not a browser push service endpoint"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

/** Turn a ZodError into a flat field -> message map for the client. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
