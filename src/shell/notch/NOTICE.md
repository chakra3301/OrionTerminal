# Codenotch-derived notch geometry and motion

This React/CSS implementation adapts measurements, side-notch path construction,
spring parameters, ring proportions, hover grace periods, and accessory placement
from [Codenotch](https://github.com/vinzdg/codenotch), inspected at commit
`9156c615bcd75eb50683f047d733bc39738dd7c3`.

Upstream files: `Sources/DesignSystem/Design.swift`,
`Sources/Notch/{NotchLayout,SideNotchShape,NotchMotion,NotchRootView,NotchWindowController}.swift`,
`Sources/Features/{ProviderRing,SettingsHandle}.swift`, and subscription endpoint,
response-schema, and scoped credential lookup behavior from
`Sources/Providers/{CodexLocalProvider,CodexUsage,ClaudeOAuthProvider,ClaudeCredentials,ClaudeProfile}.swift`.

Copyright (c) 2026 Vinz. Licensed under MIT; the complete grant is retained in
`THIRD_PARTY_LICENSES/Codenotch-MIT.txt` and included in Orion's bundled notices.

Orion adaptations: DOM/SVG clipping rather than SwiftUI paths; sampled CSS spring
curves rather than native animation; React hover/focus state; local persisted
customization; existing Orion CPU/RAM/Claude transcript readings; run-scoped AI
telemetry, enabled/connected-provider filtering, and scrolling for additional
trackers. Provider marks and optical sizing follow the reference; their separate
LobeHub license and asset provenance are documented in `logos/NOTICE.md`.
`src-tauri/src/{subscription_quota,quota_keychain}.rs` adapt read-only Claude/Codex
quota protocols and scoped keychain lookup behavior. They reuse Orion's existing
CLI account scopes, never refresh/write credentials or launch inference, and
require an explicit action before a keychain permission prompt. No upstream
credential files, account data, or native window machinery are imported.
