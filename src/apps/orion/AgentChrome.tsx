import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { AgentCliInfo } from "@/lib/ipc";
import type { AgentCli } from "@/components/workspace/types";
import { toast } from "@/store/toastStore";
import {
  CLAUDE_MARK,
  CODEX_KNOT,
  CODEX_PROMPT_COLOR,
  HERMES_CADUCEUS,
  HERMES_GOLD,
  PI_MARK,
  type Run,
} from "./agentMarks";
import { AGENT_MODES, modelLabel, type AgentChoice } from "./store/agentOptionsStore";
import { ProviderLogo } from "@/shell/notch/ProviderLogo";

/** Small brand mark for the tab header: the product's logo, or Pi's own block mark. */
export function AgentBrand({ agent }: { agent: AgentCli }) {
  if (agent === "pi") {
    return (
      <span className="or-agent-brand pi" aria-hidden="true">
        <pre>{PI_MARK.map((r, i) => <div key={i}><Runs runs={r} /></div>)}</pre>
      </span>
    );
  }
  const brand = agent === "claude" ? "claude" : agent === "codex" ? "openai" : "nousresearch";
  return <span className={`or-agent-brand ${agent}`}><ProviderLogo brand={brand} /></span>;
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map(([color, text], i) => (
        <span key={i} style={color ? { color } : undefined}>{text}</span>
      ))}
    </>
  );
}

function Mark({ rows }: { rows: Run[][] }) {
  return (
    <pre className="or-agent-mark-art" aria-hidden="true">
      {rows.map((r, i) => <div key={i}><Runs runs={r} /></div>)}
    </pre>
  );
}

/** Claude Code shows aliases like `opus[1m]`; render them the way its banner does. */
export function prettyModel(agent: AgentCli, info: AgentCliInfo | undefined, id: string | null): string {
  if (!id) return "";
  if (agent === "claude") {
    const alias = /^(opus|sonnet|haiku|fable)(\[1m\])?$/i.exec(id);
    if (alias) return `${alias[1]![0]!.toUpperCase()}${alias[1]!.slice(1)}${alias[2] ? " (1M context)" : ""}`;
  }
  return modelLabel(info, id);
}

/** Separate facts that wrap between each other (never mid-path) when the panel is narrow. */
function Facts({ items, className = "dim", titles = {} }: { items: (string | false | null | undefined)[]; className?: string; titles?: Record<string, string> }) {
  const shown = items.filter(Boolean) as string[];
  if (!shown.length) return <div className={className}>{"\u00a0"}</div>;
  return (
    <div className={`or-agent-facts ${className}`}>
      {shown.map((t, i) => (
        <span key={i} className="seg" title={titles[t] ?? t}>{i > 0 && <span className="sep">·</span>}{t}</span>
      ))}
    </div>
  );
}

/** `~/…/parent/name` for deep folders; the full path is in the tooltip. */
export function shortPath(p: string): string {
  const t = p.replace(/^\/Users\/[^/]+(?=\/|$)/, "~").replace(/^\/home\/[^/]+(?=\/|$)/, "~");
  const parts = t.split("/").filter(Boolean);
  if (parts.length <= 3) return t;
  return `${t.startsWith("/") ? "/" : `${parts[0]}/`}…/${parts.slice(-2).join("/")}`;
}

/**
 * The empty Chat view: the agent's own start-screen mark and header, as its
 * Terminal view draws them, centered.
 */
export function AgentWelcome({
  agent,
  info,
  choice,
  projectPath,
}: {
  agent: AgentCli;
  info: AgentCliInfo | "loading" | "error" | undefined;
  choice: AgentChoice;
  projectPath: string | null;
}) {
  const ready = info && info !== "loading" && info !== "error" ? info : undefined;
  const version = ready?.version ?? "";
  const model = prettyModel(agent, ready, choice.model ?? ready?.defaultModel ?? null);
  const effort = choice.effort ?? ready?.defaultEffort ?? "";
  const where = projectPath ? shortPath(projectPath) : "";
  const titles = where && projectPath ? { [where]: projectPath } : {};
  const modelLine = [model, effort && `${effort}${agent === "claude" ? " effort" : ""}`].filter(Boolean).join(agent === "claude" ? " with " : " · ");

  let body: ReactNode;
  switch (agent) {
    case "claude":
      body = (
        <div className="or-agent-mark-row">
          <Mark rows={CLAUDE_MARK} />
          <div className="or-agent-mark-text">
            <Facts className="title" items={["Claude Code", version && `v${version}`]} />
            <Facts items={[modelLine]} />
            <Facts items={[where]} titles={titles} />
          </div>
        </div>
      );
      break;
    case "codex":
      body = (
        <div className="or-agent-mark-col">
          <pre className="or-agent-mark-art knot" aria-hidden="true">{CODEX_KNOT.join("\n")}</pre>
          <div className="or-agent-mark-text center">
            <div><span style={{ color: CODEX_PROMPT_COLOR }}>&gt;_</span> <b>OpenAI Codex</b>{version && ` (v${version})`}</div>
            <Facts items={[modelLine, where]} titles={titles} />
          </div>
        </div>
      );
      break;
    case "pi":
      body = (
        <div className="or-agent-mark-col">
          <div className="or-agent-mark-row">
            <Mark rows={PI_MARK} />
            <div className="or-agent-mark-text">
              <Facts className="title" items={["pi", version && `v${version}`]} />
              <Facts items={[modelLine]} />
            </div>
          </div>
          <div className="or-agent-mark-text center"><Facts items={[where]} titles={titles} /></div>
        </div>
      );
      break;
    case "hermes":
      body = (
        <div className="or-agent-mark-col">
          <pre className="or-agent-mark-art caduceus" aria-hidden="true">
            {HERMES_CADUCEUS.map(([c, t], i) => <div key={i} style={{ color: c ?? undefined }}>{t}</div>)}
          </pre>
          <div className="or-agent-mark-text center">
            <div><b style={{ color: HERMES_GOLD }} className="hermes-name">Hermes Agent</b> {version && <span className="dim">v{version}</span>}</div>
            <Facts items={[modelLine, where]} titles={titles} />
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="or-agent-welcome" data-agent={agent}>
      {body}
      {ready && !ready.installed && <InstallHint agent={agent} command={ready.install} />}
    </div>
  );
}

function InstallHint({ agent, command }: { agent: AgentCli; command: string }) {
  return (
    <div className="or-agent-install">
      <div>{agent === "hermes" ? "Hermes" : agent} isn't installed on this Mac. Install it, then reopen this tab:</div>
      <button
        type="button"
        className="or-agent-install-cmd"
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => toast.success("Copied"));
        }}
      >
        <code>{command}</code>
        <Copy size={12} />
      </button>
    </div>
  );
}

type Opt = { id: string | null; label: string; hint?: string; group?: string | null };

/** A compact pill that opens a list above the composer (Cursor's model/mode pickers). */
function Picker({
  label,
  title,
  options,
  value,
  onPick,
  searchable,
  footer,
}: {
  label: string;
  title: string;
  options: Opt[];
  value: string | null;
  onPick: (id: string | null) => void;
  searchable?: boolean;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The menu is portaled to <body> so pane/window overflow can't clip it or eat its clicks.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(260, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const above = r.top - 8;
      const below = window.innerHeight - r.bottom - 8;
      // Open upward like Cursor's composer menus, unless there's more room below.
      setPos(above >= Math.min(340, below) || above >= 340
        ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(340, above) }
        : { left, width, top: r.bottom + 6, maxHeight: Math.min(340, below) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => `${o.label} ${o.id ?? ""} ${o.group ?? ""}`.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  let lastGroup: string | null | undefined;
  return (
    <div className="or-agent-picker" ref={ref}>
      <button
        type="button"
        className={`or-agent-pill${open ? " open" : ""}`}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
      >
        <span>{label}</span>
        <ChevronDown size={11} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="or-agent-menu" style={pos} role="listbox" aria-label={title}>
          {searchable && (
            <input
              ref={searchRef}
              className="or-agent-menu-search"
              placeholder="Search models"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              spellCheck={false}
            />
          )}
          <div className="or-agent-menu-list">
            {shown.map((o) => {
              const head = o.group !== lastGroup && o.group ? <div className="or-agent-menu-group">{o.group}</div> : null;
              lastGroup = o.group;
              return (
                <div key={`${o.group ?? ""}:${o.id ?? "default"}`}>
                  {head}
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === o.id}
                    className="or-agent-menu-item"
                    onClick={() => { onPick(o.id); setOpen(false); }}
                  >
                    <span className="ck">{value === o.id && <Check size={12} />}</span>
                    <span className="lb">{o.label}</span>
                    {o.hint && <span className="ht">{o.hint}</span>}
                  </button>
                </div>
              );
            })}
            {shown.length === 0 && <div className="or-agent-menu-empty">No matches</div>}
          </div>
          {footer && <div className="or-agent-menu-foot">{footer}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Model, effort and mode pickers for one agent; unset = the CLI's own default. */
export function AgentPickers({
  agent,
  info,
  choice,
  onChange,
  disabled,
}: {
  agent: AgentCli;
  info: AgentCliInfo | "loading" | "error" | undefined;
  choice: AgentChoice;
  onChange: (patch: Partial<AgentChoice>) => void;
  disabled?: boolean;
}) {
  const ready = info && info !== "loading" && info !== "error" ? info : undefined;
  if (!ready?.installed) return null;
  const defModel = prettyModel(agent, ready, ready.defaultModel);
  const models: Opt[] = [
    { id: null, label: defModel ? `Default · ${defModel}` : "Default" },
    ...ready.models.map((m) => ({ id: m.id, label: m.label, group: m.group })),
  ];
  // Keep a saved choice visible even if the CLI stopped listing it.
  if (choice.model && !models.some((m) => m.id === choice.model)) models.push({ id: choice.model, label: choice.model });
  const efforts: Opt[] = [
    { id: null, label: ready.defaultEffort ? `Default · ${ready.defaultEffort}` : "Default" },
    ...ready.efforts.map((e) => ({ id: e, label: e })),
  ];
  const modes = AGENT_MODES[agent].map((m) => ({ id: m.id, label: m.label, hint: m.hint }));
  const modeLabel = AGENT_MODES[agent].find((m) => m.id === choice.mode)?.label ?? AGENT_MODES[agent][0]?.label ?? "";
  const effortWord = agent === "pi" ? "thinking" : agent === "hermes" ? "reasoning" : "effort";

  return (
    <div className="or-agent-pickers" aria-disabled={disabled || undefined}>
      {modes.length > 0 && (
        <Picker label={modeLabel} title="Mode" options={modes} value={choice.mode} onPick={(mode) => onChange({ mode })} />
      )}
      <Picker
        label={prettyModel(agent, ready, choice.model) || defModel || "Model"}
        title="Model"
        options={models}
        value={choice.model}
        searchable={models.length > 10}
        onPick={(model) => onChange({ model })}
        footer={agent === "hermes" ? <>Other providers: run <code>hermes model</code> in the Terminal view.</> : undefined}
      />
      {ready.efforts.length > 0 && (
        <Picker
          label={choice.effort ?? ready.defaultEffort ?? effortWord}
          title={effortWord[0]!.toUpperCase() + effortWord.slice(1)}
          options={efforts}
          value={choice.effort}
          onPick={(effort) => onChange({ effort })}
        />
      )}
    </div>
  );
}
