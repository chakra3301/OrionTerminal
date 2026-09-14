# Core dialog safety and minimum-window checks — 2026-09-13

## Closed defects

- **Cancel + Enter approved a destructive action.** The old confirmation card intercepted every Enter, including Enter on Cancel; an isolated real-browser probe returned `true`. Confirmations now use native modal dialogs, initially focus Cancel and let each button activate itself.
- Prompt/confirmation dialogs now have accessible names/descriptions, native inert backgrounds, Escape cancellation, focus restoration to surviving launchers and bounded scrolling for long messages. Prompt input has a real label or title association. IME commit Enter does not submit prompts or chat messages.
- Competing requests no longer replace unresolved decisions; they decline conservatively. Host unmount settles outstanding promises as cancelled. Delayed close events cannot cancel a replacement request.
- **Native WebKit Tab escaped the last control.** `showModal()` alone kept the background inert but allowed an outer focus-loop stop. Explicit first/last Tab wrapping now covers both directions, with unit/browser tests and a native forward-wrap check.
- All registry shortcuts pause during native dialogs, including background Save. Fullscreen yields to open menus as well as dialogs/Spotlight; menu Escape no longer exits fullscreen.
- File-row context events no longer bubble into the background menu and replace Rename/Delete with New File/Refresh. The newly reachable rename path also refuses known dirty affected buffers or open descendant paths rather than silently stranding edits/tabs. Clean-file rename remains supported; this is not a global writer barrier or directory-tab rebasing implementation.
- The shared chat rail no longer forces a 240px minimum into narrower panels. At ≤320px, the model selector moves to a second header row; name, model, composer and send control remain reachable. Message/new-chat/send/stop controls have explicit names. No model choice, billing route or consent behavior changed.

## Evidence

Final **Orion Terminal Accessibility Proof** SHA256:
`4ec77e337e3f9eedfc30ac7faf41f1ca83e3fe0c5c101445fcb07407a08a3b4e`.

- Full verify: **198 frontend files /1254 tests ·30 Node ·240 Rust passed/1 ignored**, TypeScript/Vite. Final app build, deep-strict ad-hoc signature and packaged MCP smoke pass. Packaged native/adapted notices and8 MPL source archive hashes remain intact.
- Chromium exercised actual isolated React components with final app styles: Cancel+Enter, accessible naming, blocked background shortcuts/focus, Tab boundaries, Escape, prompt submission, exact full-width long-dialog bounds at800×500 and1280×800; shared chat at192/240/360px, named controls and fake local send callbacks. IME composition did not invoke the send callback. These were not live model calls.
- A separate generated schema29 profile and two disposable workspace files supported native checks—no production/Validation profile input or real credential copies. Final PID75125: inspected confirmation with Cancel focused; CmdK blocked; Tab→Delete→Cancel wrapped visibly; Enter cancelled and retained exact file bytes; menu dismissal retained fullscreen. Native800×500 screenshots show the corrected chat header/model selector. Control Panel at800×500 was inspected on the first test build.
- Native clean-file rename preserved exact contents on the preceding pre-Tab build SHA `4edeab6cc00a535d46ec4dcba49f27207b0e4bb9344d937dc550f5ea4d110b34` (same rename code). This evidence retains that attribution; the later replay was not counted when no prompt was visible. Dirty/directory rename refusals have pure-policy tests, not a separate native acceptance claim.
- Final app exited normally. Owned profile/workspace handles closed; generated paths were quarantined intact under `/tmp/orion-release-next/accessibility-native/{profile-final,workspace-final}`. Original synthetic note/opt-ins and both file contents preserved (one filename intentionally renamed). Production, Validation and prior Recovery Proof executable hashes unchanged.

Evidence: `/tmp/orion-release-next/modal-accessibility-{verify-accepted,browser-accepted,package,signature}.log`, `modal-accessibility-mcp.json`, browser reports/screenshots in `modal-accessibility/`, and native `accessibility-native/result.json` plus screenshots. The first minimal-style browser probe, intermediate Tab failure, refused foreground actions and unsuccessful menu probes remain recorded. Batched mouse automation was corrected to move the pointer before button events; failed/no-dialog probes were not treated as successful interactions. The generated-profile launch helper refuses missing/quarantined data.

## Still not claimed

Not a full VoiceOver/keyboard-tree/menu/theme-contrast or all-surface accessibility certification. Other supported-workflow/source/provenance review and the documented clean-machine/remote-CI requirements remain. GitHub login was rechecked and is still absent. No new DMG, production replacement, paid model request, commit, push or release approval.
