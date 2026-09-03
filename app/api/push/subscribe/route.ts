import { badRequest, ok, readJson, serverError } from "@/lib/api";
import { getWritableIdentity } from "@/lib/identity";
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/push";
import { fieldErrors, preferencesSchema, pushSubscriptionSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  subscription: pushSubscriptionSchema,
  settings: preferencesSchema.shape.notifications,
  center: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .nullable(),
});

/** POST /api/push/subscribe — register or update this browser's subscription. */
export async function POST(request: Request) {
  try {
    if (!pushConfigured()) {
      return badRequest("Push notifications are not configured on this server");
    }

    const identity = await getWritableIdentity();
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest("Invalid subscription", fieldErrors(parsed.error));
    }

    saveSubscription({
      identity: identity.id,
      endpoint: parsed.data.subscription.endpoint,
      keys: parsed.data.subscription.keys,
      settings: parsed.data.settings,
      center: parsed.data.center,
    });

    return ok({ subscribed: true });
  } catch (error) {
    return serverError(error, "POST /api/push/subscribe");
  }
}

/** DELETE /api/push/subscribe — unsubscribe this browser. */
export async function DELETE(request: Request) {
  try {
    const body = (await readJson(request)) as { endpoint?: string };
    if (!body.endpoint) return badRequest("endpoint is required");

    removeSubscription(body.endpoint);
    return ok({ subscribed: false });
  } catch (error) {
    return serverError(error, "DELETE /api/push/subscribe");
  }
}
