import { ok, serverError } from "@/lib/api";
import { getRepository } from "@/lib/data";

/** GET /api/providers — the filter menu's source list. Changes rarely. */
export async function GET() {
  try {
    const providers = await getRepository().listProviders();

    return ok(
      { providers },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
    );
  } catch (error) {
    return serverError(error, "GET /api/providers");
  }
}
