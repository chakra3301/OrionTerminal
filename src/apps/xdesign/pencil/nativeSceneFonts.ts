import type { SkiaRenderer } from '@open-pencil/core/canvas';
import { collectNodeFontFaces, fontManager } from '@open-pencil/core/text';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';

export function nativeSceneTextNodes(graph: SceneGraph, ids: readonly string[]) {
  const text: SceneNode[] = [], pending = [...ids].map(id => ({ node: graph.getNode(id), depth: 0 })), seen = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!; if (!node || seen.has(node.id)) continue;
    if (depth > 128 || seen.size >= 20_000) throw new Error('This native font scene is too large or deeply nested.');
    seen.add(node.id); if (!node.visible || node.internalOnly) continue;
    if (node.type === 'TEXT') text.push(node);
    pending.push(...graph.getChildren(node.id).map(child => ({ node: child, depth: depth + 1 })));
  }
  return text;
}
export const nativeSceneFaceIssue = (node: SceneNode) => collectNodeFontFaces(node).some(face => !fontManager.loadedFontSource(face.family, face.style)) || fontManager.isNodeBlocked(node.id);

export function attachNativeSceneFonts(renderer: SkiaRenderer, kit: CanvasKit, text: readonly SceneNode[], own: (provider: TypefaceFontProvider) => void) {
  if (!text.length) return;
  const provider = kit.TypefaceFontProvider.Make();
  if (!provider) throw new Error('This group could not allocate its scene font provider.');
  own(provider); renderer.fontProvider = provider;
  const register = provider.registerFont; let failure: { reason: unknown } | undefined;
  provider.registerFont = (...args) => { try { register.apply(provider, args); } catch (error) { failure ??= { reason: error }; throw error; } };
  try { fontManager.attachProvider(kit, provider); } finally { provider.registerFont = register; }
  if (failure) throw failure.reason;
  renderer.fontsLoaded = true; renderer.fontGeneration = fontManager.generation();
  for (const node of text) if (renderer.nodeFontReadiness(node) !== 'ready') throw new Error(`${node.name}: wait for every glyph and font to finish preparing before composing this group.`);
}
