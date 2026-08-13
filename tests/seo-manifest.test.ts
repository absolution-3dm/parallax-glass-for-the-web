import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  getSeoRoute,
  renderSeoHead,
  seoRoutes,
  SITE_ORIGIN,
  structuredDataFor,
} from "../src/seo";

describe("SEO route manifest", () => {
  it("defines six unique, indexable routes", () => {
    expect(seoRoutes).toHaveLength(6);
    expect(new Set(seoRoutes.map((route) => route.path)).size).toBe(6);
    expect(new Set(seoRoutes.map((route) => route.title)).size).toBe(6);
    expect(new Set(seoRoutes.map((route) => route.description)).size).toBe(6);
  });

  it("builds one canonical URL per route", () => {
    const canonicals = seoRoutes.map((route) => canonicalUrl(route.path));
    expect(new Set(canonicals).size).toBe(seoRoutes.length);
    expect(canonicals.every((url) => url.startsWith(`${SITE_ORIGIN}/`))).toBe(true);
  });

  it("renders complete metadata for every route", () => {
    for (const route of seoRoutes) {
      const head = renderSeoHead(route.path);
      expect(head.match(/<title>/g)).toHaveLength(1);
      expect(head).toContain(route.title.replace("&", "&amp;"));
      expect(head).toContain(route.description);
      expect(head).toContain(canonicalUrl(route.path));
      expect(head).toContain('name="robots" content="index,follow"');
      expect(head).toContain('type="application/ld+json"');
    }
  });

  it("uses website/source data on home and breadcrumbs elsewhere", () => {
    expect(structuredDataFor("/")).toHaveProperty("@graph");
    for (const route of seoRoutes.slice(1)) {
      expect(structuredDataFor(route.path)).toHaveProperty("@type", "BreadcrumbList");
    }
  });

  it("falls back to the home manifest entry for an unknown path", () => {
    expect(getSeoRoute("/not-a-route")).toBe(seoRoutes[0]);
  });
});
