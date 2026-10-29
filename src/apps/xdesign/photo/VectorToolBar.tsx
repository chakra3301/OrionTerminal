import { useEffect, useState } from "react";
import { runPhotoCommand } from "./runtime";
import type { PathData } from "./PathEditOverlay";
import { PathOpSelect, ShapeStyleFields } from "./toolBars";
import { CommitNumber } from "./ShapeStyleFields";
import { ComponentOpSelect, CornerRadiusFields, FreeformFields, LineGear, MakeButtons, PathAlignMenu, PenFields, PixelFields, SelectScopeSelect, ShapeGear, SizeFields, VectorModeSelect } from "./vectorBars";
import { alignSubpaths, pathBounds, resizeMatrix, uniformMove, type AlignEdge } from "./vectorGeometry";
import { DEFAULT_SHAPE_STYLE, shapeEditParams, styleFromShapeInfo, withPatterns, type ShapeStyle } from "./shapeStyle";
import { VECTOR_RANGES, type useVectorToolPreferences, type VectorToolOptions } from "./vectorToolPreferences";

export type VectorTarget = { name: string; layer?: number; path: PathData };
type MakeWhat = "selection" | "mask" | "shape";
const COMPONENT_OPS = ["combine", "subtract", "intersect", "exclude"] as const;
type ComponentOp = typeof COMPONENT_OPS[number];

/** The options bar of the shape tools, the pens and the path selection tools. Each committed control runs one engine command. `opaque` greys Pixels mode's Behind and Clear. */
export function VectorToolBar({ kind, tool, options: o, setOption, busy, version, shapeLayer, target, canvas, foreground, background, foregroundValue, patterns, opaque, make, merge, run }: {
  kind: "shape" | "pen" | "select"; tool: string; options: VectorToolOptions; setOption: ReturnType<typeof useVectorToolPreferences>["setOption"];
  busy: boolean; version?: string; shapeLayer: number | null; target: VectorTarget | null; canvas: { width: number; height: number };
  foreground: string; background: string; foregroundValue: unknown; patterns: readonly { id: string; name: string }[]; opaque?: boolean;
  make: { mask: boolean; shape: boolean; disabled: boolean; run: (what: MakeWhat) => void }; merge?: () => void;
  run: (id: string, params?: Record<string, unknown>) => unknown;
}) {
  const select = kind === "select", [layerStyle, setLayerStyle] = useState<ShapeStyle | null>(null);
  useEffect(() => {
    setLayerStyle(null);
    if (!select || shapeLayer === null) return;
    let alive = true;
    void runPhotoCommand("shape.info", { layer: shapeLayer }).then(info => { if (alive && info) setLayerStyle(styleFromShapeInfo(info, DEFAULT_SHAPE_STYLE)); }).catch(() => {});
    return () => { alive = false; };
  }, [select, shapeLayer, version]);
  const mode = kind === "shape" ? o.shapeMode : kind === "pen" ? o.penMode : null;
  // The shape tools and pens size the active shape layer; Path Selection sizes whichever path it has selected.
  const sized = target && (select || target.layer !== undefined) ? target : null, bounds = sized && pathBounds(sized.path);
  const edit = (layerParams: Record<string, unknown>, pathCommand: string, pathParams: Record<string, unknown>) => { if (!target) return; if (target.layer !== undefined) run("shape.edit", { layer: target.layer, ...layerParams }); else run(pathCommand, { name: target.name, ...pathParams }); };
  const resize = (width: number, height: number) => { const matrix = bounds && resizeMatrix(bounds, width, height); if (matrix) edit({ transform: matrix }, "path.transform", { matrix }); };
  const align = (edge: AlignEdge) => {
    if (!target) return;
    const area = o.alignTo === "canvas" ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : pathBounds(target.path); if (!area) return;
    const { path, moves } = alignSubpaths(target.path, edge, area), move = uniformMove(moves);
    if (moves.every(([dx, dy]) => !dx && !dy)) return;
    // A move keeps a live shape's parameters; rewriting the path would drop them.
    if (move) edit({ move }, "path.transform", { translateX: move[0], translateY: move[1] }); else edit({ path }, "path.set", { path });
  };
  const subpaths = target?.path.subpaths ?? [], op = subpaths[1]?.op, componentOp: ComponentOp = COMPONENT_OPS.includes(op as ComponentOp) ? op as ComponentOp : "combine";
  const changeComponentOp = (next: ComponentOp) => edit({ op: next }, "path.set", { path: { ...target!.path, subpaths: subpaths.map((subpath, index) => index ? { ...subpath, op: next } : subpath) } });
  const styleFields = select
    ? <ShapeStyleFields style={layerStyle ?? o.shapeStyle} foreground={foreground} background={background} patterns={patterns} disabled={busy || !layerStyle || shapeLayer === null}
      change={patch => { if (!layerStyle || shapeLayer === null) return; setLayerStyle({ ...layerStyle, ...patch }); run("shape.edit", { layer: shapeLayer, ...shapeEditParams(layerStyle, patch, foregroundValue) }); }}/>
    : <ShapeStyleFields style={withPatterns(o.shapeStyle, patterns)} foreground={foreground} background={background} patterns={patterns} change={patch => setOption("shapeStyle", style => ({ ...withPatterns(style, patterns), ...patch }))}/>;
  const size = <SizeFields size={bounds ?? null} linked={o.sizeLinked} disabled={busy} toggleLink={() => setOption("sizeLinked", linked => !linked)} commit={resize}/>;
  return <>
    {select && <SelectScopeSelect value={o.selectScope} change={value => setOption("selectScope", value)}/>}
    {kind === "shape" && <VectorModeSelect pixels value={o.shapeMode} change={value => setOption("shapeMode", value)}/>}
    {mode === "pixels" && <PixelFields options={o} opaque={opaque} change={setOption}/>}
    {kind === "pen" && <VectorModeSelect label="Pen mode" value={o.penMode} change={value => setOption("penMode", value)}/>}
    {(mode === "path" || select) && <MakeButtons mask={make.mask} shape={make.shape} disabled={make.disabled} make={make.run}/>}
    {(mode === "shape" || select) && <>{styleFields}{size}</>}
    {select ? <ComponentOpSelect value={componentOp} disabled={busy || subpaths.length < 2} change={changeComponentOp} merge={shapeLayer !== null ? merge : undefined}/> : mode !== "pixels" && <PathOpSelect value={o.pathOp} change={value => setOption("pathOp", value)} merge={merge}/>}
    <PathAlignMenu value={o.alignTo} disabled={busy || !target} edgesDisabled={o.alignTo === "selection" && subpaths.length < 2} align={align} alignTo={value => setOption("alignTo", value)}/>
    {["shape.rect", "shape.ellipse", "shape.triangle", "shape.polygon"].includes(tool) && <ShapeGear ellipse={tool === "shape.ellipse"} constraint={o.constraint} change={constraint => setOption("constraint", constraint)}/>}
    {tool === "shape.rect" && <CornerRadiusFields radii={o.radii} linked={o.radiiLinked} toggleLink={() => setOption("radiiLinked", linked => !linked)} change={radii => setOption("radii", radii)}/>}
    {(tool === "shape.triangle" || tool === "shape.polygon") && <><span className="xd-ps-label">Radius:</span><CommitNumber label="Polygon corner radius" title="Set radius of rounded corners" value={o.polygonRadius} min={VECTOR_RANGES.radius[0]} max={VECTOR_RANGES.radius[1]} unit="px" commit={value => setOption("polygonRadius", value)}/></>}
    {tool === "shape.polygon" && <><label>Sides<input aria-label="Number of sides" className="xd-ps-number" type="number" min="3" max="100" value={o.polygonSides} onChange={event => setOption("polygonSides", Math.max(3, Math.min(100, Math.round(event.target.valueAsNumber) || 3)))}/></label><label>Star Ratio<input aria-label="Star ratio" className="xd-ps-number" type="number" min="1" max="100" value={o.starRatio} onChange={event => setOption("starRatio", Math.max(1, Math.min(100, Math.round(event.target.valueAsNumber) || 100)))}/><span>%</span></label></>}
    {tool === "shape.line" && <LineGear options={o} change={setOption}/>}
    {tool === "shape.line" && <label>Weight<input aria-label="Line weight" type="number" min="1" max="1000" value={o.lineWeight} onChange={event => setOption("lineWeight", Math.max(1, Math.min(1000, event.target.valueAsNumber || 1)))}/><span>px</span></label>}
    {tool === "pen" && <PenFields options={o} change={setOption}/>}
    {tool === "pen.freeform" && <FreeformFields options={o} change={setOption}/>}
  </>;
}
