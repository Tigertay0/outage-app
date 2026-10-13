import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestedOutage, SourceResult } from "@/lib/ingest/source";

/**
 * Feed results per source, and a tiny in-memory `outages` table whose
 * sync_official_outages mirrors migration 009: upsert every row passed,
 * resolve every active row of that source that was not passed.
 */
const mocks = vi.hoisted(() => ({
  results: {} as Record<string, () => Promise<SourceResult>>,
  outages: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(),
  failActiveRead: false,
}));

function fakeSource(name: string) {
  return class {
    readonly name = name;
    readonly label = name;
    isConfigured() {
      return name in mocks.results;
    }
    fetch() {
      return mocks.results[name]();
    }
  };
}

vi.mock("@/lib/data", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/ingest/nws", () => ({ NwsSource: fakeSource("nws") }));
vi.mock("@/lib/ingest/odin", () => ({ OdinSource: fakeSource("odin") }));
vi.mock("@/lib/ingest/ioda", () => ({ IodaSource: fakeSource("ioda") }));
vi.mock("@/lib/ingest/cloudflare-radar", () => ({ CloudflareRadarSource: fakeSource("cloudflare-radar") }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "advisories") return { upsert: async () => ({ error: null }) };
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        then: (resolve: (value: unknown) => void) => {
          const data = mocks.outages.filter((o) => Object.entries(filters).every(([k, v]) => o[k] === v));
          resolve({ data, error: null, count: mocks.failActiveRead ? data.length + 1 : data.length });
        },
      };
      return query;
    },
  }),
}));

import { pointFromGeography, runIngest } from "@/lib/ingest/run";

/** Hex EWKB for a SRID 4326 point, as PostgREST returns a geography column. */
function ewkb(lng: number, lat: number): string {
  const bytes = Buffer.alloc(25);
  bytes.writeUInt8(1, 0);
  bytes.writeUInt32LE(0x20000001, 1);
  bytes.writeUInt32LE(4326, 5);
  bytes.writeDoubleLE(lng, 9);
  bytes.writeDoubleLE(lat, 17);
  return bytes.toString("hex");
}

function stored(source: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    source_name: source,
    source_id: id,
    status: "active",
    service_type: "internet",
    severity: "degraded",
    location: ewkb(-97.5, 35.4),
    city: null,
    state: "Oklahoma",
    description: `stored ${id}`,
    estimated_restoration: null,
    reported_at: "2026-10-12T00:00:00.000Z",
    metadata: { utility_name: null, customers_affected: null, start_known: true },
    ...extra,
  };
}

function ingested(id: string): IngestedOutage {
  return {
    sourceId: id,
    providerSlug: null,
    utilityName: null,
    customersAffected: null,
    reportedAt: "2026-10-13T00:00:00.000Z",
    serviceType: "internet",
    severity: "complete",
    latitude: 30,
    longitude: -90,
    description: `fresh ${id}`,
    city: null,
    state: "Louisiana",
    estimatedRestoration: null,
    active: true,
  };
}

function statusOf(source: string, id: string) {
  return mocks.outages.find((o) => o.source_name === source && o.source_id === id)?.status;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.results = {};
  mocks.outages = [];
  mocks.failActiveRead = false;
  mocks.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "prune_expired_advisories") return { data: 0, error: null };
    const source = args.feed_source as string;
    const rows = args.feed_rows as Array<Record<string, unknown>>;
    for (const row of rows) {
      const existing = mocks.outages.find((o) => o.source_name === source && o.source_id === row.source_id);
      const location = ewkb(row.longitude as number, row.latitude as number);
      if (existing) Object.assign(existing, row, { location, status: "active" });
      else mocks.outages.push({ ...row, location, source_name: source, status: "active" });
    }
    const passed = new Set(rows.map((r) => r.source_id));
    let resolved = 0;
    for (const o of mocks.outages) {
      if (o.source_name === source && o.status === "active" && !passed.has(o.source_id)) {
        o.status = "resolved";
        resolved++;
      }
    }
    return { data: [{ upserted: rows.length, resolved }], error: null };
  });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runIngest official-outage sync", () => {
  it.each(["ioda", "cloudflare-radar"])("resolves %s outages missing from a complete response, as before", async (source) => {
    mocks.outages = [stored(source, "a"), stored(source, "b")];
    mocks.results[source] = async () => ({ outages: [ingested("a")], truncated: false });

    const report = await runIngest();

    expect(statusOf(source, "a")).toBe("active");
    expect(statusOf(source, "b")).toBe("resolved");
    expect(report.outagesResolved).toBe(1);
    expect(report.sources.find((s) => s.source === source)).toEqual({
      source,
      ok: true,
      outages: 1,
      advisories: 0,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["ioda", "cloudflare-radar"])(
    "keeps %s outages missing from a truncated response open, still upserting what came back",
    async (source) => {
      const untouched = stored(source, "b", { severity: "complete", description: "keep me as I am" });
      mocks.outages = [stored(source, "a"), { ...untouched }];
      mocks.results[source] = async () => ({ outages: [ingested("a"), ingested("c")], truncated: true });

      const report = await runIngest();

      expect(statusOf(source, "b")).toBe("active");
      expect(mocks.outages.find((o) => o.source_id === "b")).toMatchObject(untouched);
      expect(mocks.outages.find((o) => o.source_id === "a")?.description).toBe("fresh a");
      expect(statusOf(source, "c")).toBe("active");
      expect(report.outagesResolved).toBe(0);
      expect(report.sources.find((s) => s.source === source)).toEqual({
        source,
        ok: true,
        outages: 2,
        advisories: 0,
        truncated: true,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${source}: response may be truncated`));
    },
  );

  it("only skips resolving for the source that was truncated", async () => {
    mocks.outages = [stored("ioda", "gone"), stored("cloudflare-radar", "hidden")];
    mocks.results.ioda = async () => ({ outages: [], truncated: false });
    mocks.results["cloudflare-radar"] = async () => ({ outages: [], truncated: true });

    await runIngest();

    expect(statusOf("ioda", "gone")).toBe("resolved");
    expect(statusOf("cloudflare-radar", "hidden")).toBe("active");
  });

  it("writes nothing for a truncated source when its open outages can't all be read", async () => {
    mocks.outages = [stored("ioda", "b")];
    mocks.failActiveRead = true;
    mocks.results.ioda = async () => ({ outages: [ingested("a")], truncated: true });

    const report = await runIngest();

    expect(mocks.rpc).not.toHaveBeenCalledWith("sync_official_outages", expect.anything());
    expect(statusOf("ioda", "b")).toBe("active");
    expect(report.sources.find((s) => s.source === "ioda")?.ok).toBe(false);
  });
});

describe("pointFromGeography", () => {
  it("reads a hex EWKB point", () => {
    expect(pointFromGeography(ewkb(-97.5, 35.4))).toEqual({ lat: 35.4, lng: -97.5 });
  });

  it("reads a GeoJSON point", () => {
    expect(pointFromGeography({ type: "Point", coordinates: [-97.5, 35.4] })).toEqual({ lat: 35.4, lng: -97.5 });
  });

  it("rejects anything that is not a point", () => {
    expect(pointFromGeography(null)).toBeNull();
    expect(pointFromGeography("zz")).toBeNull();
    expect(pointFromGeography({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});
