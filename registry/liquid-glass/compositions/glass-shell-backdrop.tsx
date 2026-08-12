"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  generateAxisLensMaps,
  writeSpecularOverlay,
} from "../refraction/lens-map";
import { refrPowFromCurvature } from "../refraction/math";
import {
  backdropFilterPadding,
  buildLensMapParams,
  chromaticChannelScales,
  DISPLACEMENT_PNG_MID_BIAS,
  evenMapSize,
  glassEngine,
  glassPointerHighlight,
  glassPointerHighlightMaskUrl,
  glassSurfaceCssVars,
  mapBakeDpr,
  refractionBackdropScale,
  specularCompositeCoefficients,
  specularMaskColorMatrixValues,
  cssBackdropBlurPx,
} from "../refraction/engine";
import {
  resolveGlassMaterial,
  type GlassMaterialInput,
  type GlassMaterialMode,
} from "../materials/materials";
import { observeNearViewport } from "../viewport-visibility";
import { useMorphMenuOptional } from "./morph-menu";
import "../liquid-glass.css";
import "./liquid-glass-compositions.css";

export type GlassShellBackdropProps = {
  borderRadius?: number;
  material?: GlassMaterialInput;
  materialMode?: GlassMaterialMode;
};

const shellPaintOwners = new WeakMap<HTMLElement, symbol>();

function clearShellPaint(shell: HTMLElement) {
  shell.classList.remove("glass-shell");
  shell.classList.remove("glass-shell--backdrop-svg");
  shell.style.backdropFilter = "";
  shell.style.removeProperty("-webkit-backdrop-filter");
  for (const key of Object.keys(glassSurfaceCssVars(0, "#000000"))) {
    shell.style.removeProperty(key);
  }
}

const STATIC_MAP_REGEN_STEP_PX = 16;
const STATIC_MAP_SETTLE_MS = 96;
/** Quantize morph bake dims so we do not PNG-encode every spring pixel. */
// 8px keeps the locale menu's 40px width/height delta on one quantized path;
// 16px made the baked aspect alternate between 32px and 48px deltas, so the
// refracted rim visibly trailed the CSS silhouette during expansion.
const MORPH_MAP_REGEN_STEP_PX = 8;
/** Half-quality floor while the shell is mid-spring; settle rebakes full quality. */
const MORPH_MAP_QUALITY = evenMapSize(Math.max(64, glassEngine.mapQuality / 2));
/** Cap long-edge map size during morph — kept low, this bakes on every step. */
const MORPH_MAP_QUALITY_CAP = evenMapSize(glassEngine.mapQuality);
/**
 * Cap for the settled (non-LOD) bake only, well above the shared map sizing
 * shared 1024 default: that default was sized for CSS-px elements with no
 * DPR multiplier, so on a 3x-DPR phone it truncates a merely medium-sized
 * expanded panel (e.g. ~450 CSS px tall × 3 ≈ 1350px) back down below even
 * 1:1 device-pixel density — losing exactly the corner/rim sharpness the
 * DPR boost was meant to add. This only affects the one bake that runs once
 * per settle, not the per-frame morph path above.
 */
const SETTLED_MAP_QUALITY_CAP = 2048;

function quantizeMorphDim(px: number) {
  const step = MORPH_MAP_REGEN_STEP_PX;
  return Math.max(step, Math.round(px / step) * step);
}

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(UA) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const IS_SAFARI = IS_IOS || /^((?!chrome|chromium|android).)*safari/i.test(UA);

let backdropSvgSupport: boolean | null = null;
function supportsBackdropSvgFilter(): boolean {
  if (backdropSvgSupport !== null) return backdropSvgSupport;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (IS_SAFARI || /Firefox/.test(UA)) {
    backdropSvgSupport = false;
    return false;
  }
  const div = document.createElement("div");
  div.style.backdropFilter = "url(#glass-shell-probe)";
  backdropSvgSupport = div.style.backdropFilter !== "";
  return backdropSvgSupport;
}

/**
 * Ensure a data-URL is decoded before SVG feImage samples it.
 * Resizing feImage before decode stretches the previous bitmap (Fresnel jump).
 */
function whenImageReady(url: string, onReady: () => void) {
  const img = new Image();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onReady();
  };
  img.onload = finish;
  img.onerror = finish;
  img.src = url;
  if (img.complete && img.naturalWidth > 0) {
    finish();
    return;
  }
  void img.decode().then(finish).catch(finish);
}

function whenImagesReady(urls: string[], onReady: () => void) {
  const pending = new Set(urls.filter(Boolean));
  if (pending.size === 0) {
    onReady();
    return;
  }
  for (const url of pending) {
    whenImageReady(url, () => {
      pending.delete(url);
      if (pending.size === 0) onReady();
    });
  }
}

type ShellLens = {
  mapUrl: string;
  xMapUrl: string;
  yMapUrl: string;
  edgeOrderMapUrl: string;
  width: number;
  height: number;
  radius: number;
  backdropRedScale: number;
  backdropGreenScale: number;
  backdropBlueScale: number;
  backdropBlurPx: number;
  specular: number;
  tint: number;
  fill: string;
  mapKey: string;
};

/**
 * Same liquid-glass optics as `GlassSurface` (material registry + `glassEngine`),
 * painted onto a transformed shell (MorphMenu / viewer chrome) where a child
 * `backdrop-filter` cannot sample the page.
 *
 * Pipeline matches GlassSurface:
 * - Tint + flat-white specular (k2) via the content lens filter
 * - Refraction + hue-preserving specular (k1) via the backdrop filter
 *
 * Specular stays on the tint paint layer (never a transparent overlay) so
 * the baked rim composites against the round tint. The paint node sits
 * inside an overflow+radius clip wrapper — same silhouette AA path as
 * cropping a blurred child. Filter box is synced to the live clip every
 * morph frame (`applyLiveGeometry`) so mid-spring geometry lag cannot
 * chase-clip the highlight.
 */
export function GlassShellBackdrop({
  borderRadius = 24,
  material = "navigation",
  materialMode = "dark",
}: GlassShellBackdropProps) {
  const resolvedMaterial = useMemo(
    () => resolveGlassMaterial(material, materialMode),
    [material, materialMode],
  );
  const {
    scale,
    depth,
    curvature,
    splay,
    chroma,
    blur,
    glow,
    edgeHighlight,
    specularAngle,
    specular,
    tint,
    fill,
  } = resolvedMaterial;
  const morph = useMorphMenuOptional();
  const morphHost = Boolean(morph);
  const morphing = morph?.morphing ?? false;

  const materialParams = {
    scale,
    depth,
    curvature,
    splay,
    chroma,
    blur,
    glow,
    edgeHighlight,
    specularAngle,
    specular,
    tint,
    fill,
  };
  const materialRef = useRef(materialParams);
  materialRef.current = materialParams;
  const borderRadiusRef = useRef(borderRadius);
  borderRadiusRef.current = borderRadius;

  const baseId = useId().replace(/:/g, "-");
  // `useId` is already unique across the React tree and, unlike a client-only
  // random suffix, stays identical for every render of this mounted instance.
  // Changing these IDs after mount lets an earlier image-decode callback paint
  // `url(#old-id)` after the SVG defs have moved to `new-id`, which detaches the
  // material during locale navigation/remounts.
  const filterId = `glass-shell-${baseId}`;
  const lensFilterId = `glass-shell-lens-${baseId}`;
  const paintOwnerRef = useRef(Symbol("glass-shell-paint-owner"));
  const paintedShellRef = useRef<HTMLElement | null>(null);

  const bridgeRef = useRef<HTMLDivElement>(null);
  const lensClipRef = useRef<HTMLDivElement>(null);
  const lensDivRef = useRef<HTMLDivElement>(null);
  const specularOverlayRef = useRef<HTMLDivElement>(null);
  const specCanvasARef = useRef<HTMLCanvasElement>(null);
  const specCanvasBRef = useRef<HTMLCanvasElement>(null);
  const specFrontIsARef = useRef(true);
  const specularBakeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingSpecTokenRef = useRef<string | null>(null);
  const backdropFilterRef = useRef<SVGFilterElement>(null);
  const lensFilterRef = useRef<SVGFilterElement>(null);
  const backdropXMapRef = useRef<SVGFEImageElement>(null);
  const backdropYMapRef = useRef<SVGFEImageElement>(null);
  const edgeOrderMapRef = useRef<SVGFEImageElement>(null);
  const pointerMaskRef = useRef<SVGFEImageElement>(null);
  const pointerFloodRef = useRef<SVGFEFloodElement>(null);
  const lensMapRef = useRef<SVGFEImageElement>(null);
  const dispRXRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispRRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispRX2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const dispR2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const dispGXRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispGRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispGX2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const dispG2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const dispBXRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispBRef = useRef<SVGFEDisplacementMapElement>(null);
  const dispBX2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const dispB2Ref = useRef<SVGFEDisplacementMapElement>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement>(null);

  const lensRef = useRef<ShellLens | null>(null);
  const commitGenRef = useRef(0);
  const committedGenRef = useRef(0);
  const pendingMapKeyRef = useRef<string | null>(null);
  const pendingLensRef = useRef<ShellLens | null>(null);
  /** Last presented CSS-blur specular token (double-buffered canvas path). */
  const paintedSpecUrlRef = useRef<string | null>(null);
  const useSvgRef = useRef(false);
  const pointerPositionRef = useRef<{ x: number | null; y: number | null; active: boolean }>({
    x: null,
    y: null,
    active: false,
  });
  const resyncPointerHighlightRef = useRef<(() => void) | null>(null);

  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bakeRafRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<{ w: number; h: number; radius: number } | null>(
    null,
  );
  const morphingRef = useRef(morphing);
  morphingRef.current = morphing;
  const morphHostRef = useRef(morphHost);
  morphHostRef.current = morphHost;
  const inViewRef = useRef(true);

  const [useSvg, setUseSvg] = useState(false);
  const [active, setActive] = useState(false);
  useSvgRef.current = useSvg;

  const getShell = () => {
    if (morph?.shellRef.current) return morph.shellRef.current;
    const content = bridgeRef.current?.parentElement;
    return content?.parentElement ?? null;
  };

  useEffect(() => {
    const shell = getShell();
    if (!shell) return;

    let frame: number | null = null;
    let x: number | null = null;
    let y: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let pointerClientX: number | null = null;
    let pointerClientY: number | null = null;
    let pointerPressed = false;

    const syncPointerMask = (cx: number, cy: number, visible: boolean) => {
      const mask = pointerMaskRef.current;
      if (!mask) return;
      if (!visible) {
        mask.setAttribute("width", "0");
        mask.setAttribute("height", "0");
        return;
      }
      const { radius } = glassPointerHighlight;
      mask.setAttribute("x", String(cx - radius));
      mask.setAttribute("y", String(cy - radius));
      mask.setAttribute("width", String(radius * 2));
      mask.setAttribute("height", String(radius * 2));
    };

    const setPointerHighlightAt = (
      clientX: number,
      clientY: number,
      strength: number,
    ) => {
      const rect = shell.getBoundingClientRect();
      targetX = clientX - rect.left;
      targetY = clientY - rect.top;

      if (x === null || y === null) {
        x = targetX;
        y = targetY;
        pointerPositionRef.current = { x, y, active: true };
        shell.style.setProperty("--glass-pointer-x", `${x}px`);
        shell.style.setProperty("--glass-pointer-y", `${y}px`);
        syncPointerMask(x, y, true);
      }

      if (frame === null) {
        const followPointer = () => {
          if (x === null || y === null) {
            frame = null;
            return;
          }

          x += (targetX - x) * 0.2;
          y += (targetY - y) * 0.2;
          pointerPositionRef.current = { x, y, active: true };
          shell.style.setProperty("--glass-pointer-x", `${x}px`);
          shell.style.setProperty("--glass-pointer-y", `${y}px`);
          syncPointerMask(x, y, true);

          if (Math.hypot(targetX - x, targetY - y) < 0.25) {
            x = targetX;
            y = targetY;
            frame = null;
            return;
          }

          frame = window.requestAnimationFrame(followPointer);
        };
        frame = window.requestAnimationFrame(followPointer);
      }

      shell.style.setProperty("--glass-highlight-strength", String(strength));
      pointerFloodRef.current?.setAttribute(
        "flood-opacity",
        String(glassPointerHighlight.bloomOpacity * strength),
      );
    };
    const clearPointerHighlight = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      x = null;
      y = null;
      pointerPositionRef.current = { x: null, y: null, active: false };
      syncPointerMask(0, 0, false);
      shell.style.setProperty("--glass-highlight-strength", "0");
      shell.removeAttribute("data-glass-pressed");
    };
    const syncPointerFromClient = () => {
      if (pointerClientX === null || pointerClientY === null) {
        clearPointerHighlight();
        return;
      }

      const rect = shell.getBoundingClientRect();
      const isInside =
        pointerClientX >= rect.left &&
        pointerClientX <= rect.right &&
        pointerClientY >= rect.top &&
        pointerClientY <= rect.bottom;

      if (!isInside) {
        clearPointerHighlight();
        return;
      }

      setPointerHighlightAt(
        pointerClientX,
        pointerClientY,
        pointerPressed
          ? glassPointerHighlight.pressedStrength
          : glassPointerHighlight.hoverStrength,
      );
      if (pointerPressed) shell.setAttribute("data-glass-pressed", "true");
    };
    resyncPointerHighlightRef.current = syncPointerFromClient;

    const onWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        pointerClientX = event.clientX;
        pointerClientY = event.clientY;
        syncPointerFromClient();
      }
    };
    const onWindowPointerLeave = () => {
      pointerClientX = null;
      pointerClientY = null;
      pointerPressed = false;
      clearPointerHighlight();
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerClientX = event.clientX;
      pointerClientY = event.clientY;
      pointerPressed = true;
      setPointerHighlightAt(
        event.clientX,
        event.clientY,
        glassPointerHighlight.pressedStrength,
      );
      shell.setAttribute("data-glass-pressed", "true");
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerPressed = false;
      if (event.pointerType === "mouse") {
        pointerClientX = event.clientX;
        pointerClientY = event.clientY;
        syncPointerFromClient();
      } else {
        pointerClientX = null;
        pointerClientY = null;
        clearPointerHighlight();
      }
      shell.removeAttribute("data-glass-pressed");
    };
    const onPointerCancel = () => {
      pointerPressed = false;
      pointerClientX = null;
      pointerClientY = null;
      clearPointerHighlight();
    };

    window.addEventListener("pointermove", onWindowPointerMove, { passive: true });
    window.addEventListener("pointerleave", onWindowPointerLeave, { passive: true });
    shell.addEventListener("pointerdown", onPointerDown);
    shell.addEventListener("pointerup", onPointerUp);
    shell.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerleave", onWindowPointerLeave);
      shell.removeEventListener("pointerdown", onPointerDown);
      shell.removeEventListener("pointerup", onPointerUp);
      shell.removeEventListener("pointercancel", onPointerCancel);
      if (resyncPointerHighlightRef.current === syncPointerFromClient) {
        resyncPointerHighlightRef.current = null;
      }
      clearPointerHighlight();
    };
    // The shell is owned by MorphMenu and is stable for this mounted bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphHost]);

  useEffect(() => {
    if (!morphHost || !morphing) return;

    let frame = window.requestAnimationFrame(function syncDuringMorph() {
      resyncPointerHighlightRef.current?.();
      frame = window.requestAnimationFrame(syncDuringMorph);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [morphHost, morphing]);

  /**
   * Optical bake mirrors GlassSurface.rebuild. During morph (`lod`), Chromium
   * bakes at quantized dims + capped map quality while live SVG geometry stays
   * fractional. The CSS-blur specular path (Safari/Firefox) instead rebakes at
   * live size every frame — an 8px LOD staircase + end-of-spring replace made
   * the Fresnel rim strobe, and freezing/stretching the first sticker was worse.
   */
  const bakeLens = (
    width: number,
    height: number,
    radiusIn: number,
    opts?: { lod?: boolean },
  ): ShellLens | null => {
    const m = materialRef.current;
    const liveW = Math.max(1, Math.round(width));
    const liveH = Math.max(1, Math.round(height));
    if (liveW < 2 || liveH < 2) return null;

    const lod = Boolean(opts?.lod);
    // Specular-only morph: track the live silhouette each frame. Axis-map morph
    // stays on the cheaper quantized LOD path.
    const cssBlurMorph = lod && !useSvgRef.current;
    const bakeW = lod && !cssBlurMorph ? quantizeMorphDim(liveW) : liveW;
    const bakeH = lod && !cssBlurMorph ? quantizeMorphDim(liveH) : liveH;
    const qualityFloor =
      lod && !cssBlurMorph ? MORPH_MAP_QUALITY : glassEngine.mapQuality;

    const hw = bakeW / 2;
    const hh = bakeH / 2;
    const radius = Math.min(radiusIn, hw, hh, liveW / 2, liveH / 2);
    const safeCurvature = Math.max(0, Math.min(1, m.curvature));

    const mapKey = [
      // cssBlurMorph keys as "full" so the settle rebake can match when size
      // stabilizes at the same CSS box (only DPR/quality may still upgrade).
      cssBlurMorph || !lod ? "full" : "lod",
      // The two paths bake different bitmaps from the same params: Chromium
      // gets independent X/Y displacement maps, WebKit/Firefox get the white
      // specular overlay. Keying the mode prevents a useSvg flip from serving
      // the wrong bitmap out of lensRef/pendingLensRef.
      useSvgRef.current ? "axis-disp-v2-order" : "spec",
      bakeW,
      bakeH,
      radius,
      m.depth,
      safeCurvature,
      m.splay,
      m.glow,
      m.edgeHighlight,
      m.specularAngle,
      m.scale,
      m.chroma,
      m.blur,
      m.specular,
      m.tint,
      qualityFloor,
      lod && !cssBlurMorph ? MORPH_MAP_QUALITY_CAP : "",
    ].join(":");

    const strength = Math.max(0, m.scale);
    const refrPow = refrPowFromCurvature(safeCurvature);
    const backdropPx = refractionBackdropScale(strength, liveW, liveH, refrPow);
    const backdropScales = chromaticChannelScales(backdropPx, m.chroma);
    const liveRadius = Math.min(radiusIn, liveW / 2, liveH / 2);

    const withLiveGeometry = (
      maps: Pick<
        ShellLens,
        "mapUrl" | "xMapUrl" | "yMapUrl" | "edgeOrderMapUrl"
      >,
    ): ShellLens => ({
      ...maps,
      width: liveW,
      height: liveH,
      radius: liveRadius,
      backdropRedScale: backdropScales.red,
      backdropGreenScale: backdropScales.green,
      backdropBlueScale: backdropScales.blue,
      backdropBlurPx: Math.max(0, m.blur ?? 0),
      specular: Math.max(0, m.specular),
      tint: m.tint,
      fill: m.fill,
      mapKey,
    });

    const prev = lensRef.current;
    if (prev && prev.mapKey === mapKey && prev.mapUrl) {
      return withLiveGeometry(prev);
    }
    const pendingLens = pendingLensRef.current;
    if (pendingLens?.mapKey === mapKey && pendingLens.mapUrl) {
      return withLiveGeometry(pendingLens);
    }

    const engine =
      lod && !cssBlurMorph
        ? { ...glassEngine, mapQuality: qualityFloor }
        : glassEngine;
    // Only the settled bake gets the DPR boost. CSS-blur morph rebakes every
    // frame at live CSS size / 1× so the rim tracks the silhouette without a
    // Retina-sized canvas cost; Chromium axis-map LOD stays quantized + 1×.
    const params = buildLensMapParams(
      {
        halfWidth: hw,
        halfHeight: hh,
        radius,
        material: {
          depth: m.depth,
          curvature: safeCurvature,
          splay: m.splay,
          glow: m.glow,
          edgeHighlight: m.edgeHighlight,
          specularAngle: m.specularAngle,
        },
      },
      engine,
      lod ? 1 : mapBakeDpr(),
      lod ? MORPH_MAP_QUALITY_CAP : SETTLED_MAP_QUALITY_CAP,
      // Both shell paths size themselves through the explicit long-edge caps
      // above, so they opt out of the engine's shared area budget: the morph
      // bake is already below it, and the settled bake deliberately trades
      // bitmap size for the rim sharpness documented on the cap constant.
      Number.POSITIVE_INFINITY,
    );
    // Chromium consumes independent X/Y displacement maps through its SVG
    // backdrop filter. WebKit/Firefox never use it (CSS-blur
    // fallback), so the only bitmap they need is the specular overlay —
    // skipping the displacement PNG entirely also halves their bake cost.
    let maps: Pick<
      ShellLens,
      "mapUrl" | "xMapUrl" | "yMapUrl" | "edgeOrderMapUrl"
    >;
    if (useSvgRef.current) {
      const axisMaps = generateAxisLensMaps(params);
      if (!axisMaps.xUrl || !axisMaps.yUrl || !axisMaps.edgeOrderUrl) {
        return null;
      }
      maps = {
        mapUrl: axisMaps.xUrl,
        xMapUrl: axisMaps.xUrl,
        yMapUrl: axisMaps.yUrl,
        edgeOrderMapUrl: axisMaps.edgeOrderUrl,
      };
    } else {
      // Paint into an offscreen bake canvas. Morph presentation double-buffers
      // from this bitmap — never through background-image data-URLs (iOS Safari
      // strobes when those URLs change every frame).
      const bake = (specularBakeCanvasRef.current ??= document.createElement("canvas"));
      writeSpecularOverlay(bake, params, Math.max(0, m.specular));
      const token = `spec-canvas:${mapKey}`;
      pendingSpecTokenRef.current = token;
      maps = {
        mapUrl: token,
        xMapUrl: token,
        yMapUrl: token,
        edgeOrderMapUrl: token,
      };
    }

    return withLiveGeometry(maps);
  };

  /** Present CSS-blur specular via hidden-canvas draw + opacity swap. */
  const presentCssBlurSpecular = (token: string) => {
    if (!token) return;
    const frontIsA = specFrontIsARef.current;
    const back = frontIsA ? specCanvasBRef.current : specCanvasARef.current;
    const front = frontIsA ? specCanvasARef.current : specCanvasBRef.current;
    if (!back || !front) return;

    // Same token after a remount: just ensure the front buffer is visible.
    if (token === paintedSpecUrlRef.current) {
      if (front.style.opacity !== "1") front.style.opacity = "1";
      if (back.style.opacity !== "0") back.style.opacity = "0";
      return;
    }
    if (pendingSpecTokenRef.current !== token) return;
    const bake = specularBakeCanvasRef.current;
    if (!bake || bake.width < 1 || bake.height < 1) return;

    if (back.width !== bake.width || back.height !== bake.height) {
      // Resize only the hidden back buffer so the clear never flashes on-screen.
      back.width = bake.width;
      back.height = bake.height;
    }
    const ctx = back.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(bake, 0, 0);

    back.style.opacity = "1";
    front.style.opacity = "0";
    specFrontIsARef.current = !frontIsA;
    paintedSpecUrlRef.current = token;
  };

  const paintShell = (lens: ShellLens) => {
    const parent = getShell();
    if (!parent) return;

    const previous = paintedShellRef.current;
    if (
      previous &&
      previous !== parent &&
      shellPaintOwners.get(previous) === paintOwnerRef.current
    ) {
      shellPaintOwners.delete(previous);
      clearShellPaint(previous);
    }
    shellPaintOwners.set(parent, paintOwnerRef.current);
    paintedShellRef.current = parent;

    const cssVars = glassSurfaceCssVars(lens.tint, lens.fill);
    for (const [key, value] of Object.entries(cssVars)) {
      parent.style.setProperty(key, String(value));
    }
    parent.classList.add("glass-shell");

    if (!inViewRef.current) {
      // Keep tint/specular paint; detach live backdrop sampling while off-screen
      // so Chromium does not re-run the SVG graph against animating page content.
      parent.classList.remove("glass-shell--backdrop-svg");
      parent.style.backdropFilter = "none";
      parent.style.setProperty("-webkit-backdrop-filter", "none");
    } else {
      parent.classList.toggle("glass-shell--backdrop-svg", useSvgRef.current);

      if (useSvgRef.current && lens.mapUrl) {
        parent.style.backdropFilter = `url(#${filterId}) saturate(${glassEngine.backdropSaturateSvg})`;
        parent.style.setProperty("-webkit-backdrop-filter", "none");
      } else {
        // Safari/Firefox: material blur is tuned for SVG displace (~1px). Boost
        // so the CSS-only path still reads as frosted glass, not a flat veil.
        const blurPx = cssBackdropBlurPx(lens.backdropBlurPx);
        const blurCss = `blur(${blurPx}px) saturate(${glassEngine.backdropSaturateCssBlur})`;
        parent.style.backdropFilter = blurCss;
        parent.style.setProperty("-webkit-backdrop-filter", blurCss);
      }
    }

    if (lensDivRef.current) {
      // Chromium: specular filter on the tint paint node; parent
      // `.glass-shell-lens` owns overflow+radius so CSS AA clips the filter
      // output. WebKit/Firefox use double-buffered canvases (see
      // presentCssBlurSpecular) — background-image data-URL swaps strobe on
      // iOS Safari when the shell springs.
      lensDivRef.current.style.filter = useSvgRef.current
        ? `url(#${lensFilterId})`
        : "none";
      lensDivRef.current.style.backgroundImage = "none";
    }
    if (!useSvgRef.current && lens.mapUrl) {
      presentCssBlurSpecular(lens.mapUrl);
    }
    if (specularOverlayRef.current) {
      specularOverlayRef.current.style.backgroundImage = "none";
      specularOverlayRef.current.style.mixBlendMode = "normal";
    }
    const showSpecCanvas = !useSvgRef.current;
    for (const canvas of [specCanvasARef.current, specCanvasBRef.current]) {
      if (!canvas) continue;
      canvas.style.visibility = showSpecCanvas ? "visible" : "hidden";
    }
    if (lensClipRef.current) {
      lensClipRef.current.style.borderRadius = `${lens.radius}px`;
    }
    if (bridgeRef.current) {
      bridgeRef.current.style.borderRadius = `${lens.radius}px`;
    }
  };

  /** Sync backdrop + lens feImage to the baked pixel size (never a newer shell). */
  const applyGeometry = (lens: ShellLens) => {
    const pad = backdropFilterPadding(lens.backdropBlurPx);
    const filter = backdropFilterRef.current;
    if (filter) {
      filter.setAttribute("x", String(-pad));
      filter.setAttribute("y", String(-pad));
      filter.setAttribute("width", String(lens.width + pad * 2));
      filter.setAttribute("height", String(lens.height + pad * 2));
    }
    for (const map of [
      backdropXMapRef.current,
      backdropYMapRef.current,
      edgeOrderMapRef.current,
    ]) {
      map?.setAttribute("width", String(lens.width));
      map?.setAttribute("height", String(lens.height));
    }
    blurRef.current?.setAttribute("stdDeviation", String(lens.backdropBlurPx));
    const backdropInput =
      lens.backdropBlurPx > 0 ? "blurredBackdrop" : "pointerBackdrop";
    for (const el of [
      dispRXRef.current,
      dispRX2Ref.current,
      dispGXRef.current,
      dispGX2Ref.current,
      dispBXRef.current,
      dispBX2Ref.current,
    ]) {
      if (!el) continue;
      el.setAttribute("in", backdropInput);
    }
    for (const el of [
      dispRXRef.current,
      dispRRef.current,
      dispRX2Ref.current,
      dispR2Ref.current,
    ]) {
      el?.setAttribute(
        "scale",
        String(lens.backdropRedScale),
      );
    }
    for (const el of [
      dispGXRef.current,
      dispGRef.current,
      dispGX2Ref.current,
      dispG2Ref.current,
    ]) {
      el?.setAttribute(
        "scale",
        String(lens.backdropGreenScale),
      );
    }
    for (const el of [
      dispBXRef.current,
      dispBRef.current,
      dispBX2Ref.current,
      dispB2Ref.current,
    ]) {
      el?.setAttribute(
        "scale",
        String(lens.backdropBlueScale),
      );
    }

    // Lens specular must also be userSpaceOnUse at the baked size. objectBoundingBox
    // auto-stretches the previous map whenever the shell aspect changes — that is
    // the Fresnel / highlight stretch-then-jump during morph.
    if (lensFilterRef.current) {
      lensFilterRef.current.setAttribute("x", "0");
      lensFilterRef.current.setAttribute("y", "0");
      lensFilterRef.current.setAttribute("width", String(lens.width));
      lensFilterRef.current.setAttribute("height", String(lens.height));
    }
    lensMapRef.current?.setAttribute("width", String(lens.width));
    lensMapRef.current?.setAttribute("height", String(lens.height));
  };

  const applyHref = (el: SVGFEImageElement | null, url: string) => {
    if (!el) return;
    el.setAttribute("href", url);
    el.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);
  };

  const applyMapHrefs = (lens: ShellLens) => {
    applyHref(backdropXMapRef.current, lens.xMapUrl);
    applyHref(backdropYMapRef.current, lens.yMapUrl);
    applyHref(edgeOrderMapRef.current, lens.edgeOrderMapUrl);
    applyHref(lensMapRef.current, lens.mapUrl);
  };

  const withLiveGeometry = (
    lens: ShellLens,
    width: number,
    height: number,
    radius: number,
  ): ShellLens => {
    const liveW = Math.max(1, width);
    const liveH = Math.max(1, height);
    const m = materialRef.current;
    const backdropPx = refractionBackdropScale(
      Math.max(0, m.scale),
      liveW,
      liveH,
      refrPowFromCurvature(m.curvature),
    );
    const backdropScales = chromaticChannelScales(backdropPx, m.chroma);
    return {
      ...lens,
      width: liveW,
      height: liveH,
      radius: Math.min(radius, liveW / 2, liveH / 2),
      backdropRedScale: backdropScales.red,
      backdropGreenScale: backdropScales.green,
      backdropBlueScale: backdropScales.blue,
      backdropBlurPx: Math.max(0, m.blur ?? 0),
    };
  };

  const finishCommit = (lens: ShellLens, gen: number, committedKey: string) => {
    // Let decoded intermediate LODs advance the visible map while a newer
    // one is still decoding. Only reject a result if a later generation has
    // already committed; this prevents regressions without leaving the old
    // endpoint map stretched across the fast first half of the spring.
    if (gen <= committedGenRef.current) return;
    committedGenRef.current = gen;
    if (gen === commitGenRef.current) {
      pendingMapKeyRef.current = null;
      pendingLensRef.current = null;
    }
    // Merge any live size that arrived while the PNG was decoding so we do
    // not briefly snap filter geometry back to the bake-time box.
    let applied = lens;
    const pending = pendingSizeRef.current;
    if (pending) {
      const live = bakeLens(pending.w, pending.h, pending.radius, {
        lod: morphHostRef.current && morphingRef.current,
      });
      if (live?.mapKey === committedKey && live.mapUrl) {
        applied = live;
      }
      // Even when this decode belongs to an older LOD bucket, never let it
      // restore that bucket's geometry over the newer fractional shell box.
      applied = withLiveGeometry(
        applied,
        pending.w,
        pending.h,
        pending.radius,
      );
    }
    lensRef.current = applied;
    applyMapHrefs(applied);
    applyGeometry(applied);
    paintShell(applied);
    if (!active) setActive(true);
  };

  const commitLens = (lens: ShellLens) => {
    const gen = ++commitGenRef.current;
    const committedKey = lens.mapKey;
    pendingMapKeyRef.current = committedKey;
    pendingLensRef.current = lens;
    // CSS-blur path paints the specular as a data-URL background-image.
    // Waiting on Image decode here meant MorphMenu often finished its open
    // spring before the first Safari rim could appear. Canvas toDataURL is
    // already displayable; commit synchronously.
    if (!useSvgRef.current) {
      finishCommit(lens, gen, committedKey);
      return;
    }
    whenImagesReady(
      [lens.mapUrl, lens.xMapUrl, lens.yMapUrl, lens.edgeOrderMapUrl],
      () => finishCommit(lens, gen, committedKey),
    );
  };

  const restoreImperative = () => {
    const lens = lensRef.current;
    if (!lens) return;
    applyMapHrefs(lens);
    applyGeometry(lens);
    paintShell(lens);
  };

  /**
   * Cheap, PNG-free geometry sync. Moves the filter box + radius to the live
   * size and stretches the *current* (already-decoded) bitmap into it. Runs
   * synchronously inside the morph-size listener — i.e. the same motion frame
   * that writes the CSS clip box — so the filter box and the clip commit
   * together. Deferring this to a rAF (scheduleBake) leaves the box one frame
   * behind the clip; while closing, the box is a frame too large and, because
   * the feImage is anchored at the top-left origin, the far bottom-right rim
   * pokes past the shrinking clip and gets eaten. The bitmap *content* (rim
   * sharpness at the new size) is refreshed asynchronously by scheduleBake.
   */
  const applyLiveGeometry = (width: number, height: number, radius: number) => {
    const cur = lensRef.current;
    if (!cur?.mapUrl) return;
    if (width < 2 || height < 2) return;
    const live = withLiveGeometry(cur, width, height, radius);
    lensRef.current = live;
    applyGeometry(live);
    paintShell(live);
  };

  const publishSize = (
    width: number,
    height: number,
    radius: number,
    opts?: { lod?: boolean },
  ) => {
    const lens = bakeLens(width, height, radius, opts);
    if (!lens) return;
    if (lensRef.current?.mapKey === lens.mapKey && lensRef.current.mapUrl) {
      const live = withLiveGeometry(lens, width, height, radius);
      lensRef.current = live;
      applyGeometry(live);
      paintShell(live);
      return;
    }
    // Do not restart decoding the same quantized LOD map every motion frame.
    // Replacing its generation token on every call means none of those images
    // can commit until the spring stops, leaving the previous map visibly
    // chasing the fill throughout the animation. Live filter geometry is
    // already synchronized above by `applyLiveGeometry`.
    if (pendingMapKeyRef.current === lens.mapKey) return;
    // A new bitmap must bake (crossed a LOD step). Move the filter box + radius
    // to the live size *now* and keep stretching the current, already-decoded
    // bitmap into it; swap the href once the new PNG decodes (commitLens).
    // Otherwise the box stays at the previous, larger size until decode — and
    // because the feImage is anchored at the top-left origin, only the far
    // bottom-right rim pokes outside the shrinking clip and gets chased/clipped
    // mid-close (top-left stays pinned at 0,0, so it barely flickers).
    if (lensRef.current?.mapUrl) {
      const live = withLiveGeometry(lens, width, height, radius);
      applyGeometry(live);
      paintShell(live);
    }
    commitLens(lens);
  };

  const scheduleBake = (w: number, h: number, radius: number) => {
    pendingSizeRef.current = { w, h, radius };
    if (bakeRafRef.current !== null) return;
    bakeRafRef.current = requestAnimationFrame(() => {
      bakeRafRef.current = null;
      const next = pendingSizeRef.current;
      if (!next) return;
      // Read morphing at fire time so a settle mid-frame still gets full quality.
      publishSize(next.w, next.h, next.radius, {
        lod: morphHostRef.current && morphingRef.current,
      });
    });
  };

  const onShellSize = (w: number, h: number, radius: number) => {
    if (w < 2 || h < 2) return;
    const rad = Math.min(radius, w / 2, h / 2);

    if (morphHost) {
      // Keep the filter box on the exact fractional shell geometry; the bitmap
      // itself still refreshes through the original quantized LOD path.
      applyLiveGeometry(w, h, rad);
      pendingSizeRef.current = { w, h, radius: rad };
      // CSS-blur specular: one live-size rebake per frame (rAF-coalesced).
      // Sync publishSize on every motion sample was either too sparse (8px LOD
      // staircase) or too eager; freezing the first sticker until settle made
      // the end swap worse. scheduleBake keeps the rim on the silhouette.
      if (!useSvgRef.current && morphingRef.current) {
        scheduleBake(w, h, rad);
        return;
      }
      // `reportMorphSize` already runs inside Motion's animation frame. Going
      // through `scheduleBake` here requests another rAF and guarantees the
      // map selection trails the fill by one frame. LOD-key/in-flight dedupe
      // keeps this synchronous call cheap except when crossing a map step.
      publishSize(w, h, rad, { lod: morphingRef.current });
      return;
    }

    scheduleBake(w, h, rad);
  };

  const onShellSizeRef = useRef(onShellSize);
  onShellSizeRef.current = onShellSize;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseSvg(supportsBackdropSvgFilter());
  }, []);

  useLayoutEffect(() => {
    const parent = getShell();
    if (!parent) return;

    return observeNearViewport(parent, (near) => {
      if (inViewRef.current === near) return;
      inViewRef.current = near;
      const lens = lensRef.current;
      if (lens) paintShell(lens);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphHost, morph?.shellRef]);

  useEffect(() => {
    const pointer = pointerPositionRef.current;
    const mask = pointerMaskRef.current;
    if (!mask || !pointer.active || pointer.x === null || pointer.y === null) return;

    const { radius } = glassPointerHighlight;
    mask.setAttribute("x", String(pointer.x - radius));
    mask.setAttribute("y", String(pointer.y - radius));
    mask.setAttribute("width", String(radius * 2));
    mask.setAttribute("height", String(radius * 2));
  }, [useSvg, active]);

  // Material changes or morph settle → invalidate and rebake at full quality.
  useEffect(() => {
    const prev = lensRef.current;
    if (prev) {
      // CSS-blur morph already rebakes live-size specular each frame under the
      // same "full" key tier. Skip the morphing=true invalidation so we do not
      // throw away the in-flight sticker; settle still refreshes once at rest.
      if (!useSvgRef.current && morphing) {
        return;
      }
      // Drop cache so settle (morphing false) always gets a fresh full bake.
      lensRef.current = { ...prev, mapKey: "" };
      onShellSizeRef.current(prev.width, prev.height, prev.radius);
      return;
    }
    const size = morph?.getMorphSize?.();
    if (size) {
      onShellSizeRef.current(size.width, size.height, size.borderRadius);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scale,
    depth,
    curvature,
    splay,
    chroma,
    blur,
    glow,
    edgeHighlight,
    specularAngle,
    specular,
    tint,
    fill,
    morphing,
    useSvg,
  ]);

  useLayoutEffect(() => {
    restoreImperative();
  });

  useEffect(() => {
    if (!morph) return;
    const unsub = morph.subscribeMorphSize((size) => {
      onShellSizeRef.current(size.width, size.height, size.borderRadius);
    });
    return () => {
      unsub();
      if (bakeRafRef.current !== null) {
        cancelAnimationFrame(bakeRafRef.current);
        bakeRafRef.current = null;
      }
    };
  }, [morph]);

  useEffect(() => {
    if (morphHost) return;
    const parent = getShell();
    if (!parent) return;

    let lastStatic = { w: 0, h: 0 };
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      onShellSizeRef.current(rect.width, rect.height, borderRadiusRef.current);
      lastStatic = {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    measure();

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w < 2 || h < 2) return;

      onShellSizeRef.current(w, h, borderRadiusRef.current);

      const rw = Math.round(w);
      const rh = Math.round(h);
      const drifted =
        Math.abs(rw - lastStatic.w) >= STATIC_MAP_REGEN_STEP_PX ||
        Math.abs(rh - lastStatic.h) >= STATIC_MAP_REGEN_STEP_PX;
      if (drifted) lastStatic = { w: rw, h: rh };

      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        onShellSizeRef.current(w, h, borderRadiusRef.current);
        lastStatic = { w: rw, h: rh };
      }, STATIC_MAP_SETTLE_MS);
    });
    ro.observe(parent);
    return () => {
      ro.disconnect();
      if (bakeRafRef.current !== null) cancelAnimationFrame(bakeRafRef.current);
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphHost]);

  useEffect(() => {
    const paintOwner = paintOwnerRef.current;
    return () => {
      // Cleanup intentionally invalidates every decode started during the
      // component's lifetime, so the latest ref value is required here.
      committedGenRef.current = ++commitGenRef.current;
      // React may clean up and re-run effects while preserving component refs
      // (Strict Effects and hidden/revealed route trees). The invalidated
      // decode above can no longer satisfy this key, so retaining the in-flight
      // marker would make the next setup dedupe away its only rebuild forever.
      pendingMapKeyRef.current = null;
      pendingLensRef.current = null;
      const parent = paintedShellRef.current;
      if (parent && shellPaintOwners.get(parent) === paintOwner) {
        shellPaintOwners.delete(parent);
        clearShellPaint(parent);
      }
      paintedShellRef.current = null;
    };
  }, []);

  const seedW = 48;
  const seedH = 48;
  const seedBlur = Math.max(0, blur ?? 0);
  const seedPad = backdropFilterPadding(seedBlur);
  const seedPx = refractionBackdropScale(
    Math.max(0, scale),
    seedW,
    seedH,
    refrPowFromCurvature(curvature),
  );
  const seedScales = chromaticChannelScales(seedPx, chroma);
  const specularK = specularCompositeCoefficients(Math.max(0, specular));
  // Mount lens-filter SVG even on the CSS-blur path (Safari) so Chromium-style
  // filter defs stay available after a mode flip; backdrop SVG only when useSvg.
  // Morph hosts always mount the double-buffered specular canvases.
  const showSvg = useSvg || active;
  const showSpecCanvases = !useSvg;

  return (
    <div
      ref={bridgeRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ borderRadius } as CSSProperties}
      aria-hidden
    >
      {showSvg ? (
        <svg
          className="absolute"
          width="0"
          height="0"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <defs>
            {/*
              Specular on tint (or morph rim carrier) — same composite as
              GlassSurface, but always userSpaceOnUse so morphing does not
              UV-stretch a stale map.
            */}
            <filter
              ref={lensFilterRef}
              id={lensFilterId}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
              x="0"
              y="0"
              width={seedW}
              height={seedH}
            >
              <feImage
                ref={lensMapRef}
                x="0"
                y="0"
                width={seedW}
                height={seedH}
                preserveAspectRatio="none"
                result="rawMap"
              />
              <feColorMatrix
                in="rawMap"
                type="matrix"
                values={specularMaskColorMatrixValues()}
                result="specMask"
              />
              <feComposite
                in="specMask"
                in2="SourceGraphic"
                operator="arithmetic"
                k1="0"
                k2={useSvg ? specularK.k2 : Math.max(0, specular)}
                k3="1"
                k4="0"
              />
            </filter>

            {useSvg ? (
              <filter
                ref={backdropFilterRef}
                id={filterId}
                filterUnits="userSpaceOnUse"
                primitiveUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
                x={-seedPad}
                y={-seedPad}
                width={seedW + seedPad * 2}
                height={seedH + seedPad * 2}
              >
                <feImage
                  ref={backdropXMapRef}
                  x="0"
                  y="0"
                  width={seedW}
                  height={seedH}
                  preserveAspectRatio="none"
                  result="rawXDisplacementMap"
                />
                <feComponentTransfer
                  in="rawXDisplacementMap"
                  result="xDisplacementMap"
                >
                  {/* Active R: cancel PNG 128≠0.5 mid bias so flat field stays
                      undisplaced; unused G forced to exact 0.5. */}
                  <feFuncR type="linear" slope="1" intercept={DISPLACEMENT_PNG_MID_BIAS} />
                  <feFuncG type="linear" slope="0" intercept="0.5" />
                </feComponentTransfer>
                <feImage
                  ref={backdropYMapRef}
                  x="0"
                  y="0"
                  width={seedW}
                  height={seedH}
                  preserveAspectRatio="none"
                  result="rawYDisplacementMap"
                />
                <feComponentTransfer
                  in="rawYDisplacementMap"
                  result="yDisplacementMap"
                >
                  <feFuncR type="linear" slope="0" intercept="0.5" />
                  <feFuncG type="linear" slope="1" intercept={DISPLACEMENT_PNG_MID_BIAS} />
                </feComponentTransfer>
                <feImage
                  ref={edgeOrderMapRef}
                  x="0"
                  y="0"
                  width={seedW}
                  height={seedH}
                  preserveAspectRatio="none"
                  result="edgeOrderMask"
                />
                <feComponentTransfer in="edgeOrderMask" result="sideOrderMask">
                  <feFuncA type="table" tableValues="1 0" />
                </feComponentTransfer>
                {/* Chromium regression guard: keep X and Y in separate passes.
                    Combining R/X + G/Y in one feDisplacementMap reintroduces
                    the top-left / bottom-right GPU shear. X and Y start from
                    independently baked textures, and the unused axis is forced
                    to exactly 0.5. Top/bottom use Y→X while sides use X→Y so
                    each region's tangential displacement is applied last;
                    see docs/glass-refraction.md. */}
                <feColorMatrix
                  in="SourceGraphic"
                  type="saturate"
                  values={String(glassPointerHighlight.saturation)}
                  result="pointerSaturated"
                />
                <feComponentTransfer in="pointerSaturated" result="pointerBright">
                  <feFuncR type="linear" slope={glassPointerHighlight.brightness} />
                  <feFuncG type="linear" slope={glassPointerHighlight.brightness} />
                  <feFuncB type="linear" slope={glassPointerHighlight.brightness} />
                </feComponentTransfer>
                <feImage
                  ref={pointerMaskRef}
                  href={glassPointerHighlightMaskUrl}
                  x="0"
                  y="0"
                  width="0"
                  height="0"
                  preserveAspectRatio="none"
                  result="pointerMask"
                />
                <feComposite in="pointerBright" in2="pointerMask" operator="in" result="pointerBoost" />
                {/* Unlike GlassSurface, the shell owns its backdrop-filter and
                    cannot sample a highlight painted by one of its children.
                    Put the white bloom into the backdrop pipeline itself so
                    the lens displacement bends it at the menu edges. */}
                <feFlood
                  ref={pointerFloodRef}
                  floodColor="white"
                  floodOpacity={0}
                  result="pointerWhite"
                />
                <feComposite in="pointerWhite" in2="pointerMask" operator="in" result="pointerBloom" />
                <feComposite in="pointerBloom" in2="pointerBoost" operator="over" result="pointerLit" />
                <feComposite in="pointerLit" in2="SourceGraphic" operator="over" result="pointerBackdrop" />
                <feGaussianBlur
                  ref={blurRef}
                  in="pointerBackdrop"
                  stdDeviation={seedBlur}
                  result="blurredBackdrop"
                />
                {seedScales.red === seedScales.green &&
                seedScales.green === seedScales.blue ? (
                  <>
                    {/* Equal channel scales (chroma = 0): compose only the two
                        edge-order branches and skip RGB splitting. */}
                    <feDisplacementMap
                      ref={dispRXRef}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="yDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispTopBottomY"
                    />
                    <feDisplacementMap
                      ref={dispRRef}
                      in="dispTopBottomY"
                      in2="xDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispTopBottom"
                    />
                    <feDisplacementMap
                      ref={dispRX2Ref}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="xDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispSidesX"
                    />
                    <feDisplacementMap
                      ref={dispR2Ref}
                      in="dispSidesX"
                      in2="yDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispSides"
                    />
                    <feComposite
                      in="dispTopBottom"
                      in2="edgeOrderMask"
                      operator="in"
                      result="dispTopBottomMasked"
                    />
                    <feComposite
                      in="dispSides"
                      in2="sideOrderMask"
                      operator="in"
                      result="dispSidesMasked"
                    />
                    <feComposite
                      in="dispTopBottomMasked"
                      in2="dispSidesMasked"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="refracted"
                    />
                  </>
                ) : (
                  <>
                    <feDisplacementMap
                      ref={dispRXRef}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="yDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispRTopBottomY"
                    />
                    <feDisplacementMap
                      ref={dispRRef}
                      in="dispRTopBottomY"
                      in2="xDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispRTopBottom"
                    />
                    <feDisplacementMap
                      ref={dispRX2Ref}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="xDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispRSidesX"
                    />
                    <feDisplacementMap
                      ref={dispR2Ref}
                      in="dispRSidesX"
                      in2="yDisplacementMap"
                      scale={seedScales.red}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispRSides"
                    />
                    <feComposite
                      in="dispRTopBottom"
                      in2="edgeOrderMask"
                      operator="in"
                      result="dispRTopBottomMasked"
                    />
                    <feComposite
                      in="dispRSides"
                      in2="sideOrderMask"
                      operator="in"
                      result="dispRSidesMasked"
                    />
                    <feComposite
                      in="dispRTopBottomMasked"
                      in2="dispRSidesMasked"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="dispR"
                    />
                    <feColorMatrix
                      in="dispR"
                      type="matrix"
                      values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                      result="red"
                    />
                    <feDisplacementMap
                      ref={dispGXRef}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="yDisplacementMap"
                      scale={seedScales.green}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispGTopBottomY"
                    />
                    <feDisplacementMap
                      ref={dispGRef}
                      in="dispGTopBottomY"
                      in2="xDisplacementMap"
                      scale={seedScales.green}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispGTopBottom"
                    />
                    <feDisplacementMap
                      ref={dispGX2Ref}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="xDisplacementMap"
                      scale={seedScales.green}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispGSidesX"
                    />
                    <feDisplacementMap
                      ref={dispG2Ref}
                      in="dispGSidesX"
                      in2="yDisplacementMap"
                      scale={seedScales.green}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispGSides"
                    />
                    <feComposite
                      in="dispGTopBottom"
                      in2="edgeOrderMask"
                      operator="in"
                      result="dispGTopBottomMasked"
                    />
                    <feComposite
                      in="dispGSides"
                      in2="sideOrderMask"
                      operator="in"
                      result="dispGSidesMasked"
                    />
                    <feComposite
                      in="dispGTopBottomMasked"
                      in2="dispGSidesMasked"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="dispG"
                    />
                    <feColorMatrix
                      in="dispG"
                      type="matrix"
                      values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                      result="green"
                    />
                    <feDisplacementMap
                      ref={dispBXRef}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="yDisplacementMap"
                      scale={seedScales.blue}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispBTopBottomY"
                    />
                    <feDisplacementMap
                      ref={dispBRef}
                      in="dispBTopBottomY"
                      in2="xDisplacementMap"
                      scale={seedScales.blue}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispBTopBottom"
                    />
                    <feDisplacementMap
                      ref={dispBX2Ref}
                      in={seedBlur > 0 ? "blurredBackdrop" : "SourceGraphic"}
                      in2="xDisplacementMap"
                      scale={seedScales.blue}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispBSidesX"
                    />
                    <feDisplacementMap
                      ref={dispB2Ref}
                      in="dispBSidesX"
                      in2="yDisplacementMap"
                      scale={seedScales.blue}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result="dispBSides"
                    />
                    <feComposite
                      in="dispBTopBottom"
                      in2="edgeOrderMask"
                      operator="in"
                      result="dispBTopBottomMasked"
                    />
                    <feComposite
                      in="dispBSides"
                      in2="sideOrderMask"
                      operator="in"
                      result="dispBSidesMasked"
                    />
                    <feComposite
                      in="dispBTopBottomMasked"
                      in2="dispBSidesMasked"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="dispB"
                    />
                    <feColorMatrix
                      in="dispB"
                      type="matrix"
                      values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                      result="blue"
                    />
                    <feComposite
                      in="red"
                      in2="green"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="rg"
                    />
                    <feComposite
                      in="rg"
                      in2="blue"
                      operator="arithmetic"
                      k1="0"
                      k2="1"
                      k3="1"
                      k4="0"
                      result="refracted"
                    />
                  </>
                )}
                <feColorMatrix
                  in="rawXDisplacementMap"
                  type="matrix"
                  values={specularMaskColorMatrixValues()}
                  result="backdropSpecMask"
                />
                <feComposite
                  in="backdropSpecMask"
                  in2="refracted"
                  operator="arithmetic"
                  k1={specularK.k1}
                  k2="0"
                  k3="1"
                  k4="0"
                />
              </filter>
            ) : null}
          </defs>
        </svg>
      ) : null}

      {/*
        Tint + specular — GlassSurface silhouette pattern: outer node clips
        with overflow+radius (CSS AA); inner paint holds tint + lens filter.
        Filter+overflow on one node leaves sparse white staircases in Chromium.
      */}
      <div
        ref={lensClipRef}
        className="glass-shell-lens absolute inset-0"
        style={{ borderRadius }}
      >
        <div
          ref={lensDivRef}
          className="glass-shell-lens-paint absolute inset-0"
        />
        {/* CSS-blur specular: double-buffered canvases. Draw into the hidden
            buffer, then opacity-swap so iOS never shows a cleared frame the
            way per-frame background-image data-URL swaps do. */}
        {showSpecCanvases ? (
          <>
            <canvas
              ref={specCanvasARef}
              className="glass-shell-spec-canvas"
              style={{ opacity: 0 }}
              aria-hidden
            />
            <canvas
              ref={specCanvasBRef}
              className="glass-shell-spec-canvas"
              style={{ opacity: 0 }}
              aria-hidden
            />
          </>
        ) : null}
        <div
          ref={specularOverlayRef}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        />
      </div>
      <div className="glass-shell-pointer-highlight" aria-hidden />
    </div>
  );
}
