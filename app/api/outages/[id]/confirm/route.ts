import { notFound, ok, serverError, tooMany } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { getWritableIdentity } from "@/lib/identity";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/outages/:id/confirm — "I'm affected too". */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const limit = rateLimit(
      `outage:confirm:${identity.id}`,
      LIMITS.confirm.limit,
      LIMITS.confirm.windowMs,
    );
    if (!limit.allowed) return tooMany(limit);

    const count = await getRepository().confirmOutage(id, identity.id);
    if (count === null) return notFound("That outage no longer exists");

    return ok({ verificationCount: count, confirmedByMe: true });
  } catch (error) {
    return serverError(error, "POST /api/outages/[id]/confirm");
  }
}

/** DELETE /api/outages/:id/confirm — withdraw a confirmation. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const count = await getRepository().unconfirmOutage(id, identity.id);
    if (count === null) return notFound("That outage no longer exists");

    return ok({ verificationCount: count, confirmedByMe: false });
  } catch (error) {
    return serverError(error, "DELETE /api/outages/[id]/confirm");
  }
}
