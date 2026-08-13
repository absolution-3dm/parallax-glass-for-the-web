"use client";

import { useMemo, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CodeIcon,
  ColorsIcon,
  CpuIcon,
  Cursor02Icon,
  DropletIcon,
  Layers01Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import {
  resolveGlassMaterial,
  type GlassMaterialName,
} from "../../registry/liquid-glass/materials/materials";
import {
  glassEngineSnapshot,
  glassPointerHighlightSnapshot,
} from "../../registry/liquid-glass/refraction/engine";
import { GlassSlider } from "../components/glass-slider";
import { CustomizeColorField } from "../components/customize-color-field";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  advancedMaterialParamDefs,
  diffPartial,
  engineParamDefs,
  formatJsxObject,
  pointerParamDefs,
  type EngineState,
  type PointerState,
} from "../customizer-params";
import { CodeBlock } from "./code-block";
import { CustomizerDraggableGlass } from "./customizer-draggable-glass";

const customizerPresets = ["regular", "navigation", "control", "panel"] as const;
type CustomizerPreset = (typeof customizerPresets)[number];

function CustomizerSectionSummary({
  icon,
  children,
}: {
  icon: typeof DropletIcon;
  children: ReactNode;
}) {
  return (
    <summary className="customizer-section__summary">
      <span className="customizer-section__summary-label">
        <HugeiconsIcon
          icon={icon}
          size={14}
          color="currentColor"
          strokeWidth={1.75}
          aria-hidden
        />
        <span>{children}</span>
      </span>
    </summary>
  );
}

function CustomizerLabelWithIcon({
  icon,
  children,
}: {
  icon: typeof DropletIcon;
  children: ReactNode;
}) {
  return (
    <span className="customizer-label-with-icon">
      <HugeiconsIcon
        icon={icon}
        size={14}
        color="currentColor"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>{children}</span>
    </span>
  );
}

export function CustomizeShowcase() {
  const engineDefaults = useMemo(() => glassEngineSnapshot(), []);
  const pointerDefaults = useMemo(() => glassPointerHighlightSnapshot(), []);
  const initialMaterial = resolveGlassMaterial("regular");

  const [preset, setPreset] = useState<CustomizerPreset>("regular");
  const [scale, setScale] = useState(initialMaterial.scale);
  const [blur, setBlur] = useState(initialMaterial.blur);
  const [tint, setTint] = useState(initialMaterial.tint);
  const [chroma, setChroma] = useState(initialMaterial.chroma);
  const [fill, setFill] = useState(initialMaterial.fill);
  const [borderRadius, setBorderRadius] = useState(36);
  const [depth, setDepth] = useState(initialMaterial.depth);
  const [curvature, setCurvature] = useState(initialMaterial.curvature);
  const [splay, setSplay] = useState(initialMaterial.splay);
  const [glow, setGlow] = useState(initialMaterial.glow);
  const [edgeHighlight, setEdgeHighlight] = useState(initialMaterial.edgeHighlight);
  const [specular, setSpecular] = useState(initialMaterial.specular);
  const [specularAngle, setSpecularAngle] = useState(initialMaterial.specularAngle);
  const [engine, setEngine] = useState<EngineState>(engineDefaults);
  const [pointerHighlightEnabled, setPointerHighlightEnabled] = useState(true);
  const [pointerHighlight, setPointerHighlight] = useState<PointerState>(pointerDefaults);

  const applyMaterialPreset = (material: ReturnType<typeof resolveGlassMaterial>) => {
    setScale(material.scale);
    setBlur(material.blur);
    setTint(material.tint);
    setChroma(material.chroma);
    setFill(material.fill);
    setDepth(material.depth);
    setCurvature(material.curvature);
    setSplay(material.splay);
    setGlow(material.glow);
    setEdgeHighlight(material.edgeHighlight);
    setSpecular(material.specular);
    setSpecularAngle(material.specularAngle);
  };

  const selectPreset = (next: CustomizerPreset) => {
    setPreset(next);
    applyMaterialPreset(resolveGlassMaterial(next));
  };

  const material = {
    preset,
    scale,
    blur,
    tint,
    chroma,
    fill,
    depth,
    curvature,
    splay,
    glow,
    edgeHighlight,
    specular,
    specularAngle,
  } satisfies {
    preset: GlassMaterialName;
    scale: number;
    blur: number;
    tint: number;
    chroma: number;
    fill: string;
    depth: number;
    curvature: number;
    splay: number;
    glow: number;
    edgeHighlight: number;
    specular: number;
    specularAngle: number;
  };

  const engineOverrides = useMemo(
    () => diffPartial(engine, engineDefaults),
    [engine, engineDefaults],
  );
  const pointerHighlightProp = useMemo(() => {
    if (!pointerHighlightEnabled) return false as const;
    const overrides = diffPartial(pointerHighlight, pointerDefaults);
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [pointerHighlight, pointerDefaults, pointerHighlightEnabled]);

  const advancedMaterialValues = {
    depth,
    curvature,
    splay,
    glow,
    edgeHighlight,
    specular,
    specularAngle,
  };

  const setAdvancedMaterialValue = (key: keyof typeof advancedMaterialValues, value: number) => {
    switch (key) {
      case "depth":
        setDepth(value);
        break;
      case "curvature":
        setCurvature(value);
        break;
      case "splay":
        setSplay(value);
        break;
      case "glow":
        setGlow(value);
        break;
      case "edgeHighlight":
        setEdgeHighlight(value);
        break;
      case "specular":
        setSpecular(value);
        break;
      case "specularAngle":
        setSpecularAngle(value);
        break;
    }
  };

  const setEngineValue = (key: keyof EngineState, value: number) => {
    setEngine((current) => ({ ...current, [key]: value }));
  };

  const setPointerValue = (key: keyof PointerState, value: number) => {
    setPointerHighlight((current) => ({ ...current, [key]: value }));
  };

  const generatedExample = useMemo(() => {
    const props = [
      "width={340}",
      "height={180}",
      `borderRadius={${borderRadius}}`,
      `material={${formatJsxObject(
        {
          preset,
          scale,
          blur,
          tint,
          chroma,
          fill,
          depth,
          curvature,
          splay,
          glow,
          edgeHighlight,
          specular,
          specularAngle,
        },
        "    ",
      )}}`,
    ];

    if (Object.keys(engineOverrides).length > 0) {
      props.push(`engine={${formatJsxObject(engineOverrides as Record<string, number>, "  ")}}`);
    }

    if (pointerHighlightProp === false) {
      props.push("pointerHighlight={false}");
    } else if (pointerHighlightProp) {
      props.push(
        `pointerHighlight={${formatJsxObject(pointerHighlightProp as Record<string, number>, "  ")}}`,
      );
    }

    return `<LiquidGlass\n  ${props.join("\n  ")}\n/>`;
  }, [
    preset,
    scale,
    blur,
    tint,
    chroma,
    fill,
    depth,
    curvature,
    splay,
    glow,
    edgeHighlight,
    specular,
    specularAngle,
    borderRadius,
    engineOverrides,
    pointerHighlightProp,
  ]);

  return (
    <div className="customizer-layout">
      <header className="customizer-seo-copy">
        <p>Interactive React tool</p>
        <h1>Liquid Glass Customizer</h1>
        <span>
          Tune refraction, blur, tint, chroma, lighting, and radius, then copy
          the generated JSX.
        </span>
      </header>
      <CustomizerDraggableGlass
        borderRadius={borderRadius}
        material={material}
        engine={Object.keys(engineOverrides).length > 0 ? engineOverrides : undefined}
        pointerHighlight={pointerHighlightProp}
      />

      <div className="customizer-controls">
        <Tabs className="customizer-tabs" defaultValue="controls">
          <TabsList className="customizer-tabs__list" aria-label="Customize panel view">
            <TabsTrigger className="customizer-tabs__trigger" value="controls">
              <HugeiconsIcon
                icon={SlidersHorizontalIcon}
                size={14}
                color="currentColor"
                strokeWidth={1.75}
                aria-hidden
              />
              Controls
            </TabsTrigger>
            <TabsTrigger className="customizer-tabs__trigger" value="jsx">
              <HugeiconsIcon
                icon={CodeIcon}
                size={14}
                color="currentColor"
                strokeWidth={1.75}
                aria-hidden
              />
              JSX
            </TabsTrigger>
          </TabsList>

          <TabsContent className="customizer-tabs__content" value="controls">
            <div className="customizer-select">
              <label className="customizer-select__label" htmlFor="customizer-preset">
                <CustomizerLabelWithIcon icon={Layers01Icon}>Preset</CustomizerLabelWithIcon>
              </label>
              <Select
                value={preset}
                onValueChange={(value) => selectPreset(value as CustomizerPreset)}
              >
                <SelectTrigger id="customizer-preset" className="customizer-select__trigger w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="customizer-select__content" position="popper" align="start">
                  {customizerPresets.map((name) => (
                    <SelectItem key={name} value={name} className="customizer-select__item">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <details className="customizer-section" open>
              <CustomizerSectionSummary icon={DropletIcon}>Material</CustomizerSectionSummary>
              <div className="customizer-sliders">
                <GlassSlider label="Scale" value={scale} min={0} max={3} step={0.01} onChange={setScale} />
                <GlassSlider label="Blur" value={blur} min={0} max={8} step={0.1} display={`${blur.toFixed(1)} px`} onChange={setBlur} />
                <GlassSlider label="Tint" value={tint} min={0} max={1} step={0.01} onChange={setTint} />
                <GlassSlider label="Chroma" value={chroma} min={0} max={1} step={0.01} onChange={setChroma} />
                <GlassSlider label="Radius" value={borderRadius} min={12} max={90} step={1} display={`${borderRadius} px`} onChange={setBorderRadius} />
                <CustomizeColorField
                  label="Fill"
                  icon={ColorsIcon}
                  value={fill}
                  onChange={setFill}
                />
              </div>
            </details>

            <details className="customizer-section">
              <CustomizerSectionSummary icon={SparklesIcon}>Advanced Material</CustomizerSectionSummary>
              <div className="customizer-sliders">
                {advancedMaterialParamDefs.map((param) => (
                  <GlassSlider
                    key={param.key}
                    label={param.label}
                    value={advancedMaterialValues[param.key as keyof typeof advancedMaterialValues]}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    display={param.format?.(advancedMaterialValues[param.key as keyof typeof advancedMaterialValues])}
                    onChange={(value) =>
                      setAdvancedMaterialValue(param.key as keyof typeof advancedMaterialValues, value)
                    }
                  />
                ))}
              </div>
            </details>

            <details className="customizer-section">
              <CustomizerSectionSummary icon={CpuIcon}>Engine</CustomizerSectionSummary>
              <div className="customizer-sliders">
                {engineParamDefs.map((param) => (
                  <GlassSlider
                    key={param.key}
                    label={param.label}
                    value={engine[param.key as keyof EngineState]}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    display={param.format?.(engine[param.key as keyof EngineState])}
                    onChange={(value) => setEngineValue(param.key as keyof EngineState, value)}
                  />
                ))}
              </div>
            </details>

            <details className="customizer-section">
              <CustomizerSectionSummary icon={Cursor02Icon}>Pointer Highlight</CustomizerSectionSummary>
              <label className="customizer-toggle">
                <span>Enabled</span>
                <input
                  type="checkbox"
                  checked={pointerHighlightEnabled}
                  onChange={(event) => setPointerHighlightEnabled(event.currentTarget.checked)}
                />
              </label>
              <div className={`customizer-sliders${pointerHighlightEnabled ? "" : " customizer-sliders--disabled"}`}>
                {pointerParamDefs.map((param) => (
                  <GlassSlider
                    key={param.key}
                    label={param.label}
                    value={pointerHighlight[param.key as keyof PointerState]}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    display={param.format?.(pointerHighlight[param.key as keyof PointerState])}
                    disabled={!pointerHighlightEnabled}
                    onChange={(value) => setPointerValue(param.key as keyof PointerState, value)}
                  />
                ))}
              </div>
            </details>
          </TabsContent>

          <TabsContent className="customizer-tabs__content customizer-tabs__content--code" value="jsx">
            <CodeBlock label="JSX" code={generatedExample} language="tsx" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
