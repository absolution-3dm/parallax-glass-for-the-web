"use client";

import { Analytics } from "@vercel/analytics/react";
import { AnimatePresence } from "motion/react";
import { Playground } from "./playground";
import { CustomizePage } from "./playground/customize-page";
import { Router, useRouter } from "./playground/router";
import {
  BrowserSupportPage,
  HowLiquidGlassWorksPage,
  LiquidGlassReactPage,
  LiquidGlassShadcnPage,
} from "./seo-pages";
import { useSeoHead } from "./seo-head";

function AppRoutes() {
  const { path } = useRouter();
  useSeoHead(path);

  const page = (() => {
    switch (path) {
      case "/customize":
        return <CustomizePage key="/customize" />;
      case "/liquid-glass-react":
        return <LiquidGlassReactPage key="/liquid-glass-react" />;
      case "/liquid-glass-shadcn":
        return <LiquidGlassShadcnPage key="/liquid-glass-shadcn" />;
      case "/guides/how-liquid-glass-works":
        return <HowLiquidGlassWorksPage key="/guides/how-liquid-glass-works" />;
      case "/browser-support":
        return <BrowserSupportPage key="/browser-support" />;
      default:
        return <Playground key="/" />;
    }
  })();

  return (
    <AnimatePresence mode="wait" initial>
      {page}
    </AnimatePresence>
  );
}

export function App({ initialPath }: { initialPath?: string }) {
  return (
    <Router initialPath={initialPath}>
      <AppRoutes />
      <Analytics />
    </Router>
  );
}
