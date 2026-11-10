import { useState } from "react";
import { getSharedStyles, recordInstanceOverride, sharedStyleRefKey, sharedStyleTypeForKind, type SceneNode, type SceneGraph, type SharedStyleKind } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { editPencilGraph } from "./toolExecution";
import { isLibraryDefinition } from "./librarySession";

const TEXT_KEYS = ["fontFamily", "fontWeight", "italic", "fontSize", "lineHeight", "letterSpacing", "textDecoration", "textCase", "fontFeatures"] as const;

export function nextStyleSourceId(graph:SceneGraph):string {
  const used=new Set([...graph.nodes.values()].map(node=>node.source.id));
  let localId=2;
  for(const id of used)if(id&&/^1:\d+$/.test(id)){const value=Number(id.slice(2));if(value<0xffffffff)localId=Math.max(localId,value+1);}
  if(localId>0xffffffff){localId=2;while(used.has(`1:${localId}`))localId++;}
  return `1:${localId}`;
}

export function sharedStyleChanges(kind: SharedStyleKind, source: SceneNode, id: string | null, target: SceneNode = source): Partial<SceneNode> {
  const changes: Partial<SceneNode> = { [sharedStyleRefKey(kind)]: id };
  if (kind === "fill") changes.fills = structuredClone(source.fills);
  if (kind === "stroke") {
    const fallback = target.strokes[0] ?? { color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true, align: "CENTER" as const };
    const paints = source.fills.filter(fill => fill.type === "SOLID");
    changes.strokes = paints.length ? paints.map((fill, i) => ({
      ...structuredClone(target.strokes[i] ?? fallback), color: { ...fill.color }, opacity: fill.opacity, visible: fill.visible,
    })) : structuredClone(target.strokes);
  }
  if (kind === "effect") changes.effects = structuredClone(source.effects);
  if (kind === "grid") changes.layoutGrids = structuredClone(source.layoutGrids);
  if (kind === "text") for (const key of TEXT_KEYS) Object.assign(changes, { [key]: structuredClone(source[key]) });
  return changes;
}

export function styleDefinitionChanges(kind: SharedStyleKind, source: SceneNode): Partial<SceneNode> {
  if (kind !== "stroke") return sharedStyleChanges(kind, source, null);
  return { fills: source.strokes.map(stroke => ({ type: "SOLID", color: { ...stroke.color }, opacity: stroke.opacity, visible: stroke.visible })), strokeStyleId: null };
}

export function SharedStylesPanel({ nodes }: { nodes: SceneNode[] }) {
  const editor = usePencilWorkspace(state => state.editor)!;
  const [kind, setKind] = useState<SharedStyleKind>("fill"), [name, setName] = useState("New style"), [error, setError] = useState(""), [manageId,setManageId] = useState<string|null>(null);
  const targets = nodes.filter(node => !node.locked && !isLibraryDefinition(editor.graph, node) && (kind !== "text" || node.type === "TEXT") && (kind !== "grid" || ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)));
  const styles = getSharedStyles(editor.graph, kind), key = sharedStyleRefKey(kind);
  const current = targets.length && targets.every(node => node[key] === targets[0]![key]) ? targets[0]![key] ?? "" : "MIXED";
  const run = (label: string, work: () => void) => { try { editPencilGraph(editor, label, work); setError(""); } catch (error) { setError(String(error)); } };
  const apply = (node: SceneNode, changes: Partial<SceneNode>) => {
    editor.updateNode(node.id, changes);
    recordInstanceOverride(editor.graph, node.id, Object.keys(changes));
  };
  const bind = (id: string) => {
    const style = styles.find(style => style.id === id), source = style && editor.graph.getNode(style.nodeId);
    if (source) run("Apply shared style", () => { for (const node of targets) apply(node, sharedStyleChanges(kind, source, id, node)); });
  };
  const selected = styles.find(style => style.id === (manageId??current)), source = selected && editor.graph.getNode(selected.nodeId);
  return <details className="xd-pencil-property-card"><summary>Shared styles</summary>
    <label>Type<select aria-label="Shared style type" value={kind} onChange={event => {setKind(event.target.value as SharedStyleKind);setManageId(null);}}>{["fill", "stroke", "text", "effect", "grid"].map(kind => <option key={kind}>{kind}</option>)}</select></label>
    <label>Style<select aria-label="Shared style" disabled={!targets.length} value={current} onChange={event => {
      if (event.target.value) bind(event.target.value);
      else run("Detach shared style", () => { for (const node of targets) apply(node, { [key]: null }); });
    }}><option value="">None</option><option value="MIXED" disabled>Mixed</option>{styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
    <label>Name<input aria-label="New shared style name" value={name} onChange={event => setName(event.target.value)}/></label>
    <label>Manage style<select aria-label="Manage shared style" value={selected?.id??""} onChange={event=>setManageId(event.target.value||null)}><option value="">Choose style</option>{styles.map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
    {source&&<label>Style name<input aria-label="Shared style name" key={`${source.id}/${source.name}`} defaultValue={source.name} disabled={source.librarySource?.readOnly} onBlur={event=>{if(event.target.value.trim()&&event.target.value!==source.name)run("Rename shared style",()=>editor.updateNode(source.id,{name:event.target.value.trim()}));}}/></label>}
    <div className="xd-pencil-buttons">
      <button disabled={!targets.length || !name.trim()} onClick={() => run("Create shared style", () => {
        let page = editor.graph.getPages(true).find(page => page.internalOnly && page.name === "XDesign styles");
        if (!page) { page = editor.graph.addPage("XDesign styles"); editor.graph.updateNode(page.id, { internalOnly: true }); }
        const template = targets[0]!, id = nextStyleSourceId(editor.graph);
        const style = editor.graph.createNode(kind === "text" ? "TEXT" : "RECTANGLE", page.id, {
          ...styleDefinitionChanges(kind, template), name: name.trim(), sharedStyleType: sharedStyleTypeForKind(kind), internalOnly: true, source: { ...template.source, id },
        });
        for (const node of targets) apply(node, sharedStyleChanges(kind, style, id, node));
      })}>Create from selection</button>
      <button disabled={!source || source.librarySource?.readOnly || !targets.length} onClick={() => run("Update shared style", () => {
        editor.updateNode(source!.id, styleDefinitionChanges(kind, targets[0]!));
        for (const node of editor.graph.nodes.values()) if (node[key] === selected!.id && node.id !== source!.id && !isLibraryDefinition(editor.graph, node)) apply(node, sharedStyleChanges(kind, source!, selected!.id, node));
        for (const node of targets) apply(node, sharedStyleChanges(kind, source!, selected!.id, node));
      })}>Update style</button>
      <button disabled={!source || source.librarySource?.readOnly} onClick={() => run("Delete shared style", () => {
        for (const node of editor.graph.nodes.values()) if (node[key] === selected!.id) apply(node, { [key]: null });
        editor.graph.deleteNode(source!.id);
      })}>Delete style</button>
    </div>{error && <p role="alert">{error}</p>}
  </details>;
}
