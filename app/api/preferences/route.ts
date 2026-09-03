import { badRequest, ok, readJson, serverError } from "@/lib/api";
import { DEFAULT_PREFERENCES, getRepository } from "@/lib/data";
import { getIdentity } from "@/lib/identity";
import { fieldErrors, preferencesSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Saved filter preferences (PRD section 4.3).
 *
 * Guests get these too — the identity cookie is enough to key them — so the
 * "select your providers once" promise holds before anyone signs up.
 */
export async function GET() {
  try {
    const identity = await getIdentity();
    const preferences = await getRepository().getPreferences(identity.id);

    return ok({
      preferences: preferences ?? DEFAULT_PREFERENCES,
      isAuthenticated: identity.isAuthenticated,
    });
  } catch (error) {
    return serverError(error, "GET /api/preferences");
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await getIdentity();

    const parsed = preferencesSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest("Invalid preferences", fieldErrors(parsed.error));
    }

    const preferences = await getRepository().savePreferences(
      identity.id,
      parsed.data,
    );
    return ok({ preferences });
  } catch (error) {
    return serverError(error, "PUT /api/preferences");
  }
}
