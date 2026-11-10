# Generative icons and spatial skill orbs

Accepted on Nov 10: “alright thats goo enough fir now lets get those in”. Integrated into `/Users/lucaorion/Orion_Terminal` on `validation/alpha-2026-09-14`, from the `alpha/icon-orb-system` worktree (both based on `45f1b14`). The existing boot/companion documents and log changes were preserved. Changes remain uncommitted; no push, release or installed-app replacement.

## Current implementation

The four approved masks remain the source for Archives, Orion, XDesign and Incubator. Other app IDs generate SVG silhouettes from six related families of tapered rays, curved cuts, petals and orbital loops. The existing dock renderer supplies raised glass, rim light, bloom and pointer response. Community plugin registry/list icons use the generated paths. `glyph.ts` is deterministic, NFC-normalized and safe for arbitrary IDs; it needs no network or custom artwork.

The owner clarified that adding extrusion to a flat mark did not create the desired spatial object. The current orb implementation replaces that approach with procedural three-dimensional structures in `spatialIdentity.ts`:

| Skill/category | Spatial form |
| --- | --- |
| Web Research | Three orbitals on different planes, clustered nucleus, orbiting electrons |
| Cite Sources | Two spherical quotation heads with curved tails at different depths |
| Code Reviewer | Six-axis stellar crystal |
| Summarizer | Triangular bipyramid |
| Data Analyst | Double helix with connecting rungs |
| Note-Taker | Curved petals forming a spatial bloom |
| Motion Director | Nonplanar closed knot |
| Sound Design | Layered waveform with curved depth placement |

Unknown IDs select a seeded form with stable proportions, spacing, orientation, counts and motion phase. Sound and Cite have different structural families even in one colour. This is an identity grammar rather than a guarantee of perceptual uniqueness in an arbitrarily large library. The app icon and orb share the stable ID and visual vocabulary; the orb is no longer a direct extrusion of the SVG.

The owner approved the spatial interiors on Nov 10 and asked for the richer surfaces in five Pinterest references. They then explicitly clarified: “leave rosie the same” / “but for the rest.” Rosie keeps the original renderer in `src/shell/dock/rosieField.ts`. `RosieOrb.tsx` and `orbModel.ts` remain unchanged. The paint fingerprint and original-particle layering tests continue to pass.

Other skill orbs now use `src/identity/particleSurface.ts`: seeded, dense three-dimensional point skins with analytic surface normals, directional shading, recessed folds, selective specular light, chromatic edges and loose grains. Five procedural treatments are derived from the inspected references:

| Spatial form | Surface treatment |
| --- | --- |
| Atom / bloom | Broken iridescent membrane with openings and luminous edges |
| Quotations / knot | Flowing, fraying ribbons with broad gaps |
| Stellar crystal | Rolling folded point surface |
| Triangular prism | Deeply sculpted dust with dark recesses |
| Double helix / waveform | Dense particle current with broken, separately moving particle trails |

The stable identity seed changes fold phase, orientation, point placement and particle response. Continuous deformation changes the silhouette as well as rotating the surface. Near and far point passes surround the approved 3D form. The near material becomes more transparent around the centre to keep the glyph readable. Geometry, colour and alpha are batched rather than issuing a separate styled draw call per grain. Detail ranges from 2,200 points for small skill tiles to 14,000 for the large preview. Skill canvases are capped at 30 updates/second; Rosie keeps its original cadence. This is a procedural interpretation of the observed materials, not a claimed pixel-exact reproduction of all five videos.

`drawSpatialOrb.ts` preserves the approved spatial forms, shaded tubes, faceted surfaces, spherical lighting and selective highlights. Its spatial primitives remain sorted by depth. No WebGL contexts, new dependencies, database changes or skill-instruction changes are needed.

The shared `SkillEmblem` covers the skill library, Agent Forge and editor; imported skill cards also use stable spatial orbs. `ParticleOrb.tsx` retains one shared RAF, reduced-motion freezing with direct pointer feedback, hidden/offscreen suspension, touch gating, theme updates and cleanup. If canvas is unavailable, a generated SVG supplies the static fallback. The preview includes an isolated rotating form next to the complete orb, making its geometry easier to inspect.

Colours remain stable and automatic for new/duplicated/imported skills and plugins without a requested accent. Six starter hues are separated; explicit custom accents are retained. Repeated legacy starter defaults are resolved at render time without database writes. The editor offers an Automatic colour option.

## Review artifact

- Offline file: `/Users/lucaorion/output/orion-alpha/orion-icons-and-orbs.html`.
- Source: `icon-orb-review.html`, `src/identity/preview.tsx`, `src/identity/preview.css`.
- Original Rosie reference, eight selectable spatial skill orbs, isolated form, same-colour/light/motion controls, approved/generated app icons, live identity generator and SVG export.
- Rebuild: `node scripts/export-identity-preview.mjs`.
- Dev server: `./node_modules/.bin/vite --config .identity-vite.config.mjs --configLoader runner`; URL `http://127.0.0.1:1541/icon-orb-review.html`.
- Build/cache output stays outside the checkout, including with shared node_modules.

## Validation

- Main checkout `npm run build`: passed (TypeScript plus the full production Vite build). Dependency browser-externalization and large-chunk warnings were emitted; no build errors. The earlier standalone typecheck also passed.
- Focused Vitest: **57 tests passed in 15 files**. Includes stable/safe SVG and spatial generation, 1,000 distinct app paths, all eight spatial forms, noncoplanar atom orbitals, nucleus/electrons, Sound/Cite separation, changing front/back order, finite projection coordinates, complete reduced-motion freeze, spring recovery, RAF/visibility/theme/unmount handling, stable identity after rename, generated colours, custom accents and existing integration. A paint-output fingerprint independently captured from `45f1b14` verifies that the extracted original dock renderer preserves all 1,785 paint operations at the reference frame. A second check confirms the extracted original layering retains every original particle/link and the same spring states. New surface tests cover deterministic/NFC generation, adaptive detail, animated folded silhouettes, finite unit normals, front/back partitioning, fixed-time projection and independent per-grain spring recovery.
- Standalone production preview build: passed; bundled fonts/assets and license notices.
- Existing jsdom integration tests report unavailable canvas and exercise the SVG fallback; they pass.
- All five supplied references were visually inspected on Nov 10 in the owner’s signed-in Chrome, at their request. The source HTTP preview was reopened in its own Chrome window and its dark desktop view confirmed. Proof: `/Users/lucaorion/output/orion-alpha/identity-surface-preview.png`. The owner subsequently accepted this revision for integration.
- The main checkout’s normal Vite config was used for the integration test run: **57 tests passed across 15 files**.

Reproduce the focused suite:

```sh
./node_modules/.bin/vitest run src/identity src/shell/Dock.test.tsx src/shell/dock/animationLifecycle.test.tsx src/shell/dock/orbModel.test.ts src/shell/dock/rosieField.test.ts src/plugins/communityRuntime.test.ts src/features/controlpanel/SkillEditor.test.tsx src/features/controlpanel/controlPanel.render.test.tsx src/features/intake/InstalledSkillLibrary.test.tsx --config vite.config.ts --cache=false
```

## References and remaining work

All five supplied pin pages were opened and their main moving artwork was viewed in the owner’s Chrome on Nov 10. Observations, distinct from implementation:

| Reference | Observed surface and motion |
| --- | --- |
| [692921092718648796](https://ca.pinterest.com/pin/692921092718648796/) | Translucent, iridescent particle membrane with holes and folded/lifted sections; fine orbital lines surround it. Neutral/white body with spectral highlights at stressed edges. |
| [1054827543956902532 — Blue Motion](https://ca.pinterest.com/pin/1054827543956902532/) | Dense electric-blue particle core with orbiting, broken trails, bright moving knots and strong local bloom. The core and outer paths move separately. |
| [595108538282186465](https://ca.pinterest.com/pin/595108538282186465/) | Cyan-white flowing particle ribbons describe a disrupted spherical volume. Bright edges fray into loose grains and escape above/below; large openings reveal depth. |
| [84583299242749698 — Visual by dannh](https://ca.pinterest.com/pin/84583299242749698/) | Dense sculpted particle mass on a light ground; white/cyan clusters contrast with deep dark folds. Loose points peel from a volumetric, crumpling form. This is not a simple transparent glass shell. |
| [935482153883753166 — Kaito Asai](https://ca.pinterest.com/pin/935482153883753166/) | Fine silver/grey point surface on black, with continuously rolling folds, changing silhouette, directional lighting and dark recessed regions. The particle body dims/dissolves through the clip. |

Shared reference requirements: visibly dense surface detail, real volume and dark recesses, continuously deforming material, concentrated luminous edges or highlights, and independent loose particles/trails. A uniformly sparse shell or a set of clean wire rings does not reproduce these references. Preserve the approved spatial glyphs when deriving any additional treatments. The new skill surfaces implement these material mechanisms; Rosie remains the original. The owner accepted the current visual result for integration; future refinements can build on this version.

Follow-up validation: light/mobile visual review and native WKWebView motion/performance remain unverified. These are recorded for later launch validation; the owner approved integrating the current state. A Node preparation-only measurement averaged 0.58 ms at 2,200 points, 0.83 ms at 3,200 and 3.63 ms at 14,000; these exclude drawing/compositing and are not browser or native FPS claims. No native 60fps or full desktop/Rust gate claim.
