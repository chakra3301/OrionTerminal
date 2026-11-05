import skin from "./pluginAppearance.css?raw";
import displayFont from "@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2?inline";
import monoFont from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline";

export function pluginAppearanceStyles(): string {
  const fonts = `@font-face{font-family:"Orion Space Grotesk";font-style:normal;font-weight:500;src:url("${displayFont}") format("woff2");font-display:swap}
@font-face{font-family:"Orion JetBrains Mono";font-style:normal;font-weight:400;src:url("${monoFont}") format("woff2");font-display:swap}`;
  const positions: string[] = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    positions.push(`[data-orion-style="orion"][data-orion-skin="2048"] .tile.tile-position-${x + 1}-${y + 1}{transform:translate(calc(${x} * (100% + var(--orion-board-gap))),calc(${y} * (100% + var(--orion-board-gap))))}`);
  }
  return `${fonts}\n${skin}\n${positions.join("\n")}`;
}
