// Photoshop's blend menus separate their modes into these groups.
const GROUP_STARTS = new Set(["Darken", "Lighten", "Overlay", "Difference", "Hue"]);

/** A blend mode select's options, named by `label`, with Photoshop's separators between the groups; the `off` modes show greyed. */
export const blendOptions = (modes: readonly string[], label: (mode: string) => string = mode => mode, off: readonly string[] = []) =>
  modes.flatMap(mode => [...GROUP_STARTS.has(label(mode)) ? [<hr key={`${mode}/`}/>] : [], <option key={mode} value={mode} disabled={off.includes(mode)}>{label(mode)}</option>]);
