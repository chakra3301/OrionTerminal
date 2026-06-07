import { useModelPrefs, type ModelSurface } from "@/store/modelPrefsStore";
import { MODELS, DEFAULT_MODEL_ID } from "@/lib/models";

/** Compact per-surface model picker used in each Claude rail + R.O.S.I.E. */
export function ModelSelect({ surface }: { surface: ModelSurface }) {
  const model = useModelPrefs((s) => s.models[surface]) || DEFAULT_MODEL_ID;
  const setModel = useModelPrefs((s) => s.setModel);
  return (
    <select
      className="ot-model-select"
      value={model}
      title="Model for this assistant"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setModel(surface, e.target.value)}
    >
      {MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
