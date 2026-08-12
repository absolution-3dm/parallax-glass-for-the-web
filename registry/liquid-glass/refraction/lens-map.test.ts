import { describe, expect, it } from "vitest";
import {
  computeLensMap,
  splitAxisLensMapPixels,
  type LensMapParams,
} from "./lens-map";
import {
  mapDimensionsForElement,
  refractionBackdropScale,
} from "./engine";

const baseParams: LensMapParams = {
  width: 12,
  height: 8,
  halfWidth: 60,
  halfHeight: 40,
  radius: 20,
  depth: 8,
  refrPow: 0.5,
  splay: 1,
  glow: 0,
  glowSpread: 0.16,
  glowExponent: 2.5,
  edgeHighlight: 0,
  edgeWidth: 2,
  edgeExponent: 1.5,
  specularAngle: 45,
  glareOppositeFactor: 0.84,
};

describe("aspect-correct lens maps", () => {
  it("keeps refraction thickness invariant across aspect ratios", () => {
    const refrPow = 0.5;
    const circle = refractionBackdropScale(1.1, 48, 48, refrPow);

    expect(circle).toBeCloseTo(26.4);
    expect(refractionBackdropScale(1.1, 160, 48, refrPow)).toBeCloseTo(circle);
    expect(refractionBackdropScale(1.1, 48, 160, refrPow)).toBeCloseTo(circle);
  });

  it("uses the full displacement range while preserving curvature in SVG scale", () => {
    const lower = { ...baseParams, refrPow: 0.3 };
    const higher = { ...baseParams, refrPow: 0.6 };
    const lowerMap = computeLensMap(lower);
    const higherMap = computeLensMap(higher);

    // The Snell factor is normalized out of R/G encoding, so both materials
    // get the same 8-bit precision. It is multiplied back into filter scale.
    for (let i = 0; i < lowerMap.data.length; i += 4) {
      expect(lowerMap.data[i]).toBe(higherMap.data[i]);
      expect(lowerMap.data[i + 1]).toBe(higherMap.data[i + 1]);
    }
    expect(refractionBackdropScale(1, 100, 80, 0.3)).toBe(24);
    expect(refractionBackdropScale(1, 100, 80, 0.6)).toBe(48);
  });

  it("uses the element dimensions when the long edge exceeds the quality floor", () => {
    expect(mapDimensionsForElement(360, 100, 256)).toEqual({
      width: 360,
      height: 100,
    });
  });

  it("preserves aspect ratio while upsampling a small surface", () => {
    expect(mapDimensionsForElement(120, 40, 256)).toEqual({
      width: 256,
      height: 86,
    });
  });

  it("applies DPR and the quality cap to the long edge", () => {
    expect(mapDimensionsForElement(450, 300, 256, 1024, 3)).toEqual({
      width: 1024,
      height: 684,
    });
  });

  it("scales a large panel down to the area budget, keeping aspect ratio", () => {
    // The hero stack panel: 360x408 is 147k px, well over the 64k budget.
    // Both edges round out to even, so the area lands just above the budget.
    expect(mapDimensionsForElement(360, 408, 256, 1024, 1, 65536)).toEqual({
      width: 240,
      height: 274,
    });
  });

  it("leaves a wide, short surface at full resolution under the area budget", () => {
    // Capping the long edge instead would crush this bar's 56px short edge;
    // its area is already far below the budget, so it must pass through.
    expect(mapDimensionsForElement(800, 56, 256, 1024, 1, 65536)).toEqual(
      mapDimensionsForElement(800, 56, 256),
    );
  });

  it("ignores the area budget when a caller opts out", () => {
    expect(
      mapDimensionsForElement(450, 300, 256, 1024, 3, Number.POSITIVE_INFINITY),
    ).toEqual({ width: 1024, height: 684 });
  });

  it("allocates and mirrors a rectangular displacement field", () => {
    const { data } = computeLensMap(baseParams);
    expect(data).toHaveLength(baseParams.width * baseParams.height * 4);

    const pixel = (x: number, y: number) => {
      const index = (y * baseParams.width + x) * 4;
      return Array.from(data.slice(index, index + 4));
    };

    const topLeft = pixel(1, 1);
    const topRight = pixel(baseParams.width - 2, 1);
    const bottomLeft = pixel(1, baseParams.height - 2);

    expect([255, 256]).toContain(topRight[0] + topLeft[0]);
    expect(topRight[1]).toBe(topLeft[1]);
    expect(bottomLeft[0]).toBe(topLeft[0]);
    expect([255, 256]).toContain(bottomLeft[1] + topLeft[1]);
    expect(topRight[3]).toBe(topLeft[3]);
    expect(bottomLeft[3]).toBe(topLeft[3]);
  });

  it("uses splay to fan every edge half toward its adjacent corner", () => {
    const params: LensMapParams = {
      ...baseParams,
      width: 200,
      height: 120,
      halfWidth: 200,
      halfHeight: 120,
      radius: 24,
      depth: 24,
      splay: 1,
    };
    const { data } = computeLensMap(params);
    const channel = (x: number, y: number, offset: number) =>
      data[(y * params.width + x) * 4 + offset];

    const upper = 30;
    const lower = params.height - 1 - upper;
    const left = 30;
    const right = params.width - 1 - left;

    // Left and right edges: upper halves bend up, lower halves bend down.
    expect(channel(1, upper, 1)).toBeGreaterThan(128);
    expect(channel(1, lower, 1)).toBeLessThan(128);
    expect(channel(params.width - 2, upper, 1)).toBeGreaterThan(128);
    expect(channel(params.width - 2, lower, 1)).toBeLessThan(128);

    // Top and bottom edges: left halves bend left, right halves bend right.
    expect(channel(left, 1, 0)).toBeGreaterThan(128);
    expect(channel(right, 1, 0)).toBeLessThan(128);
    expect(channel(left, params.height - 2, 0)).toBeGreaterThan(128);
    expect(channel(right, params.height - 2, 0)).toBeLessThan(128);
  });

  it("builds a mirrored edge-order mask for opposite pass orders", () => {
    const params: LensMapParams = {
      ...baseParams,
      width: 200,
      height: 120,
      halfWidth: 200,
      halfHeight: 120,
      radius: 24,
      depth: 24,
      splay: 1,
    };
    const { edgeOrderData } = computeLensMap(params, true);
    expect(edgeOrderData).not.toBeNull();

    const alpha = (x: number, y: number) =>
      edgeOrderData![(y * params.width + x) * 4 + 3];

    const top = alpha(params.width / 2, 1);
    const bottom = alpha(params.width / 2, params.height - 2);
    const left = alpha(1, params.height / 2);
    const right = alpha(params.width - 2, params.height / 2);

    expect(top).toBeGreaterThan(240);
    expect(bottom).toBe(top);
    expect(left).toBeLessThan(15);
    expect(right).toBe(left);
  });

  it("uses the local silhouette normal when splay is zero", () => {
    const params: LensMapParams = {
      ...baseParams,
      width: 200,
      height: 120,
      halfWidth: 200,
      halfHeight: 120,
      radius: 24,
      depth: 24,
      splay: 0,
    };
    const { data } = computeLensMap(params);
    const channel = (x: number, y: number, offset: number) =>
      data[(y * params.width + x) * 4 + offset];

    expect(channel(1, 30, 1)).toBe(128);
    expect(channel(params.width - 2, 30, 1)).toBe(128);
    expect(channel(30, 1, 0)).toBe(128);
    expect(channel(30, params.height - 2, 0)).toBe(128);
  });

  it("keeps the displacement texture opaque, including its neutral exterior", () => {
    const { data } = computeLensMap(baseParams);

    for (let index = 3; index < data.length; index += 4) {
      expect(data[index]).toBe(255);
    }

    expect(Array.from(data.slice(0, 4))).toEqual([128, 128, 128, 255]);
  });

  it("splits X and Y into independent opaque pixel maps", () => {
    const source = new Uint8ClampedArray([
      12, 34, 56, 78,
      210, 190, 170, 150,
    ]);

    const { xData, yData } = splitAxisLensMapPixels(source);

    expect(Array.from(xData)).toEqual([
      12, 128, 56, 255,
      210, 128, 170, 255,
    ]);
    expect(Array.from(yData)).toEqual([
      128, 34, 128, 255,
      128, 190, 128, 255,
    ]);
    expect(Array.from(source)).toEqual([
      12, 34, 56, 78,
      210, 190, 170, 150,
    ]);
  });
});
