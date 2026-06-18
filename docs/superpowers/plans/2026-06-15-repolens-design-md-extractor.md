# RepoLens Design MD Extractor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-website "Extract MD" action that uses the subscription `claude` CLI to reverse-engineer a finished clone's design system into a structured `DesignSpec` JSON, rendered as a visual style-guide board in a new "Design MDs" sub-view of the RepoLens Websites tab, exportable to `.md`.

**Architecture:** A new pure TS module (`designSpec.ts`) defines the `DesignSpec` schema, a fail-soft parser (mirrors `parser.ts`), and a markdown serializer. A new Rust command (`repolens_website_extract_design`) gathers size-capped artifacts from the clone project + attaches up to 2 recon screenshots, calls claude once, and persists the JSON to two new columns on `repolens_websites` (migration 0023). The frontend store gains `extractDesign`; the Websites tab gains an inner `Rips | Design MDs` toggle, and `RepoLensDesignMDs.tsx` renders the structured board mirroring `RepoLensReport.tsx`'s `.rl-card` pattern.

**Tech Stack:** Tauri 2 + Rust (rusqlite, tokio), React 19 + TypeScript, Zustand, Vitest, `tauri-plugin-sql` (append-only migrations).

**⚠️ Restart note:** This adds migration 0023 + a new Rust command, so a `tauri dev` restart is required before the user smoke-tests.

**⚠️ Working-tree note:** There are unrelated uncommitted XDesign changes in the working tree (`src/apps/xdesign/*`, `src/styles/tokens.css` may show both XDesign and our edits). **Do NOT stage or commit the XDesign files.** Each commit step below lists exact paths — `git add` only those paths, never `git add -A` / `git add .`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/apps/archives/repolens/designSpec.ts` | **New.** `DesignSpec` types + `parseDesignSpec` (fail-soft) + `designSpecToMarkdown` (pure). |
| `src/apps/archives/repolens/designSpec.test.ts` | **New.** Unit tests for the two pure functions. |
| `src/apps/archives/repolens/repolensWebsitesDb.ts` | **Modify.** Add `design_json` / `design_at` to `WebsiteRipRow`. |
| `src-tauri/migrations/0023_repolens_website_design.sql` | **New.** `ALTER TABLE` adding the two columns. |
| `src-tauri/src/lib.rs` | **Modify.** Register migration 23 + the new command handler. |
| `src-tauri/src/repolens_website.rs` | **Modify.** Add `repolens_website_extract_design` + artifact-gather + screenshot-pick helpers. |
| `src/lib/ipc.ts` | **Modify.** Add `repolensWebsiteExtractDesign` wrapper. |
| `src/apps/archives/repolens/useRepoLensWebsites.ts` | **Modify.** Add `extracting: Set<string>` + `extractDesign`. |
| `src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx` | **Modify.** "Extract MD" button/menu item + inner `rips \| designs` toggle. |
| `src/apps/archives/repolens/RepoLensDesignMDs.tsx` | **New.** Design MDs grid + `DesignSpecBoard` visual render. |
| `src/styles/tokens.css` | **Modify.** Append a `.rl-dm-*` block after the `.rl-web-*` block (~line 12268). |

---

## Task 1: `DesignSpec` types + `parseDesignSpec` (pure, TDD)

**Files:**
- Create: `src/apps/archives/repolens/designSpec.ts`
- Test: `src/apps/archives/repolens/designSpec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/apps/archives/repolens/designSpec.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDesignSpec, designSpecToMarkdown } from "./designSpec";

const sample = JSON.stringify({
  title: "Acme",
  aesthetic: "dark, neon-accented",
  designLanguage: "Bold brutalist grid with neon highlights.",
  colors: [
    { name: "Primary", role: "brand accent", hex: "#39ff88", ramp: ["#eafff3", "#39ff88", "#0a3d22"] },
    { name: "Surface", role: "card background", hex: "#0a1015" },
  ],
  typography: [
    { role: "Display", family: "Space Grotesk", fallback: "sans-serif", sizePx: 48, weight: 700, sample: "Aa", usage: "hero" },
  ],
  spacing: { scale: [4, 8, 12, 16, 24, 40], notes: "container 1200px" },
  components: [
    { name: "Primary Button", description: "Solid neon fill, pill radius.", preview: { kind: "button", fillHex: "#39ff88", textHex: "#03060a", radiusPx: 999 } },
  ],
  motion: "Subtle fade-ins on scroll.",
  responsive: "Single breakpoint at 768px.",
  imagery: "High-contrast product shots.",
  voice: "Confident, terse.",
  rebuildNotes: "Lead with the neon accent on a near-black base.",
});

describe("parseDesignSpec", () => {
  it("parses clean JSON", () => {
    const s = parseDesignSpec(sample);
    expect(s.title).toBe("Acme");
    expect(s.colors).toHaveLength(2);
    expect(s.colors[0]!.hex).toBe("#39ff88");
    expect(s.colors[0]!.ramp).toEqual(["#eafff3", "#39ff88", "#0a3d22"]);
    expect(s.typography[0]!.family).toBe("Space Grotesk");
    expect(s.spacing.scale).toEqual([4, 8, 12, 16, 24, 40]);
    expect(s.components[0]!.preview?.kind).toBe("button");
  });

  it("salvages fenced + prose-wrapped JSON", () => {
    const s = parseDesignSpec("Here you go:\n```json\n" + sample + "\n```\nDone");
    expect(s.title).toBe("Acme");
    expect(s.colors).toHaveLength(2);
  });

  it("coerces missing/junk array fields to []", () => {
    const s = parseDesignSpec(JSON.stringify({ title: "X", colors: "nope", components: 5 }));
    expect(s.title).toBe("X");
    expect(s.colors).toEqual([]);
    expect(s.typography).toEqual([]);
    expect(s.components).toEqual([]);
    expect(s.spacing.scale).toEqual([]);
  });

  it("defaults prose fields to empty strings when absent", () => {
    const s = parseDesignSpec(JSON.stringify({ colors: [] }));
    expect(s.title).toBe("");
    expect(s.aesthetic).toBe("");
    expect(s.designLanguage).toBe("");
    expect(s.motion).toBe("");
    expect(s.rebuildNotes).toBe("");
  });

  it("throws on input with no JSON object", () => {
    expect(() => parseDesignSpec("no json at all")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/designSpec.test.ts`
Expected: FAIL — `Failed to resolve import "./designSpec"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/apps/archives/repolens/designSpec.ts`:

```typescript
export type ColorSwatch = {
  name: string;
  role: string;
  hex: string;
  ramp?: string[];
};

export type TypeSpecimen = {
  role: string;
  family: string;
  fallback?: string;
  sizePx?: number;
  weight?: number;
  sample?: string;
  usage?: string;
};

export type ComponentPreview = {
  kind: "button" | "input" | "badge" | "card" | "other";
  fillHex?: string;
  textHex?: string;
  radiusPx?: number;
};

export type ComponentNote = {
  name: string;
  description: string;
  preview?: ComponentPreview;
};

export type DesignSpec = {
  title: string;
  aesthetic: string;
  designLanguage: string;
  colors: ColorSwatch[];
  typography: TypeSpecimen[];
  spacing: { scale: number[]; notes?: string };
  components: ComponentNote[];
  motion: string;
  responsive: string;
  imagery: string;
  voice: string;
  rebuildNotes: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function normalizeColors(raw: unknown): ColorSwatch[] {
  return arr<any>(raw)
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      name: str(c.name),
      role: str(c.role),
      hex: str(c.hex),
      ...(Array.isArray(c.ramp) ? { ramp: c.ramp.map(str) } : {}),
    }));
}

function normalizeTypography(raw: unknown): TypeSpecimen[] {
  return arr<any>(raw)
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      role: str(t.role),
      family: str(t.family),
      ...(t.fallback != null ? { fallback: str(t.fallback) } : {}),
      ...(typeof t.sizePx === "number" ? { sizePx: t.sizePx } : {}),
      ...(typeof t.weight === "number" ? { weight: t.weight } : {}),
      ...(t.sample != null ? { sample: str(t.sample) } : {}),
      ...(t.usage != null ? { usage: str(t.usage) } : {}),
    }));
}

const PREVIEW_KINDS = new Set(["button", "input", "badge", "card", "other"]);

function normalizeComponents(raw: unknown): ComponentNote[] {
  return arr<any>(raw)
    .filter((c) => c && typeof c === "object")
    .map((c) => {
      const note: ComponentNote = { name: str(c.name), description: str(c.description) };
      const p = c.preview;
      if (p && typeof p === "object") {
        note.preview = {
          kind: PREVIEW_KINDS.has(p.kind) ? p.kind : "other",
          ...(p.fillHex != null ? { fillHex: str(p.fillHex) } : {}),
          ...(p.textHex != null ? { textHex: str(p.textHex) } : {}),
          ...(typeof p.radiusPx === "number" ? { radiusPx: p.radiusPx } : {}),
        };
      }
      return note;
    });
}

export function parseDesignSpec(raw: string): DesignSpec {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in design response");
  text = text.slice(start, end + 1);
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse design response: ${(e as Error).message}`);
  }
  const scale = arr<unknown>(data?.spacing?.scale)
    .map((n) => (typeof n === "number" ? n : Number(n)))
    .filter((n) => Number.isFinite(n)) as number[];
  return {
    title: str(data.title),
    aesthetic: str(data.aesthetic),
    designLanguage: str(data.designLanguage),
    colors: normalizeColors(data.colors),
    typography: normalizeTypography(data.typography),
    spacing: { scale, ...(data?.spacing?.notes != null ? { notes: str(data.spacing.notes) } : {}) },
    components: normalizeComponents(data.components),
    motion: str(data.motion),
    responsive: str(data.responsive),
    imagery: str(data.imagery),
    voice: str(data.voice),
    rebuildNotes: str(data.rebuildNotes),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/designSpec.test.ts`
Expected: PASS (the `designSpecToMarkdown` tests added in Task 2 are not present yet; only the `parseDesignSpec` describe block runs here — but the test file imports `designSpecToMarkdown`, so add a stub now: append `export function designSpecToMarkdown(_s: DesignSpec): string { return ""; }` to `designSpec.ts` so the import resolves. Task 2 replaces the stub.)

- [ ] **Step 5: Run tsc to verify no type errors**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/repolens/designSpec.ts src/apps/archives/repolens/designSpec.test.ts
git commit -m "feat(repolens): DesignSpec schema + fail-soft parseDesignSpec"
```

---

## Task 2: `designSpecToMarkdown` serializer (pure, TDD)

**Files:**
- Modify: `src/apps/archives/repolens/designSpec.ts` (replace the stub)
- Test: `src/apps/archives/repolens/designSpec.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/apps/archives/repolens/designSpec.test.ts` (inside the file, after the `parseDesignSpec` describe):

```typescript
describe("designSpecToMarkdown", () => {
  it("includes the title as an H1 and every color hex", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("# Acme");
    expect(md).toContain("#39ff88");
    expect(md).toContain("#0a1015");
  });

  it("renders typography families and component names", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("Space Grotesk");
    expect(md).toContain("Primary Button");
  });

  it("renders the spacing scale and narrative sections", () => {
    const md = designSpecToMarkdown(parseDesignSpec(sample));
    expect(md).toContain("4, 8, 12, 16, 24, 40");
    expect(md).toContain("## Design Language");
    expect(md).toContain("## Rebuild Notes");
  });

  it("does not throw on an empty/partial spec", () => {
    const md = designSpecToMarkdown(parseDesignSpec(JSON.stringify({ title: "Bare" })));
    expect(md).toContain("# Bare");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/archives/repolens/designSpec.test.ts`
Expected: FAIL — `designSpecToMarkdown` returns `""`, so `toContain("# Acme")` fails.

- [ ] **Step 3: Replace the stub with the real implementation**

In `src/apps/archives/repolens/designSpec.ts`, replace the stub `designSpecToMarkdown` with:

```typescript
export function designSpecToMarkdown(s: DesignSpec): string {
  const out: string[] = [];
  out.push(`# ${s.title || "Design Spec"}`);
  if (s.aesthetic) out.push(`*${s.aesthetic}*`);

  if (s.designLanguage) out.push(`## Design Language\n\n${s.designLanguage}`);

  if (s.colors.length) {
    const rows = s.colors.map(
      (c) => `| ${c.name} | ${c.hex} | ${c.role}${c.ramp?.length ? ` | ${c.ramp.join(", ")}` : " | "} |`,
    );
    out.push(
      ["## Colors", "", "| Name | Hex | Role | Ramp |", "| --- | --- | --- | --- |", ...rows].join("\n"),
    );
  }

  if (s.typography.length) {
    const rows = s.typography.map(
      (t) =>
        `| ${t.role} | ${t.family} | ${t.weight ?? ""} | ${t.sizePx ? `${t.sizePx}px` : ""} | ${t.usage ?? ""} |`,
    );
    out.push(
      ["## Typography", "", "| Role | Family | Weight | Size | Usage |", "| --- | --- | --- | --- | --- |", ...rows].join("\n"),
    );
  }

  if (s.spacing.scale.length || s.spacing.notes) {
    const parts = ["## Spacing", ""];
    if (s.spacing.scale.length) parts.push(`Scale: ${s.spacing.scale.join(", ")}`);
    if (s.spacing.notes) parts.push(`\n${s.spacing.notes}`);
    out.push(parts.join("\n"));
  }

  if (s.components.length) {
    const items = s.components.map((c) => `- **${c.name}** — ${c.description}`);
    out.push(["## Components", "", ...items].join("\n"));
  }

  const narrative: [string, string][] = [
    ["Motion", s.motion],
    ["Responsive", s.responsive],
    ["Imagery", s.imagery],
    ["Voice", s.voice],
    ["Rebuild Notes", s.rebuildNotes],
  ];
  for (const [heading, body] of narrative) {
    if (body) out.push(`## ${heading}\n\n${body}`);
  }

  return out.join("\n\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/archives/repolens/designSpec.test.ts`
Expected: PASS (all `parseDesignSpec` + `designSpecToMarkdown` tests).

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/apps/archives/repolens/designSpec.ts src/apps/archives/repolens/designSpec.test.ts
git commit -m "feat(repolens): designSpecToMarkdown serializer + tests"
```

---

## Task 3: Migration 0023 + `WebsiteRipRow` fields

**Files:**
- Create: `src-tauri/migrations/0023_repolens_website_design.sql`
- Modify: `src-tauri/src/lib.rs:153-158` (add migration 23 after version 22)
- Modify: `src/apps/archives/repolens/repolensWebsitesDb.ts` (row fields)

- [ ] **Step 1: Create the migration file**

Create `src-tauri/migrations/0023_repolens_website_design.sql`:

```sql
ALTER TABLE repolens_websites ADD COLUMN design_json TEXT;
ALTER TABLE repolens_websites ADD COLUMN design_at INTEGER;
```

- [ ] **Step 2: Register the migration in `lib.rs`**

In `src-tauri/src/lib.rs`, immediately after the `version: 22` `Migration { ... }` block (the one closing at line ~158, before the `];`), add:

```rust
        Migration {
            version: 23,
            description: "repolens: per-website design spec (extract MD)",
            sql: include_str!("../migrations/0023_repolens_website_design.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Add the row fields in `repolensWebsitesDb.ts`**

In `src/apps/archives/repolens/repolensWebsitesDb.ts`, add to the `WebsiteRipRow` type (after `model: string;`, before `created_at`):

```typescript
  design_json: string | null;
  design_at: number | null;
```

(`SELECT *` already returns the new columns, so no query changes are needed.)

- [ ] **Step 4: Verify Rust still compiles**

Run: `cd src-tauri && cargo check`
Expected: exit 0 (no warnings about the migration). Then `cd ..`.

- [ ] **Step 5: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/0023_repolens_website_design.sql src-tauri/src/lib.rs src/apps/archives/repolens/repolensWebsitesDb.ts
git commit -m "feat(repolens): migration 0023 — per-website design spec columns"
```

---

## Task 4: Rust `repolens_website_extract_design` command

**Files:**
- Modify: `src-tauri/src/repolens_website.rs` (add command + helpers + a unit test)
- Modify: `src-tauri/src/lib.rs` (register the handler)

**Context:** The DESIGN_PROMPT below inlines the `DesignSpec` shape. Artifacts are read fail-soft and size-capped. Screenshots are attached via the CLI's inline `@<abs-path>` mechanism (same as `claude_oneshot_with_image`). The call reuses `repolens_claude_call`'s envelope approach but runs `cwd = project` (no `--strict-mcp-config` needed; it's a tool-less text call — match `repolens.rs` and pass `--strict-mcp-config` to skip MCP load, since no tools are used).

- [ ] **Step 1: Write the failing unit test for the pure screenshot-pick helper**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/repolens_website.rs`:

```rust
    #[test]
    fn design_screenshots_prefer_desktop_then_mobile_and_exclude_clone() {
        let imgs = vec![
            "comparison.png".to_string(),
            "clone-desktop.png".to_string(),
            "home-mobile.png".to_string(),
            "home-desktop.png".to_string(),
            "notes.md".to_string(),
        ];
        // desktop first, then mobile; clone-* and comparison excluded; .md ignored.
        assert_eq!(
            pick_design_screenshots(&imgs, 2),
            vec!["home-desktop.png".to_string(), "home-mobile.png".to_string()]
        );
        // falls back to any non-clone/non-comparison image when no desktop/mobile.
        let plain = vec!["comparison.png".to_string(), "screenshot.png".to_string()];
        assert_eq!(pick_design_screenshots(&plain, 2), vec!["screenshot.png".to_string()]);
        // cap respected.
        let many = vec![
            "a-desktop.png".to_string(),
            "b-desktop.png".to_string(),
            "c-desktop.png".to_string(),
        ];
        assert_eq!(pick_design_screenshots(&many, 2).len(), 2);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test repolens_website 2>&1 | tail -20; cd ..`
Expected: FAIL — `cannot find function pick_design_screenshots`.

- [ ] **Step 3: Add the helpers + the command**

Add these helpers near the other free functions in `src-tauri/src/repolens_website.rs` (e.g. after `earliest_new_image`):

```rust
/// Pick up to `cap` recon screenshots to attach for design analysis. Prefer
/// names containing `desktop`, then `mobile`, then any other image — always
/// excluding scaffold/generated shots (`clone-*`, `comparison`). Operates on
/// bare file names; deterministic ordering.
fn pick_design_screenshots(file_names: &[String], cap: usize) -> Vec<String> {
    let eligible = |n: &str| {
        let lower = n.to_lowercase();
        is_image(n) && !lower.starts_with("clone-") && !lower.contains("comparison")
    };
    let mut desktop: Vec<String> = file_names
        .iter()
        .filter(|n| eligible(n) && n.to_lowercase().contains("desktop"))
        .cloned()
        .collect();
    let mut mobile: Vec<String> = file_names
        .iter()
        .filter(|n| eligible(n) && n.to_lowercase().contains("mobile"))
        .cloned()
        .collect();
    let mut other: Vec<String> = file_names
        .iter()
        .filter(|n| {
            eligible(n)
                && !n.to_lowercase().contains("desktop")
                && !n.to_lowercase().contains("mobile")
        })
        .cloned()
        .collect();
    desktop.sort();
    mobile.sort();
    other.sort();
    let mut out = Vec::new();
    for group in [desktop, mobile, other] {
        for name in group {
            if out.len() >= cap {
                return out;
            }
            if !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

/// Read a file fail-soft, capped to `cap` chars (char-boundary safe). Returns a
/// labeled block, or empty string if the file is missing/unreadable/empty.
fn read_capped(path: &Path, label: &str, cap: usize) -> String {
    match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => {
            let body: String = s.chars().take(cap).collect();
            format!("\n\n===== {label} =====\n{body}")
        }
        _ => String::new(),
    }
}
```

Add the DESIGN_PROMPT constant near the top of the file (after the `const` declarations):

```rust
const DESIGN_PROMPT: &str = "You are a senior design systems analyst. Reverse-engineer the design system of this website from the attached original-site screenshots and the extracted CSS/DOM artifacts below.\n\n\
Return ONLY one fenced ```json code block, with no prose before or after, matching this TypeScript type exactly:\n\n\
type DesignSpec = {\n\
  title: string;            // site/design name\n\
  aesthetic: string;        // one-line vibe\n\
  designLanguage: string;   // 1 paragraph: mood, references, overall feel\n\
  colors: { name: string; role: string; hex: string; ramp?: string[] }[];\n\
  typography: { role: string; family: string; fallback?: string; sizePx?: number; weight?: number; sample?: string; usage?: string }[];\n\
  spacing: { scale: number[]; notes?: string };\n\
  components: { name: string; description: string; preview?: { kind: \"button\"|\"input\"|\"badge\"|\"card\"|\"other\"; fillHex?: string; textHex?: string; radiusPx?: number } }[];\n\
  motion: string; responsive: string; imagery: string; voice: string; rebuildNotes: string;\n\
};\n\n\
Colors: extract the real palette as hex from the CSS/screenshots; group into named roles; include ramps where the site uses shades. Typography: identify each font family actually used and its roles/sizes/weights. Components: inventory the distinctive UI components with their styling, and fill `preview` with real hex/radius hints where you can. Be specific and exact — no placeholders.\n\
If a field is unknown, use a short honest string or an empty array — never invent.\n";
```

Add the command (after `repolens_website_continue`, before `repolens_website_delete`):

```rust
#[tauri::command]
pub async fn repolens_website_extract_design(
    app: AppHandle,
    id: String,
    model: Option<String>,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    // 1. Resolve project_path.
    let project = {
        let conn = open_conn(&app)?;
        let p: String = conn
            .query_row(
                "SELECT project_path FROM repolens_websites WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        PathBuf::from(p)
    };
    let model = model
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| OPUS_MODEL.to_string());

    // 2. Gather artifacts (fail-soft, size-capped per file; ~80k total budget).
    let docs = project.join("docs");
    let research = docs.join("research");
    let mut artifacts = String::new();
    artifacts.push_str(&read_capped(&research.join("style.css"), "ORIGINAL SITE CSS (style.css)", 24_000));
    artifacts.push_str(&read_capped(&research.join("dom-structure.json"), "DOM STRUCTURE", 12_000));
    artifacts.push_str(&read_capped(&research.join("global-ui-structure.json"), "GLOBAL UI STRUCTURE", 12_000));
    artifacts.push_str(&read_capped(&project.join("src").join("app").join("globals.css"), "GENERATED TOKENS (globals.css)", 12_000));
    artifacts.push_str(&read_capped(&research.join("BEHAVIORS.md"), "BEHAVIORS", 8_000));
    artifacts.push_str(&read_capped(&research.join("PAGE_TOPOLOGY.md"), "PAGE TOPOLOGY", 4_000));
    artifacts.push_str(&read_capped(&research.join("source.html"), "SOURCE HTML (head excerpt)", 6_000));

    // 3. Pick up to 2 recon screenshots.
    let refs_dir = docs.join("design-references");
    let names: Vec<String> = std::fs::read_dir(&refs_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    let shots = pick_design_screenshots(&names, 2);

    // 4. Build the prompt; append @<abs path> per screenshot (CLI reads inline).
    let mut prompt = format!("{DESIGN_PROMPT}{artifacts}");
    for shot in &shots {
        let abs = refs_dir.join(shot);
        prompt.push_str(&format!("\n\n@{}", abs.to_string_lossy()));
    }

    // 5. Call claude (json envelope, subscription auth) — mirrors repolens.rs.
    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "json", "--strict-mcp-config", "--model", &model]);
    cmd.current_dir(&project);
    cmd.env("PATH", augmented_path());
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let out = match tokio::time::timeout(Duration::from_secs(180), child.wait_with_output()).await {
        Ok(r) => r.map_err(|e| e.to_string())?,
        Err(_) => return Err("claude timed out after 180s — try again or a smaller model".into()),
    };
    if !out.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let env: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("bad claude envelope: {e}"))?;
    let is_error = env.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
    let bad_subtype = env
        .get("subtype")
        .and_then(|v| v.as_str())
        .map(|s| s != "success")
        .unwrap_or(false);
    if is_error || bad_subtype {
        return Err(format!(
            "claude returned error: {}",
            env.get("result").and_then(|v| v.as_str()).unwrap_or("unknown")
        ));
    }
    let result = env
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or("no .result in claude envelope")?
        .to_string();

    // 6. Persist.
    {
        let conn = open_conn(&app)?;
        conn.execute(
            "UPDATE repolens_websites SET design_json = ?2, design_at = ?3, updated_at = ?3 WHERE id = ?1",
            params![id, result, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}
```

- [ ] **Step 4: Register the handler in `lib.rs`**

In `src-tauri/src/lib.rs`, in the `generate_handler!` list, after `repolens_website::repolens_website_delete,` (line ~228), add:

```rust
            repolens_website::repolens_website_extract_design,
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `cd src-tauri && cargo test repolens_website 2>&1 | tail -20; cd ..`
Expected: PASS — `pick_design_screenshots` test green.

- [ ] **Step 6: Verify the crate compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -20; cd ..`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/repolens_website.rs src-tauri/src/lib.rs
git commit -m "feat(repolens): repolens_website_extract_design Rust command"
```

---

## Task 5: IPC wrapper + store `extractDesign`

**Files:**
- Modify: `src/lib/ipc.ts` (after `repolensWebsiteDelete`, line ~234)
- Modify: `src/apps/archives/repolens/useRepoLensWebsites.ts`

- [ ] **Step 1: Add the IPC wrapper**

In `src/lib/ipc.ts`, after the `repolensWebsiteDelete` entry, add:

```typescript
  repolensWebsiteExtractDesign: (
    id: string,
    model: string | null = null,
  ): Promise<string> =>
    invoke<string>("repolens_website_extract_design", { id, model }),
```

- [ ] **Step 2: Add `extracting` + `extractDesign` to the store**

In `src/apps/archives/repolens/useRepoLensWebsites.ts`:

Add to the `State` type (after `applyEvent: ...`):

```typescript
  extracting: Set<string>;
  extractDesign: (id: string, model: string | null) => Promise<void>;
```

Add to the store object initial state (after `loaded: false,`):

```typescript
  extracting: new Set<string>(),
```

Add the action (after `applyEvent`, inside the store object):

```typescript
  extractDesign: async (id, model) => {
    if (get().extracting.has(id)) return;
    set((s) => ({ extracting: new Set(s.extracting).add(id) }));
    try {
      const json = await ipc.repolensWebsiteExtractDesign(id, model);
      set((s) => {
        const rips = s.rips.map((r) =>
          r.id === id ? { ...r, design_json: json, design_at: Date.now() } : r,
        );
        return { rips };
      });
      toast.success("Design MD ready");
    } catch (e) {
      toast.error(`Extract failed: ${String(e)}`);
    } finally {
      set((s) => {
        const next = new Set(s.extracting);
        next.delete(id);
        return { extracting: next };
      });
    }
  },
```

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts src/apps/archives/repolens/useRepoLensWebsites.ts
git commit -m "feat(repolens): extractDesign store action + ipc wrapper"
```

---

## Task 6: Design MDs board UI (`RepoLensDesignMDs.tsx`)

**Files:**
- Create: `src/apps/archives/repolens/RepoLensDesignMDs.tsx`

**Context:** Mirrors `RepoLensReport.tsx`'s `.rl-card` structure. Reads `rips` from the store, filters to `design_json != null`, shows a grid; clicking a card parses `design_json` and renders the board. The model for re-extract comes from `useRepoLens` `model.default_model`. Download `.md` uses the Blob+anchor pattern from `RepoLensReport.tsx`.

- [ ] **Step 1: Create the component**

Create `src/apps/archives/repolens/RepoLensDesignMDs.tsx`:

```typescript
import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe, RefreshCw, Copy, Download } from "lucide-react";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { useRepoLens } from "./useRepoLens";
import { parseDesignSpec, designSpecToMarkdown, type DesignSpec } from "./designSpec";
import type { WebsiteRipRow } from "./repolensWebsitesDb";
import { toast } from "@/store/toastStore";

function age(ms: number | null): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RepoLensDesignMDs() {
  const rips = useRepoLensWebsites((s) => s.rips);
  const withDesign = rips.filter((r) => r.design_json != null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = withDesign.find((r) => r.id === openId) ?? null;

  if (open) return <DesignSpecBoard row={open} onBack={() => setOpenId(null)} />;

  if (withDesign.length === 0) {
    return (
      <div className="rl-empty">
        <Globe />
        <h2>No design MDs yet</h2>
        <p>
          Extract a design MD from a finished clone in the Rips tab — RepoLens
          reverse-engineers its color system, typography, and components.
        </p>
      </div>
    );
  }

  return (
    <div className="rl-lib-grid">
      {withDesign.map((r) => {
        const thumb = r.thumbnail_path ? convertFileSrc(r.thumbnail_path) : null;
        return (
          <div key={r.id} className="rl-web-card rl-web-done" onClick={() => setOpenId(r.id)}>
            <div className="rl-web-thumb">
              {thumb ? <img src={thumb} alt={r.hostname} /> : <div className="rl-web-thumb-empty"><Globe /></div>}
              <span className="rl-web-badge rl-web-badge--done">Design MD</span>
            </div>
            <div className="rl-web-meta">
              <span className="rl-web-host">{r.hostname}</span>
              <span className="rl-dm-age">{age(r.design_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DesignSpecBoard({ row, onBack }: { row: WebsiteRipRow; onBack: () => void }) {
  const extractDesign = useRepoLensWebsites((s) => s.extractDesign);
  const extracting = useRepoLensWebsites((s) => s.extracting.has(row.id));
  const model = useRepoLens((s) => s.model.default_model);
  const thumb = row.thumbnail_path ? convertFileSrc(row.thumbnail_path) : null;

  let spec: DesignSpec | null = null;
  try {
    spec = row.design_json ? parseDesignSpec(row.design_json) : null;
  } catch {
    spec = null;
  }

  if (!spec) {
    return (
      <div className="rl-dm-board">
        <button className="rl-btn" onClick={onBack}>← Design MDs</button>
        <div className="rl-error">Could not parse this design spec. Try re-extracting.</div>
      </div>
    );
  }

  const copyMd = async () => {
    await navigator.clipboard.writeText(designSpecToMarkdown(spec!));
    toast.success("Markdown copied");
  };
  const downloadMd = () => {
    const blob = new Blob([designSpecToMarkdown(spec!)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.hostname.replace(/[^a-z0-9.-]/gi, "-")}-design.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rl-dm-board">
      <div className="rl-dm-toolbar">
        <button className="rl-btn" onClick={onBack}>← Design MDs</button>
        <div className="rl-dm-actions">
          <button className="rl-btn" disabled={extracting} onClick={() => void extractDesign(row.id, model)}>
            <RefreshCw size={13} /> {extracting ? "Re-extracting…" : "Re-extract"}
          </button>
          <button className="rl-btn" onClick={() => void copyMd()}><Copy size={13} /> Copy .md</button>
          <button className="rl-btn" onClick={downloadMd}><Download size={13} /> Download .md</button>
        </div>
      </div>

      <section className="rl-card rl-dm-hero">
        {thumb && <img className="rl-dm-hero-thumb" src={thumb} alt={row.hostname} />}
        <div>
          <div className="rl-eyebrow">{row.hostname}</div>
          <h1 className="rl-dm-title">{spec.title || row.hostname}</h1>
          {spec.aesthetic && <p className="rl-dm-aesthetic">{spec.aesthetic}</p>}
        </div>
      </section>

      {spec.designLanguage && (
        <section className="rl-card"><div className="rl-eyebrow">Design Language</div><p>{spec.designLanguage}</p></section>
      )}

      {spec.colors.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Color System</div>
          <div className="rl-dm-swatches">
            {spec.colors.map((c, i) => (
              <div key={i} className="rl-dm-swatch">
                <div className="rl-dm-swatch-chip" style={{ background: c.hex }} />
                <div className="rl-dm-swatch-name">{c.name}</div>
                <div className="rl-dm-swatch-hex">{c.hex}</div>
                <div className="rl-dm-swatch-role">{c.role}</div>
                {c.ramp && c.ramp.length > 0 && (
                  <div className="rl-dm-ramp">
                    {c.ramp.map((shade, j) => (
                      <span key={j} className="rl-dm-ramp-chip" style={{ background: shade }} title={shade} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.typography.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Typography</div>
          <div className="rl-dm-specimens">
            {spec.typography.map((t, i) => (
              <div key={i} className="rl-dm-specimen">
                <div
                  className="rl-dm-specimen-sample"
                  style={{
                    fontFamily: `${t.family}, ${t.fallback ?? "sans-serif"}`,
                    fontSize: t.sizePx ? `${Math.min(t.sizePx, 64)}px` : "32px",
                    fontWeight: t.weight ?? 400,
                  }}
                >
                  {t.sample || "Aa"}
                </div>
                <div className="rl-dm-specimen-meta">
                  <strong>{t.role}</strong> · {t.family}
                  {t.weight ? ` · ${t.weight}` : ""}
                  {t.sizePx ? ` · ${t.sizePx}px` : ""}
                  {t.usage ? ` · ${t.usage}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.components.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Components</div>
          <div className="rl-dm-components">
            {spec.components.map((c, i) => (
              <div key={i} className="rl-dm-component">
                {c.preview && (
                  <div className="rl-dm-component-preview">
                    <span
                      className={`rl-dm-prev rl-dm-prev--${c.preview.kind}`}
                      style={{
                        background: c.preview.fillHex,
                        color: c.preview.textHex,
                        borderRadius: c.preview.radiusPx != null ? `${c.preview.radiusPx}px` : undefined,
                      }}
                    >
                      {c.name}
                    </span>
                  </div>
                )}
                <div className="rl-dm-component-name">{c.name}</div>
                <div className="rl-dm-component-desc">{c.description}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.spacing.scale.length > 0 && (
        <section className="rl-card">
          <div className="rl-eyebrow">Spacing</div>
          <div className="rl-dm-bars">
            {spec.spacing.scale.map((n, i) => (
              <div key={i} className="rl-dm-bar-row">
                <span className="rl-dm-bar-label">{n}</span>
                <span className="rl-dm-bar" style={{ width: `${Math.min(n * 3, 300)}px` }} />
              </div>
            ))}
          </div>
          {spec.spacing.notes && <p className="rl-dm-notes">{spec.spacing.notes}</p>}
        </section>
      )}

      {([
        ["Motion", spec.motion],
        ["Responsive", spec.responsive],
        ["Imagery", spec.imagery],
        ["Voice", spec.voice],
        ["Rebuild Notes", spec.rebuildNotes],
      ] as [string, string][])
        .filter(([, body]) => body)
        .map(([heading, body]) => (
          <section key={heading} className="rl-card">
            <div className="rl-eyebrow">{heading}</div>
            <p>{body}</p>
          </section>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `useRepoLens` `model.default_model` path differs, confirm by reading `useRepoLens.ts` — the spec states `model.default_model` is correct.)

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/RepoLensDesignMDs.tsx
git commit -m "feat(repolens): Design MDs grid + DesignSpecBoard visual render"
```

---

## Task 7: Wire the Extract MD button + inner toggle

**Files:**
- Modify: `src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx`

**Context:** Add a `webSub: "rips" | "designs"` toggle at the top (reuse `.rl-tabs`/`.rl-tab` classes). When `designs`, render `<RepoLensDesignMDs />`. On each **done** card add an "Extract MD" button + a context-menu item; both call `extractDesign(id, model)`.

- [ ] **Step 1: Update the imports + component**

Replace the contents of `src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx` with:

```typescript
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe, FileText } from "lucide-react";
import { useContextMenu } from "@/components/ContextMenu";
import { useRepoLensWebsites } from "./useRepoLensWebsites";
import { useRepoLens } from "./useRepoLens";
import { RepoLensWebsiteProgress } from "./RepoLensWebsiteProgress";
import { RepoLensDesignMDs } from "./RepoLensDesignMDs";
import { phaseLabel } from "./websiteRip";
import type { WebsiteRipRow, WebsiteStatus } from "./repolensWebsitesDb";

export function RepoLensWebsitesLibrary() {
  const { rips, loaded, load, remove, continueRip, openInOrion, extractDesign } =
    useRepoLensWebsites();
  const extractingSet = useRepoLensWebsites((s) => s.extracting);
  const model = useRepoLens((s) => s.model.default_model);
  const { openAt, menu } = useContextMenu();
  const [webSub, setWebSub] = useState<"rips" | "designs">("rips");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = rips.find((r) => r.status === "running" || r.status === "paused");

  const subTabs = (
    <div className="rl-tabs rl-tabs--sub">
      <button className={webSub === "rips" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setWebSub("rips")}>Rips</button>
      <button className={webSub === "designs" ? "rl-tab rl-tab--on" : "rl-tab"} onClick={() => setWebSub("designs")}>Design MDs</button>
    </div>
  );

  if (webSub === "designs") {
    return (
      <>
        {subTabs}
        <RepoLensDesignMDs />
      </>
    );
  }

  if (loaded && rips.length === 0) {
    return (
      <>
        {subTabs}
        <div className="rl-empty">
          <Globe />
          <h2>Clone any website</h2>
          <p>
            Paste a URL above and hit Rip. RepoLens reverse-engineers it into an
            editable Next.js project, saved here with a preview.
          </p>
          <p className="rl-web-legal">
            For learning and personal use only — do not use clones to impersonate,
            phish, or violate a site's terms.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {subTabs}
      {active && <RepoLensWebsiteProgress rip={active} />}
      <div className="rl-lib-grid">
        {rips.map((r) => (
          <WebsiteCard
            key={r.id}
            r={r}
            extracting={extractingSet.has(r.id)}
            onOpen={() => {
              if (r.status === "done") void openInOrion(r.id);
            }}
            onExtract={() => void extractDesign(r.id, model)}
            onMenu={(e) =>
              openAt(e, [
                {
                  label: "Open in Orion",
                  onClick: () => void openInOrion(r.id),
                  disabled: r.status !== "done",
                },
                {
                  label: r.design_json ? "Re-extract MD" : "Extract MD",
                  onClick: () => void extractDesign(r.id, model),
                  disabled: r.status !== "done" || extractingSet.has(r.id),
                },
                {
                  label: "Continue",
                  onClick: () => void continueRip(r.id),
                  disabled: r.status !== "paused",
                },
                { type: "separator" },
                {
                  label: "Delete",
                  danger: true,
                  onClick: () => void remove(r.id),
                },
              ])
            }
          />
        ))}
      </div>
      {menu}
    </>
  );
}

function WebsiteCard({
  r,
  extracting,
  onOpen,
  onExtract,
  onMenu,
}: {
  r: WebsiteRipRow;
  extracting: boolean;
  onOpen: () => void;
  onExtract: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const thumb = r.thumbnail_path ? convertFileSrc(r.thumbnail_path) : null;
  return (
    <div
      className={`rl-web-card rl-web-${r.status}`}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <div className="rl-web-thumb">
        {thumb ? (
          <img src={thumb} alt={r.hostname} />
        ) : (
          <div className="rl-web-thumb-empty">
            <Globe />
          </div>
        )}
        <span className={`rl-web-badge rl-web-badge--${r.status}`}>
          {r.status === "running" ? phaseLabel(r.phase) : statusLabel(r.status)}
        </span>
        {r.design_json && (
          <span className="rl-web-badge rl-dm-marker" title="Has a design MD">
            <FileText size={11} />
          </span>
        )}
      </div>
      <div className="rl-web-meta">
        <span className="rl-web-host">{r.hostname}</span>
        {r.status === "done" && (
          <button
            className="rl-btn rl-dm-extract-btn"
            disabled={extracting}
            onClick={(e) => {
              e.stopPropagation();
              onExtract();
            }}
          >
            {extracting ? "Extracting…" : r.design_json ? "Re-extract MD" : "Extract MD"}
          </button>
        )}
      </div>
    </div>
  );
}

function statusLabel(s: WebsiteStatus): string {
  return {
    queued: "Queued",
    running: "Running",
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
    paused: "Paused",
  }[s];
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/apps/archives/repolens/RepoLensWebsitesLibrary.tsx
git commit -m "feat(repolens): Extract MD button + Rips/Design MDs inner toggle"
```

---

## Task 8: `.rl-dm-*` CSS

**Files:**
- Modify: `src/styles/tokens.css` (append after the `.rl-web-*` block, ~line 12268)

**Context:** Only append a new block; do not edit existing rules. The `--repolens-green` accent + `--bg-*`/`--t-*` tokens are already defined. **Do not touch any XDesign-related CSS in the working tree** — append only.

- [ ] **Step 1: Append the CSS block**

At the end of the `.rl-web-*` block in `src/styles/tokens.css` (after the existing `.rl-web-card:hover { transform: none; }` media-query rule near line 12268), append:

```css
/* ── RepoLens Design MDs ─────────────────────────────────────────────── */
.rl-tabs--sub { margin-bottom: 12px; }
.rl-dm-age { font-size: 11px; color: var(--t-tertiary); }
.rl-dm-marker {
  left: 8px; right: auto;
  display: inline-flex; align-items: center;
  color: var(--repolens-green);
  border-color: rgba(var(--repolens-green-rgb), 0.5);
}
.rl-dm-extract-btn { margin-top: 6px; font-size: 11px; padding: 3px 8px; }

.rl-dm-board { display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px; }
.rl-dm-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rl-dm-actions { display: flex; gap: 8px; }
.rl-dm-actions .rl-btn { display: inline-flex; align-items: center; gap: 5px; }

.rl-dm-hero { display: flex; gap: 18px; align-items: center; }
.rl-dm-hero-thumb { width: 160px; height: 100px; object-fit: cover; border-radius: var(--r-md); border: 1px solid var(--glass-border); }
.rl-dm-title { font-size: 26px; margin: 4px 0; color: var(--t-primary); }
.rl-dm-aesthetic { color: var(--t-secondary); font-style: italic; }

.rl-dm-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.rl-dm-swatch { display: flex; flex-direction: column; gap: 3px; }
.rl-dm-swatch-chip { height: 64px; border-radius: var(--r-md); border: 1px solid var(--glass-border); }
.rl-dm-swatch-name { font-weight: 600; color: var(--t-primary); font-size: 13px; }
.rl-dm-swatch-hex { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--repolens-green); }
.rl-dm-swatch-role { font-size: 11px; color: var(--t-tertiary); }
.rl-dm-ramp { display: flex; gap: 0; margin-top: 4px; border-radius: var(--r-sm); overflow: hidden; }
.rl-dm-ramp-chip { flex: 1; height: 16px; }

.rl-dm-specimens { display: flex; flex-direction: column; gap: 16px; }
.rl-dm-specimen { border-bottom: 1px solid var(--glass-border); padding-bottom: 12px; }
.rl-dm-specimen:last-child { border-bottom: none; padding-bottom: 0; }
.rl-dm-specimen-sample { color: var(--t-primary); line-height: 1.1; }
.rl-dm-specimen-meta { font-size: 12px; color: var(--t-secondary); margin-top: 6px; }

.rl-dm-components { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.rl-dm-component { background: var(--bg-2); border: 1px solid var(--glass-border); border-radius: var(--r-md); padding: 12px; }
.rl-dm-component-preview { margin-bottom: 10px; }
.rl-dm-prev { display: inline-block; padding: 7px 14px; font-size: 13px; background: var(--bg-3); color: var(--t-primary); border: 1px solid var(--glass-border); }
.rl-dm-prev--badge { padding: 3px 9px; font-size: 11px; }
.rl-dm-prev--input { width: 100%; box-sizing: border-box; color: var(--t-tertiary); }
.rl-dm-component-name { font-weight: 600; color: var(--t-primary); font-size: 13px; }
.rl-dm-component-desc { font-size: 12px; color: var(--t-secondary); margin-top: 4px; }

.rl-dm-bars { display: flex; flex-direction: column; gap: 6px; }
.rl-dm-bar-row { display: flex; align-items: center; gap: 10px; }
.rl-dm-bar-label { width: 36px; text-align: right; font-family: var(--font-mono, monospace); font-size: 12px; color: var(--t-secondary); }
.rl-dm-bar { height: 14px; background: var(--repolens-green); border-radius: var(--r-sm); opacity: 0.8; }
.rl-dm-notes { font-size: 12px; color: var(--t-tertiary); margin-top: 8px; }
```

- [ ] **Step 2: Verify the production build succeeds**

Run: `npm run build`
Expected: exit 0 (tsc + vite build green).

- [ ] **Step 3: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(repolens): .rl-dm-* styles for the Design MD board"
```

---

## Task 9: Full verification gate

- [ ] **Step 1: Run the full TS test suite**

Run: `npx vitest run`
Expected: PASS — all prior tests + the new `designSpec.test.ts` green.

- [ ] **Step 2: TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Rust check + tests**

Run: `cd src-tauri && cargo check && cargo test 2>&1 | tail -25; cd ..`
Expected: both exit 0; the new `pick_design_screenshots` test passes.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Confirm no XDesign files were staged across the feature**

Run: `git log --oneline -9 --name-only | grep -i xdesign || echo "no xdesign files committed — good"`
Expected: prints "no xdesign files committed — good".

- [ ] **Step 6: Report restart requirement**

Tell the user: **a `tauri dev` restart is required** (migration 0023 + new Rust command). Then walk the smoke test:
1. RepoLens → Websites → Rips → on a **done** clone card, click **Extract MD** → "Extracting…" → toast "Design MD ready".
2. Switch inner toggle to **Design MDs** → the site appears → click it → a visual board renders (color swatches with hex, `Aa` type specimens, component cards, spacing bars, narrative).
3. **Re-extract** overwrites; **Download .md** saves a readable markdown file.

---

## Self-Review notes

- **Spec coverage:** §2 data model → Task 3. §3 DesignSpec + parser + markdown → Tasks 1–2. §4 Rust command → Task 4. §5 DESIGN_PROMPT → Task 4 (inlined). §6a Extract button → Task 7. §6b inner toggle → Task 7. §6c board → Task 6. §6d store → Task 5. §7 files / CSS → Task 8. Tests for the two pure fns → Tasks 1–2. ✅
- **Verification:** every slice gates on real exit codes (`vitest` / `tsc` / `cargo check` / `cargo test` / `npm run build`), per spec §9.
- **Type consistency:** `parseDesignSpec` / `designSpecToMarkdown` / `DesignSpec` / `extractDesign(id, model)` / `extracting: Set<string>` / `repolensWebsiteExtractDesign(id, model)` used identically across tasks.
- **No XDesign contamination:** every commit step lists exact paths; Task 9 Step 5 asserts none leaked.
