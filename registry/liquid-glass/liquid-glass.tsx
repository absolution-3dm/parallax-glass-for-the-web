"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  glassBrowserSupport,
  supportsBackdropSvgFilter,
} from "./browser-support";
import {
  generateAxisLensMaps,
  generateLensMap,
  generateSpecularOverlay,
} from "./refraction/lens-map";
import {
  AXIS_PASSES_PER_CHANNEL,
  backdropFilterPadding,
  buildLensMapParams,
  chromaticChannelScales,
  cssBackdropBlurPx,
  DISPLACEMENT_PNG_MID_BIAS,
  glassPointerHighlight,
  glassPointerHighlightMaskUrl,
  glassSurfaceCssVars,
  refractionBackdropScale,
  resolveGlassEngine,
  resolveGlassPointerHighlight,
  specularCompositeCoefficients,
  specularMaskColorMatrixValues,
  type GlassEngineParams,
  type GlassPointerHighlightParams,
} from "./refraction/engine";
import {
  resolveGlassMaterial,
  type GlassMaterialInput,
  type GlassMaterialMode,
} from "./materials/materials";
import { observeNearViewport } from "./viewport-visibility";
import "./liquid-glass.css";

export type {
  GlassMaterialInput,
  GlassMaterialKey,
  GlassMaterialMode,
  GlassMaterialName,
  GlassMaterialParams,
  GlassPhysicalMaterialName,
  GlassSemanticMaterialName,
} from "./materials/materials";
export { resolveGlassMaterial } from "./materials/materials";

type AnimatedGlassProgress = {
  get: () => number;
  on: (event: "change", callback: (value: number) => void) => () => void;
};

export type PointerHighlightPreview = {
  /** Horizontal preview position normalized to the surface, 0–1. */
  x: number;
  /** Vertical preview position normalized to the surface, 0–1. */
  y: number;
  /** Optional fixed highlight strength; defaults to the configured hover strength. */
  strength?: number;
};

export type LiquidGlassProps = {
  children?: ReactNode;
  /** Chips / selection chrome between refracted material and sharp content. */
  stateLayer?: ReactNode;
  /** Interactive glass above sharp content, used when a control covers its label while pressed. */
  overlayLayer?: ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  /** Physical preset, semantic recipe, or preset plus local parameter overrides. */
  material?: GlassMaterialInput;
  /** Explicit material appearance; never reads or mutates the app's global theme. */
  materialMode?: GlassMaterialMode;
  /**
   * Optional live 0–1 multiplier for the SVG backdrop displacement. The map
   * dimensions stay fixed while its actual refraction strength animates.
   */
  refractionProgress?: AnimatedGlassProgress;
  /**
   * Sample the live page behind the glass.
   * Chromium: displacement map via `backdrop-filter: url(#svg)`.
   * Safari/Firefox: frosted `backdrop-filter: blur(...)`.
   */
  backdrop?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Fires whenever the displacement map is regenerated (for dev tooling). */
  onDisplacementMapChange?: (
    mapUrl: string,
    info: {
      width: number;
      height: number;
      /** SVG feDisplacementMap scale in CSS px before chromatic channel boosts. */
      displacementScale: number;
      /** Largest decoded displacement represented by the current map. */
      maxDisplacement: number;
    },
  ) => void;
  /** Dev-only: override shared engine constants for live preview. */
  engine?: Partial<GlassEngineParams>;
  /**
   * Per-instance pointer bloom. Pass `false` to disable; partial values merge
   * with the shared defaults. Other surfaces on the page are unaffected.
   */
  pointerHighlight?: Partial<GlassPointerHighlightParams> | false;
  /** Force the pointer-highlight pipeline on at a driven position for demos and stories. When set, live pointer events are ignored so the highlight can track a lagged virtual cursor. */
  pointerHighlightPreview?: PointerHighlightPreview;
};

type LensState = {
  epoch: number;
  /** X-map also carries B/specular and feeds the content filter. */
  mapUrl: string;
  xMapUrl: string;
  yMapUrl: string;
  edgeOrderMapUrl: string;
  maxDisplacement: number;
  /** Pixel scales for the Chromium backdrop-filter (userSpaceOnUse). */
  backdropRedScale: number;
  backdropGreenScale: number;
  backdropBlueScale: number;
  /** Backdrop frost blur in CSS px (userSpaceOnUse). */
  backdropBlurPx: number;
  specular: number;
  width: number;
  height: number;
};

type PointerHighlightState = {
  x: number | null;
  y: number | null;
  targetX: number;
  targetY: number;
  frame: number | null;
  active: boolean;
};

const { isIOS: IS_IOS } = glassBrowserSupport;

export const LiquidGlass = ({
  children,
  stateLayer,
  overlayLayer,
  width = 200,
  height = 80,
  borderRadius = 20,
  material = "regular",
  materialMode = "dark",
  refractionProgress,
  backdrop = true,
  className = "",
  style = {},
  onDisplacementMapChange,
  engine,
  pointerHighlight,
  pointerHighlightPreview,
}: LiquidGlassProps) => {
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
  const resolvedEngine = useMemo(() => resolveGlassEngine(engine), [engine]);
  const resolvedPointerHighlight = useMemo(
    () => resolveGlassPointerHighlight(pointerHighlight),
    [pointerHighlight],
  );
  const baseId = useId().replace(/:/g, "-");
  const [lens, setLens] = useState<LensState | null>(null);
  const [backdropSvg, setBackdropSvg] = useState(false);
  // Optimistic true avoids a first-paint frost flash for above-the-fold glass;
  // layout effect + IntersectionObserver immediately corrects off-screen ones.
  const [inView, setInView] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const epochRef = useRef(0);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const inViewRef = useRef(true);
  const needsRebuildRef = useRef(false);
  const pointerHighlightRef = useRef<PointerHighlightState>({
    x: null,
    y: null,
    targetX: 0,
    targetY: 0,
    frame: null,
    active: false,
  });
  const pointerMaskRef = useRef<SVGFEImageElement>(null);
  const backdropDisplacementRefs = useRef<Array<SVGFEDisplacementMapElement | null>>([]);
  const backdropSpecularRef = useRef<SVGFECompositeElement>(null);
  const onMapChangeRef = useRef(onDisplacementMapChange);

  useEffect(() => {
    onMapChangeRef.current = onDisplacementMapChange;
  }, [onDisplacementMapChange]);

  const filterId = `glass-filter-${baseId}-${lens?.epoch ?? 0}`;
  const backdropFilterId = `glass-backdrop-${baseId}-${lens?.epoch ?? 0}`;
  // Live backdrop sampling is the expensive Chromium path. Keep maps cached
  // off-screen, but detach `backdrop-filter` so animating page content cannot
  // force every hidden SVG graph to re-evaluate each frame.
  const liveBackdrop = backdrop && inView;
  const useBackdropSvg = liveBackdrop && backdropSvg;
  const specularK = specularCompositeCoefficients(lens?.specular ?? 0, resolvedEngine);
  const backdropSpecularK1 = specularK.k1;
  const flatWhiteSpecularK2 = useBackdropSvg
    ? specularK.k2
    : Math.max(0, lens?.specular ?? 0);

  useEffect(() => {
    if (!refractionProgress) return;
    const scales = lens
      ? [lens.backdropRedScale, lens.backdropGreenScale, lens.backdropBlueScale]
      : null;
    const updateDisplacement = (value: number) => {
      const progress = Math.max(0, Math.min(1, value));
      if (scales) {
        backdropDisplacementRefs.current.forEach((node, index) => {
          node?.setAttribute(
            "scale",
            String(
              scales[Math.floor(index / AXIS_PASSES_PER_CHANNEL)] * progress,
            ),
          );
        });
        backdropSpecularRef.current?.setAttribute("k1", String(backdropSpecularK1 * progress));
      }
    };

    updateDisplacement(refractionProgress.get());
    return refractionProgress.on("change", updateDisplacement);
  }, [backdropSpecularK1, lens, refractionProgress]);

  const rebuild = () => {
    const el = containerRef.current;
    if (!el) return;
    // Measure the LAYOUT box (offsetWidth/Height), not getBoundingClientRect:
    // the latter returns the visually transformed size, so any ancestor CSS
    // scale (e.g. the squish/stretch capsule, or morph animations) would size
    // the map + userSpaceOnUse backdrop-filter to the scaled box — the
    // refraction would then not fill the shape and misalign with the tint.
    const w = Math.max(1, el.offsetWidth);
    const h = Math.max(1, el.offsetHeight);
    // Percentage sizes often start at 0 — wait for a real box.
    if (el.offsetWidth < 2 || el.offsetHeight < 2) return;

    const hw = w / 2;
    const hh = h / 2;
    const radius = Math.min(borderRadius, hw, hh);
    const safeCurvature = Math.max(0, Math.min(1, curvature));

    const lensParams = buildLensMapParams(
      {
        halfWidth: hw,
        halfHeight: hh,
        radius,
        material: {
          depth,
          curvature: safeCurvature,
          splay,
          glow,
          edgeHighlight,
          specularAngle,
        },
      },
      resolvedEngine,
    );
    // iOS's content filter never bends anything (see the comment on
    // `filterId` below) — the map only ever feeds its specular composite
    // there, and its backdrop refraction is CSS blur, not this map at all
    // (see useBackdropSvg). So iOS only needs the specular overlay, not the
    // full R/G displacement bake. iOS rasterizes a `filter: url(#svg)`
    // reference at
    // CSS-px resolution regardless of the source bitmap's own resolution,
    // pixelating the corner arcs on 2x/3x screens; the plain background-image
    // overlay rendered below goes through the ordinary image pipeline
    // instead and renders at full device-pixel density.
    let mapUrl: string;
    let xMapUrl: string;
    let yMapUrl: string;
    let edgeOrderMapUrl: string;
    let maxDisplacement: number;
    if (IS_IOS) {
      const map = generateSpecularOverlay(lensParams, Math.max(0, specular));
      if (!map.url) return;
      mapUrl = xMapUrl = yMapUrl = edgeOrderMapUrl = map.url;
      maxDisplacement = map.maxDisplacement;
    } else {
      const maps = generateAxisLensMaps(lensParams);
      if (!maps.xUrl || !maps.yUrl || !maps.edgeOrderUrl) return;
      // The X map preserves the original B/specular channel, so it also feeds
      // the content filter without requiring a third encoded texture.
      mapUrl = xMapUrl = maps.xUrl;
      yMapUrl = maps.yUrl;
      edgeOrderMapUrl = maps.edgeOrderUrl;
      maxDisplacement = maps.maxDisplacement;
    }

    const strength = Math.max(0, scale);
    // Backdrop filter uses userSpaceOnUse — scale is real CSS pixels.
    const backdropPx = refractionBackdropScale(strength, w, h, lensParams.refrPow);
    const blurPx = Math.max(0, blur);
    const backdropScales = chromaticChannelScales(backdropPx, chroma, resolvedEngine);

    lastSizeRef.current = { w, h };
    epochRef.current += 1;
    const next: LensState = {
      epoch: epochRef.current,
      mapUrl,
      xMapUrl,
      yMapUrl,
      edgeOrderMapUrl,
      maxDisplacement,
      backdropRedScale: backdropScales.red,
      backdropGreenScale: backdropScales.green,
      backdropBlueScale: backdropScales.blue,
      backdropBlurPx: blurPx,
      specular: Math.max(0, specular),
      width: w,
      height: h,
    };
    setLens(next);

    if (onMapChangeRef.current) {
      // WebKit renders a specular-only image in the actual surface, but dev
      // tooling still needs the real R/G displacement map for inspection.
      const debugMap = generateLensMap(lensParams);
      onMapChangeRef.current(debugMap.url, {
        width: w,
        height: h,
        displacementScale: backdropPx,
        maxDisplacement: debugMap.maxDisplacement * backdropPx,
      });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBackdropSvg(supportsBackdropSvgFilter());
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    return observeNearViewport(el, (near) => {
      inViewRef.current = near;
      setInView(near);
      if (near && needsRebuildRef.current) {
        needsRebuildRef.current = false;
        rebuild();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inViewRef.current) {
      needsRebuildRef.current = true;
      return;
    }
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    width,
    height,
    borderRadius,
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
    backdrop,
    resolvedEngine,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: rw, height: rh } = entry.contentRect;
      const w = Math.round(rw);
      const h = Math.round(rh);
      if (w < 2 || h < 2) return;
      if (w === lastSizeRef.current.w && h === lastSizeRef.current.h) return;
      if (!inViewRef.current) {
        needsRebuildRef.current = true;
        return;
      }
      setTimeout(rebuild, 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle: CSSProperties = {
    ...style,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: `${borderRadius}px`,
    ...glassSurfaceCssVars(tint, fill, resolvedEngine, resolvedPointerHighlight),
    ["--glass-blur" as string]: `${
      useBackdropSvg
        ? Math.max(0, blur)
        : cssBackdropBlurPx(blur, resolvedEngine)
    }px`,
    ["--backdrop-filter-id" as string]: lens ? `url(#${backdropFilterId})` : undefined,
  };

  /**
   * With no pointer bloom the saturate → brightness → mask → composite chain
   * below is an identity: its `feImage` mask stays 0×0, so the masked boost is
   * empty and compositing it over `SourceGraphic` returns `SourceGraphic`.
   * Chromium still rasterizes those primitives over the whole filter region on
   * every re-evaluation, so skip the chain outright and read the source
   * directly instead.
   */
  const pointerBackdropResult = resolvedPointerHighlight
    ? "pointerBackdrop"
    : "SourceGraphic";
  const backdropInput =
    lens && lens.backdropBlurPx > 0 ? "blurredBackdrop" : pointerBackdropResult;
  const refractionProgressValue = refractionProgress
    ? Math.max(0, Math.min(1, refractionProgress.get()))
    : 1;
  /**
   * chroma = 0 leaves every channel with the same displacement scale, so one
   * X/Y pass pair replaces the three chromatic branches and their channel
   * split/merge — roughly half the full-region GPU passes per repaint.
   */
  const monochromaticBackdrop =
    lens !== null &&
    lens.backdropRedScale === lens.backdropGreenScale &&
    lens.backdropGreenScale === lens.backdropBlueScale;
  const lensFilterUrl = lens ? `url(#${filterId})` : undefined;
  const mapW = IS_IOS && lens ? lens.width : 1;
  const mapH = IS_IOS && lens ? lens.height : 1;
  const backdropPad = lens
    ? backdropFilterPadding(lens.backdropBlurPx, resolvedEngine)
    : backdropFilterPadding(0, resolvedEngine);

  const syncPointerMask = (x: number, y: number, active: boolean) => {
    const mask = pointerMaskRef.current;
    if (!mask) return;
    if (!active) {
      mask.setAttribute("width", "0");
      mask.setAttribute("height", "0");
      return;
    }
    const { radius } = resolvedPointerHighlight ?? glassPointerHighlight;
    mask.setAttribute("x", String(x - radius));
    mask.setAttribute("y", String(y - radius));
    mask.setAttribute("width", String(radius * 2));
    mask.setAttribute("height", String(radius * 2));
  };

  const updatePointerHighlight = (event: ReactPointerEvent<HTMLDivElement>, strength: number) => {
    if (!resolvedPointerHighlight) return;
    const surface = containerRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const pointer = pointerHighlightRef.current;
    pointer.active = true;
    pointer.targetX = event.clientX - rect.left;
    pointer.targetY = event.clientY - rect.top;

    if (pointer.x === null || pointer.y === null) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
      surface.style.setProperty("--glass-pointer-x", `${pointer.x}px`);
      surface.style.setProperty("--glass-pointer-y", `${pointer.y}px`);
      syncPointerMask(pointer.x, pointer.y, true);
    }

    if (pointer.frame === null) {
      const followPointer = () => {
        const current = pointerHighlightRef.current;
        const target = containerRef.current;
        if (!target || current.x === null || current.y === null) {
          current.frame = null;
          return;
        }

        current.x += (current.targetX - current.x) * 0.2;
        current.y += (current.targetY - current.y) * 0.2;
        target.style.setProperty("--glass-pointer-x", `${current.x}px`);
        target.style.setProperty("--glass-pointer-y", `${current.y}px`);
        syncPointerMask(current.x, current.y, true);

        if (Math.hypot(current.targetX - current.x, current.targetY - current.y) < 0.25) {
          current.x = current.targetX;
          current.y = current.targetY;
          current.frame = null;
          return;
        }

        current.frame = window.requestAnimationFrame(followPointer);
      };
      pointer.frame = window.requestAnimationFrame(followPointer);
    }

    surface.style.setProperty("--glass-highlight-strength", String(strength));
  };

  const clearPointerHighlight = () => {
    const surface = containerRef.current;
    if (!surface) return;
    const pointer = pointerHighlightRef.current;
    if (pointer.frame !== null) window.cancelAnimationFrame(pointer.frame);
    pointer.frame = null;
    surface.removeAttribute("data-glass-pressed");
    if (pointerHighlightPreview && resolvedPointerHighlight) {
      const x = Math.max(0, Math.min(1, pointerHighlightPreview.x)) * surface.offsetWidth;
      const y = Math.max(0, Math.min(1, pointerHighlightPreview.y)) * surface.offsetHeight;
      pointer.x = pointer.targetX = x;
      pointer.y = pointer.targetY = y;
      pointer.active = true;
      surface.style.setProperty("--glass-pointer-x", `${x}px`);
      surface.style.setProperty("--glass-pointer-y", `${y}px`);
      surface.style.setProperty(
        "--glass-highlight-strength",
        String(pointerHighlightPreview.strength ?? resolvedPointerHighlight.hoverStrength),
      );
      syncPointerMask(x, y, true);
      return;
    }
    pointer.x = null;
    pointer.y = null;
    pointer.active = false;
    syncPointerMask(0, 0, false);
    surface.style.setProperty("--glass-highlight-strength", "0");
  };

  useLayoutEffect(() => {
    if (!pointerHighlightPreview || !resolvedPointerHighlight) return;
    const surface = containerRef.current;
    if (!surface) return;
    const pointer = pointerHighlightRef.current;
    const x = Math.max(0, Math.min(1, pointerHighlightPreview.x)) * surface.offsetWidth;
    const y = Math.max(0, Math.min(1, pointerHighlightPreview.y)) * surface.offsetHeight;
    pointer.x = pointer.targetX = x;
    pointer.y = pointer.targetY = y;
    pointer.active = true;
    surface.style.setProperty("--glass-pointer-x", `${x}px`);
    surface.style.setProperty("--glass-pointer-y", `${y}px`);
    surface.style.setProperty(
      "--glass-highlight-strength",
      String(pointerHighlightPreview.strength ?? resolvedPointerHighlight.hoverStrength),
    );
    syncPointerMask(x, y, true);

    return () => {
      syncPointerMask(0, 0, false);
      surface.style.setProperty("--glass-highlight-strength", "0");
    };
  }, [lens, pointerHighlightPreview, resolvedPointerHighlight]);

  // Preview mode owns the highlight entirely (demos / mock cursors). Live
  // pointer handlers would clear on real-mouse leave while a lagged virtual
  // cursor is still over the glass.
  const livePointerHighlight = pointerHighlightPreview
    ? null
    : resolvedPointerHighlight;

  const surface = (
    <div
      ref={containerRef}
      className={[
        "glass-surface",
        liveBackdrop
          ? useBackdropSvg
            ? "glass-surface--backdrop-svg"
            : "glass-surface--backdrop-blur"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={containerStyle}
      onPointerEnter={
        livePointerHighlight
          ? (event) => {
              if (event.pointerType === "mouse") {
                updatePointerHighlight(event, livePointerHighlight.hoverStrength);
              }
            }
          : undefined
      }
      onPointerMove={
        livePointerHighlight
          ? (event) => {
              if (event.pointerType === "mouse") {
                updatePointerHighlight(event, livePointerHighlight.hoverStrength);
              }
            }
          : undefined
      }
      onPointerLeave={livePointerHighlight ? clearPointerHighlight : undefined}
      onPointerDown={
        livePointerHighlight
          ? (event) => {
              updatePointerHighlight(event, livePointerHighlight.pressedStrength);
              containerRef.current?.setAttribute("data-glass-pressed", "true");
            }
          : undefined
      }
      onPointerUp={
        livePointerHighlight
          ? (event) => {
              if (event.pointerType === "mouse") {
                updatePointerHighlight(event, livePointerHighlight.hoverStrength);
              }
              containerRef.current?.removeAttribute("data-glass-pressed");
            }
          : undefined
      }
      onPointerCancel={livePointerHighlight ? clearPointerHighlight : undefined}
    >
      {lens ? (
        <svg className="glass-surface__defs" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <defs>
            {/*
              Content filter — tint only.
              Do NOT feDisplacementMap this layer: warping an opaque fill always
              leaves a transparent gap (reads as tint shifted bottom-right).
              Do NOT re-clip with the map's alpha either: feImage alignment can
              sit a fraction off the CSS box and punch the same top-left hole.
              Silhouette comes from CSS border-radius + overflow on the lens;
              this pass only composites the baked specular highlight.
            */}
            <filter
              id={filterId}
              filterUnits={IS_IOS ? "userSpaceOnUse" : "objectBoundingBox"}
              primitiveUnits={IS_IOS ? "userSpaceOnUse" : "objectBoundingBox"}
              colorInterpolationFilters="sRGB"
              x="0"
              y="0"
              width={mapW}
              height={mapH}
            >
              <feImage
                href={lens.mapUrl}
                x="0"
                y="0"
                width={mapW}
                height={mapH}
                preserveAspectRatio="none"
                result="rawMap"
              />
              <feColorMatrix
                in="rawMap"
                type="matrix"
                values={specularMaskColorMatrixValues(resolvedEngine)}
                result="specMask"
              />
              {/* Flat-white share only — this filter's input is the tint
                  layer, so it cannot see the background. The hue-preserving
                  k1 share lives in the backdrop filter; CSS-blur fallbacks
                  (no SVG backdrop pass) get the full specular as white. */}
              <feComposite
                in="specMask"
                in2="SourceGraphic"
                operator="arithmetic"
                k1="0"
                k2={flatWhiteSpecularK2}
                k3="1"
                k4="0"
              />
            </filter>

            {/*
              Backdrop filter — per-instance userSpaceOnUse so each pill gets
              its own pixel-accurate map (no shared objectBoundingBox scale bug).
            */}
            <filter
              id={backdropFilterId}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
              x={-backdropPad}
              y={-backdropPad}
              width={lens.width + backdropPad * 2}
              height={lens.height + backdropPad * 2}
            >
              <feImage
                href={lens.xMapUrl}
                x="0"
                y="0"
                width={lens.width}
                height={lens.height}
                preserveAspectRatio="none"
                result="rawXDisplacementMap"
              />
              <feComponentTransfer in="rawXDisplacementMap" result="xDisplacementMap">
                {/* Active R: cancel PNG 128≠0.5 mid bias so flat field stays
                    undisplaced; unused G forced to exact 0.5. */}
                <feFuncR type="linear" slope="1" intercept={DISPLACEMENT_PNG_MID_BIAS} />
                <feFuncG type="linear" slope="0" intercept="0.5" />
              </feComponentTransfer>
              <feImage
                href={lens.yMapUrl}
                x="0"
                y="0"
                width={lens.width}
                height={lens.height}
                preserveAspectRatio="none"
                result="rawYDisplacementMap"
              />
              <feComponentTransfer in="rawYDisplacementMap" result="yDisplacementMap">
                <feFuncR type="linear" slope="0" intercept="0.5" />
                <feFuncG type="linear" slope="1" intercept={DISPLACEMENT_PNG_MID_BIAS} />
              </feComponentTransfer>
              <feImage
                href={lens.edgeOrderMapUrl}
                x="0"
                y="0"
                width={lens.width}
                height={lens.height}
                preserveAspectRatio="none"
                result="edgeOrderMask"
              />
              <feComponentTransfer in="edgeOrderMask" result="sideOrderMask">
                <feFuncA type="table" tableValues="1 0" />
              </feComponentTransfer>
              {/* Chromium regression guard: keep X and Y in separate passes.
                  A single R/X + G/Y feDisplacementMap causes a GPU-pipeline
                  shear (top pulls left, bottom pulls right) on affected Chrome
                  builds. X and Y start from independently baked textures and
                  the unused axis is forced to exactly 0.5 in each pass.
                  Top/bottom and side branches use opposite pass orders so
                  each region's tangential axis is applied last;
                  see docs/glass-refraction.md before changing this structure. */}
              {resolvedPointerHighlight ? (
                <>
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
                  <feComposite in="pointerBoost" in2="SourceGraphic" operator="over" result="pointerBackdrop" />
                </>
              ) : null}
              <feGaussianBlur
                in={pointerBackdropResult}
                stdDeviation={lens.backdropBlurPx}
                result="blurredBackdrop"
              />
              {monochromaticBackdrop ? (
                <>
                  {/* Top/bottom uses Y→X so its tangential X is last; sides
                      use X→Y so tangential Y is last. The CPU orientation mask
                      blends both axis-isolated orders through rounded corners. */}
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[0] = node;
                    }}
                    in={backdropInput}
                    in2="yDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispTopBottomY"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[1] = node;
                    }}
                    in="dispTopBottomY"
                    in2="xDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispTopBottom"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[2] = node;
                    }}
                    in={backdropInput}
                    in2="xDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispSidesX"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[3] = node;
                    }}
                    in="dispSidesX"
                    in2="yDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
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
                    ref={(node) => {
                      backdropDisplacementRefs.current[0] = node;
                    }}
                    in={backdropInput}
                    in2="yDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispRTBY"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[1] = node;
                    }}
                    in="dispRTBY"
                    in2="xDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispRTB"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[2] = node;
                    }}
                    in={backdropInput}
                    in2="xDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispRSideX"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[3] = node;
                    }}
                    in="dispRSideX"
                    in2="yDisplacementMap"
                    scale={lens.backdropRedScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispRSide"
                  />
                  <feComposite
                    in="dispRTB"
                    in2="edgeOrderMask"
                    operator="in"
                    result="dispRTBMasked"
                  />
                  <feComposite
                    in="dispRSide"
                    in2="sideOrderMask"
                    operator="in"
                    result="dispRSideMasked"
                  />
                  <feComposite
                    in="dispRTBMasked"
                    in2="dispRSideMasked"
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
                    ref={(node) => {
                      backdropDisplacementRefs.current[4] = node;
                    }}
                    in={backdropInput}
                    in2="yDisplacementMap"
                    scale={lens.backdropGreenScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispGTBY"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[5] = node;
                    }}
                    in="dispGTBY"
                    in2="xDisplacementMap"
                    scale={lens.backdropGreenScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispGTB"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[6] = node;
                    }}
                    in={backdropInput}
                    in2="xDisplacementMap"
                    scale={lens.backdropGreenScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispGSideX"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[7] = node;
                    }}
                    in="dispGSideX"
                    in2="yDisplacementMap"
                    scale={lens.backdropGreenScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispGSide"
                  />
                  <feComposite
                    in="dispGTB"
                    in2="edgeOrderMask"
                    operator="in"
                    result="dispGTBMasked"
                  />
                  <feComposite
                    in="dispGSide"
                    in2="sideOrderMask"
                    operator="in"
                    result="dispGSideMasked"
                  />
                  <feComposite
                    in="dispGTBMasked"
                    in2="dispGSideMasked"
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
                    ref={(node) => {
                      backdropDisplacementRefs.current[8] = node;
                    }}
                    in={backdropInput}
                    in2="yDisplacementMap"
                    scale={lens.backdropBlueScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispBTBY"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[9] = node;
                    }}
                    in="dispBTBY"
                    in2="xDisplacementMap"
                    scale={lens.backdropBlueScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispBTB"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[10] = node;
                    }}
                    in={backdropInput}
                    in2="xDisplacementMap"
                    scale={lens.backdropBlueScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispBSideX"
                  />
                  <feDisplacementMap
                    ref={(node) => {
                      backdropDisplacementRefs.current[11] = node;
                    }}
                    in="dispBSideX"
                    in2="yDisplacementMap"
                    scale={lens.backdropBlueScale * refractionProgressValue}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispBSide"
                  />
                  <feComposite
                    in="dispBTB"
                    in2="edgeOrderMask"
                    operator="in"
                    result="dispBTBMasked"
                  />
                  <feComposite
                    in="dispBSide"
                    in2="sideOrderMask"
                    operator="in"
                    result="dispBSideMasked"
                  />
                  <feComposite
                    in="dispBTBMasked"
                    in2="dispBSideMasked"
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
              {/* Hue-preserving specular share (studio glare): the k1 term
                  multiplies the baked mask with the refracted background, so
                  the highlight brightens what's behind instead of adding
                  flat white. */}
              <feColorMatrix
                in="rawXDisplacementMap"
                type="matrix"
                values={specularMaskColorMatrixValues(resolvedEngine)}
                result="backdropSpecMask"
              />
              <feComposite
                ref={backdropSpecularRef}
                in="backdropSpecMask"
                in2="refracted"
                operator="arithmetic"
                k1={
                  backdropSpecularK1 *
                  (refractionProgress
                    ? Math.max(0, Math.min(1, refractionProgress.get()))
                    : 1)
                }
                k2="0"
                k3="1"
                k4="0"
              />
            </filter>
          </defs>
        </svg>
      ) : null}

      <div className="glass-surface__material">
        {resolvedPointerHighlight ? (
          <div className="glass-surface__pointer-highlight" aria-hidden />
        ) : null}
        {liveBackdrop ? <div className="glass-surface__backdrop" aria-hidden /> : null}

        {/* Selection chrome between frost and specular — so rim light stays on the shell, not the chip. */}
        {stateLayer ? <div className="glass-surface__state">{stateLayer}</div> : null}

        {/* Lens body only — text/icons are NOT in here. */}
        <div
          className="glass-surface__lens"
          style={!IS_IOS && lensFilterUrl ? { filter: lensFilterUrl } : undefined}
        >
          <div className="glass-surface__tint" aria-hidden />
        </div>
        {/* iOS specular carrier — see the rebuild() comment above `filterId`
            for why iOS skips that filter (CSS-px-rasterized, pixelates on
            2x/3x) in favor of this device-resolution background-image.
            plus-lighter reproduces the filter path's additive feComposite
            math; iOS < 16.4 falls back to normal alpha blending (slightly
            milkier, never broken). Styled inline rather than relying on a
            build-time utility:
            this project's CSS build pipeline has silently dropped rules
            before, and losing background-size: 100% 100% here would paint
            the raw bitmap at its baked pixel size. */}
        {IS_IOS && lens?.mapUrl ? (
          <div
            className="glass-surface__ios-specular"
            style={{
              zIndex: 2,
              borderRadius: "inherit",
              backgroundImage: `url("${lens.mapUrl}")`,
              backgroundSize: "100% 100%",
              backgroundRepeat: "no-repeat",
              mixBlendMode: "plus-lighter",
            }}
            aria-hidden
          />
        ) : null}
      </div>

      <div className="glass-surface__content">{children}</div>
      {overlayLayer ? <div className="glass-surface__overlay">{overlayLayer}</div> : null}
    </div>
  );

  return surface;
};

export default LiquidGlass;
