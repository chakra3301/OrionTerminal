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
