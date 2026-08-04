# Orion Plugin SDK v1 — local developer preview

Status: local directory packages; distribution signing and archive installation are not yet enabled.

## Security model

Community code never runs in Orion Terminal's React tree. UI and startup background entrypoints run in `sandbox="allow-scripts"` frames without `allow-same-origin`. Their documents use a network-denied CSP and receive no Tauri, SQLite, Zustand, shell DOM, filesystem, process, provider-key, or raw event access.

The sandbox gets one frozen `window.orion` object. Calls cross a source-bound, versioned `postMessage` channel. The trusted host binds the package identity, and the native broker re-checks installed state and grants on every request.

## Try the sample

1. Run Orion Terminal in Tauri.
2. Open **Control Panel → Plugins**.
3. Choose **Install package**.
4. Select `examples/plugins/hello-orion.orion-plugin`.
5. Review the package identity and requested capabilities.
6. Install it, then open **Hello Orion** from the Dock or Spotlight.

The sample proves namespaced persistence and brokered notifications while showing that Tauri authority is absent.

## Package layout

A developer-preview package is a directory, conventionally ending in `.orion-plugin`:

```text
hello-orion.orion-plugin/
├── orion-plugin.json
└── ui.html
```

Directory packages are copied into Orion's app-data directory after inspection. The host rejects symlinks, special files, traversal, missing entrypoints, unknown authority-bearing manifest fields, more than 512 files, files over 5 MiB, manifests over 64 KiB, and packages over 25 MiB. The package is fingerprinted before permission review and fingerprinted again during installation to prevent review/install substitution.

UI v1 is a single self-contained HTML entrypoint. External scripts, stylesheets, nested frames, object/embed content, meta refresh, and network access are removed or denied. Inline CSS and JavaScript are supported inside the opaque sandbox.

## Manifest

```json
{
  "id": "dev.example.counter",
  "name": "Counter",
  "version": "1.0.0",
  "apiVersion": "1",
  "engines": { "orion": "*" },
  "publisher": "Example developer",
  "entrypoints": { "ui": "ui.html" },
  "activationEvents": ["onApp:counter"],
  "dependencies": {},
  "contributes": {
    "apps": [
      {
        "id": "counter",
        "name": "Counter",
        "description": "A sandboxed counter",
        "accent": "violet",
        "window": { "width": 720, "height": 520 }
      }
    ],
    "commands": [
      { "id": "counter.open", "title": "Open Counter", "app": "counter" }
    ]
  },
  "permissions": ["storage.plugin", "notifications"]
}
```

Unknown manifest, contribution, app, command, entrypoint, and permission fields fail closed. Apps and commands are declarative host contributions; plugin code cannot register shell-owned React components.

## Sandbox API

```js
const host = await window.orion.request("host.getInfo");
const previous = await window.orion.storage.get("counter");
await window.orion.storage.set("counter", Number(previous || 0) + 1);
await window.orion.storage.delete("counter");
await window.orion.notifications.show("Saved", "The counter is durable.");
```

Available broker methods:

| Method | Required permission | Limit |
| --- | --- | --- |
| `host.getInfo` | none | identity and platform only |
| `storage.get` | `storage.plugin` | 256 keys / 1 MiB namespace |
| `storage.set` | `storage.plugin` | 64 KiB request/value |
| `storage.delete` | `storage.plugin` | scoped key only |
| `notifications.show` | `notifications` | 100-char title / 500-char body |

Unknown methods are denied in both the frame bridge and native broker. Broker operations are audit-logged without payloads.

## Lifecycle and recovery

- Disable synchronously removes app, Dock, Spotlight, command, window, UI frame, and startup background frame contributions.
- In-flight privileged requests block disable.
- Package removal retains the plugin's namespaced data.
- Missing, disabled, incompatible, or cyclic dependencies prevent activation.
- Uncaught sandbox errors quarantine the plugin.
- A startup marker detects an incomplete community-plugin boot. The next launch keeps every community package out of the runtime while the kernel, shell, and Plugin Manager remain available.
- **Try again** exits safe mode explicitly.

## Not yet public

Workspace/resource handles, brokered network, clipboard, assets, terminal/Git, AI chat/tools, signed archive packages, publisher verification, update rollback, and marketplace distribution remain disabled until their broker contracts and security tests land. Declaring an unsupported contribution fails installation rather than silently granting authority.
