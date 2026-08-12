import {
  bevelSlope,
  clampBevelDepth,
  clamp01,
  roundedBoxNormalAbs,
  sdRoundedBox,
  softKnee,
} from "./math";

/**
 * Liquid-glass lens displacement map.
 *
 * Shape uses Quilez rounded-box SDF. Refraction follows ybouane/liquidglass:
 * circular-bevel ("ripple") height field → slope × SDF normal × Snell factor.
 * Steepest at the rim, flat past zRadius — no upright→inverted edge sandwich.
 *
 * R/G encode X/Y bend, B carries specular (glow + edge), A is the lens mask.
 * Only the top-left quadrant is computed; the other three are mirrored.
 *
 * @see https://github.com/ybouane/liquidglass/blob/main/src/shaders.ts
 */

export type LensMapParams = {
  /** Output bitmap width in pixels (even). */
  width: number;
  /** Output bitmap height in pixels (even). */
  height: number;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  /** Bevel depth in px (ybouane `zRadius`). */
  depth: number;
  /**
   * Small-angle Snell factor `1 - 1/ior`.
   * Mapped from material `curvature` via {@link refrPowFromCurvature}.
   */
  refrPow: number;
  /**
   * Edge-direction splay, 0–1.
   * 0 follows the local silhouette normal; 1 follows the ray from the panel
   * center, so each straight edge fans toward its two adjacent corners.
   */
  splay: number;
  /** Fresnel rim strength (omnidirectional edge brightening). */
  glow: number;
  /** Fresnel falloff range as a fraction of min(halfWidth, halfHeight). */
  glowSpread: number;
  /** Fresnel falloff exponent. */
  glowExponent: number;
  /** Directional glare strength (the two arcs on the light axis). */
  edgeHighlight: number;
  /** Glare geometric range in px from the silhouette. */
  edgeWidth: number;
  /** Glare convergence exponent — higher = tighter arcs. */
  edgeExponent: number;
  specularAngle: number;
  /** Brightness of the arc opposite the light, 0–1 (liquid-glass-studio). */
  glareOppositeFactor: number;
};

export type LensMapResult = {
  url: string;
  /** Max |channel − 0.5| in the map (for debug arrows). */
  maxDisplacement: number;
};

/** Encode a 0–1 highlight intensity into the B channel (128 = none). */
function encodeSpec(v: number) {
  return (127 * (v > 1 ? 1 : v) + 128 + 0.5) | 0;
}

export type LensMapPixels = {
  data: Uint8ClampedArray<ArrayBuffer>;
  /**
   * White alpha mask: 1 selects the Y→X top/bottom branch, 0 selects the
   * X→Y left/right branch. Only allocated for production axis-map encoding.
   */
  edgeOrderData: Uint8ClampedArray<ArrayBuffer> | null;
  /** Max |R/G channel − 0.5| in the map (for debug arrows). */
  maxDisplacement: number;
};

export type AxisLensMapPixels = {
  /** R carries X displacement, G is neutral, B retains specular. */
  xData: Uint8ClampedArray<ArrayBuffer>;
  /** G carries Y displacement; R/B are neutral. */
  yData: Uint8ClampedArray<ArrayBuffer>;
};

export type AxisLensMapsResult = {
  xUrl: string;
  yUrl: string;
  edgeOrderUrl: string;
  /** Max |R/G channel − 0.5| in the source map. */
  maxDisplacement: number;
};

/**
 * Interpolates from the rounded-box silhouette normal to a center-radial
 * direction. The latter restores the tangential component that makes each
 * straight edge fan toward its adjacent corners: e.g. the upper half of the
 * left edge bends upward-left and its lower half bends downward-left.
 *
 * Keep the radial components independently normalized by the panel half
 * extents rather than normalizing the vector. This matches the original Aave
 * map: both channels can reach full strength near a corner while the midpoint
 * of a straight edge stays aligned with its silhouette normal.
 */
function splayedDirection(
  nx: number,
  ny: number,
  radialX: number,
  radialY: number,
  splay: number,
): { nx: number; ny: number } {
  const mix = clamp01(splay);
  return {
    nx: nx + (radialX - nx) * mix,
    ny: ny + (radialY - ny) * mix,
  };
}

/**
 * Splits one combined lens bitmap into independent, fully opaque axis maps.
 *
 * Keeping inactive channels neutral in the encoded PNGs avoids depending on
 * the SVG filter graph to rewrite channels before `feDisplacementMap` reads
 * them. The X map also owns the source B channel because the specular filter
 * derives its highlight mask from that texture.
 */
export function splitAxisLensMapPixels(
  data: Uint8ClampedArray<ArrayBuffer>,
): AxisLensMapPixels {
  const xData = new Uint8ClampedArray(data.length);
  const yData = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    xData[i] = data[i];
    xData[i + 1] = 128;
    xData[i + 2] = data[i + 2];
    xData[i + 3] = 255;

    yData[i] = 128;
    yData[i + 1] = data[i + 1];
    yData[i + 2] = 128;
    yData[i + 3] = 255;
  }

  return { xData, yData };
}

/**
 * Computes the displacement map as raw RGBA pixels.
 */
export function computeLensMap(
  p: LensMapParams,
  includeEdgeOrder = false,
): LensMapPixels {
  const width = p.width;
  const height = p.height;
  const halfWidth = width >> 1;
  const halfHeight = height >> 1;
  const data = new Uint8ClampedArray(width * height * 4);
  const edgeOrderData = includeEdgeOrder
    ? new Uint8ClampedArray(width * height * 4)
    : null;

  const hw = p.halfWidth;
  const hh = p.halfHeight;

  const cornerR = Math.min(p.radius, Math.min(hw, hh));
  // Defence in depth: callers should already clamp via buildLensMapParams.
  const zR = clampBevelDepth(p.depth, hw, hh);
  const refrPow = Math.max(0, p.refrPow);
  // R/G should use the full 8-bit displacement range. `refrPow` is the
  // theoretical peak of the optical field (slope/slopeRef and each direction
  // component are both <= 1), so divide it out here and multiply it back into
  // the SVG scale. This preserves the physical displacement while reducing
  // each encoded displacement step by `refrPow`.
  const displacementEncodeNorm = refrPow > 0 ? 1 / refrPow : 1;
  // Normalize so peak rim slope maps near full channel range; feDisplacementMap
  // `scale` then supplies pixel strength (ybouane multiplies by ~refract·30).
  const slopeRef = zR > 0 ? Math.max(bevelSlope(1, zR), 1e-3) : 1;

  const hasSpecular = p.glow > 0 || p.edgeHighlight > 0;
  const theta = (p.specularAngle * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // Doubled-angle glare (liquid-glass-studio): brightness follows
  // sin(2(φ − π/4 + A)) of the surface-normal angle φ, so two arcs sit on the
  // light axis and opposite quadrants share a value.
  const twoA = 2 * theta;
  const HALF_PI = Math.PI / 2;
  const opp = clamp01(p.glareOppositeFactor);
  const glareInv = p.edgeWidth > 0 ? 1 / p.edgeWidth : 0;
  const fresRangePx = p.glowSpread * Math.min(hw, hh);
  const fresInv = fresRangePx > 0.001 ? 1 / fresRangePx : 0;

  const stepX = (2 * hw) / width;
  const stepY = (2 * hh) / height;
  // Soft coverage across ~2 map texels so the rim does not staircase.
  const aa = Math.max(stepX, stepY);

  // Max |R/G − 127.5| in 0–255 units, tracked while writing (debug arrows).
  let maxChan = 0;

  for (let row = 0; row < halfHeight; row++) {
    const mirrorRow = height - 1 - row;
    const ay = -((row + 0.5) * stepY - hh);

    for (let col = 0; col < halfWidth; col++) {
      const mirrorCol = width - 1 - col;
      const ax = -((col + 0.5) * stepX - hw);

      // First-quadrant sample of the full centered rounded box (ax,ay ≥ 0).
      const sdf = sdRoundedBox(ax, ay, hw, hh, cornerR);

      const iTL = (row * width + col) * 4;
      const iTR = (row * width + mirrorCol) * 4;
      const iBL = (mirrorRow * width + col) * 4;
      const iBR = (mirrorRow * width + mirrorCol) * 4;

      // Coverage shapes the encoded displacement/specular values, but the
      // displacement texture itself stays fully opaque. That avoids relying
      // on an SVG-filter implementation to preserve neutral RGB underneath a
      // zero/partial alpha value; R/G=128 outside the lens remains neutral
      // even if the GPU pipeline otherwise samples premultiplied filter data.
      let coverage = 1;
      if (sdf >= aa) {
        data[iTL] = data[iTL + 1] = data[iTL + 2] = 128;
        data[iTR] = data[iTR + 1] = data[iTR + 2] = 128;
        data[iBL] = data[iBL + 1] = data[iBL + 2] = 128;
        data[iBR] = data[iBR + 1] = data[iBR + 2] = 128;
        data[iTL + 3] = data[iTR + 3] = data[iBL + 3] = data[iBR + 3] = 255;
        if (edgeOrderData) {
          for (const index of [iTL, iTR, iBL, iBR]) {
            edgeOrderData[index] = 255;
            edgeOrderData[index + 1] = 255;
            edgeOrderData[index + 2] = 255;
            edgeOrderData[index + 3] = 0;
          }
        }
        if (maxChan < 0.5) maxChan = 0.5;
        continue;
      }
      if (sdf > -aa) {
        const t = (sdf + aa) / (2 * aa);
        // Smoothstep: 1 at sdf=-aa → 0 at sdf=+aa
        coverage = 1 - t * t * (3 - 2 * t);
      }

      const { nx, ny } = roundedBoxNormalAbs(ax, ay, hw, hh, cornerR);
      if (edgeOrderData) {
        // Squaring the unit-normal component gives a smooth orientation blend:
        // horizontal rims (|ny|=1) select Y→X, vertical rims (ny=0) select
        // X→Y, and rounded corners interpolate without a diagonal seam.
        const topBottomAlpha = Math.round(255 * ny * ny * coverage);
        for (const index of [iTL, iTR, iBL, iBR]) {
          edgeOrderData[index] = 255;
          edgeOrderData[index + 1] = 255;
          edgeOrderData[index + 2] = 255;
          edgeOrderData[index + 3] = topBottomAlpha;
        }
      }
      const direction = splayedDirection(
        nx,
        ny,
        hw > 0 ? ax / hw : 0,
        hh > 0 ? ay / hh : 0,
        p.splay,
      );

      // Ybouane: slope of circular bevel; 0 outside and on the flat plateau.
      const inside = sdf < 0 ? -sdf : 0;
      const slope = sdf < 0 ? bevelSlope(inside, zR) : 0;
      const opticalMag = softKnee((slope * refrPow) / slopeRef, 1) * coverage;
      const displacementMag = opticalMag * displacementEncodeNorm;

      const hx = 0.5 * direction.nx * displacementMag;
      const hy = 0.5 * direction.ny * displacementMag;
      const rPlus = ((0.5 + hx) * 255 + 0.5) | 0;
      const rMinus = ((0.5 - hx) * 255 + 0.5) | 0;
      const gPlus = ((0.5 + hy) * 255 + 0.5) | 0;
      const gMinus = ((0.5 - hy) * 255 + 0.5) | 0;

      let d = rPlus > 127.5 ? rPlus - 127.5 : 127.5 - rPlus;
      if (d > maxChan) maxChan = d;
      d = rMinus > 127.5 ? rMinus - 127.5 : 127.5 - rMinus;
      if (d > maxChan) maxChan = d;
      d = gPlus > 127.5 ? gPlus - 127.5 : 127.5 - gPlus;
      if (d > maxChan) maxChan = d;
      d = gMinus > 127.5 ? gMinus - 127.5 : 127.5 - gMinus;
      if (d > maxChan) maxChan = d;

      let bTL = 128;
      let bTR = 128;
      let bBL = 128;
      let bBR = 128;
      if (hasSpecular) {
        // Stronger where the bevel actually bends (slope-weighted).
        // Keep specular/Fresnel on the original optical magnitude. Only the
        // displacement channels are range-normalized.
        const m = opticalMag > 0 ? Math.min(1, opticalMag) : 0;

        if (m > 0.001 || inside < fresRangePx || inside < p.edgeWidth) {
          // Fresnel rim — omnidirectional, hue-agnostic brightening that hugs
          // the silhouette (studio's refFresnel).
          let fres = 0;
          if (p.glow > 0) {
            const tF = clamp01(1 + sdf * fresInv);
            fres = p.glow * Math.pow(tF, p.glowExponent) * Math.max(m, tF);
          }

          if (p.edgeHighlight > 0) {
            // Surface-normal angle in the TL-quadrant basis (both ≥ 0).
            const phi = Math.atan2(ny, nx);

            // Two base arc values; the doubled angle makes opposite
            // quadrants (TL/BR and TR/BL) share one each.
            const gSum = 0.5 + 0.5 * Math.sin(2 * phi - HALF_PI + twoA);
            const gDiff = 0.5 + 0.5 * Math.sin(-2 * phi - HALF_PI + twoA);

            // Rim-hugging geometric falloff within edgeWidth px of the edge.
            // A single radial falloff keeps the highlight readable across the
            // full band; the old squared falloff collapsed most of it into a
            // sub-pixel line, especially on small pills.
            const tGeo = clamp01(1 + sdf * glareInv);
            const geo = tGeo * Math.max(m, tGeo) * p.edgeHighlight;

            const arcSum = Math.pow(gSum, p.edgeExponent) * geo;
            const arcDiff = Math.pow(gDiff, p.edgeExponent) * geo;

            // Far-side dimming: quadrants whose normal faces away from the
            // light get glareOppositeFactor (studio's glareFarside).
            const dLx = nx * cosT;
            const dLy = ny * sinT;
            const sumNear = dLx + dLy >= 0;
            const diffNear = dLy - dLx >= 0;

            // Fade the highlight through the same AA band as alpha so the
            // brightest rim texel never sits on the hard silhouette. Without
            // this a sub-texel bright line lands on the anti-aliased edge and
            // twinkles under sub-pixel motion. coverage is 1 for every interior
            // pixel, so only the outermost ~2 texels are tapered.
            bTL = encodeSpec((arcSum * (sumNear ? 1 : opp) + fres) * coverage);
            bBR = encodeSpec((arcSum * (sumNear ? opp : 1) + fres) * coverage);
            bTR = encodeSpec((arcDiff * (diffNear ? 1 : opp) + fres) * coverage);
            bBL = encodeSpec((arcDiff * (diffNear ? opp : 1) + fres) * coverage);
          } else if (fres > 0) {
            bTL = bTR = bBL = bBR = encodeSpec(fres * coverage);
          }
        }
      }

      data[iTL] = rPlus;
      data[iTL + 1] = gPlus;
      data[iTL + 2] = bTL;
      data[iTL + 3] = 255;
      data[iTR] = rMinus;
      data[iTR + 1] = gPlus;
      data[iTR + 2] = bTR;
      data[iTR + 3] = 255;
      data[iBL] = rPlus;
      data[iBL + 1] = gMinus;
      data[iBL + 2] = bBL;
      data[iBL + 3] = 255;
      data[iBR] = rMinus;
      data[iBR + 1] = gMinus;
      data[iBR + 2] = bBR;
      data[iBR + 3] = 255;
    }
  }

  return { data, edgeOrderData, maxDisplacement: maxChan / 255 };
}

// PNG encoding (`toDataURL`) is the expensive synchronous step, and many
// surfaces share identical params (icon pills, remounts on navigation) —
// memoize results. Params are all numbers, so a joined key is exact.
const MAP_CACHE_MAX = 192;
const mapCache = new Map<string, LensMapResult>();
const axisMapCache = new Map<string, AxisLensMapsResult>();
/** Shared encode target — maps are drawn and encoded synchronously. */
let scratchCanvas: HTMLCanvasElement | null = null;

function lensMapCacheKey(p: LensMapParams): string {
  return `${p.width},${p.height},${p.halfWidth},${p.halfHeight},${p.radius},${p.depth},${p.refrPow},${p.splay},${p.glow},${p.glowSpread},${p.glowExponent},${p.edgeHighlight},${p.edgeWidth},${p.edgeExponent},${p.specularAngle},${p.glareOppositeFactor}`;
}

const specularOverlayCache = new Map<string, LensMapResult>();

/**
 * Paint the white-with-alpha specular term (Fresnel rim + glare arcs) into
 * `dest` using the same per-pixel math as the displacement map's B channel.
 *
 * MorphMenu on iOS presents this via a double-buffered `<canvas>` (not
 * `background-image` data-URLs) so per-frame size tracking does not strobe.
 */
export function writeSpecularOverlay(
  dest: HTMLCanvasElement,
  p: LensMapParams,
  k2: number,
): { maxDisplacement: number } {
  if (dest.width !== p.width || dest.height !== p.height) {
    dest.width = p.width;
    dest.height = p.height;
  }
  const ctx = dest.getContext("2d");
  if (!ctx) return { maxDisplacement: 0 };

  const { data, maxDisplacement } = computeLensMap(p);
  for (let i = 0; i < data.length; i += 4) {
    const spec = data[i + 2] - 128; // B channel: 128 = no highlight
    const a = spec > 0 ? Math.min(255, (k2 * spec + 0.5) | 0) : 0;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = a;
  }
  ctx.putImageData(new ImageData(data, p.width, p.height), 0, 0);
  return { maxDisplacement };
}

/**
 * White-with-alpha PNG of just the specular term (Fresnel rim + glare arcs)
 * from the exact same per-pixel math as the displacement map's B channel.
 *
 * Exists for browsers whose SVG-filter pipeline rasterizes at CSS-px
 * resolution (WebKit): drawn as a plain `background-image` under
 * `mix-blend-mode: plus-lighter`, the browser's regular image pipeline
 * renders it at full device-pixel density, so the corner arcs stay sharp on
 * 2x/3x screens where the `feImage`-based filter output visibly pixelates.
 *
 * Brightness matches the filter path exactly: the filter's color matrix
 * derives mask alpha as `(B − 128)/255` (see `specularMaskColorMatrixValues`)
 * and `feComposite arithmetic` adds `k2 × mask` in premultiplied space;
 * `plus-lighter` also adds premultiplied values, so a white pixel with
 * `alpha = k2 × (B − 128)/255` contributes the identical light.
 */
export function generateSpecularOverlay(p: LensMapParams, k2: number): LensMapResult {
  const key = `${lensMapCacheKey(p)}|k2:${k2}`;
  const cached = specularOverlayCache.get(key);
  if (cached) {
    specularOverlayCache.delete(key);
    specularOverlayCache.set(key, cached);
    return cached;
  }

  const target = scratchCanvas ??= document.createElement("canvas");
  if (!target.getContext("2d")) return { url: "", maxDisplacement: 0 };
  const { maxDisplacement } = writeSpecularOverlay(target, p, k2);
  const url = target.toDataURL("image/png");

  const result: LensMapResult = { url, maxDisplacement };
  specularOverlayCache.set(key, result);
  if (specularOverlayCache.size > MAP_CACHE_MAX) {
    const oldest = specularOverlayCache.keys().next().value;
    if (oldest !== undefined) specularOverlayCache.delete(oldest);
  }
  return result;
}

function rememberMap<T>(
  cache: Map<string, T>,
  key: string,
  result: T,
) {
  cache.set(key, result);
  if (cache.size > MAP_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * Encodes separate X-only and Y-only displacement textures plus the
 * top/bottom-vs-sides branch mask from one lens-map calculation. The mask is
 * not a displacement input; it only composites the two isolated-axis orders.
 */
export function generateAxisLensMaps(
  p: LensMapParams,
  canvas?: HTMLCanvasElement,
): AxisLensMapsResult {
  const key = lensMapCacheKey(p);
  const cached = axisMapCache.get(key);
  if (cached) {
    axisMapCache.delete(key);
    axisMapCache.set(key, cached);
    return cached;
  }

  const target = canvas ?? (scratchCanvas ??= document.createElement("canvas"));
  target.width = p.width;
  target.height = p.height;
  const ctx = target.getContext("2d");
  if (!ctx) {
    return { xUrl: "", yUrl: "", edgeOrderUrl: "", maxDisplacement: 0 };
  }

  const { data, edgeOrderData, maxDisplacement } = computeLensMap(p, true);
  const { xData, yData } = splitAxisLensMapPixels(data);

  ctx.putImageData(new ImageData(xData, p.width, p.height), 0, 0);
  const xUrl = target.toDataURL("image/png");
  ctx.putImageData(new ImageData(yData, p.width, p.height), 0, 0);
  const yUrl = target.toDataURL("image/png");
  if (!edgeOrderData) {
    return { xUrl: "", yUrl: "", edgeOrderUrl: "", maxDisplacement: 0 };
  }
  ctx.putImageData(new ImageData(edgeOrderData, p.width, p.height), 0, 0);
  const edgeOrderUrl = target.toDataURL("image/png");

  const result: AxisLensMapsResult = {
    xUrl,
    yUrl,
    edgeOrderUrl,
    maxDisplacement,
  };
  rememberMap(axisMapCache, key, result);
  return result;
}

/**
 * Renders the combined opaque RGBA lens map used by dev inspection and legacy
 * callers: R/G carry X/Y displacement and B carries the specular signal.
 * Production Chromium refraction uses {@link generateAxisLensMaps} instead.
 */
export function generateLensMap(
  p: LensMapParams,
  canvas?: HTMLCanvasElement,
): LensMapResult {
  const key = lensMapCacheKey(p);
  const cached = mapCache.get(key);
  if (cached) {
    // Refresh LRU position.
    mapCache.delete(key);
    mapCache.set(key, cached);
    return cached;
  }

  const target = canvas ?? (scratchCanvas ??= document.createElement("canvas"));
  target.width = p.width;
  target.height = p.height;
  const ctx = target.getContext("2d");
  if (!ctx) {
    return { url: "", maxDisplacement: 0 };
  }

  const { data, maxDisplacement } = computeLensMap(p);
  ctx.putImageData(new ImageData(data, p.width, p.height), 0, 0);
  const url = target.toDataURL("image/png");

  const result: LensMapResult = {
    url,
    maxDisplacement,
  };
  rememberMap(mapCache, key, result);
  return result;
}
