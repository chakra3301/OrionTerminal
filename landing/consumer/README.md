# Orion Terminal marketing website — concept 26

A crisp, responsive implementation of the approved ice-white THINK. MAKE. CONNECT. design. This folder updates only the marketing website at `/Users/lucaorion/Orion_Terminal/landing/consumer`; the app source and original `landing/index.html` are separate.

## Local preview

The existing preview remains **http://127.0.0.1:4319/consumer/** after copying the checked files into the marketing folder. The saved working copy is also served at **http://127.0.0.1:4320/** during this session.

To start a preview later:

```sh
python3 -m http.server 4320 --bind 127.0.0.1 --directory /absolute/path/to/this/folder
```

No packages need installation. HTML, CSS and browser JavaScript are the complete runtime.

```sh
npm run check
npm run build
```

The build writes a self-contained static website to `dist/`. There is no TypeScript compiler or application bundler in this stack. No production deployment, DNS change or publishing action is included.

## What changed and why

The previous site enlarged an 858px mockup's decorative crops and 551px app windows. Its entrance animation also temporarily scaled the image layer. The new page keeps headings, paragraphs, navigation, buttons and borders as semantic HTML/CSS, with no scaling/filtering on text. Sharp Tektur headings replace the condensed display font. `sharp.css` contains the concept-26 corrections after the preserved base styles.

- Hero artwork: newly recreated **1672 × 941**, text-free, faithfully based on the approved sphere/Rosie/ice illustration.
- Closing artwork: newly recreated **2120 × 742**, text-free Rosie scene.
- App captures: authentic **2048px** images from the owner's original source used in the earlier Orion video project, rather than fabricated app-window mockups. Clicking a preview opens its full-resolution capture.
- Workflow strip: real captures, CSS perspective and a vector green/cyan/magenta ribbon.
- Responsive phone layout, native dialogs, mobile menu and optional night mode retained.
- Primary download points to the existing public Apple Silicon alpha, `v0.1.0-alpha.1`. GitHub's release API confirmed `Orion-Terminal_aarch64.dmg` and **55,767,670 bytes** on this task. Current development captures are labeled; they do not establish public-alpha feature parity.

## Assets and provenance

Approved reference pixels were inspected from the existing site's recorded source: `/Users/lucaorion/Downloads/4171a783-749b-4f53-91c6-237d1ae57742.png` (858 × 1832, 2,008,317 bytes), matching concept-26 metadata. Library transfer failed after one retry; no security bypass or guessed storage route was used.

New decorative images used the built-in imagegen tool. See `asset-prompts.md` for their input, prompt set and original output paths. Their delivered resolution is recorded above; no full-page screenshot was upscaled into the website. Hero imagery is a raster illustration, so at extreme display density it is bounded by its intrinsic resolution. Typography and page chrome remain resolution-independent.

The real product mark is the existing repository asset. Original concept app marks are preserved. Tektur comes from Google's official `google/fonts` repository under SIL OFL; Space Grotesk, JetBrains Mono and Lucide remain self-hosted with their original licenses. Original concept-derived crops and `prepare-assets.py` remain as legacy assets; the current page uses the new `*-art.webp` and `*-capture.webp` files.

## Verification

- `npm run check`: JavaScript syntax plus 10 static checks and 3 motion behavior tests passed.
- `npm run build`: complete static output and local references verified.
- Actual local Chrome browser on this Mac: desktop and phone visually inspected; navigation and scrolling checked.
- Widths 360, 390, 700, 900, 1024, 1370 and 1920px: no horizontal overflow, heading clipping, navigation overflow or broken loaded image.
- All three app dialogs, app → download handoff, Escape, opener focus restoration, 10 consecutive Tab actions inside the download dialog, and phone menu checked.
- Final screenshots and browser QA evidence are saved in the task workspace's sibling `qa/` directory.

The existing `check-browser.mjs` is the prior Ego-specific test harness; it is retained for provenance and was not used to claim this task's Chrome checks. Safari/VoiceOver and public deployment are outside this local verification.

## Motion pass

`motion.css` and `motion.js` add a restrained 5px artwork drift, device-pixel-rounded hero scroll/pointer depth, a slow ice highlight, a 2px floating navigation mark, staggered app-preview entrances and a traveling pulse along the workflow ribbon. Preview borders, arrows and buttons respond to hover and keyboard focus. Headings and body copy never scale, blur or animate. Content is fully visible before JavaScript; previews already in view are not hidden for an entrance.

IntersectionObserver pauses ambient motion offscreen, and visibility changes pause CSS animation and cancel pending depth work. JavaScript schedules a single frame only in response to input, resize or visibility events, with no timer or continuously running render loop. Mobile uses smaller preview offsets. System reduced-motion preferences disable motion, and the footer's **Reduce motion** control lets visitors choose a static view even if their system preference is unset; a system reduction cannot be overridden by that control.

Local Chrome QA captured eight timed hero frames and eight flow frames. Artwork positions and the ribbon pulse change while heading bounds remain identical. App previews were observed entering with staggered opacity/translation and resolving to full visibility. All seven responsive widths still pass; phone navigation, preview dialogs, download handoff and Escape pass. Desktop and phone reduced-motion views were checked through the footer control. System preference changes and hidden-tab cancellation pass isolated controller tests; native Chrome foreground changes prevented reliable DevTools media emulation and an actual background-tab check. See the task's `qa/motion-checks.json` and timed-frame video for the scope and evidence.
