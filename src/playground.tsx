"use client";

import { useEffect, useState } from "react";
import { LiquidGlass } from "../registry/liquid-glass/liquid-glass";
import { IOSPointer } from "../registry/liquid-glass/compositions/ios-pointer";
import {
  heroCtaMaterial,
  heroCustomizeMaterial,
  topNavigationItems,
} from "./playground/data";
import { HeroFloatStage } from "./playground/hero-float-stage";
import { ComponentsShowcase, InstallationShowcase } from "./playground/installation-showcase";
import { MaterialAttributesCarousel } from "./playground/material-attributes-carousel";
import { Appear, AppearItem, PageShell } from "./playground/page-motion";
import { Link } from "./playground/router";
import { SiteMobileNav } from "./playground/site-mobile-nav";
import { vercelImageSrcSet, vercelImageUrl } from "./lib/vercel-image";
import { HomeSeoContent, SiteFooter } from "./seo-pages";

const HERO_SCENE = "/images/Carousel Background/02-chroma.png";

export function Playground() {
  const [topNavigationValue, setTopNavigationValue] = useState("menu");

  useEffect(() => {
    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      const activationLine = window.innerHeight * 0.3;
      let activeValue = topNavigationItems[0].value;

      for (const item of topNavigationItems) {
        const section = document.getElementById(item.value);
        if (!section) continue;
        if (section.getBoundingClientRect().top <= activationLine) {
          activeValue = item.value;
        }
      }

      setTopNavigationValue((current) =>
        current === activeValue ? current : activeValue,
      );
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  const navigateToSection = (value: string) => {
    document.getElementById(value)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <PageShell>
      <IOSPointer />
      <div className="static-backdrop" aria-hidden />
      <div className="site-chrome-tint" aria-hidden />

      <header className="site-navigation">
        <Appear className="site-navigation__appear">
          <AppearItem>
            <Link to="/" className="site-brand">
              Parallax Glass
            </Link>
          </AppearItem>
          <AppearItem as="nav" className="site-nav-links" aria-label="Primary">
            {topNavigationItems.map((item) => (
              <a
                key={item.value}
                href={item.href}
                className={
                  topNavigationValue === item.value
                    ? "site-nav-link is-active"
                    : "site-nav-link"
                }
                onClick={(event) => {
                  event.preventDefault();
                  navigateToSection(item.value);
                }}
              >
                {item.label}
              </a>
            ))}
          </AppearItem>
          <AppearItem className="site-nav-mobile">
            <SiteMobileNav
              activeValue={topNavigationValue}
              onNavigate={navigateToSection}
            />
          </AppearItem>
        </Appear>
      </header>

      <main id="top">
        <section className="hero" id="menu">
          <div className="hero-media" aria-hidden="true">
            <img
              className="hero-media__scene"
              src={vercelImageUrl(HERO_SCENE, 1280)}
              srcSet={vercelImageSrcSet(HERO_SCENE)}
              sizes="(max-width: 640px) 120vw, min(78vw, 1280px)"
              alt=""
              decoding="async"
              fetchPriority="high"
            />
            <div className="hero-media__scene-fade" />
            <div className="hero-media__veil" />
          </div>
          <div className="hero-inner">
            <Appear className="hero-copy">
              <AppearItem as="h1">Liquid Glass for the Web</AppearItem>
              <AppearItem as="p" className="hero-lede">
                An open-source React primitive with live backdrop refraction,
                customizable materials, shadcn installation, and browser fallbacks.
              </AppearItem>
              <AppearItem className="hero-cta-group">
                <a
                  className="hero-cta"
                  href="#installation"
                >
                  <LiquidGlass
                    width="100%"
                    height={44}
                    borderRadius={22}
                    material={heroCtaMaterial}
                    className="hero-cta__glass hero-cta__glass--blue"
                  >
                    <span className="hero-cta__label hero-cta__label--blue">
                      Get component
                    </span>
                  </LiquidGlass>
                </a>
                <Link
                  to="/customize"
                  className="hero-cta"
                >
                  <LiquidGlass
                    width="100%"
                    height={44}
                    borderRadius={22}
                    material={heroCustomizeMaterial}
                    className="hero-cta__glass"
                  >
                    <span className="hero-cta__label">Customize</span>
                  </LiquidGlass>
                </Link>
              </AppearItem>
            </Appear>
            <Appear className="hero-orbit">
              <AppearItem className="hero-orbit__appear">
                <HeroFloatStage />
              </AppearItem>
            </Appear>
          </div>
        </section>

        <MaterialAttributesCarousel />
        <ComponentsShowcase />
        <InstallationShowcase />
        <HomeSeoContent />
        <SiteFooter />
      </main>
    </PageShell>
  );
}
