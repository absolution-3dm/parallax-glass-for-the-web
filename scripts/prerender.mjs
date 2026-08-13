import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const ssrDir = path.join(projectRoot, ".ssr-dist");
const template = await readFile(path.join(distDir, "index.html"), "utf8");
const serverEntry = await import(
  `${pathToFileURL(path.join(ssrDir, "entry-server.js")).href}?t=${Date.now()}`
);

for (const route of serverEntry.seoRoutes) {
  const { appHtml, headHtml } = serverEntry.renderPage(route.path);
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, headHtml)
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  const filename =
    route.path === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, `${route.path.slice(1)}.html`);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, html);
}

const sitemapUrls = serverEntry.seoRoutes
  .map((route) => {
    const url =
      route.path === "/"
        ? "https://parallax-glass.vercel.app/"
        : `https://parallax-glass.vercel.app${route.path}`;
    return `  <url><loc>${url}</loc></url>`;
  })
  .join("\n");

await writeFile(
  path.join(distDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`,
);

await rm(ssrDir, { recursive: true, force: true });
