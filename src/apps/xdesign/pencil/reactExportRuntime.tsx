// Exported components include this runtime and inline prototypeValues.
// React is the only external dependency; keep editor services out of both.
import { createContext, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { assignPrototypeVariable, emptyPrototypeSession, evaluatePrototypeOperand, prototypeVariableValue, setPrototypeSessionMode, type PrototypeOperand, type PrototypeSession, type PrototypeVariables } from './prototypeValues';
export type { PrototypeOperand, PrototypeSession, PrototypeVariables } from './prototypeValues';

export type DesignValue = string | number | boolean | number[];
export type DesignControlState = 'rest' | 'hover' | 'pressed' | 'focus' | 'disabled';
export type DesignControlSnapshot = { value: DesignValue; state: DesignControlState };
export type DesignControlSession = Record<string, DesignControlSnapshot>;
export type DesignPoint = { x: number; y: number };
export type DesignOverlay = { position: 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'manual'; background?: { r: number; g: number; b: number; a: number }; closeOutside: boolean };
export type DesignScroll = { axis: 'none' | 'horizontal' | 'vertical' | 'both'; initial?: DesignPoint };
export type DesignSpring = { type: 'spring'; mass: number; stiffness: number; damping: number; initialVelocity?: number };
export type DesignEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | [number, number, number, number] | DesignSpring;
export type DesignMediaAction = 'play' | 'pause' | 'toggle';
export type DesignNavigation = { action: 'navigate' | 'back' | 'overlay' | 'close' | 'swap' | 'scroll' | 'sequence' | 'set-variable' | 'set-mode' | 'conditional' | 'open-url' | 'media'; mediaAction?: DesignMediaAction; url?: string; newTab?: boolean; variable?: string; value?: PrototypeOperand; collection?: string; mode?: string; branches?: { condition?: PrototypeOperand; actions: DesignNavigation[] }[]; actions?: DesignNavigation[]; target?: string; unresolved?: boolean; offset?: DesignPoint; preserveScroll?: boolean; resetScroll?: boolean; resetInteractiveComponents?: boolean; resetVideoPosition?: boolean; matchLayers?: boolean; transition: 'instant' | 'dissolve' | 'smart' | 'slide' | 'slide-out' | 'move-in' | 'move-out' | 'push' | 'scroll'; duration: number; direction?: 'left' | 'right' | 'top' | 'bottom'; easing?: DesignEasing };
export type DesignUrlOpener = (url: string, newTab: boolean) => void | boolean | Promise<void | boolean>;
export function validateDesignUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 32768 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f\\]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Choose an absolute HTTP, HTTPS, mailto or tel URL without surrounding whitespace or control characters.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Choose a valid absolute HTTP, HTTPS, mailto or tel URL.'); }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) || (['http:', 'https:'].includes(parsed.protocol) && (!/^https?:\/\//i.test(value) || !parsed.hostname)) || (['mailto:', 'tel:'].includes(parsed.protocol) && !parsed.pathname)) throw new Error('Choose a valid absolute HTTP, HTTPS, mailto or tel URL.');
  return value;
}
export function openDesignUrl(link: DesignNavigation, opener?: DesignUrlOpener): Promise<boolean> {
  try {
    const url = validateDesignUrl(link.url);
    if (link.newTab !== undefined && typeof link.newTab !== 'boolean') throw new Error('Choose whether the link opens in a new tab.');
    const newTab = link.newTab ?? true;
    let result: ReturnType<DesignUrlOpener> = undefined;
    if (opener) result = opener(url, newTab);
    else if (newTab) {
      const opened = window.open('', '_blank');
      if (!opened) throw new Error('The browser blocked this link. Allow pop-ups or connect an Open link handler.');
      try { opened.opener = null; opened.location.replace(url); } catch (error) { opened.close(); throw error; }
    } else window.location.assign(url);
    return Promise.resolve(result).then(accepted => { if (accepted === false) throw new Error('The Open link handler refused this link.'); return true; });
  } catch (error) { return Promise.reject(error); }
}
export function isDesignSpring(value: unknown): value is DesignSpring {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const spring = value as Record<string, unknown>;
  return spring.type === 'spring' && [['mass', 0.01, 100], ['stiffness', 0.01, 10000], ['damping', 0.01, 1000], ['initialVelocity', -100, 100]].every(([key, min, max]) => {
    const value = spring[String(key)] === undefined ? (key === 'initialVelocity' ? 0 : NaN) : spring[String(key)];
    return typeof value === 'number' && Number.isFinite(value) && value >= Number(min) && value <= Number(max);
  });
}
function designSpringState(spring: DesignSpring, seconds: number, envelope = false): { position: number; velocity: number } {
  const frequency = Math.sqrt(spring.stiffness / spring.mass), decay = spring.damping / (2 * spring.mass), velocity = spring.initialVelocity ?? 0;
  if (Math.abs(decay - frequency) < frequency * 1e-6) {
    const b = velocity - frequency, e = Math.exp(-frequency * seconds);
    return envelope ? { position: (1 + Math.abs(b) * seconds) * e, velocity: (Math.abs(b + frequency) + Math.abs(frequency * b) * seconds) * e } : { position: 1 + (-1 + b * seconds) * e, velocity: (b + frequency - frequency * b * seconds) * e };
  }
  if (decay < frequency) {
    const damped = Math.sqrt(frequency * frequency - decay * decay), b = (velocity - decay) / damped, e = Math.exp(-decay * seconds);
    if (envelope) return { position: Math.hypot(1, b) * e, velocity: Math.hypot(decay + damped * b, damped - decay * b) * e };
    const sin = Math.sin(damped * seconds), cos = Math.cos(damped * seconds);
    return { position: 1 + (-cos + b * sin) * e, velocity: ((decay + damped * b) * cos + (damped - decay * b) * sin) * e };
  }
  const split = Math.sqrt(decay * decay - frequency * frequency), slow = -frequency * frequency / (decay + split), fast = -decay - split, a = (velocity + fast) / (slow - fast), b = -1 - a, left = a * Math.exp(slow * seconds), right = b * Math.exp(fast * seconds);
  return envelope ? { position: Math.abs(left) + Math.abs(right), velocity: Math.abs(left * slow) + Math.abs(right * fast) } : { position: 1 + left + right, velocity: left * slow + right * fast };
}
export function designSpringAt(spring: DesignSpring, seconds: number): number {
  if (!isDesignSpring(spring) || !Number.isFinite(seconds) || seconds < 0) throw new Error('Choose finite positive spring mass, stiffness and damping.');
  return designSpringState(spring, seconds).position;
}
const designSpringDurations = new Map<string, number>();
export function designSpringDuration(spring: DesignSpring): number {
  if (!isDesignSpring(spring)) throw new Error('Choose finite positive spring mass, stiffness and damping.');
  const key = `${spring.mass}/${spring.stiffness}/${spring.damping}/${spring.initialVelocity ?? 0}`, previous = designSpringDurations.get(key);
  if (previous !== undefined) return previous;
  const settled = (seconds: number) => { const state = designSpringState(spring, seconds, true); return state.position <= 0.001 && state.velocity <= 0.001; };
  if (!settled(10)) throw new Error('Choose a spring that settles within ten seconds.');
  let low = 0, high = 10;
  for (let i = 0; i < 32; i++) { const middle = (low + high) / 2; if (settled(middle)) high = middle; else low = middle; }
  const duration = Math.max(1, Math.ceil(high * 1000));
  if (designSpringDurations.size >= 128) designSpringDurations.delete(designSpringDurations.keys().next().value!);
  designSpringDurations.set(key, duration); return duration;
}
export function designEase(progress: number, easing?: DesignEasing, duration = 0): number {
  if (progress <= 0) return 0; if (progress >= 1) return 1;
  if (isDesignSpring(easing)) return designSpringAt(easing, progress * (duration || designSpringDuration(easing)) / 1000);
  if (easing === 'linear') return progress;
  const curve = Array.isArray(easing) ? easing : easing === 'ease-in' ? [0.42, 0, 1, 1] : easing === 'ease-in-out' ? [0.42, 0, 0.58, 1] : [0, 0, 0.58, 1];
  const at = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) { const mid = (low + high) / 2; if (at(mid, curve[0]!, curve[2]!) < progress) low = mid; else high = mid; }
  return at((low + high) / 2, curve[1]!, curve[3]!);
}

export const MAX_DESIGN_ACTIONS = 64;
export function designActions(link: DesignNavigation): DesignNavigation[] {
  if (link.action !== 'sequence') return [link];
  if (!Array.isArray(link.actions) || !link.actions.length || link.actions.length > MAX_DESIGN_ACTIONS || link.actions.some(action => action.action === 'sequence')) throw new Error('Use between one and 64 actions in a sequence.');
  return link.actions;
}
export function allDesignActions(link: DesignNavigation): DesignNavigation[] {
  const result: DesignNavigation[] = [];
  const visit = (action: DesignNavigation, depth: number) => {
    if (depth > 8 || result.length >= MAX_DESIGN_ACTIONS) throw new Error('Use at most 64 actions and eight conditional levels.');
    result.push(action);
    if (action.action === 'conditional') {
      if (!action.branches?.length || action.branches.length > 16) throw new Error('Use between one and 16 conditional branches.');
      action.branches.forEach((branch, index) => {
        if (!Array.isArray(branch.actions) || branch.actions.some(action => action.action === 'sequence') || !branch.condition && index !== action.branches!.length - 1) throw new Error('Place Else last and use flat branch action lists.');
        branch.actions.forEach(action => visit(action, depth + 1));
      });
    }
  };
  designActions(link).forEach(action => visit(action, 0)); return result;
}
export function mapDesignActions(link: DesignNavigation, map: (action: DesignNavigation) => DesignNavigation): DesignNavigation {
  allDesignActions(link);
  const visit = (action: DesignNavigation): DesignNavigation => map(action.action === 'conditional' ? { ...action, branches: action.branches!.map(branch => ({ ...branch, actions: branch.actions.map(visit) })) } : action);
  return link.action === 'sequence' ? { action: 'sequence', transition: 'instant', duration: 0, actions: designActions(link).map(visit) } : visit(link);
}
export async function executeDesignActions(link: DesignNavigation, definitions: PrototypeVariables, session: () => PrototypeSession, apply: (session: PrototypeSession) => Promise<boolean>, play: (action: DesignNavigation) => Promise<boolean>, active: () => boolean): Promise<boolean> {
  allDesignActions(link);
  const run = async (actions: DesignNavigation[]): Promise<boolean> => {
    for (const action of actions) {
      if (!active()) return false;
      if (action.action === 'set-variable') { if (!action.variable || !action.value) throw new Error('Choose a variable and value.'); if (!await apply(assignPrototypeVariable(definitions, session(), action.variable, action.value))) return false; }
      else if (action.action === 'set-mode') { if (!action.collection || !action.mode) throw new Error('Choose a collection and mode.'); if (!await apply(setPrototypeSessionMode(definitions, session(), action.collection, action.mode))) return false; }
      else if (action.action === 'conditional') {
        for (const branch of action.branches!) {
          const matches = branch.condition ? evaluatePrototypeOperand(branch.condition, definitions, session()) : true;
          if (typeof matches !== 'boolean') throw new Error('A condition must produce a boolean.');
          if (matches) { if (!await run(branch.actions)) return false; break; }
        }
      } else if (!await play(action)) return false;
    }
    return active();
  };
  return run(designActions(link));
}
export type DesignTrigger = { type: 'click' | 'drag' } | { type: 'pointer-enter' | 'pointer-leave' | 'pointer-down' | 'pointer-up' | 'hover' | 'press'; delay?: number } | { type: 'media-hit'; time: number } | { type: 'media-end' } | { type: 'delay'; delay: number } | { type: 'key'; keyCodes: number[] };
export type DesignInteraction = { id: string; trigger: DesignTrigger; navigation: DesignNavigation };
export type DesignProps = {
  onOpenUrl?: DesignUrlOpener;
  mediaState?: DesignMediaState;
  values?: Record<string, DesignValue>;
  controlSession?: DesignControlSession;
  onControlState?: (key: string, snapshot: DesignControlSnapshot) => void;
  prototypeVariables?: PrototypeVariables;
  prototypeSession?: PrototypeSession;
  onPrototypeSessionChange?: (session: PrototypeSession) => void | Promise<boolean>;
  disabled?: boolean;
  onValueChange?: (layerId: string, value: DesignValue) => void;
  onAction?: (layerId: string) => void;
  // Resolve after destination preparation and animation; false stops the remaining sequence.
  onNavigate?: (link: DesignNavigation, layerId: string, trigger?: DesignTrigger, origin?: DesignPoint) => void | Promise<unknown>;
  // Page hosts own the queue across replaced DesignView instances.
  onSequence?: (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint) => void | boolean | Promise<unknown>;
  onSequenceCancel?: (reason?: 'pointer' | 'activate' | 'scroll' | 'cancel' | 'url' | 'media') => void;
  // Temporary navigation leases survive source-view replacement; finished also signals disposal.
  onReversible?: (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint) => DesignReversibleJob | undefined;
  onDrag?: (link: DesignNavigation, layerId: string, origin: DesignPoint) => DesignDragJob | undefined;
  automatic?: boolean;
  scrollPositions?: Record<string, DesignPoint>;
  scrollRevision?: number;
  onScrollPositionChange?: (layerId: string, position: DesignPoint) => void;
  onPrototypeError?: (message: string) => void;
};
type DesignMediaCheckpoint = { kind: 'video'; time: number; paused: boolean; pendingTime?: number; pendingPaused?: boolean } | { kind: 'cursor'; hits: string[]; time: number; duration: number; ended: boolean };
export type DesignMediaSnapshot = Map<string, DesignMediaCheckpoint>;
type DesignMediaMember = { kind: DesignMediaCheckpoint['kind']; target?: { id: string; sourceId?: string }; transport?: (action: DesignMediaAction, current: () => boolean, begin?: () => void) => Promise<boolean>; capture: () => DesignMediaCheckpoint; restore: (checkpoint: DesignMediaCheckpoint) => void; reset: (playback?: DesignMediaCheckpoint) => void; restorePlayback?: (checkpoint: DesignMediaCheckpoint) => void };
export type DesignMediaState = { transport: (target: string, action: DesignMediaAction, begin?: (snapshot: DesignMediaSnapshot) => void) => Promise<boolean>; restoreTransport: (snapshot: DesignMediaSnapshot) => void; capture: () => DesignMediaSnapshot; restore: (snapshot: DesignMediaSnapshot) => void; reset: (playback?: DesignMediaSnapshot) => void; restorePlayback: (snapshot: DesignMediaSnapshot) => void; register: (id: string, member: DesignMediaMember) => () => void };
export type DesignMediaMutation = { owner: DesignMediaState; snapshot: DesignMediaSnapshot };
export function playDesignMedia(link: DesignNavigation, owner: DesignMediaState | undefined, begin?: (mutation: DesignMediaMutation) => void): Promise<boolean> {
  if (link.action !== 'media' || !link.target || link.unresolved || !['play', 'pause', 'toggle'].includes(link.mediaAction ?? '') || link.transition !== 'instant' || link.duration !== 0) return Promise.reject(new Error('Choose a mounted video target and Play, Pause or Toggle.'));
  if (!owner) return Promise.reject(new Error('The target video occurrence is not ready.'));
  return owner.transport(link.target, link.mediaAction!, begin ? snapshot => begin({ owner, snapshot }) : undefined);
}
export function rememberDesignMedia(changes: Map<DesignMediaState, DesignMediaSnapshot>, mutation: DesignMediaMutation) {
  let saved = changes.get(mutation.owner); if (!saved) { saved = new Map(); changes.set(mutation.owner, saved); }
  for (const [id, checkpoint] of mutation.snapshot) if (!saved.has(id)) saved.set(id, checkpoint);
}
/** One owner per presented root or overlay occurrence; snapshots also restore remounted media. */
export function createDesignMediaState(): DesignMediaState {
  const members = new Map<string, DesignMediaMember>(), transports = new Set<DesignMediaMember>(), transportBindings = new WeakMap<DesignMediaCheckpoint,DesignMediaMember>(); let pending: DesignMediaSnapshot = new Map();
  const ordered = () => [...members].sort((a, b) => Number(a[1].kind === 'video') - Number(b[1].kind === 'video'));
  return {
    transport: (target, action, begin) => {
      if (!target || !['play', 'pause', 'toggle'].includes(action)) return Promise.reject(new Error('Choose a mounted video target and Play, Pause or Toggle.'));
      const exact = [...transports].filter(member => member.target?.id === target), matches = exact.length ? exact : [...transports].filter(member => member.target?.sourceId === target);
      if (matches.length !== 1 || !matches[0]!.transport) return Promise.reject(new Error(matches.length > 1 ? 'The target video is ambiguous in this occurrence.' : 'The target video is not mounted in this occurrence.'));
      const member = matches[0]!;
      return member.transport!(action, () => transports.has(member), begin ? () => begin(new Map([...members].filter(([, registered]) => registered.target?.id === member.target!.id).map(([id, registered]) => { const checkpoint=registered.capture(); transportBindings.set(checkpoint,registered); return [id,checkpoint] as const; }))) : undefined);
    },
    restoreTransport: snapshot => { for (const [id,member] of ordered()) { const checkpoint=snapshot.get(id); if(!checkpoint || transportBindings.get(checkpoint)!==member) continue; const now=member.capture(); if(checkpoint.kind==='video' && now.kind==='video' && (checkpoint.pendingTime??checkpoint.time)===(now.pendingTime??now.time)) member.restorePlayback?.(checkpoint); else member.restore(checkpoint); } },
    capture: () => new Map([...pending, ...[...members].map(([id, member]) => [id, member.capture()] as const)]),
    restore: snapshot => { pending = structuredClone(snapshot); for (const [id, member] of ordered()) { const checkpoint = pending.get(id); if (checkpoint) { member.restore(checkpoint); pending.delete(id); } } },
    reset: playback => { pending.clear(); for (const [id, member] of ordered()) member.reset(playback?.get(id)); },
    restorePlayback: snapshot => { for (const [id, member] of members) { const checkpoint = snapshot.get(id); if (checkpoint) member.restorePlayback?.(checkpoint); } },
    register: (id, member) => { members.set(id, member); if (member.transport) transports.add(member); const checkpoint = pending.get(id); if (checkpoint) { member.restore(checkpoint); pending.delete(id); } return () => { transports.delete(member); if (members.get(id) === member) members.delete(id); }; },
  };
}
export type DesignSelectionGeometry = {
  id: string; parentId?: string; x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; flipY: boolean; line: boolean;
  constraint?: { horizontal: DesignConstraint; vertical: DesignConstraint };
  bindings: Partial<Record<'x' | 'y' | 'width' | 'height' | 'rotation', string>>; modes: Record<string, string>;
};
export type DesignNode = {
  selectionRoot?: { width: number; height: number; parent: [number, number, number, number]; world: [number, number, number, number, number, number]; lineReflection?: [number, number]; geometryRoot?: string; geometry?: DesignSelectionGeometry[] };
  motion?: DesignMotion;
  bindings?: { style: Partial<Record<keyof CSSProperties, string>>; visible?: string; modes: Record<string, string> };
  id: string; sourceId?: string; name: string; style: CSSProperties; visible: boolean;
  text?: string; textValue?: string; visibleValue?: string; part?: string; lang?: string;
  runs?: { text: string; style: CSSProperties; lang?: string }[];
  image?: string; imageStyle?: CSSProperties; children: DesignNode[]; control?: DesignControl;
  sceneCovered?: boolean;
  maskPath?: string;
  hitHidden?: boolean;
  clipContent?: boolean;
  navigation?: DesignNavigation;
  interactions?: DesignInteraction[];
  overlay?: DesignOverlay;
  scroll?: DesignScroll;
  scrollBehaviour?: 'scroll' | 'fixed' | 'sticky';
  responsive?: { x: number; y: number; width: number; height: number; parentWidth: number; parentHeight: number; horizontal: DesignConstraint; vertical: DesignConstraint; groupScale: boolean; explicit: Partial<Record<'left' | 'top' | 'width' | 'height', true>> };
  measuredFrame?: { width: number; height: number };
  fixedStyle?: CSSProperties;
  video?: { src: string; poster: string; autoplay: boolean; loop: boolean; muted: boolean; controls: boolean; style: CSSProperties };
};
export type DesignMotion = {
  version: 1; root: boolean; type: string; shape: string; shadow: boolean; artwork?: string;
  composition?: 'scene';
  width: number; height: number; local: [number, number, number, number, number, number];
  radii: [number, number, number, number];
  paints: { type: string; color: [number, number, number, number]; opacity: number; blend: string;
    stops?: { position: number; color: [number, number, number, number] }[];
    transform?: [number, number, number, number, number, number]; image?: string; scaleMode?: string }[];
};
export type DesignControl = {
  native?: { key: string; values: Record<string, DesignValue>; selected: number[]; ratio: number };
  playback?: DesignControlSnapshot;
  kind: string;
  defaults: Record<string, string | boolean | number>;
  booleans: Record<string, { name: string; on?: string; off?: string; variant: boolean }>;
  numbers: Record<string, { min: number; max: number; step: number; default: number }>;
  states?: { name: string; rest?: string; hover?: string; pressed?: string; focus?: string; disabled?: string };
  variants: { properties: Record<string, string>; tree: DesignNode; thumb?: { start: { x: number; y: number }; travel: { x: number; y: number } }; range?: { left: number; top: number; matrix: [number, number, number, number] }; trackWidth?: number; textTarget?: CSSProperties }[];
  properties: Record<string, string>;
};

type Context = {
  kind: string; values: Record<string, DesignValue>;
  inputValues?: Record<string, DesignValue>; visualSelected?: Set<number>;
  getValue?: () => DesignValue;
  choose: (index: number) => void; selected: Set<number>; setValue: (value: DesignValue) => void;
  disabled: boolean; uid: string; props: DesignProps; thumb?: { start: { x: number; y: number }; travel: { x: number; y: number } };
  range?: { left: number; top: number; matrix: [number, number, number, number] }; trackWidth?: number; ratio: number; item?: Item; native?: boolean;
};
type Item = { value: boolean; disabled: boolean; change: (value: DesignValue) => void; tabIndex?: number; group: boolean; presentation?: boolean; state?: DesignControlState };
type DesignConstraint = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
const ResponsiveParentContext = createContext<{ width: number; height: number }>({ width: 0, height: 0 });
function constrainedAxis(position: number, size: number, before: number, after: number, constraint: DesignConstraint) {
  const delta = after - before;
  if (constraint === 'MAX') return { position: position + delta, size };
  if (constraint === 'CENTER') return { position: position + delta / 2, size };
  if (constraint === 'STRETCH') return { position, size: Math.max(1, size + delta) };
  if (constraint === 'SCALE' && before > 0) { const scale = after / before; return { position: position * scale, size: Math.max(1, size * scale) }; }
  return { position, size };
}
const layerKey = (node: DesignNode, index: number) => node.control?.native?.key ?? (node.measuredFrame ? node.id : `${index}/${node.name}`);
const reset: CSSProperties = { boxSizing: 'border-box', margin: 0, padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'inherit' };
const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
function layoutSpacing(value: CSSProperties['padding'], sides: 2 | 4) {
  if (typeof value !== 'string') return Array.from({ length: sides }, () => value);
  const fields: string[] = []; let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++; else if (value[index] === ')') depth--;
    else if (/\s/.test(value[index]!) && !depth) { const field = value.slice(start, index).trim(); if (field) fields.push(field); start = index + 1; }
  }
  const last = value.slice(start).trim(); if (last) fields.push(last);
  return sides === 2 ? [fields[0], fields[1] ?? fields[0]] : [fields[0], fields[1] ?? fields[0], fields[2] ?? fields[0], fields[3] ?? fields[1] ?? fields[0]];
}
function contentLayout(style: CSSProperties): CSSProperties {
  const padding = layoutSpacing(style.padding, 4), gap = layoutSpacing(style.gap, 2);
  return { ...fill, boxSizing: 'border-box', display: style.display, flexDirection: style.flexDirection, flexWrap: style.flexWrap, rowGap: style.rowGap ?? gap[0], columnGap: style.columnGap ?? gap[1], justifyContent: style.justifyContent, alignItems: style.alignItems, alignContent: style.alignContent, paddingTop: style.paddingTop ?? padding[0], paddingRight: style.paddingRight ?? padding[1], paddingBottom: style.paddingBottom ?? padding[2], paddingLeft: style.paddingLeft ?? padding[3], direction: style.direction };
}
function artworkContainerStyle(style: CSSProperties): CSSProperties {
  return { ...style, overflow: 'visible', display: undefined, flexDirection: undefined, flexWrap: undefined, gap: undefined, rowGap: undefined, columnGap: undefined, justifyContent: undefined, alignItems: undefined, alignContent: undefined, padding: undefined, paddingTop: undefined, paddingRight: undefined, paddingBottom: undefined, paddingLeft: undefined };
}

function plainText(node: DesignNode): string {
  return (node.text ?? (node.control ? plainText(node.control.variants[0]!.tree) : node.children.map(plainText).filter(Boolean).join(' '))).trim();
}
function numeric(value: DesignValue, settings: DesignControl['numbers'][string]): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(settings.min, Math.min(settings.max,
    Number((settings.min + Math.round((n - settings.min) / settings.step) * settings.step).toPrecision(15)))) : settings.default;
}
export function resolveDesignControl(config: Omit<DesignControl, 'variants'>, value?: DesignValue, state: DesignControlState = 'rest', label = '', inheritedDisabled = false, firstEnabled = -1) {
  const valueId = config.kind === 'collapsible' ? 'open' : 'value';
  const multiple = config.kind === 'toggleGroup' || config.kind === 'accordion';
  const group = ['radioGroup', 'toggleGroup', 'accordion', 'tabs'].includes(config.kind);
  const initial = group ? (multiple || firstEnabled < 0 ? [] : [firstEnabled]) : config.defaults[valueId] ?? (valueId === 'open' ? false : '');
  const settings = config.numbers.value;
  const number = settings ? numeric(value ?? initial, settings) : 0;
  const normalized = settings ? number : value ?? initial;
  const selected = new Set(Array.isArray(normalized) ? normalized : []);
  const disabled = inheritedDisabled || config.defaults.disabled === true;
  const values: Record<string, DesignValue> = { ...config.defaults, [valueId]: normalized, label, disabled,
    ...(settings ? { min: settings.min, max: settings.max, step: settings.step } : {}) };
  if (config.booleans.filled) values.filled = String(normalized).length > 0;
  if (config.kind === 'numberField') values.text = String(number);
  const desired = { ...config.properties };
  for (const [key, binding] of Object.entries(config.booleans)) if (binding.variant) {
    const choice = values[key] ? binding.on : binding.off;
    if (choice !== undefined) desired[binding.name] = choice;
  }
  if (config.states) desired[config.states.name] = config.states[disabled ? 'disabled' : state] ?? config.states.rest ?? desired[config.states.name]!;
  return { value: normalized, values, desired, selected, disabled, number, ratio: settings ? (number - settings.min) / (settings.max - settings.min) : 0 };
}
function keyMove(event: KeyboardEvent<HTMLElement>, selector: string, activate: boolean) {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const targets = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector)].filter(node => !node.disabled);
  const index = targets.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !targets.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1
    : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length;
  targets[next]?.focus();
  if (activate) targets[next]?.click();
}

function validateDesignBindings(nodes: DesignNode[], definitions: PrototypeVariables, session: PrototypeSession) {
  const ancestors = new Set<string>();
  const visit = (node: DesignNode) => {
    for (const geometry of node.selectionRoot?.geometry ?? []) if (!ancestors.has(geometry.id)) {
      ancestors.add(geometry.id);
      for (const [field, id] of Object.entries(geometry.bindings)) {
        const value = prototypeVariableValue(definitions, session, id!, geometry.modes);
        if (typeof value !== 'number' || !Number.isFinite(value) || ['width', 'height'].includes(field) && value < 0) throw new Error(`This ancestor variable produces invalid ${field}.`);
      }
    }
    if (node.bindings) {
      if (node.bindings.visible && typeof prototypeVariableValue(definitions, session, node.bindings.visible, node.bindings.modes) !== 'boolean') throw new Error('A visibility binding needs a boolean.');
      for (const [property, id] of Object.entries(node.bindings.style)) {
        const value = prototypeVariableValue(definitions, session, id!, node.bindings.modes);
        if (property === 'backgroundColor' ? typeof value !== 'object' : property === 'fontFamily' ? typeof value !== 'string' : typeof value !== 'number') throw new Error(`The ${property} binding has the wrong variable type.`);
        if (typeof value === 'number' && (property === 'opacity' && (value < 0 || value > 1) || ['width', 'height', 'fontSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].includes(property) && value < 0)) throw new Error(`This variable produces invalid ${property}.`);
      }
    }
    node.children.forEach(visit); node.control?.variants.forEach(variant => visit(variant.tree));
  };
  nodes.forEach(visit);
}
function boundDesignNode(node: DesignNode, props: DesignProps): DesignNode {
  if (!node.bindings || !props.prototypeVariables) return node;
  const state = props.prototypeSession ?? emptyPrototypeSession();
  const resolve = (id: string) => { try { return prototypeVariableValue(props.prototypeVariables!, state, id, node.bindings!.modes); } catch { return undefined; } };
  const style = { ...node.style };
  let fixedStyle = node.fixedStyle;
  for (const [property, id] of Object.entries(node.bindings.style)) {
    const value = resolve(id!);
    if (value !== undefined) {
      // Yoga clamps signed spacing to zero; invalid negative CSS would retain the previous gap.
      Object.assign(style, { [property]: typeof value === 'object' ? `rgba(${value.r * 255},${value.g * 255},${value.b * 255},${value.a})` : typeof value === 'number' && ['gap', 'rowGap', 'columnGap'].includes(property) ? Math.max(0, value) : property === 'lineHeight' ? `${value}px` : value });
      if (fixedStyle && ['left', 'top', 'width', 'height'].includes(property)) fixedStyle = { ...fixedStyle, [property]: style[property as keyof CSSProperties] };
    }
  }
  const visible = node.bindings.visible && resolve(node.bindings.visible);
  return { ...node, style, fixedStyle, ...(typeof visible === 'boolean' ? { visible } : {}) };
}
/** Selected roots share one normalized envelope; a resized root can move every other root. */
export function resolveDesignSelection(nodes: DesignNode[], props: DesignProps, width: number, height: number): { nodes: DesignNode[]; width: number; height: number } {
  if (!nodes.length || nodes.some(node => !node.selectionRoot)) {
    const root = nodes.length === 1 && nodes[0]!.style.left === 0 && nodes[0]!.style.top === 0 ? boundDesignNode(nodes[0]!, props).style : undefined;
    return { nodes, width: nodes[0]?.bindings?.style.width && typeof root?.width === 'number' ? root.width : width, height: nodes[0]?.bindings?.style.height && typeof root?.height === 'number' ? root.height : height };
  }
  type Geometry = { x: number; y: number; width: number; height: number; matrix: [number, number, number, number, number, number] };
  const ancestors = new Map<string, Geometry>();
  const forest = new Map((nodes[0]?.selectionRoot?.geometry ?? []).map(geometry => [geometry.id, geometry]));
  const resolveGeometry = (id: string): Geometry => {
    const cached = ancestors.get(id); if (cached) return cached;
    const authored = forest.get(id)!, before = authored.parentId ? forest.get(authored.parentId) : undefined, parent = before ? resolveGeometry(before.id) : undefined;
    const rect = { x: authored.x, y: authored.y, width: authored.width, height: authored.height, rotation: authored.rotation };
    if (props.prototypeVariables) for (const [field, id] of Object.entries(authored.bindings)) {
      const value = prototypeVariableValue(props.prototypeVariables, props.prototypeSession ?? emptyPrototypeSession(), id!, authored.modes);
      if (typeof value === 'number') Object.assign(rect, { [field]: value });
    }
    if (parent && before && authored.constraint && (parent.width !== before.width || parent.height !== before.height)) {
      const horizontal = constrainedAxis(authored.x, authored.width, before.width, parent.width, authored.constraint.horizontal), vertical = constrainedAxis(authored.y, authored.height, before.height, parent.height, authored.constraint.vertical);
      for (const [field, value] of [['x', horizontal.position], ['y', vertical.position], ['width', horizontal.size], ['height', vertical.size]] as const) if (!authored.bindings[field]) rect[field] = Math.round(value);
    }
    const sx = authored.flipX ? -1 : 1, sy = authored.flipY ? -1 : 1, angle = rect.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const a = sx * cos, b = sy * sin, c = -sx * sin, d = sy * cos, cx = rect.width / 2, cy = rect.height / 2;
    const x = rect.x + (authored.line ? (1 - sx) * cx : cx - a * cx - c * cy), y = rect.y + (authored.line ? (1 - sy) * cy : cy - b * cx - d * cy);
    const [pa, pb, pc, pd, px, py] = parent?.matrix ?? [1, 0, 0, 1, 0, 0];
    const resolved: Geometry = { ...rect, matrix: [pa * a + pc * b, pb * a + pd * b, pa * c + pc * d, pb * c + pd * d, pa * x + pc * y + px, pb * x + pd * y + py] };
    ancestors.set(authored.id, resolved); return resolved;
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const roots = nodes.map(source => {
    const node = boundDesignNode(source, props), root = node.selectionRoot!;
    const geometry = props.prototypeVariables && root.geometryRoot ? resolveGeometry(root.geometryRoot) : undefined;
    const w = geometry?.width ?? (typeof node.style.width === 'number' ? node.style.width : root.width), h = geometry?.height ?? (typeof node.style.height === 'number' ? node.style.height : root.height);
    const [a, b, c, d, x, y] = root.world, [pa, pb, pc, pd] = root.parent, dw = (w - root.width) / 2, dh = (h - root.height) / 2;
    // Lines rotate at their origin, while their reflections still pivot at the size-dependent center.
    const tx = x + (root.lineReflection ? pa * (1 - root.lineReflection[0]) * dw + pc * (1 - root.lineReflection[1]) * dh : (pa - a) * dw + (pc - c) * dh);
    const ty = y + (root.lineReflection ? pb * (1 - root.lineReflection[0]) * dw + pd * (1 - root.lineReflection[1]) * dh : (pb - b) * dw + (pd - d) * dh);
    const matrix = geometry?.matrix ?? [a, b, c, d, tx, ty] as const;
    for (const [cx, cy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const px = matrix[0] * cx! + matrix[2] * cy! + matrix[4], py = matrix[1] * cx! + matrix[3] * cy! + matrix[5];
      minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    return { node, w, h, matrix, geometry };
  });
  return { width: maxX - minX, height: maxY - minY, nodes: roots.map(({ node, w, h, matrix: [a, b, c, d, tx, ty], geometry }) => {
    const left = tx - minX, top = ty - minY;
    return { ...node, style: { ...node.style, ...(geometry ? { width: w, height: h } : {}), left, top, transform: `matrix(${a},${b},${c},${d},0,0)`, transformOrigin: '0 0' }, ...(node.motion ? { motion: { ...node.motion, width: w, height: h, local: [a, b, c, d, left, top] as DesignMotion['local'] } } : {}) };
  }) };
}

function resolvedDesignNode(node: DesignNode, props: DesignProps, parentSize: { width: number; height: number }): DesignNode {
  node = boundDesignNode(node, props);
  if (node.responsive) {
    const responsive = node.responsive, horizontal = constrainedAxis(responsive.x, responsive.width, responsive.parentWidth, parentSize.width, responsive.groupScale ? 'SCALE' : responsive.horizontal), vertical = constrainedAxis(responsive.y, responsive.height, responsive.parentHeight, parentSize.height, responsive.groupScale ? 'SCALE' : responsive.vertical);
    const style = { ...node.style };
    let fixedStyle = node.fixedStyle;
    for (const [property, value] of [['left', horizontal.position], ['top', vertical.position], ['width', horizontal.size], ['height', vertical.size]] as const) {
      if (responsive.explicit[property]) continue;
      style[property] = Math.round(value);
      if (fixedStyle) fixedStyle = { ...fixedStyle, [property]: style[property] };
    }
    node = { ...node, style, fixedStyle };
  }
  return node;
}
function localDesignNode(node: DesignNode, style: CSSProperties): DesignNode {
  // The outer tab/panel owns placement; its content must not reapply authored bindings or constraints.
  return { ...node, bindings: undefined, responsive: undefined, fixedStyle: undefined, style: { ...node.style, width: style.width, height: style.height, position: 'relative', left: 0, top: 0, transform: undefined, transformOrigin: undefined } };
}
function Layer({ node, context, props, root = false, item, fixed = false, mediaOverride }: {
  node: DesignNode; context?: Context; props: DesignProps; root?: boolean; item?: Item; fixed?: boolean; mediaOverride?: DesignMediaCallbacks;
}): ReactNode {
  const maskId = `xdesign-mask-${useId()}`;
  node = resolvedDesignNode(node, props, useContext(ResponsiveParentContext));
  const visible = node.visibleValue && context ? !!context.values[node.visibleValue] : node.visible;
  const hiddenContent = node.part === 'content' && context?.kind === 'collapsible' && context.values.open !== true;
  const { click: _click, media: ownMedia, ...navigation } = usePrototype(node, { ...props, disabled: props.disabled || context?.disabled }, !!visible && !node.hitHidden && !hiddenContent && !root && !node.control, !root);
  const media = mediaOverride ?? ownMedia;
  if (!visible) return null;
  const style = { ...reset, ...node.style, ...(fixed ? { ...node.fixedStyle, pointerEvents: 'auto' as const } : {}) };
  const paintedMask = !!node.maskPath && !!node.image;
  if (node.maskPath && !paintedMask) style.clipPath = `url(#${maskId})`;
  if (paintedMask) style.pointerEvents = 'none';
  const clip = node.clipContent ?? style.overflow === 'hidden';
  if (root) { style.position = 'relative'; style.left = 0; style.top = 0; style.transform = undefined; }
  const childSize = { width: typeof style.width === 'number' ? style.width : 0, height: typeof style.height === 'number' ? style.height : 0 };
  if (node.control && !root) return <ResponsiveParentContext.Provider value={childSize}><Control node={fixed ? { ...node, style: { ...node.style, ...node.fixedStyle, pointerEvents: 'auto' } } : node} props={props} item={item} /></ResponsiveParentContext.Provider>;
  const part = node.part;
  const expanded = context?.values.open === true;
  if (part === 'content' && context?.kind === 'collapsible' && !expanded) return null;
  if (part === 'thumb' && context?.kind === 'slider' && context.thumb && !context.native) {
    style.left = context.thumb.start.x + context.ratio * context.thumb.travel.x;
    style.top = context.thumb.start.y + context.ratio * context.thumb.travel.y;
  }
  if ((part === 'range' && context?.kind === 'slider' || part === 'indicator' && context?.kind === 'progress') && context.range && !context.native) {
    style.left = context.range.left; style.top = context.range.top;
    const [a, b, c, d] = context.range.matrix; style.transform = `matrix(${a},${b},${c},${d},0,0)`; style.transformOrigin = '0 0';
    if (context.trackWidth !== undefined) style.width = context.trackWidth * context.ratio;
  }
  if (!context?.native && ((part === 'range' && context?.kind === 'slider' || part === 'indicator' && context?.kind === 'progress') && context?.trackWidth !== undefined)) style.width = context.trackWidth * context.ratio;
  const renderChild: ScrollChild = (child, index, isFixed) => <Layer key={layerKey(child, index)} node={child} context={context} props={props} fixed={isFixed} />;
  const renderFrame = (attributes: FrameAttributes = {}, render: ScrollChild = renderChild, as: 'div' | 'button' = 'div') => {
    if (node.scroll && node.scroll.axis !== 'none') return <ResponsiveParentContext.Provider value={childSize}><ScrollFrame node={node} context={context} props={props} style={style} navigation={navigation} media={media} attributes={as === 'button' ? { role: 'button', onKeyDown: undefined, ...attributes } : attributes} renderChild={render} as={as} /></ResponsiveParentContext.Provider>;
    if (as === 'button') attributes = { role: 'button', onKeyDown: undefined, ...attributes };
    const children = node.children.map((child, index) => render(child, index, false));
    const sourceContent = node.scroll ? <ScrollParentScope.Provider value={null}>{children}</ScrollParentScope.Provider> : children;
    const content = paintedMask ? <div style={{ ...fill, clipPath: `url(#${maskId})`, pointerEvents: 'auto' }}>{sourceContent}</div> : sourceContent;
    return <ResponsiveFrame as={as} identity={JSON.stringify([node.id, node.measuredFrame?.width, node.measuredFrame?.height])} measurement={node.measuredFrame} fallback={childSize} attributes={{ 'data-name': node.name, 'data-xdesign-mask': node.maskPath ? '' : undefined, style: clip ? artworkContainerStyle(style) : style, ...navigation, ...attributes }}>
      {node.maskPath && <svg width={0} height={0} aria-hidden="true" focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}><defs><clipPath id={maskId} clipPathUnits="userSpaceOnUse"><path d={node.maskPath} /></clipPath></defs></svg>}
      {node.image && <img alt="" draggable={false} src={node.image} style={{ ...fill, ...node.imageStyle, pointerEvents: 'none' }} />}
      {node.video && <VideoArtwork key={node.video.src} identity={node.id} sourceId={node.sourceId} transportHidden={node.hitHidden || context?.disabled} owner={props.mediaState} video={node.video} media={media} name={node.name} disabled={props.disabled} insideButton={as === 'button' || ['button', 'checkbox', 'switch', 'toggle', 'radio'].includes(context?.kind ?? '')} />}
      {clip ? <div data-xdesign-content-clip="" style={{ ...contentLayout(style), overflow: 'hidden', borderRadius: 'inherit' }}>{content}</div> : content}
    </ResponsiveFrame>;
  };
  if (node.text !== undefined) {
    const text = node.textValue && context ? String(context.values[node.textValue] ?? '') : node.text;
    const covered: CSSProperties = node.sceneCovered ? { color: 'transparent', WebkitTextFillColor: 'transparent', textDecorationColor: 'transparent', textShadow: 'none' } : {};
    return <span data-name={node.name} style={{ ...style, ...covered }} lang={node.lang} aria-hidden={!!node.textValue && !!context || undefined} {...navigation}>
      {node.image && <img alt="" draggable={false} src={node.image} style={{ ...fill, ...node.imageStyle, pointerEvents: 'none' }} />}
      {node.runs && !node.textValue ? node.runs.map((run, index) => <span key={index} style={{ ...run.style, ...covered }} lang={run.lang}>{run.text}</span>) : text}
    </span>;
  }
  if (part === 'trigger' && context?.kind === 'collapsible') return renderFrame({ type: 'button',
    'aria-expanded': expanded, 'aria-controls': `${context.uid}-content`, disabled: context.disabled,
    'data-xdesign-group-item': context.item?.group ? '' : undefined, tabIndex: context.item?.tabIndex,
    onClick: event => { context.setValue((context.getValue?.() ?? (context.inputValues ?? context.values).open) !== true); _click?.(event); } }, renderChild, 'button');
  if ((part === 'increment' || part === 'decrement') && context?.kind === 'numberField') return renderFrame({ type: 'button',
    'aria-label': part === 'increment' ? 'Increase' : 'Decrease', disabled: context.disabled,
    onClick: event => { context.setValue(Number(context.getValue?.() ?? (context.inputValues ?? context.values).value) + (part === 'increment' ? 1 : -1) * Number(context.values.step)); _click?.(event); } }, renderChild, 'button');
  if (part === 'list' && context?.kind === 'tabs') return renderFrame({ role: 'tablist', 'aria-label': String(context.values.label),
    onKeyDown: event => keyMove(event, '[role="tab"]', true) }, (child, index, isFixed) => <TabLayer key={layerKey(child, index)} node={child} index={index} fixed={isFixed} context={context} props={props} />);
  if (part === 'panels' && context?.kind === 'tabs') return renderFrame({}, (child, index, isFixed) => <TabPanelLayer key={layerKey(child, index)} node={child} index={index} fixed={isFixed} context={context} props={props} />);
  if (part === 'items' && context && ['radioGroup', 'toggleGroup', 'accordion'].includes(context.kind)) {
    const single = context.kind === 'radioGroup';
    const enabled = node.children.findIndex(child => child.visible && child.control?.defaults.disabled !== true);
    const focused = [...context.selected][0] ?? enabled;
    return renderFrame({ onKeyDown: event => keyMove(event, '[data-xdesign-group-item]', single) }, (child, index, isFixed) => <Layer
      key={layerKey(child, index)} node={child} props={props} fixed={isFixed} item={{ value: context.selected.has(index), disabled: context.disabled,
        change: () => context.choose(index), tabIndex: single ? (index === focused ? 0 : -1) : undefined, group: true }} />);
  }
  return renderFrame(part === 'content' && context ? { id: `${context.uid}-content` } : {});
}

type FrameSize = { width: number; height: number };
function ResponsiveFrame({ as = 'div', identity, measurement, fallback, attributes, children }: { as?: 'div' | 'button'; identity: string; measurement?: FrameSize; fallback: FrameSize; attributes: FrameAttributes & { ref?: Ref<HTMLElement>; style: CSSProperties; 'data-name': string; 'data-xdesign-mask'?: string }; children: ReactNode }) {
  const element = useRef<HTMLElement | null>(null), [measured, setMeasured] = useState<{ identity: string; size: FrameSize } | null>(null);
  const enabled = !!measurement;
  useLayoutEffect(() => {
    const target = element.current; if (!enabled || !target) return;
    let active = true;
    const publish = (next: FrameSize) => {
      if (!active || ![next.width, next.height].every(value => Number.isFinite(value) && value >= 0)) return;
      setMeasured(current => current?.identity === identity && current.size.width === next.width && current.size.height === next.height ? current : { identity, size: next });
    };
    const offsets = () => { const width = target.offsetWidth, height = target.offsetHeight; if (width || height || target.getClientRects().length) publish({ width, height }); };
    offsets();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
      const entry = entries.find(entry => entry.target === target); if (!entry) return;
      const box = entry.borderBoxSize, size = Array.isArray(box) ? box[0] : box as unknown as ResizeObserverSize | undefined;
      // Border-box dimensions are local layout sizes; transformed client rectangles distort constraints.
      if (size && Number.isFinite(size.inlineSize) && Number.isFinite(size.blockSize)) publish({ width: size.inlineSize, height: size.blockSize }); else offsets();
    });
    if (observer) { try { observer.observe(target, { box: 'border-box' }); } catch { observer.observe(target); } }
    window.addEventListener('resize', offsets);
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', offsets); };
  }, [enabled, as, identity]);
  const Container = as, size = measurement ? (measured?.identity === identity ? measured.size : measurement) : fallback;
  const { ref: forwardedRef, ...domAttributes } = attributes;
  const attach = (node: HTMLDivElement | HTMLButtonElement | null) => {
    element.current = node;
    const cleanup = typeof forwardedRef === 'function' ? forwardedRef(node) : undefined;
    if (forwardedRef && typeof forwardedRef !== 'function') forwardedRef.current = node;
    if (node) return () => {
      if (element.current === node) element.current = null;
      if (typeof cleanup === 'function') cleanup();
      else if (typeof forwardedRef === 'function') forwardedRef(null);
      else if (forwardedRef) forwardedRef.current = null;
    };
  };
  return <ResponsiveParentContext.Provider value={size}><Container {...domAttributes} ref={attach}>{children}</Container></ResponsiveParentContext.Provider>;
}

type FrameAttributes = HTMLAttributes<HTMLElement> & { type?: 'button'; disabled?: boolean; 'data-xdesign-group-item'?: string };
type ScrollChild = (node: DesignNode, index: number, fixed: boolean) => ReactNode;
function TabLayer({ node, index, fixed, context, props }: { node: DesignNode; index: number; fixed: boolean; context: Context; props: DesignProps }) {
  node = resolvedDesignNode(node, props, useContext(ResponsiveParentContext));
  const disabled = context.disabled || node.control?.defaults.disabled === true;
  const prototype = usePrototype(node, { ...props, disabled }, !node.hitHidden);
  const { click, media: _media, ...navigation } = prototype;
  const [localState, setLocalState] = useState<DesignControlState>('rest');
  const native = node.control?.native;
  const state = native ? props.controlSession?.[native.key]?.state ?? node.control?.playback?.state ?? localState : localState;
  const interactions = controlInteractionHandlers(prototype, next => {
    if (disabled) return;
    if (native) props.onControlState?.(native.key, { value: context.selected.has(index), state: next }); else setLocalState(next);
  });
  if (!node.visible) return null;
  const style = { ...reset, ...node.style, ...(fixed ? { ...node.fixedStyle, pointerEvents: 'auto' as const } : {}), opacity: node.control ? undefined : node.style.opacity };
  const content = localDesignNode(node, style);
  return <button {...navigation} {...interactions} type="button" style={style} role="tab" id={`${context.uid}-tab-${index}`}
    aria-label={plainText(node) || node.name} aria-selected={context.selected.has(index)} aria-controls={`${context.uid}-panel-${index}`} disabled={disabled} tabIndex={context.selected.has(index) ? 0 : -1}
    onClick={event => { context.choose(index); click?.(event); }}>{node.control ? <Control node={content} props={props} item={{ value: context.selected.has(index), disabled: context.disabled, change: () => context.choose(index), group: false, presentation: true, state }} /> : <Layer node={content} root context={undefined} props={props} />}</button>;
}
function TabPanelLayer({ node, index, fixed, context, props }: { node: DesignNode; index: number; fixed: boolean; context: Context; props: DesignProps }) {
  const parentSize = useContext(ResponsiveParentContext);
  const selected = (context.visualSelected ?? context.selected).has(index);
  let style: CSSProperties = { position: 'relative' };
  if (fixed) {
    node = resolvedDesignNode(node, props, parentSize);
    const placement = { ...node.style, ...node.fixedStyle };
    style = { position: 'absolute', left: placement.left, top: placement.top, width: placement.width, height: placement.height, transform: placement.transform, transformOrigin: placement.transformOrigin, pointerEvents: 'auto' };
    node = localDesignNode(node, placement);
  }
  return <div role="tabpanel" id={`${context.uid}-panel-${index}`} aria-labelledby={`${context.uid}-tab-${index}`} hidden={!selected} tabIndex={0} style={style}>
    <Layer node={node} context={context} props={{ ...props, disabled: props.disabled || !selected }} />
  </div>;
}

type StickyRegistration = { element: HTMLElement; transform: string };
type ScrollParent = { stickies: Map<object, StickyRegistration>; fixed: Map<object, HTMLDivElement>; update: () => void };
const ScrollParentScope = createContext<ScrollParent | null>(null);
function FixedScrollChild({ parent, node, index, render, radius, onWheel, props, context }: { parent: ScrollParent; node: DesignNode; index: number; render: ScrollChild; radius: CSSProperties['borderRadius']; onWheel: (event: WheelEvent) => void; props: DesignProps; context?: Context }) {
  const element = useRef<HTMLDivElement>(null), token = useRef({}), wheelHandler = useRef(onWheel); wheelHandler.current = onWheel;
  const bound = boundDesignNode(node, props);
  const visible = (bound.visibleValue && context ? !!context.values[bound.visibleValue] : bound.visible) && !(node.part === 'content' && context?.kind === 'collapsible' && context.values.open !== true);
  useLayoutEffect(() => {
    if (!visible) return;
    const key = token.current, clip = element.current!, wheel = (event: WheelEvent) => wheelHandler.current(event);
    // React delegates wheel passively; forwarding must cancel the browser's second scroll.
    clip.addEventListener('wheel', wheel, { passive: false });
    parent.fixed.set(key, clip); parent.update();
    return () => { parent.fixed.delete(key); clip.removeEventListener('wheel', wheel); };
  }, [parent, visible]);
  if (!visible) return null;
  // A viewport-sized clip keeps offscreen fixed artwork out of scrollable overflow.
  return <div ref={element} data-xdesign-fixed={node.id} style={{ ...fill, overflow: 'hidden', borderRadius: radius, pointerEvents: 'none', transform: 'translate(0px,0px)', transformOrigin: '0 0' }}>
    <ScrollParentScope.Provider value={null}>{render(node, index, true)}</ScrollParentScope.Provider>
  </div>;
}
function ScrollFrame({ node, props, context, style, navigation, media, attributes = {}, renderChild, as = 'div' }: { node: DesignNode; props: DesignProps; context?: Context; style: CSSProperties; navigation: Omit<ReturnType<typeof usePrototype>, 'click' | 'media'>; media?: DesignMediaCallbacks; attributes?: FrameAttributes; renderChild?: ScrollChild; as?: 'div' | 'button' }) {
  const viewport = useRef<HTMLDivElement>(null), latest = useRef(props), last = useRef<DesignPoint | undefined>(undefined); latest.current = props;
  const parent = useRef<ScrollParent>({ stickies: new Map(), fixed: new Map(), update: () => {} }).current;
  parent.update = () => {
    const element = viewport.current; if (!element) return;
    const rtl = getComputedStyle(element).direction === 'rtl';
    const fixedTransform = `translate(${node.scroll?.axis === 'vertical' ? 0 : element.scrollLeft}px,${node.scroll?.axis === 'horizontal' ? 0 : element.scrollTop}px)`;
    for (const child of parent.fixed.values()) child.style.transform = fixedTransform;
    for (const { element: child, transform } of parent.stickies.values()) child.style.transform = `translate(${node.scroll?.axis === 'vertical' ? 0 : rtl ? Math.min(0, element.scrollLeft - (child.offsetLeft + child.offsetWidth - element.clientWidth)) : Math.max(0, element.scrollLeft - child.offsetLeft)}px,${node.scroll?.axis === 'horizontal' ? 0 : Math.max(0, element.scrollTop - child.offsetTop)}px) ${transform}`;
    const point = { x: element.scrollLeft, y: element.scrollTop };
    if (last.current?.x !== point.x || last.current?.y !== point.y) { last.current = point; latest.current.onScrollPositionChange?.(node.id, point); }
  };
  useLayoutEffect(() => {
    const element = viewport.current!;
    const position = props.scrollPositions?.[node.id] ?? node.scroll?.initial ?? { x: 0, y: 0 };
    element.scrollLeft = node.scroll?.axis === 'vertical' ? 0 : position.x; element.scrollTop = node.scroll?.axis === 'horizontal' ? 0 : position.y; parent.update();
  }, [node.id, node.scroll?.axis, props.scrollRevision]);
  const layout: CSSProperties = { ...contentLayout(style), position: 'relative', inset: undefined, borderRadius: 'inherit' };
  const render = renderChild ?? ((child, index, fixed) => <Layer key={layerKey(child, index)} node={child} context={context} props={props} fixed={fixed} />);
  const forwardWheel = (event: WheelEvent) => {
    const element = viewport.current; if (!element || props.disabled || event.defaultPrevented) return;
    const owner = event.target instanceof Element ? event.target.closest('[data-xdesign-scroll]') : null;
    if (owner && owner !== element) return;
    const before = { x: element.scrollLeft, y: element.scrollTop }, unit = event.deltaMode === 2 ? element.clientHeight : event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(element).lineHeight) || 16 : 1;
    if (node.scroll?.axis !== 'vertical') element.scrollLeft += event.deltaX * (event.deltaMode === 2 ? element.clientWidth : unit); if (node.scroll?.axis !== 'horizontal') element.scrollTop += event.deltaY * unit;
    if (before.x !== element.scrollLeft || before.y !== element.scrollTop) event.preventDefault(); parent.update();
  };
  const fallback = { width: typeof style.width === 'number' ? style.width : 0, height: typeof style.height === 'number' ? style.height : 0 };
  return <ResponsiveFrame as={as} identity={JSON.stringify([node.id, node.measuredFrame?.width, node.measuredFrame?.height])} measurement={node.measuredFrame} fallback={fallback} attributes={{ 'data-name': node.name, id: node.part === 'content' && context ? `${context.uid}-content` : undefined, style: artworkContainerStyle(style), ...navigation, ...attributes }}>
    {node.image && <img alt="" draggable={false} src={node.image} style={{ ...fill, ...node.imageStyle, pointerEvents: 'none' }} />}
    {node.video && <VideoArtwork identity={node.id} sourceId={node.sourceId} transportHidden={node.hitHidden || context?.disabled} owner={props.mediaState} video={node.video} media={media} name={node.name} disabled={props.disabled} insideButton={false} />}
    <div ref={viewport} data-xdesign-scroll={node.id} data-xdesign-scroll-axis={node.scroll?.axis} role="region" aria-label={`${node.name} scroll area`} tabIndex={props.disabled || as === 'button' ? -1 : 0} inert={props.disabled} style={{ ...fill, borderRadius: 'inherit', scrollBehavior: 'auto', overflowX: node.scroll?.axis === 'vertical' ? 'hidden' : 'auto', overflowY: node.scroll?.axis === 'horizontal' ? 'hidden' : 'auto' }} onScroll={parent.update}>
      <div style={layout}><ScrollParentScope.Provider value={parent}>{node.children.map((child, index) => child.scrollBehaviour === 'fixed'
        ? <FixedScrollChild key={layerKey(child, index)} parent={parent} node={child} index={index} render={render} radius={typeof style.borderRadius === 'number' ? style.borderRadius : 'inherit'} onWheel={forwardWheel} props={props} context={context} />
        : render(child, index, false))}</ScrollParentScope.Provider></div>
    </div>
  </ResponsiveFrame>;
}

function VideoArtwork({ video, name, disabled, insideButton, media, identity, sourceId, transportHidden, owner }: { video: NonNullable<DesignNode['video']>; name: string; disabled?: boolean; insideButton: boolean; media?: DesignMediaCallbacks; identity: string; sourceId?: string; transportHidden?: boolean; owner?: DesignMediaState }) {
  const element = useRef<HTMLVideoElement>(null), latestMedia = useRef(media); latestMedia.current = media;
  const pendingSeek = useRef<{ time: number; paused?: boolean } | undefined>(undefined), seekGeneration = useRef(0), seekAttached = useRef(false), seekBinding = useRef({ owner, identity, src: video.src }), pendingPlayback = useRef<boolean | undefined>(undefined), latestDisabled = useRef(disabled), disposalLease = useRef(0); latestDisabled.current = disabled;
  const latestTransportHidden = useRef(transportHidden); latestTransportHidden.current = transportHidden;
  const notify = () => { const value = element.current; if (value && !pendingSeek.current) latestMedia.current?.time(value.currentTime, value.duration); };
  const applyPlayback = (paused?: boolean) => {
    const value = element.current; if (!value || paused === undefined) return;
    if (paused) { pendingPlayback.current = undefined; if (!value.paused) value.pause(); }
    else if (latestDisabled.current) pendingPlayback.current = false;
    else { pendingPlayback.current = undefined; if (value.paused) void value.play()?.catch(() => {}); }
  };
  const applySeek = () => {
    const value = element.current, seek = pendingSeek.current; if (!seekAttached.current || !value || !seek || value.readyState < 1) return;
    try { value.currentTime = seek.time; } catch { return; }
    pendingSeek.current = undefined;
    applyPlayback(seek.paused);
    notify();
  };
  useLayoutEffect(() => {
    seekAttached.current = true;
    if (seekBinding.current.owner !== owner || seekBinding.current.identity !== identity || seekBinding.current.src !== video.src) { pendingSeek.current = undefined; pendingPlayback.current = undefined; seekBinding.current = { owner, identity, src: video.src }; }
    if (!owner || !element.current) return () => { seekAttached.current = false; seekGeneration.current++; };
    const queue = (time: number, paused?: boolean) => {
      const generation = ++seekGeneration.current; pendingSeek.current = { time, paused };
      // Cursor members register after their video children; restore them before a seek can emit time events.
      queueMicrotask(() => { if (seekGeneration.current === generation) applySeek(); });
    };
    const unregister = owner.register(JSON.stringify(['video', identity, video.src]), {
      target: { id: identity, sourceId },
      transport: (action, current, begin) => {
        const value = element.current, generation = seekGeneration.current;
        const eligible = () => {
          if (!value || element.current !== value || !value.isConnected || !seekAttached.current || !current() || generation !== seekGeneration.current || latestDisabled.current || latestTransportHidden.current || document.hidden || value.getAttribute('src') !== video.src || !usable(value) || value.closest('[aria-hidden="true"]')) return false;
          for (let node: HTMLElement | null = value; node; node = node.parentElement) { const style = getComputedStyle(node); if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false; }
          return true;
        };
        if (!eligible() || pendingSeek.current) return Promise.reject(new Error('The target video is hidden, disabled or no longer current.'));
        try {
          begin?.(); pendingPlayback.current = undefined;
          const pause = action === 'pause' || action === 'toggle' && !value!.paused;
          if (pause) { value!.pause(); return Promise.resolve().then(eligible); }
          // Transport must preserve browser activation and expose play rejection, unlike rollback playback.
          const played = value!.play();
          return Promise.resolve(played).then(() => eligible(), error => { if (!eligible()) return false; throw error; });
        } catch (error) { return Promise.reject(error); }
      },
      kind: 'video', capture: () => ({ kind: 'video', time: element.current!.currentTime, paused: element.current!.paused, ...(pendingSeek.current ? { pendingTime: pendingSeek.current.time, pendingPaused: pendingSeek.current.paused } : {}), ...(pendingPlayback.current !== undefined ? { pendingPaused: pendingPlayback.current } : {}) }),
      restore: checkpoint => { if (checkpoint.kind === 'video') queue(checkpoint.pendingTime ?? checkpoint.time, checkpoint.pendingPaused ?? checkpoint.paused); },
      reset: checkpoint => queue(0, checkpoint?.kind === 'video' ? checkpoint.pendingPaused ?? checkpoint.paused : undefined),
      restorePlayback: checkpoint => {
        if (checkpoint.kind !== 'video' || !element.current) return;
        const paused = checkpoint.pendingPaused ?? checkpoint.paused;
        if (pendingSeek.current) pendingSeek.current.paused = paused;
        else applyPlayback(paused);
      },
    });
    if (pendingSeek.current) { const generation = seekGeneration.current; queueMicrotask(() => { if (seekGeneration.current === generation) applySeek(); }); }
    return () => { unregister(); seekAttached.current = false; seekGeneration.current++; };
  }, [owner, identity, sourceId, video.src]);
  useEffect(() => {
    const video = element.current; if (!video || disabled || !media || !video.requestVideoFrameCallback) return;
    let id = 0, stopped = false;
    const schedule = () => { const generation = seekGeneration.current; id = video.requestVideoFrameCallback((_, metadata) => { if (stopped) return; if (generation === seekGeneration.current && !pendingSeek.current) latestMedia.current?.time(metadata.mediaTime, video.duration); schedule(); }); };
    schedule(); return () => { stopped = true; video.cancelVideoFrameCallback(id); };
  }, [disabled, !!media]);
  useEffect(() => {
    const media = element.current, lease = ++disposalLease.current, wasConnected = !!media?.isConnected;
    return () => {
      const pause = media?.pause.bind(media), load = media?.load.bind(media);
      const release = () => { if (media && disposalLease.current === lease) { pause?.(); media.removeAttribute('src'); load?.(); } };
      if (wasConnected && !media?.isConnected) release(); else queueMicrotask(release);
    };
  }, []);
  useEffect(() => { if (disabled) element.current?.pause(); else applyPlayback(pendingPlayback.current); }, [disabled]);
  return <video ref={element} onLoadedMetadata={applySeek} onTimeUpdate={notify} onPlay={notify} onEnded={event => { const value = event.currentTarget; if (!pendingSeek.current && !(seekGeneration.current > 0 && Number.isFinite(value.duration) && value.currentTime < value.duration && !value.ended)) latestMedia.current?.end(value.currentTime, value.duration); }} aria-label={name} src={video.src} poster={video.poster} autoPlay={video.autoplay && !disabled} loop={video.loop} muted={video.muted} controls={video.controls && !disabled && !insideButton} playsInline preload="metadata" tabIndex={disabled ? -1 : undefined} style={{ ...fill, ...video.style, pointerEvents: disabled ? 'none' : undefined }} />;
}

export function designKeyCodes(event: Pick<globalThis.KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): number[] {
  const keys: Record<string, number> = { Backspace: 8, Enter: 13, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
  let code = keys[event.code] ?? keys[event.key];
  if (!code && /^Key[A-Z]$/.test(event.code)) code = event.code.charCodeAt(3);
  if (!code && /^Digit[0-9]$/.test(event.code)) code = event.code.charCodeAt(5);
  if (!code && /^F([1-9]|1[0-2])$/.test(event.key)) code = 111 + Number(event.key.slice(1));
  if (!code && /^[a-zA-Z0-9]$/.test(event.key)) code = event.key.toUpperCase().charCodeAt(0);
  if (!code && event.key === ' ') code = 32;
  return code ? [...(event.shiftKey ? [16] : []), ...(event.ctrlKey ? [17] : []), ...(event.altKey ? [18] : []), ...(event.metaKey ? [91] : []), code].sort((a, b) => a - b) : [];
}
export type DesignDragSample = { offset: DesignPoint; velocity: DesignPoint };
export type DesignDragJob = (() => void) & { finished: Promise<void>; update: (sample: DesignDragSample) => void; release: (sample: DesignDragSample) => void };
export function observeDesignDrag(source: HTMLElement, initial: PrototypePointer, start: () => DesignDragJob | undefined, error?: (message: string) => void): () => void {
  if (!Number.isFinite(initial.clientX) || !Number.isFinite(initial.clientY)) return () => {};
  const origin = { x: initial.clientX!, y: initial.clientY! }, pointerId = initial.pointerId;
  let started = false, stopped = false, job: DesignDragJob | undefined, clickTimer: ReturnType<typeof setTimeout> | undefined, previous = { point: origin, time: initial.timeStamp ?? performance.now() }, last: DesignDragSample = { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  const matches = (event: PointerEvent) => pointerId === undefined || event.pointerId === undefined || event.pointerId === pointerId;
  const blockClick = (event: MouseEvent) => { if (started && event.detail > 0 && Math.hypot(event.clientX - origin.x - last.offset.x, event.clientY - origin.y - last.offset.y) <= 4) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const cleanupClick = () => { clearTimeout(clickTimer); document.removeEventListener('click', blockClick, true); };
  const cleanup = (deferClick = false) => {
    if (stopped) return; stopped = true;
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', canceled, true); document.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', abort); window.removeEventListener('resize', abort);
    if (deferClick) clickTimer = setTimeout(cleanupClick, 0); else cleanupClick();
  };
  const abort = () => { if (stopped) return; cleanup(); job?.(); };
  const fail = (reason: unknown) => { if (stopped) { cleanupClick(); job?.(); } else abort(); error?.(String(reason)); };
  const sample = (event: PointerEvent) => {
    const point = { x: Number.isFinite(event.clientX) ? event.clientX : previous.point.x, y: Number.isFinite(event.clientY) ? event.clientY : previous.point.y }, time = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(), elapsed = time - previous.time, dx = point.x - previous.point.x, dy = point.y - previous.point.y;
    const velocity = elapsed > 0 && elapsed <= 80 ? dx || dy ? { x: dx * 1000 / elapsed, y: dy * 1000 / elapsed } : last.velocity : { x: 0, y: 0 };
    previous = { point, time }; last = { offset: { x: point.x - origin.x, y: point.y - origin.y }, velocity }; return last;
  };
  const move = (event: PointerEvent) => {
    if (stopped || !matches(event)) return;
    const next = sample(event); if (!started && Math.hypot(next.offset.x, next.offset.y) < 4) return;
    try {
      if (!started) { if (!source.isConnected || document.hidden) { abort(); return; } started = true; job = start(); if (!job) { cleanup(); return; } void job.finished.then(() => cleanup(), reason => fail(reason)); }
      event.preventDefault(); job!.update(next);
    } catch (reason) { fail(reason); }
  };
  const up = (event: PointerEvent) => { if (stopped || !matches(event)) return; try { const next = sample(event); cleanup(started); job?.release(next); } catch (reason) { cleanupClick(); job?.(); error?.(String(reason)); } };
  const canceled = (event: PointerEvent) => { if (matches(event)) abort(); };
  const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); abort(); } };
  const hidden = () => { if (document.hidden) abort(); };
  document.addEventListener('pointermove', move, { capture: true, passive: false }); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', canceled, true); document.addEventListener('keydown', key, true); document.addEventListener('click', blockClick, true); document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', abort); window.addEventListener('resize', abort);
  return () => { if (!started) abort(); };
}

export type DesignReversibleJob = (() => void) & { finished: Promise<void> };
export function observeDesignHold(job: DesignReversibleJob, trigger: DesignTrigger, bounds: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, pointerId?: number) {
  const doc = document, win = window;
  let stopped = false;
  const matches = (event: PointerEvent) => pointerId === undefined || event.pointerId === undefined || event.pointerId === pointerId;
  const cleanup = () => { if (stopped) return; stopped = true; doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', up, true); doc.removeEventListener('visibilitychange', hidden); win.removeEventListener('blur', release); win.removeEventListener('resize', release); };
  const release = () => { if (!stopped) { cleanup(); job(); } };
  const move = (event: PointerEvent) => { if (matches(event) && (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom)) release(); };
  const up = (event: PointerEvent) => { if (matches(event)) release(); };
  const hidden = () => { if (doc.hidden) release(); };
  doc.addEventListener('pointermove', move, true);
  if (trigger.type === 'press') { doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', up, true); }
  doc.addEventListener('visibilitychange', hidden); win.addEventListener('blur', release); win.addEventListener('resize', release);
  void job.finished.then(cleanup, cleanup);
  return release;
}
type PrototypeRegistration = { element: HTMLElement; interactions: DesignInteraction[]; activate: (interaction: DesignInteraction) => void };
type PrototypeRegistry = Map<object, PrototypeRegistration> & { scroll?: (link: DesignNavigation) => DesignScrollJob; sequence?: (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint, beginMutation?: (media?: DesignMediaMutation) => void) => Promise<boolean>; mediaDrag?: (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint) => DesignDragJob; cancel?: (reason?: 'pointer' | 'activate') => void; urlActivate?: (reason?: 'url' | 'media') => void; urlVersion?: number; supersede?: () => void; reversible?: (link: DesignNavigation, layerId: string, trigger: DesignTrigger, origin: DesignPoint) => DesignReversibleJob; busy?: boolean };
const PrototypeScope = createContext<PrototypeRegistry | null>(null);
function usable(element: HTMLElement | null) { return !!element && !element.closest('[hidden],[inert],:disabled,[aria-disabled="true"]'); }
type DesignMediaCallbacks = { time: (time: number, duration: number) => void; end: (time: number, duration: number) => void };
export type PrototypePointer = { clientX?: number; clientY?: number; timeStamp?: number; preventDefault?: () => void; pointerType?: string; pointerId?: number; button?: number; target?: EventTarget | null; currentTarget?: EventTarget | null; stopPropagation?: () => void };
function usePrototype(node: DesignNode, props: DesignProps, active = true, positioning = true) {
  const element = useRef<HTMLElement>(null), latest = useRef(props), registry = useContext(PrototypeScope), token = useRef({});
  const mounted = useRef(true), activationEpoch = useRef(0), urlCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activationEpoch.current++; urlCleanup.current?.(); }; }, []);
  const motionAttribute = useRef<{ motion?: DesignMotion; name: string; value: string | null } | undefined>(undefined);
  if (!motionAttribute.current || motionAttribute.current.motion !== node.motion || motionAttribute.current.name !== node.name) motionAttribute.current = { motion: node.motion, name: node.name, value: node.motion ? JSON.stringify({ ...node.motion, name: node.name }) : null };
  const scrollParent = useContext(ScrollParentScope); latest.current = props;
  const interactions = (node.interactions ?? (node.navigation ? [{ id: 'click', trigger: { type: 'click' as const }, navigation: node.navigation }] : [])).filter(interaction => allDesignActions(interaction.navigation).every(action => ['scroll', 'set-variable', 'set-mode', 'conditional', 'open-url', 'media'].includes(action.action)) || props.onNavigate || props.onSequence || props.onReversible || props.onDrag);
  const signature = JSON.stringify(interactions), enabled = active && !props.disabled && !!interactions.length;
  useEffect(() => () => { urlCleanup.current?.(); }, [enabled, signature]);
  const pendingDrag = useRef<(() => void) | undefined>(undefined);
  const firedDelays = useRef(new Set<string>()), timedSignature = useRef(signature), holding = useRef<DesignReversibleJob | undefined>(undefined);
  const origin = () => { const view = element.current!.closest<HTMLElement>('[data-xdesign-view]')!, bounds = element.current!.getBoundingClientRect(), root = view.getBoundingClientRect(), scale = root.width / Number.parseFloat(view.style.width) || 1; return { x: (bounds.left - root.left) / scale, y: (bounds.top - root.top) / scale }; };
  const urlGesture = (result: unknown): DesignDragJob => {
    urlCleanup.current?.();
    const version = registry?.urlVersion; let closed = false, settle!: () => void;
    const finished = new Promise<void>(resolve => { settle = resolve; });
    const close = (cancel: boolean) => { if (closed) return; closed = true; if (urlCleanup.current === job) urlCleanup.current = undefined; if (cancel && version === registry?.urlVersion) registry?.urlActivate?.(); settle(); };
    void Promise.resolve(result).then(() => close(false), () => close(false));
    const job = Object.assign(() => close(true), { finished, update: () => {}, release: () => {} }); urlCleanup.current = job; return job;
  };
  const activate = (interaction: DesignInteraction, event?: PrototypePointer): Promise<boolean> => {
    if (!usable(element.current) || document.hidden || latest.current.disabled) return Promise.resolve(false);
    if (['delay', 'media-hit', 'media-end'].includes(interaction.trigger.type) && (latest.current.automatic === false || registry?.busy)) return Promise.resolve(false);
    const activation = ++activationEpoch.current;
    const current = () => mounted.current && activation === activationEpoch.current && !latest.current.disabled;
    if (interaction.trigger.type === 'delay') firedDelays.current.add(interaction.id);
    try {
      if (interaction.navigation.action === 'open-url') { registry?.urlActivate?.(); const version = registry?.urlVersion; return openDesignUrl(interaction.navigation, latest.current.onOpenUrl).catch(error => { if (current() && version === registry?.urlVersion) { firedDelays.current.delete(interaction.id); latest.current.onPrototypeError?.(String(error)); } return false; }); }
      const actions = allDesignActions(interaction.navigation), hasImmediate = actions.some(action => ['open-url', 'media'].includes(action.action)), urlOnly = actions.every(action => ['open-url', 'conditional'].includes(action.action));
      if (hasImmediate) registry?.urlActivate?.(actions.some(action=>action.action==='open-url') ? 'url' : 'media');
      if (!hasImmediate) registry?.cancel?.(interaction.trigger.type === 'hover' || interaction.trigger.type === 'press' ? 'pointer' : 'activate');
      if (!urlOnly && (interaction.trigger.type === 'hover' || interaction.trigger.type === 'press')) {
        const bounds = element.current!.getBoundingClientRect(), point = origin();
        const job = actions.every(action => ['media', 'conditional'].includes(action.action)) ? registry?.reversible?.(interaction.navigation, node.id, interaction.trigger, point) : latest.current.onReversible ? latest.current.onReversible(interaction.navigation, node.id, interaction.trigger, point) : registry?.reversible?.(interaction.navigation, node.id, interaction.trigger, point);
        if (!job) return Promise.resolve(false); holding.current = job;
        observeDesignHold(job, interaction.trigger, bounds, event?.pointerId);
        const clearHold = () => { if (holding.current === job) holding.current = undefined; };
        void job.finished.then(clearHold, error => { clearHold(); latest.current.onPrototypeError?.(String(error)); });
        return Promise.resolve(true);
      }
      const automatic = ['delay', 'media-hit', 'media-end'].includes(interaction.trigger.type);
      if (!automatic && !hasImmediate) registry?.supersede?.();
      let result: unknown;
      if (interaction.navigation.action === 'media') result = playDesignMedia(interaction.navigation, latest.current.mediaState);
      else if (['sequence', 'conditional', 'set-variable', 'set-mode'].includes(interaction.navigation.action)) result = latest.current.onSequence ? latest.current.onSequence(interaction.navigation, node.id, interaction.trigger, origin()) : registry?.sequence?.(interaction.navigation, node.id, interaction.trigger, origin());
      else if (interaction.navigation.action === 'scroll') {
        const job = registry?.scroll?.(interaction.navigation), notification = latest.current.onNavigate?.(interaction.navigation, node.id, interaction.trigger); result = Promise.all([job?.finished ?? false, notification]).then(([completed, notified]) => completed && notified !== false);
      } else if (interaction.navigation.action === 'overlay' || interaction.navigation.action === 'swap') { registry?.supersede?.(); result = latest.current.onNavigate?.(interaction.navigation, node.id, interaction.trigger, origin()); }
      else { if (['navigate', 'back', 'close'].includes(interaction.navigation.action)) registry?.supersede?.(); result = interaction.trigger.type === 'click' ? latest.current.onNavigate?.(interaction.navigation, node.id) : latest.current.onNavigate?.(interaction.navigation, node.id, interaction.trigger); }
      if (urlOnly && (interaction.trigger.type === 'hover' || interaction.trigger.type === 'press')) {
        const job = urlGesture(result); holding.current = job;
        observeDesignHold(job, interaction.trigger, element.current!.getBoundingClientRect(), event?.pointerId);
        void job.finished.then(() => { if (holding.current === job) holding.current = undefined; });
      }
      const version = registry?.urlVersion;
      return Promise.resolve(result).then(value => { if (current() && value === false) firedDelays.current.delete(interaction.id); return value !== false; }).catch(error => { if (current() && (!hasImmediate || version === registry?.urlVersion)) latest.current.onPrototypeError?.(String(error)); return false; });
    } catch (error) { if (current()) latest.current.onPrototypeError?.(String(error)); return Promise.resolve(false); }
  };
  const latestActivate = useRef(activate); latestActivate.current = activate;
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), down = useRef<number | undefined>(undefined);
  const hits = useRef(new Set<string>()), mediaTime = useRef(0), mediaBusy = useRef(false), mediaEpoch = useRef(0), mediaEnd = useRef(false), mediaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pumpMedia = () => {
    if (!usable(element.current) || latest.current.disabled || document.hidden || latest.current.automatic === false) return;
    if (registry?.busy) { const epoch = mediaEpoch.current; clearTimeout(mediaTimer.current); mediaTimer.current = setTimeout(() => { if (epoch === mediaEpoch.current) pump.current(); }, 16); return; }
    if (mediaBusy.current) return;
    const duration = mediaDuration.current, due = mediaInteractions.current.filter(interaction => interaction.trigger.type === 'media-hit' && !hits.current.has(interaction.id) && Math.min(interaction.trigger.time, duration) <= mediaTime.current).sort((a, b) => (a.trigger as { time: number }).time - (b.trigger as { time: number }).time)[0] ?? (mediaEnd.current ? mediaInteractions.current.find(interaction => interaction.trigger.type === 'media-end' && !hits.current.has(interaction.id)) : undefined);
    if (!due) return;
    hits.current.add(due.id); mediaBusy.current = true; const epoch = mediaEpoch.current;
    void latestActivate.current(due).finally(() => { if (epoch !== mediaEpoch.current) return; mediaBusy.current = false; if (element.current) { clearTimeout(mediaTimer.current); mediaTimer.current = setTimeout(() => pump.current(), 16); } });
  };
  const mediaDuration = useRef(Infinity), mediaInteractions = useRef(interactions), pump = useRef(pumpMedia); mediaInteractions.current = interactions; pump.current = pumpMedia;
  useLayoutEffect(() => {
    const invalidate = () => { mediaEpoch.current++; clearTimeout(mediaTimer.current); mediaBusy.current = false; };
    const unregister = interactions.some(interaction => ['media-hit', 'media-end'].includes(interaction.trigger.type)) ? props.mediaState?.register(JSON.stringify(['cursor', node.id, node.video?.src ?? '', signature]), {
      target: { id: node.id, sourceId: node.sourceId },
      kind: 'cursor', capture: () => ({ kind: 'cursor', hits: [...hits.current], time: mediaTime.current, duration: mediaDuration.current, ended: mediaEnd.current }),
      restore: checkpoint => { if (checkpoint.kind !== 'cursor') return; invalidate(); hits.current = new Set(checkpoint.hits); mediaTime.current = checkpoint.time; mediaDuration.current = checkpoint.duration; mediaEnd.current = checkpoint.ended; },
      reset: () => { invalidate(); hits.current.clear(); mediaTime.current = 0; mediaDuration.current = Infinity; mediaEnd.current = false; },
    }) : undefined;
    return () => { invalidate(); unregister?.(); };
  }, [props.mediaState, node.id, node.sourceId, node.video?.src, signature]);
  useEffect(() => {
    if (timedSignature.current !== signature) { timedSignature.current = signature; firedDelays.current.clear(); hits.current.clear(); mediaTime.current = 0; mediaEnd.current = false; }
    if (!enabled || !element.current) return;
    const id = token.current;
    registry?.set(id, { element: element.current, interactions, activate: interaction => { void latestActivate.current(interaction); } });
    let timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => { timers.forEach(clearTimeout); timers = []; };
    const start = () => {
      stop(); clearTimeout(pointerTimer.current); if (document.hidden || props.automatic === false) return;
      timers = interactions.filter(interaction => interaction.trigger.type === 'delay' && !firedDelays.current.has(interaction.id)).map(interaction => setTimeout(() => { void latestActivate.current(interaction); }, Math.max(16, (interaction.trigger as { delay: number }).delay)));
      if (mediaEnd.current) mediaTimer.current = setTimeout(() => pump.current(), 16);
    };
    const released = (event: PointerEvent) => { if (down.current !== undefined && (event.pointerId === undefined || down.current === event.pointerId)) { down.current = undefined; clearTimeout(pointerTimer.current); } };
    const interrupted = () => { clearTimeout(pointerTimer.current); down.current = undefined; };
    start(); window.addEventListener('blur', interrupted); window.addEventListener('resize', interrupted); document.addEventListener('visibilitychange', start); document.addEventListener('pointerup', released, true); document.addEventListener('pointercancel', released, true);
    return () => { stop(); mediaEpoch.current++; mediaBusy.current = false; clearTimeout(pointerTimer.current); clearTimeout(mediaTimer.current); window.removeEventListener('blur', interrupted); window.removeEventListener('resize', interrupted); registry?.delete(id); document.removeEventListener('visibilitychange', start); document.removeEventListener('pointerup', released, true); document.removeEventListener('pointercancel', released, true); };
    // Callback/value changes must not restart an authored delay or media reaction.
  }, [signature, enabled, props.automatic, registry]);
  const pointer = (type: 'pointer-enter' | 'pointer-leave' | 'pointer-down' | 'pointer-up', event: PrototypePointer) => {
    clearTimeout(pointerTimer.current);
    if (type === 'pointer-leave') holding.current?.();
    if (!enabled || ['pointer-enter', 'pointer-leave'].includes(type) && (event.pointerType === 'touch' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) || event.button !== undefined && event.button !== 0) return;
    const interactive = event.target instanceof Element ? event.target.closest('input,textarea,select,video,button,[contenteditable="true"]') : undefined;
    if (['pointer-down', 'pointer-up'].includes(type) && interactive && interactive !== element.current) return;
    if (type === 'pointer-down') down.current = event.pointerId ?? 0;
    const interaction = interactions.find(interaction => interaction.trigger.type === type || type === 'pointer-enter' && interaction.trigger.type === 'hover' || type === 'pointer-down' && interaction.trigger.type === 'press');
    if (!interaction) return; event.stopPropagation?.();
    const delay = 'delay' in interaction.trigger ? interaction.trigger.delay ?? 0 : 0;
    if (delay) { const saved = { pointerId: event.pointerId }; pointerTimer.current = setTimeout(() => { void latestActivate.current(interaction, saved); }, delay); } else void activate(interaction, event);
  };
  const drag = interactions.find(interaction => interaction.trigger.type === 'drag');
  const startDrag = (event: PrototypePointer) => {
    if (!enabled || !drag || !usable(element.current) || event.button !== undefined && event.button !== 0) return;
    const interactive = event.target instanceof Element ? event.target.closest('input,textarea,select,video,button,[contenteditable="true"]') : undefined;
    if (interactive && interactive !== element.current) return;
    event.stopPropagation?.(); event.preventDefault?.(); pendingDrag.current?.();
    const point = origin();
    pendingDrag.current = observeDesignDrag(element.current!, event, () => {
      pendingDrag.current = undefined;
      const actions = allDesignActions(drag.navigation), hasUrl = actions.some(action => ['open-url', 'media'].includes(action.action));
      if (drag.navigation.action === 'open-url') { registry?.urlActivate?.(); const version = registry?.urlVersion; return urlGesture(openDesignUrl(drag.navigation, latest.current.onOpenUrl).catch(error => { if (mounted.current && version === registry?.urlVersion) latest.current.onPrototypeError?.(String(error)); return false; })); }
      if (hasUrl) registry?.urlActivate?.(actions.some(action=>action.action==='open-url') ? 'url' : 'media');
      if (actions.every(action => ['open-url', 'conditional'].includes(action.action))) { const version = registry?.urlVersion; return urlGesture(Promise.resolve(latest.current.onSequence ? latest.current.onSequence(drag.navigation, node.id, drag.trigger, point) : registry?.sequence?.(drag.navigation, node.id, drag.trigger, point)).catch(error => { if (mounted.current && version === registry?.urlVersion) latest.current.onPrototypeError?.(String(error)); return false; })); }
      if (actions.every(action => ['media', 'conditional'].includes(action.action))) return registry?.mediaDrag?.(drag.navigation, node.id, drag.trigger, point);
      if (!hasUrl) { registry?.cancel?.(); registry?.supersede?.(); }
      if (!latest.current.onDrag) throw new Error('Connect a drag presentation host to scrub this interaction.');
      return latest.current.onDrag(drag.navigation, node.id, point);
    }, message => latest.current.onPrototypeError?.(message));
  };
  useEffect(() => () => { pendingDrag.current?.(); pendingDrag.current = undefined; }, [signature, enabled]);
  useEffect(() => {
    const node = element.current; if (!enabled || !drag || !node) return;
    const original = node.style.touchAction; node.style.touchAction = 'none';
    return () => { if (node.style.touchAction === 'none') node.style.touchAction = original; };
  }, [signature, enabled]);
  const click = interactions.find(interaction => interaction.trigger.type === 'click');
  const onClick = (event: { preventDefault: () => void; stopPropagation: () => void; target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (!enabled || !click || !usable(element.current)) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,video,button,[contenteditable="true"]') && event.target !== event.currentTarget) return;
    event.preventDefault(); event.stopPropagation(); void activate(click);
  };
  const media: DesignMediaCallbacks | undefined = enabled && interactions.some(interaction => ['media-hit', 'media-end'].includes(interaction.trigger.type)) ? {
    time: (time, duration) => { if (!Number.isFinite(time) || time < 0) return; if (time < mediaTime.current) { for (const interaction of interactions) if (interaction.trigger.type === 'media-end' || interaction.trigger.type === 'media-hit' && Math.min(interaction.trigger.time, duration) >= time) hits.current.delete(interaction.id); mediaEnd.current = false; } mediaTime.current = time; mediaDuration.current = Number.isFinite(duration) && duration >= 0 ? duration : Infinity; pump.current(); },
    end: (time, duration) => { mediaTime.current = Math.max(0, Number.isFinite(time) ? time : 0); mediaDuration.current = Number.isFinite(duration) && duration >= 0 ? duration : mediaTime.current; mediaEnd.current = true; pump.current(); },
  } : undefined;
  return { ref: (value: HTMLElement | null) => {
    scrollParent?.stickies.delete(token.current); element.current = value;
    if (value) { value.setAttribute('data-xdesign-layer', node.id); if (node.sourceId) value.setAttribute('data-xdesign-source', node.sourceId); if (node.sceneCovered) value.setAttribute('data-xdesign-scene-covered', ''); else value.removeAttribute('data-xdesign-scene-covered'); if (positioning && node.scrollBehaviour === 'sticky' && scrollParent) { value.setAttribute('data-xdesign-sticky-transform', node.style.transform ?? ''); scrollParent.stickies.set(token.current, { element: value, transform: node.style.transform ?? '' }); scrollParent.update(); } }
    if (value && value.getAttribute('data-xdesign-motion') !== motionAttribute.current!.value) { if (motionAttribute.current!.value) value.setAttribute('data-xdesign-motion', motionAttribute.current!.value); else value.removeAttribute('data-xdesign-motion'); }
  },
    ...(enabled && click ? { role: 'link' as const, tabIndex: 0, 'aria-label': node.name, onClick,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.target === event.currentTarget && event.key === 'Enter') onClick(event); } } : {}),
    onPointerEnter: (event: PrototypePointer) => pointer('pointer-enter', event), onPointerLeave: (event: PrototypePointer) => pointer('pointer-leave', event),
    onPointerDown: (event: PrototypePointer) => { if (drag) startDrag(event); else pointer('pointer-down', event); }, onPointerUp: (event: PrototypePointer) => pointer('pointer-up', event),
    onPointerCancel: () => { clearTimeout(pointerTimer.current); holding.current?.(); down.current = undefined; }, media,
    click: enabled && click ? (event: { stopPropagation: () => void }) => { event.stopPropagation(); void activate(click); } : undefined,
  };
}

function findPart(node: DesignNode, part: string): DesignNode | undefined {
  if (node.part === part) return node;
  for (const child of node.children) { if (child.control) continue; const found = findPart(child, part); if (found) return found; }
  return undefined;
}

function controlInteractionHandlers(prototype: ReturnType<typeof usePrototype>, update: (state: DesignControlState) => void) {
  return {
    onPointerEnter: (event: { pointerType?: string }) => { update('hover'); prototype.onPointerEnter(event); }, onPointerLeave: (event: { currentTarget: HTMLElement; pointerType?: string }) => { update(event.currentTarget.contains(document.activeElement) ? 'focus' : 'rest'); prototype.onPointerLeave(event); },
    onPointerDown: (event: PrototypePointer) => { update('pressed'); prototype.onPointerDown(event); }, onPointerUp: (event: PrototypePointer) => { update('hover'); prototype.onPointerUp(event); }, onPointerCancel: () => { update('rest'); prototype.onPointerCancel(); },
    onFocus: () => update('focus'), onBlur: (event: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) update('rest'); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === ' ' || event.key === 'Enter') update('pressed'); },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => { if (event.key === ' ' || event.key === 'Enter') update('focus'); },
  };
}

function Control({ node, props, item }: { node: DesignNode; props: DesignProps; item?: Item }) {
  const config = node.control!, uid = useId();
  const valueId = config.kind === 'collapsible' ? 'open' : 'value';
  const multiple = config.kind === 'toggleGroup' || config.kind === 'accordion';
  const group = ['radioGroup', 'toggleGroup', 'accordion', 'tabs'].includes(config.kind);
  const items = findPart(config.variants[0]!.tree, config.kind === 'tabs' ? 'list' : 'items')?.children ?? [];
  const first = items.findIndex(child => child.visible && child.control?.defaults.disabled !== true);
  const initial = config.playback?.value ?? (group ? (multiple || first < 0 ? [] : [first]) : config.defaults[valueId] ?? (valueId === 'open' ? false : ''));
  const [local, setLocal] = useState<DesignValue>(initial), [localState, setLocalState] = useState<DesignControlState>(config.playback?.state ?? 'rest');
  const saved = config.native && props.controlSession?.[config.native.key];
  const state = item?.state ?? (config.native ? saved?.state ?? config.playback?.state ?? localState : localState);
  const disabled = !!(props.disabled || item?.disabled || config.defaults.disabled || config.native && !props.onControlState);
  const prototype = usePrototype(node, { ...props, disabled }, !item?.presentation && !node.hitHidden);
  const value = item ? item.value : config.native ? saved?.value ?? config.playback?.value ?? local : props.values?.[node.id] ?? local;
  const valueNow = useRef(value), stateNow = useRef(state); valueNow.current = value; stateNow.current = state;
  const settings = config.numbers.value;
  const { selected, number, values, desired, ratio } = resolveDesignControl(config, value, state, node.name, disabled, first);
  const setValue = (next: DesignValue) => {
    if (disabled) return;
    const normalized = settings ? numeric(next, settings) : next;
    valueNow.current = normalized;
    if (item) item.change(normalized); else {
      setLocal(normalized);
      if (config.native) props.onControlState?.(config.native.key, { value: normalized, state: stateNow.current });
      props.onValueChange?.(node.id, normalized);
    }
  };
  const variant = config.variants.find(candidate => Object.entries(desired).every(([key, expected]) => candidate.properties[key] === expected)) ?? config.variants[0]!;
  const choose = (index: number) => {
    if (disabled || !items[index]?.visible || items[index]!.control?.defaults.disabled === true) return;
    const next = new Set(Array.isArray(valueNow.current) ? valueNow.current : []);
    if (multiple) { if (next.has(index)) next.delete(index); else next.add(index); } else { next.clear(); next.add(index); }
    setValue([...next]);
  };
  const context: Context = { kind: config.kind, values: config.native?.values ?? values, inputValues: values, disabled, choose, selected,
    visualSelected: config.native ? new Set(config.native.selected) : undefined, getValue: () => valueNow.current, setValue, uid, props,
    thumb: variant.thumb, range: variant.range, trackWidth: variant.trackWidth, ratio: config.native?.ratio ?? ratio, item, native: !!config.native };
  const interactions = controlInteractionHandlers(prototype, next => {
    if (disabled) return;
    stateNow.current = next;
    if (config.native) props.onControlState?.(config.native.key, { value: valueNow.current, state: next }); else setLocalState(next);
  });
  const style: CSSProperties = { ...reset, position: node.style.position ?? 'relative', left: node.style.left, top: node.style.top,
    width: node.style.width, height: node.style.height, flexGrow: node.style.flexGrow, flexShrink: node.style.flexShrink,
    transform: node.style.transform, transformOrigin: node.style.transformOrigin, pointerEvents: node.style.pointerEvents,
    cursor: disabled ? 'default' : ['textField', 'textarea', 'numberField'].includes(config.kind) ? 'text' : 'pointer' };
  if (!disabled && state === 'focus') { style.outline = '2px solid currentColor'; style.outlineOffset = 2; }
  // The wrapper owns placement; the selected variant owns its changing appearance.
  const visual = <Layer node={{ ...variant.tree, style: { ...variant.tree.style, width: node.style.width, height: node.style.height } }} root context={context} props={props} mediaOverride={prototype.media} />;
  const inputProps = {
    'aria-label': node.name, disabled, value: String(settings ? number : value), maxLength: 4096,
    onChange: (event: { target: { value: string } }) => setValue(event.target.value),
    style: { ...reset, ...fill, ...(variant.textTarget ?? config.variants.find(candidate => candidate.textTarget)?.textTarget),
      position: 'absolute' as const, opacity: 1, display: 'block', resize: 'none' as const, color: 'transparent',
      caretColor: variant.textTarget?.color ?? 'currentColor', outline: 'none' },
  };
  if (item?.presentation) return visual;
  if (['button', 'checkbox', 'switch', 'toggle', 'radio'].includes(config.kind)) return <button type="button" style={style} ref={prototype.ref} {...interactions}
    aria-label={plainText(variant.tree) || node.name} disabled={disabled} data-xdesign-group-item={item?.group ? '' : undefined} tabIndex={item?.tabIndex}
    role={['checkbox', 'switch', 'radio'].includes(config.kind) ? config.kind : undefined}
    aria-checked={['checkbox', 'switch', 'radio'].includes(config.kind) ? value === true : undefined}
    aria-pressed={config.kind === 'toggle' ? value === true : undefined}
    onClick={event => { if (config.kind === 'button') props.onAction?.(node.id); else setValue(config.kind === 'radio' || valueNow.current !== true);
      prototype.click?.(event); }}>
    {visual}</button>;
  return <div style={style} ref={prototype.ref} {...interactions} onClick={prototype.onClick} role={config.kind === 'radioGroup' ? 'radiogroup' : group ? 'group' : config.kind === 'progress' ? 'progressbar' : undefined}
    aria-label={node.name} aria-disabled={disabled || undefined}
    aria-valuemin={config.kind === 'progress' ? settings?.min : undefined} aria-valuemax={config.kind === 'progress' ? settings?.max : undefined}
    aria-valuenow={config.kind === 'progress' ? number : undefined}>
    {visual}
    {config.kind === 'textarea' && <textarea {...inputProps} />}
    {['textField', 'numberField'].includes(config.kind) && <input {...inputProps} type={config.kind === 'numberField' ? 'number' : 'text'}
      min={settings?.min} max={settings?.max} step={settings?.step} />}
    {config.kind === 'slider' && <input type="range" aria-label={node.name} disabled={disabled} min={settings?.min} max={settings?.max} step={settings?.step}
      value={number} onChange={event => setValue(Number(event.target.value))} style={{ ...fill, opacity: 0, cursor: disabled ? 'default' : 'pointer' }} />}
  </div>;
}

export function transferDesignScroll(from: DesignNode[], to: DesignNode[], positions: Record<string, DesignPoint>, action: Pick<DesignNavigation, 'resetScroll' | 'preserveScroll'>) {
  if (action.resetScroll) { const clear = (node: DesignNode) => { delete positions[node.id]; node.children.forEach(clear); node.control?.variants.forEach(variant => clear(variant.tree)); }; to.forEach(clear); return; }
  const layouts = new Map<string, number>(), identities = new WeakMap<DesignNode, number>();
  const geometry = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'display', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'padding', 'justifyContent', 'alignItems', 'alignSelf', 'transform', 'transformOrigin', 'direction', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'whiteSpace'] as const;
  const identity = (node: DesignNode): number => {
    const cached = identities.get(node); if (cached !== undefined) return cached;
    const key = JSON.stringify([node.visible, node.scroll?.axis, node.scrollBehaviour, geometry.map(key => node.style[key]), node.text, node.runs, node.children.map(identity), node.control?.variants.map(variant => identity(variant.tree))]);
    const value = layouts.get(key) ?? layouts.size; layouts.set(key, value); identities.set(node, value); return value;
  };
  const containers = (nodes: DesignNode[]) => {
    const found = new Map<string, { node: DesignNode; signature: number } | null>();
    const visit = (node: DesignNode, path: string) => {
      if (node.scroll && node.scroll.axis !== 'none') {
        const signature = identity(node);
        const previous = found.get(path);
        found.set(path, previous === null || previous && previous.signature !== signature ? null : { node, signature });
      }
      node.children.forEach((child, index) => visit(child, `${path}/${index}`));
      node.control?.variants.forEach(variant => visit(variant.tree, path));
    };
    nodes.forEach((node, index) => visit(node, String(index))); return found;
  };
  const old = containers(from);
  for (const [path, target] of containers(to)) {
    if (!target) continue;
    if (action.preserveScroll) { const source = old.get(path), value = source && source.signature === target.signature && positions[source.node.id]; if (value) positions[target.node.id] = { ...value }; }
  }
}
function instantScroll(element: HTMLElement, x: number, y: number) {
  if (typeof element.scrollTo === 'function') element.scrollTo({ left: x, top: y, behavior: 'instant' });
  else { element.scrollLeft = x; element.scrollTop = y; }
}
export type DesignGestureMotion = { scrub: (progress: number) => void; settle: (target: 0 | 1, velocity?: number) => Promise<boolean>; movement: (key?: string) => DesignPoint | undefined };
export type DesignScrollJob = (() => void) & { finished: Promise<boolean> } & Partial<DesignGestureMotion>;
const completedScroll = () => Object.assign(() => {}, { finished: Promise.resolve(true) });
export function designScrollTo(view: HTMLElement, link: DesignNavigation, interactive = false): DesignScrollJob {
  const duration = isDesignSpring(link.easing) ? designSpringDuration(link.easing) : link.duration;
  const target = [...view.querySelectorAll<HTMLElement>('[data-xdesign-layer]')].find(node => (node.getAttribute('data-xdesign-layer') === link.target || node.getAttribute('data-xdesign-source') === link.target) && !node.closest('[hidden]') && (interactive || !node.closest('[inert]')));
  if (link.unresolved || !target) throw new Error('The scroll destination is hidden, removed or outside this screen.');
  const fixed = target.closest('[data-xdesign-fixed]');
  const ancestors: { element: HTMLElement; x: number; y: number }[] = [];
  for (let node = target.parentElement; node; node = node.parentElement) ancestors.push({ element: node, x: node.scrollLeft, y: node.scrollTop });
  const own = ancestors.filter(entry => view.contains(entry.element) && entry.element.hasAttribute('data-xdesign-scroll') && (!fixed || entry.element !== fixed && fixed.contains(entry.element)));
  if (!own.length && fixed) return completedScroll();
  if (!own.length) throw new Error('Enable scrolling on a frame around the destination layer.');
  const bounds = view.getBoundingClientRect(), scale = bounds.width / Number.parseFloat(view.style.width) || 1;
  const desired = new Map<HTMLElement, DesignPoint>(), nativeScroll = typeof target.scrollIntoView === 'function';
  const sticky = [...view.querySelectorAll<HTMLElement>('[data-xdesign-sticky-transform]')].map(element => ({ element, transform: element.style.transform }));
  // Let the browser resolve transformed/nested layout without scrolling Orion's host.
  try {
    sticky.forEach(({ element }) => { element.style.transform = element.getAttribute('data-xdesign-sticky-transform')!; });
    if (nativeScroll) target.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'start' });
    for (const { element, x, y } of own) {
      const current = element.getBoundingClientRect(), destination = target.getBoundingClientRect();
      const rtl = getComputedStyle(element).direction === 'rtl';
      const point = nativeScroll ? { x: element.scrollLeft, y: element.scrollTop } : { x: x + (rtl ? destination.right - current.right : destination.left - current.left) / scale, y: y + (destination.top - current.top) / scale };
      const axis = element.getAttribute('data-xdesign-scroll-axis'), maxX = Math.max(0, element.scrollWidth - element.clientWidth), maxY = Math.max(0, element.scrollHeight - element.clientHeight);
      desired.set(element, { x: axis === 'vertical' ? x : Math.max(rtl ? -maxX : 0, Math.min(rtl ? 0 : maxX, point.x + (link.offset?.x ?? 0))), y: axis === 'horizontal' ? y : Math.max(0, Math.min(maxY, point.y + (link.offset?.y ?? 0))) });
      if (!nativeScroll) { const point = desired.get(element)!; instantScroll(element, point.x, point.y); }
    }
  } finally { for (const { element, x, y } of ancestors) { instantScroll(element, x, y); } sticky.forEach(({ element, transform }) => { element.style.transform = transform; }); }
  const write = (progress: number) => { for (const { element, x, y } of own) { const next = desired.get(element)!; instantScroll(element, x + (next.x - x) * progress, y + (next.y - y) * progress); element.dispatchEvent(new Event('scroll')); } };
  if (!interactive && (link.transition === 'instant' || !duration || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof requestAnimationFrame !== 'function')) { write(1); return completedScroll(); }
  let id = 0, stopped = false, progress = 0, resolveRelease: ((complete: boolean) => void) | undefined, settle!: (complete: boolean) => void;
  const finished = new Promise<boolean>(resolve => { settle = resolve; });
  const cancel = () => { if (stopped) return; stopped = true; cancelAnimationFrame(id); resolveRelease?.(false); resolveRelease = undefined; settle(false); };
  const scrub = (position: number) => { if (!Number.isFinite(position)) throw new Error('Choose a finite scroll drag position.'); if (stopped) return; cancelAnimationFrame(id); progress = Math.max(0, Math.min(1, position)); write(progress); };
  const run = (target: 0 | 1, milliseconds: number, easing?: DesignEasing) => {
    cancelAnimationFrame(id); const start = performance.now(), from = progress;
    const frame = (time: number) => {
      if (stopped || !view.isConnected || document.hidden) { cancel(); return; }
      const elapsed = milliseconds ? Math.min(1, Math.max(0, (time - start) / milliseconds)) : 1; progress = elapsed === 1 ? target : from + (target - from) * designEase(elapsed, easing, milliseconds); write(progress);
      if (elapsed < 1) id = requestAnimationFrame(frame); else { stopped = true; resolveRelease?.(true); resolveRelease = undefined; settle(target === 1); }
    };
    if (!milliseconds || typeof requestAnimationFrame !== 'function') frame(start + milliseconds); else id = requestAnimationFrame(frame);
  };
  const release = (target: 0 | 1, velocity = 0) => {
    if (![0, 1].includes(target) || !Number.isFinite(velocity)) throw new Error('Choose a finite scroll drag endpoint.'); if (stopped) return Promise.resolve(false);
    resolveRelease?.(false); const delta = target - progress, easing = isDesignSpring(link.easing) ? { ...link.easing, initialVelocity: Math.max(-100, Math.min(100, delta ? velocity / delta : 0)) } : link.easing;
    const milliseconds = !delta || link.transition === 'instant' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : isDesignSpring(easing) ? designSpringDuration(easing) : Math.max(1, Math.round(duration * Math.abs(delta)));
    const result = new Promise<boolean>(resolve => { resolveRelease = resolve; }); run(target, milliseconds, easing); return result;
  };
  const movement = () => { const largest = own.map(({ element, x, y }) => { const to = desired.get(element)!; return { x: -(to.x - x) * scale, y: -(to.y - y) * scale }; }).sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y))[0]; return largest; };
  if (!interactive) run(1, duration, link.easing);
  return Object.assign(cancel, { finished, scrub, settle: release, movement });
}

export function DesignView({ nodes, width, height, ...props }: DesignProps & { nodes: DesignNode[]; width: number; height: number }) {
  const registry = useRef<PrototypeRegistry>(new Map()), element = useRef<HTMLDivElement>(null), cancelScroll = useRef<DesignScrollJob | undefined>(undefined), sequenceEpoch = useRef(0), latest = useRef(props), [scrollError, setScrollError] = useState('');
  const localMedia = useRef<DesignMediaState | undefined>(undefined); localMedia.current ??= createDesignMediaState();
  const mediaOwner = props.mediaState ?? localMedia.current;
  const [localSession, setLocalSession] = useState<PrototypeSession>(emptyPrototypeSession), session = useRef(props.prototypeSession ?? localSession), commit = useRef<((value: boolean) => void) | undefined>(undefined);
  session.current = props.prototypeSession ?? localSession;
  latest.current = props;
  useLayoutEffect(() => { commit.current?.(true); commit.current = undefined; }, [props.prototypeSession, localSession]);
  registry.current.scroll = link => { cancelScroll.current?.(); cancelScroll.current = undefined; if (element.current) { cancelScroll.current = designScrollTo(element.current, link); setScrollError(''); return cancelScroll.current; } throw new Error('This presentation was closed.'); };
  const cancel = (user = false, reason: 'pointer' | 'activate' | 'scroll' | 'cancel' = 'cancel') => { commit.current?.(false); commit.current = undefined; sequenceEpoch.current++; registry.current.busy = false; cancelScroll.current?.(); cancelScroll.current = undefined; if (user) latest.current.onSequenceCancel?.(reason); };
  registry.current.cancel = reason => cancel(true, reason ?? 'activate');
  registry.current.urlActivate = (reason = 'url') => { sequenceEpoch.current++; registry.current.urlVersion = (registry.current.urlVersion ?? 0) + 1; registry.current.busy = false; latest.current.onSequenceCancel?.(reason); };
  registry.current.sequence = (link, layerId, trigger, origin, beginMutation) => {
    if (allDesignActions(link).some(action => ['open-url', 'media'].includes(action.action))) sequenceEpoch.current++;
    const epoch = sequenceEpoch.current; registry.current.busy = true; setScrollError('');
    const run = () => executeDesignActions(link, latest.current.prototypeVariables ?? { variables: [], collections: [], modes: {} }, () => session.current, async next => {
      beginMutation?.();
      validateDesignBindings(nodes, latest.current.prototypeVariables ?? { variables: [], collections: [], modes: {} }, next);
      if (latest.current.prototypeSession && !latest.current.onPrototypeSessionChange) throw new Error('Connect a session change handler to update controlled prototype variables.');
      if (latest.current.onPrototypeSessionChange) {
        const result = await latest.current.onPrototypeSessionChange(next); if (result === false) return false;
        session.current = next; return true;
      }
      session.current = next; setLocalSession(next); return new Promise<boolean>(resolve => { commit.current = resolve; });
    }, async action => {
      if (action.action === 'open-url') return openDesignUrl(action, latest.current.onOpenUrl);
      if (action.action === 'media') return playDesignMedia(action, latest.current.mediaState ?? localMedia.current, change => beginMutation?.(change));
      beginMutation?.();
      if (['navigate', 'back', 'overlay', 'close', 'swap'].includes(action.action)) registry.current.supersede?.();
      if (action.action === 'scroll') return registry.current.scroll!(action).finished;
      if (!latest.current.onNavigate) throw new Error('Connect a presentation host to play screen and overlay actions.');
      return await latest.current.onNavigate(action, layerId, trigger, origin) !== false;
    }, () => epoch === sequenceEpoch.current && !latest.current.disabled && !document.hidden);
    return run().catch(error => { if (epoch === sequenceEpoch.current) (latest.current.onPrototypeError ?? setScrollError)(String(error)); return false; }).finally(() => { if (epoch === sequenceEpoch.current) registry.current.busy = false; });
  };
  const localHolds = useRef(new Map<DesignReversibleJob, (restore: boolean) => void>());
  const discardLocalHolds = () => { [...localHolds.current.values()].forEach(close => close(false)); };
  registry.current.supersede = discardLocalHolds;
  registry.current.reversible = (link, layerId, trigger, origin) => {
    if (allDesignActions(link).some(action => ['navigate', 'back', 'overlay', 'close', 'swap'].includes(action.action))) throw new Error('Connect a reversible presentation host to restore screen and overlay navigation.');
    const positions = [...(element.current?.querySelectorAll<HTMLElement>('[data-xdesign-scroll]') ?? [])].map(element => ({ element, x: element.scrollLeft, y: element.scrollTop }));
    const savedSession = structuredClone(session.current), mediaChanges = new Map<DesignMediaState, DesignMediaSnapshot>();
    let closed = false, started = !allDesignActions(link).some(action => ['open-url', 'media'].includes(action.action)), settle!: () => void; const finished = new Promise<void>(resolve => { settle = resolve; });
    const ownEpoch = sequenceEpoch.current + (started ? 0 : 1);
    const close = (restore: boolean) => {
      if (closed) return; closed = true;
      if (!started) { if (sequenceEpoch.current === ownEpoch) { sequenceEpoch.current++; registry.current.busy = false; } if (restore) for (const [owner, saved] of mediaChanges) owner.restoreTransport(saved); }
      else if (restore) {
        cancel(); session.current = savedSession;
        for (const [owner, saved] of mediaChanges) owner.restoreTransport(saved);
        if (latest.current.prototypeSession) {
          try { if (latest.current.onPrototypeSessionChange) void Promise.resolve(latest.current.onPrototypeSessionChange(savedSession)).catch(error => (latest.current.onPrototypeError ?? setScrollError)(String(error))); }
          catch (error) { (latest.current.onPrototypeError ?? setScrollError)(String(error)); }
        }
        else setLocalSession(savedSession);
        for (const { element, x, y } of positions) if (element.isConnected) { instantScroll(element, x, y); element.dispatchEvent(new Event('scroll')); }
      }
      localHolds.current.delete(job); settle();
    };
    const job: DesignReversibleJob = Object.assign(() => close(true), { finished });
    localHolds.current.set(job, close); void registry.current.sequence!(link, layerId, trigger, origin, media => { if (media) rememberDesignMedia(mediaChanges, media); else started = true; }); return job;
  };
  registry.current.mediaDrag = (link, layerId, trigger, origin) => {
    const mediaChanges = new Map<DesignMediaState, DesignMediaSnapshot>(), ownEpoch = sequenceEpoch.current + 1;
    const view = element.current, width = Number.parseFloat(view?.style.width ?? '') || 320, height = Number.parseFloat(view?.style.height ?? '') || 480, scale = (view?.getBoundingClientRect().width ?? 0) / width || 1;
    let movement: DesignPoint | undefined;
    let closed = false, released = false, completed = false, settle!: () => void; const finished = new Promise<void>(resolve => { settle = resolve; });
    const close = (restore: boolean) => { if (closed) return; closed = true; if (restore) { if (sequenceEpoch.current === ownEpoch) { sequenceEpoch.current++; registry.current.busy = false; } for (const [owner, saved] of mediaChanges) owner.restoreTransport(saved); } localHolds.current.delete(job); settle(); };
    const update = (sample: DesignDragSample) => { if (!movement && (sample.offset.x || sample.offset.y)) movement = Math.abs(sample.offset.x) >= Math.abs(sample.offset.y) ? { x: Math.sign(sample.offset.x) * width * scale, y: 0 } : { x: 0, y: Math.sign(sample.offset.y) * height * scale }; };
    const job: DesignDragJob = Object.assign(() => close(true), { finished, update, release: (sample: DesignDragSample) => { update(sample); const vector = movement ?? { x: width * scale, y: 0 }, size = vector.x ** 2 + vector.y ** 2, progress = (sample.offset.x * vector.x + sample.offset.y * vector.y) / size, velocity = (sample.velocity.x * vector.x + sample.velocity.y * vector.y) / size; if (progress + velocity * .15 < .5) close(true); else { released = true; if (completed) close(false); } } });
    localHolds.current.set(job, close);
    void registry.current.sequence!(link, layerId, trigger, origin, change => { if (change) rememberDesignMedia(mediaChanges, change); }).then(ok => { completed = true; if (!ok) close(true); else if (released) close(false); });
    return job;
  };
  useEffect(() => () => { discardLocalHolds(); }, []);
  useEffect(() => { const hidden = () => { if (document.hidden) cancel(true); }; document.addEventListener('visibilitychange', hidden); return () => { cancel(); document.removeEventListener('visibilitychange', hidden); }; }, []);
  useEffect(() => { cancel(); discardLocalHolds(); }, [props.disabled, props.scrollRevision, nodes, width, height]);
  const effective = { ...props, mediaState: mediaOwner, prototypeSession: props.prototypeSession ?? localSession, onPrototypeError: props.onPrototypeError ?? setScrollError };
  const selection = resolveDesignSelection(nodes, effective, width, height), viewWidth = selection.width, viewHeight = selection.height;
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.disabled || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.key === 'Escape' || event.key === 'Tab') return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,video,[contenteditable="true"],[role="slider"],[role="tablist"],[role="radiogroup"]')) return;
    const codes = designKeyCodes(event.nativeEvent); if (!codes.length) return;
    for (const entry of registry.current.values()) {
      if (!usable(entry.element)) continue;
      const interaction = entry.interactions.find(interaction => interaction.trigger.type === 'key' && JSON.stringify(interaction.trigger.keyCodes) === JSON.stringify(codes));
      if (interaction) { if (!allDesignActions(interaction.navigation).some(action => ['open-url', 'media'].includes(action.action))) cancel(true, 'activate'); event.preventDefault(); event.stopPropagation(); entry.activate(interaction); return; }
    }
    if (event.key !== 'Enter' || !hasUrlAt(event.target)) cancel(true, 'activate');
  };
  const hasUrlAt = (target: EventTarget | null) => target instanceof Element && [...registry.current.values()].some(entry => entry.element?.contains(target) && entry.interactions.some(interaction => allDesignActions(interaction.navigation).some(action => ['open-url', 'media'].includes(action.action))));
  return <PrototypeScope.Provider value={registry.current}><div ref={element} data-xdesign-view="" tabIndex={0} aria-label="Design presentation" onKeyDownCapture={key} onWheelCapture={() => { discardLocalHolds(); cancel(true, 'scroll'); }} onTouchStartCapture={event => { if (!hasUrlAt(event.target)) cancel(true, 'pointer'); }} onPointerDownCapture={event => { if (!hasUrlAt(event.target)) cancel(true, 'pointer'); }} onPointerCancelCapture={() => cancel(true)} style={{ position: 'relative', width: viewWidth, height: viewHeight }}>{selection.nodes.map(node => <Layer key={node.id} node={node} props={effective} />)}{scrollError && <output role="alert" style={{ position: 'absolute', left: 0, bottom: 0 }}>{scrollError}</output>}</div></PrototypeScope.Provider>;
}
