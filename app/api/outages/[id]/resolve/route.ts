import { notFound, ok, serverError } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { getIdentity } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * POST /api/outages/:id/resolve — "it's back for me".
 *
 * On Supabase this is a vote; the status only flips once enough people agree
 * (see apply_resolution_votes in migration 002). The local repository resolves
 * immediately, which is fine for demo data.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getIdentity();

    const outage = await getRepository().resolveOutage(id, identity.id);
    if (!outage) return notFound("That outage no longer exists");

    return ok({ outage });
  } catch (error) {
    return serverError(error, "POST /api/outages/[id]/resolve");
  }
}
