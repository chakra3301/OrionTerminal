import { useState } from "react";
import type { SceneNode } from "@open-pencil/scene-graph";
import { resolveComponentPropertyValue } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { addSlotComponent, createSlot, editSlot, instanceSlotFrames, mainSlotComponent, nearestSlotInstance, ownsSlotContent, removeSlot, slotDefinitions, slotOwner, slotPropertyId, slotViolations, updateSlot, defaultSlotSettings, type SlotDefinition } from "./slots";

function SlotSettingsFields({ owner, definition, act }: { owner: SceneNode; definition: SlotDefinition; act: (work: () => unknown) => void }) {
  const editor = usePencilWorkspace(s => s.editor)!, settings = { ...defaultSlotSettings, ...definition.slotSettings };
  const components = [...editor.graph.nodes.values()].filter(node => node.type === "COMPONENT");
  return <details><summary>Slot settings</summary>
    <label>Name<input key={definition.name} aria-label="Slot property name" defaultValue={definition.name} onBlur={event => { if (event.target.value !== definition.name) act(() => updateSlot(editor, owner, definition.id, { name: event.target.value })); }}/></label>
    {([['displayEmptyByDefault','Show empty slot by default'],['stretchChildOnInsert','Stretch inserted components'],['allowPreferredValuesOnly','Only preferred components']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={event => act(() => updateSlot(editor, owner, definition.id, { slotSettings: { [key]: event.target.checked } }))}/>{label}</label>)}
    <div className="xd-pencil-grid">{([['minChildren','Minimum layers'],['maxChildren','Maximum layers']] as const).map(([key,label]) => <label key={key}>{label}<input key={`${definition.id}/${settings[key]}`} aria-label={label} type="number" min={0} max={10000} step={1} placeholder="No limit" defaultValue={settings[key] ?? ''} onBlur={event => act(() => updateSlot(editor, owner, definition.id, { slotSettings: { [key]: event.target.value === '' ? undefined : event.target.valueAsNumber } }))}/></label>)}</div>
    <details><summary>Preferred components · {definition.preferredValues?.length ?? 0}</summary><div className="xd-pencil-preferred-components">{components.map(component => {
      const values = definition.preferredValues ?? [], checked = values.some(value => resolveComponentPropertyValue(editor.graph, value)?.id === component.id);
      return <label key={component.id} className="xd-library-checkbox"><input aria-label={`Prefer ${component.name} for slot ${definition.name}`} type="checkbox" checked={checked} onChange={event => act(() => updateSlot(editor, owner, definition.id, { preferredValues: event.target.checked ? [...values, component.id] : values.filter(value => resolveComponentPropertyValue(editor.graph, value)?.id !== component.id) }))}/><span>{component.name}</span></label>;
    })}</div></details>
  </details>;
}
export function SlotPanel({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(s => s.editor)!, [error,setError] = useState(''), [component,setComponent] = useState('');
  const act = (work: () => unknown) => { try { work(); setError(''); } catch (error) { setError(String(error)); } };
  const propertyId = slotPropertyId(node), owner = slotOwner(editor.graph, node), instance = nearestSlotInstance(editor.graph, node);
  const frames = node.type === "INSTANCE" || node.type === "COMPONENT" ? instanceSlotFrames(editor.graph, node) : propertyId ? [node] : [];
  if (!frames.length && !(node.type === "FRAME" && owner)) return null;
  const components = [...editor.graph.nodes.values()].filter(node => node.type === "COMPONENT").sort((a,b) => a.name.localeCompare(b.name));
  return <div className="xd-pencil-slot-panel"><h3>Content slots</h3>
    {!propertyId && node.type === "FRAME" && owner && <><p className="xd-pencil-section-help">Let each instance use its own content inside this frame.</p><button onClick={() => act(() => createSlot(editor,node))}>Make content slot</button></>}
    {frames.map(frame => {
      const frameInstance = node.type === "INSTANCE" ? node : instance, frameOwner = frameInstance ? mainSlotComponent(editor.graph,frameInstance) : slotOwner(editor.graph,frame);
      const definition = frameOwner && slotDefinitions(editor.graph,frameOwner).find(def => def.id === slotPropertyId(frame));
      if (!definition || !frameOwner) return null;
      const settings = { ...defaultSlotSettings,...definition.slotSettings }, preferred = definition.preferredValues ?? [], issues = slotViolations(editor.graph,frame);
      const choices = settings.allowPreferredValuesOnly ? components.filter(node => preferred.some(value => resolveComponentPropertyValue(editor.graph,value)?.id === node.id)) : components;
      return <div className="xd-pencil-property-card" key={frame.id}><strong>{definition.name}</strong><small>{frame.childIds.length} layers · {frameInstance ? ownsSlotContent(editor.graph,frame) ? "Instance content" : "Component content" : "Default content"}</small>
        {frameInstance ? <><div className="xd-pencil-buttons"><button onClick={() => { act(() => editSlot(editor,frame,"claim")); editor.select([frame.id]); }}>Edit contents</button><button onClick={() => act(() => editSlot(editor,frame,"clear"))}>Clear slot</button><button disabled={!ownsSlotContent(editor.graph,frame)} onClick={() => act(() => editSlot(editor,frame,"reset"))}>Reset slot</button></div>
          <label>Insert component<select aria-label={`Insert component into ${definition.name}`} value={component} onChange={event => setComponent(event.target.value)}><option value="">Choose component</option>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label><button disabled={!component || !choices.some(choice => choice.id === component) || frame.childIds.length >= (settings.maxChildren ?? Infinity)} onClick={() => act(() => addSlotComponent(editor,frame,component))}>Add to slot</button></>
          : <><SlotSettingsFields owner={frameOwner} definition={definition} act={act}/><button onClick={() => act(() => removeSlot(editor,frame))}>Remove slot binding</button></>}
        {issues.map(issue => <p role="status" key={issue}>{issue}</p>)}
      </div>;
    })}{error && <p role="alert">{error}</p>}
  </div>;
}
