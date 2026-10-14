import { describe, expect, it } from "vitest";
import {
  WORLD_BOUNDS,
  isWithinBounds,
  normalizeBounds,
  parseBboxParam,
} from "@/lib/geo";

describe("parseBboxParam", () => {
  it("returns undefined when there is no bbox, so the search is world-wide", () => {
    expect(parseBboxParam(null)).toBeUndefined();
    expect(parseBboxParam("")).toBeUndefined();
  });

  it("ignores a malformed bbox", () => {
    expect(parseBboxParam("1,2,3")).toBeUndefined();
    expect(parseBboxParam("a,b,c,d")).toBeUndefined();
    expect(parseBboxParam("1,2,3,Infinity")).toBeUndefined();
  });

  it("passes an ordinary viewport through unchanged", () => {
    expect(parseBboxParam("-125,24,-66,50")).toEqual({
      minLng: -125,
      minLat: 24,
      maxLng: -66,
      maxLat: 50,
    });
  });

  // The regression: these used to reach SQL as-is and match nothing.
  it("keeps a near-world box wider than 180 degrees intact", () => {
    expect(parseBboxParam("-170,-80,170,80")).toEqual({
      minLng: -170,
      minLat: -80,
      maxLng: 170,
      maxLat: 80,
    });
  });

  it("treats a zoomed-out MapLibre viewport beyond +/-180 as the whole world", () => {
    expect(parseBboxParam("-250.5,-85,250.5,85")).toEqual({
      ...WORLD_BOUNDS,
      minLat: -85,
      maxLat: 85,
    });
  });
});

describe("normalizeBounds", () => {
  it("clamps latitude to [-90, 90]", () => {
    expect(
      normalizeBounds({ minLng: -10, minLat: -120, maxLng: 10, maxLat: 95 }),
    ).toEqual({ minLng: -10, minLat: -90, maxLng: 10, maxLat: 90 });
  });

  it("puts swapped latitudes back in order", () => {
    expect(
      normalizeBounds({ minLng: 0, minLat: 40, maxLng: 1, maxLat: 30 }),
    ).toMatchObject({ minLat: 30, maxLat: 40 });
  });

  it("treats exactly -180..180 as the whole world", () => {
    expect(normalizeBounds(WORLD_BOUNDS)).toEqual(WORLD_BOUNDS);
  });

  it("treats any span of 360 degrees or more as the whole world", () => {
    expect(
      normalizeBounds({ minLng: -400, minLat: -90, maxLng: 400, maxLat: 90 }),
    ).toEqual(WORLD_BOUNDS);
    expect(
      normalizeBounds({ minLng: 0, minLat: -90, maxLng: 360, maxLat: 90 }),
    ).toEqual(WORLD_BOUNDS);
  });

  it("wraps an unwrapped Pacific view into an antimeridian-crossing box", () => {
    expect(
      normalizeBounds({ minLng: 170, minLat: -20, maxLng: 200, maxLat: 10 }),
    ).toEqual({ minLng: 170, minLat: -20, maxLng: -160, maxLat: 10 });
    expect(
      normalizeBounds({ minLng: -200, minLat: -20, maxLng: -170, maxLat: 10 }),
    ).toEqual({ minLng: 160, minLat: -20, maxLng: -170, maxLat: 10 });
  });

  it("wraps a view entirely on a neighbouring world copy", () => {
    expect(
      normalizeBounds({ minLng: 235, minLat: 24, maxLng: 294, maxLat: 50 }),
    ).toEqual({ minLng: -125, minLat: 24, maxLng: -66, maxLat: 50 });
  });

  it("keeps 180 as an east edge rather than flipping it to -180", () => {
    expect(
      normalizeBounds({ minLng: 150, minLat: 0, maxLng: 180, maxLat: 10 }),
    ).toEqual({ minLng: 150, minLat: 0, maxLng: 180, maxLat: 10 });
  });

  it("leaves an explicit antimeridian box (west > east) alone", () => {
    expect(
      normalizeBounds({ minLng: 170, minLat: 0, maxLng: -170, maxLat: 10 }),
    ).toEqual({ minLng: 170, minLat: 0, maxLng: -170, maxLat: 10 });
  });

  it("produces boxes that select the points the original viewport showed", () => {
    const fiji = { latitude: -17.7, longitude: 178 };
    const samoa = { latitude: -13.8, longitude: -172 };
    const box = normalizeBounds({
      minLng: 170,
      minLat: -20,
      maxLng: 200,
      maxLat: 0,
    });
    expect(isWithinBounds(fiji, box)).toBe(true);
    expect(isWithinBounds(samoa, box)).toBe(true);
    expect(isWithinBounds({ latitude: -10, longitude: 0 }, box)).toBe(false);
  });
});
