import type { SceneNode } from '@open-pencil/scene-graph';
import { InspectorSection } from '../EditorChrome';
import { usePencilWorkspace } from './runtime';
import { MAX_PROTOTYPE_INTERACTIONS, prototypeActionContexts, prototypeActionScrollTargets, prototypeResolver, prototypeScreens, prototypeStart, readPrototype, setPrototypeInteractions, setPrototypeStart, validPrototypeKeys, type DesignInteraction, type DesignNavigation, type DesignTrigger } from './prototype';
import { allDesignActions, designActions, MAX_DESIGN_ACTIONS, designKeyCodes } from './reactExportRuntime';
import { PrototypeOverlayControls } from './PrototypeOverlayControls';
import { PrototypeScrollControls } from './PrototypeScrollControls';
import { scrollTargets } from './prototypeScroll';
import { PrototypeNavigationControls } from './PrototypeNavigationControls';

export function PrototypePanel({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(state => state.editor)!;
  const screens = prototypeScreens(editor.graph, editor.state.currentPageId), { interactions = [], issue, imported } = readPrototype(node, prototypeResolver(editor.graph));
  const run = (work: () => void) => { try { work(); } catch (error) { usePencilWorkspace.setState({ error: String(error) }); } };
  const save = (next: DesignInteraction[]) => run(() => setPrototypeInteractions(editor, node, next));
  const change = (id: string, patch: Partial<DesignInteraction>) => save(interactions.map(interaction => interaction.id === id ? { ...interaction, ...patch } : interaction));
  const navigation = (interaction: DesignInteraction, patch: Partial<DesignNavigation>) => change(interaction.id, { navigation: { ...interaction.navigation, ...patch, ...('target' in patch ? { unresolved: undefined } : {}) } });
  const add = () => {
    let delay = 1000;
    while (interactions.some(interaction => interaction.trigger.type === 'delay' && interaction.trigger.delay === delay)) delay += 1000;
    save([...interactions, { id: crypto.randomUUID(), trigger: interactions.some(interaction => interaction.trigger.type === 'click') ? { type: 'delay', delay } : { type: 'click' }, navigation: { action: screens.length ? 'navigate' : 'back', target: screens[0]?.id, transition: 'instant', duration: 250 } }]);
  };
  const isScreen = screens.some(screen => screen.id === node.id);
  let scrollIssue = '';
  try { scrollTargets(editor.graph, node); } catch (error) { scrollIssue = String(error); }
  return <InspectorSection title="Prototype">
    {isScreen && <button disabled={prototypeStart(editor.graph, editor.state.currentPageId) === node.id} onClick={() => run(() => setPrototypeStart(editor, node.id))}>{prototypeStart(editor.graph, editor.state.currentPageId) === node.id ? 'Starting screen' : 'Set as starting screen'}</button>}
    {isScreen && <PrototypeOverlayControls node={node} />}
    <PrototypeScrollControls node={node} />
    {scrollIssue && <p role="status">{scrollIssue}</p>}
    {imported && !issue && !!interactions.length && <p>Imported interactions</p>}
    {issue && <><p role="status">{issue}</p><button onClick={() => save([])}>Remove interactions</button></>}
    {interactions.map((interaction, index) => {
      const link = interaction.navigation, trigger = interaction.trigger, actions = designActions(link), contexts = prototypeActionContexts(editor.graph, node, actions), hasUrl = allDesignActions(link).some(action => action.action === 'open-url'), hasMedia = allDesignActions(link).some(action => action.action === 'media');
      return <fieldset className="xd-prototype-interaction" key={`${node.id}/${interaction.id}`}><legend>Interaction {index + 1}</legend>
        <label>Trigger<select aria-label={`Prototype trigger ${index + 1}`} value={trigger.type} onChange={event => {
          const type = event.target.value as DesignTrigger['type'];
          change(interaction.id, { trigger: type === 'delay' ? { type, delay: 1000 } : type === 'key' ? { type, keyCodes: [13] } : type === 'media-hit' ? { type, time: 1 } : { type } });
        }}><option value="click">On click</option><option value="drag">On drag</option><option value="pointer-enter">Mouse enter</option><option value="pointer-leave">Mouse leave</option><option value="hover">While hovering</option><option value="press">While pressing</option><option value="pointer-down">Mouse / touch down</option><option value="pointer-up">Mouse / touch up</option><option value="media-hit" disabled={!node.fills.some(fill => fill.visible && fill.type === 'VIDEO')}>When video hits</option><option value="media-end" disabled={!node.fills.some(fill => fill.visible && fill.type === 'VIDEO')}>When video ends</option><option value="delay">After delay</option><option value="key">Key / shortcut</option></select></label>
        {['delay', 'pointer-enter', 'pointer-leave', 'pointer-down', 'pointer-up', 'hover', 'press'].includes(trigger.type) && <label>Delay (ms)<input aria-label={`Prototype delay ${index + 1}`} type="number" min={0} max={60000} key={`${interaction.id}/${'delay' in trigger ? trigger.delay : 0}`} defaultValue={'delay' in trigger ? trigger.delay ?? 0 : 0} onBlur={event => change(interaction.id, { trigger: { ...trigger, delay: event.target.valueAsNumber } as DesignTrigger })} /></label>}
        {trigger.type === 'media-hit' && <label>Timestamp (seconds)<input aria-label={`Prototype video time ${index + 1}`} type="number" min={0} max={86400} step={0.001} key={`${interaction.id}/${trigger.time}`} defaultValue={trigger.time} onBlur={event => change(interaction.id, { trigger: { ...trigger, time: event.target.valueAsNumber } })} /></label>}
        {trigger.type === 'drag' && <p>{hasMedia ? hasUrl ? 'Dragging opens links when it starts; video playback and local actions follow the drag and release.' : 'Dragging controls video playback; release commits or restores its starting playback.' : hasUrl ? 'Dragging opens links when it starts; local actions follow the drag and release.' : 'Drag follows the transition; release commits or returns to its starting state.'}</p>}
        {['hover', 'press'].includes(trigger.type) && <p>{hasMedia ? hasUrl ? 'Ending the hold restores video playback and local changes; opened links stay open.' : 'Ending the hold restores video playback and local changes.' : hasUrl ? 'Ending the hold restores local changes; opened links stay open.' : 'Navigation returns to its starting route when the hold ends.'}</p>}
        {trigger.type === 'key' && <label>Shortcut<input aria-label={`Prototype shortcut ${index + 1}`} readOnly value={shortcutLabel(trigger.keyCodes)} onKeyDown={event => {
          if (event.key === 'Tab' || event.key === 'Escape') return;
          event.preventDefault(); event.stopPropagation(); const keyCodes = designKeyCodes(event.nativeEvent);
          if (validPrototypeKeys(keyCodes)) change(interaction.id, { trigger: { type: 'key', keyCodes } });
        }} /><span>Focus and press a key combination.</span></label>}
        {actions.map((action, step) => {
          let targets: SceneNode[] = [], targetIssue = ''; try { targets = prototypeActionScrollTargets(editor.graph, contexts[step], screens); } catch (error) { targetIssue = String(error); }
          const update = (patch: Partial<DesignNavigation>) => {
            if (link.action !== 'sequence') navigation(interaction, patch);
            else { const actions = [...designActions(link)]; actions[step] = { ...action, ...patch, ...('target' in patch ? { unresolved: undefined } : {}) }; navigation(interaction, { actions }); }
          };
          return <div className="xd-prototype-action" key={`${interaction.id}/${step}`}>
            {link.action === 'sequence' && <div className="xd-pencil-buttons"><span>Action {step + 1}</span><button aria-label={`Move action ${step + 1} up in interaction ${index + 1}`} disabled={!step} onClick={() => { const actions = [...designActions(link)]; [actions[step - 1], actions[step]] = [actions[step]!, actions[step - 1]!]; navigation(interaction, { actions }); }}>↑</button><button aria-label={`Move action ${step + 1} down in interaction ${index + 1}`} disabled={step === actions.length - 1} onClick={() => { const actions = [...designActions(link)]; [actions[step + 1], actions[step]] = [actions[step]!, actions[step + 1]!]; navigation(interaction, { actions }); }}>↓</button><button aria-label={`Remove action ${step + 1} in interaction ${index + 1}`} disabled={actions.length === 1} onClick={() => { const actions = designActions(link).filter((_, position) => position !== step); change(interaction.id, { navigation: actions.length === 1 ? actions[0]! : { action: 'sequence', actions, transition: 'instant', duration: 0 } }); }}>×</button></div>}
            {targetIssue && <p role="status">{targetIssue}</p>}
            {action.action === 'scroll' && contexts[step] === null && <p>Back and Close use the live presentation route. This layer must be on the screen reached at this step.</p>}
            <PrototypeNavigationControls link={action} screens={screens} layers={targets} context={contexts[step]} actor={node} label={link.action === 'sequence' ? `${index + 1} step ${step + 1}` : index + 1} change={update} />
          </div>;
        })}
        <button disabled={designActions(link).length >= MAX_DESIGN_ACTIONS} onClick={() => navigation(interaction, { action: 'sequence', transition: 'instant', duration: 0, actions: [...designActions(link), { action: screens.length ? 'navigate' : 'back', target: screens[0]?.id, transition: 'instant', duration: 250 }] })}>Add action to interaction {index + 1}</button>
        <button onClick={() => save(interactions.filter(candidate => candidate.id !== interaction.id))}>Remove interaction {index + 1}</button>
      </fieldset>;
    })}
    <button disabled={!!issue || interactions.length >= MAX_PROTOTYPE_INTERACTIONS} onClick={add}>Add interaction</button>
    <p>Present plays this page’s screens and interactive components. Escape closes it; shortcuts run while the screen has focus.</p>
  </InspectorSection>;
}
function shortcutLabel(codes: number[]): string {
  const names: Record<number, string> = { 8: 'Backspace', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: '←', 38: '↑', 39: '→', 40: '↓', 46: 'Delete', 91: '⌘' };
  return codes.map(code => names[code] ?? (code >= 112 ? `F${code - 111}` : String.fromCharCode(code))).join(' + ');
}
