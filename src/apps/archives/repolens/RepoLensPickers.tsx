import { useProvidersStore } from "@/store/providersStore";
import { useRepoLens } from "./useRepoLens";
import { availableRepoLensModel, repoLensModelGroups } from "./models";
import { TONES } from "./tone";

export function RepoLensPickers({ websiteAgent = false }: { websiteAgent?: boolean }) {
  const model = useRepoLens((s) => s.model);
  const tone = useRepoLens((s) => s.tone);
  const setDefaultModel = useRepoLens((s) => s.setDefaultModel);
  const setTone = useRepoLens((s) => s.setTone);
  const providers = useProvidersStore((s) => s.providers);
  const capability = websiteAgent ? "website-agent" : "analysis";
  const groups = repoLensModelGroups(providers, capability);
  const selected = availableRepoLensModel(providers, model.default_model, capability);

  return (
    <>
      <select
        className="rl-select"
        value={selected}
        onChange={(e) => setDefaultModel(e.target.value)}
        title={websiteAgent ? "Website clone agent model" : "Model"}
      >
        {!groups.some((group) => group.models.some((item) => item.id === selected)) && (
          <option value={selected}>Unavailable selection — choose a model</option>
        )}
        {groups.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.models.map((item) => (
              <option key={`${group.id}/${item.id}`} value={item.id}>
                {item.label}
              </option>
            ))}
          </optgroup>
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
