import type { NextRequest } from "next/server";
import { badRequest, ok, readJson, serverError, tooMany } from "@/lib/api";
import { getRepository } from "@/lib/data";
import { parseBboxParam } from "@/lib/geo";
import { getWritableIdentity } from "@/lib/identity";
import { addressBucket } from "@/lib/client-address";
import { notifyNewOutage } from "@/lib/push";
import { LIMITS, consumeRateLimit, pruneRateLimits } from "@/lib/rate-limit";
import {
  SERVICE_TYPES,
  SEVERITIES,
  type ServiceType,
  type Severity,
} from "@/lib/types";
import { createOutageSchema, fieldErrors } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Split a repeated/comma-joined query param into a validated enum list. */
function parseEnumList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T[] | undefined {
  if (raw === null) return undefined;

  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v): v is T => (allowed as readonly string[]).includes(v));

  // An explicit empty filter means "show nothing", which is a legitimate state
  // when the user deselects everything — so an empty array is not undefined.
  return values;
}

/**
 * GET /api/outages
 *
 * Query params:
 *   bbox=minLng,minLat,maxLng,maxLat   viewport (optional; omit for everything)
 *   services=power,internet            service type filter
 *   providers=att,xfinity              provider slug filter
 *   severities=complete,degraded       severity filter
 *   resolvedHours=6                    also include recently resolved outages
 *   limit=1000
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const serviceTypes = parseEnumList<ServiceType>(
      params.get("services"),
      SERVICE_TYPES,
    );
    const severities = parseEnumList<Severity>(
      params.get("severities"),
      SEVERITIES,
    );

    // Short-circuit the "everything deselected" case rather than making the
    // database prove that an empty IN list matches nothing.
    if (serviceTypes?.length === 0 || severities?.length === 0) {
      return ok({ outages: [] });
    }

    const providersRaw = params.get("providers");
    const providerIds = providersRaw
      ? providersRaw.split(",").map((v) => v.trim()).filter(Boolean)
      : undefined;

    const limitRaw = Number(params.get("limit"));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 2000)
        : 1000;

    const resolvedRaw = Number(params.get("resolvedHours"));
    const includeResolvedHours =
      Number.isFinite(resolvedRaw) && resolvedRaw > 0
        ? Math.min(resolvedRaw, 24 * 90)
        : 0;

    const outages = await getRepository().listOutages({
      bounds: parseBboxParam(params.get("bbox")),
      serviceTypes,
      providerIds,
      severities,
      includeResolvedHours,
      limit,
    });

    return ok({ outages });
  } catch (error) {
    return serverError(error, "GET /api/outages");
  }
}

/** POST /api/outages — file a new report. */
export async function POST(request: NextRequest) {
  try {
    const identity = await getWritableIdentity();

    pruneRateLimits();

    // Two layers. The per-identity limit is the normal control; the per-address
    // one is what remains when a caller can mint identities at will, which they
    // can whenever anonymous sign-in is enabled.
    const perIdentity = await consumeRateLimit(
      `outage:create:${identity.id}`,
      LIMITS.createOutage.limit,
      LIMITS.createOutage.windowMs,
    );
    if (!perIdentity.allowed) return tooMany(perIdentity);

    const bucket = addressBucket("outage:create:addr", request);
    if (bucket) {
      const perAddress = await consumeRateLimit(
        bucket,
        LIMITS.createOutageByAddress.limit,
        LIMITS.createOutageByAddress.windowMs,
      );
      if (!perAddress.allowed) return tooMany(perAddress);
    }

    const parsed = createOutageSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest("Check the highlighted fields", fieldErrors(parsed.error));
    }

    const outage = await getRepository().createOutage(
      {
        ...parsed.data,
        description: parsed.data.description ?? null,
        address: parsed.data.address ?? null,
        city: parsed.data.city ?? null,
        state: parsed.data.state ?? null,
        zipCode: parsed.data.zipCode ?? null,
        estimatedRestoration: parsed.data.estimatedRestoration ?? null,
      },
      identity.id,
    );

    // Alerting is best effort and must never fail the report itself.
    void notifyNewOutage(outage).catch((error) =>
      console.error("[push] notifyNewOutage", error),
    );

    return ok({ outage }, { status: 201 });
  } catch (error) {
    return serverError(error, "POST /api/outages");
  }
}
