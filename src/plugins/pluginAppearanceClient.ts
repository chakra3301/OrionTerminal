import { parsePluginAppearance, type PluginAppearance } from "./pluginAppearance";

export function appearanceClientScript(initial?: PluginAppearance): string {
  return `const appearance = (() => {
    const parse = ${parsePluginAppearance.toString()};
    let current = null;
    const listeners = new Set();
    const scheme = document.documentElement.style.colorScheme;
    const apply = (value) => {
      const next = parse(value);
      if (!next || (current && next.revision <= current.revision)) return;
      current = next;
      const root = document.documentElement;
      root.dataset.orionStyle = next.mode;
      root.dataset.orionMaterial = next.material;
      root.dataset.orionMotion = next.reduceMotion ? "reduce" : "normal";
      root.dataset.orionTransparency = next.reduceTransparency ? "reduce" : "normal";
      if (next.mode === "orion") root.style.colorScheme = next.colorScheme;
      else if (scheme) root.style.colorScheme = scheme;
      else root.style.removeProperty("color-scheme");
      for (const [key,value] of Object.entries(next.colors)) root.style.setProperty("--orion-" + key,value);
      for (const [key,value] of Object.entries(next.radii)) root.style.setProperty("--orion-radius-" + key,value + "px");
      for (const listener of listeners) { try { listener(JSON.parse(JSON.stringify(current))); } catch {} }
    };
    addEventListener("message", (event) => {
      if (event.source !== parent) return;
      const m = event.data;
      if (m && m.channel === channel && m.version === version && m.sessionId === sessionId && m.type === "appearance") apply(m.appearance);
    });
    apply(${JSON.stringify(initial ?? null).replaceAll("<", "\\u003c")});
    return Object.freeze({
      get: () => current ? JSON.parse(JSON.stringify(current)) : null,
      subscribe: (listener) => {
        if (typeof listener !== "function" || listeners.size >= 32) throw new Error("Appearance subscriber limit reached");
        listeners.add(listener); return () => listeners.delete(listener);
      },
    });
  })();`;
}
