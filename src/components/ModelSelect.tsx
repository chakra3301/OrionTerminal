import { useModelPrefs, type ModelSurface } from "@/store/modelPrefsStore";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { useProvidersStore } from "@/store/providersStore";
import { useAgentsStore } from "@/store/agentsStore";
import { formatAgentValue } from "@/features/agents/agentValue";
import { providerModelValue, selectedModelValue } from "@/features/agents/modelSelection";

export function ModelSelect({ surface, disabled = false }: { surface: ModelSurface; disabled?: boolean }) {
  const value = useModelPrefs((s) => s.models[surface] || s.models.default) || DEFAULT_MODEL_ID;
  const setModel = useModelPrefs((s) => s.setModel);
  const providers = useProvidersStore((s) => s.providers);
  const agents = Array.from(useAgentsStore((s) => s.agents).values());
  const selected = selectedModelValue(providers, value);
  const available = providers.some((p) => p.enabled && p.models.some((m) => providerModelValue(p.id, m.id) === selected)) || agents.some((a) => formatAgentValue(a.id) === selected);

  return (
    <select
      className="ot-model-select"
      value={selected}
      disabled={disabled}
      aria-label="Model or agent for this assistant"
      title={disabled ? "Stop the current response before switching models" : "Model or agent for this assistant"}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setModel(surface, e.target.value)}
    >
      {surface !== "default" && <option value="">Use default AI</option>}
      {!available && <option value={selected} disabled>Choose a model · selection unavailable</option>}
      {providers
        .filter((p) => p.enabled)
        .map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models.map((m) => (
              <option key={`${p.id}/${m.id}`} value={providerModelValue(p.id, m.id)}>
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
