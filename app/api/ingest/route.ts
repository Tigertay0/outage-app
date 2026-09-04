import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ok, serverError } from "@/lib/api";
import { registeredSources, runIngest } from "@/lib/ingest/run";

export const dynamic = "force-dynamic";
// NWS returns a few hundred alerts; the upsert is one round trip, but leave
// room for a slow upstream rather than failing a scheduled run on a timeout.
export const maxDuration = 60;

/**
 * Poll the registered public feeds and write what they return.
 *
 * Called by Vercel Cron on the schedule in vercel.json, which is daily because
 * the Hobby plan rejects anything more frequent — a build with `*​/15 * * * *`
 * fails outright. Daily alone would leave the layer a day stale for warnings
 * that expire in hours, so `refreshIfStale` in lib/ingest/run.ts tops it up
 * from the read path; see the `after()` call in /api/advisories. On a paid plan,
 * raise the schedule and that lazy path stops firing.
 *
 * (vercel.json takes only `path` and `schedule` — it rejects a `comment` key,
 * which is why this note lives here.)
 *
 * It writes with the service-role key, so it must never be reachable by anyone
 * else: the request has to carry CRON_SECRET, and without that variable set the
 * route refuses to run rather than defaulting to open. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically.
 */

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ")
    ? header.slice(7)
    : (request.nextUrl.searchParams.get("secret") ?? "");

  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // length mismatch — which would itself leak the expected length.
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      {
        error: process.env.CRON_SECRET
          ? "Not authorised."
          : "Ingestion is disabled: CRON_SECRET is not set.",
      },
      { status: 401 },
    );
  }

  try {
    const report = await runIngest();
    return ok(report);
  } catch (error) {
    return serverError(error, "GET /api/ingest");
  }
}

/** POST does the same, for triggering a run by hand. */
export const POST = GET;

/**
 * Unauthenticated view of what is registered, so a deployment can be checked
 * without holding the secret. Deliberately says nothing about the data itself.
 */
export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "x-ingest-sources": registeredSources()
        .map((s) => `${s.name}:${s.configured ? "ready" : "unconfigured"}`)
        .join(","),
      "x-ingest-enabled": process.env.CRON_SECRET ? "true" : "false",
    },
  });
}
