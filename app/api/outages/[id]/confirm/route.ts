import { notFound, ok, serverError, tooMany } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { getWritableIdentity } from "@/lib/identity";
import { LIMITS, consumeAddressLimit, consumeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Shared by both methods: confirmations drive verification, and identities are
 * free to mint, so both the identity and the address are limited.
 */
async function limitConfirm(request: Request, identityId: string) {
  const perIdentity = await consumeRateLimit(
    `outage:confirm:${identityId}`,
    LIMITS.confirm.limit,
    LIMITS.confirm.windowMs,
  );
  if (!perIdentity.allowed) return tooMany(perIdentity);

  const perAddress = await consumeAddressLimit(
    "outage:confirm:addr",
    request,
    LIMITS.confirmByAddress,
  );
  return perAddress ? tooMany(perAddress) : null;
}

/** POST /api/outages/:id/confirm — "I'm affected too". */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const blocked = await limitConfirm(request, identity.id);
    if (blocked) return blocked;

    const count = await getRepository().confirmOutage(id, identity.id);
    if (count === null) return notFound("That outage no longer exists");

    return ok({ verificationCount: count, confirmedByMe: true });
  } catch (error) {
    return serverError(error, "POST /api/outages/[id]/confirm");
  }
}

/** DELETE /api/outages/:id/confirm — withdraw a confirmation. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const blocked = await limitConfirm(request, identity.id);
    if (blocked) return blocked;

    const count = await getRepository().unconfirmOutage(id, identity.id);
    if (count === null) return notFound("That outage no longer exists");

    return ok({ verificationCount: count, confirmedByMe: false });
  } catch (error) {
    return serverError(error, "DELETE /api/outages/[id]/confirm");
  }
}
