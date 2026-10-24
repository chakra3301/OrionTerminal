import { useEffect, type Dispatch, type SetStateAction } from "react";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { useProvidersStore } from "@/store/providersStore";
import { attachableText, skillModelScope, CONTEXT_LIMITS, type SkillTurnChoice } from "./skillActivation";
import "./skillIntake.css";

export function SkillTurnPicker({ value, chatKey, choice, onChange, disabled }: { value: string; chatKey: string; choice: SkillTurnChoice; onChange: Dispatch<SetStateAction<SkillTurnChoice>>; disabled: boolean }) {
  const packages = useSkillsStore((s) => s.packages), loaded = useSkillsStore((s) => s.loaded), mutating = useSkillsStore((s) => s.mutating);
  const agent = useAgentsStore((s) => value.startsWith("agent:") ? s.agents.get(value.slice(6)) : undefined);
  const providers = useProvidersStore((s) => s.providers);
  const model = agent?.brainModel ?? value, modelScope = skillModelScope(model, providers);
  useEffect(() => {
    const ids = agent?.skillIds.filter((id) => id.startsWith("imported:")) ?? [];
    onChange({ contextLimit: 0, modelScope, selections: ids.flatMap((skillId) => {
      const p = packages.get(skillId);
      return p ? [{ skillId, versionId: p.active.id, paths: [] }] : [];
    }) });
  }, [agent, value, chatKey, packages, modelScope, onChange]);
  const selected = choice.selections;
  const unavailable = agent?.skillIds.filter((id) => id.startsWith("imported:") && !packages.get(id)?.enabled) ?? [];
  const bytes = selected.reduce((n, s) => n + (packages.get(s.skillId)?.active.files.filter((f) => f.path.endsWith("/SKILL.md") || s.paths.includes(f.path)).reduce((n, f) => n + f.bytes, 0) ?? 0), 0);
  return <details className="skill-turn-picker" open={selected.length > 0 || unavailable.length > 0}>
    <summary><span className="skill-turn-label">Skill for this turn</span><span className="skill-turn-value">{selected.length ? `${selected.length} selected` : "None"}</span></summary>
    <fieldset disabled={disabled || !loaded || mutating}>
      {!value.startsWith("agent:") && <label>Imported skill<select className="cp-input" value={selected[0]?.skillId ?? ""} onChange={(e) => {
        const p = packages.get(e.target.value);
        onChange({ contextLimit: 0, modelScope, selections: p ? [{ skillId: p.skillId, versionId: p.active.id, paths: [] }] : [] });
      }}><option value="">None</option>{[...packages.values()].map((p) => <option key={p.skillId} value={p.skillId} disabled={!p.enabled}>{p.active.metadata.name}{p.enabled ? "" : " · disabled"}</option>)}</select></label>}
      {value.startsWith("agent:") && selected.length === 0 && !unavailable.length && <p>Attach imported skills to this agent in Agent Forge.</p>}
      {unavailable.length > 0 && <p role="alert">An attached imported skill is missing or disabled. Repair this agent in Agent Forge before sending.</p>}
      {selected.map((s) => {
        const p = packages.get(s.skillId);
        if (!p) return <p role="alert" key={s.skillId}>Missing skill: {s.skillId}</p>;
        return <div key={s.skillId}><b>{p.active.metadata.name}</b><p>Full SKILL.md · version {s.versionId.slice(-8)}</p>
          {p.active.files.filter((f) => !f.path.endsWith("/SKILL.md") && attachableText(f)).map((f) => <label className="skill-turn-resource" key={f.path}>
            <input type="checkbox" checked={s.paths.includes(f.path)} disabled={!s.paths.includes(f.path) && s.paths.length >= 8} onChange={(e) => { const checked = e.target.checked; onChange((old) => ({ ...old, selections: old.selections.map((entry) => entry.skillId === s.skillId ? { ...entry, paths: checked ? [...entry.paths, f.path] : entry.paths.filter((path) => path !== f.path) } : entry) })); }} />{f.path} · {f.bytes.toLocaleString()} bytes
          </label>)}
        </div>;
      })}
      {selected.length > 0 && <>
        <p>Send shares these {bytes.toLocaleString()} bytes with <b>{model}</b>. Fresh text-only turn; no tools, scripts or Action pass. Other resources stay private.</p>
        <label>Confirmed model context capacity<select className="cp-input" value={choice.contextLimit || ""} onChange={(e) => { const contextLimit = Number(e.target.value); onChange((old) => ({ ...old, modelScope, contextLimit })); }}>
          <option value="">Choose the model's supported capacity…</option>{CONTEXT_LIMITS.map((n) => <option key={n} value={n}>{n.toLocaleString()} tokens or more</option>)}
        </select></label>
        <p>Provider metadata does not supply this limit. Preflight conservatively counts each UTF-8 byte as one token, plus 8,192 headroom. Oversized context is rejected, never truncated.</p>
      </>}
    </fieldset>
    {!loaded && <p role="alert">Reload Skill Codex to select imported skills.</p>}
  </details>;
}
