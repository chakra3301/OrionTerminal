# Orion Terminal — Performance & Memory Fixes Implementation Plan

> **For the implementing engineer (composer.2.5):** This plan comes from a full performance/memory audit. Every task gives you the **exact** code to find and the **exact** code to replace it with. Do them **in order**. Do **not** improvise, refactor, rename, or "improve" anything beyond what each task says. If a `FIND` block does not match the file exactly, **STOP** and report it — do not guess.

**Goal:** Fix the memory leaks, wasted CPU, re-render churn, and dead code found in the audit **without changing any functionality or visual appearance**.

**Architecture:** The app is Tauri 2 (Rust backend in `src-tauri/`) + React 18 (TypeScript in `src/`). Fixes are independent and grouped into three tiers by risk. You execute Tier 1 freely, Tier 2 one-at-a-time, and Tier 3 only with a human watching.

**Tech Stack:** Tauri 2, React 18, TypeScript, Zustand, Monaco, xterm.js, fuse.js, Vite, Vitest, portable-pty (Rust).

---

## Global Constraints (apply to EVERY task)

- **Do NOT change any visual output, CSS, design tokens, colors, copy, or layout.** These are performance fixes only.
- **Do NOT rename** any component, function, variable, file, or type.
- **Do NOT refactor** code you were not told to touch. Smallest possible diff per task.
- **Do NOT add dependencies.** Everything uses libraries already in `package.json` / `Cargo.toml`.
- **Match the surrounding code style** (2-space indent, double quotes in TS, existing import ordering).
- After each task: run that task's verification. If it fails, **revert that task's changes** and report — do not pile fixes on top.
- One git commit per task, using the commit message given.
- If a `FIND` block is not found verbatim, the file may have drifted. **STOP and report**; never apply a fuzzy match.

---

## Verification Commands (reference)

Run these from the repo root unless told otherwise.

| What | Command | Expected |
|---|---|---|
| TypeScript typecheck | `npx tsc --noEmit` | no errors |
| Unit tests | `npm test` | all pass (baseline is green) |
| Frontend production build | `npm run build` | exit 0 |
| Rust compile check | `cd src-tauri && cargo check` | no errors (1 pre-existing `pick_thumbnail` warning is OK) |
| Rust unit tests | `cd src-tauri && cargo test` | all pass |

**Before you start:** run `npx tsc --noEmit` and `npm test` once to confirm the baseline is green. If it is not green before you change anything, STOP and report — you need a clean baseline to detect regressions.

> **Rust note:** Tier 3 Rust changes (`src-tauri/`) cannot be runtime-verified by you — they require the user to restart `tauri dev`. Your job there is: code compiles (`cargo check`), tests pass (`cargo test`), and the diff matches the plan. The user does the live smoke test.

---

# TIER 1 — SAFE MECHANICAL FIXES

**Risk: None / Low.** These are pure deletions, memoization, and a child-component extraction. Behavior is provably identical. Do all of Tier 1, then run the full verification suite once at the end of the tier.

---

### Task 1: Delete the dead `NotesTree.tsx` + `cn.ts` chain

**Why:** `NotesTree.tsx` is imported nowhere. It is the *only* importer of `src/lib/cn.ts`. Both are dead.

**Files:**
- Delete: `src/features/notes/NotesTree.tsx`
- Delete: `src/lib/cn.ts`

- [ ] **Step 1: Confirm both are truly unused.**

Run:
```bash
cd /Users/lucaorion/Orion_Terminal
grep -rn "NotesTree" src --include="*.ts" --include="*.tsx"
grep -rn "lib/cn" src --include="*.ts" --include="*.tsx"
```
Expected: `NotesTree` appears ONLY inside `src/features/notes/NotesTree.tsx` itself. `lib/cn` appears ONLY in `src/features/notes/NotesTree.tsx` (line 10). If either appears in any OTHER file, **STOP** — they are not dead; skip this task and report.

- [ ] **Step 2: Delete both files.**

```bash
rm src/features/notes/NotesTree.tsx
rm src/lib/cn.ts
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors (nothing imported them).

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "chore(perf): remove dead NotesTree + cn.ts (no importers)"
```

---

### Task 2: Memoize `MessageBody` so old messages don't re-parse markdown each streaming tick

**Why:** During a streaming reply, `ClaudeChat` re-renders frequently and re-runs `ReactMarkdown` (+ syntax highlighting) for **every** message including unchanged ones. Wrapping `MessageBody` in `React.memo` skips re-parsing messages whose `content` did not change.

**Files:**
- Modify: `src/components/ClaudeChat.tsx`

- [ ] **Step 1: Add `memo` to the React import.**

FIND (line 1):
```ts
import { useEffect, useRef, useState, type ReactNode } from "react";
```
REPLACE WITH:
```ts
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
```

- [ ] **Step 2: Wrap `MessageBody` in `memo`.**

FIND (around lines 126-136):
```tsx
function MessageBody({ content }: { content: ReactNode | string }) {
  if (typeof content !== "string") return <>{content}</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  );
}
```
REPLACE WITH:
```tsx
const MessageBody = memo(function MessageBody({
  content,
}: {
  content: ReactNode | string;
}) {
  if (typeof content !== "string") return <>{content}</>;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  );
});
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors. (`MessageBody` is used as `<MessageBody content={...} />` at two call sites — a `memo`-wrapped component is used identically.)

- [ ] **Step 4: Commit.**

```bash
git add src/components/ClaudeChat.tsx
git commit -m "perf(chat): memoize MessageBody to avoid re-parsing markdown per stream tick"
```

---

### Task 3: Memoize `chatMessages` in XDesign rail (stop re-running strip regex on every token)

**Why:** `chatMessages` maps over all messages and runs two regex/string passes (`stripDesignPlan(stripCanvasCommands(...))`) on **every** render (i.e. every streaming token). The strip functions are pure over `content`, so memoizing on `thread.messages` is safe.

**Files:**
- Modify: `src/apps/xdesign/XDesignClaudeRail.tsx`

- [ ] **Step 1: Add `useMemo` to the React import.**

FIND (line 1):
```ts
import { useEffect, useRef, useState } from "react";
```
REPLACE WITH:
```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 2: Wrap the `chatMessages` mapping in `useMemo`.**

FIND (around lines 291-299):
```tsx
  const chatMessages: ClaudeChatMessage[] = thread.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content:
      m.role === "assistant"
        ? stripDesignPlan(stripCanvasCommands(m.content))
        : m.content,
    pending: m.pending,
  }));
```
REPLACE WITH:
```tsx
  const chatMessages: ClaudeChatMessage[] = useMemo(
    () =>
      thread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content:
          m.role === "assistant"
            ? stripDesignPlan(stripCanvasCommands(m.content))
            : m.content,
        pending: m.pending,
      })),
    [thread.messages],
  );
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/apps/xdesign/XDesignClaudeRail.tsx
git commit -m "perf(xdesign): memoize chatMessages strip pass on thread.messages"
```

---

### Task 4: Replace O(n²) `.find()` lookups with a Map in XDesign culling

**Why:** `visibleShapes` recomputes every pan/zoom frame (above 120 shapes). Inside, it calls `displayShapes.find((x) => x.id === id)` per descendant id — an O(n) scan nested inside the loop, ~O(n²) over the document. A single `Map` lookup makes it O(1).

**Files:**
- Modify: `src/apps/xdesign/Canvas.tsx`

- [ ] **Step 1: Build a `byId` map and use it instead of `.find()`.**

FIND (around lines 297-320):
```tsx
  const visibleShapes = useMemo(() => {
    if (displayShapes.length <= CULL_THRESHOLD || canvasSize.w === 0) return displayShapes;
    const z = viewport.zoom;
    const margin = Math.max(canvasSize.w, canvasSize.h) / z; // ~one screen of slack
    const vis = {
      x: -viewport.x / z - margin,
      y: -viewport.y / z - margin,
      w: canvasSize.w / z + margin * 2,
      h: canvasSize.h / z + margin * 2,
    };
    const intersects = (s: Shape) =>
      s.x < vis.x + vis.w && s.x + s.w > vis.x && s.y < vis.y + vis.h && s.y + s.h > vis.y;
    const keep = new Set<string>();
    for (const s of displayShapes) {
      if (s.parentId) continue; // handled with its top-level ancestor
      const subtree = collectDescendantIds(displayShapes, s.id);
      if (subtree.some((id) => { const d = displayShapes.find((x) => x.id === id); return d && intersects(d); })) {
        for (const id of subtree) keep.add(id);
      }
    }
    // Always keep selected shapes (their handles must render).
    for (const id of selection) keep.add(id);
    return displayShapes.filter((s) => keep.has(s.id));
  }, [displayShapes, canvasSize, viewport, selection]);
```
REPLACE WITH:
```tsx
  const visibleShapes = useMemo(() => {
    if (displayShapes.length <= CULL_THRESHOLD || canvasSize.w === 0) return displayShapes;
    const z = viewport.zoom;
    const margin = Math.max(canvasSize.w, canvasSize.h) / z; // ~one screen of slack
    const vis = {
      x: -viewport.x / z - margin,
      y: -viewport.y / z - margin,
      w: canvasSize.w / z + margin * 2,
      h: canvasSize.h / z + margin * 2,
    };
    const intersects = (s: Shape) =>
      s.x < vis.x + vis.w && s.x + s.w > vis.x && s.y < vis.y + vis.h && s.y + s.h > vis.y;
    const byId = new Map(displayShapes.map((s) => [s.id, s]));
    const keep = new Set<string>();
    for (const s of displayShapes) {
      if (s.parentId) continue; // handled with its top-level ancestor
      const subtree = collectDescendantIds(displayShapes, s.id);
      if (subtree.some((id) => { const d = byId.get(id); return d && intersects(d); })) {
        for (const id of subtree) keep.add(id);
      }
    }
    // Always keep selected shapes (their handles must render).
    for (const id of selection) keep.add(id);
    return displayShapes.filter((s) => keep.has(s.id));
  }, [displayShapes, canvasSize, viewport, selection]);
```

(The only change: added `const byId = new Map(...)` and replaced `displayShapes.find((x) => x.id === id)` with `byId.get(id)`. The result set is identical.)

- [ ] **Step 2: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/apps/xdesign/Canvas.tsx
git commit -m "perf(xdesign): O(1) Map lookup in visibleShapes culling (was O(n^2))"
```

---

### Task 5: Consolidate duplicated `formatRelative` / `relativeTime` / `clamp` helpers

**Why:** `formatRelative` is byte-identical in two files; `relativeTime` is byte-identical in two files; `clamp(v,lo,hi)` is duplicated in two files. Consolidate into one shared module. **The function bodies do not change — only their location.**

> **IMPORTANT:** Do **not** touch `Chats.tsx` — its `relativeTime` is a *different* implementation and must stay where it is. Do **not** touch `clamp01` in `wallpaperStore.ts` or the `clamp` in `repolens/combinator.ts` — those are different functions.

**Files:**
- Create: `src/lib/time.ts`
- Modify: `src/apps/archives/Media.tsx`
- Modify: `src/apps/archives/Notes.tsx`
- Modify: `src/apps/archives/Mood.tsx`
- Modify: `src/apps/archives/Today.tsx`
- Modify: `src/apps/xdesign/XDesignClaudeRail.tsx`
- Modify: `src/features/rosie/avatar/CompanionAvatar.tsx`

- [ ] **Step 1: Create the shared module.**

Create `src/lib/time.ts` with exactly:
```ts
/** Day-granular relative date: "today" / "yesterday" / "Nd ago" / "Mon D". */
export function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** Minute-granular relative time: "just now" / "Nm" / "Nh" / "Nd" / "Mon D". */
export function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Clamp v into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 2: `Media.tsx` — remove the local `formatRelative`, import the shared one.**

FIND (around lines 47-57):
```tsx
function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

```
REPLACE WITH: (empty — delete the whole block including the trailing blank line)

Then add this import alongside the other imports at the top of `Media.tsx` (put it after the last existing `import ... from "@/..."` line):
```ts
import { formatRelative } from "@/lib/time";
```

- [ ] **Step 3: `Notes.tsx` — remove local `formatRelative`, import shared.**

FIND (around lines 17-27):
```tsx
function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

```
REPLACE WITH: (empty — delete the block)

Add near the other imports in `Notes.tsx`:
```ts
import { formatRelative } from "@/lib/time";
```

- [ ] **Step 4: `Mood.tsx` — remove local `relativeTime`, import shared.**

FIND (around lines 740-750):
```tsx
function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}
```
REPLACE WITH: (empty — delete the block)

Add near the other imports in `Mood.tsx`:
```ts
import { relativeTime } from "@/lib/time";
```

- [ ] **Step 5: `Today.tsx` — remove local `relativeTime`, import shared.**

FIND (around lines 539-550) — the SAME function body as Mood's:
```tsx
function relativeTime(then: number, now: number): string {
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}
```
REPLACE WITH: (empty — delete the block)

Add near the other imports in `Today.tsx`:
```ts
import { relativeTime } from "@/lib/time";
```

- [ ] **Step 6: `XDesignClaudeRail.tsx` — remove local `clamp`, import shared.**

FIND (line 37):
```tsx
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
```
REPLACE WITH: (empty — delete the line)

Add near the other imports in `XDesignClaudeRail.tsx`:
```ts
import { clamp } from "@/lib/time";
```

- [ ] **Step 7: `CompanionAvatar.tsx` — remove local `clamp`, import shared.**

FIND (lines 14-15):
```tsx
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
```
REPLACE WITH: (empty — delete the block)

Add near the other imports in `CompanionAvatar.tsx`:
```ts
import { clamp } from "@/lib/time";
```

- [ ] **Step 8: Verify.**

Run:
```bash
npx tsc --noEmit
grep -rn "function formatRelative\|function relativeTime" src/apps/archives/Media.tsx src/apps/archives/Notes.tsx src/apps/archives/Mood.tsx src/apps/archives/Today.tsx
```
Expected: tsc clean. The grep returns nothing (all four local definitions are gone). `Chats.tsx` is untouched.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor(perf): consolidate dup formatRelative/relativeTime/clamp into src/lib/time"
```

---

### Task 6: Build the Spotlight Fuse index once per entry-set, not per keystroke

**Why:** `new Fuse(...)` builds a search index over the whole corpus. It currently sits inside the `visible` memo keyed on `trimmedQuery`, so the index is **rebuilt on every keystroke**. Build it once (memoized on `entries`); only `fuse.search(query)` should run per keystroke. Search results are identical.

**Files:**
- Modify: `src/shell/Spotlight.tsx`

- [ ] **Step 1: Add a `fuse` memo immediately BEFORE the `visible` memo.**

FIND (line 310):
```tsx
  const visible: SpotlightEntry[] = useMemo(() => {
```
REPLACE WITH:
```tsx
  const fuse = useMemo(
    () =>
      new Fuse(
        entries.filter((e) => e.kind !== "archive"),
        {
          keys: [
            { name: "label", weight: 0.7 },
            { name: "hint", weight: 0.3 },
          ],
          threshold: 0.4,
          ignoreLocation: true,
        },
      ),
    [entries],
  );

  const visible: SpotlightEntry[] = useMemo(() => {
```

- [ ] **Step 2: Use the prebuilt `fuse` inside `visible` instead of constructing one.**

FIND (around lines 324-337):
```tsx
    // Archive hits keep their FTS-rank ordering (already scored on the DB
    // side); we mix them with Fuse-ranked everything-else.
    const archives = entries.filter((e) => e.kind === "archive");
    const others = entries.filter((e) => e.kind !== "archive");
    const fused = new Fuse(others, {
      keys: [
        { name: "label", weight: 0.7 },
        { name: "hint", weight: 0.3 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
    });
    const fuseHits = fused.search(trimmedQuery, { limit: 14 }).map((r) => r.item);
    return [...archives, ...fuseHits];
  }, [entries, trimmedQuery, isCommandsOnly]);
```
REPLACE WITH:
```tsx
    // Archive hits keep their FTS-rank ordering (already scored on the DB
    // side); we mix them with Fuse-ranked everything-else.
    const archives = entries.filter((e) => e.kind === "archive");
    const fuseHits = fuse.search(trimmedQuery, { limit: 14 }).map((r) => r.item);
    return [...archives, ...fuseHits];
  }, [entries, trimmedQuery, isCommandsOnly, fuse]);
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors. (Same Fuse options, same query, same `{ limit: 14 }` — identical ranking; the index is just reused instead of rebuilt.)

- [ ] **Step 4: Commit.**

```bash
git add src/shell/Spotlight.tsx
git commit -m "perf(spotlight): build Fuse index once per entry-set, not per keystroke"
```

---

### Task 7: Pause MonitorWidget polling while the OS window is hidden

**Why:** While expanded, MonitorWidget calls `systemStats` every 2s and **spawns a `claude` subprocess** (`claudeLimits`) every 90s — even when the OS window is hidden/minimized. Gate the polls on `document.hidden` and refresh immediately when the window becomes visible again. (This mirrors the pattern `Wallpaper.tsx` already uses.) No visual change.

**Files:**
- Modify: `src/shell/MonitorWidget.tsx`

- [ ] **Step 1: Gate each pull on visibility and add a `visibilitychange` refresh.**

FIND (around lines 64-86):
```tsx
  // Poll only while expanded.
  useEffect(() => {
    if (collapsed || !pos) return;
    let alive = true;
    const pullSys = () =>
      ipc.systemStats().then((s) => alive && setSys(s)).catch(() => undefined);
    const pullUsage = () =>
      ipc.claudeUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    const pullLimits = () =>
      ipc.claudeLimits().then((l) => alive && setLimits(l)).catch(() => undefined);
    pullSys();
    pullUsage();
    pullLimits();
    const a = setInterval(pullSys, SYS_POLL_MS);
    const b = setInterval(pullUsage, USAGE_POLL_MS);
    const c = setInterval(pullLimits, LIMITS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [collapsed, pos]);
```
REPLACE WITH:
```tsx
  // Poll only while expanded AND the OS window is visible (skip work when
  // hidden/minimized — avoids spawning a `claude` subprocess every 90s for
  // nothing).
  useEffect(() => {
    if (collapsed || !pos) return;
    let alive = true;
    const pullSys = () => {
      if (document.hidden) return;
      void ipc.systemStats().then((s) => alive && setSys(s)).catch(() => undefined);
    };
    const pullUsage = () => {
      if (document.hidden) return;
      void ipc.claudeUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    };
    const pullLimits = () => {
      if (document.hidden) return;
      void ipc.claudeLimits().then((l) => alive && setLimits(l)).catch(() => undefined);
    };
    pullSys();
    pullUsage();
    pullLimits();
    const a = setInterval(pullSys, SYS_POLL_MS);
    const b = setInterval(pullUsage, USAGE_POLL_MS);
    const c = setInterval(pullLimits, LIMITS_POLL_MS);
    const onVis = () => {
      if (!document.hidden) {
        pullSys();
        pullUsage();
        pullLimits();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [collapsed, pos]);
```

- [ ] **Step 2: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors. (Intervals still tick, but their bodies no-op while hidden; becoming visible refreshes immediately so the widget is never visibly stale.)

- [ ] **Step 3: Commit.**

```bash
git add src/shell/MonitorWidget.tsx
git commit -m "perf(monitor): pause stats polling (incl. claude subprocess) while window hidden"
```

---

### Task 8: Isolate the Hermes 1-second clock so it stops re-rendering the whole board

**Why:** `HermesApp` calls `useClock()` at the top level, so the entire Hermes app (header + FloorView + BoardView) re-renders **once per second**. The clock display uses no other app state, so moving it into a tiny child component confines the 1Hz re-render to just the clock.

**Files:**
- Modify: `src/apps/hermes/HermesApp.tsx`

- [ ] **Step 1: Add a `HermesClock` child component right after the `useClock` definition.**

FIND (lines 49-61):
```tsx
function useClock(): string {
  const [t, setT] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { hour12: false }),
  );
  useEffect(() => {
    const id = setInterval(
      () => setT(new Date().toLocaleTimeString("en-GB", { hour12: false })),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return t;
}
```
REPLACE WITH:
```tsx
function useClock(): string {
  const [t, setT] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { hour12: false }),
  );
  useEffect(() => {
    const id = setInterval(
      () => setT(new Date().toLocaleTimeString("en-GB", { hour12: false })),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return t;
}

// Confines the 1Hz tick to this node so HermesApp / FloorView / BoardView
// don't re-render every second just to advance the clock.
function HermesClock() {
  const clock = useClock();
  return (
    <>
      {clock} <span>LOCAL</span>
    </>
  );
}
```

- [ ] **Step 2: Remove the top-level `useClock()` call in `HermesApp`.**

FIND (line 71):
```tsx
  const clock = useClock();
```
REPLACE WITH: (empty — delete the line)

- [ ] **Step 3: Render `<HermesClock />` where the clock string was used.**

FIND (around lines 145-147):
```tsx
        <div className="hm-clock mono">
          {clock} <span>LOCAL</span>
        </div>
```
REPLACE WITH:
```tsx
        <div className="hm-clock mono">
          <HermesClock />
        </div>
```

- [ ] **Step 4: Verify.**

Run: `npx tsc --noEmit`
Expected: no errors. The `clock` variable is no longer referenced anywhere in `HermesApp` (only inside `HermesClock`). If tsc reports `clock` is undefined somewhere, you missed a usage — search the file for `clock` and report.

- [ ] **Step 5: Commit.**

```bash
git add src/apps/hermes/HermesApp.tsx
git commit -m "perf(hermes): isolate 1Hz clock into a child so the board stops re-rendering each second"
```

---

### Tier 1 gate — run the FULL suite

- [ ] Run all of:
```bash
npx tsc --noEmit
npm test
npm run build
```
Expected: tsc clean, all tests pass, build exits 0. If anything fails, identify which task caused it (check `git log`), revert just that task, and report. **Do not proceed to Tier 2 until Tier 1 is fully green.**

---

# TIER 2 — CAREFUL FIXES (low risk, do ONE AT A TIME)

**Risk: Low.** These change effect dependency arrays / read-sites. Each is provably equivalent, but because dep-array edits *can* change behavior, do **one task, verify, commit** before starting the next. Do not batch.

---

### Task 9: Stop the Esc-key listener from rebinding every render (Media + Mood)

**Why:** The selection object `sel` is a new object literal every render, so `[sel]` tears down and re-adds the `window` keydown listener on every render while a selection exists. `sel.clear` is `useCallback`-stable and `sel.selected.size` is a primitive, so depending on those is equivalent and rebinds only when the selection count actually changes.

> Verified: `useMultiSelect` returns `clear` wrapped in `useCallback(..., [])` (stable), and the effect body only reads `sel.selected.size` and calls `sel.clear()`. The change is behavior-preserving.

**Files:**
- Modify: `src/apps/archives/Media.tsx`
- Modify: `src/apps/archives/Mood.tsx`

- [ ] **Step 1: `Media.tsx` — narrow the deps.**

FIND (around lines 96-104):
```tsx
  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);
```
REPLACE WITH:
```tsx
  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selected.size, sel.clear]);
```

- [ ] **Step 2: `Mood.tsx` — narrow the deps (identical block).**

FIND (around lines 300-308):
```tsx
  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);
```
REPLACE WITH:
```tsx
  // Esc clears selection.
  useEffect(() => {
    if (sel.selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sel.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selected.size, sel.clear]);
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit && npm test`
Expected: clean. **Manual behavior to re-confirm (user, since you can't run Tauri):** in Archives Media and Mood boards, select items then press Esc → selection clears. This still works because the listener is bound whenever a selection exists.

- [ ] **Step 4: Commit.**

```bash
git add src/apps/archives/Media.tsx src/apps/archives/Mood.tsx
git commit -m "perf(archives): bind Esc-clear listener on selection-size, not every render"
```

---

### Task 10: Read live `ctx` in the InlineEdit content-widget anchor (fixes a latent stale anchor)

**Why:** The Monaco content-widget effect has deps `[active, mountTick]`. Its `getPosition` closure reads `ctx.selStart` (captured). If `ctx` changes while `active` stays true (re-invoking ⌘K on a new selection in the same already-active file), the widget can anchor to the *old* selection. Reading the current `ctx` from the store inside `getPosition` (with the captured `ctx` as fallback) fixes this without changing the effect's run timing.

**Files:**
- Modify: `src/features/inlineEdit/InlineEditSession.tsx`

- [ ] **Step 1: Read the live ctx for the fallback anchor line.**

FIND (around lines 268-278):
```tsx
      getPosition: () => {
        const r = regionRange();
        const line = r ? r.startLineNumber : m.getPositionAt(ctx.selStart).lineNumber;
        return {
          position: { lineNumber: line, column: 1 },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        };
      },
```
REPLACE WITH:
```tsx
      getPosition: () => {
        const r = regionRange();
        const liveCtx = useInlineEditStore.getState().ctx;
        const anchor = liveCtx ? liveCtx.selStart : ctx.selStart;
        const line = r ? r.startLineNumber : m.getPositionAt(anchor).lineNumber;
        return {
          position: { lineNumber: line, column: 1 },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        };
      },
```

(`useInlineEditStore` is already imported and used in this file — e.g. `useInlineEditStore.getState().setError(...)` nearby — so no new import is needed. Confirm it is in scope before editing.)

- [ ] **Step 2: Verify.**

Run: `npx tsc --noEmit && npm test`
Expected: clean. **Manual (user):** ⌘K inline edit still opens the prompt box anchored above the selected line.

- [ ] **Step 3: Commit.**

```bash
git add src/features/inlineEdit/InlineEditSession.tsx
git commit -m "fix(inline-edit): anchor content widget to live ctx, not stale captured ctx"
```

---

### Task 11: Memoize Constellation `simEdges` so the physics loop stops restarting on unrelated renders

**Why:** `simEdges` is rebuilt as a fresh array every render, which gives `startLoop` (a `useCallback` depending on `simEdges`) a new identity every render, which makes the resize-settle effect (depending on `startLoop`) run after every render and re-start the force simulation. Memoizing `simEdges` stabilizes the chain.

> **Note:** This only helps if `storeEdges` keeps a stable reference between renders (it should, coming from the Zustand selector). If `storeEdges` is a fresh array each render, this memo is a harmless no-op. Either way it is safe.

**Files:**
- Modify: `src/apps/archives/learn/Constellation.tsx`

- [ ] **Step 1: Confirm `useMemo` is imported.**

Run:
```bash
grep -n "from \"react\"" src/apps/archives/learn/Constellation.tsx
```
If the import line does **not** include `useMemo`, add it. For example if it reads `import { useCallback, useEffect, useRef, useState } from "react";`, change it to `import { useCallback, useEffect, useMemo, useRef, useState } from "react";` (keep the existing names; just insert `useMemo` alphabetically).

- [ ] **Step 2: Memoize `simEdges`.**

FIND (line 78):
```tsx
  // Sim edges derived from storeEdges
  const simEdges: SimEdge[] = storeEdges.map((e) => ({ from: e.from_node, to: e.to_node }));
```
REPLACE WITH:
```tsx
  // Sim edges derived from storeEdges
  const simEdges = useMemo<SimEdge[]>(
    () => storeEdges.map((e) => ({ from: e.from_node, to: e.to_node })),
    [storeEdges],
  );
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit && npm test`
Expected: clean. **Manual (user):** open Archives → Learn → a topic. The constellation must still animate into place on first load, settle, and re-center when you resize the panel.

- [ ] **Step 4: Commit.**

```bash
git add src/apps/archives/learn/Constellation.tsx
git commit -m "perf(learn): memoize simEdges so the constellation loop stops restarting on idle renders"
```

---

# TIER 3 — REVIEW-REQUIRED FIXES (higher risk — STOP after each)

**Risk: Medium.** These touch process lifecycle, the app run-loop, an RPC cleanup path, and the window render tree. They are correct as written, but a human must review the diff and run the live app (you cannot). **Do each task, run its compile/test verification, commit, then STOP and report to the human before starting the next.** Do not chain these.

---

### Task 12: Kill the PTY child process on `terminal_kill` (real process leak)

**Why:** When a terminal tab closes, `terminal_kill` removes the PTY from the map but never kills the child process. `portable_pty` children are **not** killed on drop. A `claude` TUI launched in a tab can linger as an orphan. Fix: capture a `ChildKiller` handle when spawning and call it in `terminal_kill`.

> Verified against `portable-pty 0.9.0`: `Child: ChildKiller`, and `ChildKiller` provides `fn kill(&mut self)` and `Child` provides `fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync>`. The killer can be moved/stored separately from the child while the waiter thread keeps the child for `wait()`.

**Files:**
- Modify: `src-tauri/src/terminal.rs`

- [ ] **Step 1: Import `ChildKiller`.**

FIND (line 3):
```rust
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
```
REPLACE WITH:
```rust
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
```

- [ ] **Step 2: Add a `killer` field to `PtyHandle`.**

FIND (lines 10-13):
```rust
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}
```
REPLACE WITH:
```rust
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
```

- [ ] **Step 3: Capture the killer at spawn and store it in the handle.**

FIND (lines 96-109):
```rust
    let mut child = pair.slave.spawn_command(builder).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let writer_arc = Arc::new(Mutex::new(writer));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    PTYS.lock().insert(
        pty_id.clone(),
        PtyHandle {
            master: pair.master,
            writer: writer_arc,
        },
    );
```
REPLACE WITH:
```rust
    let mut child = pair.slave.spawn_command(builder).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let killer = child.clone_killer();

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let writer_arc = Arc::new(Mutex::new(writer));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    PTYS.lock().insert(
        pty_id.clone(),
        PtyHandle {
            master: pair.master,
            writer: writer_arc,
            killer,
        },
    );
```

- [ ] **Step 4: Kill the child in `terminal_kill`.**

FIND (lines 246-250):
```rust
#[tauri::command]
pub fn terminal_kill(pty_id: String) -> Result<(), String> {
    PTYS.lock().remove(&pty_id);
    Ok(())
}
```
REPLACE WITH:
```rust
#[tauri::command]
pub fn terminal_kill(pty_id: String) -> Result<(), String> {
    if let Some(mut handle) = PTYS.lock().remove(&pty_id) {
        let _ = handle.killer.kill();
    }
    Ok(())
}
```

> **Why this is race-safe:** only `terminal_kill` calls `kill()`. The reader thread and waiter thread only *remove* the (already-gone) map entry on EOF/exit — those removes become harmless no-ops. There is no double-kill.

- [ ] **Step 5: Verify it compiles and tests pass.**

Run:
```bash
cd src-tauri && cargo check && cargo test
```
Expected: compiles (the pre-existing `pick_thumbnail` warning is fine); the `incomplete_tail_len` tests still pass. If `clone_killer` or `ChildKiller` does not resolve, **STOP and report** — do not invent an alternative.

- [ ] **Step 6: Commit, then STOP.**

```bash
git add src-tauri/src/terminal.rs
git commit -m "fix(terminal): kill PTY child on terminal_kill to stop orphaned shell/claude processes"
```
**STOP. Report to the human.** The user must restart `tauri dev` and confirm: open a terminal tab, run a long process, close the tab → the process is gone (check Activity Monitor). Reopen/close several tabs → no leaked `claude`/shell processes.

---

### Task 13: Add an app-exit cleanup hook that kills all PTY + LSP children

**Why:** `lib.rs` runs the app with no exit handler. On quit, PTY children (no kill-on-drop) and LSP servers can outlive the window. Add a `RunEvent::Exit` hook that drains both registries and kills their children.

**Files:**
- Modify: `src-tauri/src/terminal.rs` (add `kill_all`)
- Modify: `src-tauri/src/lsp.rs` (add `kill_all`)
- Modify: `src-tauri/src/lib.rs` (wire the exit hook)

> Do Task 12 first — this task assumes `PtyHandle` has the `killer` field.

- [ ] **Step 1: `terminal.rs` — add a `kill_all` helper.** Add this function immediately AFTER the `terminal_kill` function (after its closing `}`, before the `#[cfg(test)]` module):

```rust
/// Kill every live PTY child. Called on app exit so no shell/claude session
/// outlives the window.
pub fn kill_all() {
    let mut map = PTYS.lock();
    for (_, mut handle) in map.drain() {
        let _ = handle.killer.kill();
    }
}
```

- [ ] **Step 2: `lsp.rs` — add a `kill_all` helper.** Add this function immediately AFTER the `lsp_stop` function (after its closing `}`, before `fn find_subslice`):

```rust
/// Kill every running language server. Called on app exit. `start_kill` is the
/// non-async SIGKILL trigger on tokio's Child, safe to call from the sync
/// RunEvent handler.
pub fn kill_all() {
    let mut map = SERVERS.lock();
    for (_, mut proc) in map.drain() {
        let _ = proc.child.start_kill();
    }
}
```

- [ ] **Step 3: `lib.rs` — replace the final `.run(...)` with a build + run-with-handler.**

FIND (lines 309-311):
```rust
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
REPLACE WITH:
```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                crate::terminal::kill_all();
                crate::lsp::kill_all();
            }
        });
}
```

- [ ] **Step 4: Verify.**

Run:
```bash
cd src-tauri && cargo check && cargo test
```
Expected: compiles and tests pass. If `start_kill` does not resolve on the LSP `Child`, it means `tokio::process::Child` is not the type — **STOP and report** (do not substitute `.kill()`, which is async and won't work in this sync handler).

- [ ] **Step 5: Commit, then STOP.**

```bash
git add src-tauri/src/terminal.rs src-tauri/src/lsp.rs src-tauri/src/lib.rs
git commit -m "fix(lifecycle): kill all PTY + LSP children on app exit"
```
**STOP. Report to the human.** User restarts `tauri dev`, opens a terminal + a code file (starts LSP), then quits the app → confirm no orphaned `claude`, shell, `typescript-language-server`, `pyright`, or `rust-analyzer` processes remain.

---

### Task 14: Plug the `ui_bridge` PENDING leak with an RAII drop-guard

**Why:** `handle_request` inserts a oneshot sender into `PENDING`. Every error/timeout/success path currently removes it — except if the request future is dropped (TCP connection task aborted) after insert and before the timeout arm runs. That leaks one map slot + sender per abandoned request, unbounded over a long session. A drop-guard removes the entry on **any** exit path.

**Files:**
- Modify: `src-tauri/src/ui_bridge.rs`

- [ ] **Step 1: Add a drop-guard struct.** Add this immediately BEFORE the `async fn handle_request` function (before line 142 `async fn handle_request...`):

```rust
/// Removes a PENDING entry on ANY exit path (including a dropped/aborted
/// request future), so an abandoned request can't leak its slot + sender.
struct PendingGuard(String);
impl Drop for PendingGuard {
    fn drop(&mut self) {
        PENDING.lock().remove(&self.0);
    }
}
```

- [ ] **Step 2: Arm the guard right after the insert.**

FIND (lines 151-153):
```rust
    let request_id = format!("req-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<BridgeResult>();
    PENDING.lock().insert(request_id.clone(), tx);
```
REPLACE WITH:
```rust
    let request_id = format!("req-{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel::<BridgeResult>();
    PENDING.lock().insert(request_id.clone(), tx);
    let _guard = PendingGuard(request_id.clone());
```

> **Why this stays correct:** On the success path, `ui_bridge_respond` already `remove`d the entry to take the sender, so the guard's later `remove` is a no-op. The existing explicit `remove` calls in the error/timeout arms also become no-ops — harmless. The only new behavior is cleanup on the previously-leaking dropped-future path. Leave the existing `remove` lines as they are.

- [ ] **Step 3: Verify.**

Run:
```bash
cd src-tauri && cargo check && cargo test
```
Expected: compiles and tests pass.

- [ ] **Step 4: Commit, then STOP.**

```bash
git add src-tauri/src/ui_bridge.rs
git commit -m "fix(ui-bridge): RAII guard removes PENDING entry on any exit path (plug slow leak)"
```
**STOP. Report to the human.** This path is exercised by out-of-process MCP tool calls (e.g. ROSIE driving the UI). User restarts and confirms MCP-driven UI actions (open app, focus window) still work normally.

---

### Task 15 (OPTIONAL — behavioral, needs explicit human sign-off): Suspend paint for fully-occluded windows

**Why:** Only *minimized* windows unmount. A window fully covered by a maximized window stays mounted and keeps painting/laying out (Monaco, xterm, the XDesign canvas). We can stop its **paint/layout** (not its React tree — pty sessions and editor state must survive) with `content-visibility: hidden` when it is fully occluded by a maximized window.

> **This is the riskiest item and it changes window-management rendering. Do NOT apply it autonomously.** It requires the human to decide and to verify there is no visual regression (a partially-visible window must still render fully). Present this section to the human and only implement if they explicitly approve. Below is the analysis and the *proposed* approach — do not write code until approved.

**Proposed approach (for human review only):**
- In `src/shell/Shell.tsx`, the window list maps `windows` and renders `<WindowFrame>` for each non-minimized window. Compute whether a window is fully covered by a *maximized* window above it (a maximized window fills the canvas, so any window with lower `z` than a maximized window is fully occluded).
- Pass an `occluded` boolean prop into `WindowFrame`, and in `WindowFrame` apply `contentVisibility: "hidden"` (via inline style) to the `.ot-window-body` div **only** when `occluded` is true. This keeps the React subtree mounted (pty/timers/state alive) but skips its layout + paint.
- **Must NOT** unmount the body, change `display`, or alter anything when no maximized window is present (the common multi-window-peeking case must be untouched).

**Risks to verify with eyes on the app:** a window that is only *partially* covered must NEVER get `content-visibility: hidden` (it would visually disappear). Only a window strictly below a *maximized* window qualifies.

- [ ] Present this section to the human. **Implement only on explicit approval**, then have the human smoke-test: maximize one app over others → background apps keep their state (terminal still alive, editor unsaved buffers intact) when restored; un-maximize → everything repaints correctly; partially-overlapping windows always render fully.

---

## Intentionally DEFERRED (audited, decided NOT to auto-fix)

These came up in the audit but are **not** in the task list above, by deliberate decision. Listed so nothing is silently dropped:

1. **Dock magnify `getBoundingClientRect` storm** (`src/shell/Dock.tsx`) — 7 reflows per mouse-move frame while hovering the dock. A correct fix (rAF-coalesce cursor updates + cache tile centers via ResizeObserver) is a non-trivial rewrite of the magnify math with real regression risk to a visual feature. **Deferred** — only worth doing with the human watching the animation. Low severity (only while actively hovering the dock).
2. **Spotlight `entries` memo rebuild on async archive/activity updates** — secondary to Task 6 (which already removes the per-keystroke Fuse rebuild). Splitting static vs query-driven entry slices is a larger refactor for marginal extra gain. **Deferred.**
3. **XDesignClaudeRail persist-effect deps `[thread]`** — narrowing the deps risks a stale-persist bug (missing a field) for negligible gain (the write is already debounced). **Deferred** — not worth the risk on a weaker model.
4. **`languageForPath` computed twice in `Editor.tsx`** — a cheap string-switch; the audit rated it "not required." **Deferred** (zero meaningful impact).
5. **LSP `start` already-exists early-return** can keep a wedged server's stale entry — the app-exit `kill_all` (Task 13) covers the leak on quit; a health-check on the already-exists path is a behavioral change deferred for human review.

---

## Final verification (after all applied tasks)

- [ ] Full frontend suite:
```bash
npx tsc --noEmit
npm test
npm run build
```
Expected: tsc clean, all tests pass, build exits 0.

- [ ] Rust (if Tier 3 was done):
```bash
cd src-tauri && cargo check && cargo test
```
Expected: compiles (pre-existing `pick_thumbnail` warning OK), all tests pass.

- [ ] **Hand back to the human** for the live smoke test of the Tier 3 changes (PTY kill, app-exit cleanup, ui_bridge) and, if approved, Task 15 — none of these can be verified without restarting `tauri dev`.

---

## Self-review checklist (the author ran this)

- **Coverage:** every audit issue is either a numbered task or an explicit "Deferred" entry above. ✅
- **No placeholders:** every code step shows exact `FIND`/`REPLACE` content. ✅
- **Type/name consistency:** `kill_all` (terminal.rs + lsp.rs), `PendingGuard`, `HermesClock`, `byId`, `fuse`, `clamp/formatRelative/relativeTime` (src/lib/time.ts) names are used identically wherever referenced. ✅
- **Risk tiering:** mechanical/None-risk in Tier 1; dep-array/read-site in Tier 2; process/run-loop/render-tree in Tier 3 with STOP gates. ✅
