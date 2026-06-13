import { useRepoLens } from "./useRepoLens";
import { REPOLENS_MODELS } from "./models";
import { TONES } from "./tone";

export function RepoLensPickers() {
  const model = useRepoLens((s) => s.model);
  const tone = useRepoLens((s) => s.tone);
  const setDefaultModel = useRepoLens((s) => s.setDefaultModel);
  const setTone = useRepoLens((s) => s.setTone);
  return (
    <>
      <select
        className="rl-select"
        value={model.default_model}
        onChange={(e) => setDefaultModel(e.target.value)}
        title="Model"
      >
        {REPOLENS_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className="rl-select"
        value={tone}
        onChange={(e) => setTone(e.target.value)}
        title="Tone"
      >
        {TONES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
    </>
  );
}
