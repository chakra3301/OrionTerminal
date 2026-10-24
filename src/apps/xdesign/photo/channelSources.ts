import type { PhotoLayer, PhotoState } from "./types";

export type PhotoReference = { photoId: string; version: string };
export type ChannelSource = { document?: PhotoReference; layer: number | "merged"; channel: string | number | { color: number }; invert: boolean };
export type SourceChoice = { key: string; label: string; channel: ChannelSource["channel"] };
export const MAX_CHANNEL_PIXELS = 268_435_456;

export function channelWorkspaceRequired(command: string, params: Record<string, unknown>): boolean {
  return command === "channel.split" || command === "channel.merge" || command === "image.calculations" && params.result === "newDocument" || ["image.applyImage", "image.calculations", "select.loadSelection"].includes(command) && (params.document !== undefined || ["source", "source1", "source2", "mask"].some(key => !!(params[key] as ChannelSource | undefined)?.document));
}
export const CHANNEL_BLENDS = [
  ["normal", "Normal"], ["darken", "Darken"], ["multiply", "Multiply"], ["colorBurn", "Color Burn"], ["linearBurn", "Linear Burn"],
  ["lighten", "Lighten"], ["screen", "Screen"], ["colorDodge", "Color Dodge"], ["linearDodge", "Linear Dodge"],
  ["overlay", "Overlay"], ["softLight", "Soft Light"], ["hardLight", "Hard Light"], ["vividLight", "Vivid Light"], ["linearLight", "Linear Light"], ["pinLight", "Pin Light"], ["hardMix", "Hard Mix"],
  ["difference", "Difference"], ["exclusion", "Exclusion"], ["divide", "Divide"], ["add", "Add"], ["subtract", "Subtract"],
] as const;

export function channelLayers(layers: PhotoLayer[]): { layer: PhotoLayer; label: string }[] {
  return layers.flatMap(layer => [{ layer, label: layer.name }, ...channelLayers(layer.children ?? []).map(child => ({ ...child, label: `${layer.name} / ${child.label}` }))]);
}

export function sourceChoices(state: PhotoState, source: ChannelSource): SourceChoice[] {
  const layer = source.layer === "merged" ? null : channelLayers(state.layers).find(item => item.layer.id === source.layer)?.layer;
  const pixels = source.layer === "merged" || !!layer && (layer.hasPixels ?? layer.kind.toLowerCase() === "raster");
  const colors = state.channels?.colors ?? (state.mode.toLowerCase() === "cmyk" ? ["Cyan", "Magenta", "Yellow", "Black"] : state.mode.toLowerCase() === "lab" ? ["Lightness", "a", "b"] : /gray/i.test(state.mode) ? ["Gray"] : ["Red", "Green", "Blue"]).map(name => ({ name }));
  return [
    ...(pixels ? [{ key: "composite", label: `${state.channels?.composite ?? state.mode} composite`, channel: "composite" }, ...colors.map((color, index) => ({ key: `color:${index}`, label: color.name, channel: colors.length === 1 ? "composite" : { color: index } }))] : []),
    ...(state.channels?.alpha ?? []).map(channel => ({ key: `alpha:${channel.index}`, label: `${channel.name} · ${channel.spot ? "Spot" : "Alpha"}`, channel: channel.index })),
    ...(state.hasSelection ? [{ key: "selection", label: "Current selection", channel: "selection" }] : []),
    ...(state.quickMask ? [{ key: "quickMask", label: "Quick Mask", channel: "quickMask" }] : []),
    ...(layer ? [{ key: "transparency", label: "Layer transparency", channel: "transparency" }, ...(layer.hasMask ? [{ key: "mask", label: "Layer mask", channel: "mask" }] : []), ...(layer.hasVectorMask ? [{ key: "vectorMask", label: "Vector mask", channel: "vectorMask" }] : [])] : []),
  ];
}

export function sourceKey(source: ChannelSource): string {
  return typeof source.channel === "number" ? `alpha:${source.channel}` : typeof source.channel === "object" ? `color:${source.channel.color}` : source.channel;
}

export function initialSource(state: PhotoState, coverage = false): ChannelSource {
  const alpha = state.channels?.target?.kind === "alpha" ? state.channels.target.index : state.channels?.alpha[0]?.index;
  if (coverage && alpha !== undefined) return { layer: "merged", channel: alpha, invert: false };
  const source: ChannelSource = { layer: coverage && state.activeLayer !== null ? state.activeLayer : "merged", channel: coverage && state.activeLayer !== null ? "transparency" : "composite", invert: false };
  return source;
}

export function changeSourceLayer(state: PhotoState, source: ChannelSource, layer: ChannelSource["layer"]): ChannelSource {
  const next = { ...source, layer }, choices = sourceChoices(state, next);
  return choices.some(choice => choice.key === sourceKey(next)) ? next : { ...next, channel: choices[0]?.channel ?? "composite" };
}
