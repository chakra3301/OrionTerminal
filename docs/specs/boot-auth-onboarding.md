# Spec — Boot, Auth & Onboarding

Status: **approved, not yet built** (planned 2026-06-26). Hand-off spec for a build session.
Owner decisions are locked below — do not re-litigate; implement.

## Goal

Add a polished launch experience in front of the existing boot path:
1. Chaotic 3D energy-core splash/launch animation.
2. Basic local username + password sign-in (soft lock).
3. First-run account setup.
4. First-run walkthrough + always-available in-app Help/docs.

**Hard rule: never erase or migrate existing user data.** All new state lives in
the `app_state` key-value table. No schema migration (append-only rule untouched).

## Boot order

`src/main.tsx` → `src/app/App.tsx` → **[Splash]** → **[auth gate / first-run setup]**
→ `hydrate()` → `<Shell/>` → **[walkthrough coachmarks, first run only]**.

The current `"starting…"` placeholder in `App.tsx` (the `!hydrated` branch) is the
splash seam — replace it.

## 1. Splash / launch animation (chaotic 3D energy core)

- Built with R3F — already in the stack (`three`, `@react-three/fiber`,
  `@react-three/drei`). **No new deps.**
- Scene: **wireframe energy core** — geodesic/icosahedron sphere with simplex-noise
  vertex displacement so it churns chaotically; a second offset wireframe shell;
  plus a **matrix particle field** (points streaming inward) for the "matrizz
  chaotic" feel. Bloom glow.
- **Launch = chaotic assembly:** particles scatter in from the edges and violently
  collapse/snap into the core; core spikes/distorts at the peak, then settles into a
  slow hover.
- **Color: red.** Token palette tops out at `--neon-magenta #ff3ea5`, so the core
  color is splash-local: ramp magenta → red → white-hot at the chaotic peak, settling
  to a deep energy red at idle. Keep violet/green only as faint rim accents if needed.
- Minimum display ~1.2s (never just flash); cross-fade to the next surface.
- **Only on cold starts.** Skip the splash when unlocking a remembered session.

## 2. Auth gate (soft lock)

- The **same energy core keeps hovering behind the login** (calmer idle than the
  launch burst — lower particle count, gentle rotation).
- Username + password card; glass panel; neon focus ring.
- Password stored as a salted hash (PBKDF2 via Web Crypto) in `app_state` key
  `auth.user`. **No disk encryption** — this is a privacy/cosmetic gate, not crypto.
  Forgetting the password must NOT cause data loss.
- "Reset password" escape hatch wipes only `auth.user` (and `auth.session`), never
  user data.
- Remember session **7 days**: store a token + expiry in `app_state` key
  `auth.session`. Re-prompt after expiry.

## 3. First-run setup (only when no `auth.user`)

- Create account: username + password + display name. Required fields stop there.
- Accent color / wallpaper / provider keys stay in Settings — do not collect here.

## 4. Walkthrough + docs

- First-run-only **coachmarks** over the real shell: dock → Spotlight (⌘K) → the
  three apps (Archives / Orion / XDesign). Dismissible. Never auto-shows again once
  `app_state.onboarding.completed === true`.
- Always-available **Help** surface: an in-app Markdown viewer window covering what
  each app is and how things work. Reachable via a Spotlight command and a menu item.

## Migration / safety (existing installs)

- A vault that already has data and no `auth.user` **stays unlocked** — do not force
  account creation. Add a Settings toggle "Enable sign-in" that runs setup when the
  user opts in.
- Decision flags, all in `app_state`:
  - `onboarding.completed` (boolean)
  - `auth.user` (`{ username, salt, hash, displayName, createdAt }`)
  - `auth.session` (`{ token, expiresAt }`)
- Absence of `auth.user` + presence of existing data ⇒ unlocked, no gate.

## Perf guardrails

- The R3F core must **unmount/pause once `<Shell/>` mounts** — zero GPU cost during
  normal use.
- Respect `reduce_glass` (existing app_state key) and `prefers-reduced-motion`:
  fall back to a static or low-particle core.
- Keep window drag at 60fps; the splash must not leak rAF loops into the shell session.

## Recovery / lockout safety (lock can never trap the owner)

The gate is cosmetic — losing the password must never cost data. Three layers of
escape, in order of how reachable they are:

1. **Reset button on the lock screen itself.** "Forgot password? Reset (keeps
   your data)" wipes only `auth.user` + `auth.session` and reopens the vault.
   On an install that already has data, reset lands you straight back in
   (unlocked, sign-in simply disabled again). Implemented in
   `src/features/auth/LockScreen.tsx` → `useAuth().resetAuth()`.

2. **Fail-open probe.** Any error while resolving the gate (`authStore.probe`)
   drops you into the **unlocked** vault rather than the lock screen — a gate
   bug can't strand you. See `src/features/auth/authStore.ts`.

3. **Manual DB recovery (last resort).** The credential lives in the
   `app_state` key-value table under the key **`auth.user`** (and the remembered
   session under **`auth.session`**). To clear it by hand, quit the app and run:

   ```sh
   sqlite3 ~/Library/Application\ Support/com.lucaorion.orion-terminal/orion.db \
     "DELETE FROM app_state WHERE key IN ('auth.user','auth.session');"
   ```

   Next launch the vault opens unlocked with **all notes / files / designs
   intact** — only the sign-in credential is removed (no schema change, no data
   table touched). Re-enable sign-in afterward from Settings → Account if you
   want it back.

   > Verified: `src/features/auth/authStore.test.ts` asserts `resetAuth` deletes
   > *only* the two auth keys and leaves the vault-data flag untouched, and that
   > a data-bearing vault returns to `unlocked` after reset.

**Dev bypass (dev only, inert in the bundled .app):** set
`localStorage.setItem('orion.authBypass','1')` (or build with
`VITE_AUTH_BYPASS=1`) to skip the gate while iterating. Guarded by
`import.meta.env.DEV`, so it is statically compiled out of the release build and
never weakens the real auth.

## Out of scope

- Multi-user / profiles (single user only).
- Real database encryption.
- Light theme (dark-only, per project lock).
