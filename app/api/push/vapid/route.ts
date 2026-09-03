import { ok } from "@/lib/api";
import { publicVapidKey } from "@/lib/push";

/**
 * GET /api/push/vapid
 *
 * The browser needs the public application server key before it can subscribe.
 * A null key tells the client that push is not configured on this deployment,
 * which is how the notification toggle knows to hide itself.
 */
export async function GET() {
  return ok({ publicKey: publicVapidKey() });
}
