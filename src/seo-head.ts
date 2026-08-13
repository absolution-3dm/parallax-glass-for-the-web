import { useEffect } from "react";
import {
  canonicalUrl,
  getSeoRoute,
  OG_IMAGE,
  SITE_NAME,
  SITE_ORIGIN,
  structuredDataFor,
} from "./seo";

function setMeta(selector: string, attributes: Record<string, string>) {
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!node) {
    node = document.createElement("meta");
    document.head.append(node);
  }
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
}

export function useSeoHead(pathname: string) {
  useEffect(() => {
    const route = getSeoRoute(pathname);
    const canonical = canonicalUrl(route.path);
    const image = `${SITE_ORIGIN}${OG_IMAGE}`;
    document.title = route.title;

    setMeta('meta[name="description"]', {
      name: "description",
      content: route.description,
    });
    setMeta('meta[name="robots"]', { name: "robots", content: "index,follow" });

    const socialMeta = [
      ["property", "og:type", "website"],
      ["property", "og:site_name", SITE_NAME],
      ["property", "og:title", route.title],
      ["property", "og:description", route.description],
      ["property", "og:url", canonical],
      ["property", "og:image", image],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", route.title],
      ["name", "twitter:description", route.description],
      ["name", "twitter:image", image],
    ] as const;

    for (const [attribute, key, content] of socialMeta) {
      setMeta(`meta[${attribute}="${key}"]`, { [attribute]: key, content });
    }

    let canonicalNode = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalNode) {
      canonicalNode = document.createElement("link");
      canonicalNode.rel = "canonical";
      document.head.append(canonicalNode);
    }
    canonicalNode.href = canonical;

    let jsonLd = document.head.querySelector<HTMLScriptElement>(
      'script[data-parallax-glass-seo="structured-data"]',
    );
    if (!jsonLd) {
      jsonLd = document.createElement("script");
      jsonLd.type = "application/ld+json";
      jsonLd.dataset.parallaxGlassSeo = "structured-data";
      document.head.append(jsonLd);
    }
    jsonLd.text = JSON.stringify(structuredDataFor(route.path));
  }, [pathname]);
}
