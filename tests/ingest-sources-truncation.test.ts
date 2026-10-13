import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareRadarSource } from "@/lib/ingest/cloudflare-radar";
import { IodaSource } from "@/lib/ingest/ioda";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CLOUDFLARE_RADAR_TOKEN", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function iodaAlerts(count: number) {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => ({
    datasource: "bgp",
    entity: { code: String(1000 + (i % 50)), name: "Texas", type: "region" },
    time: now - i,
    level: "normal",
    value: 100,
    historyValue: 100,
  }));
}

function radarAnnotations(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    startDate: new Date(Date.now() - 60_000).toISOString(),
    endDate: null,
    scope: "Texas",
  }));
}

describe("IODA truncation", () => {
  it("asks for 1000 alerts and is not truncated below that", async () => {
    fetchMock.mockResolvedValue(json({ data: iodaAlerts(999) }));
    const result = await new IodaSource().fetch();
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=1000");
    expect(result.truncated).toBe(false);
  });

  it("flags a response that filled the 1000-alert limit as truncated", async () => {
    fetchMock.mockResolvedValue(json({ data: iodaAlerts(1000) }));
    expect((await new IodaSource().fetch()).truncated).toBe(true);
  });
});

describe("Cloudflare Radar truncation", () => {
  it("asks for 100 annotations and is not truncated below that", async () => {
    fetchMock.mockResolvedValue(json({ success: true, result: { annotations: radarAnnotations(99) } }));
    const result = await new CloudflareRadarSource().fetch();
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=100&");
    expect(result.truncated).toBe(false);
    expect(result.outages).toHaveLength(99);
  });

  it("flags a response that filled the 100-annotation limit as truncated", async () => {
    fetchMock.mockResolvedValue(json({ success: true, result: { annotations: radarAnnotations(100) } }));
    expect((await new CloudflareRadarSource().fetch()).truncated).toBe(true);
  });
});
