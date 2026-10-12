import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  identityCount: 0,
  serviceRpc: vi.fn(),
  sessionRpc: vi.fn(),
  createServiceRoleClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/data", () => ({ isSupabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
// A fresh identity per call, so only the per-address cap can trip in these tests.
vi.mock("@/lib/identity", () => ({
  getIdentity: async () => ({ id: `guest-${++mocks.identityCount}` }),
}));

import { GET } from "@/app/api/geocode/route";
import { LIMITS } from "@/lib/rate-limit";

function geocodeRequest(address: string | null = "203.0.113.7") {
  return new NextRequest("http://localhost/api/geocode?q=springfield", {
    headers: address ? { "x-forwarded-for": address } : {},
  });
}

const allowedRow = [{ allowed: true, remaining: 29, retry_after: 0 }];

beforeEach(() => {
  mocks.configured = true;
  mocks.serviceRpc.mockReset().mockResolvedValue({ data: allowedRow, error: null });
  mocks.sessionRpc.mockReset().mockResolvedValue({ data: null, error: { message: "permission denied for function consume_rate_limit" } });
  mocks.createServiceRoleClient.mockReset().mockReturnValue({ rpc: mocks.serviceRpc });
  mocks.createServerSupabaseClient.mockReset().mockResolvedValue({ rpc: mocks.sessionRpc });
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("[]", { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The in-memory counters live on globalThis; start each test from empty.
  delete (globalThis as { __rateBuckets?: unknown }).__rateBuckets;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/geocode per-address cap — shared limiter", () => {
  it("counts the address in Postgres through the service-role client with the geocode limits", async () => {
    const response = await GET(geocodeRequest());

    expect(response.status).toBe(200);
    expect(mocks.createServiceRoleClient).toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(1);
    expect(mocks.serviceRpc).toHaveBeenCalledWith("consume_rate_limit", {
      bucket_key: expect.stringMatching(/^geocode:addr:[0-9a-f]{32}$/),
      max_hits: LIMITS.geocode.limit,
      window_seconds: LIMITS.geocode.windowMs / 1000,
    });
  });

  it("answers 429 with Retry-After when the shared counter says the address is over its cap", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, retry_after: 42 }], error: null });

    const response = await GET(geocodeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual({
      error: "You are doing that too often. Try again shortly.",
      retryAfter: 42,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("holds across cold starts: the shared count, not process memory, decides", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, retry_after: 5 }], error: null });
    // A cold start empties the in-process buckets; the cap must still apply.
    delete (globalThis as { __rateBuckets?: unknown }).__rateBuckets;

    expect((await GET(geocodeRequest())).status).toBe(429);
  });

  it("uses a different bucket per address and none when the address is unknown", async () => {
    await GET(geocodeRequest("203.0.113.7"));
    await GET(geocodeRequest("198.51.100.9"));
    const keys = mocks.serviceRpc.mock.calls.map(([, args]) => args.bucket_key);
    expect(new Set(keys).size).toBe(2);

    mocks.serviceRpc.mockClear();
    const response = await GET(geocodeRequest(null));
    expect(response.status).toBe(200);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode per-address cap — in-memory fallback", () => {
  it("falls back to the in-memory counter when there is no database", async () => {
    mocks.configured = false;

    for (let i = 0; i < LIMITS.geocode.limit; i++) {
      expect((await GET(geocodeRequest())).status).toBe(200);
    }
    const blocked = await GET(geocodeRequest());

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("falls back to the in-memory counter without a service-role key, as the rest of rate-limit.ts does", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    for (let i = 0; i < LIMITS.geocode.limit; i++) {
      expect((await GET(geocodeRequest())).status).toBe(200);
    }
    const blocked = await GET(geocodeRequest());

    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.sessionRpc).toHaveBeenCalled(); // tried, was refused (migration 010), degraded
    expect(blocked.status).toBe(429);
  });

  it("falls back to the in-memory counter when the database call fails", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    for (let i = 0; i < LIMITS.geocode.limit; i++) {
      expect((await GET(geocodeRequest())).status).toBe(200);
    }

    expect((await GET(geocodeRequest())).status).toBe(429);
  });

  it("keeps separate in-memory counts per address", async () => {
    mocks.configured = false;
    for (let i = 0; i < LIMITS.geocode.limit; i++) await GET(geocodeRequest("203.0.113.7"));

    expect((await GET(geocodeRequest("203.0.113.7"))).status).toBe(429);
    expect((await GET(geocodeRequest("198.51.100.9"))).status).toBe(200);
  });
});
