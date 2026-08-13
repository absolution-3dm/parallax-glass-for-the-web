import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://parallax-glass.vercel.app";
const routes = [
  "/",
  "/liquid-glass-react",
  "/liquid-glass-shadcn",
  "/customize",
  "/guides/how-liquid-glass-works",
  "/browser-support",
];
const distDir = path.join(process.cwd(), "dist");
const titles = new Set();
const descriptions = new Set();
const canonicals = new Set();

function matches(html, pattern) {
  return [...html.matchAll(pattern)];
}

for (const route of routes) {
  const filename =
    route === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, `${route.slice(1)}.html`);
  const html = await readFile(filename, "utf8");
  const title = matches(html, /<title>([^<]+)<\/title>/g);
  const description = matches(
    html,
    /<meta name="description" content="([^"]+)"\s*\/>/g,
  );
  const canonical = matches(html, /<link rel="canonical" href="([^"]+)"\s*\/>/g);
  const headings = matches(html, /<h1(?:\s[^>]*)?>/g);

  if (title.length !== 1) throw new Error(`${route}: expected one title`);
  if (description.length !== 1) throw new Error(`${route}: expected one description`);
  if (canonical.length !== 1) throw new Error(`${route}: expected one canonical`);
  if (headings.length !== 1) throw new Error(`${route}: expected one h1, found ${headings.length}`);
  if (!html.includes('name="robots" content="index,follow"')) {
    throw new Error(`${route}: missing index,follow robots meta`);
  }
  if (!html.includes('type="application/ld+json"')) {
    throw new Error(`${route}: missing structured data`);
  }
  if (html.includes("localhost")) throw new Error(`${route}: contains localhost`);

  titles.add(title[0][1]);
  descriptions.add(description[0][1]);
  canonicals.add(canonical[0][1]);
}

if (titles.size !== routes.length) throw new Error("SEO titles are not unique");
if (descriptions.size !== routes.length) throw new Error("SEO descriptions are not unique");
if (canonicals.size !== routes.length) throw new Error("Canonical URLs are not unique");

const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
const sitemapUrls = matches(sitemap, /<loc>([^<]+)<\/loc>/g).map((match) => match[1]);
const expectedUrls = routes.map((route) => (route === "/" ? `${origin}/` : `${origin}${route}`));
if (JSON.stringify(sitemapUrls) !== JSON.stringify(expectedUrls)) {
  throw new Error("Sitemap URLs do not match the prerender route manifest");
}

process.stdout.write(`SEO verification passed for ${routes.length} prerendered routes.\n`);
