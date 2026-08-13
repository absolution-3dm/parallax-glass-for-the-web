import type { ReactNode } from "react";
import { IOSPointer } from "../registry/liquid-glass/compositions/ios-pointer";
import { GITHUB_REPOSITORY, getSeoRoute, type SeoPath } from "./seo";

const installCommand =
  "pnpm dlx shadcn@latest add https://parallax-glass.vercel.app/r/liquid-glass.json";

function SiteHeader() {
  return (
    <header className="content-site-header">
      <a className="site-brand" href="/">
        Parallax Glass
      </a>
      <nav className="content-site-nav" aria-label="Documentation">
        <a href="/liquid-glass-react">React</a>
        <a href="/liquid-glass-shadcn">shadcn</a>
        <a href="/guides/how-liquid-glass-works">How it works</a>
        <a href="/browser-support">Browsers</a>
        <a href="/customize">Customize</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="content-site-footer">
      <span>Parallax Glass · Liquid Glass for React and the web</span>
      <nav aria-label="Project">
        <a href={GITHUB_REPOSITORY}>GitHub</a>
        <a href={`${GITHUB_REPOSITORY}/blob/main/README.md`}>Documentation</a>
        <a href={`${GITHUB_REPOSITORY}/blob/main/LICENSE`}>MIT License</a>
      </nav>
    </footer>
  );
}

function ContentPage({
  path,
  eyebrow,
  intro,
  children,
}: {
  path: Exclude<SeoPath, "/" | "/customize">;
  eyebrow: string;
  intro: string;
  children: ReactNode;
}) {
  const seo = getSeoRoute(path);
  return (
    <div className="page-shell content-page-shell">
      <IOSPointer />
      <div className="static-backdrop" aria-hidden />
      <div className="site-chrome-tint" aria-hidden />
      <SiteHeader />
      <main className="content-page">
        <header className="content-hero">
          <p className="content-eyebrow">{eyebrow}</p>
          <h1>{seo.heading}</h1>
          <p className="content-lede">{intro}</p>
          <div className="content-actions">
            <a className="content-button content-button--primary" href="/customize">
              Open customizer
            </a>
            <a className="content-button" href={GITHUB_REPOSITORY}>
              View source
            </a>
          </div>
        </header>
        <div className="content-body">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

function CodeSample({ children }: { children: string }) {
  return (
    <pre className="content-code">
      <code>{children}</code>
    </pre>
  );
}

function RelatedLinks({ current }: { current: SeoPath }) {
  const links = [
    ["/liquid-glass-react", "Use Liquid Glass in React"],
    ["/liquid-glass-shadcn", "Install from the shadcn Registry"],
    ["/guides/how-liquid-glass-works", "Understand the refraction pipeline"],
    ["/browser-support", "Check browser support"],
  ] as const;
  return (
    <section className="content-section">
      <h2>Continue exploring</h2>
      <div className="content-link-grid">
        {links
          .filter(([path]) => path !== current)
          .map(([path, label]) => (
            <a key={path} href={path}>
              {label}<span aria-hidden> →</span>
            </a>
          ))}
      </div>
    </section>
  );
}

export function LiquidGlassReactPage() {
  return (
    <ContentPage
      path="/liquid-glass-react"
      eyebrow="React component"
      intro="A source-owned React primitive that bends the live page behind it in Chromium, keeps children sharp, and provides deliberate CSS fallbacks in Safari and Firefox."
    >
      <section className="content-section content-prose">
        <h2>A real backdrop lens, not a screenshot</h2>
        <p>
          Parallax Glass renders tint, blur, specular edges, chromatic separation,
          and pointer-responsive light around your existing React content. The
          component never captures the page, clones the DOM, or replaces live
          content with a rasterized layer. Text and controls behind the surface
          remain part of the real document.
        </p>
        <p>
          The implementation is copied into your project, so you can inspect the
          optical math, tune material presets, and ship without a private runtime
          package. React 19 is used by this demo, while the installed primitive is
          ordinary TypeScript and CSS source.
        </p>
      </section>

      <section className="content-section">
        <h2>Basic React usage</h2>
        <CodeSample>{`import { LiquidGlass } from "@/components/liquid-glass/liquid-glass"

export function GlassButton() {
  return (
    <LiquidGlass
      width={240}
      height={72}
      borderRadius={24}
      material="control"
    >
      <button type="button">Open project</button>
    </LiquidGlass>
  )
}`}</CodeSample>
        <p className="content-note">
          Children render above the optical surface. Use <code>stateLayer</code>
          for selection chrome and <code>overlayLayer</code> for an interactive
          layer that must sit above the content.
        </p>
      </section>

      <section className="content-section">
        <h2>Responsive surfaces and material presets</h2>
        <div className="content-card-grid">
          <article>
            <h3>Responsive sizing</h3>
            <p>
              Width and height accept pixels or CSS size strings. A ResizeObserver
              measures the actual layout box and rebuilds an aspect-correct optical
              map only when the surface size changes.
            </p>
          </article>
          <article>
            <h3>Physical materials</h3>
            <p>
              Choose ultraThin, thin, regular, thick, or ultraThick to increase
              optical weight, blur, and separation from the background.
            </p>
          </article>
          <article>
            <h3>Semantic recipes</h3>
            <p>
              Navigation, control, panel, and selectionPressed provide stable
              starting points for common interface roles.
            </p>
          </article>
          <article>
            <h3>Pointer lighting</h3>
            <p>
              Tune highlight radius and strength per surface, or disable pointer
              lighting on non-interactive elements to avoid unnecessary filter work.
            </p>
          </article>
        </div>
      </section>

      <RelatedLinks current="/liquid-glass-react" />
    </ContentPage>
  );
}

export function LiquidGlassShadcnPage() {
  return (
    <ContentPage
      path="/liquid-glass-shadcn"
      eyebrow="shadcn Registry"
      intro="Install the optical primitive or an optional composition with the shadcn CLI. The command copies editable React, CSS, material, and refraction source into your application."
    >
      <section className="content-section">
        <h2>Install the core Liquid Glass primitive</h2>
        <CodeSample>{installCommand}</CodeSample>
        <p className="content-note">
          With npm, replace the command prefix with <code>npx shadcn@latest add</code>.
          The registry endpoint resolves declared dependencies and writes the source
          to your configured shadcn component directory.
        </p>
      </section>

      <section className="content-section content-prose">
        <h2>You own the installed source</h2>
        <p>
          This project is a source distribution rather than a private component
          runtime. After installation, your application owns the component files,
          material registry, browser capability checks, and refraction engine. You
          can review every SVG primitive and adapt the public component locally.
        </p>
        <p>
          The core item has no Motion dependency. Animated compositions declare
          Motion only when they need spring, drag, or morph behavior.
        </p>
      </section>

      <section className="content-section">
        <h2>Registry components</h2>
        <div className="content-table-wrap">
          <table className="content-table">
            <thead><tr><th>Item</th><th>Use</th><th>Motion</th></tr></thead>
            <tbody>
              <tr><td><code>liquid-glass</code></td><td>Core optical surface</td><td>No</td></tr>
              <tr><td><code>liquid-glass-icon-pill</code></td><td>Circular icon actions</td><td>No</td></tr>
              <tr><td><code>liquid-glass-magnetic-pointer</code></td><td>Pointer attraction and press deformation</td><td>No</td></tr>
              <tr><td><code>liquid-glass-navigation</code></td><td>Draggable segmented navigation</td><td>Yes</td></tr>
              <tr><td><code>liquid-glass-capsule</code></td><td>Free drag, squish, and spring return</td><td>Yes</td></tr>
              <tr><td><code>liquid-glass-menu</code></td><td>Morphing compound menu</td><td>Yes</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <h2>Install an optional composition</h2>
        <CodeSample>{`pnpm dlx shadcn@latest add \\
  https://parallax-glass.vercel.app/r/liquid-glass-navigation.json`}</CodeSample>
        <p className="content-note">
          Each registry item declares its local files and dependencies. Install only
          the pieces your interface needs.
        </p>
      </section>

      <RelatedLinks current="/liquid-glass-shadcn" />
    </ContentPage>
  );
}

export function HowLiquidGlassWorksPage() {
  return (
    <ContentPage
      path="/guides/how-liquid-glass-works"
      eyebrow="Technical guide"
      intro="The web effect combines a CPU-generated optical field with axis-isolated SVG displacement, chromatic channel passes, blur, tint, specular light, and edge-aware composition."
    >
      <section className="content-section content-prose">
        <h2>From a rounded surface to an optical field</h2>
        <p>
          The component measures its real layout box and evaluates a rounded-box
          lens field. Depth, curvature, splay, and edge parameters control the
          direction and strength of the field. The calculation happens once per
          stable size, then produces cached PNG textures for the SVG filter graph.
        </p>
        <p>
          Splay interpolates between the local silhouette normal and a ray from the
          panel center. That center-radial field creates mirrored directional halves
          on every edge instead of a single global distortion direction.
        </p>
      </section>

      <section className="content-section">
        <h2>Independent X and Y displacement maps</h2>
        <ol className="content-steps">
          <li>Compute the combined optical field once.</li>
          <li>Encode an opaque X texture with R/X and B/specular data.</li>
          <li>Encode a separate opaque Y texture with G/Y data.</li>
          <li>Load the textures through distinct SVG <code>feImage</code> nodes.</li>
          <li>Force unused channels to exactly 0.5 before displacement.</li>
        </ol>
        <p className="content-note">
          PNG channel 128 is 128/255, not exactly 0.5. A small active-channel bias
          correction prevents a neutral flat field from producing residual color
          displacement when chromatic scales differ.
        </p>
      </section>

      <section className="content-section content-prose">
        <h2>Edge-dependent pass order</h2>
        <p>
          One universal axis order loses tangential detail when the second pass
          resamples the first near a flat part of the lens. Top and bottom edges
          therefore use Y then X, while the sides use X then Y. An alpha mask based
          on edge orientation combines the completed branches arithmetically and
          blends their rounded corners without a dark seam.
        </p>
        <CodeSample>{`top / bottom: Y → X
left / right: X → Y

red, green, and blue each retain both ordered branches`}</CodeSample>
      </section>

      <section className="content-section">
        <h2>Refraction is only one layer</h2>
        <div className="content-card-grid">
          <article><h3>Displacement</h3><p>Bends the sampled live backdrop around the generated lens field.</p></article>
          <article><h3>Chroma</h3><p>Uses slightly different channel scales to create controlled color separation.</p></article>
          <article><h3>Material</h3><p>Blur, fill, tint, glow, and edge highlight establish optical weight and contrast.</p></article>
          <article><h3>Specular light</h3><p>A baked rim channel and optional pointer mask add directional surface light.</p></article>
        </div>
      </section>

      <section className="content-section content-prose">
        <h2>Why the fallback does not pretend to refract</h2>
        <p>
          Safari and Firefox cannot currently apply this SVG reference graph to a
          real arbitrary backdrop. Capturing or cloning the page would break live
          document behavior and introduce correctness, privacy, and maintenance
          problems. Those browsers intentionally receive CSS blur, tint, and
          highlight instead.
        </p>
      </section>

      <RelatedLinks current="/guides/how-liquid-glass-works" />
    </ContentPage>
  );
}

export function BrowserSupportPage() {
  return (
    <ContentPage
      path="/browser-support"
      eyebrow="Compatibility"
      intro="Parallax Glass uses capability-gated rendering: Chromium gets live SVG backdrop displacement, while Safari and Firefox receive a clear CSS material fallback without page capture or duplicated content."
    >
      <section className="content-section">
        <h2>Rendering paths by browser engine</h2>
        <div className="content-table-wrap">
          <table className="content-table">
            <thead><tr><th>Engine</th><th>Backdrop</th><th>Visual layers</th></tr></thead>
            <tbody>
              <tr><td>Chromium</td><td>Live SVG displacement</td><td>Refraction, chroma, blur, tint, specular edge, pointer light</td></tr>
              <tr><td>Safari / WebKit</td><td>CSS backdrop blur</td><td>Blur, tint, highlight, dense specular overlay</td></tr>
              <tr><td>Firefox</td><td>CSS backdrop blur</td><td>Blur, tint, highlight</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section content-prose">
        <h2>Why Safari and Firefox use a fallback</h2>
        <p>
          WebKit accepts SVG reference-filter syntax in a backdrop declaration but
          does not apply primitives such as <code>feDisplacementMap</code> to the
          real backdrop. Firefox has the same practical boundary for this effect.
          CSS blur is therefore presented honestly as blur rather than refraction.
        </p>
        <p>
          Parallax Glass never applies a filter to the page content behind the
          primitive and never uses canvas capture, screenshots, foreignObject, or a
          duplicated DOM layer as a workaround.
        </p>
      </section>

      <section className="content-section">
        <h2>Progressive enhancement</h2>
        <div className="content-card-grid">
          <article><h3>Sharp children</h3><p>Content inside the component remains above the optical surface on every rendering path.</p></article>
          <article><h3>Stable layout</h3><p>The component keeps the same dimensions, radius, tint, and interaction model across browsers.</p></article>
          <article><h3>Reduced work</h3><p>Off-screen surfaces detach expensive backdrop filters, and stable lens maps are cached.</p></article>
          <article><h3>Reduced motion</h3><p>Compositions can honor user motion preferences without removing the underlying material.</p></article>
        </div>
      </section>

      <section className="content-section content-prose">
        <h2>Testing a Liquid Glass surface</h2>
        <p>
          Validate Chromium refraction with high-contrast content crossing all four
          edges. Check top, bottom, left, and right displacement independently,
          because a correct CPU map cannot expose every GPU filter-pipeline issue.
          Then confirm that Safari and Firefox retain readable contrast and do not
          claim or simulate live refraction.
        </p>
      </section>

      <RelatedLinks current="/browser-support" />
    </ContentPage>
  );
}

export function HomeSeoContent() {
  return (
    <section className="home-seo" aria-labelledby="liquid-glass-web-heading">
      <div className="home-seo__intro">
        <p className="content-eyebrow">Open-source React primitive</p>
        <h2 id="liquid-glass-web-heading">Liquid Glass built for the live web</h2>
        <p>
          Parallax Glass is a source-owned Liquid Glass component for React. It
          combines live backdrop refraction in Chromium with customizable material
          recipes and deliberate CSS fallbacks for Safari and Firefox. Install it
          through the shadcn Registry, inspect every line, and adapt it to your UI.
        </p>
      </div>
      <div className="content-card-grid">
        <article>
          <h3>Live DOM backdrop</h3>
          <p>The Chromium path refracts the real rendered page without screenshots, canvas capture, or cloned content.</p>
          <a href="/guides/how-liquid-glass-works">How the SVG pipeline works →</a>
        </article>
        <article>
          <h3>React and shadcn</h3>
          <p>Use a typed React API or let the shadcn CLI copy the complete editable implementation into your project.</p>
          <a href="/liquid-glass-react">Explore the React component →</a>
        </article>
        <article>
          <h3>Material customizer</h3>
          <p>Tune refraction scale, blur, chroma, tint, lighting, radius, and advanced engine controls visually.</p>
          <a href="/customize">Generate Liquid Glass JSX →</a>
        </article>
        <article>
          <h3>Honest browser support</h3>
          <p>Keep the same component structure while each browser receives the strongest correct rendering path it supports.</p>
          <a href="/browser-support">Compare browser rendering →</a>
        </article>
      </div>
      <div className="home-seo__faq">
        <h2>Liquid Glass for web developers</h2>
        <details>
          <summary>Is this a CSS glassmorphism effect?</summary>
          <p>It includes blur and tint, but Chromium also bends the live backdrop through independent SVG displacement maps. Safari and Firefox use the CSS material fallback.</p>
        </details>
        <details>
          <summary>Does it work with React and shadcn/ui?</summary>
          <p>Yes. The public primitive is a React component, and every registry item can be installed as source with the shadcn CLI.</p>
        </details>
        <details>
          <summary>Does it capture or duplicate the page?</summary>
          <p>No. The component does not screenshot, rasterize, clone, or replace the page content behind the glass.</p>
        </details>
      </div>
    </section>
  );
}
