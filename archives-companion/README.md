# Archives Companion

A **native iOS app** for the Archives side of Orion Terminal, plus a small **macOS
menu-bar helper**, that sync **peer-to-peer over MultipeerConnectivity** — no cloud,
no account, no server. Each device keeps its own local database; they reconcile by a
deterministic merge when they're near each other.

The Tauri desktop app is **not modified** — the macOS helper reads/writes the same
`orion.db` out-of-band.

## Layout

```
ArchivesCore/          SwiftPM package, dependency-free, shared by both apps:
  Models.swift           data model mirroring the Archives schema
  SyncPayload.swift      the over-the-wire snapshot format
  MergeEngine.swift      deterministic, commutative merge (the heart)
  MultipeerSync.swift    discovery + transport (peer Wi-Fi/Bluetooth)
  Tests/                 merge-engine unit tests
ArchivesiOS/           native SwiftUI iPhone app
ArchivesSyncHelper/    macOS menu-bar agent
project.yml            xcodegen spec → ArchivesCompanion.xcodeproj
```

## Build

```sh
# regenerate the Xcode project after editing project.yml or adding files
xcodegen generate

# run the merge-engine tests
cd ArchivesCore && swift test

# open in Xcode
open ArchivesCompanion.xcodeproj
```

The generated `ArchivesCompanion.xcodeproj` is disposable — `xcodegen generate`
recreates it from `project.yml`. Don't hand-edit it.

## Before running on a device

- Set your Apple Developer team: `DEVELOPMENT_TEAM` in `project.yml` (or Xcode →
  Signing & Capabilities), then `xcodegen generate`.
- **MultipeerConnectivity needs real hardware** to test properly — the iOS
  simulator can't do peer-to-peer Wi-Fi/Bluetooth reliably. Run the iOS app on an
  iPhone and the helper on the Mac, on the same Wi-Fi, and grant the local-network
  prompt on first launch.
- The Info.plist keys that make Multipeer work (`NSLocalNetworkUsageDescription`,
  `NSBonjourServices`) are already declared in `project.yml`. Without them discovery
  silently never connects.

## Status

- [x] Phase 0 — project scaffold, shared core, **merge engine (tested)**, Multipeer
      transport, app shells that discover + connect.
- [ ] Phase 1 — SQLite store on both ends (phone-local + helper reading `orion.db`),
      wired through `MergeEngine`; asset-file transfer via `sendResource`.
- [ ] Phase 2 — SwiftUI Archives UI (Today / Notes / Journal / Projects / Media /
      Mood) + the WKWebView BlockNote editor for full editing parity.
