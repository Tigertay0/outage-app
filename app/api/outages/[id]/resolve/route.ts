import { notFound, ok, serverError, tooMany } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { getWritableIdentity } from "@/lib/identity";
import { LIMITS, consumeAddressLimit, consumeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/outages/:id/resolve — "it's back for me".
 *
 * On Supabase this is a vote; the status only flips once enough people agree
 * (see apply_resolution_votes in migration 002). The local repository resolves
 * immediately, which is fine for demo data.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const perIdentity = await consumeRateLimit(
      `outage:resolve:${identity.id}`,
      LIMITS.resolve.limit,
      LIMITS.resolve.windowMs,
    );
    if (!perIdentity.allowed) return tooMany(perIdentity);

    const perAddress = await consumeAddressLimit(
      "outage:resolve:addr",
      request,
      LIMITS.resolveByAddress,
    );
    if (perAddress) return tooMany(perAddress);

    const outage = await getRepository().resolveOutage(id, identity.id);
    if (!outage) return notFound("That outage no longer exists");

    return ok({ outage });
  } catch (error) {
    return serverError(error, "POST /api/outages/[id]/resolve");
  }
}
