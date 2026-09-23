import { z } from "zod";
import { badRequest, ok, readJson, serverError, tooMany } from "@/lib/api";
import { LIMITS, consumeAddressLimit, consumeRateLimit } from "@/lib/rate-limit";
import { getWritableIdentity } from "@/lib/identity";
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/push";
import { fieldErrors, preferencesSchema, pushSubscriptionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Per-address limit shared by both methods. */
async function limitByAddress(request: Request) {
  const blocked = await consumeAddressLimit(
    "push:subscribe:addr",
    request,
    LIMITS.pushSubscribeByAddress,
  );
  return blocked ? tooMany(blocked) : null;
}

/**
 * Accept only zone names the runtime can actually resolve, so a bad value is
 * rejected here rather than silently falling back to UTC at send time.
 */
const timezoneSchema = z
  .string()
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone")
  .nullable()
  .default(null);

const bodySchema = z.object({
  subscription: pushSubscriptionSchema,
  settings: preferencesSchema.shape.notifications,
  center: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .nullable(),
  timezone: timezoneSchema,
});

/**
 * POST /api/push/subscribe — register or update this browser's subscription.
 *
 * Also the update path: the client re-posts the same subscription with new
 * settings whenever alert preferences are saved, and the row is upserted on
 * its endpoint.
 */
export async function POST(request: Request) {
  try {
    if (!pushConfigured()) {
      return badRequest("Push notifications are not configured on this server");
    }

    const blocked = await limitByAddress(request);
    if (blocked) return blocked;

    const identity = await getWritableIdentity();

    const perIdentity = await consumeRateLimit(
      `push:subscribe:${identity.id}`,
      LIMITS.pushSubscribe.limit,
      LIMITS.pushSubscribe.windowMs,
    );
    if (!perIdentity.allowed) return tooMany(perIdentity);

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest("Invalid subscription", fieldErrors(parsed.error));
    }

    await saveSubscription({
      identity: identity.id,
      endpoint: parsed.data.subscription.endpoint,
      keys: parsed.data.subscription.keys,
      settings: parsed.data.settings,
      center: parsed.data.center,
      timezone: parsed.data.timezone,
    });

    return ok({ subscribed: true });
  } catch (error) {
    return serverError(error, "POST /api/push/subscribe");
  }
}

/** DELETE /api/push/subscribe — unsubscribe this browser. */
export async function DELETE(request: Request) {
  try {
    const blocked = await limitByAddress(request);
    if (blocked) return blocked;

    const parsed = z
      .object({ endpoint: pushSubscriptionSchema.shape.endpoint })
      .safeParse(await readJson(request));
    if (!parsed.success) return badRequest("endpoint is required");

    await removeSubscription(parsed.data.endpoint);
    return ok({ subscribed: false });
  } catch (error) {
    return serverError(error, "DELETE /api/push/subscribe");
  }
}
