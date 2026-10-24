import type { Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { effectiveFigmaRawNodeFields } from '@open-pencil/fig';
import { PROTOTYPE_PLUGIN, setPrototypeMetadata } from './prototype';
import type { DesignOverlay, DesignPoint } from './reactExportRuntime';

export const PROTOTYPE_OVERLAY = 'prototypeOverlay';
export const OVERLAY_POSITIONS: DesignOverlay['position'][] = ['center', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'manual'];
export const defaultOverlay = (): DesignOverlay => ({ position: 'center', closeOutside: false });
type OverlayRead = { settings: DesignOverlay; issue?: string; imported?: boolean };
function parse(value: unknown): DesignOverlay {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const config = value as Record<string, unknown>;
  if (!OVERLAY_POSITIONS.includes(config.position as DesignOverlay['position']) || typeof config.closeOutside !== 'boolean') throw new Error();
  const color = config.background as Record<string, unknown> | undefined;
  if (color !== undefined && (!color || typeof color !== 'object' || Array.isArray(color) || !['r', 'g', 'b', 'a'].every(axis => typeof color[axis] === 'number' && Number.isFinite(color[axis]) && Number(color[axis]) >= 0 && Number(color[axis]) <= 1))) throw new Error();
  return { position: config.position as DesignOverlay['position'], closeOutside: config.closeOutside, ...(color ? { background: { r: color.r as number, g: color.g as number, b: color.b as number, a: color.a as number } } : {}) };
}
export function readPrototypeOverlay(node: SceneNode): OverlayRead {
  const authored = node.pluginData.find(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_OVERLAY);
  try {
    if (authored) {
      if (authored.value.length > 1024) throw new Error();
      return { settings: parse(JSON.parse(authored.value)) };
    }
    const raw = effectiveFigmaRawNodeFields(node);
    if (!['overlayPositionType', 'overlayBackgroundInteraction', 'overlayBackgroundAppearance'].some(key => key in raw)) return { settings: defaultOverlay() };
    const appearance = raw.overlayBackgroundAppearance as { backgroundType?: string; backgroundColor?: unknown } | undefined;
    if (raw.overlayBackgroundInteraction !== undefined && !['NONE', 'CLOSE_ON_CLICK_OUTSIDE'].includes(String(raw.overlayBackgroundInteraction)) || appearance && !['NONE', 'SOLID_COLOR'].includes(String(appearance.backgroundType))) throw new Error();
    return { imported: true, settings: parse({ position: String(raw.overlayPositionType ?? 'CENTER').toLowerCase().replaceAll('_', '-'), closeOutside: raw.overlayBackgroundInteraction === 'CLOSE_ON_CLICK_OUTSIDE', ...(appearance?.backgroundType === 'SOLID_COLOR' ? { background: appearance.backgroundColor ?? null } : {}) }) };
  } catch { return { settings: defaultOverlay(), issue: authored ? 'This overlay has invalid settings.' : 'Imported overlay settings are preserved but cannot play yet.', ...(!authored ? { imported: true } : {}) }; }
}
export function setPrototypeOverlay(editor: Editor, node: SceneNode, settings: DesignOverlay) {
  if (node.type !== 'FRAME') throw new Error('Choose a frame to change its overlay settings.');
  let parsed: DesignOverlay;
  try { parsed = parse(settings); } catch { throw new Error('Choose a valid overlay position, background and outside-click setting.'); }
  setPrototypeMetadata(editor, node, PROTOTYPE_OVERLAY, JSON.stringify(parsed));
}
export function overlayPosition(settings: DesignOverlay, viewport: { width: number; height: number }, size: { width: number; height: number }, origin: DesignPoint, offset: DesignPoint): DesignPoint {
  if (settings.position === 'manual') return { x: origin.x + offset.x, y: origin.y + offset.y };
  return { x: settings.position.endsWith('left') ? 0 : settings.position.endsWith('right') ? viewport.width - size.width : (viewport.width - size.width) / 2, y: settings.position.startsWith('top') ? 0 : settings.position.startsWith('bottom') ? viewport.height - size.height : (viewport.height - size.height) / 2 };
}
