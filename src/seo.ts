export const SITE_ORIGIN = "https://parallax-glass.vercel.app";
export const SITE_NAME = "Parallax Glass";
export const GITHUB_REPOSITORY =
  "https://github.com/absolution-3dm/parallax-glass-for-the-web";
export const OG_IMAGE = "/images/Carousel%20Background/02-chroma.png";

export const seoRoutes = [
  {
    path: "/",
    title: "Liquid Glass for React & Web | Parallax Glass",
    description:
      "Build Apple-inspired Liquid Glass interfaces for React and the web with live backdrop refraction, customizable materials, shadcn source install, and browser fallbacks.",
    heading: "Liquid Glass for the Web",
  },
  {
    path: "/liquid-glass-react",
    title: "Liquid Glass React Component | Parallax Glass",
    description:
      "Add source-owned Liquid Glass to React with live DOM backdrop refraction, responsive sizing, material presets, pointer lighting, and honest browser fallbacks.",
    heading: "Liquid Glass React Component",
  },
  {
    path: "/liquid-glass-shadcn",
    title: "Liquid Glass shadcn Component | Parallax Glass",
    description:
      "Install Liquid Glass through the shadcn Registry. Copy the React source, materials, refraction engine, and optional compositions directly into your project.",
    heading: "Liquid Glass for shadcn/ui",
  },
  {
    path: "/customize",
    title: "Liquid Glass Generator & Customizer | Parallax Glass",
    description:
      "Customize a Liquid Glass React surface visually. Tune refraction, blur, tint, chroma, lighting, radius, and engine controls, then copy the generated JSX.",
    heading: "Liquid Glass Customizer",
  },
  {
    path: "/guides/how-liquid-glass-works",
    title: "How Liquid Glass Works on the Web | Parallax Glass",
    description:
      "Learn how web Liquid Glass uses optical fields, axis-isolated SVG displacement maps, chromatic refraction, specular light, and browser-specific fallbacks.",
    heading: "How Liquid Glass Works on the Web",
  },
  {
    path: "/browser-support",
    title: "Liquid Glass Browser Support | Parallax Glass",
    description:
      "Compare Liquid Glass rendering in Chromium, Safari, WebKit, and Firefox, including live SVG backdrop refraction and CSS blur, tint, and highlight fallbacks.",
    heading: "Liquid Glass Browser Support",
  },
] as const;

export type SeoPath = (typeof seoRoutes)[number]["path"];
export type SeoRoute = (typeof seoRoutes)[number];

export function normalizeSeoPath(pathname: string): SeoPath | null {
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return seoRoutes.some((route) => route.path === normalized)
    ? (normalized as SeoPath)
    : null;
}

export function getSeoRoute(pathname: string): SeoRoute {
  const normalized = normalizeSeoPath(pathname);
  return seoRoutes.find((route) => route.path === normalized) ?? seoRoutes[0];
}

export function canonicalUrl(path: SeoPath) {
  return path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}

function breadcrumbName(path: SeoPath) {
  if (path === "/") return "Liquid Glass for the Web";
  return getSeoRoute(path).heading;
}

export function structuredDataFor(path: SeoPath) {
  if (path === "/") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": `${SITE_ORIGIN}/#website`,
          url: `${SITE_ORIGIN}/`,
          name: SITE_NAME,
          alternateName: "Liquid Glass for Web",
          description: getSeoRoute("/").description,
        },
        {
          "@type": "SoftwareSourceCode",
          "@id": `${SITE_ORIGIN}/#source`,
          name: SITE_NAME,
          alternateName: "Liquid Glass for React and the Web",
          description: getSeoRoute("/").description,
          url: `${SITE_ORIGIN}/`,
          codeRepository: GITHUB_REPOSITORY,
          license: `${GITHUB_REPOSITORY}/blob/main/LICENSE`,
          programmingLanguage: ["TypeScript", "CSS"],
          runtimePlatform: "Web Browser",
          isAccessibleForFree: true,
        },
      ],
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: breadcrumbName(path),
        item: canonicalUrl(path),
      },
    ],
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSeoHead(pathname: string) {
  const route = getSeoRoute(pathname);
  const canonical = canonicalUrl(route.path);
  const image = `${SITE_ORIGIN}${OG_IMAGE}`;
  const jsonLd = JSON.stringify(structuredDataFor(route.path)).replace(/</g, "\\u003c");

  return [
    `<title>${escapeHtml(route.title)}</title>`,
    `<meta name="description" content="${escapeHtml(route.description)}" />`,
    '<meta name="robots" content="index,follow" />',
    `<link rel="canonical" href="${canonical}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(route.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(route.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(route.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(route.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<script type="application/ld+json" data-parallax-glass-seo="structured-data">${jsonLd}</script>`,
  ].join("\n    ");
}
