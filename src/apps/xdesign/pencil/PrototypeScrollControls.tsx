import type { SceneNode } from '@open-pencil/scene-graph';
import { usePencilWorkspace } from './runtime';
import { readPrototypeScroll, readScrollBehaviour, scrollContainer, setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import type { DesignScroll } from './reactExportRuntime';
export function PrototypeScrollControls({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(state => state.editor)!;
  const config = readPrototypeScroll(node), position = readScrollBehaviour(node, editor.graph), parent = node.parentId && editor.graph.getNode(node.parentId);
  const run = (work: () => void) => { try { work(); } catch (error) { usePencilWorkspace.setState({ error: String(error) }); } };
  if (!scrollContainer(node) && (!parent || !scrollContainer(parent))) return null;
  return <details className="xd-pencil-property-card"><summary>Scrolling</summary>
    {scrollContainer(node) && (config.issue ? <><p role="status">{config.issue}</p><button onClick={() => run(() => setPrototypeScroll(editor, node, { axis: 'none' }))}>Reset scroll settings</button></> : <>
      <label>Overflow<select aria-label="Prototype scrolling" value={config.settings.axis} onChange={event => run(() => setPrototypeScroll(editor, node, { ...config.settings, axis: event.target.value as DesignScroll['axis'] }))}>{['none', 'horizontal', 'vertical', 'both'].map(axis => <option key={axis}>{axis}</option>)}</select></label>
      {config.settings.axis !== 'none' && <div className="xd-prototype-bezier">{(['x', 'y'] as const).map(axis => <label key={axis}>Start {axis.toUpperCase()}<input aria-label={`Prototype scroll start ${axis}`} type="number" min={-1000000} max={1000000} key={`${axis}/${config.settings.initial?.[axis] ?? 0}`} defaultValue={config.settings.initial?.[axis] ?? 0} onBlur={event => run(() => setPrototypeScroll(editor, node, { ...config.settings, initial: { x: config.settings.initial?.x ?? 0, y: config.settings.initial?.y ?? 0, [axis]: event.target.valueAsNumber } }))} /></label>)}</div>}
    </>)}
    {parent && scrollContainer(parent) && <label>Position while scrolling<select aria-label="Prototype scroll position" value={position.issue ? 'unsupported' : position.behaviour} onChange={event => run(() => setScrollBehaviour(editor, node, event.target.value as 'scroll' | 'fixed' | 'sticky'))}>{position.issue && <option value="unsupported">Preserved unsupported positioning</option>}<option value="scroll">Scroll with frame</option><option value="fixed">Fixed in viewport</option><option value="sticky">Stick to viewport edge</option></select></label>}
  </details>;
}
