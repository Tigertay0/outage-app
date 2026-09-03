import {
  badRequest,
  notFound,
  ok,
  readJson,
  serverError,
  tooMany,
} from "@/lib/api";
import { getRepository } from "@/lib/data";
import { getWritableIdentity } from "@/lib/identity";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { commentSchema, fieldErrors } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** POST /api/outages/:id/comments — add an update to the timeline. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const identity = await getWritableIdentity();

    const limit = rateLimit(
      `outage:comment:${identity.id}`,
      LIMITS.comment.limit,
      LIMITS.comment.windowMs,
    );
    if (!limit.allowed) return tooMany(limit);

    const parsed = commentSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest("Check your comment", fieldErrors(parsed.error));
    }

    const comment = await getRepository().addComment(
      id,
      identity.id,
      parsed.data.comment,
      parsed.data.commentType,
    );
    if (!comment) return notFound("That outage no longer exists");

    return ok({ comment }, { status: 201 });
  } catch (error) {
    return serverError(error, "POST /api/outages/[id]/comments");
  }
}
