import { parseFigBuffer } from '@open-pencil/fig';
import type { GUID, NodeChange } from '@open-pencil/kiwi/fig/codec';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { encodeFigArchive } from './figArchive';
import { PROTOTYPE_INTERACTIONS, PROTOTYPE_LINK, PROTOTYPE_PLUGIN, PROTOTYPE_START, prototypeGuid, prototypeResolver, prototypeActionVariableIds, remapPrototypeActionVariables, readPrototype, readPrototypeStart, isPrototypeVideo, canonicalPrototypeMediaActions } from './prototype';
import { PROTOTYPE_OVERLAY, readPrototypeOverlay } from './prototypeOverlay';
import { effectiveFigmaRawNodeFields } from '@open-pencil/fig';
import { allDesignActions, designActions, mapDesignActions, isDesignSpring } from './reactExportRuntime';
import type { DesignNavigation, DesignOverlay, DesignScroll, DesignNode } from './reactExportRuntime';
import { writeNativePrototypeOperand } from './prototypeValueCodec';
import { PROTOTYPE_SCROLL, PROTOTYPE_SCROLL_BEHAVIOUR, readPrototypeScroll, readScrollBehaviour, scrollContainer } from './prototypeScroll';

const MARKER = 'orion.xdesign.prototype-export';
const legacyFields = ['transitionNodeID', 'transitionInfo', 'transitionType', 'transitionDuration', 'connectionType', 'connectionURL', 'openUrlInNewTab', 'mediaAction', 'mediaSkipToTime', 'mediaSkipByAmount', 'mediaPlaybackRate', 'interactionType', 'transitionTimeout', 'interactionDuration', 'interactionMaintained', 'destinationIsOverlay', 'navigationType', 'transitionShouldSmartAnimate', 'overlayRelativePosition', 'extraScrollOffset', 'transitionPreserveScroll', 'transitionResetScrollPosition', 'transitionResetInteractiveComponents', 'transitionResetVideoPosition'];

/** Receives only the caller's isolated export graph. Protocol GUIDs are assigned
 * by the native exporter, so connections are finalized after that assignment. */
export function prepareFigPrototype(graph: SceneGraph): ((bytes: Uint8Array) => Uint8Array) | null {
  const resolve = prototypeResolver(graph), links: { node: SceneNode; interactions: NonNullable<ReturnType<typeof readPrototype>['interactions']> }[] = [], starts: { node: SceneNode; target: string }[] = [];
  const overlays: { node: SceneNode; settings: DesignOverlay }[] = [];
  const scrolling: { node: SceneNode; settings: DesignScroll }[] = [], positioning: { node: SceneNode; behaviour: NonNullable<DesignNode['scrollBehaviour']> }[] = [];
  for (const node of graph.nodes.values()) {
    if (scrollContainer(node)) {
      const own = node.pluginData.some(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_SCROLL), read = readPrototypeScroll(node), raw = effectiveFigmaRawNodeFields(node);
      if (own && read.issue) throw new Error(`${node.name}: ${read.issue}`);
      if (!read.issue && (own || 'scrollDirection' in raw || 'scrollOffset' in raw)) scrolling.push({ node, settings: read.settings });
    }
    const ownPosition = node.pluginData.some(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_SCROLL_BEHAVIOUR), behaviour = readScrollBehaviour(node, graph), raw = effectiveFigmaRawNodeFields(node);
    if (ownPosition && behaviour.issue) throw new Error(`${node.name}: ${behaviour.issue}`);
    if (!behaviour.issue && (ownPosition || behaviour.behaviour !== 'scroll' || 'scrollBehavior' in raw)) positioning.push({ node, behaviour: behaviour.behaviour });
    if (node.type === 'FRAME') {
      const own = node.pluginData.some(entry => entry.pluginId === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_OVERLAY), raw = effectiveFigmaRawNodeFields(node), overlay = readPrototypeOverlay(node);
      if (own && overlay.issue) throw new Error(`${node.name}: ${overlay.issue}`);
      if (!overlay.issue && (own || ['overlayPositionType', 'overlayBackgroundInteraction', 'overlayBackgroundAppearance'].some(key => key in raw))) overlays.push({ node, settings: overlay.settings });
    }
    const authored = node.pluginData.some(entry => entry.pluginId === PROTOTYPE_PLUGIN && [PROTOTYPE_LINK, PROTOTYPE_INTERACTIONS].includes(entry.key));
    const read = readPrototype(node, resolve), issue = read.issue;
    const interactions = read.interactions?.map(interaction => ({ ...interaction, navigation: canonicalPrototypeMediaActions(graph, node, interaction.navigation) }));
    if (authored && issue) throw new Error(`${node.name}: ${issue}`);
    if (authored || interactions) {
      for (const interaction of interactions ?? []) for (const link of allDesignActions(interaction.navigation)) if (link.target && (link.unresolved || !graph.getNode(link.target) || (link.action === 'media' ? !isPrototypeVideo(graph.getNode(link.target)!) : link.action !== 'scroll' && graph.getNode(link.target)?.type !== 'FRAME'))) throw new Error(`${node.name}: repair its missing prototype destination before exporting FIG.`);
      for (const interaction of interactions ?? []) for (const action of allDesignActions(interaction.navigation)) if (isDesignSpring(action.easing)) throw new Error(`${node.name}: Save a portable XDesign project for physical springs; native FIG spring parameter transport still needs an authored-file comparison.`);
      for (const interaction of interactions ?? []) for (const action of allDesignActions(interaction.navigation)) if (prototypeActionVariableIds(action).some(id => !graph.variables.has(id)) || action.action === 'set-mode' && !graph.variableCollections.get(action.collection!)?.modes.some(mode => mode.modeId === action.mode)) throw new Error(`${node.name}: repair its missing prototype variable or mode before exporting FIG.`);
      links.push({ node, interactions: interactions ?? [] });
    }
    if (node.type === 'CANVAS') {
      const target = readPrototypeStart(node, resolve);
      if (target && graph.getNode(target)?.type === 'FRAME') starts.push({ node, target });
    }
  }
  if (!links.length && !starts.length && !overlays.length && !scrolling.length && !positioning.length) return null;
  const occurrence = (node: SceneNode) => {
    const path: SceneNode[] = [], seen = new Set<string>(); let owner: SceneNode | undefined, nearest: SceneNode | undefined;
    for (let current: SceneNode | undefined = node; current; current = current.parentId ? graph.getNode(current.parentId) : undefined) {
      if (seen.has(current.id) || seen.size >= 20000) throw new Error('A prototype instance path could not be exported.');
      seen.add(current.id); if (current.type === 'INSTANCE') { owner = current; nearest ??= current; }
      path.unshift(current);
    }
    return owner ? { owner, nearest: nearest!, path: path.slice(path.findIndex(item => item.id === owner.id) + 1) } : undefined;
  };
  const marked = new Set<string>();
  const mark = (id: string) => {
    if (marked.has(id)) return;
    marked.add(id); const node = graph.getNode(id)!;
    graph.updateNode(id, { pluginData: [...node.pluginData.filter(entry => entry.pluginId !== MARKER), { pluginId: MARKER, key: 'id', value: id }] });
  };
  const markOccurrence = (node: SceneNode) => {
    const scope = occurrence(node); if (!scope) return;
    mark(scope.owner.id);
    for (const actual of scope.path) if (actual.componentId && graph.getNode(actual.componentId)) mark(actual.componentId);
  };
  for (const { node, interactions } of links) {
    mark(node.id); markOccurrence(node);
    for (const interaction of interactions) for (const link of allDesignActions(interaction.navigation)) if (link.target) { mark(link.target); markOccurrence(graph.getNode(link.target)!); }
  }
  for (const { node, target } of starts) { mark(node.id); mark(target); }
  for (const { node } of overlays) mark(node.id);
  for (const { node } of scrolling) mark(node.id);
  const fixedParents = new Set<string>();
  for (const { node } of positioning) {
    mark(node.id);
    if (node.parentId && graph.getNode(node.parentId) && scrollContainer(graph.getNode(node.parentId)!)) { fixedParents.add(node.parentId); mark(node.parentId); for (const child of graph.getChildren(node.parentId)) mark(child.id); }
  }
  return bytes => {
    const parsed = parseFigBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const records = new Map<string, NodeChange>(), used = new Set<string>();
    const reserveInteractions = (interactions: NodeChange['prototypeInteractions']) => {
      for (const interaction of interactions ?? []) { const id = prototypeGuid((interaction as Record<string, unknown>).id); if (id) used.add(id); }
    };
    for (const node of parsed.nodeChanges) {
      if (node.guid) used.add(prototypeGuid(node.guid)!);
      reserveInteractions(node.prototypeInteractions);
      const data = node.symbolData as { symbolOverrides?: { prototypeInteractions?: NodeChange['prototypeInteractions'] }[] } | undefined;
      for (const override of data?.symbolOverrides ?? []) reserveInteractions(override.prototypeInteractions);
      for (const entry of node.pluginData ?? []) if (entry.pluginID === MARKER && entry.key === 'id') records.set(entry.value, node);
    }
    // The pinned exporter emits CANVAS records in getPages(true) order, but
    // omits their plugin data. Slots may have added an internal page already.
    const pages = graph.getPages(true), canvases = parsed.nodeChanges.filter(node => node.type === 'CANVAS');
    for (const [index, page] of pages.entries()) {
      const canvas = canvases[index];
      if (!canvas || canvas.name !== page.name || !!canvas.internalOnly !== !!page.internalOnly) throw new Error('The exported page identities could not be mapped.');
      records.set(page.id, canvas);
      canvas.pluginData = page.pluginData.filter(entry => entry.pluginId !== MARKER).map(entry => ({ pluginID: entry.pluginId, key: entry.key, value: entry.value }));
    }
    const definitionGuid = (actual: SceneNode, override = true): GUID => {
      const definition = actual.componentId ? graph.getNode(actual.componentId) : undefined;
      if (!definition) throw new Error(`${actual.name}: its prototype instance path has no component definition.`);
      if (actual.type === 'INSTANCE' && definition.type !== 'INSTANCE') throw new Error(`${actual.name}: its nested prototype instance path has no exact definition identity.`);
      const key = override && definition.overrideKey?.match(/^(\d+):(\d+)$/);
      if (key) { const guid = { sessionID: Number(key[1]), localID: Number(key[2]) }; if (prototypeGuid(guid)) return guid; }
      const guid = records.get(definition.id)?.guid;
      if (!guid) throw new Error(`${actual.name}: its prototype component definition has no exported identity.`);
      return guid;
    };
    const destination = (id: string, actor?: SceneNode, media = false): GUID => {
      const guid = records.get(id)?.guid; if (guid) return guid;
      const target = graph.getNode(id), targetScope = target && occurrence(target), actorScope = actor && occurrence(actor);
      if (media && target && targetScope && actorScope?.owner.id === targetScope.owner.id && actorScope.nearest.id === targetScope.nearest.id) return definitionGuid(target, false);
      throw new Error('A prototype destination has no exported identity in this instance occurrence.');
    };
    type NativeOverride = Pick<NodeChange, 'prototypeInteractions' | 'pluginData'> & { guidPath: { guids: GUID[] } };
    const interactionLayer = (node: SceneNode): NodeChange | NativeOverride => {
      const direct = records.get(node.id); if (direct) return direct;
      const scope = occurrence(node), owner = scope && records.get(scope.owner.id);
      if (!scope || !scope.path.length || !owner?.symbolData) throw new Error(`${node.name}: its prototype layer could not be exported.`);
      const guids = scope.path.map(actual => definitionGuid(actual)), data = owner.symbolData as { symbolID: GUID; symbolOverrides?: NativeOverride[] };
      const overrides = data.symbolOverrides ?? [], key = JSON.stringify(guids);
      let target = overrides.find(item => JSON.stringify(item.guidPath?.guids) === key);
      if (!target) { target = { guidPath: { guids } }; overrides.push(target); }
      data.symbolOverrides = overrides; owner.symbolData = data;
      return target;
    };
    const variableGuids = new Map<string, GUID>();
    const sets = parsed.nodeChanges.filter(node => node.type === 'VARIABLE_SET');
    for (const [index, collection] of [...graph.variableCollections.values()].entries()) {
      const record = sets[index];
      if (!record?.guid || record.name !== collection.name || record.variableSetModes?.length !== collection.modes.length) throw new Error('The exported variable collection identities could not be mapped.');
      variableGuids.set(collection.id, record.guid);
      collection.modes.forEach((mode, index) => { const native = record.variableSetModes![index]!; if (!native.id || native.name !== mode.name) throw new Error('The exported variable mode identities could not be mapped.'); variableGuids.set(mode.modeId, native.id); });
      const variables = parsed.nodeChanges.filter(node => node.type === 'VARIABLE' && prototypeGuid(node.variableSetID?.guid) === prototypeGuid(record.guid));
      const sourceVariables = collection.variableIds.flatMap(id => { const variable = graph.variables.get(id); return variable ? [variable] : []; });
      if (variables.length !== sourceVariables.length) throw new Error('The exported variable identities could not be mapped.');
      sourceVariables.forEach((variable, index) => { const native = variables[index]!; if (!native.guid || native.name !== variable.name) throw new Error('The exported variable identities could not be mapped.'); variableGuids.set(variable.id, native.guid); });
    }
    const variableDestination = (id: string): GUID => { const guid = variableGuids.get(id); if (!guid) throw new Error('A prototype variable has no exported identity.'); return guid; };
    const variableReference = (id: string) => prototypeGuid(variableDestination(id))!;
    let localID = 1;
    const interactionGuid = () => { while (used.has(`4294967293:${localID}`)) localID++; const guid = { sessionID: 4294967293, localID: localID++ }; used.add(prototypeGuid(guid)!); return guid; };
    for (const { node, interactions } of links) {
      const native = interactionLayer(node);
      for (const field of legacyFields) Reflect.deleteProperty(native, field);
      const nativeActions = (navigation: DesignNavigation): Record<string, unknown>[] => designActions(navigation).map(link => {
        if (link.action === 'open-url') return { connectionType: 'URL', connectionURL: link.url, ...(link.newTab !== undefined ? { openUrlInNewTab: link.newTab } : {}) };
        if (link.action === 'media') return { connectionType: 'UPDATE_MEDIA_RUNTIME', transitionNodeID: destination(link.target!, node, true), mediaAction: ({ play: 'PLAY', pause: 'PAUSE', toggle: 'TOGGLE_PLAY_PAUSE' } as const)[link.mediaAction!] };
        if (link.action === 'set-variable') return { connectionType: 'SET_VARIABLE', targetVariable: { id: { guid: variableDestination(link.variable!) } }, targetVariableData: { ...writeNativePrototypeOperand(link.value!, variableDestination, id => graph.variables.get(id)!.type), resolvedDataType: graph.variables.get(link.variable!)!.type } };
        if (link.action === 'set-mode') return { connectionType: 'SET_VARIABLE_MODE', targetVariableSetID: { guid: variableDestination(link.collection!) }, targetVariableModeID: variableDestination(link.mode!) };
        if (link.action === 'conditional') return { connectionType: 'CONDITIONAL', conditionalActions: link.branches!.map(branch => ({ ...(branch.condition ? { condition: { ...writeNativePrototypeOperand(branch.condition, variableDestination, id => graph.variables.get(id)!.type), resolvedDataType: 'BOOLEAN' } } : {}), actions: branch.actions.flatMap(action => nativeActions(action)) })) };
        const easing = typeof link.easing === 'string' ? { linear: 'LINEAR', 'ease-in': 'IN_CUBIC', 'ease-out': 'OUT_CUBIC', 'ease-in-out': 'INOUT_CUBIC' }[link.easing] : link.easing ? 'CUSTOM_CUBIC' : undefined;
        return { connectionType: link.action === 'back' ? 'BACK' : link.action === 'close' ? 'CLOSE' : 'INTERNAL_NODE', ...(link.target ? { transitionNodeID: destination(link.target), navigationType: link.action === 'overlay' ? 'OVERLAY' : link.action === 'swap' ? 'SWAP' : link.action === 'scroll' ? 'SCROLL_TO' : 'NAVIGATE' } : {}), ...(link.offset ? link.action === 'scroll' ? { extraScrollOffset: link.offset } : { overlayRelativePosition: link.offset } : {}), ...(link.preserveScroll ? { transitionPreserveScroll: true } : {}), ...(link.resetScroll ? { transitionResetScrollPosition: true } : {}), ...(link.resetInteractiveComponents !== undefined ? { transitionResetInteractiveComponents: link.resetInteractiveComponents } : {}), ...(link.resetVideoPosition !== undefined ? { transitionResetVideoPosition: link.resetVideoPosition } : {}), ...(link.matchLayers ? { transitionShouldSmartAnimate: true } : {}), transitionType: link.transition === 'smart' ? 'SMART_ANIMATE' : link.transition === 'instant' ? 'INSTANT_TRANSITION' : link.transition === 'dissolve' ? 'DISSOLVE' : link.transition === 'scroll' ? 'SCROLL_ANIMATE' : `${({ slide: 'SLIDE_FROM', 'slide-out': 'SLIDE_OUT_TO', 'move-in': 'MOVE_FROM', 'move-out': 'MOVE_OUT_TO', push: 'PUSH_FROM' } as const)[link.transition as 'slide']}_${(link.direction ?? 'right').toUpperCase()}`, transitionDuration: link.duration / 1000, ...(easing ? { easingType: easing } : {}), ...(Array.isArray(link.easing) ? { easingFunction: link.easing } : {}) };
      });
      native.prototypeInteractions = interactions.map(({ trigger, navigation }) => {
        const interactionType = { click: 'ON_CLICK', drag: 'DRAG', 'pointer-enter': 'MOUSE_ENTER', 'pointer-leave': 'MOUSE_LEAVE', delay: 'AFTER_TIMEOUT', key: 'ON_KEY_DOWN', 'pointer-down': 'MOUSE_DOWN', 'pointer-up': 'MOUSE_UP', hover: 'ON_HOVER', press: 'ON_PRESS', 'media-hit': 'ON_MEDIA_HIT', 'media-end': 'ON_MEDIA_END' }[trigger.type];
        return { id: interactionGuid(), event: { interactionType, ...(trigger.type === 'delay' ? { transitionTimeout: trigger.delay / 1000 } : {}), ...(trigger.type === 'pointer-enter' || trigger.type === 'pointer-leave' || trigger.type === 'pointer-down' || trigger.type === 'pointer-up' || trigger.type === 'hover' || trigger.type === 'press' ? { interactionDuration: (trigger.delay ?? 0) / 1000 } : {}), ...(trigger.type === 'hover' || trigger.type === 'press' ? { interactionMaintained: true } : {}), ...(trigger.type === 'media-hit' ? { mediaHitTime: trigger.time } : {}), ...(trigger.type === 'key' ? { keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: trigger.keyCodes } } : {}) }, actions: nativeActions(navigation) };
      }) as NonNullable<NodeChange['prototypeInteractions']>;
      const mapped = interactions.map(interaction => ({ ...interaction, navigation: mapDesignActions(interaction.navigation, link => ({ ...remapPrototypeActionVariables(link, variableReference), ...(['set-variable', 'set-mode', 'conditional'].includes(link.action) ? { variableFormat: 'fig' } : {}), ...(link.target ? { target: prototypeGuid(destination(link.target, node, link.action === 'media')), targetFormat: 'fig' } : {}) })) }));
      native.pluginData = [...(native.pluginData ?? []).filter(entry => !(entry.pluginID === PROTOTYPE_PLUGIN && [PROTOTYPE_LINK, PROTOTYPE_INTERACTIONS].includes(entry.key))), { pluginID: PROTOTYPE_PLUGIN, key: PROTOTYPE_INTERACTIONS, value: JSON.stringify(mapped) }];
    }
    for (const { node, settings } of overlays) {
      const native = records.get(node.id); if (!native) throw new Error('An overlay frame could not be exported.');
      native.overlayPositionType = settings.position.replaceAll('-', '_').toUpperCase() as NodeChange['overlayPositionType'];
      native.overlayBackgroundInteraction = settings.closeOutside ? 'CLOSE_ON_CLICK_OUTSIDE' : 'NONE';
      native.overlayBackgroundAppearance = settings.background ? { backgroundType: 'SOLID_COLOR', backgroundColor: settings.background } : { backgroundType: 'NONE' };
    }
    for (const { node, settings } of scrolling) {
      const native = records.get(node.id); if (!native) throw new Error('A scrolling frame could not be exported.');
      native.scrollDirection = settings.axis.toUpperCase() as NodeChange['scrollDirection'];
      if (settings.initial) native.scrollOffset = settings.initial; else Reflect.deleteProperty(native, 'scrollOffset');
    }
    for (const { node, behaviour } of positioning) {
      const native = records.get(node.id); if (!native) throw new Error('A positioned layer could not be exported.');
      native.scrollBehavior = behaviour === 'fixed' ? 'FIXED_WHEN_CHILD_OF_SCROLLING_FRAME' : behaviour === 'sticky' ? 'STICKY_SCROLLS' : 'SCROLLS';
    }
    for (const id of fixedParents) {
      const parent = records.get(id)!;
      const children = graph.getChildren(id), kinds = children.map(node => readScrollBehaviour(node, graph));
      if (kinds.some(kind => kind.issue)) continue;
      const ordered = [...children.filter((_, index) => kinds[index]!.behaviour !== 'fixed'), ...children.filter((_, index) => kinds[index]!.behaviour === 'fixed')];
      const positions = children.map(child => records.get(child.id)?.parentIndex?.position);
      if (positions.some(position => !position)) throw new Error('Fixed-layer export ordering could not be mapped.');
      positions.sort();
      ordered.forEach((child, index) => { records.get(child.id)!.parentIndex!.position = positions[index]!; });
      const fixed = children.filter((_, index) => kinds[index]!.behaviour === 'fixed');
      if (fixed.length) parent.fixedChildrenDivider = records.get(fixed[0]!.id)!.parentIndex!.position;
      else Reflect.deleteProperty(parent, 'fixedChildrenDivider');
    }
    for (const { node, target } of starts) {
      const native = records.get(node.id); if (!native) throw new Error('The prototype starting screen could not be exported.');
      native.prototypeStartNodeID = destination(target);
      native.pluginData = [...(native.pluginData ?? []).filter(entry => !(entry.pluginID === PROTOTYPE_PLUGIN && entry.key === PROTOTYPE_START)), { pluginID: PROTOTYPE_PLUGIN, key: PROTOTYPE_START, value: JSON.stringify({ target: prototypeGuid(destination(target)), targetFormat: 'fig' }) }];
    }
    for (const node of parsed.nodeChanges) node.pluginData = node.pluginData?.filter(entry => entry.pluginID !== MARKER);
    return encodeFigArchive(parsed);
  };
}
