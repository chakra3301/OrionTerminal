import type { CustomTheme } from "../themeDesign";
export const themeFixture: CustomTheme = {
  id: "custom:01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Carbon", description: "Graphite surfaces and clear blue controls.",
  mode: "dark", finish: "solid", depth: "soft", radii: [4, 8, 12, 16],
  colors: { background: "#080a0e", panel: "#10141a", raised: "#18202a", hover: "#222d3a", text: "#f1f5fa", secondary: "#bdc9d8", muted: "#9dacc0", onAccent: "#080a0e", accent: "#74bcff", success: "#88d6aa", warning: "#edcd78", error: "#ff929d", violet: "#c6abed" },
};
export const lightFixture: CustomTheme = { ...themeFixture, id: "custom:01ARZ3NDEKTSV4RRFFQ69G5FAW", name: "Paper", mode: "light", colors: { ...themeFixture.colors, background: "#eae8e1", panel: "#f6f5ef", raised: "#fffef9", hover: "#ebe9e0", text: "#262820", secondary: "#3b3b30", muted: "#403f33", onAccent: "#fffdf8", accent: "#2b465b", success: "#254732", warning: "#543c0f", error: "#6b2e3c", violet: "#4e3b64" } };
