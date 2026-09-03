import { ok, serverError } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/data";
import { getWritableIdentity } from "@/lib/identity";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * GET /api/session
 *
 * One call that tells the client who it is and which optional capabilities this
 * deployment actually has, so the UI can hide what is not wired up instead of
 * offering buttons that fail. Also the request that mints the guest cookie —
 * route handlers can set cookies, Server Components cannot.
 */
export async function GET() {
  try {
    const identity = await getWritableIdentity();

    return ok({
      identity: {
        id: identity.id,
        isAuthenticated: identity.isAuthenticated,
        isAnonymous: identity.isAnonymous,
        email: identity.email,
      },
      capabilities: {
        /**
         * False when Supabase is connected but could not issue an identity the
         * database will accept — almost always because anonymous sign-in is
         * disabled for the project. Reads still work; the UI says so rather
         * than letting a report fail at submit time.
         */
        write: identity.canWrite,
        accounts: isSupabaseConfigured(),
        push: pushConfigured(),
        /** Local mode means data is demo data and resets on restart. */
        demoData: !isSupabaseConfigured(),
      },
    });
  } catch (error) {
    return serverError(error, "GET /api/session");
  }
}
