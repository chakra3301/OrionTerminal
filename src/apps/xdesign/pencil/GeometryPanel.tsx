import type { SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { NumericValue } from "./AppearancePanel";

export function GeometryPanel({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(state => state.editor)!;
  const update = (changes: Partial<SceneNode>) => editor.updateNodeWithUndo(node.id, changes, "Change geometry");
  const corners = ["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(node.type);
  const arc = node.arcData ?? { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0 };
  return <>
    {corners && <details className="xd-pencil-property-card"><summary>Corners & smoothing</summary>
      <label><input aria-label="Independent corners" type="checkbox" checked={node.independentCorners} onChange={event => update({ independentCorners: event.target.checked, ...(!node.independentCorners ? { topLeftRadius: node.cornerRadius, topRightRadius: node.cornerRadius, bottomRightRadius: node.cornerRadius, bottomLeftRadius: node.cornerRadius } : {}) })}/>Independent corners</label>
      {node.independentCorners && <div className="xd-pencil-grid">{([ ["topLeftRadius", "Top left radius"], ["topRightRadius", "Top right radius"], ["bottomRightRadius", "Bottom right radius"], ["bottomLeftRadius", "Bottom left radius"] ] as const).map(([field, label]) => <NumericValue key={field} label={label} value={node[field]} onCommit={value => update({ [field]: value })}/>)}</div>}
      <NumericValue label="Corner smoothing %" value={node.cornerSmoothing * 100} max={100} onCommit={value => update({ cornerSmoothing: value / 100 })}/>
    </details>}
    {node.type === "ELLIPSE" && <details className="xd-pencil-property-card"><summary>Arc & ring</summary>
      <NumericValue label="Arc start °" min={-3600} max={3600} value={arc.startingAngle * 180 / Math.PI} onCommit={value => update({ arcData: { ...arc, startingAngle: value * Math.PI / 180 } })}/>
      <NumericValue label="Arc sweep °" min={-360} max={360} value={(arc.endingAngle - arc.startingAngle) * 180 / Math.PI} onCommit={value => update({ arcData: { ...arc, endingAngle: arc.startingAngle + value * Math.PI / 180 } })}/>
      <NumericValue label="Ring inner radius %" value={arc.innerRadius * 100} max={100} onCommit={value => update({ arcData: { ...arc, innerRadius: value / 100 } })}/>
      <button disabled={!node.arcData} onClick={() => update({ arcData: null })}>Reset ellipse</button>
    </details>}
    {node.strokes.length > 0 && <details className="xd-pencil-property-card"><summary>Stroke geometry</summary>
      <NumericValue label="Miter limit" value={node.strokeMiterLimit} min={1} onCommit={strokeMiterLimit => update({ strokeMiterLimit })}/>
      {corners && <><label><input aria-label="Independent stroke widths" type="checkbox" checked={node.independentStrokeWeights} onChange={event => update({ independentStrokeWeights: event.target.checked, ...(!node.independentStrokeWeights ? { borderTopWeight: node.strokes[0]!.weight, borderRightWeight: node.strokes[0]!.weight, borderBottomWeight: node.strokes[0]!.weight, borderLeftWeight: node.strokes[0]!.weight } : {}) })}/>Independent stroke widths</label>
      {node.independentStrokeWeights && <div className="xd-pencil-grid">{([ ["borderTopWeight", "Top stroke width"], ["borderRightWeight", "Right stroke width"], ["borderBottomWeight", "Bottom stroke width"], ["borderLeftWeight", "Left stroke width"] ] as const).map(([field, label]) => <NumericValue key={field} label={label} value={node[field]} onCommit={value => update({ [field]: value })}/>)}</div>}</>}
    </details>}
  </>;
}
