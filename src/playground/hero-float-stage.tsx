"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { LiquidGlass } from "../../registry/liquid-glass/liquid-glass";

/** Hero stack — near-black fill so stacked panes don't wash out milky. */
const heroStackMaterial = {
  preset: "navigation" as const,
  scale: 1,
  splay: 1,
  blur: 2,
  tint: 0.15,
  depth: 30,
  specular: 3,
  fill: "#000000",
};

/** Keep stacked hero panes from compounding backdrop saturate into neon. */
const heroStackEngine = {
  backdropSaturateSvg: 1.1,
  backdropSaturateCssBlur: 1.08,
  // Give the oversized hero panes a broader, more legible specular rim.
  edgeWidth: 5,
};

/** Staggered hero capsule stack — front-left to back-right. */
const HERO_CAPSULE_COUNT = 5;

/** Axonometric resting pose — negative X tilts as if looking down from above. */
const HERO_AXON_ROTATE_X = -22;
const HERO_AXON_ROTATE_Y = -28;

/** Idle float: small vertical wave, staggered across the stack. */
const HERO_FLOAT_AMPLITUDE_PX = 5;
const HERO_FLOAT_PERIOD_SEC = 5.6;
const HERO_FLOAT_PHASE_STEP = 0.9;
const HERO_FLOAT_FPS = 12;

/** Pointer pull: shorter travel with a tighter falloff around the hovered pane. */
const HERO_PULL_DISTANCE_RATIO = 0.14;
const HERO_PULL_SIGMA_RATIO = 0.62;
/** Extra hit padding around the panel cluster (relative to cluster size). */
const HERO_PULL_HIT_PAD_X = 0.35;
const HERO_PULL_HIT_PAD_Y = 0.22;

/** Panel aspect used when fitting the stack into the orbit stage. */
const HERO_PANEL_ASPECT = 1;
const HERO_PANEL_RADIUS_RATIO = 0.25;

/**
 * Pick panel metrics so the axonometric stack fills most of the stage.
 * Sizes step by 8px to avoid thrashing LiquidGlass lens regeneration while resizing.
 */
function resolveHeroPanelMetrics(stageWidth: number, stageHeight: number) {
  const safeW = Math.max(0, stageWidth);
  const safeH = Math.max(0, stageHeight);
  // Fill most of the stage; leave a little room for the projected Z-stack margins.
  const sizeByStage = Math.min(safeW * 0.7, safeH * 0.7);
  const size = Math.round(Math.min(320, Math.max(180, sizeByStage)) / 8) * 8;
  const radius = size * HERO_PANEL_RADIUS_RATIO;
  const depthStep = Math.round(Math.min(136, Math.max(80, size * 0.42)));
  return { width: size, height: size, radius, depthStep };
}

const HERO_PANEL_FALLBACK = resolveHeroPanelMetrics(560, 640);

/**
 * Project a pure-Z offset through rotateY then rotateX. Panels stay
 * XY-aligned in model space; screen stagger comes only from this projection.
 *
 * Each panel applies the same rotateX/Y itself (transform-style: flat) instead
 * of sitting under a preserve-3d stage — that keeps the axonometric face tilt
 * while avoiding the WebKit bug where a rotating 3D ancestor drops
 * backdrop-filter on some panes.
 */
function projectAxonZ(z: number, rotateXDeg: number, rotateYDeg: number) {
  const alpha = (rotateXDeg * Math.PI) / 180;
  const beta = (rotateYDeg * Math.PI) / 180;
  return {
    x: z * Math.sin(beta),
    y: -z * Math.cos(beta) * Math.sin(alpha),
  };
}

/** Soft X-proximity (0..1) from pointer to a panel's resting screen X. */
function heroPullProximity(pointerX: number, restX: number, sigma: number) {
  if (sigma <= 0) return 0;
  const t = (pointerX - restX) / sigma;
  return Math.exp(-0.5 * t * t);
}

function HeroStackPanel({
  index,
  width,
  height,
  radius,
  depthStep,
  pullPointerX,
  floatClock,
}: {
  index: number;
  width: number;
  height: number;
  radius: number;
  depthStep: number;
  pullPointerX: MotionValue<number>;
  floatClock: MotionValue<number>;
}) {
  // Center the Z stack on 0 so the projected stack stays visually centered.
  const z = ((HERO_CAPSULE_COUNT - 1) / 2 - index) * depthStep;
  const rest = projectAxonZ(z, HERO_AXON_ROTATE_X, HERO_AXON_ROTATE_Y);
  // Spacing between neighboring rest X positions ≈ |sin(β)| * depthStep.
  const sigma = Math.max(
    28,
    Math.abs(projectAxonZ(depthStep, HERO_AXON_ROTATE_X, HERO_AXON_ROTATE_Y).x) *
      HERO_PULL_SIGMA_RATIO,
  );
  const pullDistance = height * HERO_PULL_DISTANCE_RATIO;
  // Keep stacking order fixed — pulling must not reshuffle paint order.
  const zIndex = HERO_CAPSULE_COUNT - index;
  const floatPhase = index * HERO_FLOAT_PHASE_STEP;

  const pull = useSpring(0, { stiffness: 280, damping: 28, mass: 0.55 });

  useEffect(() => {
    const unsub = pullPointerX.on("change", (px) => {
      pull.set(heroPullProximity(Number(px), rest.x, sigma));
    });
    pull.set(heroPullProximity(pullPointerX.get(), rest.x, sigma));
    return unsub;
  }, [pullPointerX, pull, rest.x, sigma]);

  const y = useTransform([pull, floatClock], ([p, t]) => {
    const wave =
      Math.sin((Number(t) / HERO_FLOAT_PERIOD_SEC) * Math.PI * 2 + floatPhase) *
      HERO_FLOAT_AMPLITUDE_PX;
    return rest.y + wave - Number(p) * pullDistance;
  });

  return (
    <motion.div
      className="hero-orbit__capsule"
      style={{
        width,
        height,
        zIndex,
        x: rest.x,
        y,
        rotateX: HERO_AXON_ROTATE_X,
        rotateY: HERO_AXON_ROTATE_Y,
        // Large perspective ≈ orthographic axonometric foreshortening.
        transformPerspective: 12000,
        transformOrigin: "50% 50%",
      }}
    >
      <LiquidGlass
        width={width}
        height={height}
        borderRadius={radius}
        material={heroStackMaterial}
        engine={heroStackEngine}
        pointerHighlight={false}
        className="hero-orbit__capsule-glass"
      />
    </motion.div>
  );
}

export function HeroFloatStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState(HERO_PANEL_FALLBACK);
  const reduceMotionRef = useRef(false);

  // Pull uses cluster-local X. Far value collapses all pulls.
  const pullPointerX = useMotionValue(10_000);
  const floatClock = useMotionValue(0);

  useEffect(() => {
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReduce = () => {
      reduceMotionRef.current = reduceMq.matches;
      if (reduceMq.matches) {
        pullPointerX.set(10_000);
        floatClock.set(0);
      }
    };
    syncReduce();
    reduceMq.addEventListener("change", syncReduce);
    return () => {
      reduceMq.removeEventListener("change", syncReduce);
    };
  }, [pullPointerX, floatClock]);

  useEffect(() => {
    if (reduceMotionRef.current) return;
    let frame = 0;
    const started = performance.now();
    let lastUpdate = started;
    const frameInterval = 1000 / HERO_FLOAT_FPS;
    const tick = (now: number) => {
      const elapsed = now - lastUpdate;
      if (!reduceMotionRef.current && elapsed >= frameInterval) {
        lastUpdate = now - (elapsed % frameInterval);
        floatClock.set((now - started) / 1000);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [floatClock]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;

    const sync = () => {
      const rect = stage.getBoundingClientRect();
      const next = resolveHeroPanelMetrics(rect.width, rect.height);
      setMetrics((prev) =>
        prev.width === next.width &&
        prev.height === next.height &&
        prev.radius === next.radius &&
        prev.depthStep === next.depthStep
          ? prev
          : next,
      );
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Cache cluster bounds — reading layout every pointermove while glass
    // backdrops are busy can return hitchy rects and amplify pull jumps.
    let clusterCenterX = 0;
    let hitLeft = 0;
    let hitRight = 0;
    let hitTop = 0;
    let hitBottom = 0;
    let hasHitBounds = false;

    const syncClusterBounds = () => {
      const cluster = clusterRef.current;
      if (!cluster) return;
      const rect = cluster.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const padX = rect.width * HERO_PULL_HIT_PAD_X;
      const padY = rect.height * HERO_PULL_HIT_PAD_Y;
      clusterCenterX = rect.left + rect.width / 2;
      hitLeft = rect.left - padX;
      hitRight = rect.right + padX;
      hitTop = rect.top - padY;
      hitBottom = rect.bottom + padY;
      hasHitBounds = true;
    };
    syncClusterBounds();

    const clearPull = () => {
      pullPointerX.set(10_000);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reduceMotionRef.current) return;
      if (!hasHitBounds) syncClusterBounds();
      if (!hasHitBounds) return;

      // Limit peel to a band around the glass stack — not the full hero column.
      if (
        event.clientX < hitLeft ||
        event.clientX > hitRight ||
        event.clientY < hitTop ||
        event.clientY > hitBottom
      ) {
        clearPull();
        return;
      }

      pullPointerX.set(event.clientX - clusterCenterX);
    };

    window.addEventListener("scroll", syncClusterBounds, { passive: true });
    window.addEventListener("resize", syncClusterBounds);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncClusterBounds) : null;
    resizeObserver?.observe(stage);
    // Listen on the orbit stage (not `.hero`) so copy/CTA areas never drive pull.
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerleave", clearPull);
    return () => {
      window.removeEventListener("scroll", syncClusterBounds);
      window.removeEventListener("resize", syncClusterBounds);
      resizeObserver?.disconnect();
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", clearPull);
    };
  }, [pullPointerX]);

  const { width, height, radius, depthStep } = metrics;

  return (
    <div className="hero-orbit__root" ref={stageRef} aria-label="Parallax Glass panel stack">
      <div className="hero-orbit__stage">
        <div className="hero-orbit__cluster" ref={clusterRef} style={{ width, height }}>
          {Array.from({ length: HERO_CAPSULE_COUNT }, (_, index) => (
            <HeroStackPanel
              key={index}
              index={index}
              width={width}
              height={height}
              radius={radius}
              depthStep={depthStep}
              pullPointerX={pullPointerX}
              floatClock={floatClock}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
