"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMotionValue, useSpring } from "motion/react";
import { MousePointer2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Home01Icon,
  Menu01Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { LiquidGlass } from "../../registry/liquid-glass/liquid-glass";
import { GlassIconPill } from "../../registry/liquid-glass/compositions/glass-icon-pill";
import { GlassSegmentedControl } from "../../registry/liquid-glass/compositions/glass-segmented-control";
import { GlassShellBackdrop } from "../../registry/liquid-glass/compositions/glass-shell-backdrop";
import { LiquidGlassCapsule } from "../../registry/liquid-glass/compositions/liquid-glass-capsule";
import {
  MorphMenuHoverFill,
  useMorphMenuHover,
} from "../../registry/liquid-glass/compositions/morph-menu-hover";
import { MorphMenu } from "../../registry/liquid-glass/compositions/morph-menu";
import { preloadVercelImage } from "../lib/vercel-image";
import { CodeBlock } from "./code-block";
import { SITE_ORIGIN } from "../seo";
import { ShowcaseCarouselCard } from "./showcase-carousel";

const CAROUSEL_BG = "/images/Carousel Background";

const segmentItems = [
  { value: "overview", label: "Overview" },
  { value: "motion", label: "Motion" },
  { value: "optics", label: "Optics" },
];

const menuItems = ["Overview", "Components", "Installation", "Documentation"];

const iconTargets = [
  { icon: Home01Icon, label: "Home" },
  { icon: Search01Icon, label: "Search" },
  { icon: Settings01Icon, label: "Settings" },
] as const;

const MAX_ATTRACTION_PX = 5;
const ATTRACTION_CURVE_EXPONENT = 1.1;
const ATTRACTION_PROXIMITY_PX = 24;
const ATTRACTION_EDGE_RAMP_PX = 24;
const REST_CURSOR = { x: 0.62, y: 0.42 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mapAttraction(relativePosition: number, maxAttraction: number) {
  const normalized = clamp(relativePosition, -1, 1);
  return (
    Math.sign(normalized) *
    Math.pow(Math.abs(normalized), ATTRACTION_CURVE_EXPONENT) *
    maxAttraction
  );
}

function getOutsideDistance(
  pointerX: number,
  pointerY: number,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const dx = Math.max(left - pointerX, 0, pointerX - (left + width));
  const dy = Math.max(top - pointerY, 0, pointerY - (top + height));
  return Math.hypot(dx, dy);
}

function getAttractionDepth(
  pointerX: number,
  pointerY: number,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  return Math.max(
    0,
    Math.min(
      pointerX - left,
      left + width - pointerX,
      pointerY - top,
      top + height - pointerY,
    ),
  );
}

function applyAttractionEnvelope(
  x: number,
  y: number,
  insideDepth: number,
  outsideDistance: number,
  proximity: number,
) {
  const fieldDepth = proximity - outsideDistance + insideDepth;
  const rampLength = Math.max(proximity + ATTRACTION_EDGE_RAMP_PX, 1);
  const progress = clamp(fieldDepth / rampLength, 0, 1);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return { x: x * easedProgress, y: y * easedProgress };
}

const registryPackages = [
  {
    name: "liquid-glass",
    title: "Parallax Glass",
    description: "Optical primitive with Chromium refraction and CSS fallbacks.",
    file: "liquid-glass.json",
    background: `${CAROUSEL_BG}/04-refraction.png`,
  },
  {
    name: "liquid-glass-icon-pill",
    title: "Icon Pill",
    description: "Circular icon-action glass for toolbars and controls.",
    file: "liquid-glass-icon-pill.json",
    background: `${CAROUSEL_BG}/03-edge.png`,
  },
  {
    name: "liquid-glass-magnetic-pointer",
    title: "Magnetic Pointer",
    description: "Targets ease toward the mock cursor when nearby.",
    file: "liquid-glass-magnetic-pointer.json",
    background: `${CAROUSEL_BG}/01-pointer.png`,
  },
  {
    name: "liquid-glass-navigation",
    title: "Navigation",
    description: "Draggable segmented nav with rubber bounds and spring snap.",
    file: "liquid-glass-navigation.json",
    background: `${CAROUSEL_BG}/07-sphere.png`,
  },
  {
    name: "liquid-glass-capsule",
    title: "Capsule",
    description: "Free drag, press squish, and spring return.",
    file: "liquid-glass-capsule.json",
    background: `${CAROUSEL_BG}/06-blur.png`,
  },
  {
    name: "liquid-glass-menu",
    title: "Morph Menu",
    description: "Compound morph menu with dynamic shell refraction.",
    file: "liquid-glass-menu.json",
    background: `${CAROUSEL_BG}/05-shape.png`,
  },
] as const;

type RegistryPackageName = (typeof registryPackages)[number]["name"];

function InstallationMorphMenu() {
  const [open, setOpen] = useState(true);
  const { clearHoveredItem, hoveredItem, syncHoveredItem } = useMorphMenuHover();

  return (
    <div className="showcase-card__menu-preview">
      <MorphMenu.Root
        open={open}
        onOpenChange={(next) => {
          clearHoveredItem();
          setOpen(next);
        }}
        direction="bottom"
        anchor="start"
        visualDuration={0.28}
        bounce={0}
      >
        <MorphMenu.Container
          buttonSize={48}
          menuWidth={248}
          menuRadius={28}
          buttonRadius={24}
          offset={12}
          className="component-menu__shell"
          backdrop={<GlassShellBackdrop borderRadius={28} material="navigation" />}
        >
          <MorphMenu.Trigger
            aria-label={open ? "Close menu" : "Open menu"}
            className="navigation-menu__trigger"
          >
            <HugeiconsIcon
              icon={Menu01Icon}
              altIcon={Cancel01Icon}
              showAlt={open}
              size={20}
              color="currentColor"
              strokeWidth={1.75}
              aria-hidden
            />
          </MorphMenu.Trigger>
          <MorphMenu.Content
            className="navigation-menu__content"
            onPointerLeave={clearHoveredItem}
          >
            <div className="navigation-menu__items">
              <MorphMenuHoverFill hoveredItem={hoveredItem} />
              {menuItems.map((item) => (
                <MorphMenu.Item
                  key={item}
                  className="navigation-menu__item"
                  onPointerEnter={syncHoveredItem}
                >
                  <span>{item}</span>
                </MorphMenu.Item>
              ))}
            </div>
          </MorphMenu.Content>
        </MorphMenu.Container>
      </MorphMenu.Root>
    </div>
  );
}

function InstallationPointerPreview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const targetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [cursorPosition, setCursorPosition] = useState(REST_CURSOR);
  const [targetOffsets, setTargetOffsets] = useState(() =>
    iconTargets.map(() => ({ x: 0, y: 0 })),
  );
  const cursorTargetX = useMotionValue(REST_CURSOR.x);
  const cursorTargetY = useMotionValue(REST_CURSOR.y);
  const cursorX = useSpring(cursorTargetX, { stiffness: 430, damping: 38, mass: 0.65 });
  const cursorY = useSpring(cursorTargetY, { stiffness: 430, damping: 38, mass: 0.65 });

  useEffect(() => {
    let frame: number | null = null;

    const sync = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const stage = stageRef.current;
        if (!stage) return;

        const x = cursorX.get();
        const y = cursorY.get();
        setCursorPosition({ x, y });

        const bounds = stage.getBoundingClientRect();
        const pointerX = bounds.left + x * bounds.width;
        const pointerY = bounds.top + y * bounds.height;

        setTargetOffsets(
          targetRefs.current.map((target) => {
            if (!target) return { x: 0, y: 0 };
            const rect = target.getBoundingClientRect();
            const currentX = Number.parseFloat(target.dataset.offsetX ?? "0") || 0;
            const currentY = Number.parseFloat(target.dataset.offsetY ?? "0") || 0;
            const left = rect.left - currentX;
            const top = rect.top - currentY;
            const centerX = left + rect.width / 2;
            const centerY = top + rect.height / 2;
            const relativeX = (pointerX - centerX) / Math.max(rect.width / 2, 1);
            const relativeY = (pointerY - centerY) / Math.max(rect.height / 2, 1);
            const mappedX = mapAttraction(relativeX, MAX_ATTRACTION_PX);
            const mappedY = mapAttraction(relativeY, MAX_ATTRACTION_PX);
            const depth = getAttractionDepth(
              pointerX,
              pointerY,
              left,
              top,
              rect.width,
              rect.height,
            );
            const outsideDistance = getOutsideDistance(
              pointerX,
              pointerY,
              left,
              top,
              rect.width,
              rect.height,
            );
            if (outsideDistance > ATTRACTION_PROXIMITY_PX && depth === 0) {
              return { x: 0, y: 0 };
            }
            return applyAttractionEnvelope(
              mappedX,
              mappedY,
              depth,
              outsideDistance,
              ATTRACTION_PROXIMITY_PX,
            );
          }),
        );
      });
    };

    const unsubscribeX = cursorX.on("change", sync);
    const unsubscribeY = cursorY.on("change", sync);
    sync();
    return () => {
      unsubscribeX();
      unsubscribeY();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [cursorX, cursorY]);

  useEffect(() => {
    targetOffsets.forEach((offset, index) => {
      const target = targetRefs.current[index];
      if (!target) return;
      target.dataset.offsetX = String(offset.x);
      target.dataset.offsetY = String(offset.y);
    });
  }, [targetOffsets]);

  const followPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    cursorTargetX.set((event.clientX - bounds.left) / bounds.width);
    cursorTargetY.set((event.clientY - bounds.top) / bounds.height);
  };

  const resetPreview = () => {
    cursorTargetX.set(REST_CURSOR.x);
    cursorTargetY.set(REST_CURSOR.y);
    setTargetOffsets(iconTargets.map(() => ({ x: 0, y: 0 })));
  };

  return (
    <div
      ref={stageRef}
      className="installation-preview__magnetic"
      onPointerEnter={followPointer}
      onPointerMove={followPointer}
      onPointerLeave={resetPreview}
    >
      <div className="installation-preview__icons">
        {iconTargets.map(({ icon, label }, index) => (
          <div
            key={label}
            ref={(node) => {
              targetRefs.current[index] = node;
            }}
            className="installation-preview__magnetic-target"
            style={{
              transform: `translate3d(${targetOffsets[index]?.x ?? 0}px, ${targetOffsets[index]?.y ?? 0}px, 0)`,
            }}
          >
            <GlassIconPill size={48} material="navigation">
              <HugeiconsIcon
                icon={icon}
                size={20}
                color="currentColor"
                strokeWidth={1.75}
                aria-hidden
              />
            </GlassIconPill>
          </div>
        ))}
      </div>
      <MousePointer2
        className="showcase-card__mock-pointer"
        style={{
          left: `${cursorPosition.x * 100}%`,
          top: `${cursorPosition.y * 100}%`,
        }}
        aria-hidden
      />
    </div>
  );
}

function renderPreview(name: RegistryPackageName): {
  stageClassName?: string;
  children: ReactNode;
  mockPointer?: boolean;
} {
  switch (name) {
    case "liquid-glass":
      return {
        children: (
          <LiquidGlass width={280} height={88} borderRadius={28} material="panel">
            <div className="installation-preview__label">Parallax Glass</div>
          </LiquidGlass>
        ),
      };
    case "liquid-glass-icon-pill":
      return {
        stageClassName: "showcase-card__icons",
        children: (
          <div className="installation-preview__icons">
            {iconTargets.map(({ icon, label }) => (
              <GlassIconPill key={label} size={48} material="navigation">
                <HugeiconsIcon
                  icon={icon}
                  size={20}
                  color="currentColor"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </GlassIconPill>
            ))}
          </div>
        ),
      };
    case "liquid-glass-magnetic-pointer":
      return {
        stageClassName: "installation-preview__magnetic-stage",
        mockPointer: true,
        children: <InstallationPointerPreview />,
      };
    case "liquid-glass-navigation":
      return {
        children: <InstallationNavigationPreview />,
      };
    case "liquid-glass-capsule":
      return {
        stageClassName: "installation-preview__capsule-stage",
        children: (
          <div className="installation-preview__capsule">
            <LiquidGlassCapsule
              width={168}
              height={120}
              borderRadius={60}
              material="navigation"
              initial={{ x: 24, y: 24 }}
            >
              <div className="installation-preview__label">Drag</div>
            </LiquidGlassCapsule>
          </div>
        ),
      };
    case "liquid-glass-menu":
      return {
        stageClassName: "showcase-card__menu-states",
        children: <InstallationMorphMenu />,
      };
  }
}

function InstallationNavigationPreview() {
  const [value, setValue] = useState("motion");

  return (
    <GlassSegmentedControl
      items={segmentItems}
      value={value}
      onValueChange={setValue}
      itemWidth={80}
      itemHeight={40}
      padding={4}
      radialExpansion={8}
      material="navigation"
      pressedMaterial="selectionPressed"
      itemClassName="segment-item"
    />
  );
}

export function ComponentsShowcase() {
  const [selectedPackage, setSelectedPackage] =
    useState<RegistryPackageName>("liquid-glass");

  useEffect(() => {
    for (const item of registryPackages) {
      preloadVercelImage(item.background);
    }
  }, []);

  const activePackage =
    registryPackages.find((item) => item.name === selectedPackage) ??
    registryPackages[0];
  const preview = renderPreview(activePackage.name);

  return (
    <section className="component-section" id="components">
      <div className="section-heading">
        <h2>Components</h2>
        <p>
          Source-owned compositions ready to install, adapt, and ship with the
          primitive.
        </p>
      </div>

      <div className="installation-split">
        <div
          className="installation-nav"
          role="listbox"
          aria-label="Components"
        >
          {registryPackages.map((item) => {
            const selected = item.name === selectedPackage;
            return (
              <button
                key={item.name}
                type="button"
                role="option"
                aria-selected={selected}
                className={`installation-nav__item${selected ? " is-selected" : ""}`}
                onClick={() => setSelectedPackage(item.name)}
              >
                <span className="installation-nav__title">{item.title}</span>
                <code className="installation-nav__id">{item.name}</code>
              </button>
            );
          })}
        </div>

        <ShowcaseCarouselCard
          title={activePackage.title}
          background={activePackage.background}
          stageKey={activePackage.name}
          stageClassName={preview.stageClassName}
          loading="eager"
          className={`installation-preview${preview.mockPointer ? " showcase-card--pointer-demo" : ""}`}
          data-ios-pointer-suppress={preview.mockPointer ? "" : undefined}
        >
          {preview.children}
        </ShowcaseCarouselCard>
      </div>
    </section>
  );
}

export function InstallationShowcase() {
  const [origin, setOrigin] = useState(SITE_ORIGIN);
  const [packageManager, setPackageManager] = useState<"pnpm" | "npm">("pnpm");
  const [selectedPackage, setSelectedPackage] =
    useState<RegistryPackageName>("liquid-glass");

  useLayoutEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const activePackage =
    registryPackages.find((item) => item.name === selectedPackage) ??
    registryPackages[0];

  const installCommand =
    packageManager === "pnpm"
      ? `pnpm dlx shadcn@latest add ${origin}/r/${activePackage.file}`
      : `npx shadcn@latest add ${origin}/r/${activePackage.file}`;

  return (
    <section className="component-section installation-section" id="installation">
      <div className="section-heading">
        <h2>Installation</h2>
        <p>
          Install via the shadcn Registry. The CLI copies the source into your
          app — dependencies included.
        </p>
      </div>

      <div className="installation-stack">
        <div
          className="installation-nav installation-nav--install"
          role="listbox"
          aria-label="Install package"
        >
          {registryPackages.map((item) => {
            const selected = item.name === selectedPackage;
            return (
              <button
                key={item.name}
                type="button"
                role="option"
                aria-selected={selected}
                className={`installation-nav__item${selected ? " is-selected" : ""}`}
                onClick={() => setSelectedPackage(item.name)}
              >
                <span className="installation-nav__title">{item.title}</span>
                <code className="installation-nav__id">{item.name}</code>
              </button>
            );
          })}
        </div>

        <CodeBlock
          label={`Install · ${activePackage.title}`}
          code={installCommand}
          language="bash"
          headerControl={
            <div className="package-manager-switch" role="tablist" aria-label="Package manager">
              {(["pnpm", "npm"] as const).map((manager) => (
                <button
                  key={manager}
                  type="button"
                  role="tab"
                  aria-selected={packageManager === manager}
                  className={packageManager === manager ? "is-active" : ""}
                  onClick={() => setPackageManager(manager)}
                >
                  {manager}
                </button>
              ))}
            </div>
          }
        />
      </div>
    </section>
  );
}
