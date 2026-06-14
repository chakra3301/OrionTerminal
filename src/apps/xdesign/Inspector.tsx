import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import {
  Plus,
  X,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  FlipHorizontal,
  FlipVertical,
  Link2,
  Link2Off,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useXDesign,
  resolveVar,
  type Shape,
  type Effect,
  type Gradient,
} from "@/apps/xdesign/store";
import { XDesignImagePicker } from "@/apps/xdesign/ImagePicker";
import { toast } from "@/store/toastStore";
import type { BoolOp } from "@/apps/xdesign/booleanOps";
import type { ConstraintH, ConstraintV } from "@/apps/xdesign/constraints";
import { findInstanceRoot } from "@/apps/xdesign/overrides";
import { variantProperties, defaultSelection } from "@/apps/xdesign/variants";
import {
  topLevelFrames,
  topLevelFrameAncestor,
  type ProtoLink,
  type ProtoTransition,
} from "@/apps/xdesign/prototype";

const COLOR_PRESETS: Array<{ value: string; title: string }> = [
  { value: "transparent", title: "Transparent" },
  { value: "#0a1015", title: "Ink" },
  { value: "#e6f4ec", title: "Bone" },
  { value: "#39ff88", title: "Neon green" },
  { value: "#00e0ff", title: "Neon cyan" },
  { value: "#e6ff3a", title: "Neon yellow" },
  { value: "#ff3ea5", title: "Neon magenta" },
  { value: "#b14cff", title: "Neon violet" },
  { value: "rgba(255,255,255,0.06)", title: "Surface" },
];

/** Try to normalize the stored color into a `#rrggbb` the native input can
 * display. Anything we can't reduce (rgba, CSS vars) falls back to a sensible
 * default so the picker is at least usable. */
function toHexForPicker(color: string): string {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  }
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${toHex(rgb[1]!)}${toHex(rgb[2]!)}${toHex(rgb[3]!)}`;
  }
  return "#888888";
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const variables = useXDesign((s) => s.variables);
  const activeModeId = useXDesign((s) => s.activeModeId);

  const isVarRef = value.startsWith("var:");
  const varDef = isVarRef
    ? variables.find((v) => v.id === value.slice(4)) ?? null
    : null;
  const resolvedValue =
    typeof resolveVar(value, variables, activeModeId) === "string"
      ? (resolveVar(value, variables, activeModeId) as string)
      : value;
  const displayInputValue = varDef ? `@${varDef.name}` : value;

  const [draft, setDraft] = useState(displayInputValue);
  const [open, setOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(displayInputValue), [displayInputValue]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commitTextDraft = () => {
    if (draft === displayInputValue) return;
    // Allow "@name" shorthand to bind to a variable.
    if (draft.startsWith("@")) {
      const name = draft.slice(1).trim();
      const match = variables.find((v) => v.name === name);
      if (match) {
        onChange(`var:${match.id}`);
        return;
      }
    }
    onChange(draft);
  };

  return (
    <div className="xd-field xd-color-field" ref={rootRef}>
      <span>{label}</span>
      <div className="xd-color">
        <button
          type="button"
          className={`xd-color-swatch${isVarRef ? " is-var" : ""}`}
          style={{ background: resolvedValue }}
          title={isVarRef ? `${varDef?.name ?? "variable"} → ${resolvedValue}` : value}
          onClick={() => setOpen((o) => !o)}
        />
        <input
          type="text"
          className={`xd-color-input${isVarRef ? " is-var" : ""}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTextDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(displayInputValue);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <input
          ref={colorInputRef}
          type="color"
          className="xd-color-native"
          value={toHexForPicker(resolvedValue)}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden
        />
      </div>
      {open && (
        <div className="xd-color-popover">
          <div className="xd-color-presets">
            {COLOR_PRESETS.map((p) => (
              <button
                type="button"
                key={p.value}
                className={`xd-color-preset${
                  p.value === "transparent" ? " transparent" : ""
                }`}
                title={p.title}
                style={{ background: p.value }}
                onClick={() => {
                  onChange(p.value);
                }}
              />
            ))}
          </div>
          {variables.length > 0 && (
            <div className="xd-color-vars">
              <div className="xd-color-vars-label">Variables</div>
              <div className="xd-color-vars-list">
                {variables.map((v) => {
                  const raw = v.values[activeModeId] ?? Object.values(v.values)[0];
                  const swatch = typeof raw === "string" ? raw : "transparent";
                  const isSel = isVarRef && varDef?.id === v.id;
                  return (
                    <button
                      type="button"
                      key={v.id}
                      className={`xd-color-var-row${isSel ? " active" : ""}`}
                      onClick={() => {
                        onChange(`var:${v.id}`);
                      }}
                      title={`${v.name} → ${swatch}`}
                    >
                      <span
                        className="xd-color-var-swatch"
                        style={{ background: swatch }}
                      />
                      <span className="xd-color-var-name">{v.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {isVarRef && (
            <button
              type="button"
              className="xd-color-detach"
              onClick={() => onChange(resolvedValue)}
              title="Replace the variable reference with its current value"
            >
              Detach from variable
            </button>
          )}
          <button
            type="button"
            className="xd-color-native-btn"
            onClick={() => colorInputRef.current?.click()}
          >
            Custom color…
          </button>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="xd-section">
      <button
        type="button"
        className="xd-section-head"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        <span>{title}</span>
        <div className="xd-section-spacer" />
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </button>
      {open && <div className="xd-section-body">{children}</div>}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  return (
    <label className="xd-field">
      <span>{label}</span>
      <div className="xd-num">
        <input
          type="number"
          value={draft}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (Number.isFinite(n)) onChange(n);
            else setDraft(String(Math.round(value)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(String(Math.round(value)));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="xd-field">
      <span>{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onChange(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function AutoLayoutSection({
  frame,
  onChange,
}: {
  frame: Shape & { kind: "frame" };
  onChange: (patch: Partial<Shape>) => void;
}) {
  const mode = frame.layoutMode ?? "none";
  const setMode = (m: "none" | "horizontal" | "vertical") => onChange({ layoutMode: m });
  const isOn = mode !== "none";
  return (
    <>
      <div className="xd-fields">
        <SegmentField
          label="Mode"
          value={mode}
          options={["none", "horizontal", "vertical"]}
          onChange={(v) =>
            setMode(v as "none" | "horizontal" | "vertical")
          }
        />
      </div>
      {isOn && (
        <>
          <div className="xd-fields">
            <NumField
              label="Gap"
              value={frame.itemSpacing ?? 0}
              onChange={(n) => onChange({ itemSpacing: Math.max(0, n) })}
            />
          </div>
          <div className="xd-fields">
            <NumField
              label="Pad T"
              value={frame.paddingTop ?? 0}
              onChange={(n) => onChange({ paddingTop: Math.max(0, n) })}
            />
            <NumField
              label="Pad R"
              value={frame.paddingRight ?? 0}
              onChange={(n) => onChange({ paddingRight: Math.max(0, n) })}
            />
          </div>
          <div className="xd-fields">
            <NumField
              label="Pad B"
              value={frame.paddingBottom ?? 0}
              onChange={(n) => onChange({ paddingBottom: Math.max(0, n) })}
            />
            <NumField
              label="Pad L"
              value={frame.paddingLeft ?? 0}
              onChange={(n) => onChange({ paddingLeft: Math.max(0, n) })}
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Main"
              value={frame.primaryAxisAlign ?? "min"}
              options={["min", "center", "max", "space-between"]}
              onChange={(v) =>
                onChange({
                  primaryAxisAlign: v as
                    | "min"
                    | "center"
                    | "max"
                    | "space-between",
                })
              }
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Cross"
              value={frame.counterAxisAlign ?? "min"}
              options={["min", "center", "max"]}
              onChange={(v) =>
                onChange({
                  counterAxisAlign: v as "min" | "center" | "max",
                })
              }
            />
          </div>
        </>
      )}
    </>
  );
}

function LayoutSizingRow({
  shape,
  onCommit,
}: {
  shape: Shape;
  onCommit: (id: string, patch: Partial<Shape>) => void;
}) {
  const h = shape.layoutSizingH ?? "fixed";
  const v = shape.layoutSizingV ?? "fixed";
  return (
    <>
      <div className="xd-fields">
        <SegmentField
          label="W sizing"
          value={h}
          options={["fixed", "hug", "fill"]}
          onChange={(val) =>
            onCommit(shape.id, {
              layoutSizingH: val as Shape["layoutSizingH"],
            })
          }
        />
      </div>
      <div className="xd-fields">
        <SegmentField
          label="H sizing"
          value={v}
          options={["fixed", "hug", "fill"]}
          onChange={(val) =>
            onCommit(shape.id, {
              layoutSizingV: val as Shape["layoutSizingV"],
            })
          }
        />
      </div>
    </>
  );
}

function FlipRow({
  flipX,
  flipY,
  onToggle,
}: {
  flipX: boolean;
  flipY: boolean;
  onToggle: (axis: "x" | "y") => void;
}) {
  return (
    <label className="xd-field">
      <span>Flip</span>
      <div className="xd-segment">
        <button
          type="button"
          className={`xd-segment-btn${flipX ? " active" : ""}`}
          title="Flip horizontal"
          onClick={() => onToggle("x")}
        >
          <FlipHorizontal size={11} />
        </button>
        <button
          type="button"
          className={`xd-segment-btn${flipY ? " active" : ""}`}
          title="Flip vertical"
          onClick={() => onToggle("y")}
        >
          <FlipVertical size={11} />
        </button>
      </div>
    </label>
  );
}

function CornerRadiiField({
  radius,
  radii,
  onChangeRadius,
  onChangeRadii,
}: {
  radius: number;
  radii: [number, number, number, number] | null;
  onChangeRadius: (n: number) => void;
  onChangeRadii: (arr: [number, number, number, number] | null) => void;
}) {
  const split = !!radii;
  if (!split) {
    return (
      <div className="xd-fields">
        <NumField label="Radius" value={radius} onChange={onChangeRadius} />
        <button
          type="button"
          className="xd-mini-btn"
          title="Split into per-corner radii"
          onClick={() => onChangeRadii([radius, radius, radius, radius])}
        >
          <Link2 size={11} />
        </button>
      </div>
    );
  }
  const labels: Array<["TL" | "TR" | "BR" | "BL", number]> = [
    ["TL", radii[0]],
    ["TR", radii[1]],
    ["BR", radii[2]],
    ["BL", radii[3]],
  ];
  return (
    <>
      <div className="xd-field">
        <span>Corners</span>
        <button
          type="button"
          className="xd-mini-btn active"
          title="Link corners (back to a single radius)"
          onClick={() => onChangeRadii(null)}
        >
          <Link2Off size={11} />
        </button>
      </div>
      <div className="xd-fields">
        {labels.slice(0, 2).map(([lab, v], idx) => (
          <NumField
            key={lab}
            label={lab}
            value={v}
            onChange={(n) => {
              const next: [number, number, number, number] = [...radii];
              next[idx] = Math.max(0, n);
              onChangeRadii(next);
            }}
          />
        ))}
      </div>
      <div className="xd-fields">
        {labels.slice(2).map(([lab, v], idx) => (
          <NumField
            key={lab}
            label={lab}
            value={v}
            onChange={(n) => {
              const next: [number, number, number, number] = [...radii];
              next[idx + 2] = Math.max(0, n);
              onChangeRadii(next);
            }}
          />
        ))}
      </div>
    </>
  );
}

function SegmentField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <label className="xd-field">
      <span>{label}</span>
      <div className="xd-segment">
        {options.map((o) => (
          <button
            type="button"
            key={o}
            className={`xd-segment-btn${value === o ? " active" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </label>
  );
}

const DASH_PRESETS: Array<{ label: string; value: number[] }> = [
  { label: "—", value: [] },
  { label: "–", value: [6, 4] },
  { label: "·", value: [2, 3] },
  { label: "—·", value: [10, 4, 2, 4] },
];

function StrokeDashField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const matchIdx = DASH_PRESETS.findIndex(
    (p) =>
      p.value.length === value.length &&
      p.value.every((n, i) => n === value[i]),
  );
  return (
    <label className="xd-field">
      <span>Dash</span>
      <div className="xd-segment">
        {DASH_PRESETS.map((p, i) => (
          <button
            type="button"
            key={i}
            className={`xd-segment-btn${matchIdx === i ? " active" : ""}`}
            onClick={() => onChange(p.value)}
            title={p.value.length === 0 ? "Solid" : p.value.join(" ")}
          >
            {p.label}
          </button>
        ))}
      </div>
    </label>
  );
}

type FillImage = {
  filePath: string;
  assetId: string | null;
  fit: "cover" | "contain";
};

function FillField({
  fill,
  gradient,
  image,
  onChangeFill,
  onChangeGradient,
  onChangeImage,
}: {
  fill: string;
  gradient: Gradient | null;
  image: FillImage | null;
  onChangeFill: (v: string) => void;
  onChangeGradient: (g: Gradient | null) => void;
  onChangeImage: (img: FillImage | null) => void;
}) {
  const mode: "solid" | "linear" | "radial" | "angular" | "image" = image
    ? "image"
    : gradient?.kind === "linear"
      ? "linear"
      : gradient?.kind === "radial"
        ? "radial"
        : gradient?.kind === "angular"
          ? "angular"
          : "solid";
  const [picker, setPicker] = useState(false);

  const baseStops = () => [
    { offset: 0, color: fill || "#ffffff" },
    { offset: 1, color: "#000000" },
  ];
  const startGradient = (kind: "linear" | "radial" | "angular") => {
    onChangeImage(null);
    if (kind === "linear")
      onChangeGradient({ kind: "linear", angle: 90, stops: baseStops() });
    else if (kind === "radial")
      onChangeGradient({ kind: "radial", stops: baseStops() });
    else onChangeGradient({ kind: "angular", startAngle: 0, stops: baseStops() });
  };
  const startSolid = () => {
    onChangeImage(null);
    onChangeGradient(null);
  };

  return (
    <div className="xd-fill-section">
      <div className="xd-fill-mode">
        <button
          type="button"
          className={`xd-fill-mode-btn${mode === "solid" ? " active" : ""}`}
          onClick={startSolid}
        >
          Solid
        </button>
        <button
          type="button"
          className={`xd-fill-mode-btn${mode === "linear" ? " active" : ""}`}
          onClick={() => {
            if (mode !== "linear") startGradient("linear");
          }}
        >
          Linear
        </button>
        <button
          type="button"
          className={`xd-fill-mode-btn${mode === "radial" ? " active" : ""}`}
          onClick={() => {
            if (mode !== "radial") startGradient("radial");
          }}
        >
          Radial
        </button>
        <button
          type="button"
          className={`xd-fill-mode-btn${mode === "angular" ? " active" : ""}`}
          onClick={() => {
            if (mode !== "angular") startGradient("angular");
          }}
        >
          Angular
        </button>
        <button
          type="button"
          className={`xd-fill-mode-btn${mode === "image" ? " active" : ""}`}
          onClick={() => {
            if (mode !== "image") setPicker(true);
          }}
        >
          Image
        </button>
      </div>

      {mode === "solid" && (
        <ColorField label="Fill" value={fill} onChange={onChangeFill} />
      )}

      {(mode === "linear" || mode === "radial" || mode === "angular") && gradient && (
        <>
          {gradient.kind === "linear" && (
            <div className="xd-fields">
              <NumField
                label="Angle"
                value={gradient.angle}
                onChange={(n) => {
                  const wrapped = ((n % 360) + 360) % 360;
                  onChangeGradient({ ...gradient, angle: wrapped });
                }}
                suffix="°"
              />
            </div>
          )}
          {gradient.kind === "angular" && (
            <div className="xd-fields">
              <NumField
                label="Start"
                value={gradient.startAngle ?? 0}
                onChange={(n) => {
                  const wrapped = ((n % 360) + 360) % 360;
                  onChangeGradient({ ...gradient, startAngle: wrapped });
                }}
                suffix="°"
              />
            </div>
          )}
          {gradient.stops.map((stop, i) => {
            const label =
              i === 0
                ? "Start"
                : i === gradient.stops.length - 1
                  ? "End"
                  : `Stop ${i}`;
            const canRemove = gradient.stops.length > 2;
            return (
              <div key={i} className="xd-stop-row">
                <ColorField
                  label={label}
                  value={stop.color}
                  onChange={(c) => {
                    const next = gradient.stops.slice();
                    next[i] = { ...next[i]!, color: c };
                    onChangeGradient({ ...gradient, stops: next });
                  }}
                />
                {canRemove && (
                  <button
                    type="button"
                    className="xd-stop-remove"
                    title="Remove stop"
                    onClick={() => {
                      const next = gradient.stops.filter((_, idx) => idx !== i);
                      onChangeGradient({ ...gradient, stops: next });
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="xd-stop-add"
            onClick={() => {
              // Insert a mid-stop between the last two existing stops.
              const stops = gradient.stops.slice();
              const last = stops[stops.length - 1]!;
              const prev = stops[stops.length - 2] ?? last;
              const mid = (prev.offset + last.offset) / 2;
              stops.splice(stops.length - 1, 0, {
                offset: mid,
                color: prev.color,
              });
              onChangeGradient({ ...gradient, stops });
            }}
          >
            <Plus size={10} /> Add stop
          </button>
        </>
      )}

      {mode === "image" && image && (
        <>
          <div className="xd-field">
            <span>Source</span>
            <button
              type="button"
              className="xd-fill-image-pick"
              onClick={() => setPicker(true)}
              title={image.filePath}
            >
              <ImageIcon size={11} /> Replace
            </button>
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Fit"
              value={image.fit}
              options={["cover", "contain"]}
              onChange={(v) =>
                onChangeImage({ ...image, fit: v as FillImage["fit"] })
              }
            />
          </div>
        </>
      )}

      {picker && (
        <XDesignImagePicker
          onClose={() => setPicker(false)}
          onPick={(asset) => {
            if (!asset.filePath) return;
            onChangeGradient(null);
            onChangeImage({
              filePath: asset.filePath,
              assetId: asset.id,
              fit: "cover",
            });
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}

function ExportRow() {
  const shapes = useXDesign((s) => s.shapes);
  const selection = useXDesign((s) => s.selection);
  const doExport = async (kind: "png" | "svg") => {
    const { computeExportBounds, exportPNG, exportSVG } = await import(
      "@/apps/xdesign/exportXD"
    );
    const bounds = computeExportBounds(shapes, selection);
    if (!bounds) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (kind === "svg") exportSVG(bounds, `xdesign-${stamp}.svg`);
    else void exportPNG(bounds, `xdesign-${stamp}.png`, 2);
  };
  return (
    <div className="xd-export-row">
      <button
        type="button"
        className="xd-effects-add"
        onClick={() => void doExport("png")}
        title="Export as PNG"
      >
        PNG
      </button>
      <button
        type="button"
        className="xd-effects-add"
        onClick={() => void doExport("svg")}
        title="Export as SVG"
      >
        SVG
      </button>
      <button
        type="button"
        className="xd-effects-add xd-export-react"
        onClick={() =>
          void import("@/apps/xdesign/exportToCode").then((m) =>
            m.exportSelectionToCode(),
          )
        }
        title="Export to React + design tokens (staged edit in Orion)"
      >
        ⌘ React
      </button>
    </div>
  );
}

export function XDesignInspector() {
  const shapes = useXDesign((s) => s.shapes);
  const selection = useXDesign((s) => s.selection);
  const updateShape = useXDesign((s) => s.updateShape);
  const pushHistory = useXDesign((s) => s.pushHistory);
  const patchMany = useXDesign((s) => s.patchMany);
  const booleanOp = useXDesign((s) => s.booleanOp);

  const commit = (id: string, patch: Partial<Shape>) => {
    pushHistory();
    updateShape(id, patch);
  };

  const selected = useMemo(
    () => shapes.filter((s) => selection.has(s.id)),
    [shapes, selection],
  );

  if (selected.length === 0) {
    return (
      <div className="xd-inspector scroll">
        <div className="heading">Properties</div>
        <div className="xd-inspector-empty">
          Select a layer to edit its properties.
          <br />
          <span className="hint">⌘/Shift-click for multi-select.</span>
        </div>
        <ExportRow />
      </div>
    );
  }

  if (selected.length > 1) {
    const minX = Math.min(...selected.map((s) => s.x));
    const minY = Math.min(...selected.map((s) => s.y));
    const maxX = Math.max(...selected.map((s) => s.x + s.w));
    const maxY = Math.max(...selected.map((s) => s.y + s.h));
    const ids = selected.map((s) => s.id);
    // Common value across the selection, or "" / undefined when mixed.
    const commonFill = selected.every((s) => s.fill === selected[0]!.fill)
      ? selected[0]!.fill
      : "";
    const commonOpacity = selected.every(
      (s) => (s.opacity ?? 1) === (selected[0]!.opacity ?? 1),
    )
      ? selected[0]!.opacity ?? 1
      : 1;

    const moveBy = (dx: number, dy: number) => {
      pushHistory();
      patchMany(ids, (s) => ({ x: s.x + dx, y: s.y + dy }));
    };

    return (
      <div className="xd-inspector scroll">
        <div className="heading">Properties</div>
        <div className="xd-inspector-multi">{selected.length} layers selected</div>
        <div className="xd-fields">
          <NumField label="X" value={Math.round(minX)} onChange={(v) => moveBy(v - minX, 0)} />
          <NumField label="Y" value={Math.round(minY)} onChange={(v) => moveBy(0, v - minY)} />
          <NumField label="W" value={Math.round(maxX - minX)} onChange={() => {}} />
          <NumField label="H" value={Math.round(maxY - minY)} onChange={() => {}} />
        </div>
        <div className="xd-section-label">Batch</div>
        <ColorField
          label="Fill"
          value={commonFill || "#000000"}
          onChange={(next) => {
            pushHistory();
            patchMany(ids, () => ({ fill: next }));
          }}
        />
        <div className="xd-fields">
          <NumField
            label="Opacity %"
            value={Math.round(commonOpacity * 100)}
            onChange={(v) => {
              pushHistory();
              patchMany(ids, () => ({ opacity: Math.max(0, Math.min(1, v / 100)) }));
            }}
          />
        </div>
        <div className="xd-section-label">Boolean</div>
        <div className="xd-bool-row">
          {(
            [
              ["union", "Union", "merge into one shape"],
              ["subtract", "Subtract", "remove upper shapes from the bottom one"],
              ["intersect", "Intersect", "keep only the overlap"],
              ["exclude", "Exclude", "keep everything except the overlap"],
            ] as Array<[BoolOp, string, string]>
          ).map(([op, label, hint]) => (
            <button
              key={op}
              type="button"
              className="xd-mini-btn"
              title={`${label} — ${hint}`}
              onClick={() => {
                if (!booleanOp(op, ids))
                  toast.warning(`${label} produced an empty result`);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const sh = selected[0]!;
  const isFrame = sh.kind === "frame";
  const isText = sh.kind === "text";
  const hasAL =
    isFrame &&
    sh.layoutMode !== undefined &&
    sh.layoutMode !== "none";
  // Constraints only matter when the parent is a frame WITHOUT auto-layout
  // (auto-layout parents drive children via layout sizing, not constraints).
  const parent = sh.parentId
    ? shapes.find((s) => s.id === sh.parentId)
    : undefined;
  const showConstraints =
    !!parent &&
    parent.kind === "frame" &&
    parent.layoutMode !== "horizontal" &&
    parent.layoutMode !== "vertical";

  return (
    <div className="xd-inspector scroll">
      <div className="heading">
        <span>{sh.kind.toUpperCase()}</span>
        <span className="xd-inspector-name">{sh.name}</span>
      </div>

      <Section title="Position">
        <TextField
          label="Name"
          value={sh.name}
          onChange={(name) => commit(sh.id, { name } as Partial<Shape>)}
        />
        <div className="xd-fields">
          <NumField
            label="X"
            value={sh.x}
            onChange={(n) => commit(sh.id, { x: n } as Partial<Shape>)}
          />
          <NumField
            label="Y"
            value={sh.y}
            onChange={(n) => commit(sh.id, { y: n } as Partial<Shape>)}
          />
        </div>
        <div className="xd-fields">
          <NumField
            label="W"
            value={sh.w}
            onChange={(n) => commit(sh.id, { w: Math.max(1, n) } as Partial<Shape>)}
          />
          <NumField
            label="H"
            value={sh.h}
            onChange={(n) => commit(sh.id, { h: Math.max(1, n) } as Partial<Shape>)}
          />
        </div>
        <div className="xd-fields">
          <NumField
            label="Rot"
            value={sh.rotation ?? 0}
            onChange={(n) => {
              const wrapped = ((n + 180) % 360 + 360) % 360 - 180;
              commit(sh.id, { rotation: wrapped } as Partial<Shape>);
            }}
            suffix="°"
          />
          <FlipRow
            flipX={!!sh.flipX}
            flipY={!!sh.flipY}
            onToggle={(axis) =>
              commit(sh.id, {
                [axis === "x" ? "flipX" : "flipY"]: !sh[axis === "x" ? "flipX" : "flipY"],
              } as Partial<Shape>)
            }
          />
        </div>
      </Section>

      {showConstraints && (
        <Section title="Constraints" defaultOpen={false}>
          <ConstraintsSection
            shape={sh}
            onChange={(patch) => commit(sh.id, patch as Partial<Shape>)}
          />
        </Section>
      )}

      <Section title="Appearance">
        <div className="xd-fields">
          <NumField
            label="Opacity"
            value={Math.round((sh.opacity ?? 1) * 100)}
            onChange={(n) =>
              commit(sh.id, {
                opacity: Math.max(0, Math.min(1, n / 100)),
              } as Partial<Shape>)
            }
            suffix="%"
          />
          <div className="xd-inline-actions">
            <button
              type="button"
              className={`xd-mini-btn${sh.hidden ? " active" : ""}`}
              title={sh.hidden ? "Show" : "Hide"}
              onClick={() => commit(sh.id, { hidden: !sh.hidden } as Partial<Shape>)}
            >
              {sh.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <button
              type="button"
              className={`xd-mini-btn${sh.locked ? " active" : ""}`}
              title={sh.locked ? "Unlock" : "Lock"}
              onClick={() => commit(sh.id, { locked: !sh.locked } as Partial<Shape>)}
            >
              {sh.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
          </div>
        </div>
        {(sh.kind === "rect" || sh.kind === "frame") && (
          <CornerRadiiField
            radius={sh.radius}
            radii={sh.radii ?? null}
            onChangeRadius={(n) =>
              commit(sh.id, {
                radius: Math.max(0, n),
                radii: undefined,
              } as Partial<Shape>)
            }
            onChangeRadii={(arr) =>
              commit(sh.id, {
                radii: arr ?? undefined,
              } as Partial<Shape>)
            }
          />
        )}
        {isFrame && (
          <div className="xd-field xd-visibility-row">
            <span>Clip</span>
            <div className="xd-visibility-actions">
              <button
                type="button"
                className={`xd-mini-btn${sh.clipContent ? " active" : ""}`}
                onClick={() =>
                  commit(sh.id, {
                    clipContent: !sh.clipContent,
                  } as Partial<Shape>)
                }
              >
                {sh.clipContent ? "On" : "Off"}
              </button>
            </div>
          </div>
        )}
      </Section>

      {isFrame && (
        <Section title="Auto-layout" defaultOpen={hasAL}>
          <AutoLayoutSection
            frame={sh}
            onChange={(patch) => commit(sh.id, patch as Partial<Shape>)}
          />
        </Section>
      )}

      <Section title="Sizing" defaultOpen={false}>
        <LayoutSizingRow shape={sh} onCommit={commit} />
      </Section>

      {isText && (
        <Section title="Text">
          <TextField
            label="Body"
            value={sh.text}
            onChange={(text) => commit(sh.id, { text } as Partial<Shape>)}
          />
          <TextField
            label="Font"
            value={sh.fontFamily ?? "Space Grotesk"}
            onChange={(v) => commit(sh.id, { fontFamily: v } as Partial<Shape>)}
          />
          <div className="xd-fields">
            <NumField
              label="Size"
              value={sh.fontSize}
              onChange={(n) => commit(sh.id, { fontSize: Math.max(6, n) } as Partial<Shape>)}
              suffix="px"
            />
            <NumField
              label="Wt"
              value={sh.fontWeight ?? 400}
              onChange={(n) =>
                commit(sh.id, {
                  fontWeight: Math.max(100, Math.min(900, n)),
                } as Partial<Shape>)
              }
              step={100}
            />
          </div>
          <div className="xd-fields">
            <NumField
              label="Line"
              value={sh.lineHeight ?? 1.2}
              onChange={(n) =>
                commit(sh.id, { lineHeight: Math.max(0.5, n) } as Partial<Shape>)
              }
              step={0.05}
            />
            <NumField
              label="Letter"
              value={sh.letterSpacing ?? 0}
              onChange={(n) => commit(sh.id, { letterSpacing: n } as Partial<Shape>)}
              step={0.1}
              suffix="px"
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Align"
              value={sh.textAlign ?? "left"}
              options={["left", "center", "right", "justify"]}
              onChange={(v) =>
                commit(sh.id, {
                  textAlign: v as "left" | "center" | "right" | "justify",
                } as Partial<Shape>)
              }
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Case"
              value={sh.textCase ?? "as-typed"}
              options={["as-typed", "upper", "lower", "title"]}
              onChange={(v) =>
                commit(sh.id, {
                  textCase: v as "as-typed" | "upper" | "lower" | "title",
                } as Partial<Shape>)
              }
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Deco"
              value={sh.textDecoration ?? "none"}
              options={["none", "underline", "strikethrough"]}
              onChange={(v) =>
                commit(sh.id, {
                  textDecoration: v as "none" | "underline" | "strikethrough",
                } as Partial<Shape>)
              }
            />
          </div>
        </Section>
      )}

      <Section title="Fill">
        <FillField
          fill={sh.fill}
          gradient={sh.fillGradient ?? null}
          image={sh.fillImage ?? null}
          onChangeFill={(v) => commit(sh.id, { fill: v } as Partial<Shape>)}
          onChangeGradient={(g) =>
            commit(sh.id, { fillGradient: g ?? undefined } as Partial<Shape>)
          }
          onChangeImage={(img) =>
            commit(sh.id, { fillImage: img ?? undefined } as Partial<Shape>)
          }
        />
      </Section>

      <Section title="Stroke">
        <ColorField
          label="Color"
          value={sh.stroke}
          onChange={(v) => commit(sh.id, { stroke: v } as Partial<Shape>)}
        />
        <div className="xd-fields">
          <NumField
            label="Width"
            value={sh.strokeWidth}
            onChange={(n) =>
              commit(sh.id, { strokeWidth: Math.max(0, n) } as Partial<Shape>)
            }
            step={0.5}
          />
          <SegmentField
            label="Pos"
            value={sh.strokeAlign ?? "center"}
            options={["inside", "center", "outside"]}
            onChange={(v) =>
              commit(sh.id, {
                strokeAlign: v as Shape["strokeAlign"],
              } as Partial<Shape>)
            }
          />
        </div>
        <Section title="Advanced" defaultOpen={false}>
          <StrokeDashField
            value={sh.strokeDash ?? []}
            onChange={(arr) =>
              commit(sh.id, {
                strokeDash: arr.length > 0 ? arr : undefined,
              } as Partial<Shape>)
            }
          />
          <div className="xd-fields">
            <SegmentField
              label="Cap"
              value={sh.strokeCap ?? "butt"}
              options={["butt", "round", "square"]}
              onChange={(v) =>
                commit(sh.id, {
                  strokeCap: v as Shape["strokeCap"],
                } as Partial<Shape>)
              }
            />
          </div>
          <div className="xd-fields">
            <SegmentField
              label="Join"
              value={sh.strokeJoin ?? "miter"}
              options={["miter", "round", "bevel"]}
              onChange={(v) =>
                commit(sh.id, {
                  strokeJoin: v as Shape["strokeJoin"],
                } as Partial<Shape>)
              }
            />
          </div>
        </Section>
      </Section>

      <Section title="Effects" defaultOpen={false}>
        <EffectsSection
          effects={sh.effects ?? []}
          onChange={(effects) => commit(sh.id, { effects } as Partial<Shape>)}
        />
      </Section>

      <ComponentSection shape={sh} />

      <PrototypeSection shape={sh} />

      <Section title="Export" defaultOpen={false}>
        <ExportRow />
      </Section>
    </div>
  );
}

const H_CONSTRAINT_OPTIONS: { value: ConstraintH; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "left-right", label: "Left & right" },
  { value: "center", label: "Center" },
  { value: "scale", label: "Scale" },
];
const V_CONSTRAINT_OPTIONS: { value: ConstraintV; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "top-bottom", label: "Top & bottom" },
  { value: "center", label: "Center" },
  { value: "scale", label: "Scale" },
];

function hSides(c: ConstraintH): { s: boolean; e: boolean } {
  if (c === "left") return { s: true, e: false };
  if (c === "right") return { s: false, e: true };
  if (c === "left-right") return { s: true, e: true };
  return { s: false, e: false }; // center / scale render unpinned
}
function vSides(c: ConstraintV): { s: boolean; e: boolean } {
  if (c === "top") return { s: true, e: false };
  if (c === "bottom") return { s: false, e: true };
  if (c === "top-bottom") return { s: true, e: true };
  return { s: false, e: false };
}
const hFromSides = (s: boolean, e: boolean): ConstraintH =>
  s && e ? "left-right" : s ? "left" : e ? "right" : "center";
const vFromSides = (s: boolean, e: boolean): ConstraintV =>
  s && e ? "top-bottom" : s ? "top" : e ? "bottom" : "center";

/** Figma-style pin box + dropdowns for resize constraints. Both controls read
 * and write the same shape fields, so they can never drift. */
function ConstraintsSection({
  shape,
  onChange,
}: {
  shape: Shape;
  onChange: (patch: { constraintH?: ConstraintH; constraintV?: ConstraintV }) => void;
}) {
  const ch = shape.constraintH ?? "left";
  const cv = shape.constraintV ?? "top";
  const h = hSides(ch);
  const v = vSides(cv);
  const accent = "var(--xd-accent, var(--neon-magenta, #ff3ea5))";
  const faint = "var(--glass-border, rgba(255,255,255,0.18))";
  const strut = (active: boolean, scale: boolean): CSSProperties => ({
    stroke: active ? accent : faint,
    strokeWidth: active ? 2.5 : 1.5,
    strokeDasharray: scale ? "3 2" : undefined,
  });
  const toggleLeft = () => onChange({ constraintH: hFromSides(!h.s, h.e) });
  const toggleRight = () => onChange({ constraintH: hFromSides(h.s, !h.e) });
  const toggleTop = () => onChange({ constraintV: vFromSides(!v.s, v.e) });
  const toggleBottom = () => onChange({ constraintV: vFromSides(v.s, !v.e) });
  const hScale = ch === "scale";
  const vScale = cv === "scale";

  return (
    <div className="xd-constraints">
      <svg
        width={72}
        height={72}
        viewBox="0 0 72 72"
        style={{ display: "block", margin: "0 auto 8px" }}
      >
        <rect
          x={8}
          y={8}
          width={56}
          height={56}
          rx={3}
          fill="none"
          stroke={faint}
          strokeWidth={1}
        />
        {/* struts */}
        <line x1={36} y1={8} x2={36} y2={28} style={strut(v.s, vScale)} />
        <line x1={36} y1={44} x2={36} y2={64} style={strut(v.e, vScale)} />
        <line x1={8} y1={36} x2={28} y2={36} style={strut(h.s, hScale)} />
        <line x1={44} y1={36} x2={64} y2={36} style={strut(h.e, hScale)} />
        <rect
          x={28}
          y={28}
          width={16}
          height={16}
          rx={2}
          fill="rgba(255,255,255,0.06)"
          stroke={faint}
          strokeWidth={1}
        />
        {/* invisible hit targets */}
        <rect x={28} y={4} width={16} height={22} fill="transparent" cursor="pointer" onClick={toggleTop}>
          <title>Pin top</title>
        </rect>
        <rect x={28} y={46} width={16} height={22} fill="transparent" cursor="pointer" onClick={toggleBottom}>
          <title>Pin bottom</title>
        </rect>
        <rect x={4} y={28} width={22} height={16} fill="transparent" cursor="pointer" onClick={toggleLeft}>
          <title>Pin left</title>
        </rect>
        <rect x={46} y={28} width={22} height={16} fill="transparent" cursor="pointer" onClick={toggleRight}>
          <title>Pin right</title>
        </rect>
      </svg>
      <div className="xd-fields">
        <label className="xd-field">
          <span>Horizontal</span>
          <select
            value={ch}
            onChange={(e) => onChange({ constraintH: e.target.value as ConstraintH })}
          >
            {H_CONSTRAINT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="xd-field">
          <span>Vertical</span>
          <select
            value={cv}
            onChange={(e) => onChange({ constraintV: e.target.value as ConstraintV })}
          >
            {V_CONSTRAINT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function ComponentSection({ shape }: { shape: Shape }) {
  const toggleMain = useXDesign((s) => s.toggleMainComponent);
  const createInstance = useXDesign((s) => s.createInstance);
  const syncFromMain = useXDesign((s) => s.syncFromMain);
  const detachInstance = useXDesign((s) => s.detachInstance);
  const resetInstanceOverrides = useXDesign((s) => s.resetInstanceOverrides);
  const toggleVariantSet = useXDesign((s) => s.toggleVariantSet);
  const setVariantProps = useXDesign((s) => s.setVariantProps);
  const setVariantSelection = useXDesign((s) => s.setVariantSelection);
  const shapes = useXDesign((s) => s.shapes);
  const isMain = !!shape.isMain;
  const isFrame = shape.kind === "frame";
  const linkedId = shape.linkedMainId;
  const mainExists = linkedId
    ? shapes.some((s) => s.id === linkedId && s.isMain)
    : false;
  // Overrides live on the instance ROOT — resolve it even when a descendant
  // is selected so Reset is reachable from anywhere in the instance.
  const instRoot = linkedId ? findInstanceRoot(shapes, shape.id) : null;
  const hasOverrides =
    !!instRoot?.overrides && Object.keys(instRoot.overrides).length > 0;

  // Variant wiring: the set frame this main/instance belongs to + its members.
  const memberMain = linkedId ? shapes.find((s) => s.id === linkedId) : undefined;
  const setFrame = isMain
    ? shape.parentId
      ? shapes.find((s) => s.id === shape.parentId && s.isVariantSet)
      : undefined
    : memberMain?.parentId
      ? shapes.find((s) => s.id === memberMain.parentId && s.isVariantSet)
      : undefined;
  const members = setFrame
    ? shapes.filter((s) => s.parentId === setFrame.id && s.isMain)
    : [];
  const variantProps = variantProperties(
    members.map((m) => ({ id: m.id, variantProps: m.variantProps })),
  );
  const inSet = !!setFrame && members.length > 0;
  // The instance dropdown swaps via the instance ROOT (selection lives there).
  const memberList = members.map((m) => ({ id: m.id, variantProps: m.variantProps }));
  const selection: Record<string, string> =
    inSet && instRoot
      ? instRoot.variantSelection ?? defaultSelection(memberList)
      : {};

  return (
    <Section title="Component" defaultOpen={isMain || !!linkedId}>
      <div className="xd-fields">
        <button
          type="button"
          className={`xd-mini-btn${isMain ? " active" : ""}`}
          style={{ width: "auto", padding: "0 8px" }}
          onClick={() => toggleMain(shape.id)}
        >
          {isMain ? "✓ Main" : "Mark as main"}
        </button>
        {isFrame && (
          <button
            type="button"
            className={`xd-mini-btn${shape.isVariantSet ? " active" : ""}`}
            style={{ width: "auto", padding: "0 8px" }}
            onClick={() => toggleVariantSet(shape.id)}
            title="Treat this frame as a variant set (its main children are the variants)"
          >
            {shape.isVariantSet ? "✓ Variant set" : "Variant set"}
          </button>
        )}
        {isMain && (
          <button
            type="button"
            className="xd-mini-btn"
            style={{ width: "auto", padding: "0 8px" }}
            onClick={() => createInstance(shape.id)}
            title="Create a new instance of this main"
          >
            + Instance
          </button>
        )}
      </div>
      {isMain && setFrame && (
        <VariantPropsEditor
          value={shape.variantProps ?? {}}
          onChange={(props) => setVariantProps(shape.id, props)}
        />
      )}
      {linkedId && (
        <>
          <div className="xd-effect-row-head">
            <span className="kind">
              {mainExists ? "Linked instance" : "Broken link"}
            </span>
          </div>
          {inSet && instRoot && (
            <div className="xd-fields" style={{ flexWrap: "wrap" }}>
              {Object.entries(variantProps).map(([name, values]) => (
                <label className="xd-field" key={name}>
                  <span>{name}</span>
                  <select
                    value={selection[name] ?? values[0]}
                    onChange={(e) =>
                      setVariantSelection(instRoot.id, {
                        ...selection,
                        [name]: e.target.value,
                      })
                    }
                  >
                    {values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="xd-fields">
            <button
              type="button"
              className="xd-mini-btn"
              style={{ width: "auto", padding: "0 8px" }}
              onClick={() => syncFromMain(shape.id)}
              disabled={!mainExists}
              title="Replace this instance with a fresh copy of the main"
            >
              Sync
            </button>
            <button
              type="button"
              className="xd-mini-btn"
              style={{ width: "auto", padding: "0 8px" }}
              onClick={() => detachInstance(shape.id)}
              title="Break the link to the main"
            >
              Detach
            </button>
            {hasOverrides && instRoot && (
              <button
                type="button"
                className="xd-mini-btn"
                style={{ width: "auto", padding: "0 8px" }}
                onClick={() => resetInstanceOverrides(instRoot.id)}
                disabled={!mainExists}
                title="Discard local edits and re-sync this instance to main"
              >
                Reset overrides
              </button>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

const TRANSITIONS: { value: ProtoTransition; label: string }[] = [
  { value: "instant", label: "Instant" },
  { value: "dissolve", label: "Dissolve" },
  { value: "slide", label: "Slide" },
];

/** Configure a shape's prototype hotspot: navigate to a screen (or back), with
 * a transition. Screens are the top-level frames. */
function PrototypeSection({ shape }: { shape: Shape }) {
  const setPrototype = useXDesign((s) => s.setPrototype);
  const shapes = useXDesign((s) => s.shapes);
  const link = shape.prototype;
  const frames = topLevelFrames(shapes);
  // Don't offer the shape's own screen as a navigate target.
  const ownScreen = topLevelFrameAncestor(shapes, shape.id)?.id;
  const targets = frames.filter((f) => f.id !== ownScreen);

  const update = (patch: Partial<ProtoLink>) =>
    setPrototype(shape.id, { ...(link ?? { trigger: "click", action: "navigate" }), ...patch });

  return (
    <Section title="Prototype" defaultOpen={!!link}>
      {!link ? (
        <button
          type="button"
          className="xd-mini-btn"
          style={{ width: "auto", padding: "0 8px" }}
          onClick={() =>
            setPrototype(shape.id, {
              trigger: "click",
              action: "navigate",
              target: targets[0]?.id,
              transition: "instant",
            })
          }
          title="Make this shape a clickable hotspot in present mode"
        >
          + Add interaction
        </button>
      ) : (
        <>
          <label className="xd-field">
            <span>On click</span>
            <select
              value={link.action}
              onChange={(e) => update({ action: e.target.value as ProtoLink["action"] })}
            >
              <option value="navigate">Navigate to…</option>
              <option value="back">Back</option>
            </select>
          </label>
          {link.action === "navigate" && (
            <label className="xd-field">
              <span>Screen</span>
              <select
                value={link.target ?? ""}
                onChange={(e) => update({ target: e.target.value })}
              >
                {targets.length === 0 && <option value="">(no other frames)</option>}
                {targets.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="xd-field">
            <span>Animate</span>
            <select
              value={link.transition ?? "instant"}
              onChange={(e) => update({ transition: e.target.value as ProtoTransition })}
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="xd-mini-btn"
            style={{ width: "auto", padding: "0 8px" }}
            onClick={() => setPrototype(shape.id, undefined)}
            title="Remove this hotspot"
          >
            Remove
          </button>
        </>
      )}
    </Section>
  );
}

function serializeVariantProps(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
function parseVariantProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

/** Free-text `Name=value, Name=value` editor for a variant member's props. */
function VariantPropsEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (props: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState(() => serializeVariantProps(value));
  useEffect(() => {
    setDraft(serializeVariantProps(value));
  }, [value]);
  return (
    <label className="xd-field">
      <span>Variant props</span>
      <input
        type="text"
        value={draft}
        placeholder="State=hover, Size=lg"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onChange(parseVariantProps(draft))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

function EffectsSection({
  effects,
  onChange,
}: {
  effects: Effect[];
  onChange: (next: Effect[]) => void;
}) {
  const addDrop = () => {
    onChange([
      ...effects,
      {
        kind: "shadow",
        type: "drop",
        offsetX: 0,
        offsetY: 4,
        blur: 12,
        color: "rgba(0, 0, 0, 0.45)",
      },
    ]);
  };
  const addInner = () => {
    onChange([
      ...effects,
      {
        kind: "shadow",
        type: "inner",
        offsetX: 0,
        offsetY: 4,
        blur: 8,
        color: "rgba(0, 0, 0, 0.4)",
      },
    ]);
  };
  const addBlur = () => {
    onChange([...effects, { kind: "blur", radius: 6 }]);
  };
  const updateAt = (idx: number, patch: Partial<Effect>) => {
    onChange(
      effects.map((e, i) => (i === idx ? ({ ...e, ...patch } as Effect) : e)),
    );
  };
  const removeAt = (idx: number) => {
    onChange(effects.filter((_, i) => i !== idx));
  };

  return (
    <>
      <div className="xd-effects-actions xd-effects-actions-stretch">
        <button type="button" className="xd-effects-add" onClick={addDrop} title="Drop shadow">
          <Plus size={10} /> Drop
        </button>
        <button type="button" className="xd-effects-add" onClick={addInner} title="Inner shadow">
          <Plus size={10} /> Inner
        </button>
        <button type="button" className="xd-effects-add" onClick={addBlur} title="Layer blur">
          <Plus size={10} /> Blur
        </button>
      </div>
      {effects.length === 0 ? (
        <div className="xd-effects-empty">No effects.</div>
      ) : (
        effects.map((e, i) => (
          <div key={i} className="xd-effect-row">
            <div className="xd-effect-row-head">
              <span className="kind">
                {e.kind === "blur"
                  ? "Layer blur"
                  : e.type === "drop"
                    ? "Drop shadow"
                    : "Inner shadow"}
              </span>
              <button
                type="button"
                className="xd-effect-remove"
                onClick={() => removeAt(i)}
                title="Remove"
              >
                <X size={11} />
              </button>
            </div>
            {e.kind === "shadow" && (
              <>
                <div className="xd-fields">
                  <NumField
                    label="X"
                    value={e.offsetX}
                    onChange={(n) => updateAt(i, { offsetX: n })}
                  />
                  <NumField
                    label="Y"
                    value={e.offsetY}
                    onChange={(n) => updateAt(i, { offsetY: n })}
                  />
                </div>
                <div className="xd-fields">
                  <NumField
                    label="Blur"
                    value={e.blur}
                    onChange={(n) => updateAt(i, { blur: Math.max(0, n) })}
                  />
                </div>
                <ColorField
                  label="Color"
                  value={e.color}
                  onChange={(v) => updateAt(i, { color: v })}
                />
              </>
            )}
            {e.kind === "blur" && (
              <div className="xd-fields">
                <NumField
                  label="Radius"
                  value={e.radius}
                  onChange={(n) => updateAt(i, { radius: Math.max(0, n) })}
                />
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}
