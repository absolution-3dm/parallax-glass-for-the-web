"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { motion, useReducedMotion } from "motion/react";
import { IOSPointer } from "../../registry/liquid-glass/compositions/ios-pointer";
import { CustomizeShowcase } from "./customize-showcase";
import { Appear, AppearItem, PageShell, appearTransition } from "./page-motion";
import { Link } from "./router";

export function CustomizePage() {
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("customize-page-active");
    return () => {
      root.classList.remove("customize-page-active");
    };
  }, []);

  return (
    <PageShell className="page-shell--customize">
      <IOSPointer />
      <div className="static-backdrop" aria-hidden />
      <div className="site-chrome-tint" aria-hidden />

      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0 }
            : { ...appearTransition, delay: 0.08 }
        }
      >
        <Link to="/" className="customize-page__back" aria-label="Back to home">
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            size={18}
            color="currentColor"
            strokeWidth={1.75}
            aria-hidden
          />
        </Link>
      </motion.div>

      <main className="customize-page" id="top">
        <Appear className="customize-page__appear">
          <AppearItem>
            <CustomizeShowcase />
          </AppearItem>
        </Appear>
      </main>
    </PageShell>
  );
}
