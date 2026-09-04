import { after } from "next/server";
import type { NextRequest } from "next/server";
import { ok, serverError } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { parseBboxParam } from "@/lib/geo";
import { refreshIfStale } from "@/lib/ingest/run";

export const dynamic = "force-dynamic";

/**
 * GET /api/advisories?bbox=minLng,minLat,maxLng,maxLat
 *
 * Hazard warnings in view — currently National Weather Service alerts for the
 * event types that take out power, internet or phones. Separate from
 * /api/outages on purpose: these are conditions that cause outages, not reports
 * that service is down, and conflating them would put events on the map nobody
 * has lost service to.
 */
export async function GET(request: NextRequest) {
  try {
    const bounds = parseBboxParam(request.nextUrl.searchParams.get("bbox"));
    const advisories = await getRepository().listAdvisories(bounds);

    // After the response, not before it: this reader gets whatever is stored,
    // and the next one gets fresher data. Vercel's Hobby plan caps cron at one
    // run a day, so without this the layer would go a day stale for warnings
    // that expire in hours.
    after(() => refreshIfStale());

    return ok(
      { advisories },
      // Alerts change on the order of minutes, and the ingest run polls every
      // fifteen, so a short shared cache costs nothing in freshness.
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120" } },
    );
  } catch (error) {
    return serverError(error, "GET /api/advisories");
  }
}
