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
import { addressBucket } from "@/lib/client-address";
import { LIMITS, consumeRateLimit } from "@/lib/rate-limit";
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

    const perIdentity = await consumeRateLimit(
      `outage:comment:${identity.id}`,
      LIMITS.comment.limit,
      LIMITS.comment.windowMs,
    );
    if (!perIdentity.allowed) return tooMany(perIdentity);

    const bucket = addressBucket("outage:comment:addr", request);
    if (bucket) {
      const perAddress = await consumeRateLimit(
        bucket,
        LIMITS.commentByAddress.limit,
        LIMITS.commentByAddress.windowMs,
      );
      if (!perAddress.allowed) return tooMany(perAddress);
    }

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
