import type { DesignNavigation, DesignPoint } from './reactExportRuntime';

export function navigatePrototype(current: string, history: readonly string[], link: DesignNavigation, screens: ReadonlySet<string>): { screen: string; history: string[] } {
  if (link.action === 'open-url') throw new Error('Use an external-link presentation host to open this URL.');
  if (link.action === 'media') throw new Error('Use a video-aware presentation host for this media action.');
  if (link.action === 'back') return history.length ? { screen: history[history.length - 1]!, history: history.slice(0, -1) } : { screen: current, history: [...history] };
  if (link.action === 'close') return { screen: current, history: [...history] };
  if (link.action === 'sequence') throw new Error('Use a sequence-aware presentation host for this action.');
  if (link.action === 'scroll') throw new Error('Use a scrolling presentation host for this action.');
  if (link.action === 'overlay') throw new Error('Use an overlay-aware presentation host for this action.');
  if (link.unresolved || !link.target || !screens.has(link.target)) throw new Error('The destination screen was removed, hidden or was not included in this paste.');
  if (link.target === current) return { screen: current, history: [...history] };
  return { screen: link.target, history: link.action === 'swap' ? [...history] : [...history.slice(-127), current] };
}

export type PrototypeRoute = { screen: string; history: string[]; overlays: { screen: string; origin: DesignPoint; offset: DesignPoint; instanceId?: string }[] };
export function routePrototype(current: PrototypeRoute, link: DesignNavigation, screens: ReadonlySet<string>, origin: DesignPoint = { x: 0, y: 0 }, instanceId?: string): PrototypeRoute {
  if (link.action === 'close') return current.overlays.length ? { ...current, overlays: current.overlays.slice(0, -1) } : current;
  if (link.action === 'overlay' || link.action === 'swap' && current.overlays.length) {
    if (link.unresolved || !link.target || !screens.has(link.target)) throw new Error('The destination screen was removed, hidden or was not included in this paste.');
    const rest = link.action === 'swap' ? current.overlays.slice(0, -1) : current.overlays;
    if (rest.length >= 8) throw new Error('Close an overlay before opening another; presentation supports eight stacked overlays.');
    return { ...current, overlays: [...rest, { screen: link.target, origin, offset: link.offset ?? { x: 0, y: 0 }, ...(instanceId ? { instanceId } : {}) }] };
  }
  const next = navigatePrototype(current.screen, current.history, link, screens);
  if (next.screen === current.screen && link.action === 'back') return current;
  return { ...next, overlays: [] };
}
