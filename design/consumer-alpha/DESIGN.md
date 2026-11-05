# Design — Orion / Sharp Reference 31

Status: SCRAPPED / archived — Chakra rejected this implementation on 2026-10-11. Do not continue, publish, or treat this as approved design. Existing files are retained for history only.

## Direction and approval
The supplied `a52c85e8-1684-4dc5-ad71-5ce970792c9f.png` remains the composition target, not loose inspiration. User approved: "Match the reference’s illustrated panels for this visual prototype; don’t present them as actual app screenshots."

Latest correction: "its so blurry, remember you have image generation with gpt image". The 827px reference is now a private composition guide, not the live artwork source.

Primary: Signal / Print. Borrow Liquid / Machine's reflective geometry: luminous halftone identity, cobalt/chrome hero, paper utility strips, dense botanical/celestial/pink editorial panels and dark-to-mirrored-sky finale. The reference's large cobalt field and three artwork accents take precedence over the taste skill's inferred accent budget.

## Composition
- Keep reference-derived 827:438 hero proportions, independently composited satellites, selectable H1/CTA/subline and a tight wide hero panel.
- Main panel: native SVG coordinate canvas 1600×680, matching the approved wide panel ratio. Explorer, art workspace, thumbnails and assistant are vector geometry and text around generated silver-flower artwork.
- Gallery: Archives 1600×424 full-width, Orion 1600×754 and XDesign 1600×872 below in the approved asymmetric columns. Green botanical, blue celestial city and pink-accented portrait artwork remain the visual anchors.
- Finale: 827:586 layout, separate scalable perspective panels, original identity, orbit geometry, generated dark/cobalt mirrored environment, native supplied Rosie cutout and independent art tiles. Labels remain selectable DOM. Rosie is illustrative artwork, not a live rig.
- Paper footer, visible concept disclosure and pause control retained. No extra marketing features, testimonials or invented metrics.

## Sharpness and provenance
- Five genuine GPT Image generation results are saved under `design/refs/gpt-image/`. Model: `gpt-image-2.5-sunburst`, accessed through the authenticated Figma generation tool. No mock or fabricated output.
- Native returned sizes: silver flower 1024×1024; botanical, celestial and environment 1280×960; character 960×1280. These are actual output dimensions, not the requested 2048px sizes. Artwork resolution remains finite; SVG chrome and lettering scale independently.
- `scripts/prepare-gpt-art.py` preserves originals, records prompts/URLs/SHA-256/dimensions and exports optimized artwork.
- `scripts/build-vector-panels.py` builds self-contained SVG panels with actual text, geometry and embedded WebP artwork. Palette/type/radius/line values come from design tokens; native drawing geometry is maintained in the rendering pipeline.
- Original Orion identity comes from the supplied 1048px brand master, with a monochrome material, vector halo/halftone and sharp reference-style wordmark. It is not a replacement AI-generated logo.
- Rosie uses the supplied 1144px illustration. Mountain satellites use a native crop of supplied 1536px artwork; planet/globe satellites are SVG.
- No `/assets/reference31/` image appears in active HTML. Earlier crop assets/manifests remain historical review material only. Never use the full reference as the page image.
- Visible disclosure, alt text and viewer captions identify all concept panels as illustrations, not released-product screenshots. Original development captures remain separately available.

## Type, tokens and motion
Self-hosted Rajdhani for the compact site identity; existing system/monospace copy convention retained. Scalable panel labels use system UI/monospace fonts; the reference-style orb wordmark uses Georgia. Existing copy case remains unchanged.

Page layout, palette, type, spacing, radius and motion values live in `design/tokens.json`; `reference` carries target composition and `illustration` carries vector-panel and compositing parameters. Viewer native-width variable is the SVG's intrinsic 1600-unit width, not an aesthetic token.

Keep bounded fine-pointer springs, CSS orb/scene drift, orbit markers and one-time entrances. Text outside illustrations stays still. Pointer translation and art-card rotation use separate wrappers. Pause, OS reduced motion, hidden/offscreen gating and modal gating remain mandatory. No WebGL, scroll interception or character rig. Mobile stacks the gallery and focuses one scene window.

## References and scope
- `design/refs/concept31-approved-target.png`: approved composition guide.
- `design/refs/gpt-image/manifest.json`: five actual generated source records.
- `design/refs/gpt-image/panels-manifest.json`: scalable panel dimensions/provenance.
- `design/refs/sharp31-*`: current production visual/interaction evidence.
- `/Users/lucaorion/ai/design-refs/FEEDBACK.md`: direct feedback takes precedence.

Local prototype only. Application code is untouched. Before launch: publishing approval for concept imagery, asset-rights review, domain/canonical/legal configuration, current release review and native-device/Safari testing. No live AI or signup backend is included.
