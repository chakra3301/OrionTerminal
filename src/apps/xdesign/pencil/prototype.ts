import type { Editor } from '@open-pencil/core/editor';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { effectiveFigmaRawNodeFields } from '@open-pencil/fig';
import { allDesignActions, designActions, MAX_DESIGN_ACTIONS, isDesignSpring, designSpringDuration, validateDesignUrl } from './reactExportRuntime';
import { mapPrototypeOperand, parsePrototypeOperand, prototypeOperandIds } from './prototypeValues';
import { nativePrototypeReference, readNativePrototypeOperand } from './prototypeValueCodec';
import { prototypeFrame, scrollTargets } from './prototypeScroll';

import type { DesignInteraction, DesignNavigation, DesignTrigger } from './reactExportRuntime';
export type { DesignInteraction, DesignNavigation, DesignPoint, DesignTrigger } from './reactExportRuntime';
export const PROTOTYPE_INTERACTIONS = 'prototypeInteractions';
export const MAX_PROTOTYPE_INTERACTIONS = 16;
export const PROTOTYPE_PLUGIN = 'orion.xdesign';
export const PROTOTYPE_LINK = 'prototypeLink';
export const PROTOTYPE_START = 'prototypeStart';
const PLUGIN = PROTOTYPE_PLUGIN, LINK = PROTOTYPE_LINK, START = PROTOTYPE_START;
export type PrototypeResolver = (id: string) => string;
const resolverGraphs = new WeakMap<PrototypeResolver, SceneGraph>();
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
export function prototypeGuid(value: unknown): string | undefined {
  const guid = record(value);
  if (!guid || !Number.isInteger(guid.sessionID) || !Number.isInteger(guid.localID) || Number(guid.sessionID) < 0 || Number(guid.sessionID) > 0xffffffff || Number(guid.localID) < 0 || Number(guid.localID) > 0xffffffff) return;
  return `${guid.sessionID}:${guid.localID}`;
}
export function prototypeResolver(graph: SceneGraph, preferred: Iterable<SceneNode> = [], contextGraph: SceneGraph = graph): PrototypeResolver {
  const sourceIds = new Map<string, string>();
  for (const variable of graph.variables.values()) { sourceIds.set(variable.id, variable.id); if (variable.key) sourceIds.set(variable.key, variable.id); }
  for (const collection of graph.variableCollections.values()) { sourceIds.set(collection.id, collection.id); for (const mode of collection.modes) sourceIds.set(mode.modeId, mode.modeId); }
  for (const node of graph.nodes.values()) if (node.source.id && !sourceIds.has(node.source.id)) sourceIds.set(node.source.id, node.id);
  for (const node of preferred) if (node.source.id) sourceIds.set(node.source.id, node.id);
  const resolve: PrototypeResolver = id => sourceIds.get(id) ?? id;
  resolverGraphs.set(resolve, contextGraph);
  return resolve;
}
export type PrototypeRead = { link?: DesignNavigation; interactions?: DesignInteraction[]; issue?: string; imported?: boolean };

export function prototypeScreens(graph: SceneGraph, pageId: string): SceneNode[] {
  const screens: SceneNode[] = [], pending = [...graph.getChildren(pageId)].reverse(), visited = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (!node.visible || node.internalOnly || node.librarySource?.readOnly) continue;
    if (node.type === 'FRAME') screens.push(node);
    else if (node.type === 'SECTION') pending.push(...graph.getChildren(node.id).reverse());
  }
  return screens;
}

function navigation(value: unknown, resolve: PrototypeResolver, depth = 0, budget = { count: 0 }): DesignNavigation {
  if (depth > 8 || ++budget.count > MAX_DESIGN_ACTIONS + 1) throw new Error();
  const link = record(value);
  if (link?.resetInteractiveComponents !== undefined && typeof link.resetInteractiveComponents !== 'boolean') throw new Error();
  if (link?.resetInteractiveComponents === true && !['navigate', 'back', 'overlay', 'swap', 'close'].includes(String(link.action))) throw new Error();
  if (link?.resetVideoPosition !== undefined && typeof link.resetVideoPosition !== 'boolean') throw new Error();
  if (link?.resetVideoPosition === true && !['navigate', 'back', 'overlay', 'swap', 'close'].includes(String(link.action))) throw new Error();
  if (link?.action === 'sequence') {
    if (!Array.isArray(link.actions) || !link.actions.length || link.actions.length > MAX_DESIGN_ACTIONS || link.actions.some(action => record(action)?.action === 'sequence')) throw new Error();
    return { action: 'sequence', transition: 'instant', duration: 0, actions: link.actions.map(action => navigation(action, resolve, depth, budget)) };
  }
  const reference = (value: unknown): string => { if (typeof value !== 'string' || !value || value.length > 256) throw new Error(); return link?.variableFormat === 'fig' ? resolve(value) : value; };
  if (link?.action === 'set-variable') return { action: 'set-variable', variable: reference(link.variable), value: parsePrototypeOperand(link.value, link.variableFormat === 'fig' ? resolve : id => id), transition: 'instant', duration: 0 };
  if (link?.action === 'set-mode') return { action: 'set-mode', collection: reference(link.collection), mode: reference(link.mode), transition: 'instant', duration: 0 };
  if (link?.action === 'conditional') {
    if (!Array.isArray(link.branches) || !link.branches.length || link.branches.length > 16) throw new Error();
    const branches = link.branches.map((value, index) => {
      const branch = record(value);
      if (!branch || !Array.isArray(branch.actions) || branch.actions.some(action => record(action)?.action === 'sequence') || branch.condition === undefined && index !== (link.branches as unknown[]).length - 1) throw new Error();
      return { ...(branch.condition !== undefined ? { condition: parsePrototypeOperand(branch.condition, link.variableFormat === 'fig' ? resolve : id => id) } : {}), actions: branch.actions.map(action => navigation(action, resolve, depth + 1, budget)) };
    });
    const result: DesignNavigation = { action: 'conditional', branches, transition: 'instant', duration: 0 }; allDesignActions(result); return result;
  }
  if (link?.action === 'open-url') {
    if (link.newTab !== undefined && typeof link.newTab !== 'boolean' || link.target !== undefined || link.transition !== 'instant' || link.duration !== 0) throw new Error();
    return { action: 'open-url', url: validateDesignUrl(link.url), ...(link.newTab !== undefined ? { newTab: link.newTab } : {}), transition: 'instant', duration: 0 };
  }
  if (link?.action === 'media') {
    if (!['play', 'pause', 'toggle'].includes(String(link.mediaAction)) || typeof link.target !== 'string' || !link.target || link.target.length > 256 || link.transition !== 'instant' || link.duration !== 0 || ['url', 'newTab', 'offset', 'preserveScroll', 'resetScroll', 'resetInteractiveComponents', 'resetVideoPosition', 'direction', 'easing', 'matchLayers'].some(key => link[key] !== undefined)) throw new Error();
    return { action: 'media', mediaAction: link.mediaAction as 'play' | 'pause' | 'toggle', target: link.targetFormat === 'fig' ? resolve(link.target) : link.target, ...(link.unresolved === true ? { unresolved: true } : {}), transition: 'instant', duration: 0 };
  }
  if (!link || !['navigate', 'back', 'overlay', 'close', 'swap', 'scroll'].includes(String(link.action))) throw new Error();
  const targeted = ['navigate', 'overlay', 'swap', 'scroll'].includes(String(link.action));
  if (targeted && (typeof link.target !== 'string' || !link.target || link.target.length > 256)) throw new Error();
  if (!['instant', 'dissolve', 'smart', 'slide', 'slide-out', 'move-in', 'move-out', 'push', 'scroll'].includes(String(link.transition)) || link.action === 'scroll' && !['instant', 'scroll'].includes(String(link.transition)) || link.action !== 'scroll' && link.transition === 'scroll' || typeof link.duration !== 'number' || !Number.isFinite(link.duration) || link.duration < 0 || link.duration > 10000) throw new Error();
  if (link.transition === 'smart' && !['navigate', 'back', 'swap'].includes(String(link.action)) || link.matchLayers !== undefined && (typeof link.matchLayers !== 'boolean' || !['slide', 'slide-out', 'move-in', 'move-out', 'push'].includes(String(link.transition)) || !['navigate', 'back', 'swap'].includes(String(link.action)))) throw new Error();
  if (link.direction !== undefined && !['left', 'right', 'top', 'bottom'].includes(String(link.direction))) throw new Error();
  if (link.easing !== undefined && !(typeof link.easing === 'string' && ['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(link.easing)) && !isDesignSpring(link.easing) && !(Array.isArray(link.easing) && link.easing.length === 4 && link.easing.every((n, i) => typeof n === 'number' && Number.isFinite(n) && n >= (i % 2 ? -10 : 0) && n <= (i % 2 ? 10 : 1)))) throw new Error();
  const easing = isDesignSpring(link.easing) ? { type: 'spring' as const, mass: link.easing.mass, stiffness: link.easing.stiffness, damping: link.easing.damping, initialVelocity: link.easing.initialVelocity ?? 0 } : link.easing as DesignNavigation['easing'];
  const offset = record(link.offset);
  if (link.offset !== undefined && (!['overlay', 'swap', 'scroll'].includes(String(link.action)) || !offset || !['x', 'y'].every(axis => typeof offset[axis] === 'number' && Number.isFinite(offset[axis]) && Math.abs(Number(offset[axis])) <= 1000000))) throw new Error();
  if (['preserveScroll', 'resetScroll'].some(key => link[key] !== undefined && (typeof link[key] !== 'boolean' || !['navigate', 'overlay', 'swap'].includes(String(link.action)))) || link.preserveScroll === true && link.resetScroll === true) throw new Error();
  return { action: link.action as DesignNavigation['action'], ...(targeted ? { target: link.targetFormat === 'fig' ? resolve(link.target as string) : link.target as string, ...(link.unresolved === true ? { unresolved: true } : {}) } : {}), transition: link.transition as DesignNavigation['transition'], duration: isDesignSpring(easing) ? designSpringDuration(easing) : link.duration, ...(link.direction ? { direction: link.direction as DesignNavigation['direction'] } : {}), ...(link.matchLayers === true ? { matchLayers: true } : {}), ...(easing ? { easing } : {}), ...(offset ? { offset: { x: offset.x as number, y: offset.y as number } } : {}), ...(link.preserveScroll === true ? { preserveScroll: true } : {}), ...(link.resetScroll === true ? { resetScroll: true } : {}), ...(link.resetInteractiveComponents !== undefined ? { resetInteractiveComponents: link.resetInteractiveComponents as boolean } : {}), ...(link.resetVideoPosition !== undefined ? { resetVideoPosition: link.resetVideoPosition as boolean } : {}) };
}
export function validPrototypeKeys(value: unknown): value is number[] {
  if (!Array.isArray(value) || !value.length || value.length > 5 || new Set(value).size !== value.length) return false;
  const modifiers = [16, 17, 18, 91];
  return value.filter(code => !modifiers.includes(code)).length === 1 && value.every(code => Number.isInteger(code) && (modifiers.includes(code) || [8, 13, 32, 33, 34, 35, 36, 37, 38, 39, 40, 46].includes(code) || code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 112 && code <= 123));
}
function trigger(value: unknown): DesignTrigger {
  const event = record(value); if (!event) throw new Error();
  if (event.type === 'click' || event.type === 'drag' || event.type === 'media-end') return { type: event.type };
  if (event.type === 'media-hit' && typeof event.time === 'number' && Number.isFinite(event.time) && event.time >= 0 && event.time <= 86400) return { type: 'media-hit', time: event.time };
  if (event.type === 'key' && validPrototypeKeys(event.keyCodes)) return { type: 'key', keyCodes: [...event.keyCodes].sort((a, b) => a - b) };
  if (['delay', 'pointer-enter', 'pointer-leave', 'pointer-down', 'pointer-up', 'hover', 'press'].includes(String(event.type))) {
    const delay = event.delay ?? (event.type === 'delay' ? NaN : 0);
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 60000) throw new Error();
    return { type: event.type as 'delay' | 'pointer-enter' | 'pointer-leave' | 'pointer-down' | 'pointer-up' | 'hover' | 'press', ...(event.type === 'delay' || delay ? { delay } : {}) } as DesignTrigger;
  }
  throw new Error();
}
function result(interactions: DesignInteraction[], imported = false): PrototypeRead {
  const triggers = interactions.map(({ trigger }) => trigger.type === 'key' ? `key/${trigger.keyCodes.join(',')}` : trigger.type === 'delay' ? `delay/${trigger.delay}` : trigger.type === 'media-hit' ? `media-hit/${trigger.time}` : trigger.type);
  if (new Set(triggers).size !== triggers.length) return { issue: imported ? 'Imported prototype: overlapping triggers are preserved but cannot play yet.' : 'Each interaction needs a distinct trigger or delay.', ...(imported ? { imported } : {}) };
  if (triggers.includes('hover') && triggers.includes('pointer-enter') || triggers.includes('press') && triggers.includes('pointer-down')) return { issue: imported ? 'Imported prototype: conflicting pointer triggers are preserved but cannot play yet.' : 'While hovering cannot share mouse enter; while pressing cannot share mouse down.', ...(imported ? { imported } : {}) };
  if (triggers.includes('drag') && triggers.some(type => ['press', 'pointer-down', 'pointer-up'].includes(type))) return { issue: imported ? 'Imported prototype: conflicting drag and pointer triggers are preserved but cannot play yet.' : 'On drag cannot share While pressing or mouse/touch down/up.' };
  return { interactions, link: interactions.find(interaction => interaction.trigger.type === 'click')?.navigation, ...(imported ? { imported } : {}) };
}
export function readPrototype(node: SceneNode, resolve: PrototypeResolver = id => id): PrototypeRead {
  try {
    const read = readPrototypeFields(node, resolve), graph = resolverGraphs.get(resolve);
    if (!graph || !read.interactions || !node.componentId) return read;
    const interactions = read.interactions.map(interaction => ({ ...interaction, navigation: canonicalPrototypeMediaActions(graph, node, interaction.navigation) }));
    return { ...read, ...result(interactions, read.imported) };
  } catch { return { imported: true, issue: 'Imported prototype: ambiguous or excessive instance overrides are preserved but cannot play yet.' }; }
}
function readPrototypeFields(node: SceneNode, resolve: PrototypeResolver): PrototypeRead {
  const native = prototypeNativeFields(node, resolve);
  if (native.overridden && !node.source.editedFields.includes('pluginData')) return readFigmaPrototype(resolve, native.raw);
  const multiple = node.pluginData.find(entry => entry.pluginId === PLUGIN && entry.key === PROTOTYPE_INTERACTIONS);
  const entry = multiple ?? node.pluginData.find(entry => entry.pluginId === PLUGIN && entry.key === LINK);
  if (!entry) return readFigmaPrototype(resolve, native.raw);
  if (!multiple && entry.value === 'null') return {};
  if (!entry.value || entry.value.length > 32768) return { issue: 'This prototype action has invalid metadata.' };
  try {
    const value: unknown = JSON.parse(entry.value);
    if (!multiple) return result([{ id: 'click', trigger: { type: 'click' }, navigation: navigation(value, resolve) }]);
    if (!Array.isArray(value) || value.length > MAX_PROTOTYPE_INTERACTIONS) throw new Error();
    const ids = new Set<string>();
    return result(value.map(raw => {
      const interaction = record(raw);
      if (!interaction || typeof interaction.id !== 'string' || !interaction.id || interaction.id.length > 128 || ids.has(interaction.id)) throw new Error();
      ids.add(interaction.id);
      return { id: interaction.id, trigger: trigger(interaction.trigger), navigation: navigation(interaction.navigation, resolve) };
    }));
  } catch { return { issue: 'This prototype action has invalid metadata.' }; }
}
export function readNavigation(node: SceneNode, resolve?: PrototypeResolver): DesignNavigation | undefined { return readPrototype(node, resolve).link; }

// The pinned importer retains symbol overrides but does not apply prototype fields
// to generated descendants. Resolve only explicit definition identities, never names.
function prototypeNativeFields(node: SceneNode, resolve: PrototypeResolver): { raw: RecordValue; overridden: boolean } {
  const graph = resolverGraphs.get(resolve);
  if (!graph || !node.componentId) return { raw: effectiveFigmaRawNodeFields(node), overridden: false };
  const inherited = (current: SceneNode, seen = new Set<string>()): RecordValue => {
    if (seen.has(current.id) || seen.size >= 256) throw new Error();
    seen.add(current.id);
    const definition = current.componentId ? graph.getNode(current.componentId) : undefined;
    return { ...(definition ? inherited(definition, seen) : {}), ...effectiveFigmaRawNodeFields(current) };
  };
  let raw = inherited(node), overridden = false;
  const path: SceneNode[] = [], seen = new Set<string>();
  for (let current: SceneNode | undefined = node; current; current = current.parentId ? graph.getNode(current.parentId) : undefined) {
    if (seen.has(current.id) || seen.size >= 20000) throw new Error();
    seen.add(current.id);
    if (current.type === 'INSTANCE' && path.length) {
      const overrides = current.source.fig.symbolOverrides;
      if (overrides.length > 20000) throw new Error();
      for (const value of overrides) {
        const override = record(value), guids = record(override?.guidPath)?.guids;
        if (!Array.isArray(guids) || guids.length !== path.length) continue;
        if (guids.every((guid, index) => {
          const id = prototypeGuid(guid), member = path[path.length - 1 - index]!;
          const definition = member.componentId ? graph.getNode(member.componentId) : undefined;
          return !!id && (member.componentId === resolve(id) || definition?.source.id === id || definition?.overrideKey === id);
        })) {
          raw = { ...raw, ...override };
          if (override && ('prototypeInteractions' in override || 'connectionType' in override || 'transitionNodeID' in override)) overridden = true;
        }
      }
    }
    path.push(current);
  }
  return { raw, overridden };
}

function readFigmaPrototype(resolve: PrototypeResolver, raw: RecordValue): PrototypeRead {
  const unsupported = (detail: string): PrototypeRead => ({ imported: true, issue: `Imported prototype: ${detail} is preserved but cannot play yet.` });
  let entries: unknown[];
  if ('prototypeInteractions' in raw) {
    if (!Array.isArray(raw.prototypeInteractions) || raw.prototypeInteractions.length > 128) return unsupported('invalid or excessive interactions');
    entries = raw.prototypeInteractions.filter(value => record(value)?.isDeleted !== true);
    if (!entries.length) return {};
    if (entries.length > MAX_PROTOTYPE_INTERACTIONS) return unsupported('excessive interactions');
  } else if (!raw.transitionNodeID && !raw.connectionType) return {};
  else entries = [{ event: { ...raw, interactionType: raw.interactionType ?? 'ON_CLICK' }, actions: [raw] }];
  const interactions: DesignInteraction[] = [];
  for (const [index, value] of entries.entries()) {
    const interaction = record(value), event = record(interaction?.event);
    if (!interaction || !event || !Array.isArray(interaction.actions) || !interaction.actions.length || interaction.actions.length > MAX_DESIGN_ACTIONS || interaction.actions.some(action => !record(action))) return unsupported('an action sequence');
    const action = record(interaction.actions[0])!;
    let selectedTrigger: DesignTrigger;
    if (event.interactionType === 'ON_CLICK') selectedTrigger = { type: 'click' };
    else if (event.interactionType === 'DRAG') { if (event.interactionDuration !== undefined && event.interactionDuration !== 0 || event.interactionMaintained === true) return unsupported('this drag trigger timing'); selectedTrigger = { type: 'drag' }; }
    else if (['MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_DOWN', 'MOUSE_UP', 'ON_HOVER', 'ON_PRESS', 'AFTER_TIMEOUT'].includes(String(event.interactionType))) {
      const timed = event.interactionType === 'AFTER_TIMEOUT', seconds = timed ? event.transitionTimeout ?? action.transitionTimeout : event.interactionDuration ?? 0;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 60 || event.interactionMaintained === true && !['ON_HOVER', 'ON_PRESS'].includes(String(event.interactionType))) return unsupported('this trigger timing');
      selectedTrigger = { type: timed ? 'delay' : ({ MOUSE_ENTER: 'pointer-enter', MOUSE_LEAVE: 'pointer-leave', MOUSE_DOWN: 'pointer-down', MOUSE_UP: 'pointer-up', ON_HOVER: 'hover', ON_PRESS: 'press' } as const)[event.interactionType as 'MOUSE_ENTER'], ...(timed || seconds ? { delay: Math.round(seconds * 1000) } : {}) } as DesignTrigger;
    } else if (event.interactionType === 'ON_MEDIA_END') selectedTrigger = { type: 'media-end' };
    else if (event.interactionType === 'ON_MEDIA_HIT' && typeof event.mediaHitTime === 'number' && Number.isFinite(event.mediaHitTime) && event.mediaHitTime >= 0 && event.mediaHitTime <= 86400) selectedTrigger = { type: 'media-hit', time: event.mediaHitTime };
    else if (event.interactionType === 'ON_KEY_DOWN') {
      const key = record(event.keyTrigger);
      if (key?.triggerDevice !== 'KEYBOARD' || !validPrototypeKeys(key.keyCodes)) return unsupported('this keyboard trigger');
      selectedTrigger = { type: 'key', keyCodes: [...key.keyCodes].sort((a, b) => a - b) };
    } else return unsupported('this trigger');
    try {
      const budget = { count: 0 }; const actions = interaction.actions.map(action => nativeNavigation(record(action)!, resolve, 0, budget));
      const link: DesignNavigation = actions.length === 1 ? actions[0]! : { action: 'sequence', actions, transition: 'instant', duration: 0 };
      interactions.push({ id: `imported-${index}`, trigger: selectedTrigger, navigation: link });
    } catch (error) { return unsupported(error instanceof Error ? error.message : 'this action sequence'); }
  }
  return result(interactions, true);
}

function nativeNavigation(action: RecordValue, resolve: PrototypeResolver, depth = 0, budget = { count: 0 }): DesignNavigation {
  if (depth > 8 || ++budget.count > MAX_DESIGN_ACTIONS) throw new Error('an excessive action tree');
  if (action.transitionResetInteractiveComponents !== undefined && typeof action.transitionResetInteractiveComponents !== 'boolean') throw new Error('this interactive component reset setting');
  if (action.transitionResetVideoPosition !== undefined && typeof action.transitionResetVideoPosition !== 'boolean') throw new Error('this video reset setting');
  const actionConnection = action.connectionType ?? (action.transitionNodeID ? 'INTERNAL_NODE' : undefined);
  if (action.transitionResetInteractiveComponents === true && (!['INTERNAL_NODE', 'BACK', 'CLOSE'].includes(String(actionConnection)) || action.navigationType === 'SCROLL_TO')) throw new Error('this interactive component reset setting');
  if (action.transitionResetVideoPosition === true && (!['INTERNAL_NODE', 'BACK', 'CLOSE'].includes(String(actionConnection)) || action.navigationType === 'SCROLL_TO')) throw new Error('this video reset setting');
  if (action.connectionType === 'SET_VARIABLE') {
    const target = record(action.targetVariable); if (target?.nodeFieldAlias) throw new Error('a node-field variable target');
    const variable = resolve(nativePrototypeReference(target?.id ?? action.targetVariableID));
    let data = action.targetVariableData;
    if (!data) { const value = record(action.targetVariableValue); const fields = ['boolValue', 'floatValue', 'textValue', 'colorValue', 'alias', 'expressionValue'].filter(field => value && field in value); if (fields.length !== 1) throw new Error('a legacy variable value'); data = { dataType: { boolValue: 'BOOLEAN', floatValue: 'FLOAT', textValue: 'STRING', colorValue: 'COLOR', alias: 'ALIAS', expressionValue: 'EXPRESSION' }[fields[0]!], value }; }
    return { action: 'set-variable', variable, value: readNativePrototypeOperand(data, resolve), transition: 'instant', duration: 0 };
  }
  if (action.connectionType === 'SET_VARIABLE_MODE') return { action: 'set-mode', collection: resolve(nativePrototypeReference(action.targetVariableSetID)), mode: resolve(nativePrototypeReference(action.targetVariableModeID)), transition: 'instant', duration: 0 };
  if (action.connectionType === 'CONDITIONAL') {
    if (!Array.isArray(action.conditionalActions) || !action.conditionalActions.length || action.conditionalActions.length > 16) throw new Error('conditional branches');
    const branches = action.conditionalActions.map((value, index) => { const branch = record(value); if (!branch || !Array.isArray(branch.actions) || branch.condition === undefined && index !== (action.conditionalActions as unknown[]).length - 1) throw new Error('conditional branches'); return { ...(branch.condition !== undefined ? { condition: readNativePrototypeOperand(branch.condition, resolve) } : {}), actions: branch.actions.map(action => { const data = record(action); if (!data) throw new Error('a conditional action'); return nativeNavigation(data, resolve, depth + 1, budget); }) }; });
    return { action: 'conditional', branches, transition: 'instant', duration: 0 };
  }
  if (action.connectionType === 'URL') {
    if (action.linkParam !== undefined || action.cmsTarget !== undefined) throw new Error('a variable or CMS link');
    if (action.openUrlInNewTab !== undefined && typeof action.openUrlInNewTab !== 'boolean') throw new Error('this link target setting');
    try { return { action: 'open-url', url: validateDesignUrl(action.connectionURL), ...(action.openUrlInNewTab !== undefined ? { newTab: action.openUrlInNewTab } : {}), transition: 'instant', duration: 0 }; }
    catch { throw new Error('this link URL'); }
  }
  if (action.connectionType === 'UPDATE_MEDIA_RUNTIME') {
    const kinds = { PLAY: 'play', PAUSE: 'pause', TOGGLE_PLAY_PAUSE: 'toggle' } as const;
    const mediaAction = typeof action.mediaAction === 'string' && Object.hasOwn(kinds, action.mediaAction) ? kinds[action.mediaAction as keyof typeof kinds] : undefined;
    if (!mediaAction || ['mediaSkipToTime', 'mediaSkipByAmount', 'mediaPlaybackRate', 'linkParam', 'cmsTarget', 'animationTargetId', 'animationType', 'animationPhase', 'animationState'].some(key => action[key] !== undefined)) throw new Error('this media action or media parameters');
    const target = prototypeGuid(action.transitionNodeID);
    if (!target) throw new Error('a missing video target');
    const info = record(action.transitionInfo);
    if (action.transitionType !== undefined && action.transitionType !== 'INSTANT_TRANSITION' || info?.type !== undefined && info.type !== 'INSTANT_TRANSITION' || action.transitionDuration !== undefined && action.transitionDuration !== 0 || info?.duration !== undefined && info.duration !== 0 || ['easingType', 'easingFunction', 'transitionResetInteractiveComponents', 'transitionResetVideoPosition', 'transitionPreserveScroll', 'transitionResetScrollPosition', 'overlayRelativePosition', 'extraScrollOffset'].some(key => action[key] !== undefined)) throw new Error('this media transition or route setting');
    return { action: 'media', mediaAction, target: resolve(target), transition: 'instant', duration: 0 };
  }
  const connection = action.connectionType ?? (action.transitionNodeID ? 'INTERNAL_NODE' : undefined);
  if (!['INTERNAL_NODE', 'BACK', 'CLOSE'].includes(String(connection))) throw new Error('this action');
  if (action.navigationType && !['NAVIGATE', 'OVERLAY', 'SWAP', 'SCROLL_TO'].includes(String(action.navigationType)) || connection !== 'INTERNAL_NODE' && (action.navigationType && action.navigationType !== 'NAVIGATE' || action.destinationIsOverlay === true)) throw new Error('this navigation');
  const transition = action.transitionType ?? record(action.transitionInfo)?.type ?? 'INSTANT_TRANSITION';
  const directional = /^(SLIDE_FROM|SLIDE_OUT_TO|MOVE_FROM|MOVE_OUT_TO|PUSH_FROM)_(LEFT|RIGHT|TOP|BOTTOM)$/.exec(String(transition));
  const kinds: Record<string, DesignNavigation['transition']> = { SLIDE_FROM: 'slide', SLIDE_OUT_TO: 'slide-out', MOVE_FROM: 'move-in', MOVE_OUT_TO: 'move-out', PUSH_FROM: 'push' };
  if (transition !== 'INSTANT_TRANSITION' && transition !== 'DISSOLVE' && transition !== 'SMART_ANIMATE' && transition !== 'SCROLL_ANIMATE' && !directional) throw new Error('this transition');
  if (action.transitionShouldSmartAnimate === true && !directional && transition !== 'SMART_ANIMATE') throw new Error('matching layers on this transition');
  const seconds = action.transitionDuration ?? record(action.transitionInfo)?.duration ?? 0;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 10) throw new Error('this duration');
  const target = prototypeGuid(action.transitionNodeID);
  if (connection === 'INTERNAL_NODE' && !target) throw new Error('a missing destination');
  const easings: Record<string, DesignNavigation['easing']> = { LINEAR: 'linear', IN_CUBIC: 'ease-in', OUT_CUBIC: 'ease-out', INOUT_CUBIC: 'ease-in-out' };
  let easing = action.easingType ? easings[String(action.easingType)] : undefined;
  if (action.easingType === 'CUSTOM_CUBIC') easing = action.easingFunction as DesignNavigation['easing'];
  if (action.easingType && !easing) throw new Error('this easing');
  try {
    const selectedAction = connection === 'BACK' ? 'back' : connection === 'CLOSE' ? 'close' : action.navigationType === 'SCROLL_TO' ? 'scroll' : action.navigationType === 'SWAP' ? 'swap' : action.navigationType === 'OVERLAY' || action.destinationIsOverlay === true ? 'overlay' : 'navigate';
    return navigation({ action: selectedAction, ...(target && connection === 'INTERNAL_NODE' ? { target: resolve(target) } : {}), transition: transition === 'SMART_ANIMATE' ? 'smart' : transition === 'SCROLL_ANIMATE' ? 'scroll' : transition === 'DISSOLVE' ? 'dissolve' : directional ? kinds[directional[1]!] : 'instant', duration: Math.round(seconds * 1000), ...(directional ? { direction: directional[2]!.toLowerCase(), ...(action.transitionShouldSmartAnimate === true ? { matchLayers: true } : {}) } : {}), ...(easing ? { easing } : {}), ...(selectedAction === 'scroll' && action.extraScrollOffset !== undefined ? { offset: action.extraScrollOffset } : ['overlay', 'swap'].includes(selectedAction) && action.overlayRelativePosition !== undefined ? { offset: action.overlayRelativePosition } : {}), ...(action.transitionPreserveScroll === true ? { preserveScroll: true } : {}), ...(action.transitionResetScrollPosition === true ? { resetScroll: true } : {}), ...(action.transitionResetInteractiveComponents !== undefined ? { resetInteractiveComponents: action.transitionResetInteractiveComponents } : {}), ...(action.transitionResetVideoPosition !== undefined ? { resetVideoPosition: action.transitionResetVideoPosition } : {}) }, id => id);
  } catch { throw new Error('this action, offset or easing data'); }
}

function editable(graph: SceneGraph, node: SceneNode) {
  let current: SceneNode | undefined = node;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) throw new Error('This layer has invalid ancestry.');
    seen.add(current.id);
    if (current.locked || current.internalOnly || current.librarySource?.readOnly) throw new Error('Unlock the original layer before changing its prototype.');
    current = current.parentId ? graph.getNode(current.parentId) : undefined;
  }
}
export function setPrototypeMetadata(editor: Editor, node: SceneNode, key: string, value?: string) {
  editable(editor.graph, node);
  const pluginData = node.pluginData.filter(entry => !(entry.pluginId === PLUGIN && entry.key === key));
  if (value) pluginData.push({ pluginId: PLUGIN, key, value });
  if (JSON.stringify(pluginData) !== JSON.stringify(node.pluginData)) editor.updateNodeWithUndo(node.id, { pluginData }, 'Change prototype');
}
const metadata = setPrototypeMetadata;
export function prototypeActionContexts(graph: SceneGraph, node: SceneNode | undefined, actions: DesignNavigation[], initial: SceneNode | null | undefined = node && prototypeFrame(graph, node)): (SceneNode | null | undefined)[] {
  let base: SceneNode | null | undefined = initial;
  const history: (SceneNode | null | undefined)[] = [], overlays: SceneNode[] = [];
  const contexts: (SceneNode | null | undefined)[] = [];
  for (const action of actions) {
    contexts.push(overlays.at(-1) ?? base);
    if (action.action === 'conditional') { base = null; overlays.length = 0; continue; }
    const target = action.target && !action.unresolved ? graph.getNode(action.target) : undefined;
    if (action.action === 'overlay' && target) overlays.push(target);
    else if (action.action === 'swap' && target && overlays.length) overlays[overlays.length - 1] = target;
    else if ((action.action === 'navigate' || action.action === 'swap') && target) {
      if (action.action === 'navigate' && target !== base) history.push(base);
      base = target; overlays.length = 0;
    } else if (action.action === 'back') {
      if (history.length) { const next = history.pop(); if (next !== base) { base = next; overlays.length = 0; } }
      // History before this interaction, and a pre-existing overlay's underlay, are known only by the presentation host.
      else { base = null; overlays.length = 0; }
    } else if (action.action === 'close') {
      if (overlays.length) overlays.pop();
      else base = null;
    }
  }
  return contexts;
}
export function prototypeActionScrollTargets(graph: SceneGraph, context: SceneNode | null | undefined, screens: SceneNode[]): SceneNode[] {
  if (context === undefined) return [];
  if (context) return scrollTargets(graph, context);
  const targets: SceneNode[] = [];
  for (const screen of screens) { targets.push(...scrollTargets(graph, screen)); if (targets.length > 20000) throw new Error('Scroll targets support at most 20,000 layers.'); }
  return targets;
}
export function isPrototypeVideo(node: SceneNode): boolean {
  return node.visible && !node.internalOnly && !node.librarySource?.readOnly && node.fills.some(fill => fill.visible && fill.type === 'VIDEO');
}
export function prototypeActionMediaTargets(graph: SceneGraph, context: SceneNode | null | undefined, screens: SceneNode[]): SceneNode[] {
  const roots = context === null ? screens : context ? [context] : [];
  const targets: SceneNode[] = [], visited = new Set<string>(), pending = [...roots].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (visited.size > 20000) throw new Error('Video targets support at most 20,000 layers.');
    if (!node.visible || node.internalOnly || node.librarySource?.readOnly) continue;
    if (isPrototypeVideo(node)) targets.push(node);
    const children = graph.getChildren(node.id);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
  }
  return targets;
}
export function resolvePrototypeMediaTarget(graph: SceneGraph, actor: SceneNode | undefined, target: string, videos: SceneNode[]): SceneNode | undefined {
  const exact = videos.find(video => video.id === target); if (exact) return exact;
  const aliases = videos.filter(video => video.componentId === target); if (!aliases.length) return;
  const scopes = new Map<string, number>(), seen = new Set<string>();
  for (let node = actor; node && !seen.has(node.id); node = node.parentId ? graph.getNode(node.parentId) : undefined) {
    seen.add(node.id); if (seen.size > 20000) throw new Error('Video target ancestry supports at most 20,000 layers.');
    if (node.type === 'INSTANCE') scopes.set(node.id, scopes.size);
  }
  let rank = Infinity, selected: SceneNode | undefined, ambiguous = false;
  for (const video of aliases) {
    const visited = new Set<string>(); let local = scopes.size ? Infinity : 0;
    for (let node: SceneNode | undefined = video; node && !visited.has(node.id); node = node.parentId ? graph.getNode(node.parentId) : undefined) {
      visited.add(node.id); if (visited.size > 20000) throw new Error('Video target ancestry supports at most 20,000 layers.');
      if (scopes.has(node.id)) { local = scopes.get(node.id)!; break; }
    }
    if (!Number.isFinite(local)) continue;
    if (local < rank) { rank = local; selected = video; ambiguous = false; }
    else if (local === rank) ambiguous = true;
  }
  if (ambiguous) throw new Error('Choose an explicit video; its component target is ambiguous in this occurrence.');
  return selected;
}
export function canonicalPrototypeMediaActions(graph: SceneGraph, actor: SceneNode, navigation: DesignNavigation): DesignNavigation {
  if (!allDesignActions(navigation).some(action => action.action === 'media')) return navigation;
  let page: SceneNode | undefined = actor; const seen = new Set<string>();
  while (page && page.type !== 'CANVAS' && !seen.has(page.id)) {
    seen.add(page.id); if (seen.size > 20000) throw new Error('Video target ancestry supports at most 20,000 layers.');
    page = page.parentId ? graph.getNode(page.parentId) : undefined;
  }
  const screens = page?.type === 'CANVAS' ? prototypeScreens(graph, page.id) : [];
  const visit = (actions: DesignNavigation[], initial?: SceneNode | null): DesignNavigation[] => {
    const contexts = prototypeActionContexts(graph, actor, actions, initial);
    return actions.map((action, index) => {
      if (action.action === 'conditional') return { ...action, branches: action.branches!.map(branch => ({ ...branch, actions: visit(branch.actions, contexts[index] ?? null) })) };
      if (action.action !== 'media' || !action.target || action.unresolved) return action;
      const target = resolvePrototypeMediaTarget(graph, actor, action.target, prototypeActionMediaTargets(graph, contexts[index], screens));
      return target ? { ...action, target: target.id } : { ...action, unresolved: true };
    });
  };
  const actions = visit(designActions(navigation));
  return navigation.action === 'sequence' ? { ...navigation, actions } : actions[0]!;
}
export function prototypeActionVariableIds(action: DesignNavigation): string[] {
  return [...(action.variable ? [action.variable] : []), ...(action.value ? prototypeOperandIds(action.value) : []), ...(action.branches?.flatMap(branch => branch.condition ? prototypeOperandIds(branch.condition) : []) ?? [])];
}
export function remapPrototypeActionVariables(action: DesignNavigation, variables: (id: string) => string, collections: (id: string) => string = variables, modes: (id: string) => string = variables): DesignNavigation {
  return { ...action, ...(action.variable ? { variable: variables(action.variable) } : {}), ...(action.value ? { value: mapPrototypeOperand(action.value, variables) } : {}), ...(action.collection ? { collection: collections(action.collection) } : {}), ...(action.mode ? { mode: modes(action.mode) } : {}), ...(action.branches ? { branches: action.branches.map(branch => ({ ...branch, ...(branch.condition ? { condition: mapPrototypeOperand(branch.condition, variables) } : {}) })) } : {}) };
}
function validateDestinations(editor: Editor, node: SceneNode, actions: DesignNavigation[], previous: DesignNavigation[], screens: Set<string>, initial?: SceneNode | null) {
  const contexts = prototypeActionContexts(editor.graph, node, actions, initial);
  for (const [index, action] of actions.entries()) {
    if (action.action === 'conditional') { for (const branch of action.branches!) validateDestinations(editor, node, branch.actions, previous.flatMap(action => allDesignActions(action)), screens, contexts[index] ?? null); continue; }
    const unchanged = previous.some(before => JSON.stringify(before) === JSON.stringify(action));
    if (!unchanged && (prototypeActionVariableIds(action).some(id => !editor.graph.variables.has(id)) || action.action === 'set-mode' && !editor.graph.variableCollections.get(action.collection!)?.modes.some(mode => mode.modeId === action.mode))) throw new Error('Choose existing prototype variables and modes.');
    const roots = [...screens].map(id => editor.graph.getNode(id)!);
    const videos = action.action === 'media' ? prototypeActionMediaTargets(editor.graph, contexts[index], roots) : [];
    if (action.action === 'media' && action.target && !action.unresolved) {
      const target = resolvePrototypeMediaTarget(editor.graph, node, action.target, videos);
      if (target) action.target = target.id;
    }
    const targets = action.action === 'media' ? new Set(videos.map(layer => layer.id)) : action.action === 'scroll' ? new Set(prototypeActionScrollTargets(editor.graph, contexts[index], roots).map(layer => layer.id)) : screens;
    if (action.target && (action.unresolved || !targets.has(action.target)) && !previous.some(before => JSON.stringify(before) === JSON.stringify(action))) throw new Error(action.action === 'media' ? 'Choose a visible video inside this screen or overlay at the current action step.' : action.action === 'scroll' ? 'Choose a visible layer inside this screen at the current action step.' : 'Choose a screen on this page.');
  }
}
export function setPrototypeInteractions(editor: Editor, node: SceneNode, interactions: DesignInteraction[]) {
  const candidate = { ...node, pluginData: [{ pluginId: PLUGIN, key: PROTOTYPE_INTERACTIONS, value: JSON.stringify(interactions) }] };
  const parsed = readPrototype(candidate);
  if (parsed.issue || !parsed.interactions) throw new Error(`Choose a valid prototype action, trigger and transition. ${parsed.issue ?? ''}`);
  const screens = new Set(prototypeScreens(editor.graph, editor.state.currentPageId).map(screen => screen.id));
  const previous = new Map((readPrototype(node, prototypeResolver(editor.graph)).interactions ?? []).map(interaction => [interaction.id, interaction.navigation]));
  for (const { id, trigger, navigation: link } of parsed.interactions) {
    if (['media-hit', 'media-end'].includes(trigger.type) && !node.fills.some(fill => fill.visible && fill.type === 'VIDEO') && !(readPrototype(node).interactions ?? []).some(interaction => interaction.id === id && JSON.stringify(interaction.trigger) === JSON.stringify(trigger))) throw new Error('Choose a video layer for media triggers.');
    const before = previous.get(id);
    validateDestinations(editor, node, designActions(link), before ? designActions(before) : [], screens);
  }
  metadata(editor, node, PROTOTYPE_INTERACTIONS, JSON.stringify(parsed.interactions));
}
export function setNavigation(editor: Editor, node: SceneNode, link: DesignNavigation | null) {
  const multiple = node.pluginData.some(entry => entry.pluginId === PLUGIN && entry.key === PROTOTYPE_INTERACTIONS);
  if (multiple) {
    const current = readPrototype(node); if (current.issue && link) throw new Error(current.issue);
    const rest = (current.interactions ?? []).filter(interaction => interaction.trigger.type !== 'click');
    let id = 'click'; while (rest.some(interaction => interaction.id === id)) id += '-';
    setPrototypeInteractions(editor, node, link ? [{ id, trigger: { type: 'click' }, navigation: link }, ...rest] : []); return;
  }
  let parsed: DesignNavigation | undefined;
  if (link) {
    try { parsed = navigation(link, id => id); } catch { throw new Error('Choose a valid prototype action and transition.'); }
    validateDestinations(editor, node, designActions(parsed), [], new Set(prototypeScreens(editor.graph, editor.state.currentPageId).map(screen => screen.id)));
  }
  const imported = effectiveFigmaRawNodeFields(node);
  metadata(editor, node, LINK, parsed ? JSON.stringify(parsed) : imported.prototypeInteractions || imported.connectionType || imported.transitionNodeID ? 'null' : undefined);
}
export function readPrototypeStart(page: SceneNode, resolve: PrototypeResolver): string | undefined {
  const saved = page.pluginData.find(entry => entry.pluginId === PLUGIN && entry.key === START)?.value;
  if (saved && saved.length <= 1024) {
    if (!saved.startsWith('{')) return saved;
    try {
      const target = record(JSON.parse(saved));
      if (target?.targetFormat === 'fig' && typeof target.target === 'string' && target.target.length <= 256) return resolve(target.target);
    } catch { /* A damaged saved start falls back to preserved FIG data. */ }
  }
  const imported = prototypeGuid(effectiveFigmaRawNodeFields(page).prototypeStartNodeID);
  return imported ? resolve(imported) : undefined;
}
export function prototypeStart(graph: SceneGraph, pageId: string): string | undefined {
  const screens = prototypeScreens(graph, pageId), page = graph.getNode(pageId); if (!page) return;
  const start = readPrototypeStart(page, prototypeResolver(graph));
  return screens.find(screen => screen.id === start)?.id ?? screens.find(screen => effectiveFigmaRawNodeFields(screen).prototypeStartingPoint)?.id ?? screens[0]?.id;
}
export function setPrototypeStart(editor: Editor, screenId: string) {
  if (!prototypeScreens(editor.graph, editor.state.currentPageId).some(screen => screen.id === screenId)) throw new Error('Choose a screen on this page.');
  metadata(editor, editor.graph.getNode(editor.state.currentPageId)!, START, screenId);
}

export { navigatePrototype, routePrototype, type PrototypeRoute } from './prototypeRouteRuntime';
