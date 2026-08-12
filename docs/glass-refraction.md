# Glass refraction: Chromium axis-isolated displacement workaround

## Status

This is a user-validated rendering workaround for two Chromium GPU-pipeline
regressions. The primitive keeps the canonical graph in:

- `registry/liquid-glass/liquid-glass.tsx`
- `registry/liquid-glass/refraction/lens-map.ts`

The final independent-axis-texture fix was visually confirmed on the affected
current Chrome build on 2026-07-22. A second test configuration did not
reproduce the newer regression. The current implementation preserves that graph
and its default material/engine parameters; it does not attempt a visual retune.

## Safari/WebKit boundary and rejected fallbacks

Safari currently accepts the syntax of an SVG reference in
`backdrop-filter`, but does not render reference filters such as
`feDisplacementMap` against the backdrop. Keep Safari and Firefox on the CSS
blur/tint/highlight fallback until their engines provide a working backdrop
reference-filter implementation.

Aave's Safari implementation is not a general backdrop sampler. It applies an
ordinary SVG `filter` to the real content being refracted; the source DOM's own
painted pixels move. Applying that architecture to arbitrary page content made
content visibly change as it scrolled underneath fixed glass and is rejected
for this project.

Do not reintroduce any of these workarounds:

1. Do not assign `filter: url(...)`, `will-change: filter`, or refraction
   bookkeeping attributes to page-content DOM nodes.
2. Do not use `html2canvas`, DOM screenshots, `foreignObject`, canvas capture,
   or a rasterized clone of the page.
3. Do not duplicate the DOM beneath the glass or maintain a second,
   glass-local copy that follows scrolling.
4. Do not substitute a known image URL or duplicated image layer for live page
   content. That path was tried and did not produce a correct result.
5. Do not claim CSS blur is refraction. The Safari fallback must remain
   explicitly blur-only until WebKit can apply SVG displacement to a real
   backdrop.

WebGL remains appropriate only when the source is already an explicit media
surface that can legally be used as a texture, such as a video or an
application-owned canvas. It cannot read arbitrary rendered DOM without one of
the rejected capture/copy paths above.

## Symptoms

On affected Chrome/Chromium GPU rendering pipelines, applying the displacement
map with one SVG primitive produces a directional shear:

- pixels near the top edge are displaced toward the left;
- pixels near the bottom edge are displaced toward the right.

At the time of this diagnosis the material used `splay = 1`, whose generated
CPU displacement field is symmetric. The left/right shear therefore was not
present in the map calculation.

After X and Y were split into two passes, a newer Chrome build exposed a second
directional artifact:

- top and bottom became correct;
- the left edge pulled upward and the right edge downward;
- the lateral edges showed discontinuities and stair-stepping.

The second direction signature also could not come from that symmetric CPU
field: mirrored left/right pixels had equal G/Y values, while their R/X values
had exactly the opposing signs seen in the erroneous vertical movement.

## Intended center-radial splay

`splay` interpolates between two symmetric CPU direction fields:

- `splay = 0`: the local rounded-box silhouette normal;
- `splay = 1`: the ray from the panel center through the current map pixel.

The center-radial field gives every straight edge two directional halves. For
example, the upper half of the left edge bends upward-left and its lower half
bends downward-left. The top edge similarly splits left/right, and the other
two edges mirror those directions. This is the intended large-panel Liquid
Glass behavior, not a global vertical bias.

This same-axis variation is distinct from the Chromium cross-axis regressions
above. It is calculated before `generateAxisLensMaps` and remains four-fold
symmetric. Keep it encoded in the independent X/Y textures.

## Edge-dependent axis composition

One full-scale `X → Y` pair is not sufficient for the center-radial field.
The Y pass resamples the already X-displaced result at a vertically shifted
coordinate. Near the top and bottom rims, that coordinate can land in the
flat lens interior where the X map is neutral, erasing the horizontal
tangential component. This is why the left/right split remains visible while
the corresponding top/bottom split disappears.

The order therefore has to follow the edge orientation:

```text
top / bottom: Y → X  (horizontal tangential displacement last)
left / right: X → Y  (vertical tangential displacement last)
```

Both branches use the same two independent axis textures at the full requested
scale. A third CPU-baked PNG is only a compositing mask: its alpha is
`normalY²`, so horizontal rims select `Y → X`, vertical rims select `X → Y`,
and rounded corners blend smoothly between them. It is not a displacement
source and does not combine the X/Y channels.

Mask each finished branch with the complementary edge-order masks, then add
the two premultiplied results. Using `over` here would multiply the partial
corner alpha twice and produce a dark seam.

## Confirmed workaround

Do not apply both axes in one primitive:

```xml
<feDisplacementMap
  in="source"
  in2="displacementMap"
  xChannelSelector="R"
  yChannelSelector="G"
/>
```

Do not derive both axis inputs from one combined `feImage`, even with separate
`feComponentTransfer` or `feColorMatrix` primitives. Instead:

1. Calculate the combined optical field once on the CPU.
2. Split it into two independent pixel buffers:
   - X texture: original R, neutral G, original B/specular, opaque A.
   - Y texture: neutral R, original G, neutral B, opaque A.
3. Encode and cache the two displacement PNGs independently with
   `generateAxisLensMaps`; also encode the non-displacement edge-order mask.
4. Load them through two distinct `feImage` primitives.
5. Produce `xDisplacementMap` by bias-correcting R (PNG mid `128/255` → exact
   `0.5`) and forcing G to exactly `0.5`.
6. Produce `yDisplacementMap` by forcing R to exactly `0.5` and bias-correcting
   G the same way.
7. Build a top/bottom branch with full-scale Y-only then X-only passes.
8. Build a left/right branch with full-scale X-only then Y-only passes.
9. Mask the branches by edge orientation and add their complementary results.

The exact `0.5` mid is produced with `feComponentTransfer`. Do not substitute
an 8-bit neutral PNG channel: `128 / 255` is close to, but not exactly, `0.5`.
Unused axes use `slope="0" intercept="0.5"`. Active axes use
`slope="1" intercept={0.5 − 128/255}` so a flat encoded mid produces zero
displacement — otherwise chromatic scale differentials turn that residual into
flat-field color fringing.

The X texture intentionally retains B so the specular filter can reuse it.
Sharing the CPU calculation is safe. Sharing the encoded displacement texture
or `feImage` node between axes is not. The third PNG is only an alpha mask and
is safe to share across the two order branches.

Each chromatic refraction branch (red, green, and blue) must retain both
opposite-order axis branches and use its channel's full scale consistently
across all four displacement primitives.

## 8-bit displacement range normalization

`feDisplacementMap` reads an 8-bit PNG channel, so one pass can represent only
256 displacement values. The optical field's peak includes the Snell factor
`refrPow = 1 - 1/ior` (at most `0.6` for the current curvature mapping); writing
that value directly into R/G wastes the rest of the channel range and makes
large-surface quantization bands wider than necessary.

The encoder therefore divides `refrPow` out of R/G only, and
`refractionBackdropScale` requires the same factor and multiplies it back into
every SVG displacement scale. Their product—and therefore the intended optical
displacement—stays unchanged, while the channel code step shrinks by
`refrPow`. Do not normalize the shared optical magnitude used by B/specular,
and do not make the scale parameter optional: changing only one side changes
the material's refraction strength.

## Cost of one backdrop evaluation

Chromium re-evaluates a `backdrop-filter: url(...)` graph whenever the content
it samples moves. On the landing hero, five panels overlap by roughly 72% each,
so their backdrops form a chain: every panel refracts the already-filtered
output of the ones behind it, and moving any panel invalidates every panel in
front of it. Frozen, that chain composites once and costs nothing measurable;
animated, it is the dominant cost on the first screen.

What one evaluation costs tracks the displacement map's own pixel count far
more than the filter region, because each `feImage` source is resampled per
evaluation. Measured on that hero stack with all five panels driven at refresh
rate:

```text
map 360x408 (147k px)  ~30 fps
map 282x320 ( 90k px)  ~45 fps
map 240x274 ( 66k px)   60 fps
```

`mapMaxPixels` in `engine.json` therefore caps the map's *area*, not its long
edge. Capping the long edge would crush the short edge of a wide, short surface
such as a navigation bar; an area budget leaves those untouched, since they are
already cheap, and only downsamples large square-ish panels where the bevel
occupies a small fraction of the bitmap. A frozen side-by-side of the hero at
the full-resolution map versus the capped one put fewer than 0.1% of pixels
more than 8/255 apart.

This is a sampling-density knob, not a change to the graph: the number of
displacement passes, their order, and the axis isolation above are unaffected.
One-shot bakes that want full resolution regardless of per-frame cost (the
settled `GlassShellBackdrop` bake) pass `Infinity` to opt out.

Skipping work is cheaper than shrinking it. A surface with `pointerHighlight`
disabled omits the saturate/brightness/mask/composite chain from its backdrop
graph entirely: with a 0x0 mask that chain is an identity, but Chromium still
rasterizes it over the whole filter region on every evaluation.

## Investigation history

The following controlled changes produced no visual change and therefore did
not resolve the bug:

1. Replacing a square displacement bitmap stretched to the element with an
   aspect-correct bitmap generated at the target proportions.
2. Making the displacement texture fully opaque while retaining neutral RGB
   outside the lens.
3. Separating R/G displacement and B specular data into independent PNGs and
   independent `feImage` primitives.

Splitting X and Y into sequential displacement primitives removed the GPU
artifact. The edge-dependent composition still uses only isolated-axis
primitives; it does not reintroduce a combined dual-axis primitive.

## Newer Chrome shared-source regression

Four controlled experiments produced no visual change and were reverted:

1. Disabling Skia Graphite, so the problem is not isolated to that backend.
2. Replacing the two `feComponentTransfer` axis maps with explicit
   `feColorMatrix` outputs and using neutral B as the inactive selector. This
   rules out that particular component-transfer or R/G-selector combination.
3. Expanding the SVG filter region by the measured map extent in addition to
   blur padding, ruling out hard clipping of the two displacement passes.
4. Extending the raw displacement image over that larger region with an opaque
   50% gray neutral field, ruling out transparent-black samples outside the
   image box. The extra padding and neutral extension were both reverted.

The fix was to bake independent X-only and Y-only bitmaps from one CPU map
calculation and feed them through distinct `feImage` nodes into the confirmed
axis-isolated passes. This removed the left-up/right-down artifact without
changing the current `navigation.scale = 1.465` material preset.

The exact internal Chromium fault is not proven, but the controlled result
isolates it to sharing the combined R/G encoded texture or its filter-graph
source between the two axis paths—not the CPU field, Graphite specifically,
filter bounds, or the intended refraction strength.

## Regression check

The pixel test in
`registry/liquid-glass/refraction/lens-map.test.ts` protects the encoded
channel split, opacity, B/specular preservation, source-buffer immutability,
four-edge center-radial directions, and the mirrored edge-order mask.

Any proposed filter simplification must also be checked by the user on an
affected Chromium configuration with high-contrast background content crossing
all four glass edges. Compare both top/bottom and left/right directions. A
successful build, expected CPU pixels, or automated non-visual tests cannot
detect this GPU rendering bug.
