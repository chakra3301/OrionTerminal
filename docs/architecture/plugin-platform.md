# Orion Terminal plugin platform

Status: P1 internal contribution runtime underway; Plugin API v1 is not yet frozen
Date: 2026-08-04

## Product definition

Orion Terminal is a local-first workstation host. The host supplies a dependable runtime; installed plugins supply the user's working capabilities.

The FL Studio comparison describes the product model, not an audio-specific architecture: a stable host, strong extension points, first-party capability packs, and an ecosystem that users assemble around their work.

## Goals

- Install, enable, disable, update, and remove meaningful capabilities.
- Let first-party and community plugins use the same public contribution model.
- Support full apps and features that augment another app.
- Keep disabled plugins out of startup, UI registries, background work, and AI tool surfaces.
- Make every privileged action explicit, attributable, and revocable.
- Preserve plugin data on ordinary uninstall unless the user separately chooses to delete it.
- Recover from bad plugins without losing access to the workstation.

## Non-goals for Plugin API v1

- Arbitrary third-party Rust, native libraries, or Tauri plugins.
- Direct access to React internals, Zustand stores, the shell DOM, SQLite, or Tauri IPC.
- A public marketplace before local installation, permissions, compatibility, and recovery are proven.
- Turning every button or component into its own plugin.
- Hot-swapping a plugin while it has an unsafe operation in flight. A controlled deactivate/restart path is acceptable where required.

## Host kernel

The following stays built into Orion Terminal:

- Boot, recovery, updater, and safe mode
- Shell, windows, focus, dock, Spotlight, and base navigation
- Plugin discovery, dependency resolution, lifecycle, and rollback
- Contribution registries and command routing
- Permission decisions and the native capability broker
- Namespaced storage and settings infrastructure
- Theme tokens, accessibility, notifications, logs, and error boundaries
- Event/RPC transport
- Minimal Control Panel with Plugin Manager

The kernel can expose extension points but cannot be removed by a plugin.

## Plugin granularity

A plugin is a cohesive capability with an independent lifecycle. Plugins may be grouped into installable packs.

### First-party app plugins

- `@orion/editor`
- `@orion/archives`
- `@orion/xdesign`
- `@orion/hermes`

### First-party feature plugins

Candidate boundaries include Git, Terminal, LSP, autocomplete, inline AI, Archives Brain, Archives Learn, XDesign FX, XDesign Model Studio, Characters, and Spotify.

App shells define stable slots. A feature plugin contributes to a slot without importing the app's private stores.

### Provider plugins

The host owns AI, image, embedding, and future service interfaces. Provider plugins implement those interfaces without receiving unrestricted access to other providers' credentials.

### Content-only plugins

Themes, templates, design systems, exporters, importers, syntax definitions, and AI skill packs should use a lower-risk declarative package where possible.

## Trust tiers

### Kernel

Signed with the application and always available. Smallest possible code surface.

### Built-in trusted plugin

Bundled and signed by Orion. May render React components and call internal compatibility adapters while migration is underway. New built-ins must prefer the public SDK.

### Community sandboxed plugin

Runs outside the shell's JavaScript authority. UI uses an isolated opaque-origin frame and background work uses an isolated worker/runtime. All host access goes through typed RPC and the capability broker.

A community plugin cannot call `invoke`, access `window.__TAURI_INTERNALS__`, import a Zustand store, query the core database, or execute a process directly.

## Manifest draft

```json
{
  "id": "com.orion.git",
  "name": "Git",
  "version": "1.0.0",
  "apiVersion": "1",
  "engines": { "orion": ">=1.0.0 <2" },
  "publisher": "orion",
  "entrypoints": {
    "background": "dist/background.js",
    "ui": "dist/ui/index.html"
  },
  "activationEvents": ["onApp:orion", "onCommand:git.open"],
  "dependencies": { "@orion/editor": ">=1.0.0 <2" },
  "contributes": {
    "commands": [],
    "views": [],
    "settings": [],
    "statusItems": [],
    "fileHandlers": [],
    "aiTools": []
  },
  "permissions": ["workspace.read", "workspace.write", "process.git"]
}
```

The final schema must be JSON-schema validated before any entrypoint is loaded. Unknown permission and contribution keys fail closed.

## Lifecycle

1. **Discover** — read package metadata without executing code.
2. **Validate** — verify schema, signature, compatibility, package limits, and path safety.
3. **Resolve** — resolve required dependencies and detect cycles.
4. **Authorize** — compare requested permissions with stored grants; show changes before update.
5. **Activate** — only on a declared activation event.
6. **Contribute** — every registration is tagged with `pluginId` and collected in one disposable scope.
7. **Deactivate** — cancel work, unregister contributions, release resources, and unmount UI.
8. **Disable/quarantine** — prevent activation on next boot. Repeated startup failures trigger safe mode.
9. **Remove** — remove package files; retain namespaced data unless separately requested.

Activation returns a disposable. The host must be able to dispose everything owned by one plugin even if its own cleanup throws.

## Contribution model

Plugin API v1 should support these registries:

- Apps/windows
- Commands and keybindings
- Dock and Spotlight entries
- Menus and toolbar actions
- Views, panels, tabs, inspectors, and status items
- Settings schemas and settings pages
- File handlers, importers, and exporters
- Context providers
- AI tools
- Notifications and bounded background tasks

Each contribution includes an owner, stable ID, compatibility version, placement constraints, and unregister operation. The host owns layout and may reject invalid placement.

## Native capabilities

Initial permission vocabulary:

- `storage.plugin`
- `workspace.read`
- `workspace.write`
- `workspace.watch`
- `network:<origin>`
- `clipboard.read`
- `clipboard.write`
- `notifications`
- `ai.chat`
- `ai.tools.register`
- `process.git`
- `terminal.send`
- `assets.read`
- `assets.write`

There is no general `filesystem`, `network`, `database`, `secrets`, or `process.spawn` permission in v1. High-risk capabilities require user gestures or per-operation confirmation where practical.

## Data ownership

- Core schema remains append-only.
- Community plugins do not run migrations against `orion.db`.
- Plugin storage is namespaced by plugin ID and quota-controlled.
- Shared records are accessed through typed host services, not SQL.
- Cross-plugin data access requires an explicit exported service and permission.
- Disabling a plugin leaves data intact.
- Removal offers a separate “also delete plugin data” choice.

## AI integration

An enabled plugin may register schema-validated AI tools. The host decides which tools are visible for each conversation and checks permission again at execution time.

Model output is untrusted input. Tool visibility is not authorization. Every tool call must pass through the same capability broker used by human-triggered plugin actions.

## Profiles

Plugin enablement can be global or workspace-profile scoped. Initial profiles:

- Developer
- Knowledge
- Designer
- Full Studio
- Custom

Profiles are sets of desired plugin IDs plus settings overlays. Dependencies are resolved automatically; disabling a required dependency explains the impact before proceeding.

## Migration from the current application

Current hard-coded seams:

- `src/shell/store/useShell.ts`: static `AppId`, names, and default sizes
- `src/shell/Shell.tsx`: static lazy imports, render branching, and title metadata
- Dock, Spotlight, menus, and fullscreen navigation: static app records
- `src/commands/registry.ts`: runtime registration already exists, but contributions lack owner metadata and bulk disposal
- Feature modules: many direct imports of global Zustand stores

Migration rules:

1. Introduce registries and descriptors before moving feature code.
2. Keep existing behavior through built-in descriptors.
3. Add owner/disposable semantics to every registry.
4. Convert one standalone app first; Hermes is the recommended pilot.
5. Add app slots and convert one augmenting feature.
6. Build Plugin Manager and persisted enablement.
7. Only then add the community sandbox and package loader.

## Current implementation

As of 2026-08-03, the first internal-runtime slice is implemented:

- `src/plugins/contracts.ts` defines plugin identity, permission vocabulary, disposable scopes, and activation context.
- `src/plugins/manifest.ts` validates the v1 manifest envelope, rejects unknown top-level/authority fields, validates package-relative entrypoints, and fails closed on unknown permissions.
- `src/plugins/ownerRegistry.ts` provides stable owner-tagged contribution snapshots, duplicate rejection, subscriptions, and owner-wide disposal.
- The command registry tracks owners and supports owner-wide disposal while retaining its existing API.
- Apps are dynamic trusted descriptors consumed by Shell, Dock, Spotlight, MenuBar, fullscreen navigation, persisted-window restore, and open commands.
- Archives, Orion, XDesign, Command Center, and Hermes bootstrap through the same internal app contract. Deactivation removes each migrated plugin's app descriptor, command, Dock/Spotlight surfaces, and open windows.
- `src/plugins/internalEventRegistry.ts` keeps native event listeners kernel-owned while letting trusted built-ins contribute owner-tagged, synchronously disposable handlers. Command Center's schema-validating `cc:event` and `cc:exit` handlers use this contract and disappear before its UI is disabled.
- Archives owns its note commands/hotkeys, global overlays, `open_note` bridge action, RepoLens event handling, tool-result refreshes, data loading, and semantic-index background work. Spotlight, context attachment, proactive companion context, persisted note tabs, and MCP tool schemas/calls all fail closed while Archives is disabled.
- XDesign owns its export/present commands, validated canvas bridge actions, project/design-system loading, canvas and FX persistence, and runtime cleanup for previews, present mode, audio, and video sources. Claude, image/shader generation, recordings, project I/O, FX Assist, and Model Assist block disable while active. XDesign settings, activity, MCP canvas/model tools, and bridge calls fail closed while disabled.
- Orion owns project/workspace hydration, editor commands and hotkeys, validated project/file/terminal/staged-edit bridge actions, inline-edit and Claude event handlers, chat/layout persistence, filesystem and Git watchers, code indexing, autocomplete work, LSP shutdown, and file-tree refreshes. Unsaved buffers, pending AI reviews, active AI work, and owned background operations block disable. Project/file/terminal MCP tools, project recents, editor activity/chats, settings, and context snapshots fail closed while disabled. The live web preview is opaque-origin sandboxed.
- `src/plugins/overlayRegistry.ts` and `src/plugins/internalActionRegistry.ts` extend owner-wide disposal to trusted global UI and host-bridge actions. Community packages do not receive either internal contract directly.
- `src/store/pluginManagerStore.ts` hydrates a versioned `plugins.state` record before persisted windows restore. New built-ins default enabled and unknown disable requests fail closed.
- Control Panel and the legacy Settings surface expose Plugin Manager. Archives, Orion, XDesign, Hermes, and Command Center can be enabled/disabled live; running or data-loss-sensitive work blocks deactivation, and ordinary disable retains plugin data.
- Every first-party app surface now participates in the internal lifecycle. Feature extraction and public SDK boundaries remain P2 work; this does not make private trusted compatibility adapters public plugin APIs.

This is an internal trusted-plugin runtime only. It does not load packages or grant community code React/Tauri authority. A future community app renderer must be an opaque-origin sandbox renderer, not the current `trusted-react` renderer.

## Ranked delivery slices

### P0 — Contract and security baseline

- Maintain this architecture contract and the plugin threat model.
- Resolve critical webview isolation and CSP findings.
- Establish dependency scanning and security gates.
- Define manifest, lifecycle, permissions, package layout, and compatibility policy.

### P1 — Internal contribution runtime

- Owner-aware disposable registry foundation
- Dynamic app descriptors
- Commands, menus, Spotlight, settings, status, and AI-tool contribution ownership
- Built-in plugin bootstrap
- Enable/disable persistence and Plugin Manager
- Archives, Orion, XDesign, Hermes, and Command Center lifecycle pilots

### P2 — First-party modularization

- App extension slots
- Optional feature extraction by capability
- Provider interfaces
- Profiles
- Remove private-store access from public boundaries

### P3 — Local community SDK

- `.orion-plugin` package validation
- Opaque-origin UI sandbox and background runtime
- Typed RPC and capability broker
- Local install, developer mode, sample plugin, diagnostics, and safe mode

### P4 — Distribution hardening

- Signatures, publisher identity, updates, rollback, compatibility tests, and permission diffs

### P5 — Marketplace

- Discovery, upload scanning, moderation, reporting, reviews, and optional commerce

## P0 exit criteria

- Security audit has no unowned Critical item.
- Plugin threat model and API boundaries are approved.
- Manifest and permission schemas have validation tests.
- A registry prototype proves owner-tagged bulk disposal.
- Existing application behavior remains green.
