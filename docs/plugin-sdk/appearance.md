# Opt-in Orion appearance · v1

UI packages can opt into Orion's live, read-only appearance layer without adding permissions or changing package lifecycle:

```html
<body data-orion-appearance="v1" data-orion-skin="standard">
  <section data-orion-ui="panel">
    <h1 data-orion-ui="title">Your app</h1>
    <button data-orion-ui="button">Continue</button>
  </section>
</body>
```

Known skins: `standard` (explicit `data-orion-ui` roles only) and `2048` (owned mapping for the reviewed 4×4 adapter). Unknown skins, missing/version-mismatched markers and background entrypoints do not opt in. This is not a universal website normalizer. Existing packages are not silently restyled.

## Host-managed choice

New explicitly opted-in documents default to **Orion**. The visible host controls offer **Original**, restoring the retained document styles in place. Choices save under versioned host `app_state` key `plugins.appearance`, not inside package bytes or plugin/game storage. Saves acknowledge before publishing; failed/unknown hydration blocks writes, failed saves preserve previous choices, and capacity errors never evict entries. Preferences are bounded to 256 identities, including canonical scoped package IDs. Removing/rolling back code does not erase these preferences or rewind private data.

Theme/mode changes never regenerate the iframe URL, session or document. No new broker methods, workspace grants, tool authority or runtime activation are introduced.

## Read-only SDK data

Only opted-in UI gets optional `window.orion.appearance`:

```js
const current = window.orion.appearance?.get();
const unsubscribe = window.orion.appearance?.subscribe(next => {
  // Optional app-local rendering; the owned style kit updates automatically.
});
```

`get()`/subscriber values are detached copies. At most 32 subscribers; unsubscribe when no longer needed. Snapshot v1 contains a monotonic revision, `orion|original` mode, light/dark scheme, solid/glass material, reduction flags, eleven bounded color values and three finite 0–28px radii. No theme names, arbitrary CSS, fonts supplied by the app, DOM handles, credentials or renderer-store access. Packets pass host→opaque guard→content with source/session/protocol checks; malformed, stale or foreign updates are ignored. Disabled, quarantined, changing or replaced package frames receive no updates.

Colors resolve the existing workstation/root tokens; `accent` follows the host cyan/info token. Known 2048 domain colors keep their warm value progression, not host warning/selection semantics. Fonts use the existing licensed Space Grotesk/JetBrains Mono assets embedded as data WOFF2. Normal distribution notice gates still apply. CSP remains data-font-only, no network connections, and `allow-scripts` without same-origin access. No parent wallpaper access: glass treatment is local to the opaque document, with solid fallbacks and positive capability checks.

## Coverage and limits

- Standard roles: panel, toolbar, title, muted, input, button. Document/canvas/chart/SVG contents are not blanket-restyled.
- 2048: title/scores, controls, board/grid/tile positions, readable levels, game overlays, storage feedback and licence disclosure; height/width-aware board, unchanged source logic and original CSS/fonts/notices. Warning feedback overlays rather than moving the active board. CSS motion reduction does not change game state.
- Original restores the source styling, not a different app/session. Author scripts can still manage their own UI; the appearance layer is not a security boundary or guarantee of compatibility.
- No additional save deadline, cancellation/retraction, dirty-close protection, crash journal or data migration is implied.

## Verification status · 2026-10-01

Focused schema/client/document/lifetime/persistence tests and TypeScript pass; a separately minified serialized client passes an owned DOM check. The trusted static study at `examples/plugins/appearance-study/index.html` checks four built-in themes, a validated synthetic custom palette, reductions, Original and 280×480/320×360 layouts with loaded local fonts, aligned cells/tiles and unchanged frame/document identity. No game engine or native broker runs in this study; its Original reference CSS is illustrative, not upstream visual acceptance. Browser screenshot capture timed out, including the owner-requested retry. Final pinned-CSS inspection added grid/clearfix resets and compact win/loss overlay layout. Subsequent [isolated actual-game native checks](../architecture/capability-importer-appearance-native-acceptance.md) exposed and corrected WebKit percentage-grid/min-content stretch with an absolute inset grid and mapped border-box controls/body. Native board396×396; built-in themes, Original and transparency preserve exact game bytes with no additional SDK calls. New Game/save, Original restart and disabled cold restart passed. Native custom/narrow/all tile/overlays/focus/notice expansion and owner visual sign-off remain pending; native frame IDs were not directly instrumented.

The separately named private 2048 appearance candidate was reviewed/installed disabled and explicitly run only in fresh Appearance Proof, then disabled; app closed. Five successful game SDK calls total, no gameplay keys/provider send/new faults. This does not implement E1 repository→candidate preparation. Existing original/QA code and stored gameplay, old proof and production remain untouched.
