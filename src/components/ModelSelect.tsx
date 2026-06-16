import { useModelPrefs, type ModelSurface } from "@/store/modelPrefsStore";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { useProvidersStore } from "@/store/providersStore";
import { useAgentsStore } from "@/store/agentsStore";
import { formatAgentValue } from "@/features/agents/agentValue";

export function ModelSelect({ surface }: { surface: ModelSurface }) {
  const value = useModelPrefs((s) => s.models[surface]) || DEFAULT_MODEL_ID;
  const setModel = useModelPrefs((s) => s.setModel);
  const providers = useProvidersStore((s) => s.providers);
  const agents = useAgentsStore((s) => Array.from(s.agents.values()));

  return (
    <select
      className="ot-model-select"
      value={value}
      title="Model or agent for this assistant"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setModel(surface, e.target.value)}
    >
      {providers
        .filter((p) => p.enabled)
        .map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models.map((m) => (
              <option key={`${p.id}/${m.id}`} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      {agents.length > 0 && (
        <optgroup label="Your Agents">
          {agents.map((a) => (
            <option key={a.id} value={formatAgentValue(a.id)}>
              {a.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
