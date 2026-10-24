import { assetCredits } from "./assetCredits";
import type { SceneNode } from "@open-pencil/scene-graph";
import { InspectorSection } from "../EditorChrome";
import { usePencilWorkspace, editPencilImage } from "./runtime";
import { AppearancePanel } from "./AppearancePanel";
import { TypographyPanel } from "./TypographyPanel";
import { LayoutPanel } from "./LayoutPanel";
import { ComponentPanel } from "./ComponentPanel";
import { ComponentBindingsPanel } from "./ComponentBindingsPanel";
import { GuidesPanel } from "./GuidesPanel";
import { isLibraryDefinition } from "./librarySession";
import { MixedSelectionProperties } from "./MixedSelectionProperties";
import { SharedStylesPanel } from "./SharedStylesPanel";
import { GeometryPanel } from "./GeometryPanel";
import { LayoutChildPanel } from "./LayoutChildPanel";
import { SlotPanel } from "./SlotPanel";
import { BehaviourPanel } from "./BehaviourPanel";

function NumberField({ node, field, label, min, max }: { node: SceneNode; field: keyof SceneNode; label: string; min?: number; max?: number }) {
  const editor = usePencilWorkspace(s => s.editor);
  return <label>{label}<input key={`${node.id}/${String(node[field])}`} aria-label={label} type="number" step="any" min={min} max={max} defaultValue={Number(node[field])} onBlur={event => {
    const value = event.target.valueAsNumber;
    if (editor && Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value <= max) && value !== node[field]) {
      editor.updateNodeWithUndo(node.id, { [field]: value }, `Change ${label}`);
      if (field === "fontWeight" || field === "fontSize") void editor.loadFontsForNodes([node.id]).catch(error => usePencilWorkspace.setState({ error: String(error) }));
    }
  }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}/></label>;
}
export function SelectionProperties({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(s => s.editor)!;
  const nodes = editor.getSelectedNodes();
  if(nodes.length>1)return <MixedSelectionProperties nodes={nodes}/>;
  if (isLibraryDefinition(editor.graph, node)) return <div className="xd-editor-empty"><strong>Library component</strong><p>Edit the original project and publish a new revision to update this definition.</p></div>;
  const update = (patch: Partial<SceneNode>) => editor.updateNodeWithUndo(node.id, patch);
  const container = ["FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type);
  return <>
    <div className="xd-pencil-selection-head"><span>{node.type.toLowerCase().replaceAll("_", " ")}</span><input aria-label="Layer name" key={`${node.id}/${node.name}`} defaultValue={node.name} onBlur={event => { if (event.target.value !== node.name) update({ name: event.target.value }); }}/>
      {nodes.length > 1 && <small>{nodes.length} selected · properties of {node.name}</small>}
    </div>
    <InspectorSection title="Position & size" defaultOpen>
      <div className="xd-pencil-grid">{([["x", "X"], ["y", "Y"], ["width", "Width"], ["height", "Height"], ["rotation", "Rotation"], ["cornerRadius", "Corner radius"]] as const).map(([field, label]) => <NumberField key={field} node={node} field={field} label={label} min={field === "width" || field === "height" || field === "cornerRadius" ? 0 : undefined}/>)}</div>
      {(node.type === "STAR" || node.type === "POLYGON") && <><NumberField node={node} field="pointCount" label="Points" min={3} max={128}/>{node.type === "STAR" && <NumberField node={node} field="starInnerRadius" label="Inner radius" min={0} max={1}/>}</>}
      <GeometryPanel node={node}/><LayoutChildPanel node={node}/>
      <div className="xd-pencil-buttons"><button onClick={() => editor.duplicateSelected()}>Duplicate</button><button onClick={() => update({ locked: !node.locked })}>{node.locked ? "Unlock" : "Lock"}</button><button onClick={() => update({ visible: !node.visible })}>{node.visible ? "Hide" : "Show"}</button><button onClick={() => editor.deleteSelected()}>Delete</button></div>
    </InspectorSection>
    {node.type === "TEXT" && <InspectorSection title="Typography" defaultOpen>
      <textarea aria-label="Text content" key={`${node.id}/${node.text}`} defaultValue={node.text} onBlur={event => update({ text: event.target.value })}/><TypographyPanel node={node}/>
      <div className="xd-pencil-grid"><NumberField node={node} field="fontSize" label="Font size" min={1}/><NumberField node={node} field="fontWeight" label="Weight" min={100}/><NumberField node={node} field="letterSpacing" label="Letter spacing"/></div>
    </InspectorSection>}
    {assetCredits(node).map(source=><InspectorSection key={source.sourceId} title="Asset source" defaultOpen><p>{source.author ? `${source.author} · ` : ""}{source.provider}</p><a href={source.source} target="_blank" rel="noreferrer">View source</a>{source.authorURL&&<a href={source.authorURL} target="_blank" rel="noreferrer">Photographer / author</a>}{source.licenseURL&&<a href={source.licenseURL} target="_blank" rel="noreferrer">{source.license??"License"}</a>}</InspectorSection>)}
    <InspectorSection title="Appearance" defaultOpen><AppearancePanel node={node}/><SharedStylesPanel nodes={[node]}/>
      {node.fills.some(fill => fill.type === "IMAGE") && <button className="xd-pencil-edit-image" onClick={() => { void editPencilImage(node.id).catch(error => usePencilWorkspace.setState({ error: String(error) })); }}>Edit image pixels</button>}
    </InspectorSection>
    {container && <InspectorSection title="Auto layout" defaultOpen={node.layoutMode !== "NONE"}>
      <label>Direction<select aria-label="Auto layout" value={node.layoutMode} onChange={event => update({ layoutMode: event.target.value as SceneNode["layoutMode"] })}>{["NONE", "HORIZONTAL", "VERTICAL", "GRID"].map(value => <option key={value}>{value}</option>)}</select></label>
      {node.layoutMode !== "NONE" && <>
        <div className="xd-pencil-grid">{([["itemSpacing", "Gap"], ["paddingTop", "Top"], ["paddingRight", "Right"], ["paddingBottom", "Bottom"], ["paddingLeft", "Left"]] as const).map(([field, label]) => <NumberField key={field} node={node} field={field} label={label}/>)}</div>
        <label>{node.layoutMode === "VERTICAL" ? "Height sizing" : "Width sizing"}<select value={node.primaryAxisSizing} onChange={event => update({ primaryAxisSizing: event.target.value as SceneNode["primaryAxisSizing"] })}>{["FIXED", "HUG", "FILL"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>{node.layoutMode === "VERTICAL" ? "Width sizing" : "Height sizing"}<select value={node.counterAxisSizing} onChange={event => update({ counterAxisSizing: event.target.value as SceneNode["counterAxisSizing"] })}>{["FIXED", "HUG", "FILL"].map(value => <option key={value}>{value}</option>)}</select></label>
      </>}
      <LayoutPanel node={node} part="layout"/>
      <label><input type="checkbox" checked={node.clipsContent} onChange={event => update({ clipsContent: event.target.checked })}/>Clip contents</label>
    </InspectorSection>}
    <InspectorSection title="Arrange & constraints"><LayoutPanel node={node} part="arrange"/>{(["horizontalConstraint", "verticalConstraint"] as const).map(field => <label key={field}>{field === "horizontalConstraint" ? "Horizontal constraint" : "Vertical constraint"}<select value={node[field]} onChange={event => update({ [field]: event.target.value })}>{["MIN", "CENTER", "MAX", "STRETCH", "SCALE"].map(value => <option key={value}>{value}</option>)}</select></label>)}</InspectorSection>
    <InspectorSection title="Components & vectors" defaultOpen={["COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)}><ComponentPanel node={node}/><ComponentBindingsPanel node={node}/><SlotPanel node={node}/><BehaviourPanel node={node}/>
      <div className="xd-pencil-buttons"><button onClick={() => editor.createComponentFromSelection()}>Create component</button>
        {nodes.length > 1 && nodes.every(item => item.type === "COMPONENT") && <button onClick={() => editor.createComponentSetFromComponents()}>Combine variants</button>}
        {node.type === "COMPONENT" && <button onClick={() => editor.createInstanceFromComponent(node.id, node.x + node.width + 24, node.y)}>Create instance</button>}
        {node.type === "INSTANCE" && <button onClick={() => editor.detachInstance()}>Detach instance</button>}
        {nodes.length > 1 && (["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"] as const).map(operation => <button key={operation} onClick={() => editor.booleanOperationSelected(operation)}>{operation.toLowerCase()}</button>)}
        {nodes.some(item => item.strokes.length) && <button onClick={() => editor.outlineStrokeSelected()}>Outline stroke</button>}
        {nodes.some(item => item.type === "TEXT") && <button onClick={() => editor.outlineTextSelected()}>Outline text</button>}
      </div>
    </InspectorSection>
    <div className="xd-pencil-document-controls"><GuidesPanel node={node}/></div>
  </>;
}
