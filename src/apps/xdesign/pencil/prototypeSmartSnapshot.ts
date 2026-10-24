import type { DesignMotion } from './reactExportRuntime';
import { smartIdentity, smartInverse, smartMultiply, type SmartMatrix, type SmartPose } from './prototypeSmartGeometry';
export type SmartLayerSnapshot = { element: HTMLElement; key: string; parent?: string; motion: DesignMotion & { name: string }; pose: SmartPose };
function elements(surface: HTMLElement) {
  const candidates = [...surface.querySelectorAll<HTMLElement>('[data-xdesign-motion]')]; if (surface.hasAttribute('data-xdesign-motion')) candidates.unshift(surface);
  return candidates.filter(element => { const old = element.closest('[data-xdesign-snapshot]'); return !old || old === surface; });
}
function descriptor(element: HTMLElement): (DesignMotion & { name: string }) | undefined {
  const text = element.getAttribute('data-xdesign-motion'); if (!text || text.length > 32 * 1024 * 1024) return;
  try { const value = JSON.parse(text) as DesignMotion & { name: string }; if (value.version === 1 && typeof value.name === 'string' && typeof value.type === 'string' && typeof value.shape === 'string' && typeof value.root === 'boolean' && typeof value.shadow === 'boolean' && Array.isArray(value.local) && value.local.length === 6 && value.local.every(Number.isFinite) && Number.isFinite(value.width) && Number.isFinite(value.height)) return value; } catch { /* Unrecognized host metadata stays eligible for dissolve fallback. */ }
}
export function smartComputedMatrix(value: string): SmartMatrix | undefined {
  if (!value || value === 'none') return smartIdentity();
  if (typeof DOMMatrixReadOnly !== 'undefined') { try { const matrix = new DOMMatrixReadOnly(value); if (matrix.is2D) return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]; } catch { return; } }
  const match = /^matrix\(([^)]+)\)$/.exec(value), numbers = match?.[1]!.split(',').map(Number);
  if (numbers?.length === 6 && numbers.every(Number.isFinite)) return numbers as SmartMatrix;
}
export function captureSmartLayers(surface: HTMLElement): SmartLayerSnapshot[] {
  const candidates = elements(surface), views = new Map<Element | null, number>();
  if (candidates.length > 180000) throw new Error('This prototype exceeds the screen and eight-overlay layer allowance.');
  for (const element of candidates) { const view = element.closest('[data-xdesign-view]'), count = (views.get(view) ?? 0) + 1; if (count > 20000) throw new Error('Smart Animate supports at most 20,000 layers per presented screen.'); views.set(view, count); }
  const result: SmartLayerSnapshot[] = [], byElement = new Map<HTMLElement, SmartLayerSnapshot>(), occurrences = new Map<string, Map<string, number>>(), bounds = surface.getBoundingClientRect();
  let external = smartIdentity(), outer: HTMLElement | null = surface, externalSupported = true;
  while (outer) { const matrix = smartComputedMatrix(getComputedStyle(outer).transform); if (!matrix) { externalSupported = false; break; } external = smartMultiply([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0], external); outer = outer.parentElement; }
  const surfaceStyle = getComputedStyle(surface), surfaceWidth = Number.parseFloat(surfaceStyle.width) || surface.offsetWidth || bounds.width, surfaceHeight = Number.parseFloat(surfaceStyle.height) || surface.offsetHeight || bounds.height;
  const corners = (matrix: SmartMatrix, width: number, height: number) => ({ x: [0, matrix[0] * width, matrix[2] * height, matrix[0] * width + matrix[2] * height], y: [0, matrix[1] * width, matrix[3] * height, matrix[1] * width + matrix[3] * height] });
  const surfaceCorners = corners(external, surfaceWidth, surfaceHeight), surfaceOrigin = [bounds.left - Math.min(...surfaceCorners.x), bounds.top - Math.min(...surfaceCorners.y)];
  for (const element of candidates) {
    const motion = descriptor(element); if (!motion || element.closest('[hidden]')) continue;
    const style = getComputedStyle(element); if (style.display === 'none' || style.visibility === 'hidden') continue;
    let ancestor = element.parentElement, parent: SmartLayerSnapshot | undefined, depth = 0;
    while (ancestor && ancestor !== surface.parentElement) { if (++depth > 256) throw new Error('This prototype DOM hierarchy is too deep.'); parent = byElement.get(ancestor); if (parent) break; ancestor = ancestor.parentElement; }
    const namespace = parent?.key ?? '', names = occurrences.get(namespace) ?? new Map<string, number>(); occurrences.set(namespace, names);
    const name = motion.root ? '' : motion.name, occurrence = names.get(name) ?? 0; names.set(name, occurrence + 1);
    const key = `${namespace}/${JSON.stringify([name, occurrence])}`, rect = element.getBoundingClientRect(), cssWidth = Number.parseFloat(style.width), cssHeight = Number.parseFloat(style.height), width = Number.isFinite(cssWidth) ? cssWidth : element.offsetWidth || motion.width, height = Number.isFinite(cssHeight) ? cssHeight : element.offsetHeight || motion.height;
    let matrix = smartMultiply(parent?.pose.matrix ?? smartIdentity(), motion.local);
    if ((rect.width || rect.height) && width > 0 && height > 0) {
      let linear = smartIdentity(), node: HTMLElement | null = element, supported = true;
      while (node && node !== surface) { const local = smartComputedMatrix(getComputedStyle(node).transform); if (!local) { supported = false; break; } linear = smartMultiply(local, linear); node = node.parentElement; }
      if (!supported || !externalSupported) continue;
      const global = corners(smartMultiply(external, linear), width, height);
      try { const origin = smartMultiply(smartInverse(external), [1, 0, 0, 1, rect.left - Math.min(...global.x) - surfaceOrigin[0]!, rect.top - Math.min(...global.y) - surfaceOrigin[1]!]); matrix = [linear[0], linear[1], linear[2], linear[3], origin[4], origin[5]]; } catch { continue; }
    }
    let alpha = 1;
    for (let node: HTMLElement | null = element; node && node !== parent?.element && node !== surface; node = node.parentElement) { const value = Number.parseFloat(getComputedStyle(node).opacity); if (Number.isFinite(value)) alpha *= value; }
    if (element === surface) { const value = Number.parseFloat(style.opacity); if (Number.isFinite(value)) alpha = value; }
    const shorthand = style.borderRadius.trim().split(/\s+/), circular = shorthand.length <= 4 && shorthand.every(value => /^\d+(?:\.\d+)?(?:px)?$/.test(value)), fallback = circular ? [shorthand[0], shorthand[1] ?? shorthand[0], shorthand[2] ?? shorthand[0], shorthand[3] ?? shorthand[1] ?? shorthand[0]] : [];
    const radii = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].map((property, index) => { const value = style.getPropertyValue(property) || fallback[index] || ''; return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? Number.parseFloat(value) : NaN; });
    const changedRadii = Array.isArray(motion.radii) && radii.every(Number.isFinite) && radii.some((value, index) => value !== motion.radii[index]);
    const snapshot: SmartLayerSnapshot = { element, key, ...(parent ? { parent: parent.key } : {}), motion, pose: { matrix, width, height, opacity: alpha, ...(changedRadii ? { radii: radii as [number, number, number, number] } : {}) } }; result.push(snapshot); byElement.set(element, snapshot);
  }
  return result;
}
export function copySmartLayerSnapshots(source: HTMLElement, snapshot: HTMLElement) {
  const old = elements(source), copies = elements(snapshot);
  const cloned = new Map(old.map((element, index) => [element, copies[index]]));
  for (const state of captureSmartLayers(source)) {
    const copy = cloned.get(state.element); if (!copy) continue;
    copy.setAttribute('data-xdesign-motion-state', JSON.stringify({ key: state.key, parent: state.parent, pose: state.pose }));
    const style = getComputedStyle(state.element);
    for (const property of ['transform', 'opacity', 'background-color', 'background-image', 'color', 'border-color', 'border-radius', 'box-shadow']) copy.style.setProperty(property, style.getPropertyValue(property));
  }
}

export function savedSmartLayers(snapshot: HTMLElement): SmartLayerSnapshot[] {
  const offset = [1, 0, 0, 1, Number.parseFloat(snapshot.style.left) || 0, Number.parseFloat(snapshot.style.top) || 0] as SmartMatrix;
  const result: SmartLayerSnapshot[] = [];
  for (const element of elements(snapshot)) {
    const motion = descriptor(element), text = element.getAttribute('data-xdesign-motion-state'); if (!motion || !text) continue;
    try { const state = JSON.parse(text) as Pick<SmartLayerSnapshot, 'key' | 'parent' | 'pose'>, pose = state.pose;
      if (typeof state.key !== 'string' || state.parent !== undefined && typeof state.parent !== 'string' || !pose || !Array.isArray(pose.matrix) || pose.matrix.length !== 6 || !pose.matrix.every(Number.isFinite) || ![pose.width, pose.height, pose.opacity].every(Number.isFinite)) continue;
      if (pose.radii !== undefined && (!Array.isArray(pose.radii) || pose.radii.length !== 4 || !pose.radii.every(Number.isFinite))) continue;
      result.push({ element, key: state.key, parent: state.parent, motion, pose: { ...pose, matrix: smartMultiply(offset, pose.matrix) } });
    } catch { /* Damaged snapshot metadata falls back to whole-screen dissolve. */ }
  }
  return result;
}
