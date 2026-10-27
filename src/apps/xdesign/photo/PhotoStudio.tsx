import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowLeftRight, RotateCcw, SquareDashed, Undo2, Redo2, Plus, Trash2, Eye, EyeOff, Layers, ZoomIn, ZoomOut, Search, SlidersHorizontal, Lock, Link2, CornerLeftDown, House, ChevronDown, ChevronRight, ChevronsRight, X, History as HistoryIcon, Compass, Brush, Sparkles, Shapes, Bookmark, Grid2x2, Move, Contrast, Folder, Menu, Info as InfoIcon, SunMedium, ChartColumn, ChartSpline, Diff, Triangle, Palette, Scale, Camera, Blend, Grid3x3, SquareSplitVertical, ChartNoAxesColumnIncreasing, Mountain, Rainbow, Target, Type, Box, Maximize, Pilcrow, Ruler, StickyNote, Ban, Check, type LucideIcon } from "lucide-react";
import { pencilPhotoDocumentId, usePencilWorkspace } from "../pencil/runtime";
import { useXDesign } from "../store";
import { toast } from "@/store/toastStore";
import { editsText } from "@/lib/pageMenuGuard";
import { ADJUSTMENTS, BLEND_MODES, FILTERS, type PhotoAction } from "./controls";
import { blendOptions } from "./blendOptions";
import { AlignSection, MaskSection, TransformSection } from "./LayerProperties";
import { DocumentProperties } from "./DocumentProperties";
import { AdjustmentProperties, addAdjustmentLayer } from "./AdjustmentProperties";
import { CanvasDraftPreview, layerPropsDraft, type CanvasDraft, type LayerPropsDraft } from "./CanvasDraftPreview";
import { usePhotoWorkspace, controlsLocked, refreshImage, runPhotoCommand, setPhotoColors, makeImageIndependent, exportImage, openSmartContents, finishSmartContents, stepSmartContentsHistory, selectHistoryBrushSource, placeImageBlob, holdImageGesture, createImageFromClipboard } from "./runtime";
import { docTabDetail } from "./docTab";
import { catchPaste, clipboardImage } from "../pasteCatcher";
import { useXDProjects } from "../projectsStore";
import type { LayerColor, PhotoCloneSource, PhotoCloneSources, PhotoDocument, PhotoEffect, PhotoLayer, PhotoState } from "./types";
import "./photo.css";
import "./photoshop.css";
import { EditorToolRail, InspectorSection, PanelResize, useEditorPanels } from "../EditorChrome";
import { ContextMenu, MenuBar, MenuButton } from "../EditorMenus";
import { Settings2 as GearIcon, Layers2, Sheet, CaseSensitive, SquarePilcrow, ListVideo, Stamp, Omega, Ellipsis } from "lucide-react";
import { findShortcut, type MenuEntry, type MenuItem, type MenuSpec } from "../menuModel";
import { IMAGE_TOOL_GROUPS } from "../editorTools";
import { PhotoCommandBrowser } from "./CommandBrowser";
import { DuplicateImageDialog, ImageCommandDialog, ImageExportDialog, ImageSizeDialog, ImageTextDialog, ImageTrimDialog, NewSnapshotDialog } from "./ImageDialogs";
import { LAYER_COLORS, NewLayerDialog, copyName, nextLayerName, type NewLayerRequest } from "./NewLayerDialog";
import { DuplicateLayerDialog } from "./DuplicateLayerDialog";
import { ADD_FRAME, ARTBOARD_FROM_GROUP, ARTBOARD_FROM_LAYERS, BITMAP, COLOR_DECONTAMINATE, CONTENT_AWARE_SCALE, contentAwareFillCommand, DEFRINGE, FADE, fillCommand, FLAME, GLOBAL_LIGHT, HDR_TONING, INDEXED_COLOR, MEASUREMENT_SCALE, matchColorCommand, NEW_ARTBOARD, PICTURE_FRAME, REPLACE_COLOR, ROTATE_CANVAS, SCALE_EFFECTS, SCALE_MARKER, SELECTION_MODIFY, SHADOWS_HIGHLIGHTS, STROKE, TRAP, TREE, type ImageCommand } from "./imageCommands";
import { ColorTableDialog, DuotoneDialog } from "./ModeDialogs";
import { AutoAlignDialog, AutoBlendDialog, CheckSpellingDialog, FindReplaceTextDialog, PresetManagerDialog, PresetNameDialog, PurgeDialog, type PresetKind, type PurgeCommand } from "./EditDialogs";
import { ArtboardsToPdfDialog, ColorLookupDialog, ConditionalModeDialog, FileInfoDialog, FitImageDialog, LayersToFilesDialog, PathsToIllustratorDialog } from "./FileDialogs";
import { MergeToHdrDialog, PhotomergeDialog } from "./MergeDialogs";
import { SaveSelectionDialog } from "./SaveSelectionDialog";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { PhotoChannels, channelsPanelMenu, channelSlots } from "./PhotoChannels";
import { LayerEffects } from "./LayerEffects";
import { LayerStyleDialog, LAYER_STYLE_EFFECTS, type LayerStylePane } from "./LayerStyleDialog";
import { SmartFilters } from "./SmartFilters";
import { BrushPanel, BrushSettingsPanel } from "./BrushPanel";
import { ShortcutsMenusDialog, ToolbarDialog, type ShortcutsTab } from "./CustomizeDialogs";
import { customizeMenus, toolbarGroups, useCustomization } from "./customization";
import { GlyphsPanel } from "./GlyphsPanel";
import { useShell } from "@/shell/store/useShell";
import { DevelopDialog } from "./DevelopDialog";
import { GradientPresetsPanel, StylePresetsPanel, gradientPaintParams } from "./PresetPanels";
import { PatternPresetsPanel, ShapePresetsPanel, ToolPresetsPanel, toolPresetName, type ToolPresetSelection } from "./AdditionalPresets";
import { ChannelOptionsDialog } from "./ChannelOptionsDialog";
import { GeometryDialog, type GeometryKind } from "./GeometryDialog";
import { useWarpSession, warpMenuItems, WARP_TURNS } from "./warpSession";
import { PerspectiveCropDialog, type CropQuad } from "./PerspectiveCropDialog";
import { MagneticLassoOverlay } from "./MagneticLassoOverlay";
import { imageEditTarget, useImageViewPreview } from "./imageView";
import { PhotoTiles } from "./PhotoTiles";
import { NativeStrokePreview, strokeSeed, type StrokePreviewRequest } from "./strokePreview";
import { TileSurface, parseStrokePixels } from "./strokeCanvas";
import { previewCoversScreen, tileScale } from "./tiles";
import { PreviewSurface } from "./previewSurface";
import { startRowDrag } from "./rowDrag";
import { beginXDesignActivity } from "../runtimeActivity";
import { GradientFillDialog } from "./GradientFillDialog";
import { ImageTypographyPanel, rangeStyle } from "./ImageTypographyPanel";
import { PhotoActionDialog } from "./PhotoActionDialog";
import { ChannelCompositeDialog, type ChannelCompositeKind } from "./ChannelCompositeDialog";
import { ChannelMergeDialog } from "./ChannelMergeDialog";
import { ImageTransformOverlay } from "./ImageTransformOverlay";
import { MoveDragPreview, type MoveDragUpdate } from "./MoveDragPreview";
import { FreeTransformBar } from "./FreeTransformBar";
import { beginFreeTransform, cancelFreeTransform, useFreeTransform, type TransformMode } from "./freeTransform";
import { BrushPresetPicker, GradientTypeIcons, PopupSlider, SelectionModeCluster } from "./OptionsBarControls";
import { PaintToolOptions, PAINT_TOOL_FIELDS, NATIVE_STROKE_TOOLS, RETOUCH_PREVIEW_TOOLS, CONTINUOUS_RETOUCH_TOOLS, brushOptionBasis, paintToolDefaults, rebaseBrushOptions, sanitizePaintOptions, strokeParameters, type PaintOptions } from "./PaintToolOptions";
import { cloneOverlayTransform, cloneSourcePoint } from "./cloneSourceGeometry";
import { usePaintToolPreferences } from "./paintToolPreferences";
import { nativePaintColor, paintColorHex, paintColorRGBA } from "./imageColors";
import { isDesignDialogOpen } from "../useDesignDialog";
import { historyBrushSource } from "./HistoryBrushSource";
import { ImagePlaceDialog } from "./ImagePlaceDialog";
import { constrain, snap45, type Axis, type XY as StrokeXY } from "./strokeConstraint";
import { LINE_SELECTION_TOOLS, RECTANGLE_TOOLS, SELECTION_TOOLS, gestureRectangle, lineSelection, polygonPoint, selectionGestureCommand, selectionGestureMode, type GestureModifiers } from "./selectionGesture";
import { polygonPoints, polygonRect } from "./polygonShape";
import { SelectionDialog } from "./SelectionDialog";
import { ColorRangeDialog } from "./ColorRangeDialog";
import { ColorSettingsDialog } from "./ColorSettingsDialog";
import { PreferencesDialog, type PreferencesSection } from "./PreferencesDialog";
import { PASTEBOARD_COLORS, RULER_UNITS, currentPreferences, pasteboardFill, savePreferences, usePreferences, type Pasteboard } from "./preferences";
import { ColorProfileDialog, type ColorProfileWorkflow } from "./ColorProfileDialog";
import type { SelectionWorkflow } from "./selectionSettings";
import { patchOffset, patchOffsetFitsCanvas, patchTarget } from "./patchGesture";
import { BACKGROUND_ERASER_COMMIT_SAMPLES, backgroundEraserCommitAllowed, backgroundEraserPreviewAllowed, backgroundEraserPreviewSampleAllowed, eraserTargetProblem, magicEraserParams, sameEraserGesture, type EraserGestureContext, type EraserTargetState } from "./eraserGesture";
import { historyActions, PhotoHistory } from "./PhotoHistory";
import { PhotoPaths, pathsPanelMenu, selectedPath, usePathTargets } from "./PhotoPaths";
import { InfoPanel, useInfoCursor } from "./InfoPanel";
import { useColorSamplers, useDocumentSamplers } from "./colorSamplers";
import { ANALYSIS_TOOLS, AnalysisDialogs, AnalysisOptions, AnalysisOverlay, NotesPanel, findSlice } from "./AnalysisTools";
import { useAnalysisTool } from "./analysisTool";
import { HistogramPanel } from "./HistogramPanel";
import { CharacterPanel } from "./CharacterPanel";
import { LayerCompDialogs, LayerCompsPanel, layerCompsPanelMenu, useLayerComps } from "./LayerCompsPanel";
import { ActionsDialogs, ActionsPanel, actionsPanelMenu } from "./ActionsPanel";
import { useActions } from "./actions";
import { DataPointsDialog, MeasurementLogPanel, measurementLogPanelMenu, useMeasurementLog } from "./MeasurementLogPanel";
import { TypeStyleDialogs, TypeStylesPanel, typeStylesPanelMenu, useTypeStyles } from "./TypeStylesPanel";
import { ParagraphPanel } from "./ParagraphPanel";
import { CROP_GUIDES, CROP_OVERLAY_SHOWS, CropOverlay, cropAddedCanvas, type CropBox, type CropGuide, type CropOverlayShow } from "./CropOverlay";
import { ContextualTaskBar, TASK_BAR_HOME, type TaskBarPlace } from "./ContextualTaskBar";
import { penKnots, simplifyPath, smoothHandles, type XY } from "./penPath";
import { PhotoNavigator, type NavigatorView } from "./PhotoNavigator";
import { applyCropPreset, matchingCropPreset, useCropPresets } from "./CropPresets";
import { TypeBar, ShapeStyleFields, PathOpSelect, DistributeMenu, GradientToolPick, typeStyleParams, shapeStyleParams, CropRatioFields, CropRatioSelect, PerspectiveCropBar, cropResolution, CropFillField, CROP_SIZES, cropSizeChoice, cropSizeName, cropSizePixels, BrushBarItems, BrushSettingsToggle, BRUSH_BAR_ITEMS, type BrushBarSettings, type CropSizeValues, type ShapeStyle, type PathOp, type TypeBarProps, type TypeStyle, type TypeAlign } from "./toolBars";
import { PhotoTextGeometryDialog } from "./PhotoTextGeometryDialog";
import { CanvasTextEditor, findTextLayer, lastTextCaret, type CanvasText } from "./CanvasTextEditor";
import { useFontFamilies } from "./fontFamilies";
import { PathEditOverlay, TargetPathOverlay, type PathData } from "./PathEditOverlay";
import { addImageSwatch, PhotoSwatches } from "./PhotoSwatches";
import { ColorPanel, colorPanelMenu, type ColorPanelMode } from "./ColorPanel";
import { ColorPickerDialog } from "./ColorPickerDialog";
import { grayHex, sampleImageColor, sampleLayerColor } from "./eyedropper";
import { SamplingRing } from "./SamplingRing";
import { GRADIENT_METHODS, bakeRemembered, type GradientMethod, type GradientStop } from "./gradientMethod";
import { GuideDialogs, ViewAids } from "./viewAids";
import { SNAP_PX, boxTargets, documentGuides, guideInside, guidesVisible, layerEdgesVisible, pixelGridVisible, selectionEdgesVisible, shapeGuides, snapMove, targetPathVisible, snapBox, snapContext, snapXY, useViewAids, type MoveSnap } from "./viewGuides";
import { NO_TURN, surfaceClient, surfaceFraction, surfaceOffset, surfaceSize, turnTransform, turnedSize, useViewTurn, visibleArea, type ViewTurn } from "./viewTurn";

type Point = [number, number, number, number, number, number, number];
type HeldSample={clientX:number;clientY:number;pressure:number;pointerType:string;tiltX:number;tiltY:number;twist:number;timeStamp:number;shiftKey:boolean;altKey:boolean;metaKey:boolean;ctrlKey:boolean};
type HeldStroke={pointerId:number;tool:string;down:HeldSample;moves:HeldSample[];up:HeldSample|null;until:number};
const heldSample=(e:HeldSample):HeldSample=>({clientX:e.clientX,clientY:e.clientY,pressure:e.pressure,pointerType:e.pointerType,tiltX:e.tiltX,tiltY:e.tiltY,twist:e.twist,timeStamp:e.timeStamp,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,ctrlKey:e.ctrlKey});
type PatchDrag = {pointerId:number;start:[number,number];current:[number,number];projectId:string;photoId:string;version:string;viewKey:string;mode:"source"|"destination";target:Record<string,unknown>;bounds:[number,number,number,number]|null};
type PanDrag = {pointerId:number;x:number;y:number;left:number;top:number;spin?:{cx:number;cy:number;from:number;angle:number}};
type StrokeGesture = {feedback:NativeStrokePreview;space:PreviewSurface|TileSurface|null;end:(()=>void)|null};
const IMAGE_TOOLS=IMAGE_TOOL_GROUPS.flatMap(group=>group.tools);
// One 28px row per tool group plus the colour chips, Quick Mask and Screen Mode foot; below this height the toolbar folds into two columns like Photoshop's.
const TOOLBAR_HEIGHT=IMAGE_TOOL_GROUPS.length*29+150;
const UPPER_PANELS=["Color","Swatches","Gradients","Patterns"] as const,MIDDLE_PANELS=["Properties","Adjustments"] as const,LAYER_PANELS=["Layers","Channels","Paths"] as const;
const STRIP_PANELS=[{name:"History",icon:HistoryIcon},{name:"Navigator",icon:Compass},{name:"Info",icon:InfoIcon},{name:"Notes",icon:StickyNote},{name:"Brush Settings",icon:GearIcon},{name:"Brushes",icon:Brush},{name:"Clone Source",icon:Stamp},{name:"Styles",icon:Sparkles},{name:"Shapes",icon:Shapes},{name:"Tool Presets",icon:Bookmark},{name:"Histogram",icon:ChartColumn},{name:"Character",icon:Type},{name:"Paragraph",icon:Pilcrow},{name:"Character Styles",icon:CaseSensitive},{name:"Paragraph Styles",icon:SquarePilcrow},{name:"Glyphs",icon:Omega},{name:"Layer Comps",icon:Layers2},{name:"Measurement Log",icon:Sheet},{name:"Actions",icon:ListVideo}] as const;
type UpperPanel=typeof UPPER_PANELS[number];type MiddlePanel=typeof MIDDLE_PANELS[number];type LayersPanel=typeof LAYER_PANELS[number];type StripPanel=typeof STRIP_PANELS[number]["name"];type PanelName=UpperPanel|MiddlePanel|LayersPanel|StripPanel;
const ALL_PANELS:PanelName[]=[...UPPER_PANELS,...MIDDLE_PANELS,...LAYER_PANELS,...STRIP_PANELS.map(panel=>panel.name)].sort();
const CLIPBOARD_COMMANDS:Partial<Record<string,string>>={Cut:"edit.cut",Copy:"edit.copy","Copy Merged":"edit.copyMerged",Paste:"edit.paste","Paste in Place":"edit.pasteSpecial.pasteInPlace"};
const PANEL_KEYS:Partial<Record<PanelName,string>>={"Brush Settings":"F5",Color:"F6",Layers:"F7",Info:"F8",Actions:"Alt+F9"};
const ADJUSTMENT_ORDER=["brightnessContrast","levels","curves","exposure","-","vibrance","hueSaturation","colorBalance","blackWhite","photoFilter","channelMixer","colorLookup","-","invert","posterize","threshold","gradientMap","selectiveColor"] as const;
const ADJUSTMENT_ROWS=ADJUSTMENT_ORDER.join(" ").split(" - ").map(row=>row.split(" "));
const ADJUSTMENT_ICONS:Record<string,LucideIcon>={brightnessContrast:SunMedium,levels:ChartColumn,curves:ChartSpline,exposure:Diff,vibrance:Triangle,hueSaturation:Palette,colorBalance:Scale,blackWhite:Contrast,photoFilter:Camera,channelMixer:Blend,colorLookup:Grid3x3,invert:SquareSplitVertical,posterize:ChartNoAxesColumnIncreasing,threshold:Mountain,gradientMap:Rainbow,selectiveColor:Target};
const ADJUSTMENT_SHORTCUTS:Record<string,string>={levels:"Mod+L",curves:"Mod+M",hueSaturation:"Mod+U",colorBalance:"Mod+B",blackWhite:"Alt+Shift+Mod+B"};
const ALIGN_BUTTONS=[["topEdges","Align top edges",AlignStartHorizontal],["verticalCenters","Align vertical centers",AlignCenterHorizontal],["bottomEdges","Align bottom edges",AlignEndHorizontal],["leftEdges","Align left edges",AlignStartVertical],["horizontalCenters","Align horizontal centers",AlignCenterVertical],["rightEdges","Align right edges",AlignEndVertical]] as const;
function ClearSamplers({documentId}:{documentId:string}) {
  const count=useDocumentSamplers(documentId).length;
  return <button aria-label="Clear all color samplers" disabled={!count} onClick={()=>useColorSamplers.getState().clear(documentId)}>Clear All</button>;
}
const SAMPLE_SIZES=[[1,"Point Sample"],[3,"3 by 3 Average"],[5,"5 by 5 Average"],[11,"11 by 11 Average"],[31,"31 by 31 Average"],[51,"51 by 51 Average"],[101,"101 by 101 Average"]] as const;
const ALIGN_EDGES=[["topEdges","Top Edges"],["verticalCenters","Vertical Centers"],["bottomEdges","Bottom Edges"],"-",["leftEdges","Left Edges"],["horizontalCenters","Horizontal Centers"],["rightEdges","Right Edges"]] as const;
const MODIFY_ORDER=["select.modify.border","select.modify.smooth","select.modify.expand","select.modify.contract","select.modify.feather"];
const FILTER_MENU=["Blur","Blur Gallery","Distort","Noise","Pixelate","Render","Sharpen","Stylize","Video","Other"];
const STACK_MODES=[["none","None"],["entropy","Entropy"],["kurtosis","Kurtosis"],["maximum","Maximum"],["mean","Mean"],["median","Median"],["minimum","Minimum"],["range","Range"],["skewness","Skewness"],["standardDeviation","Standard Deviation"],["summation","Summation"],["variance","Variance"]] as const;
const OPEN_TYPE=[["standardLigatures","Standard Ligatures"],["contextualAlternates","Contextual Alternates"],["discretionaryLigatures","Discretionary Ligatures"],["swash","Swash"],["oldstyle","Oldstyle"],["stylisticAlternates","Stylistic Alternates"],["titlingAlternates","Titling Alternates"],["ornaments","Ornaments"],["ordinals","Ordinals"],["fractions","Fractions"]] as const;
const PROOF_PRESETS=[["workingCyanPlate","Working Cyan Plate"],["workingMagentaPlate","Working Magenta Plate"],["workingYellowPlate","Working Yellow Plate"],["workingBlackPlate","Working Black Plate"],["workingCmyPlate","Working CMY Plates"],["legacyMacintoshRgb","Legacy Macintosh RGB (Gamma 1.8)"],["colorBlindnessProtanopia","Color Blindness - Protanopia-type"],["colorBlindnessDeuteranopia","Color Blindness - Deuteranopia-type"]] as const;
const LENS_FILTER_IDS=["filter.lensCorrection","filter.adaptiveWideAngle"];
const STRIP_WIDTH=36;
// Photoshop's Adjustments panel: its three rows of icons, with the hovered or focused one named in the caption.
function AdjustmentsPanel({disabled,add}:{disabled:boolean;add:(action:PhotoAction)=>void}) {
  const [named,setNamed]=useState<string|null>(null);
  return <div className="xd-ps-pad xd-photo-adjustments"><p>{named??"Add an adjustment"}</p>{ADJUSTMENT_ROWS.map((row,index)=><div key={index}>{row.map(id=>{
    const action=ADJUSTMENTS.find(entry=>entry.id===id)!,label=action.label.replace(" / ","/"),Icon=ADJUSTMENT_ICONS[id]!;
    return <button key={id} aria-label={label} title={label} disabled={disabled} onPointerEnter={()=>setNamed(label)} onPointerLeave={()=>setNamed(null)} onFocus={()=>setNamed(label)} onBlur={()=>setNamed(null)} onClick={()=>add(action)}><Icon size={16}/></button>;
  })}</div>)}</div>;
}
function PanelTabs({label,tabs,active,collapsed,inert,menu,select,toggle}:{label:string;tabs:readonly PanelName[];active:PanelName;collapsed:boolean;inert?:boolean;menu?:MenuEntry[];select:(tab:PanelName)=>void;toggle:()=>void}) {
  return <div className="xd-ps-tabs" role="tablist" aria-label={label} inert={inert} onDoubleClick={event=>{const target=event.target as HTMLElement;if(!target.closest("button")||target.closest("[aria-selected=true]"))toggle();}}>
    {tabs.map(tab=><button key={tab} type="button" role="tab" aria-selected={tab===active} onClick={()=>select(tab)}><span>{tab}</span></button>)}
    <span className="xd-ps-spacer"/>
    {menu&&<MenuButton label={`${active} panel options`} icon={Menu} iconOnly align="end" className="xd-ps-panel-menu" items={menu}/>}
    <button type="button" className="xd-ps-collapse" aria-label={`${collapsed?"Expand":"Collapse"} ${label}`} title={collapsed?"Expand panel group":"Collapse panel group"} aria-expanded={!collapsed} onClick={toggle}><ChevronDown size={11}/></button>
  </div>;
}
const SHAPE_TOOLS=["shape.rect","shape.ellipse","shape.triangle","shape.polygon","shape.line"],POLYGON_TOOLS=["shape.triangle","shape.polygon"];
const SCREEN_MODES=["Standard Screen Mode","Full Screen Mode With Menu Bar","Full Screen Mode"];
/** Photoshop's default Screen Resolution (Preferences › Units & Rulers), which View › Print Size scales by. */
// Photoshop's crop context menu lists these after Original Ratio.
const CROP_RATIOS:[string,number,number][]=[["1 : 1 (Square)",1,1],["4 : 5 (8 : 10)",4,5],["5 : 7",5,7],["2 : 3 (4 : 6)",2,3],["16 : 9",16,9]];
const PEN_TOOLS=["pen","pen.freeform","pen.curvature"],PEN_DRAFT_TOOLS=["pen","pen.curvature"],PATH_SELECT_TOOLS=["path.select","path.direct"];
// Photoshop's Command key springs to the Move tool from every tool but these.
const NO_SPRING_MOVE=["move","hand","rotateView","zoom","text","crop","perspectiveCrop","straighten","magneticLasso",...SHAPE_TOOLS,...PEN_TOOLS,...PATH_SELECT_TOOLS];
const SAMPLING_TOOLS=["paint.stroke","paint.pencil","paint.mixerBrush","paint.colorReplacement","paint.gradient","paint.bucket"];
// Photoshop's bracket steps grow with the brush, so large brushes resize in a few presses.
const BRUSH_STEPS=[[10,1],[100,10],[200,25],[300,50],[1000,100],[2500,250],[Infinity,500]] as const;
const stepBrushSize=(size:number,up:boolean,max:number)=>{const step=BRUSH_STEPS.find(([limit])=>up?size<limit:size<=limit)![1];return Math.max(1,Math.min(max,up?Math.floor(size/step)*step+step:Math.ceil(size/step)*step-step));};


const attempt = (work: Promise<unknown>) => { void work.catch(() => {}); };
// Photoshop's standard cursors: the tool's icon where it has one, otherwise the crosshair.
const TOOL_CURSORS: Record<string, string> = { move: "xd-photo-arrow", "path.select": "xd-photo-arrow", "path.direct": "xd-photo-arrow", text: "xd-photo-text", eyedropper: "xd-photo-eyedropper", "paint.bucket": "xd-photo-bucket", "select.lasso": "xd-photo-lasso", "select.magicWand": "xd-photo-wand", polygonLasso: "xd-photo-polygon-lasso", crop: "xd-photo-crop-cursor", "pen.freeform": "xd-photo-pen-freeform" };
// Caps Lock swaps every other tool's cursor, and the brush outline, for Photoshop's precise crosshair.
const STANDARD_CURSOR_TOOLS = ["move", "path.select", "path.direct", "text", "hand", "rotateView", "zoom"];

function CloneSourceValue({label,value,min,max,valid,context,disabled,commit,pending}:{label:string;value:number;min:number;max:number;valid:(value:number)=>boolean;context:string;disabled:boolean;commit:(context:string,value:number)=>void;pending:(context:string,value:number|null)=>void}) {
  const [draft,setDraft]=useState(String(value)),editing=useRef<string|null>(null),dirty=useRef(false);
  useEffect(()=>{editing.current=null;dirty.current=false;setDraft(String(value));},[value,context,disabled]);
  const finish=()=>{const captured=editing.current,changed=dirty.current;editing.current=null;dirty.current=false;pending(context,null);const next=draft.trim()===""?NaN:Number(draft);if(changed&&!disabled&&captured===context&&Number.isFinite(next)&&valid(next))commit(captured,next);else setDraft(String(value));};
  return <label>{label}<input aria-label={label} type="number" step="any" min={min} max={max} disabled={disabled} value={draft} onFocus={()=>{editing.current=context;dirty.current=false;pending(context,null);}} onChange={event=>{if(disabled)return;editing.current??=context;dirty.current=true;const text=event.target.value,next=text.trim()===""?NaN:Number(text);setDraft(text);pending(context,Number.isFinite(next)&&valid(next)?next:null);}} onBlur={event=>{if((event.relatedTarget as HTMLElement|null)?.dataset.cloneSourceReset){editing.current=null;dirty.current=false;pending(context,null);setDraft(String(value));}else finish();}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();finish();event.currentTarget.blur();}}}/></label>;
}

const OVERLAY_BLENDS=[["normal","Normal"],["darken","Darken"],["lighten","Lighten"],["difference","Difference"]] as const;
function CloneOverlaySettings({overlay,context,disabled,commit}:{overlay:PhotoCloneSources["overlay"];context:string;disabled:boolean;commit:(params:Record<string,unknown>)=>void}) {
  const check=(label:string,text:string,key:string,checked:boolean)=><label><input type="checkbox" aria-label={label} disabled={disabled} checked={checked} onChange={event=>commit({[key]:event.target.checked})}/>{text}</label>;
  return <fieldset className="xd-photo-clone-overlay" disabled={disabled}><legend>Overlay</legend>
    {check("Show Overlay","Show Overlay","show",overlay.show)}
    <CloneSourceValue label="Overlay opacity" value={overlay.opacity} min={0} max={100} valid={value=>value>=0&&value<=100} context={context} disabled={disabled} commit={(_,opacity)=>commit({opacity})} pending={()=>{}}/>
    <label>Overlay blend mode<select aria-label="Overlay blend mode" disabled={disabled} value={overlay.blend} onChange={event=>commit({blend:event.target.value})}>{OVERLAY_BLENDS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
    {check("Auto Hide","Auto Hide","autoHide",overlay.auto_hide)}{check("Clipped","Clipped","clipped",overlay.clipped)}{check("Invert overlay","Invert","invert",overlay.invert)}
  </fieldset>;
}

function CloneSourceSettings({slot,context,disabled,commit,reset}:{slot:PhotoCloneSource|undefined;context:string;disabled:boolean;commit:(context:string,params:Record<string,unknown>)=>void;reset:(context:string)=>void}) {
  const offset=slot?.offset??[0,0],values:[string,string]=[String(offset[0]),String(offset[1])];
  const [draft,setDraft]=useState<[string,string]>(values),editing=useRef<string|null>(null),dirty=useRef(false),pending=useRef<{context:string;params:Record<string,unknown>}|null>(null);
  useEffect(()=>{editing.current=null;dirty.current=false;pending.current=null;setDraft(values);},[context,disabled]);
  const finish=()=>{
    const captured=editing.current,changed=dirty.current;editing.current=null;dirty.current=false;pending.current=null;
    const pair:[number,number]=[Number(draft[0]),Number(draft[1])];
    if(changed&&!disabled&&captured===context&&draft.every(value=>value.trim()!=="")&&pair.every(Number.isFinite))commit(captured,{offset:pair});
    else setDraft(values);
  };
  return <><p className="xd-photo-section-help">Saved source transform applies to this source slot. Tool transform overrides it when enabled. Sources sample the current image.</p>{(["X","Y"] as const).map((axis,index)=><label key={axis}>Offset {axis} (px)<input aria-label={`Clone source offset ${axis}`} type="number" step="any" disabled={disabled} value={draft[index]} onFocus={()=>{editing.current=context;dirty.current=false;pending.current=null;}} onChange={event=>{if(disabled)return;editing.current??=context;dirty.current=true;const value=event.target.value,next:[string,string]=index===0?[value,draft[1]]:[draft[0],value],pair=next.map(Number);setDraft(next);pending.current=next.every(value=>value.trim()!=="")&&pair.every(Number.isFinite)?{context,params:{offset:pair}}:null;}} onBlur={event=>{if((event.relatedTarget as HTMLElement|null)?.dataset.cloneSourceReset){editing.current=null;dirty.current=false;pending.current=null;setDraft(values);}else finish();}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();finish();event.currentTarget.blur();}}}/></label>)}{(["width","height","rotation"] as const).map(key=><CloneSourceValue key={key} label={`Saved source ${key}${key==="rotation"?" (°)":" (%)"}`} value={slot?.[key]??(key==="rotation"?0:100)} min={key==="rotation"?-180:-1000} max={key==="rotation"?180:1000} valid={value=>key==="rotation"?value>=-180&&value<=180:Math.abs(value)>=1&&Math.abs(value)<=1000} context={context} disabled={disabled} commit={(captured,value)=>commit(captured,{[key]:value})} pending={(captured,value)=>{pending.current=value===null?null:{context:captured,params:{[key]:value}};}}/>)}{(["flipH","flipV"] as const).map(key=><label key={key} onMouseDown={event=>event.preventDefault()}><input aria-label={`Saved source flip ${key==="flipH"?"H":"V"}`} type="checkbox" disabled={disabled} checked={slot?.[key]??false} onChange={event=>{const patch=pending.current?.context===context?pending.current.params:{};pending.current=null;commit(context,{...patch,[key]:event.target.checked});}}/>Saved source flip {key==="flipH"?"H":"V"}</label>)}<button data-clone-source-reset="true" disabled={disabled} onClick={()=>{editing.current=null;dirty.current=false;pending.current=null;setDraft(values);reset(context);}}>Reset saved-slot transform</button></>;
}

const isBackgroundLayer=(layer:PhotoLayer)=>layer.name==="Background"&&!!layer.locks?.transparency;
function layerSiblings(layers:PhotoLayer[],id:number,parent:PhotoLayer|null=null):{siblings:PhotoLayer[];index:number;parent:PhotoLayer|null}|undefined {
  const index=layers.findIndex(layer=>layer.id===id);
  if(index>=0)return {siblings:layers,index,parent};
  for(const layer of layers){const found=layer.children&&layerSiblings(layer.children,id,layer);if(found)return found;}
}
// Photoshop's Layers panel: the top or bottom half of a row drops above or below it. A group takes the
// layer from its middle, and from its bottom too once it has children, because the row under it is then
// its first child. Nothing goes below the Background, into itself, or back where it already is.
export function layerDropPosition(layers:PhotoLayer[],dragged:number,target:number,fraction:number,others:number[]=[]):"above"|"below"|"into"|null {
  const moving=findLayer(layers,dragged),layer=findLayer(layers,target),from=layerSiblings(layers,dragged);
  if(!moving||!layer||!from||moving===layer||findLayer(moving.children??[],target))return null;
  if(others.some(id=>id===target||findLayer(findLayer(layers,id)?.children??[],target)))return null;
  const position=layer.children&&fraction>=.25&&(fraction<.75||layer.children.length>0)?"into":fraction<.5||isBackgroundLayer(layer)?"above":"below";
  // With other layers moving too, landing beside the dragged one still moves them.
  if(others.length)return position;
  if(position==="into"&&from.parent===layer&&from.index===0)return null;
  if(position==="above"&&from.siblings[from.index+1]===layer)return null;
  if(position==="below"&&from.siblings[from.index-1]===layer)return null;
  return position;
}

// Photoshop lists a layer's effects in its Layer Style dialog order, whatever order they render in.
const EFFECT_ORDER=["Bevel & Emboss","Stroke","Inner Shadow","Inner Glow","Satin","Color Overlay","Gradient Overlay","Pattern Overlay","Outer Glow","Drop Shadow"];
const effectPane=(effect:PhotoEffect)=>effect.type.charAt(0).toLowerCase()+effect.type.slice(1) as LayerStylePane;
const effectEnabledPath=(effect:PhotoEffect)=>effect.type==="BevelEmboss"?["enabled"]:["common","enabled"];
type LayerFilterMode="kind"|"name"|"effect"|"mode"|"attribute"|"color"|"smartObject"|"selected"|"group";
type LayerFilter={on:boolean;mode:LayerFilterMode;kinds:string[];name:string;effect:string;blend:string;attribute:string;color:LayerColor;smart:string[]};
const LAYER_FILTER_MODES:[LayerFilterMode,string][]=[["kind","Kind"],["name","Name"],["effect","Effect"],["mode","Mode"],["attribute","Attribute"],["color","Color"],["smartObject","Smart Object"],["selected","Selected"],["group","Group"]];
// Photoshop shows each colour label's swatch beside its name in the Layers context menu.
const LABEL_SWATCHES=Object.fromEntries(LAYER_COLORS.map(([color])=>[color,({size=16}:{size?:number})=><span className="xd-photo-label-swatch" data-color={color} style={{width:size,height:size}}/>])) as Record<LayerColor,ComponentType<{size?:number}>>;
const LAYER_KIND_FILTERS=[["pixel","Filter for pixel layers",Brush],["adjustment","Filter for adjustment layers",Contrast],["type","Filter for type layers",Type],["shape","Filter for shape layers",Shapes],["smart","Filter for smart objects",Box]] as const;
const LAYER_ATTRIBUTES=["Visible","Locked","Empty","Linked","Clipped","Layer Mask","Vector Mask","Layer Effects","Advanced Blending"];
const DEFAULT_LAYER_FILTER:LayerFilter={on:true,mode:"kind",kinds:[],name:"",effect:"Drop Shadow",blend:"Normal",attribute:"Visible",color:"none",smart:[]};
const layerKind=(layer:PhotoLayer)=>layer.kind==="Adjustment"||layer.kind==="Fill"?"adjustment":layer.kind==="Type"?"type":layer.kind==="Shape"?"shape":layer.kind==="Smart Object"?"smart":layer.kind==="Pixel"?"pixel":null;
const hasAttribute=(layer:PhotoLayer,attribute:string)=>({Visible:layer.visible,Locked:!!(layer.locks?.all||layer.locks?.pixels||layer.locks?.position||layer.locks?.transparency),Empty:layer.kind==="Pixel"&&!layer.bounds,Linked:layer.linkGroup!=null,Clipped:layer.clipped,"Layer Mask":layer.hasMask,"Vector Mask":!!layer.hasVectorMask,"Layer Effects":!!layer.effects?.items.length,"Advanced Blending":!!layer.blendIf?.length||layer.fill<1} as Record<string,boolean>)[attribute]??false;
// Which filters narrow the list. Photoshop's Kind and Smart Object buttons show everything while none is pressed.
function layerFilterActive(filter:LayerFilter) {
  return filter.on&&(filter.mode==="kind"?filter.kinds.length>0:filter.mode==="smartObject"?filter.smart.length>0:filter.mode==="name"?filter.name.trim()!=="":true);
}
function layerMatches(layer:PhotoLayer,filter:LayerFilter) {
  switch(filter.mode){
    case "kind":return filter.kinds.includes(layerKind(layer)??"");
    case "name":return layer.name.toLowerCase().includes(filter.name.trim().toLowerCase());
    case "effect":return !!layer.effects?.items.some(effect=>effect.kind===filter.effect);
    case "mode":return layer.blend===filter.blend;
    case "attribute":return hasAttribute(layer,filter.attribute);
    case "color":return (layer.color??"none")===filter.color;
    case "smartObject":return !!layer.smartObject&&filter.smart.includes(layer.smartObject.source);
    case "selected":return !!layer.selected;
    case "group":return layer.kind==="Group";
  }
}
// Groups stay when any layer inside them matches, so the matches keep their place in the stack.
export function filterLayerTree(layers:PhotoLayer[],filter:LayerFilter):PhotoLayer[] {
  if(!layerFilterActive(filter))return layers;
  return layers.flatMap(layer=>{const children=layer.children&&filterLayerTree(layer.children,filter);return layerMatches(layer,filter)||children?.length?[{...layer,children}]:[];});
}
function LayerFilterRow({filter,change}:{filter:LayerFilter;change:(filter:LayerFilter)=>void}) {
  const set=(patch:Partial<LayerFilter>)=>change({...filter,...patch}),toggle=(list:string[],value:string)=>list.includes(value)?list.filter(item=>item!==value):[...list,value];
  return <div className="xd-ps-layer-filter">
    <select aria-label="Select filter type" title="Select filter type" disabled={!filter.on} value={filter.mode} onChange={event=>set({mode:event.target.value as LayerFilterMode})}>{LAYER_FILTER_MODES.map(([mode,label])=><option key={mode} value={mode}>{label}</option>)}</select>
    {filter.mode==="kind"&&LAYER_KIND_FILTERS.map(([kind,label,Icon])=><button key={kind} type="button" className="xd-ps-lock" aria-label={label} title={label} aria-pressed={filter.kinds.includes(kind)} disabled={!filter.on} onClick={()=>set({kinds:toggle(filter.kinds,kind)})}><Icon size={12}/></button>)}
    {filter.mode==="name"&&<input aria-label="Filter layers by name" title="Filter layers by name" disabled={!filter.on} value={filter.name} onChange={event=>set({name:event.target.value})} onKeyDown={event=>event.stopPropagation()}/>}
    {filter.mode==="effect"&&<select aria-label="Filter by layer effect" title="Filter by layer effect" disabled={!filter.on} value={filter.effect} onChange={event=>set({effect:event.target.value})}>{EFFECT_ORDER.map(effect=><option key={effect}>{effect}</option>)}</select>}
    {filter.mode==="mode"&&<select aria-label="Filter by blend mode" title="Filter by blend mode" disabled={!filter.on} value={filter.blend} onChange={event=>set({blend:event.target.value})}>{BLEND_MODES.map(mode=><option key={mode}>{mode}</option>)}</select>}
    {filter.mode==="attribute"&&<select aria-label="Filter by layer attribute" title="Filter by layer attribute" disabled={!filter.on} value={filter.attribute} onChange={event=>set({attribute:event.target.value})}>{LAYER_ATTRIBUTES.map(attribute=><option key={attribute}>{attribute}</option>)}</select>}
    {filter.mode==="color"&&<select aria-label="Filter by layer color" title="Filter by layer color" disabled={!filter.on} value={filter.color} onChange={event=>set({color:event.target.value as LayerColor})}>{LAYER_COLORS.map(([color,label])=><option key={color} value={color}>{color==="none"?"None":label}</option>)}</select>}
    {filter.mode==="smartObject"&&([["linked","Filter for smart objects linked locally",Link2],["embedded","Filter for embedded smart objects",Box]] as const).map(([source,label,Icon])=><button key={source} type="button" className="xd-ps-lock" aria-label={label} title={label} aria-pressed={filter.smart.includes(source)} disabled={!filter.on} onClick={()=>set({smart:toggle(filter.smart,source)})}><Icon size={12}/></button>)}
    <span className="xd-ps-spacer"/>
    <button type="button" role="switch" className="xd-ps-filter-switch" aria-label="Toggle layer filtering on/off" title="Toggle layer filtering on/off" aria-checked={filter.on} onClick={()=>set({on:!filter.on})}><span/></button>
  </div>;
}

function LayerRows({layers,active,busy,editMask,editingMask,selectPixels,menu,thumbnails,masks,openStyle,openProperties,openFill,depth=0,folds:[shown,fold]}:{layers:PhotoLayer[];active:number|null;busy:boolean;editMask:(layer:PhotoLayer,event:MouseEvent)=>void;editingMask:boolean;selectPixels:()=>void;menu:(layer:PhotoLayer,event:MouseEvent)=>void;thumbnails:Record<number,string>;masks:Record<number,string>;openStyle:(layer:PhotoLayer,pane:LayerStylePane)=>void;openProperties:()=>void;openFill:()=>void;depth?:number;folds:[Record<number,boolean>,(groups:number[],open:boolean)=>void]}) {
  const [renaming,setRenaming]=useState<number|null>(null),[folded,setFolded]=useState<number[]>([]);
  useEffect(()=>{const rename=(event:Event)=>{const id=(event as CustomEvent<number>).detail;if(layers.some(layer=>layer.id===id))setRenaming(id);};window.addEventListener("xd-photo-rename-layer",rename);return ()=>window.removeEventListener("xd-photo-rename-layer",rename);},[layers]);
  // Photoshop keeps the eye column fixed and indents what follows; a step is the chevron plus the row gap, so children line up under their group's folder.
  const indent=depth?{marginRight:depth*18}:undefined;
  const drag=(event:PointerEvent<HTMLElement>,layer:PhotoLayer)=>{
    if(busy||isBackgroundLayer(layer)||renaming===layer.id)return;
    const row=event.currentTarget.closest<HTMLElement>(".xd-photo-layer")!,tree=()=>usePhotoWorkspace.getState().state?.layers??[];
    // As in Photoshop, dragging one of several selected layers carries the whole selection.
    const selected=usePhotoWorkspace.getState().state?.selectedLayers??[];
    const others=selected.includes(layer.id)?selected.filter(id=>{const other=findLayer(tree(),id);return id!==layer.id&&!!other&&!isBackgroundLayer(other);}):[];
    startRowDrag(event,{scope:".xd-photo-layer-list",ghost:row,
      position:(target,clientY)=>{const bounds=target.getBoundingClientRect();return layerDropPosition(tree(),layer.id,Number(target.dataset.layer),(clientY-bounds.top)/bounds.height,others);},
      drop:(target,position)=>{if(controlsLocked(usePhotoWorkspace.getState()))return;const at=Number(target.dataset.layer);
        attempt(others.length?runPhotoCommand("layer.moveLayersTo",{layers:[layer.id,...others],target:at,position}):runPhotoCommand("layer.moveTo",{layer:layer.id,target:at,position}));}});
  };
  const select=(e:MouseEvent,layer:PhotoLayer)=>attempt(runPhotoCommand("layer.select",{layer:layer.id,target:"pixels",mode:e.shiftKey?"range":e.metaKey||e.ctrlKey?"toggle":"replace"}).then(selectPixels));
  const style=(layer:PhotoLayer,pane:LayerStylePane)=>{if(!busy&&!isBackgroundLayer(layer)&&!layer.children)openStyle(layer,pane);};
  return <>{layers.map((layer,at) => {
    // The list is top first, so a clipped layer's base is the next unclipped layer below it in the same group.
    const clipBase=!layer.clipped&&!!layers[at-1]?.clipped,targeted=active===layer.id,effects=[...layer.effects?.items.entries()??[]].sort(([,a],[,b])=>EFFECT_ORDER.indexOf(a.kind)-EFFECT_ORDER.indexOf(b.kind)),open=effects.length>0&&!folded.includes(layer.id),group=!!layer.children,expanded=shown[layer.id]??layer.expanded!==false,AdjustmentIcon=layer.adjustmentKind?ADJUSTMENT_ICONS[layer.adjustmentKind]:undefined;
    return <div key={layer.id}>
    <div className={`xd-photo-layer${group?" group":""}${layer.clipped?" clipped":""}${layer.selected||targeted?" selected":""}`} data-drop-target="" data-layer={layer.id} data-color={layer.color&&layer.color!=="none"?layer.color:undefined} onContextMenu={e=>{e.preventDefault();menu(layer,e);}} onDoubleClick={e=>{if(e.target===e.currentTarget)style(layer,"blending");}}>
      <button disabled={busy} className="xd-photo-layer-eye" style={indent} title={layer.visible?"Hide layer":"Show layer"} onClick={() => attempt(runPhotoCommand("layer.setProps",{layer:layer.id,visible:!layer.visible}))}>{layer.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
      {group&&<button className="xd-photo-layer-disclosure" aria-label={`${expanded?"Collapse":"Expand"} ${layer.name}`} title={`${expanded?"Collapse":"Expand"} group · Alt-click for the groups inside, Command/Ctrl-click for the groups beside it`} aria-expanded={expanded} onClick={e=>{
        // As in Photoshop: ⌘-click folds the groups beside this one as well, ⌥-click the groups inside each.
        const groups=e.metaKey||e.ctrlKey?layers.filter(other=>other.children):[layer];
        fold(e.altKey?groups.flatMap(groupIds):groups.map(other=>other.id),!expanded);}}>{expanded?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</button>}
      {layer.clipped&&<span className="xd-photo-layer-clip" role="img" aria-label="Clipped to the layer below" title="Clipped to the layer below"><CornerLeftDown size={12}/></span>}
      <button disabled={busy} tabIndex={-1} aria-hidden="true" className={`xd-photo-layer-thumb-button${group?" group":""}${targeted&&!(editingMask&&layer.hasMask)?" targeted":""}`} onPointerDown={e=>drag(e,layer)} onDragStart={e=>e.preventDefault()} onClick={e=>select(e,layer)} onDoubleClick={()=>{if(layer.smartObject&&!busy)attempt(openSmartContents(layer.id));else if(layer.adjustmentKind)openProperties();else if(layer.gradientFill)openFill();else style(layer,"blending");}}>{group?<Folder size={14}/>:thumbnails[layer.id]?<img className="xd-photo-layer-thumb" src={`data:image/png;base64,${thumbnails[layer.id]}`} alt=""/>:AdjustmentIcon?<AdjustmentIcon size={16}/>:<Layers size={13}/>}</button>
      {layer.hasMask&&<><button className="xd-photo-mask-link" disabled={busy||!layer.mask} aria-label={`${layer.mask?.linked===false?"Link":"Unlink"} mask of ${layer.name}`} title={layer.mask?.linked===false?"Link layer and mask":"Unlink layer and mask"} aria-pressed={layer.mask?.linked!==false} onClick={()=>attempt(runPhotoCommand("layer.layerMask.linked",{layer:layer.id,linked:layer.mask?.linked===false}))}>{layer.mask?.linked!==false&&<Link2 size={10}/>}</button>
        <button className={`xd-photo-mask-indicator${targeted&&editingMask?" targeted":""}${layer.mask?.enabled===false?" disabled-mask":""}`} disabled={busy} aria-label={`Edit mask of ${layer.name}`} title="Layer mask · Shift-click to disable, Alt-click to view grayscale, Shift+Alt-click for overlay" onClick={event=>editMask(layer,event)}>{masks[layer.id]?<img className="xd-photo-layer-thumb" src={`data:image/png;base64,${masks[layer.id]}`} alt=""/>:<SquareDashed size={14}/>}</button></>}
      <button disabled={busy} aria-pressed={!!layer.selected||targeted} title="Shift-click a range; Command/Ctrl-click to add; drag to reorder or onto a group to put it inside" className={`xd-photo-layer-name${renaming===layer.id?" renaming":""}${clipBase?" clip-base":""}`} onPointerDown={e=>drag(e,layer)} onDragStart={e=>e.preventDefault()} onDoubleClick={()=>{if(!busy)setRenaming(layer.id);}} onClick={e=>select(e,layer)}>{renaming===layer.id?null:<span>{layer.name}</span>}</button>
      {renaming===layer.id&&<input className="xd-photo-layer-rename" aria-label={`Rename ${layer.name}`} autoFocus maxLength={255} defaultValue={layer.name} onFocus={e=>e.currentTarget.select()}
        onBlur={e=>{setRenaming(null);const name=e.currentTarget.value.trim();if(name&&name!==layer.name)attempt(runPhotoCommand("layer.setProps",{layer:layer.id,name}));}}
        onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape")e.currentTarget.value=layer.name;if(e.key==="Enter"||e.key==="Escape")e.currentTarget.blur();}}/>}
      {layer.linkGroup!=null&&<span className="xd-photo-layer-badge" role="img" aria-label={`${layer.name} is linked`} title="Linked"><Link2 size={12}/></span>}
      {effects.length>0&&<button className="xd-photo-layer-fx" aria-label={`${open?"Hide":"Show"} effects of ${layer.name}`} title="Indicates layer effects" aria-expanded={open} onClick={()=>setFolded(list=>open?[...list,layer.id]:list.filter(id=>id!==layer.id))}><span className="xd-ps-fx">fx</span><ChevronDown size={10}/></button>}
      {(layer.locks?.all||layer.locks?.pixels||layer.locks?.position||layer.locks?.transparency)&&<span className={`xd-photo-layer-badge${layer.locks.all?" lock-all":""}`} role="img" aria-label={`${layer.name} is locked`} title={layer.locks.all?"Lock all attributes":"Layer is partially locked"}><Lock size={12} fill={layer.locks.all?"currentColor":"none"}/></span>}
    </div>
    {open&&<div className="xd-photo-layer-effects" role="group" aria-label={`Effects of ${layer.name}`}>
      <div className="xd-photo-effect-row" onDoubleClick={()=>style(layer,"blending")}><button disabled={busy} style={indent} aria-label={`${layer.effects?.enabled?"Hide":"Show"} effects of ${layer.name} on canvas`} title={layer.effects?.enabled?"Hide effects":"Show effects"} onClick={()=>attempt(runPhotoCommand("layer.layerStyle.setEffectsEnabled",{layer:layer.id,enabled:!layer.effects?.enabled}))}>{layer.effects?.enabled?<Eye size={13}/>:<EyeOff size={13}/>}</button><span>Effects</span></div>
      {effects.map(([index,effect])=><div key={index} className="xd-photo-effect-row nested" onDoubleClick={()=>style(layer,effectPane(effect))}><button disabled={busy} style={indent} aria-label={`${effect.enabled?"Hide":"Show"} ${effect.kind} of ${layer.name}`} title={effect.enabled?"Hide effect":"Show effect"} onClick={()=>attempt(runPhotoCommand("layer.layerStyle.editEffect",{layer:layer.id,index,path:effectEnabledPath(effect),value:!effect.enabled}))}>{effect.enabled?<Eye size={13}/>:<EyeOff size={13}/>}</button><span>{effect.kind}</span></div>)}
    </div>}
    {layer.children&&expanded&&<LayerRows layers={layer.children} active={active} busy={busy} editMask={editMask} editingMask={editingMask} selectPixels={selectPixels} menu={menu} thumbnails={thumbnails} masks={masks} openStyle={openStyle} openProperties={openProperties} openFill={openFill} depth={depth+1} folds={[shown,fold]}/>}
  </div>;})}</>;
}
const groupIds=(layer:PhotoLayer):number[]=>layer.children?[layer.id,...layer.children.flatMap(groupIds)]:[];
function findLayer(layers:PhotoLayer[],id:number|null):PhotoLayer|undefined {
  for(const layer of layers) { if(layer.id===id) return layer; const found=layer.children&&findLayer(layer.children,id); if(found) return found; }
}
const hasLayerKind=(layers:PhotoLayer[],kind:string):boolean=>layers.some(layer=>layer.kind===kind||!!layer.children&&hasLayerKind(layer.children,kind));
const DEFINE_COMMANDS:Record<PresetKind,string>={brushes:"edit.defineBrushPreset",patterns:"edit.definePattern",customShapes:"edit.defineCustomShape"};


export function PhotoStudio() {
  const documentId=usePhotoWorkspace(s=>s.documentId);
  const shapeId=usePhotoWorkspace(s=>s.shapeId);
  const sourceKind=usePhotoWorkspace(s=>s.source);
  const smartTrail=usePhotoWorkspace(s=>s.smartTrail);
  const projectId=usePhotoWorkspace(s=>s.projectId);
  const activeProjectId=useXDProjects(s=>s.activeId);
  const pencil=usePencilWorkspace(s=>s.editor);
  usePencilWorkspace(s=>s.version);
  const state=usePhotoWorkspace(s=>s.state);
  const stateVersion=usePhotoWorkspace(s=>s.stateVersion);
  const locked=usePhotoWorkspace(s=>s.busy),busy=usePhotoWorkspace(controlsLocked);
  const actions=useActions();
  const error=usePhotoWorkspace(s=>s.error);
  const warnings=usePhotoWorkspace(s=>s.warnings);
  const documents=useXDesign(s=>s.photoDocuments);
  const legacyPlacement=useXDesign(s=>s.shapes.find(shape=>shape.id===shapeId));
  const linkedDocumentId=sourceKind==="pencil"&&shapeId?pencilPhotoDocumentId(shapeId):legacyPlacement?.kind==="image"?legacyPlacement.photoDocumentId:null;
  const displayedId=smartTrail.length?documentId:linkedDocumentId;
  const document=displayedId?documents[displayedId]:null;
  const turn=useViewTurn(s=>document?s.turns[document.id]:undefined)??NO_TURN;
  // A Pencil commit publishes its state before its image, which waits for the placement to load the
  // new preview. Until then the screen still shows the previous image, so its state stays shown with
  // it: dropping it remounted the detail tiles and showed the unedited pixels for a moment.
  const shown=useRef<{id:string;version:string;state:PhotoState}|null>(null);
  if(document&&state&&stateVersion===document.version)shown.current={id:document.id,version:document.version,state};
  const kept=shown.current;
  const currentState=stateVersion===document?.version?state:locked&&state&&document&&kept?.id===document.id&&kept.version===document.version?kept.state:null;
  const canUndo=smartTrail.length?!!smartTrail.at(-1)?.past.length:!!currentState?.canUndo;
  const canRedo=smartTrail.length?!!smartTrail.at(-1)?.future.length:!!currentState?.canRedo;
  const historyReady=!!currentState?.historySources?.length&&!smartTrail.length&&!busy;
  useEffect(()=>{if(!smartTrail.length&&linkedDocumentId&&linkedDocumentId!==documentId&&!locked)usePhotoWorkspace.setState({documentId:linkedDocumentId,error:null});},[linkedDocumentId,documentId,locked,smartTrail.length]);
  const lastStep=useRef<{redo:boolean;at:number}|null>(null),historyAt=()=>currentState?.historySources?.find(source=>source.current)?.index??-1;
  const undo=()=>{if(!busy&&canUndo){lastStep.current={redo:false,at:historyAt()-1};attempt(smartTrail.length?stepSmartContentsHistory(false):runPhotoCommand("edit.undo"));}};
  const redo=()=>{if(!busy&&canRedo){lastStep.current={redo:true,at:historyAt()+1};attempt(smartTrail.length?stepSmartContentsHistory(true):runPhotoCommand("edit.redo"));}};
  // Photoshop's Toggle Last State reverses the last undo or redo; the engine's would keep redoing.
  const toggleLastState=()=>(lastStep.current&&lastStep.current.at===historyAt()?!lastStep.current.redo:!canUndo)?redo():undo();
  const [tool,setTool]=useState<string>("paint.stroke"),[zoomOut,setZoomOut]=useState(false),[autoSelect,setAutoSelect]=useState(false),[autoSelectTarget,setAutoSelectTarget]=useState<"layer"|"group">("layer"),[transformControls,setTransformControls]=useState(true),[sampleSize,setSampleSize]=useState(1),[cropGuide,setCropGuide]=useState<CropGuide>("thirds"),[cropOrientation,setCropOrientation]=useState(0);
  const panels=useEditorPanels();
  const [upperTab,setUpperTab]=useState<UpperPanel>("Color"),[middleTab,setMiddleTab]=useState<MiddlePanel>("Properties"),[layersTab,setLayersTab]=useState<LayersPanel>("Layers"),[flyout,setFlyout]=useState<StripPanel|null>(null);
  const [collapsed,setCollapsed]=useState({upper:false,middle:false,layers:false});
  const activePath=usePathTargets(s=>document?s[document.id]??null:null),setActivePath=(path:string|null)=>{if(document)usePathTargets.setState({[document.id]:path});},[brushPickerAt,setBrushPickerAt]=useState<{x:number;y:number;tool:string}|null>(null),[layerDraft,setLayerDraft]=useState<LayerPropsDraft|null>(null),[fillDraft,setFillDraft]=useState<CanvasDraft|null>(null),[contextMenu,setContextMenu]=useState<{x:number;y:number;kind:"layer"|"selection"|"path"|"picker"|"crop"|"fx"|"adjustment"|"ruler"|"pasteboard";layers?:{layer:number;name:string}[]}|null>(null);
  const [penMode,setPenMode]=useState<"shape"|"path">("path"),[lineWeight,setLineWeight]=useState(4),[shapeStyle,setShapeStyle]=useState<ShapeStyle>({fill:true,stroke:false,strokeColor:"#000000",strokeWidth:3}),[cornerRadius,setCornerRadius]=useState(0),[polygonSides,setPolygonSides]=useState(5),[starRatio,setStarRatio]=useState(100),[gradientTransparency,setGradientTransparency]=useState(true),[pathOp,setPathOp]=useState<PathOp>("new");
  const [size,setSize]=useState(24);
  const [opacity,setOpacity]=useState(1);
  const [hardness,setHardness]=useState(0.8);
  const [color,setColor]=useState("#ff3ea5");
  const [background,setBackground]=useState("#ffffff");
  const [channelColor,setChannelColor]=useState("#000000");
  const [colorMode,setColorMode]=useState<ColorPanelMode>("hueCube"),[picker,setPicker]=useState<"foreground"|"background"|"fillLayer"|"pasteboard"|null>(null);
  useEffect(()=>{setColor(previous=>paintColorHex(state?.tools?.foreground,previous));setBackground(previous=>paintColorHex(state?.tools?.background,previous));},[state?.tools]);
  const [mask,setMask]=useState(false);
  const maskRef=useRef(mask);maskRef.current=mask;
  const [zoom,setZoom]=useState(1);
  useEffect(()=>{const settings=state?.brush?.settings;if(typeof settings?.size==="number")setSize(settings.size);if(typeof settings?.opacity==="number")setOpacity(settings.opacity);if(typeof settings?.hardness==="number")setHardness(settings.hardness);},[state?.brush?.settings.size,state?.brush?.settings.opacity,state?.brush?.settings.hardness]);
  const [previewStatus,setPreviewStatus]=useState<string|null>(null);
  const [commandsOpen,setCommandsOpen]=useState(false);
  const [placeDialog,setPlaceDialog]=useState<"embedded"|"linked"|null>(null);
  const [dialog,setDialog]=useState<{action:PhotoAction;adjustment:boolean;layer?:PhotoLayer}|null>(null);
  const [specialDialog,setSpecialDialog]=useState<GeometryKind|"develop"|null>(null);
  const [perspectiveCrop,setPerspectiveCrop]=useState<CropQuad|null>(null);
  const [channelDialog,setChannelDialog]=useState<{channel:number|"quickMask"|null;spot:boolean}|null>(null);
  const [compositeDialog,setCompositeDialog]=useState<ChannelCompositeKind|null>(null),[saveSelection,setSaveSelection]=useState(false);
  const [mergeDialog,setMergeDialog]=useState(false);
  const [selectionDialog,setSelectionDialog]=useState<SelectionWorkflow|null>(null);
  const [profileDialog,setProfileDialog]=useState<ColorProfileWorkflow|null>(null);
  const [colorSettingsOpen,setColorSettingsOpen]=useState(false);
  const [preferencesSection,setPreferencesSection]=useState<PreferencesSection|null>(null),screenResolution=usePreferences(s=>s.screenResolution),rulerUnit=usePreferences(s=>s.rulerUnit),pasteboards=usePreferences(s=>s.pasteboard);
  const [imageDialog,setImageDialog]=useState<"size"|"canvas"|"text"|"gradient"|"newGradient"|"trim"|"duplicate"|"duotone"|"colorTable"|"snapshot"|null>(null),newFillBase=useRef<number>(undefined);
  const [editDialog,setEditDialog]=useState<PurgeCommand|PresetKind|"findReplace"|"spelling"|"presets"|"autoAlign"|"autoBlend"|null>(null);
  const [commandDialog,setCommandDialog]=useState<{command:ImageCommand;initial?:Record<string,unknown>}|null>(null);
  const [duplicateDialog,setDuplicateDialog]=useState<{title:string;source:string;name:string|null;document:string;create:(name:string|null)=>Promise<unknown>}|null>(null);
  const [newLayerDialog,setNewLayerDialog]=useState<{title?:string;name:string;kind:"layer"|"group"|"other";create:(request:NewLayerRequest)=>Promise<unknown>}|null>(null),solidFillOptions=useRef<Record<string,unknown>>(undefined);
  const [exportOpen,setExportOpen]=useState<"export"|"copy"|false>(false);
  const [customize,setCustomize]=useState<ShortcutsTab|"toolbar"|null>(null),customization=useCustomization(),toolbar=toolbarGroups(IMAGE_TOOL_GROUPS,customization.toolbar);
  const [fileDialog,setFileDialog]=useState<"info"|"fitImage"|"conditionalMode"|"colorLookup"|"paths"|"layersToFiles"|"artboardsPdf"|"photomerge"|"hdr"|null>(null);
  const [textPoint,setTextPoint]=useState<[number,number]|undefined>();
  const [selectionMode,setSelectionMode]=useState("replace");
  const [selectionDisplay,setSelectionDisplay]=useState<"outline"|"overlay"|"both">("outline");
  const [gradientStyle,setGradientStyle]=useState("linear"),[gradientReverse,setGradientReverse]=useState(false),[liveGradient,setLiveGradient]=useState(true);
  const layerGradient=state&&findLayer(state.layers,state.activeLayer)?.gradientFill;
  useEffect(()=>{if(layerGradient){setGradientStyle(layerGradient.style);setGradientReverse(layerGradient.reverse);}},[state?.activeLayer,stateVersion,layerGradient?.style,layerGradient?.reverse]);
  useEffect(()=>{setDialog(null);setSpecialDialog(null);setChannelDialog(null);setCompositeDialog(null);setImageDialog(null);setCommandDialog(null);setExportOpen(false);setSelectionDialog(null);setProfileDialog(null);setTextPoint(undefined);setCommandsOpen(false);setPicker(null);},[document?.id]);
  const {options:paintOptions,setOptions:setPaintOptions,notice:toolPreferencesNotice}=usePaintToolPreferences();
  const brushBasis=brushOptionBasis(state?.brush?.settings),previousBrushBasis=useRef(brushBasis);
  useEffect(()=>{if(brushBasis!==null&&previousBrushBasis.current!==null&&brushBasis!==previousBrushBasis.current)setPaintOptions(rebaseBrushOptions);previousBrushBasis.current=brushBasis;},[brushBasis,setPaintOptions]);
  const historySource=document?.historyBrushSourceId??null;
  const setHistorySource=(sourceId:string|null)=>{try{selectHistoryBrushSource(sourceId);}catch(error){setPreviewStatus(String(error));}};
  const displayState=currentState;
  const cloneSources=displayState?.presets?.cloneSource,cloneSource=cloneSources?.sources.find(slot=>slot.index===cloneSources.active);
  const viewPreview=useImageViewPreview(document??null,projectId,displayState);
  const overlay=useRef<HTMLCanvasElement>(null);
  const cloneMarker=useRef<SVGSVGElement>(null),cloneOverlay=useRef<SVGSVGElement>(null),cloneOverlayClip=`clone-overlay-${useId().replace(/:/g,"")}`;
  const brushTip=useRef<HTMLDivElement>(null),tipPointer=useRef<{x:number;y:number}|null>(null);
  const springMove=useRef(false),movePreview=useRef<MoveDragUpdate|null>(null),brushResize=useRef<{pointerId:number;client:{x:number;y:number};imageX:number;size:number;hardness:number}|null>(null),[resizeReadout,setResizeReadout]=useState<{x:number;y:number}|null>(null);
  // Placed from the last pointer position after every render and scroll too: a zoom, scroll or size
  // change moves the image under a still pointer, and the tip has to stay with the pointer.
  const placeBrushTip=()=>{
    const element=brushTip.current,at=brushResize.current?.client??tipPointer.current;if(!element)return;
    const surface=overlay.current;if(!at||!surface){element.style.display="";return;}
    const [x,y]=surfaceOffset(surface,at.x,at.y);element.style.transform=`translate(${x}px, ${y}px) translate(-50%, -50%)`;element.style.display="block";
  };
  useLayoutEffect(placeBrushTip);
  const image=useRef<HTMLDivElement>(null);
  const stage=useRef<HTMLDivElement>(null);
  const propertiesScroll=useRef<HTMLDivElement>(null);
  const stroke=useRef<Point[]>([]);
  const lastStrokeEnd=useRef<{document:string;point:StrokeXY}|null>(null),strokeAxis=useRef<Axis|null>(null),lineHint=useRef(false);
  const eraserGesture=useRef<EraserGestureContext|null>(null),eraserCommitOverflow=useRef(false),eraserPreviewCapped=useRef(false);
  const patchDrag=useRef<PatchDrag|null>(null),patchPreviewCount=useRef(0);
  const gestureStart=useRef<GestureModifiers>({shiftKey:false,altKey:false}),gestureCurrent=useRef<GestureModifiers>({shiftKey:false,altKey:false});
  const polygonDraft=useRef(false),polygonCursor=useRef<[number,number]|null>(null),[polygonVertices,setPolygonVertices]=useState(0);
  // Pen anchors live in stroke.current; each anchor's outgoing handle is mirrored for its incoming one.
  const penHandles=useRef<([number,number]|null)[]>([]),penDragging=useRef(false);
  const nativeStroke=useRef<NativeStrokePreview|null>(null),strokeEnd=useRef<(()=>void)|null>(null),strokeCount=useRef(0),seed=useRef<number|null>(null),redrawStroke=useRef(()=>{});
  const strokePointer=useRef<number|undefined|null>(null),heldStroke=useRef<HeldStroke|null>(null),replayHeld=useRef<()=>boolean>(()=>true);
  const cloneGesture=useRef<string|null>(null);
  const [nativeFeedback,setNativeFeedback]=useState(true);
  // null follows the foreground colour; the draft is the swatch while the colour picker is open.
  const [typeColor,setTypeColor]=useState<string|null>(null),[typeColorDraft,setTypeColorDraft]=useState<string|null>(null);
  const [sampleLayer,setSampleLayer]=useState<"all"|"current"|"currentBelow">("all"),[showRing,setShowRing]=useState(true),[ring,setRing]=useState<{x:number;y:number;color:string;previous:string}|null>(null);
  // Scrubby Zoom is off by default so a plain click keeps zooming at once; Photoshop starts with it on.
  const [scrubbyZoom,setScrubbyZoom]=useState(false);
  const scrub=useRef<{pointerId:number;x:number;y:number;startZoom:number;moved:boolean;out:boolean}|null>(null);
  const sampleDrag=useRef<{pointerId:number;key:"foreground"|"background";busy:boolean}|null>(null);
  const [cropStraighten,setCropStraighten]=useState(false),[cropShield,setCropShield]=useState(true),[cropShieldOpacity,setCropShieldOpacity]=useState(.75),[cropShowCropped,setCropShowCropped]=useState(true),[cropOverlayShow,setCropOverlayShow]=useState<CropOverlayShow>("always");
  const cycleCropGuide=()=>setCropGuide(value=>{const guides=CROP_GUIDES.map(([guide])=>guide);return guides[(guides.indexOf(value)+1)%guides.length]!;}),turnCropGuide=()=>setCropOrientation(value=>(value+1)%4);
  useEffect(()=>{if(tool!=="crop")setCropStraighten(false);},[tool]);
  // A tool switch can unmount the focused options-bar control, and WebKit sends no blur for that, so focus would sit on the page body where shortcuts never arrive.
  // Opening the image hides the design shell, and WebKit drops focus from its canvas only at the next rendering update, after this check; until then ⌘2 reaches the shell.
  useEffect(()=>{const section=stage.current?.closest<HTMLElement>(".xd-photo"),page=section?.ownerDocument,active=page?.activeElement;if(section&&page&&active&&(active===page.body||!section.contains(active)&&active.closest('[aria-hidden="true"]'))&&page.hasFocus()&&!isDesignDialogOpen()&&!section.closest(".ot-window.unfocused"))section.focus({preventScroll:true});},[tool]);
  // Opening an image from the studio File menu leaves focus on that menu's button, outside the editor, where ⇧⌘N opens Quick Capture instead of New Layer.
  useEffect(()=>{const section=stage.current?.closest<HTMLElement>(".xd-photo"),page=section?.ownerDocument,active=page?.activeElement;if(section&&page&&active&&!section.contains(active)&&!active.matches("input,textarea,select,[contenteditable]:not([contenteditable='false'])")&&page.hasFocus()&&!isDesignDialogOpen()&&!section.closest(".ot-window.unfocused"))section.focus({preventScroll:true});},[documentId]);
  // The engine keeps the painting symmetry per document but does not report it, so the bar remembers what it set.
  const [symmetryChoice,setSymmetryChoice]=useState<Record<string,string>>({});
  // Native feedback is patched into the canvases that show the image: the preview while it holds a
  // pixel per screen pixel, the detail tiles otherwise. The committed image then replaces the same
  // pixels in place, so nothing swaps or redraws on release.
  const [surface]=useState(()=>new PreviewSurface()),[tileSurface]=useState(()=>new TileSurface()),strokeSurface=useRef<PreviewSurface|TileSurface|null>(null);
  const resetStroke=(keepDrawing=false)=>{
    for(const element of [cloneMarker.current,cloneOverlay.current])if(element)element.style.display="none";
    if(!strokeEnd.current&&!nativeStroke.current&&!stroke.current.length&&!patchDrag.current)return;
    const capturedPointer=strokePointer.current,canvas=overlay.current;strokePointer.current=null;if(capturedPointer!==null&&capturedPointer!==undefined&&canvas?.hasPointerCapture(capturedPointer))canvas.releasePointerCapture(capturedPointer);
    nativeStroke.current?.dispose();nativeStroke.current=null;strokeSurface.current?.restore();strokeSurface.current=null;stroke.current=[];springMove.current=false;patchDrag.current=null;eraserGesture.current=null;cloneGesture.current=null;eraserCommitOverflow.current=false;eraserPreviewCapped.current=false;strokeCount.current=0;seed.current=null;strokePointer.current=null;polygonDraft.current=false;polygonCursor.current=null;setPolygonVertices(0);penHandles.current=[];penDragging.current=false;
    const end=strokeEnd.current;strokeEnd.current=null;end?.();
    if(!keepDrawing){canvas?.getContext("2d")?.clearRect(0,0,canvas.width,canvas.height);movePreview.current?.(null);}setPreviewStatus(null);
  };
  useEffect(()=>()=>resetStroke(),[projectId,document?.id,document?.version,displayState?.viewKey]);
  const placementExists=sourceKind==="pencil"?!!(shapeId&&pencil?.graph.getNode(shapeId)):!!legacyPlacement;
  useEffect(()=>{
    if(!document||!placementExists&&!smartTrail.length) {usePhotoWorkspace.getState().close();return;}
    if(stateVersion!==document.version&&!locked&&!error) {
      attempt(refreshImage(document));
    }
  },[document,locked,stateVersion,error,placementExists,smartTrail.length]);
  useEffect(()=>{if(state&&!findLayer(state.layers,state.activeLayer)?.hasMask)setMask(false);},[state]);
  useEffect(()=>{if(state?.channels?.target&&state.channels.target.kind!=="composite")setMask(false);},[state?.channels?.target]);
  const fit=()=>{
    const view=stage.current;
    const [width,height]=document?turnedSize(document.width,document.height,turn.angle):[0,0];
    if(view&&document)setZoom(Math.min(1,Math.max(.01,Math.min((view.clientWidth-56)/width,(view.clientHeight-56)/height))));
  };
  const fill=()=>{
    const view=stage.current;
    if(view&&document)setZoom(Math.min(16,Math.max(.01,Math.max(view.clientWidth/document.width,view.clientHeight/document.height))));
  };
  useEffect(()=>{fit();},[document?.id]);
  useEffect(()=>{for(const element of [cloneMarker.current,cloneOverlay.current])if(element)element.style.display="none";},[projectId,document?.id,document?.version,displayState?.viewKey,tool,JSON.stringify(cloneSources),JSON.stringify(paintOptions[tool]),zoom,perspectiveCrop,specialDialog,commandsOpen,dialog,channelDialog,compositeDialog,mergeDialog,selectionDialog,profileDialog,colorSettingsOpen,imageDialog,editDialog,fileDialog,picker]);
  const zoomRef=useRef(zoom);zoomRef.current=zoom;
  const zoomAnchor=useRef<{x:number;y:number;px:number;py:number}|null>(null);
  // Keep the image point under the cursor (or the view center) fixed while zooming.
  const zoomAt=(next:(zoom:number)=>number,clientX?:number,clientY?:number)=>{
    const view=stage.current,surface=image.current;
    if(view&&surface){const box=surface.getBoundingClientRect(),frame=view.getBoundingClientRect(),x=clientX??frame.left+view.clientWidth/2,y=clientY??frame.top+view.clientHeight/2;zoomAnchor.current={x,y,px:(x-box.left)/zoomRef.current,py:(y-box.top)/zoomRef.current};}
    setZoom(z=>Math.min(16,Math.max(.01,next(z))));
  };
  const [navigatorView,setNavigatorView]=useState<NavigatorView|null>(null),viewFrame=useRef(0);
  const measureView=()=>{
    const view=stage.current,surface=image.current;if(!view||!surface)return;
    const scale=zoomRef.current,[width,height]=surfaceSize(surface),area=visibleArea(view,surface,scale,width/scale,height/scale);
    const x0=Math.max(0,area.x),y0=Math.max(0,area.y),x1=Math.min(width/scale,area.x+area.width),y1=Math.min(height/scale,area.y+area.height);
    setNavigatorView(x1>x0&&y1>y0?{x:x0,y:y0,width:x1-x0,height:y1-y0}:null);
  };
  const scheduleView=()=>{if(!viewFrame.current)viewFrame.current=requestAnimationFrame(()=>{viewFrame.current=0;measureView();});};
  useEffect(()=>{const view=stage.current;if(!view)return;const observer=new ResizeObserver(scheduleView);observer.observe(view);scheduleView();return()=>{observer.disconnect();cancelAnimationFrame(viewFrame.current);viewFrame.current=0;};},[document?.id]);
  const viewCenter=useRef<[number,number]|null>(null);
  useLayoutEffect(()=>{const anchor=zoomAnchor.current,center=viewCenter.current,view=stage.current,surface=image.current;zoomAnchor.current=null;viewCenter.current=null;scheduleView();if(center){centerView(center[0],center[1]);return;}if(!anchor||!view||!surface)return;const box=surface.getBoundingClientRect();view.scrollLeft+=box.left+anchor.px*zoom-anchor.x;view.scrollTop+=box.top+anchor.py*zoom-anchor.y;},[zoom]);
  const centerView=(x:number,y:number)=>{const view=stage.current,surface=image.current;if(!view||!surface)return;const frame=view.getBoundingClientRect(),[cx,cy]=surfaceClient(surface,x*zoomRef.current,y*zoomRef.current);view.scrollLeft+=cx-(frame.left+view.clientWidth/2);view.scrollTop+=cy-(frame.top+view.clientHeight/2);scheduleView();};
  // Turning keeps the image point at the centre of the view there, as in Photoshop.
  const turnAnchor=useRef<[number,number]|null>(null);
  const turnView=(change:Partial<ViewTurn>)=>{
    const view=stage.current,surface=image.current;if(!document)return;
    if(view&&surface){const frame=view.getBoundingClientRect(),[x,y]=surfaceOffset(surface,frame.left+view.clientWidth/2,frame.top+view.clientHeight/2);turnAnchor.current=[x/zoomRef.current,y/zoomRef.current];}
    useViewTurn.getState().turn(document.id,change);
  };
  useLayoutEffect(()=>{const anchor=turnAnchor.current;turnAnchor.current=null;if(anchor)centerView(anchor[0],anchor[1]);},[turn.angle,turn.flip]);
  const wheelZoom=useRef(zoomAt);wheelZoom.current=zoomAt;
  useEffect(()=>{
    const view=stage.current;if(!view)return;
    const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();const factor=Math.exp(-event.deltaY/200);wheelZoom.current(z=>z*factor,event.clientX,event.clientY);};
    view.addEventListener("wheel",wheel,{passive:false});return()=>view.removeEventListener("wheel",wheel);
  },[document?.id]);
  const [toolsWrap,setToolsWrap]=useState(false),aids=useViewAids(s=>s.flags),storedGuides=useViewAids(s=>document?s.documents[document.id]:undefined);
  useEffect(()=>{const body=panels.body.current;if(!body||typeof ResizeObserver==="undefined")return;const observer=new ResizeObserver(()=>setToolsWrap(body.clientHeight<TOOLBAR_HEIGHT));observer.observe(body);return()=>observer.disconnect();},[panels.body]);
  const [spacePan,setSpacePan]=useState(false),[screenMode,setScreenMode]=useState(0),[fullScreenPanels,setFullScreenPanels]=useState(false);
  const pasteboard=pasteboards[screenMode]!,pasteboardColor=pasteboardFill(pasteboard);
  const choosePasteboard=(next:Pasteboard)=>{const current=currentPreferences(),failed=savePreferences({...current,pasteboard:current.pasteboard.map((entry,mode)=>mode===screenMode?next:entry) as typeof current.pasteboard});if(failed)usePhotoWorkspace.setState({error:failed});};
  const chooseScreenMode=(mode:number)=>{setScreenMode(mode);setFullScreenPanels(false);};
  const panDrag=useRef<PanDrag|null>(null);
  useEffect(()=>{const release=()=>setSpacePan(false);window.addEventListener("blur",release);return()=>window.removeEventListener("blur",release);},[]);
  const [altHeld,setAltHeld]=useState(false),[metaHeld,setMetaHeld]=useState(false),[capsLock,setCapsLock]=useState(false),[draftClosing,setDraftClosing]=useState(false);
  useEffect(()=>{
    const track=(event:KeyboardEvent)=>{setAltHeld(event.altKey);setMetaHeld(event.metaKey);setCapsLock(event.getModifierState?.("CapsLock")??false);},release=()=>{setAltHeld(false);setMetaHeld(false);};
    window.addEventListener("keydown",track);window.addEventListener("keyup",track);window.addEventListener("blur",release);
    return()=>{window.removeEventListener("keydown",track);window.removeEventListener("keyup",track);window.removeEventListener("blur",release);};
  },[]);
  const [taskBar,setTaskBar]=useState<TaskBarPlace>(TASK_BAR_HOME),placeTaskBar=(patch:Partial<TaskBarPlace>)=>setTaskBar(current=>({...current,...patch}));
  const [chrome,setChrome]=useState({options:true,tools:true});
  // Photoshop's unpinned bar goes back to its own place for the next task; a pinned one stays where it was dragged.
  useEffect(()=>setTaskBar(current=>current.pinned||!current.at?current:{...current,at:null}),[tool]);
  const [cropBox,setCropBox]=useState<CropBox|null>(null),[cropAngle,setCropAngle]=useState(0),[cropShift,setCropShift]=useState<[number,number]>([0,0]);
  const cropPresets=useCropPresets();
  const [selectionBox,setSelectionBox]=useState<{from:CropBox;box:CropBox}|null>(null);
  // The canvas shows the previous version until the next preview decodes, so the stage and the crop box stay in that version's size meanwhile
  // instead of stretching its pixels to the new one. A preview that never shows (a failed view preview) stops holding it after two seconds.
  const [shownSize,setShownSize]=useState<Pick<PhotoDocument,"id"|"version"|"width"|"height">|null>(null);
  const frame=document&&shownSize?.id===document.id?shownSize:document;
  useEffect(()=>{if(!frame||!document||frame.version===document.version)return;const timer=window.setTimeout(()=>setShownSize(null),2000);return()=>window.clearTimeout(timer);},[frame,document]);
  useLayoutEffect(()=>{setCropBox(null);setCropAngle(0);setCropShift([0,0]);setSelectionBox(null);},[tool,document?.id,frame?.version]);
  // Photoshop puts the crop box on the canvas edges as soon as the Crop tool is picked, but not again after a crop is applied.
  useEffect(()=>{if(tool==="crop"&&document)setCropBox({x:0,y:0,width:document.width,height:document.height});},[tool]);
  const [thumbnails,setThumbnails]=useState<Record<number,string>>({}),[maskThumbnails,setMaskThumbnails]=useState<Record<number,string>>({}),thumbnailsVisible=panels.right&&layersTab==="Layers"&&!collapsed.layers;
  // A fold shows at once, then gives way to the engine's state once saved, or to the old state if it fails.
  const [folds,setFolds]=useState<Record<number,boolean>>({});
  const fold=(groups:number[],open:boolean,all=false)=>{
    setFolds(state=>({...state,...Object.fromEntries(groups.map(id=>[id,open]))}));
    // "All" lets the engine fold every group itself, so no list of groups can outgrow one call.
    attempt(runPhotoCommand(all?"layer.setExpanded":"layer.setGroupsExpanded",all?{all:true,expanded:open}:{layers:groups,expanded:open}).finally(()=>setFolds(state=>Object.fromEntries(Object.entries(state).filter(([id,value])=>value!==open||!groups.includes(Number(id)))))));
  };
  const layerList=useRef<HTMLDivElement>(null);
  // As in Photoshop, a layer made active out of view (Auto-Select, undo, Select › layer commands) scrolls into the Layers panel; only the list moves, never the window around it.
  useEffect(()=>{
    const list=layerList.current,row=list?.querySelector(`.xd-photo-layer[data-layer="${state?.activeLayer}"]`);
    if(!list||!row)return;
    const view=list.getBoundingClientRect(),at=row.getBoundingClientRect();
    if(at.top<view.top)list.scrollTop-=view.top-at.top;else if(at.bottom>view.bottom)list.scrollTop+=at.bottom-view.bottom;
  },[state?.activeLayer]);
  const [layerFilter,setLayerFilter]=useState<LayerFilter>(DEFAULT_LAYER_FILTER),[layerStyle,setLayerStyle]=useState<{layer:number;pane:LayerStylePane}|null>(null);
  useEffect(()=>{
    if(!thumbnailsVisible||!document||!projectId||!isTauri())return;
    let alive=true;
    const timer=setTimeout(()=>{void invoke<{layer:number;png?:string;mask?:string}[]>("xdesign_photo_layer_thumbnails",{projectId,photoId:document.id,version:document.version,size:56}).then(list=>{if(alive){setThumbnails(Object.fromEntries(list.flatMap(item=>item.png?[[item.layer,item.png]]:[])));setMaskThumbnails(Object.fromEntries(list.flatMap(item=>item.mask?[[item.layer,item.mask]]:[])));}}).catch(()=>{});},150);
    return()=>{alive=false;clearTimeout(timer);};
  },[thumbnailsVisible,projectId,document?.id,document?.version]);
  const [canvasText,setCanvasText]=useState<CanvasText|null>(null),[textFont,setTextFont]=useState("Arial"),[textSize,setTextSize]=useState(48),fonts=useFontFamilies(),[textStyle,setTextStyle]=useState<TypeStyle>("Regular"),[textAlign,setTextAlign]=useState<TypeAlign>("left"),[textAntialias,setTextAntialias]=useState("smooth"),[textOrientation,setTextOrientation]=useState("horizontal"),[textWarp,setTextWarp]=useState(false);
  useEffect(()=>{setCanvasText(null);},[tool,document?.id]);
  const activeKind=state&&findLayer(state.layers,state.activeLayer)?.kind;
  const pathTarget=activeKind==="Shape"?"layer":state?selectedPath(state,activePath):null;
  const [editPath,setEditPath]=useState<{name:string;layer?:number;path:PathData}|null>(null);
  useEffect(()=>{
    setEditPath(null);
    if(!pathTarget||!document||stateVersion!==document.version)return;
    let alive=true;const layer=pathTarget==="layer"?state?.activeLayer??undefined:undefined;
    void runPhotoCommand("path.info",{name:pathTarget}).then(result=>{const path=(result as {path?:PathData}|undefined)?.path;if(alive&&path?.subpaths)setEditPath({name:pathTarget,layer,path});}).catch(()=>{});
    return()=>{alive=false;};
  },[pathTarget,document?.id,document?.version,stateVersion,state?.activeLayer]);
  const lastTools=useRef<Record<string,string>>({}),typedDigit=useRef({digit:"",time:0});
  useEffect(()=>{const shortcut=IMAGE_TOOLS.find(item=>item.id===tool)?.shortcut;if(shortcut)lastTools.current[shortcut]=tool;},[tool]);
  const shownWaiters=useRef<(()=>void)[]>([]);
  const freeTransforming=useFreeTransform(store=>!!store.session||!!store.held);
  const warpSession=useWarpSession(store=>store.session);
  // The flyout menus read these selections, so the studio re-renders when they change.
  useLayerComps(store=>store.selected);useMeasurementLog(store=>store.selected);useTypeStyles(store=>store.selected);
  useEffect(()=>cancelFreeTransform,[tool,document?.id,document?.version,state?.activeLayer,state?.viewKey]);
  if(!document) return null;
  const selectedBoxes=()=>!state?[]:(state.selectedLayers?.length?state.selectedLayers:[state.activeLayer]).map(id=>findLayer(state.layers,id)?.bounds).filter((box):box is [number,number,number,number]=>!!box&&box[2]>0&&box[3]>0);
  const boxUnion=(boxes:[number,number,number,number][]):[number,number,number,number]|null=>{
    if(!boxes.length)return null;const x=Math.min(...boxes.map(box=>box[0])),y=Math.min(...boxes.map(box=>box[1]));
    return [x,y,Math.max(...boxes.map(box=>box[0]+box[2]))-x,Math.max(...boxes.map(box=>box[1]+box[3]))-y];
  };
  const fitLayers=()=>{
    const view=stage.current,box=boxUnion(selectedBoxes());if(!view||!box)return;
    const [width,height]=turnedSize(box[2],box[3],turn.angle),next=Math.min(16,Math.max(.01,Math.min((view.clientWidth-56)/width,(view.clientHeight-56)/height))),center:[number,number]=[box[0]+box[2]/2,box[1]+box[3]/2];
    if(next===zoomRef.current)centerView(...center);else{viewCenter.current=center;setZoom(next);}
  };
  const currentLayer=state&&findLayer(state.layers,state.activeLayer),shownLayer=displayState&&findLayer(displayState.layers,displayState.activeLayer);
  const pixelLayer=["pixel","raster"].includes(currentLayer?.kind.toLowerCase()??"");
  // Artboards are top-level groups; the active one is the active layer itself or its top-level ancestor.
  const artboards=(state?.layers??[]).flatMap(layer=>layer.artboard?[{id:layer.id,rect:layer.artboard.rect,children:layer.children??[]}]:[]);
  const activeArtboard=artboards.find(board=>board.id===state!.activeLayer||!!findLayer(board.children,state!.activeLayer)),slicesLocked=!!state?.analysis?.slicesLocked,guideList=storedGuides??[];
  const pixelLayers=(state?.selectedLayers??[]).filter(id=>["pixel","raster"].includes(findLayer(state!.layers,id)?.kind.toLowerCase()??"")).length;
  const startFreeTransform=(mode:TransformMode="free")=>{if(currentLayer)beginFreeTransform(document,currentLayer,state?.viewKey,mode);};
  const geometryActive=!!perspectiveCrop||!!specialDialog&&specialDialog!=="develop"&&!!currentLayer;
  const openGeometry=(kind:GeometryKind)=>{setSpecialDialog(kind);if(!panels.left)panels.toggle("left");if(propertiesScroll.current)propertiesScroll.current.scrollTop=0;};
  const openPerspectiveCrop=(quad:CropQuad)=>{setSpecialDialog(null);setPerspectiveCrop(quad);if(!panels.left)panels.toggle("left");if(propertiesScroll.current)propertiesScroll.current.scrollTop=0;};
  const paintingMask=mask||!!state?.layerMaskView;
  const grayscaleTarget=paintingMask||!!state?.quickMask||!!(state?.channels?.target&&state.channels.target.kind!=="composite");
  const paintColor=grayscaleTarget?channelColor:color;
  const nativeForeground=nativePaintColor(state?.tools?.foreground),nativeBackground=nativePaintColor(state?.tools?.background);
  const paintColorValue=grayscaleTarget?channelColor:nativeForeground??paintColor;
  const backgroundValue=grayscaleTarget?"#ffffff":nativeBackground??background;
  const changeColor=(key:"foreground"|"background",next:string)=>{
    const setter=key==="foreground"?setColor:setBackground,previous=key==="foreground"?color:background;
    setter(next);attempt(setPhotoColors({[key]:next}).catch(error=>{setter(paintColorHex(usePhotoWorkspace.getState().state?.tools?.[key],previous));usePhotoWorkspace.setState({error:String(error)});throw error;}));
  };
  const paletteCommand=(id:"tools.swapColors"|"tools.defaultColors")=>attempt(runPhotoCommand(id).then(()=>{if(!usePhotoWorkspace.getState().state?.tools){if(id==="tools.swapColors"){setColor(background);setBackground(color);}else{setColor("#000000");setBackground("#ffffff");}}}));
  const chooseColor=(key:"foreground"|"background",hex:string)=>{if(grayscaleTarget&&key==="foreground")setChannelColor(grayHex(hex));else changeColor(key,hex);};
  const chooseToolPreset=(selection:ToolPresetSelection)=>{
    const item=IMAGE_TOOL_GROUPS.flatMap(group=>group.tools).find(item=>toolPresetName(item.id).toLowerCase()===selection.tool.toLowerCase());
    if(!item)return;
    setTool(item.id);
    previousBrushBasis.current=brushOptionBasis(usePhotoWorkspace.getState().state?.brush?.settings);
    const options=selection.options.toolOptions as Record<string,unknown>|undefined;
    setPaintOptions(current=>({...rebaseBrushOptions(current),...(options?.paintOptions?{[item.id]:sanitizePaintOptions(item.id,options.paintOptions)}:{})}));
    const style=options?.gradientStyle??options?.gradient_style;
    if(typeof style==="string"&&["linear","radial","angle","reflected","diamond"].includes(style))setGradientStyle(style);
    if(typeof options?.gradientReverse==="boolean")setGradientReverse(options.gradientReverse);
    if(typeof options?.liveGradient==="boolean")setLiveGradient(options.liveGradient);
    if(typeof options?.selectionMode==="string"&&["replace","add","subtract","intersect"].includes(options.selectionMode))setSelectionMode(options.selectionMode);
    const foreground=selection.options.foreground;
    if(Array.isArray(foreground)&&foreground.length>=3&&foreground.slice(0,3).every(value=>typeof value==="number"&&Number.isFinite(value))) {
      const hex="#"+foreground.slice(0,3).map(value=>Math.round(Math.min(1,Math.max(0,value))*255).toString(16).padStart(2,"0")).join("");
      if(grayscaleTarget)setChannelColor(hex);else setColor(hex);
    }
    setBackground(previous=>paintColorHex(selection.options.background,previous));
  };
  const editTarget=imageEditTarget(state,paintingMask);
  const brushTool=tool==="erase"||(tool.startsWith("paint.")&&!["paint.gradient","paint.bucket","paint.patch","paint.magicEraser","paint.redEye"].includes(tool));
  const colorTool=["paint.stroke","paint.pencil","paint.mixerBrush","paint.colorReplacement","paint.smudge","paint.gradient","paint.bucket","paint.backgroundEraser"].includes(tool);
  const selectionTool=SELECTION_TOOLS.includes(tool);
  const nativeStrokeTool=NATIVE_STROKE_TOOLS.includes(tool);
  const retouchPreview=RETOUCH_PREVIEW_TOOLS.includes(tool),continuousRetouch=CONTINUOUS_RETOUCH_TOOLS.includes(tool),feedbackAvailable=!retouchPreview||document.width*document.height<=16_777_216;
  const historyChoice=historyBrushSource(displayState?.historySources,historySource);
  const toolOptions:PaintOptions={...paintToolDefaults(tool,state),...paintOptions[tool],...(tool==="paint.historyBrush"&&historyChoice?{historySource:historyChoice.id}:{})};
  const imagePpi=state?.resolution||72,cropSize=tool==="crop"?cropSizePixels(toolOptions,imagePpi):null;
  const perspectiveOptions:PaintOptions={...paintToolDefaults("perspectiveCrop",state),...paintOptions.perspectiveCrop},perspectiveSize=cropSizePixels({...perspectiveOptions,style:"size"},imagePpi);
  // A crop ratio or W x H x Resolution size holds the box's shape for handle drags and for drawing a new box.
  const cropRatio=tool!=="crop"?undefined:toolOptions.style==="fixedRatio"?Number(toolOptions.ratioWidth)/Number(toolOptions.ratioHeight):cropSize?cropSize.width/cropSize.height:undefined;
  const gestureOptions:PaintOptions=cropSize?{...toolOptions,style:"fixedRatio",ratioWidth:cropSize.width,ratioHeight:cropSize.height}:toolOptions;
  const eraseToHistory=tool==="erase"&&toolOptions.eraseToHistory===true;
  const tipSize=(brushTool?size:tool==="select.quick"?Number(toolOptions.size)||0:0)*zoom,springReady=metaHeld&&!NO_SPRING_MOVE.includes(tool),precise=capsLock&&!STANDARD_CURSOR_TOOLS.includes(tool),showTip=tipSize>0&&(!precise||!!resizeReadout)&&!spacePan&&!springReady&&!geometryActive&&!(viewPreview.active&&!viewPreview.url);
  const toolLabel=IMAGE_TOOL_GROUPS.flatMap(group=>group.tools).find(option=>option.id===tool)?.label??tool,ToolIcon=IMAGE_TOOLS.find(option=>option.id===tool)?.icon;
  // Usage hints live in the status line, not the options bar, as in Photoshop.
  const toolHint=((): string => {
    if(selectionBox)return `Transforming selection · ${selectionBox.box.width} × ${selectionBox.box.height} px · Enter applies · Esc cancels`;
    if(selectionTool)return tool==="polygonLasso"?"Click vertices · Enter or double-click to finish · Backspace removes · Esc cancels":`Shift-start adds · Alt-start subtracts${tool!=="select.quick"?" · Shift+Alt-start intersects":""}`;
    switch(tool){
      case "paint.cloneStamp":case "paint.healingBrush":return "Alt-click to set a source";
      case "move":return `Drag to move the selected layer${transformControls?" · ⌘-drag a corner to distort or a side to skew":""}`;
      case "paint.patch":return !currentState?.hasSelection?"Make a selection before using the Patch tool.":toolOptions.mode==="destination"?"Copy selected texture to the place you drag toward; that destination is repaired.":"Repair the selected area with texture from the place you drag toward.";
      case "paint.redEye":return "Click a red pupil to darken it, or drag a box around the eyes to correct every red pupil inside it";
      case "paint.magicEraser":return "Click a color region on the active pixel layer to erase it to transparency. Click location controls the result.";
      case "paint.backgroundEraser":return "Drag over the active pixel layer to erase sampled colors. Feedback is limited to 4,096 samples and 1 MiB; up to 131,072 samples and 16 MiB are committed on release.";
      case "text":return "Click to type · Click existing text to edit it · ⌘Enter or click away commits · Esc cancels";
      case "eyedropper":return "Click to sample the foreground color · Alt-click samples the background";
      case "hand":return "Drag to pan · Hold Space to pan with any tool";
      case "rotateView":return "Drag to rotate the view · Shift-drag turns in 15° steps";
      case "zoom":return `Click to zoom ${zoomOut?"out":"in"} · Alt-click zooms ${zoomOut?"in":"out"} · ⌘-scroll or pinch to zoom`;
      case "crop":return cropBox?`${cropBox.width} × ${cropBox.height} px${cropAngle?` · ${cropAngle.toFixed(1)}°`:""} · Drag the box, its handles or the rotate handle · O cycles the overlay · Enter applies · Esc cancels`:"Drag to define the crop area";
      case "perspectiveCrop":return currentState?.features?.perspectiveCrop?"Drag a box around a photographed page or screen, then move its corners onto the edges · Apply corrects the perspective":"Perspective crop requires an updated native engine.";
      case "straighten":return "Draw along a horizon or vertical edge · Image trims rotated edges · Layers keeps canvas size";
      case "ruler":return "Drag to measure · Shift keeps 45° steps · Drag an end to adjust · Alt-drag an end for a protractor";
      case "colorSampler":return "Click to place a color sampler (up to 10) · Drag one to move it · Alt-click or drag it off the image to delete it";
      case "count":return "Click to add a count · Alt-click removes one · Drag a number to move it";
      case "note":return "Click to add a note · Drag a note to move it · Double-click opens it in the Notes panel";
      case "slice":return "Drag to create a user slice · Shift makes it square";
      case "slice.select":return "Click a slice to select it · Drag a user slice or its handles · Double-click for Slice Options";
      case "paint.spotHealing":return "Click or drag over a blemish to repair it from the surrounding area";
      case "paint.patternStamp":return "Drag to paint with the chosen pattern";
      case "paint.historyBrush":return "Drag to paint from the History Brush source · Set the source in the History panel";
      case "erase":return eraseToHistory?"Drag to restore the History Brush source":"Drag to erase to transparency · The Background and transparency-locked layers take the background color";
      case "paint.blur":return "Drag to soften the image";
      case "paint.sharpen":return "Drag to sharpen the image";
      case "paint.smudge":return "Drag to smudge the image";
      case "paint.dodge":return "Drag to lighten the image";
      case "paint.burn":return "Drag to darken the image";
      case "paint.sponge":return "Drag to change color saturation";
    }
    if(SAMPLING_TOOLS.includes(tool))return "Alt-click to sample a color";
    if(PEN_TOOLS.includes(tool))return `${tool==="pen"?"Click for corner points · Drag for curves":tool==="pen.curvature"?"Click to place smooth points":"Drag to draw a path"} · ${penMode==="shape"?"Finishing creates a shape layer":"Finishing sets the work path (Paths panel)"}`;
    if(SHAPE_TOOLS.includes(tool))return `Drag to draw a shape layer in the foreground color${tool==="shape.line"?"":" · Shift constrains proportions"}`;
    if(PATH_SELECT_TOOLS.includes(tool))return !pathTarget?"Select a shape layer or draw a path with the Pen tool":tool==="path.select"?"Drag the path to move it":"Drag points or handles · Alt-drag a handle for a corner";
    return "";
  })();
  const middleCollapsed=collapsed.middle&&!geometryActive&&!perspectiveCrop;
  const panelOpen=(name:PanelName)=>(UPPER_PANELS as readonly string[]).includes(name)?panels.left&&!collapsed.upper&&upperTab===name:(MIDDLE_PANELS as readonly string[]).includes(name)?panels.left&&!middleCollapsed&&middleTab===name:(LAYER_PANELS as readonly string[]).includes(name)?panels.right&&!collapsed.layers&&layersTab===name:flyout===name;
  // Photoshop docks: tabs within a group, icon-strip panels fly out and collapse when you work elsewhere.
  const openPanel=(name:PanelName)=>{
    if((UPPER_PANELS as readonly string[]).includes(name)){setUpperTab(name as UpperPanel);setCollapsed(c=>({...c,upper:false}));if(!panels.left)panels.toggle("left");setFlyout(null);}
    else if((MIDDLE_PANELS as readonly string[]).includes(name)){setMiddleTab(name as MiddlePanel);setCollapsed(c=>({...c,middle:false}));if(!panels.left)panels.toggle("left");setFlyout(null);}
    else if((LAYER_PANELS as readonly string[]).includes(name)){setLayersTab(name as LayersPanel);setCollapsed(c=>({...c,layers:false}));if(!panels.right)panels.toggle("right");setFlyout(null);}
    else{setFlyout(name as StripPanel);if(!panels.left&&!panels.right)panels.toggle("right");}
  };
  const command=(id:string,params:Record<string,unknown>={})=>runPhotoCommand(id,params).then(()=>{},()=>{});
  const chooseSymmetry=(choice:string|null)=>{
    const id=document.id,remember=(value:string)=>setSymmetryChoice(current=>({...current,[id]:value}));
    if(choice===null){if(symmetryChoice[id])attempt(runPhotoCommand("paint.symmetryDisable").then(()=>remember("")));return;}
    attempt(runPhotoCommand("paint.symmetryFromPath",{name:choice.startsWith("saved:")?choice.slice(6):choice}).then(()=>remember(choice)));
  };
  // The engine has no one-step background removal; this is Select Subject followed by a mask from that selection, as in Photoshop.
  const removeBackground=()=>attempt((async()=>{if(currentLayer&&isBackgroundLayer(currentLayer))await runPhotoCommand("layer.new.layerFromBackground");await runPhotoCommand("select.subject");await runPhotoCommand("layer.layerMask.revealSelection");})());
  const textLayer=currentLayer?.text?currentLayer:undefined;
  // With a type layer selected the bar edits it live, as in Photoshop; otherwise it sets the next layer's defaults.
  const typePatch=(patch:Parameters<TypeBarProps["patch"]>[0])=>{
    if(patch.font!==undefined)setTextFont(patch.font);if(patch.size!==undefined)setTextSize(patch.size);if(patch.style)setTextStyle(patch.style);if(patch.align)setTextAlign(patch.align);if(patch.antialias)setTextAntialias(patch.antialias);if(patch.orientation)setTextOrientation(patch.orientation);
    if(!textLayer)return;const layer=textLayer.id;
    if(patch.antialias)command("type.edit",{layer,antialias:patch.antialias});else if(patch.orientation)command(`type.orientation.${patch.orientation}`,{layer});
    else command("type.setStyle",{layer,...(patch.font!==undefined?{font:patch.font}:{}),...(patch.size!==undefined?{size:patch.size}:{}),...(patch.style?typeStyleParams(patch.style,true):{}),...(patch.align?{align:patch.align}:{})});
  };
  const openCommand=(command:ImageCommand,initial?:Record<string,unknown>)=>setCommandDialog({command,initial});
  const openFillDialog=()=>openCommand(fillCommand(state?.presets?.patterns?.flatMap(group=>group.presets)??[],state?.presets?.pattern,historyBrushSource(state?.historySources,historySource)?.id));
  // The scale is read from the engine (no params = query) so both dialogs open on the document's current values.
  const withScale=(then:(scale:{pixelLength:number;logicalLength:number;units:string;factor:number})=>void)=>attempt(runPhotoCommand("image.analysis.setMeasurementScale",{}).then(reply=>then(reply as Parameters<typeof then>[0])));
  const openMarker=()=>withScale(({factor})=>{const target=document.width/5*factor,unit=10**Math.floor(Math.log10(target));openCommand(SCALE_MARKER,{length:Number(([5,2,1].map(step=>step*unit).find(length=>length<=target)??unit).toPrecision(6))});});
  const renameLayer=()=>{openPanel("Layers");setTimeout(()=>{if(state)window.dispatchEvent(new CustomEvent("xd-photo-rename-layer",{detail:state.activeLayer}));},60);};
  const findLayers=()=>{openPanel("Layers");setLayerFilter(filter=>({...filter,on:true,mode:"name"}));setTimeout(()=>window.document.querySelector<HTMLInputElement>(".xd-ps-layer-filter input[aria-label='Filter by layer name']")?.focus(),60);};
  const relinkSmartObject=()=>attempt(openFile({multiple:false,title:"Relink to File"}).then(path=>typeof path==="string"?runPhotoCommand("layer.smartObjects.relinkToFile",{path}):undefined));
  const startSelectionTransform=()=>{const bounds=currentState?.selectionBounds;if(!bounds)return;const from={x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]};setSelectionBox({from,box:from});};
  const commitSelectionTransform=()=>{if(!selectionBox||usePhotoWorkspace.getState().busy)return;const {from,box}=selectionBox;void command("select.transformSelection",{rect:[from.x,from.y,from.x+from.width,from.y+from.height],quad:[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]]}).finally(()=>setSelectionBox(null));};
  const fullCrop:CropBox={x:0,y:0,width:document.width,height:document.height},cropUntouched=!!cropBox&&Math.abs(cropAngle)<=.01&&cropBox.x===0&&cropBox.y===0&&cropBox.width===document.width&&cropBox.height===document.height&&!(cropSize&&(cropSize.width!==document.width||cropSize.height!==document.height||cropSize.ppi!==imagePpi));
  // After cropping, Fill paints the canvas the crop added (Content-Aware, or the background color on a Background layer when pixels are deleted) and a W x H x Resolution crop resamples,
  // all folded into Photoshop's single Crop step; a failed step undoes the crop.
  const commitCrop=()=>{
    if(!cropBox||cropUntouched||usePhotoWorkspace.getState().busy)return;if(cropBox.width*cropBox.height>256_000_000){setPreviewStatus("Choose a nonempty area within the image editing limits.");return;}
    const deleteCroppedPixels=toolOptions.deleteCroppedPixels===true,crop=Math.abs(cropAngle)>.01?runPhotoCommand("image.cropRotated",{...cropBox,angle:cropAngle,deleteCroppedPixels}):runPhotoCommand("image.crop",{...cropBox,deleteCroppedPixels});
    const size=cropSize&&(cropSize.width!==cropBox.width||cropSize.height!==cropBox.height||cropSize.ppi!==imagePpi)?cropSize:null,base=usePhotoWorkspace.getState().state?.historySources?.find(source=>source.current)?.index;
    const area=size?size.width*size.height-cropBox.width*cropBox.height:0,resample=!size||size.width===cropBox.width&&size.height===cropBox.height?"none":area>0?"preserveDetails":area<0?"lanczos":"bicubic";
    const added=cropAddedCanvas(cropBox,Math.abs(cropAngle)>.01?cropAngle:0,document.width,document.height),backgroundLayer=deleteCroppedPixels?state?.layers.find(isBackgroundLayer):undefined;
    const fill=!added?null:toolOptions.fill==="contentAware"?{contents:"contentAware"}:backgroundLayer?{contents:"background",layer:backgroundLayer.id}:null;
    const steps:[string,Record<string,unknown>][]=[];
    if(fill)steps.push(["select.lasso",{points:added}],["select.inverse",{}],["edit.fill",fill],["select.deselect",{}]);
    if(size)steps.push(["image.imageSize",{width:size.width,height:size.height,resolution:size.ppi,resample}]);
    void untilShown(crop.then(()=>steps.length?steps.reduce<Promise<unknown>>((done,[id,params])=>done.then(()=>runPhotoCommand(id,params)),Promise.resolve()).then(
      ()=>base!==undefined&&runPhotoCommand("history.fold",{from:base,label:"Crop"}),
      error=>{if(base!==undefined)void command("history.select",{index:base,discardRedo:true});throw error;}):undefined)).then(()=>{setCropBox(null);setCropAngle(0);setCropShift([0,0]);});
  };
  const resetCrop=()=>{setCropBox(fullCrop);setCropAngle(0);setCropShift([0,0]);};
  const snapCrop=(box:CropBox,from:CropBox)=>snapBox(cropAngle?null:snapContext(document.id,document.width,document.height,zoom,state?.resolution),box,from);
  // Box plus shift is the box's place on screen, which a pan keeps, so the image follows wherever snapping puts the box.
  const panCrop=(box:CropBox)=>{if(!cropBox)return;const next=snapCrop(box,cropBox);setCropBox(next);setCropShift([cropBox.x+cropShift[0]-next.x,cropBox.y+cropShift[1]-next.y]);};
  // Clipping keeps the shifted image out of the stage's scroll area, so no scrollbar appears and re-centres the box.
  const cropShifted=tool==="crop"&&!!cropBox&&(cropShift[0]!==0||cropShift[1]!==0);
  // A turned image keeps its layout box, so margins grow the scroll area to the box around it.
  const surfaceStyle=(width:number,height:number)=>{
    const transform=[cropShifted?`translate(${cropShift[0]*zoom}px, ${cropShift[1]*zoom}px)`:"",turnTransform(turn)].filter(Boolean).join(" "),[outerWidth,outerHeight]=turnedSize(width,height,turn.angle);
    return {width:`${width}px`,height:`${height}px`,...(transform?{transform}:{}),...(turn.angle?{margin:`${(outerHeight-height)/2}px ${(outerWidth-width)/2}px`}:{})};
  };
  const cloneSourceContext=JSON.stringify([projectId,document.id,document.version,displayState?.viewKey,cloneSources]);
  const updateCloneSource=(captured:string,id:"cloneSource.set"|"cloneSource.resetTransform",params:Record<string,unknown>)=>{
    const live=usePhotoWorkspace.getState();if(live.busy||!cloneSource?.source||useXDesign.getState().photoDocuments[live.documentId??""]?.version!==live.stateVersion||useXDProjects.getState().activeId!==live.projectId||captured!==JSON.stringify([live.projectId,live.documentId,live.stateVersion,live.state?.viewKey,live.state?.presets?.cloneSource]))return;
    command(id,{index:cloneSources!.active,...params});
  };
  const clipboard=(id:string)=>command(id,paintingMask?{target:"mask"}:{});
  const changedBrush=(brush:Record<string,unknown>)=>{if(typeof brush.size==="number")setSize(brush.size);if(typeof brush.opacity==="number")setOpacity(brush.opacity);if(typeof brush.hardness==="number")setHardness(brush.hardness);previousBrushBasis.current=brushOptionBasis(brush);setPaintOptions(rebaseBrushOptions);};
  const point=(e:PointerEvent<HTMLCanvasElement>):Point=>{
    const [fx,fy]=surfaceFraction(e.currentTarget,e.clientX,e.clientY),x=fx*document.width,y=fy*document.height;
    // Snap acts only on box-drag tools (marquee, crop draw); other tools keep raw positions.
    const [px,py]=RECTANGLE_TOOLS.includes(tool)||LINE_SELECTION_TOOLS.includes(tool)?snapXY(snapContext(document.id,document.width,document.height,zoom,state?.resolution),x,y):[x,y];
    return [px,py,e.pointerType==="pen"?e.pressure:1,e.tiltX||0,e.tiltY||0,e.twist||0,e.timeStamp];
  };
  /** The Sample Size square around a pixel, clipped to the image; the Info panel reads with it too, as in Photoshop. */
  const sampleBox=(x:number,y:number)=>{
    const half=Math.floor(sampleSize/2),left=Math.max(0,Math.floor(x)-half),top=Math.max(0,Math.floor(y)-half);
    return {x:left,y:top,width:Math.min(document.width,Math.floor(x)+half+1)-left,height:Math.min(document.height,Math.floor(y)+half+1)-top};
  };
  const sampleColor=(e:PointerEvent<HTMLCanvasElement>,key:"foreground"|"background")=>{
    const [x,y]=point(e);if(!projectId||x<0||y<0||x>=document.width||y>=document.height)return;
    const area={projectId,photoId:document.id,version:document.version,...sampleBox(x,y)};
    const work=(tool==="eyedropper"&&sampleLayer!=="all"&&currentLayer?sampleLayerColor({...area,layer:currentLayer.id,aboveHidden:sampleLayer==="currentBelow"}):sampleImageColor({...area,viewKey:displayState?.viewKey??null})).then(hex=>{
      if(!hex){setPreviewStatus("There is no color at that point.");return;}
      setRing(current=>current&&{...current,color:grayscaleTarget&&key==="foreground"?grayHex(hex):hex});
      if(grayscaleTarget&&key==="foreground")setChannelColor(grayHex(hex));else changeColor(key,hex);
    }).catch(error=>{setPreviewStatus(String(error));});
    attempt(work);return work;
  };
  const clearCloneMarker=()=>{for(const element of [cloneMarker.current,cloneOverlay.current])if(element)element.style.display="none";};
  const drawCloneMarker=(at:readonly number[])=>{
    const element=cloneMarker.current;if(!element||isDesignDialogOpen()||geometryActive||viewPreview.active&&!viewPreview.url||!["paint.cloneStamp","paint.healingBrush"].includes(tool)||at[0]!<0||at[1]!<0||at[0]!>document.width||at[1]!>document.height){clearCloneMarker();return;}
    const first=stroke.current[0],params=strokeParameters(tool,[],size,opacity,hardness,paintColorValue,zoom,null,toolOptions,paintingMask,null,null);
    const source=cloneSourcePoint(cloneSource,[at[0]!,at[1]!],first?[first[0],first[1]]:null,params);if(!source){clearCloneMarker();return;}
    const [x,y]=source,arm=7/zoom;for(const path of element.querySelectorAll("path"))path.setAttribute("d",`M${x-arm} ${y}H${x+arm}M${x} ${y-arm}V${y+arm}`);
    element.setAttribute("data-source-x",String(x));element.setAttribute("data-source-y",String(y));element.style.display="";
    const shown=cloneOverlay.current,options=cloneSources?.overlay,transform=shown&&options?.show&&!(options.auto_hide&&stroke.current.length)?cloneOverlayTransform(cloneSource,[at[0]!,at[1]!],first?[first[0],first[1]]:null,params):null;
    if(!shown)return;if(!transform){shown.style.display="none";return;}
    shown.querySelector("image")!.setAttribute("transform",transform);const circle=shown.querySelector("circle")!;circle.setAttribute("cx",String(at[0]));circle.setAttribute("cy",String(at[1]));circle.setAttribute("r",String(size/2));shown.style.display="";
  };
  const clear=()=>{const c=overlay.current;c?.getContext("2d")?.clearRect(0,0,c.width,c.height);clearCloneMarker();movePreview.current?.(null);};
  // The canvas keeps the previous image until the committed one decodes, so whatever stands in for
  // an edit (outline, crop box, text field, transform preview) stays until then instead of
  // uncovering the unedited pixels for a moment.
  const imageShown=()=>{clear();const waiting=shownWaiters.current;shownWaiters.current=[];for(const resolve of waiting)resolve();};
  const untilShown=(work:Promise<unknown>)=>{
    const id=document.id,from=document.version;
    return work.then(()=>{},()=>{}).then(()=>{if(useXDesign.getState().photoDocuments[id]?.version!==from)return new Promise<void>(resolve=>{shownWaiters.current.push(resolve);window.setTimeout(resolve,2000);});});
  };
  const clearWhenShown=(work:Promise<unknown>)=>{void untilShown(work).then(()=>{if(!stroke.current.length)clear();});};
  // Snap To › Layers and Smart Guides pull the moving layers' edges and centres onto other layers', the canvas's and guides'.
  const moveSnap=(dx:number,dy:number):MoveSnap=>{
    const flags=useViewAids.getState().flags,smart=flags.extras&&flags.smartGuides,moving=boxUnion(selectedBoxes()),plain={dx:Math.round(dx),dy:Math.round(dy),lines:[]};
    const layers=smart||flags.snap&&flags.snapTo.layers,bounds=smart||flags.snap&&flags.snapTo.bounds,guides=flags.snap&&flags.snapTo.guides&&guidesVisible(flags);
    if(!moving||!state||!layers&&!bounds&&!guides)return plain;
    const skip=new Set(state.selectedLayers?.length?state.selectedLayers:[state.activeLayer]),boxes:[number,number,number,number][]=bounds?[[0,0,document.width,document.height]]:[];
    const walk=(list:PhotoLayer[])=>{for(const layer of list){if(skip.has(layer.id)||!layer.visible)continue;if(layer.children)walk(layer.children);else if(layer.bounds&&layer.bounds[2]>0&&layer.bounds[3]>0)boxes.push(layer.bounds);}};
    if(layers)walk(state.layers);
    const snapped=snapMove(moving,dx,dy,boxTargets(boxes,guides?documentGuides(document.id):[]),SNAP_PX/zoom);
    return smart?snapped:{...snapped,lines:[]};
  };
  const draw=()=>{
    const c=overlay.current,ctx=c?.getContext("2d");if(!c||!ctx)return;
    ctx.clearRect(0,0,c.width,c.height);const sx=c.width/document.width,sy=c.height/document.height;
    if(tool==="paint.magicEraser")return;
    if(tool==="paint.backgroundEraser"){
      const latest=stroke.current.at(-1);if(!latest)return;const accent=getComputedStyle(c).getPropertyValue("--neon-magenta").trim()||"rgba(255,255,255,.65)";
      ctx.strokeStyle=accent;ctx.globalAlpha=.7;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(latest[0]*sx,latest[1]*sy,Math.max(2,size*sx/2),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;return;
    }
    if(tool==="paint.patch"&&patchDrag.current){
      const {start,current}=patchDrag.current;const x0=start[0]*sx,y0=start[1]*sy,x1=current[0]*sx,y1=current[1]*sy,angle=Math.atan2(y1-y0,x1-x0),head=10;
      const accent=getComputedStyle(c).getPropertyValue("--neon-magenta").trim();ctx.strokeStyle=accent;ctx.fillStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.lineTo(x1-head*Math.cos(angle-Math.PI/6),y1-head*Math.sin(angle-Math.PI/6));ctx.moveTo(x1,y1);ctx.lineTo(x1-head*Math.cos(angle+Math.PI/6),y1-head*Math.sin(angle+Math.PI/6));ctx.stroke();
      const offset=patchOffset(start,current);if(offset){ctx.font=`12px ${getComputedStyle(c).getPropertyValue("--font-code").trim()||"monospace"}`;ctx.fillText(`${offset[0]>0?"+":""}${offset[0]}, ${offset[1]>0?"+":""}${offset[1]} px`,x1+8,y1-8);}
      return;
    }
    const all=stroke.current;if(!all.length||strokeCount.current>=all.length)return;const points=all.slice(Math.max(0,strokeCount.current-1));
    // Native pixels already show the stroke; a placeholder line would flash over them.
    if(nativeStroke.current)return;
    ctx.strokeStyle=tool==="erase"?"rgba(255,255,255,.65)":paintColor;ctx.lineWidth=tool==="select.quick"?Number(toolOptions.size)*sx:size*sx;ctx.lineCap="round";ctx.globalAlpha=selectionTool||tool==="crop"||tool==="straighten"||SHAPE_TOOLS.includes(tool)||tool==="pen.freeform"?1:opacity;
    ctx.beginPath();
    if(tool==="move"||springMove.current){
      const p=points.at(-1)!,moved=moveSnap(p[0]-points[0]![0],p[1]-points[0]![1]);
      if(moved.lines.length){
        ctx.save();ctx.globalAlpha=1;ctx.lineWidth=sx/zoom;ctx.strokeStyle=usePreferences.getState().smartGuides.color;
        for(const line of moved.lines){if(line.axis==="v"){ctx.moveTo(line.pos*sx,0);ctx.lineTo(line.pos*sx,c.height);}else{ctx.moveTo(0,line.pos*sy);ctx.lineTo(c.width,line.pos*sy);}}
        ctx.stroke();ctx.restore();ctx.beginPath();
      }
      if(movePreview.current?.([moved.dx,moved.dy]))return;if(currentLayer?.bounds){const b=currentLayer.bounds;ctx.lineWidth=1;ctx.strokeStyle="#fff";ctx.globalAlpha=1;ctx.rect((b[0]+moved.dx)*sx,(b[1]+moved.dy)*sy,b[2]*sx,b[3]*sy);}
    }
    else if(PEN_DRAFT_TOOLS.includes(tool)){
      const cursor=polygonCursor.current&&!penDragging.current?polygonCursor.current:null,curvature=tool==="pen.curvature";
      const anchors:readonly (readonly number[])[]=curvature&&cursor?[...all,cursor]:all,handles=curvature?smoothHandles(anchors.map(point=>[point[0]!,point[1]!] as XY),false):penHandles.current;
      const control=(index:number,incoming:boolean):readonly number[]=>{const anchor=anchors[index]!,handle=handles[index];return handle?incoming?[2*anchor[0]!-handle[0],2*anchor[1]!-handle[1]]:handle:anchor;};
      ctx.lineWidth=1;ctx.strokeStyle="#fff";ctx.globalAlpha=1;ctx.moveTo(anchors[0]![0]!*sx,anchors[0]![1]!*sy);
      for(let index=1;index<anchors.length;index++){const from=control(index-1,false),to=control(index,true),anchor=anchors[index]!;ctx.bezierCurveTo(from[0]!*sx,from[1]!*sy,to[0]!*sx,to[1]!*sy,anchor[0]!*sx,anchor[1]!*sy);}
      if(cursor&&!curvature){const from=control(anchors.length-1,false);ctx.bezierCurveTo(from[0]!*sx,from[1]!*sy,cursor[0]*sx,cursor[1]*sy,cursor[0]*sx,cursor[1]*sy);}
      const last=all.at(-1)!,handle=curvature?null:handles.at(-1);if(handle){ctx.moveTo((2*last[0]-handle[0])*sx,(2*last[1]-handle[1])*sy);ctx.lineTo(handle[0]*sx,handle[1]*sy);}
    }
    else if(LINE_SELECTION_TOOLS.includes(tool)){const line=lineSelection(tool,points.at(-1)!,document);ctx.lineWidth=1;ctx.strokeStyle="#fff";if(line)ctx.rect(line.x*sx,line.y*sy,line.width*sx,line.height*sy);}
    else if(RECTANGLE_TOOLS.includes(tool)||tool==="shape.rect"||tool==="shape.ellipse"||POLYGON_TOOLS.includes(tool)) {const rect=gestureRectangle(points[0]!,points.at(-1)!,gestureOptions,gestureStart.current,gestureCurrent.current);ctx.lineWidth=1;ctx.strokeStyle="#fff";if(rect){if(POLYGON_TOOLS.includes(tool)){const sides=tool==="shape.triangle"?3:polygonSides,ratio=tool==="shape.triangle"?1:starRatio/100;polygonPoints(polygonRect(rect,sides,ratio),sides,ratio).forEach(([x,y],index)=>index?ctx.lineTo(x*sx,y*sy):ctx.moveTo(x*sx,y*sy));ctx.closePath();}else if(tool==="ellipseSelection"||tool==="shape.ellipse")ctx.ellipse((rect.x+rect.width/2)*sx,(rect.y+rect.height/2)*sy,rect.width/2*sx,rect.height/2*sy,0,0,Math.PI*2);else ctx.rect(rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy);}}
    else if(tool==="perspectiveCrop"||tool==="paint.redEye"){const a=all[0]!,b=all.at(-1)!;ctx.lineWidth=1;ctx.strokeStyle="#fff";ctx.globalAlpha=1;ctx.rect(a[0]*sx,a[1]*sy,(b[0]-a[0])*sx,(b[1]-a[1])*sy);}
    else if(tool==="straighten"||tool==="shape.line"||tool==="crop"&&cropStraighten){ctx.lineWidth=1;ctx.strokeStyle="#fff";ctx.moveTo(all[0]![0]*sx,all[0]![1]*sy);ctx.lineTo(all.at(-1)![0]*sx,all.at(-1)![1]*sy);}
    else {ctx.moveTo(points[0]![0]*sx,points[0]![1]*sy);if(selectionTool||tool==="pen.freeform"){ctx.strokeStyle="#fff";if(tool!=="select.quick")ctx.lineWidth=1;}for(const p of points) ctx.lineTo(p[0]*sx,p[1]*sy);if(polygonDraft.current&&polygonCursor.current)ctx.lineTo(polygonCursor.current[0]*sx,polygonCursor.current[1]*sy);}
    ctx.stroke();
  };
  redrawStroke.current=draw;
  // Photoshop's rubber band: with Shift held after a stroke, a thin line from where it ended shows the line a click will paint.
  const showLineHint=(shift:boolean)=>{
    const c=overlay.current,ctx=c?.getContext("2d"),end=lastStrokeEnd.current,at=tipPointer.current,from=end?.document===document.id?end.point:null;
    const show=shift&&brushTool&&!!from&&!!at;if(!c||!ctx||stroke.current.length||!show&&!lineHint.current)return;
    ctx.clearRect(0,0,c.width,c.height);lineHint.current=show;if(!show||!from||!at)return;
    const [shownWidth,shownHeight]=surfaceSize(c),[x,y]=surfaceOffset(c,at.x,at.y),unit=c.width/shownWidth;
    for(const [width,color] of [[2.5,"rgba(0,0,0,.47)"],[1,"rgba(255,255,255,.9)"]] as const){ctx.lineWidth=width*unit;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(from[0]*c.width/document.width,from[1]*c.height/document.height);ctx.lineTo(x*unit,y*c.height/shownHeight);ctx.stroke();}
  };
  // Shift-click after a stroke paints a straight line from where it ended, as one stroke and one undo step.
  const strokeStart=(e:PointerEvent<HTMLCanvasElement>):Point[]=>{
    const at=point(e),end=lastStrokeEnd.current;strokeAxis.current=null;
    if(!brushTool||!e.shiftKey||end?.document!==document.id)return [at];
    const from=[...at] as Point;from[0]=end.point[0];from[1]=end.point[1];return [from,at];
  };
  // Shift keeps painting strokes on 0°, 45° or 90° lines and snaps the gradient angle to 45°.
  const constrained=(p:Point,shift:boolean):Point|null=>{
    const first=stroke.current[0],last=stroke.current.at(-1);if(!first||!last||springMove.current||!brushTool&&tool!=="paint.gradient")return p;
    const [x,y]=tool==="paint.gradient"?shift?snap45([first[0],first[1]],[p[0],p[1]]):[p[0],p[1]]:constrain(strokeAxis,[last[0],last[1]],[p[0],p[1]],shift,zoom);
    if(shift&&x===last[0]&&y===last[1])return null;
    const next=[...p] as Point;next[0]=x;next[1]=y;return next;
  };
  // Photoshop's ⌃⌥-drag (⌥-right-drag on Windows), as in Photocraft's brush_resize.rs: the circle stays where the drag began,
  // its edge follows the pointer left and right, and every 200 screen px down adds 100% hardness. Tool state only, no history step.
  const resizeBrush=(e:PointerEvent<HTMLCanvasElement>)=>{
    const resize=brushResize.current;if(!resize||resize.pointerId!==e.pointerId)return false;
    const diameter=Math.max(1,Math.min(tool==="paint.backgroundEraser"||tool==="select.quick"?5000:1000,Math.round(resize.size+2*(point(e)[0]-resize.imageX))));
    if(tool==="select.quick")setPaintOptions(current=>({...current,[tool]:{...current[tool],size:diameter}}));
    else{setSize(diameter);setHardness(Math.round(Math.max(0,Math.min(1,resize.hardness+(e.clientY-resize.client.y)/200))*100)/100);}
    setResizeReadout({x:e.clientX,y:e.clientY});return true;
  };
  const endBrushResize=()=>{brushResize.current=null;setResizeReadout(null);};
  const previewStroke=()=>{
    const scroller=stage.current,imageBox=image.current,preview=nativeStroke.current;if(!preview||!scroller||!imageBox||tool!=="paint.patch"&&seed.current===null)return;
    if(tool==="paint.backgroundEraser"){
      if(eraserPreviewCapped.current)return;
      if(!backgroundEraserPreviewSampleAllowed(stroke.current.length)){eraserPreviewCapped.current=true;preview.clearReplacement();setPreviewStatus("Background Eraser feedback is limited to 4,096 samples and 1 MiB; the full stroke will be applied on release.");return;}
    }
    const area=visibleArea(scroller,imageBox,zoom,document.width,document.height);
    const x=Math.max(0,Math.floor(area.x)),y=Math.max(0,Math.floor(area.y));
    const width=Math.max(0,Math.min(document.width-x,Math.ceil(area.x+area.width)-x)),height=Math.max(0,Math.min(document.height-y,Math.ceil(area.y+area.height)-y));
    const viewport=strokeSurface.current===surface?{x:0,y:0,width:document.width,height:document.height,scale:1}:{x,y,width,height,scale:tileScale(zoom,window.devicePixelRatio||1)};
    if(tool==="paint.patch"){
      const drag=patchDrag.current,offset=drag&&patchOffset(drag.start,drag.current);
      if(!drag||!offset||!patchOffsetFitsCanvas(offset,drag.bounds,document.width,document.height)){preview.clearReplacement();return;}
      preview.replace({count:++patchPreviewCount.current,params:{offset,mode:drag.mode,...drag.target},viewport});return;
    }
    if(tool==="paint.magicEraser"||tool==="paint.backgroundEraser"){
      const drag=eraserGesture.current;if(!drag)return;
      let params:Record<string,unknown>|null;
      if(tool==="paint.magicEraser")params=magicEraserParams(stroke.current[0]??[],toolOptions);
      else params=strokeParameters(tool,stroke.current,size,opacity,hardness,paintColorValue,zoom,seed.current,toolOptions,false,null,null);
      if(!params){preview.clearReplacement();return;}
      params={...params,_orionTargetLayer:drag.layerId,_orionTargetMode:"compositePixels"};
      if(tool==="paint.backgroundEraser"&&!backgroundEraserPreviewAllowed(params)){eraserPreviewCapped.current=true;preview.clearReplacement();setPreviewStatus("Background Eraser feedback is limited to 4,096 samples and 1 MiB; the full stroke will be applied on release.");return;}
      preview.replace({count:tool==="paint.magicEraser"?1:stroke.current.length,params,viewport});return;
    }
    preview.request({count:stroke.current.length,params:strokeParameters(tool,stroke.current,size,opacity,hardness,paintColorValue,zoom,seed.current,toolOptions,paintingMask,null,null),viewport});
  };
  const beginStrokeSurface=()=>{const space=previewCoversScreen(document,zoom,window.devicePixelRatio||1)?surface:tileSurface;space.begin();strokeSurface.current=space;return space;};
  const strokePixels=(space:PreviewSurface|TileSurface,command:string)=>{
    const {id,version,width,height}=document,view=viewPreview.active,factor=Math.max(1,Math.ceil(Math.max(width,height)/2048)),viewKey=displayState?.viewKey;
    return {
      load:(request:StrokePreviewRequest)=>invoke<ArrayBuffer>(space===surface?"xdesign_photo_stroke_preview_pixels":"xdesign_photo_stroke_pixels",{projectId,photoId:id,version,viewKey,command,params:request.params,...(space===surface?{view}:request.viewport)}),
      paint:(data:unknown,request:StrokePreviewRequest|null,replace:boolean)=>space.paint(data===null||!request?[]:space===surface?parseStrokePixels(data,1,view?Math.ceil(width/factor):document.previewWidth,view?Math.ceil(height/factor):document.previewHeight,Infinity):parseStrokePixels(data,request.viewport.scale??1,width,height),replace),
    };
  };
  const takeGesture=():StrokeGesture|null=>{const feedback=nativeStroke.current;if(!feedback)return null;const gesture={feedback,space:strokeSurface.current,end:strokeEnd.current};nativeStroke.current=null;strokeSurface.current=null;strokeEnd.current=null;return gesture;};
  const endGesture=(gesture:StrokeGesture)=>gesture.end?.();
  const dropGesture=(gesture:StrokeGesture|null)=>{if(!gesture)return;gesture.feedback.dispose();gesture.space?.restore();endGesture(gesture);};
  // The gesture stays busy until the feedback still in flight has painted, so the last samples
  // never land after the commit and the released stroke shows exactly what commits.
  const commitGesture=(gesture:StrokeGesture|null,id:string,params:Record<string,unknown>)=>{
    const from=document.version,space=gesture?.space;
    const run=async()=>{
      if(gesture)try{await gesture.feedback.end();}finally{endGesture(gesture);}
      await runPhotoCommand(id,params);
      if(useXDesign.getState().photoDocuments[document.id]?.version===from)space?.restore();else space?.settle();
    };
    attempt(run().catch(error=>{space?.restore();throw error;}).finally(()=>{gesture?.feedback.releaseFeedback();clear();}));
  };
  const finish=(e:PointerEvent<HTMLCanvasElement>)=>{
    const scrubbed=scrub.current;if(scrubbed&&scrubbed.pointerId===e.pointerId){scrub.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!scrubbed.moved)zoomAt(z=>scrubbed.out?z/1.25:z*1.25,scrubbed.x,scrubbed.y);return;}
    if(sampleDrag.current&&sampleDrag.current.pointerId===e.pointerId){sampleDrag.current=null;setRing(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);return;}
    const held=heldStroke.current;if(held&&held.pointerId===e.pointerId){held.up=heldSample(e);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);return;}
    if(resizeBrush(e)){endBrushResize();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);return;}
    if(panDrag.current){if(panDrag.current.pointerId===e.pointerId){panDrag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}return;}
    if(penDragging.current){
      penDragging.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
      const anchor=stroke.current.at(-1),handle=penHandles.current.at(-1),[shownWidth,shownHeight]=surfaceSize(e.currentTarget);
      if(anchor&&handle&&Math.hypot((handle[0]-anchor[0])*shownWidth/document.width,(handle[1]-anchor[1])*shownHeight/document.height)<3)penHandles.current[penHandles.current.length-1]=null;
      draw();return;
    }
    if(polygonDraft.current)return;
    const patch=patchDrag.current;
    if(tool==="paint.patch"&&patch){
      if(patch.pointerId!==(e.pointerId??1))return;
      const last=point(e).slice(0,2) as [number,number],moved=last[0]!==patch.current[0]||last[1]!==patch.current[1];patch.current=last;draw();if(moved)previewStroke();
      const offset=patchOffset(patch.start,patch.current),gesture=takeGesture();
      resetStroke();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
      const liveWorkspace=usePhotoWorkspace.getState(),liveProject=useXDProjects.getState(),liveDoc=useXDesign.getState().photoDocuments[patch.photoId],liveState=liveWorkspace.state;
      const liveTarget=patchTarget({layer:liveState?.layerMaskView?.layer??liveState?.activeLayer??null,mask:paintingMask,quickMask:!!liveState?.quickMask&&liveState?.channels?.target?.kind!=="alpha",channel:liveState?.channels?.target});
      const sameBounds=JSON.stringify(liveState?.selectionBounds??null)===JSON.stringify(patch.bounds)&&liveState?.hasSelection===true;
      const sameContext=patch.projectId===projectId&&patch.projectId===activeProjectId&&liveProject.activeId===patch.projectId&&liveWorkspace.projectId===patch.projectId&&!liveProject.transitioning&&patch.photoId===document.id&&liveWorkspace.documentId===patch.photoId&&patch.version===document.version&&patch.version===liveWorkspace.stateVersion&&patch.version===liveDoc?.version&&patch.viewKey===(displayState?.viewKey??"")&&patch.viewKey===(liveState?.viewKey??"")&&sameBounds&&JSON.stringify(liveTarget)===JSON.stringify(patch.target);
      if(!sameContext){dropGesture(gesture);setPreviewStatus("The image changed; start the Patch drag again.");return;}
      if(!offset){dropGesture(gesture);setPreviewStatus("Drag the selection by at least one image pixel.");return;}
      if(!patchOffsetFitsCanvas(offset,patch.bounds,document.width,document.height)){dropGesture(gesture);setPreviewStatus("The translated selection must stay inside the image.");return;}
      commitGesture(gesture,"paint.patch",{offset,mode:patch.mode,...patch.target});return;
    }
    if((tool==="paint.magicEraser"||tool==="paint.backgroundEraser")&&eraserGesture.current){
      if(strokePointer.current!==e.pointerId)return;
      const captured=eraserGesture.current,points=stroke.current,strokeSeed=seed.current;let commitOverflow=eraserCommitOverflow.current;
      if(tool==="paint.backgroundEraser"&&!commitOverflow){const last=points.at(-1)!,end=constrained(point(e),e.shiftKey)??last;if(end[0]!==last[0]||end[1]!==last[1]){if(points.length>=BACKGROUND_ERASER_COMMIT_SAMPLES){eraserCommitOverflow.current=true;commitOverflow=true;}else{points.push(end);previewStroke();}}}
      const ended=points.at(-1);if(tool==="paint.backgroundEraser"&&ended)lastStrokeEnd.current={document:document.id,point:[ended[0],ended[1]]};
      const params=tool==="paint.magicEraser"?magicEraserParams(points[0]??[],toolOptions):strokeParameters(tool,points,size,opacity,hardness,paintColorValue,zoom,strokeSeed,toolOptions,false,null,null);
      const gesture=takeGesture();resetStroke();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
      const liveWorkspace=usePhotoWorkspace.getState(),liveProject=useXDProjects.getState(),liveDoc=useXDesign.getState().photoDocuments[captured.photoId],liveState=liveWorkspace.state;
      const liveLayer=liveState&&findLayer(liveState.layers,liveState.activeLayer);
      const liveTarget:EraserTargetState={activeLayer:liveState?.activeLayer??null,layerKind:liveLayer?.kind??null,channelKind:liveState?.channels?.target?.kind??"composite",maskView:!!liveState?.layerMaskView,quickMask:!!liveState?.quickMask,paintingMask:maskRef.current};
      const liveContext:EraserGestureContext={projectId:liveWorkspace.projectId??"",photoId:liveWorkspace.documentId??"",version:liveWorkspace.stateVersion??"",viewKey:liveState?.viewKey??"",layerId:liveState?.activeLayer??-1,target:liveTarget};
      if(commitOverflow){dropGesture(gesture);setPreviewStatus("Background Eraser exceeded the native 131,072-sample limit; no pixels were changed.");return;}
      if(!params||!sameEraserGesture(captured,liveContext)||liveProject.activeId!==captured.projectId||liveProject.transitioning||liveDoc?.version!==captured.version){dropGesture(gesture);setPreviewStatus("The image or editing target changed; start the eraser gesture again.");return;}
      if(tool==="paint.backgroundEraser"&&!backgroundEraserCommitAllowed(params)){dropGesture(gesture);setPreviewStatus("Background Eraser exceeded the native 131,072-sample or 16 MiB request limit; no pixels were changed.");return;}
      commitGesture(gesture,tool,params);return;
    }
    if(!stroke.current.length||strokePointer.current!==e.pointerId)return;
    gestureCurrent.current={shiftKey:e.shiftKey,altKey:e.altKey};
    const end=constrained(point(e),e.shiftKey),previous=stroke.current.at(-1)!;if(end&&(end[0]!==previous[0]||end[1]!==previous[1]))stroke.current.push(end);
    const moving=tool==="move"||springMove.current,selection=!moving&&(selectionTool||tool==="crop"||tool==="straighten")?selectionGestureCommand(tool,stroke.current,gestureOptions,selectionGestureMode(selectionMode,gestureStart.current,tool),gestureStart.current,gestureCurrent.current,document):null;
    const points=stroke.current,strokeSeed=seed.current,cloneContext=cloneGesture.current;
    if(nativeStroke.current)previewStroke();
    const gesture=takeGesture();resetStroke(true);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    const first=points[0]!,last=points.at(-1)!;if(brushTool&&!moving)lastStrokeEnd.current={document:document.id,point:[last[0],last[1]]};
    if(moving){const {dx,dy}=moveSnap(last[0]-first[0],last[1]-first[1]);movePreview.current?.(dx||dy?"hold":null);if(dx||dy)clearWhenShown(command("layer.translate",{dx,dy}));return;}
    if(tool==="pen.freeform"){
      const anchors=simplifyPath(points.map(point=>[point[0],point[1]] as XY),1.5/zoom),[shownWidth,shownHeight]=surfaceSize(e.currentTarget);
      if(anchors.length<2||anchors.length<3&&Math.hypot(last[0]-first[0],last[1]-first[1])<1){clear();setPreviewStatus("Drag to draw a path at least one image pixel long.");return;}
      const closed=anchors.length>3&&Math.hypot((last[0]-first[0])*shownWidth/document.width,(last[1]-first[1])*shownHeight/document.height)<=6;
      if(closed)anchors.pop();
      createPenPath(anchors,smoothHandles(anchors,closed),closed);return;
    }
    if(SHAPE_TOOLS.includes(tool)){
      const rect=tool==="shape.line"?null:gestureRectangle(first,last,toolOptions,gestureStart.current,gestureCurrent.current);
      if(tool==="shape.line"?Math.hypot(last[0]-first[0],last[1]-first[1])<1:!rect||rect.width<1||rect.height<1){clear();setPreviewStatus("Drag to draw a shape at least one image pixel in size.");return;}
      const sides=tool==="shape.triangle"?3:polygonSides,ratio=tool==="shape.triangle"?1:starRatio/100;
      clearWhenShown(command("shape.create",shapeCreateParams(tool==="shape.line"?{kind:"line",from:first.slice(0,2),to:last.slice(0,2),weight:lineWeight}:POLYGON_TOOLS.includes(tool)?{kind:"polygon",rect:polygonRect(rect!,sides,ratio),sides,...(ratio<1?{starRatio:ratio}:{})}:{kind:tool==="shape.ellipse"?"ellipse":cornerRadius>0?"roundedRect":"rect",rect:[rect!.x,rect!.y,rect!.width,rect!.height],...(tool==="shape.rect"&&cornerRadius>0?{radii:cornerRadius}:{})})));return;
    }
    if(tool==="perspectiveCrop"){
      clear();
      if(!currentState?.features?.perspectiveCrop)return;
      const x=(v:number)=>Math.max(0,Math.min(document.width,Math.round(v))),y=(v:number)=>Math.max(0,Math.min(document.height,Math.round(v)));
      const left=x(Math.min(first[0],last[0])),right=x(Math.max(first[0],last[0])),top=y(Math.min(first[1],last[1])),bottom=y(Math.max(first[1],last[1]));
      if(right-left<1||bottom-top<1){setPreviewStatus("Drag a box at least one image pixel in size.");return;}
      openPerspectiveCrop([[left,top],[right,top],[right,bottom],[left,bottom]]);return;
    }
    if(tool==="crop"&&cropStraighten){
      const a=points[0]!,b=points.at(-1)!;
      if(Math.hypot(b[0]-a[0],b[1]-a[1])>=1){
        // The box turns to lie along the drawn line, so applying the crop levels it; the nearest axis counts, as in Photoshop.
        const degrees=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI,level=degrees-Math.round(degrees/90)*90;setCropAngle(level);
        if(!cropBox||cropUntouched){const radians=Math.abs(level)*Math.PI/180,fit=Math.min(1,document.width/(document.width*Math.cos(radians)+document.height*Math.sin(radians)),document.height/(document.width*Math.sin(radians)+document.height*Math.cos(radians))),width=Math.max(1,Math.floor(document.width*fit)),height=Math.max(1,Math.floor(document.height*fit));setCropBox({x:Math.round((document.width-width)/2),y:Math.round((document.height-height)/2),width,height});}
      }else setPreviewStatus("Draw a reference line at least one image pixel long.");
      setCropStraighten(false);clear();return;
    }
    if(selectionTool||tool==="crop"||tool==="straighten"){if(selection&&tool==="crop"){const {x,y,width,height}=selection.params as CropBox;setCropBox({x,y,width,height});setCropAngle(0);}else if(tool==="crop")setCropBox(box=>box??fullCrop);else if(selection){clearWhenShown(command(selection.id,selection.params));return;}else setPreviewStatus(tool==="straighten"?"Draw a reference line at least one image pixel long.":"Choose a nonempty area within the image editing limits.");clear();return;}
    if(tool==="paint.redEye"){
      // A drag of a few screen pixels or more is a box; anything less is a click at the press point.
      const [shownWidth,shownHeight]=surfaceSize(e.currentTarget),box=Math.abs(last[0]-first[0])*shownWidth/document.width>=3&&Math.abs(last[1]-first[1])*shownHeight/document.height>=3;
      clearWhenShown(command("paint.redEye",{...(box?{x:Math.min(first[0],last[0]),y:Math.min(first[1],last[1]),width:Math.abs(last[0]-first[0]),height:Math.abs(last[1]-first[1])}:{x:first[0],y:first[1]}),pupilSize:toolOptions.pupilSize,darken:toolOptions.darken}));return;
    }
    // Omit target for automatic native routing to color/alpha/Quick Mask.
    const params=strokeParameters(tool,points,size,opacity,hardness,paintColorValue,zoom,strokeSeed,toolOptions,paintingMask,null,null);
    let id=tool;
    delete params.eraseToHistory;
    if(tool==="erase"){
      if(eraseToHistory){id="paint.historyBrush";delete params.erase;Object.assign(params,{opacity:Math.round(opacity*100),hardness:Math.round(hardness*100),historySource:historyChoice!.id});delete params.smoothing;params.flow=toolOptions.flow;params.spacing=toolOptions.spacing;}
      else{id="paint.stroke";params.erase=true;}
    }
    if(tool==="paint.bucket")Object.assign(params,{x:first[0],y:first[1]});
    if(tool==="paint.gradient"){
      const editing=liveGradient&&!grayscaleTarget&&currentLayer?.gradientFill;
      if(liveGradient&&!grayscaleTarget)id=editing?"gradient.fill.set":"gradient.fill.create";
      if(liveGradient&&!grayscaleTarget)delete params.mode;
      const method=params.method;delete params.method;
      Object.assign(params,{from:first.slice(0,2),to:last.slice(0,2),style:gradientStyle,reverse:gradientReverse,...(!editing?(state?.presets?{...gradientPaintParams(state.presets.gradient,paintColorValue,backgroundValue),...(gradientTransparency||liveGradient&&!grayscaleTarget?{}:{transparency:[[0,100],[1,100]]})}:{stops:[[0,paintColorValue],[1,backgroundValue]]}):{})});
      if(editing)params.layer=currentLayer.id;
      // The engine blends stops linearly in sRGB, so other Methods go as dense baked stops (not for an existing fill, which keeps its stops).
      const stops=params.stops as GradientStop[]|undefined;
      if(!editing&&stops&&method!=="classic"&&GRADIENT_METHODS.some(([id])=>id===method)&&stops.every(stop=>typeof stop[1]==="string"&&/^#[\da-f]{6}$/i.test(stop[1]))){const baked=bakeRemembered(stops,method as GradientMethod);if(baked)params.stops=baked;}
    }
    if(tool==="paint.cloneStamp"||tool==="paint.healingBrush"){
      if(!cloneSource?.source){dropGesture(gesture);clear();usePhotoWorkspace.setState({error:"Alt-click the image to choose a source point first."});return;}
      const live=usePhotoWorkspace.getState();if(cloneContext!==JSON.stringify([live.projectId,live.documentId,live.stateVersion,live.state?.viewKey,live.state?.presets?.cloneSource])){dropGesture(gesture);clear();setPreviewStatus("The Clone Source changed; start the stroke again.");return;}
    }
    commitGesture(gesture,id,params);
  };
  const shapeCreateParams=(geometry:Record<string,unknown>)=>({...geometry,...shapeStyleParams(shapeStyle,paintColorValue),...(pathOp!=="new"&&activeKind==="Shape"&&state?.activeLayer!=null?{addTo:state.activeLayer,op:pathOp}:{})});
  const createPenPath=(anchors:XY[],handles:readonly (XY|null)[],closed:boolean)=>{
    const path={subpaths:[{closed,knots:penKnots(anchors,handles)}]};
    if(penMode==="shape")clearWhenShown(command("shape.create",shapeCreateParams({kind:"path",path})));
    else{setActivePath(null);clearWhenShown(command("path.set",{name:"work",path}));}
  };
  const finishPen=(closed:boolean)=>{
    const anchors=stroke.current.map(point=>[point[0],point[1]] as XY),handles=tool==="pen.curvature"?smoothHandles(anchors,closed):[...penHandles.current];
    if(anchors.length<2){setPreviewStatus("Add at least two anchor points before finishing the path.");return;}
    resetStroke(true);createPenPath(anchors,handles,closed);
  };
  const addPenPoint=(e:PointerEvent<HTMLCanvasElement>)=>{
    const next=point(e),[shownWidth,shownHeight]=surfaceSize(e.currentTarget),screen=(a:readonly number[],b:readonly number[])=>Math.hypot((a[0]!-b[0]!)*shownWidth/document.width,(a[1]!-b[1]!)*shownHeight/document.height);
    if(!polygonDraft.current){stroke.current=[next];penHandles.current=[null];polygonDraft.current=true;strokeEnd.current=beginXDesignActivity("photo-operation","Finish or cancel the path before switching projects or disabling XDesign.");setPreviewStatus(null);}
    else {
      if(stroke.current.length>=2&&screen(next,stroke.current[0]!)<=6){finishPen(true);return;}
      if(screen(next,stroke.current.at(-1)!)<=2)return;
      if(stroke.current.length>=8192){setPreviewStatus("Finish this path before adding more than 8192 anchor points.");return;}
      stroke.current.push(next);penHandles.current.push(null);
    }
    if(tool==="pen"){e.currentTarget.setPointerCapture(e.pointerId);penDragging.current=true;}polygonCursor.current=null;setPolygonVertices(stroke.current.length);draw();
  };
  const finishPolygon=()=>{
    if(!polygonDraft.current)return;
    if(PEN_DRAFT_TOOLS.includes(tool)){finishPen(false);return;}
    const selection=selectionGestureCommand(tool,stroke.current,toolOptions,selectionGestureMode(selectionMode,gestureStart.current,tool),gestureStart.current,gestureCurrent.current);
    if(!selection){setPreviewStatus("Add at least three vertices before finishing the polygon.");return;}
    resetStroke(true);clearWhenShown(command(selection.id,selection.params));
  };
  const addPolygonPoint=(e:PointerEvent<HTMLCanvasElement>)=>{
    const next=point(e);
    if(!polygonDraft.current){gestureStart.current={shiftKey:e.shiftKey,altKey:e.altKey};gestureCurrent.current=gestureStart.current;stroke.current=[next];polygonDraft.current=true;strokeEnd.current=beginXDesignActivity("photo-operation","Finish or cancel the polygon selection before switching projects or disabling XDesign.");setPreviewStatus(null);}
    else {
      const [shownWidth,shownHeight]=surfaceSize(e.currentTarget),first=stroke.current[0]!;
      if(stroke.current.length>=3&&Math.hypot((next[0]-first[0])*shownWidth/document.width,(next[1]-first[1])*shownHeight/document.height)<=6){finishPolygon();return;}
      if(stroke.current.length>=8192){setPreviewStatus("Finish this polygon before adding more than 8192 vertices.");return;}
      const previous=stroke.current.at(-1)!,xy=polygonPoint(previous,next,e.shiftKey);
      if(xy[0]!==previous[0]||xy[1]!==previous[1])stroke.current.push([xy[0],xy[1],...next.slice(2)] as Point);
    }
    polygonCursor.current=stroke.current.at(-1)!.slice(0,2) as [number,number];setPolygonVertices(stroke.current.length);draw();
  };
  const exportTo=async(path:string|null,quality?:number)=>{
    if(path){const warnings=await exportImage(path,quality);toast.info(exportOpen==="copy"?"Copy saved":"Image exported",warnings.length?{body:warnings.join("\n")}:undefined);}
  };
  const savedPsd=document.originalPath&&/\.(psd|psb)$/i.test(document.originalPath)?document.originalPath:null;
  const saveImage=()=>{if(savedPsd)attempt(exportImage(savedPsd).then(warnings=>toast.info(`Saved ${savedPsd.split(/[\\/]/).pop()}`,warnings.length?{body:warnings.join("\n")}:undefined)));else setExportOpen("export");};
  const editMask=(layer:PhotoLayer,event:MouseEvent)=>{
    if(event.altKey)attempt(runPhotoCommand("view.layerMask",{layer:layer.id,mode:event.shiftKey?"toggleOverlay":"toggleGray"}));
    else if(event.shiftKey)attempt(runPhotoCommand("layer.layerMask.enabled",{layer:layer.id}));
    else attempt(runPhotoCommand("layer.select",{layer:layer.id,target:"mask"}).then(()=>setMask(true)));
  };
  const hasSelection=!!currentState?.hasSelection,colorView=currentState?.colorView,typeText=currentLayer?.text,locks=currentLayer?.locks;
  const item=(label:string,run:()=>void,enabled=true,shortcut?:string):MenuItem=>({label,run,disabled:busy||!enabled,shortcut});
  const run=(label:string,id:string,enabled=true,shortcut?:string,params?:Record<string,unknown>)=>item(label,()=>command(id,params),enabled,shortcut);
  const styleable=!!currentLayer&&!isBackgroundLayer(currentLayer)&&!currentLayer.children,openStyle=(pane:LayerStylePane="blending")=>{if(styleable)setLayerStyle({layer:currentLayer.id,pane});};
  const blendingOptions=item("Blending Options…",()=>openStyle(),styleable);
  const styleItems:MenuEntry[]=[blendingOptions,"-",...LAYER_STYLE_EFFECTS.map(effect=>item(`${effect.label}…`,()=>openStyle(effect.key),styleable))];
  const isDirect=(action:PhotoAction)=>action.direct||action.id.startsWith("filter.")&&action.id!=="filter.lastFilter"&&!(action.fields?.length||action.options?.length||action.structured||action.file);
  // Photoshop opens HSB/HSL's options without an ellipsis on the item.
  const actionLabel=(action:PhotoAction)=>isDirect(action)||action.id==="filter.other.hsbHsl"?action.label:`${action.label.replace(" / ","/")}…`;
  const actionItem=(action:PhotoAction,adjustment:boolean,shortcut?:string)=>item(actionLabel(action),()=>{if(isDirect(action))command(action.id);else setDialog({action,adjustment});},adjustment||!!currentLayer,shortcut);
  // As in Photoshop, an adjustment layer is made with neutral values and then edited live in Properties; Image > Adjustments stays modal.
  const newAdjustmentLayer=(action:PhotoAction)=>attempt(addAdjustmentLayer(action).then(()=>openPanel("Properties")));
  // Photoshop records a layer made through its New Layer dialog as one step, so the dialog's options fold into the creation.
  const withLayerOptions=(create:()=>Promise<unknown>,props:Record<string,unknown>,label:string)=>{
    const base=usePhotoWorkspace.getState().state?.historySources?.find(source=>source.current)?.index;
    const {color,...rest}=props,steps=[...Object.keys(rest).length?[()=>runPhotoCommand("layer.setProps",rest)]:[],...color?[()=>runPhotoCommand("layer.setColor",{color})]:[]];
    return create().then(async()=>{if(!steps.length)return;for(const step of steps)await step();if(base!==undefined)await runPhotoCommand("history.fold",{from:base,label});});
  };
  const codeLayers=!!state&&(state.selectedLayers?.length?state.selectedLayers:[state.activeLayer]).some(id=>["Shape","Type"].includes(findLayer(state.layers,id)?.kind??""));
  const copyLayerCode=(id:"layer.copyCSS"|"layer.copySVG")=>{
    const text=runPhotoCommand(id).then(result=>(result as {text:string}).text);
    const failed=(error:unknown)=>usePhotoWorkspace.setState({error:`The clipboard could not be written: ${String(error)}`});
    // The app's WebKit still refuses the deferred write below, so the host puts the engine's text on the pasteboard.
    if(isTauri()){attempt(text.then(value=>invoke("xdesign_photo_copy_text",{text:value}).catch(failed),()=>{}));return;}
    // The write starts inside the click, with the text still on its way, so WebKit keeps the gesture's clipboard access.
    const write=typeof ClipboardItem==="function"&&navigator.clipboard?.write?navigator.clipboard.write([new ClipboardItem({"text/plain":text.then(value=>new Blob([value],{type:"text/plain"}))})]):text.then(value=>navigator.clipboard.writeText(value));
    attempt(write.catch(error=>text.then(()=>failed(error),()=>{})));
  };
  const pasteWithoutFormatting=()=>{
    const layer=currentLayer?.text?currentLayer.id:null;if(layer===null)return;
    const caret=lastTextCaret.current?.layer===layer?lastTextCaret.current.range:null;
    attempt((navigator.clipboard?.readText?navigator.clipboard.readText():Promise.reject(new Error("no clipboard access"))).then(async raw=>{
      const text=raw.replace(/\r\n?/g,"\n");
      if(!text){usePhotoWorkspace.setState({error:"The clipboard has no text."});return;}
      const result=await runPhotoCommand("type.insertText",{layer,text,label:"Paste",...(caret?{range:caret}:{})}) as {caret?:number}|undefined;
      if(typeof result?.caret==="number")lastTextCaret.current={layer,range:[result.caret,result.caret]};
    },error=>usePhotoWorkspace.setState({error:`The clipboard could not be read: ${String(error)}`})));
  };
  const insertGlyph=(text:string,family:string,style:string)=>{
    const layer=currentLayer?.text?currentLayer.id:null;if(layer===null)return;
    const caret=lastTextCaret.current?.layer===layer?lastTextCaret.current.range:null,font=currentLayer?.text?.font;
    attempt(runPhotoCommand("type.insertText",{layer,text,label:"Insert Glyph",...(caret?{range:caret}:{})}).then(async result=>{
      const end=(result as {caret?:number}|undefined)?.caret;if(typeof end!=="number")return;
      lastTextCaret.current={layer,range:[end,end]};
      // The inserted text takes the caret's formatting; a glyph picked from another face keeps that face, as in Photoshop.
      if(family!==font||style!==textStyle)await runPhotoCommand("type.setStyle",{layer,range:[end-[...text].length,end],font:family,fontStyle:style});
    }));
  };
  const duplicateTitle=(state?.selectedLayers?.length??1)>1?"Duplicate Layers":currentLayer?.children?"Duplicate Group":"Duplicate Layer";
  // The engine always names a copy "{name} copy"; Photoshop numbers it when that is taken, so any other name is set as part of the same step.
  const duplicateLayer=()=>{if(!state||!currentLayer)return;const several=(state.selectedLayers?.length??1)>1;setDuplicateDialog({title:duplicateTitle,source:several?"":currentLayer.name,name:several?null:copyName(state.layers,currentLayer.name),document:state.name,
    create:name=>name===null||name===`${currentLayer.name} copy`?runPhotoCommand("layer.duplicate",{}):withLayerOptions(()=>runPhotoCommand("layer.duplicate",{}),{name},"Duplicate Layer")});};
  const askNewLayer=(base:string,label:string,create:()=>Promise<unknown>,then?:()=>void)=>{if(state)setNewLayerDialog({name:nextLayerName(state.layers,base),kind:"other",create:({name,renamed,props})=>withLayerOptions(create,{...props,...renamed&&{name}},label).then(then)});};
  const newLayer=()=>{if(state)setNewLayerDialog({name:nextLayerName(state.layers,"Layer"),kind:"layer",create:({name,neutral,props})=>neutral
    // The engine's Fill keeps to the selection, but Photoshop fills the whole new layer, as a solid fill layer rasterised does.
    ?withLayerOptions(()=>runPhotoCommand("layer.newFillLayer.solidColor",{color:neutral}).then(()=>runPhotoCommand("layer.rasterize.fillContent",{})),{...props,name},"New Layer")
    :withLayerOptions(()=>runPhotoCommand("layer.new.layer",{name}),props,"New Layer")});};
  const newGroup=(fromLayers:boolean)=>{if(state)setNewLayerDialog({title:fromLayers?"New Group from Layers":"New Group",name:nextLayerName(state.layers,"Group"),kind:"group",create:({name,props})=>withLayerOptions(()=>runPhotoCommand(fromLayers?"layer.new.groupFromLayers":"layer.new.group",{name}),props,fromLayers?"Group Layers":"New Group")});};
  const layerFromBackground=()=>{if(state)setNewLayerDialog({name:"Layer 0",kind:"other",create:({name,renamed,props})=>withLayerOptions(()=>runPhotoCommand("layer.new.layerFromBackground",{}),{...props,...renamed&&{name}},"Layer From Background")});};
  // The Layer menu asks for the new layer's name and options first; the Layers panel's button makes it straight away, as in Photoshop.
  const adjustments=(layer:boolean,ask=false):MenuEntry[]=>ADJUSTMENT_ORDER.map(id=>{
    if(id==="-")return id;
    const action=ADJUSTMENTS.find(entry=>entry.id===id)!;
    if(layer&&ask)return item(actionLabel(action),()=>askNewLayer(action.label,`New ${action.label} Layer`,()=>addAdjustmentLayer(action),()=>openPanel("Properties")));
    if(layer)return item(actionLabel(action),()=>newAdjustmentLayer(action));
    if(id==="invert")return run("Invert","image.adjustments.invert",!!currentLayer,"Mod+I");
    return actionItem(action,false,ADJUSTMENT_SHORTCUTS[id]);
  });
  // Photoshop shows the new fill layer while its colour is picked; it is only added on OK.
  const solidFill=(hex:string,committing=false):CanvasDraft=>{const props=solidFillOptions.current;return {command:"layer.newFillLayer.solidColor",params:{color:hex,...props&&Object.keys(props).length&&{props}},committing};};
  const pickSolidFill=(options?:Record<string,unknown>)=>{solidFillOptions.current=options;setPicker("fillLayer");setFillDraft(solidFill(color));};
  const newGradientFill=(options:Record<string,unknown>={})=>{const base=usePhotoWorkspace.getState().state?.historySources?.find(source=>source.current)?.index;return withLayerOptions(()=>runPhotoCommand("layer.newFillLayer.gradient",{from:color,to:background,angle:90,style:"linear"}),options,"New Gradient Fill Layer").then(()=>{newFillBase.current=base;setImageDialog("newGradient");});};
  const fillLayerItems=(ask=false):MenuItem[]=>ask?[
    item("Solid Color…",()=>{if(state)setNewLayerDialog({name:nextLayerName(state.layers,"Color Fill"),kind:"other",create:async({name,renamed,props})=>pickSolidFill({...props,...renamed&&{name}})});}),
    item("Gradient…",()=>{if(state)setNewLayerDialog({name:nextLayerName(state.layers,"Gradient Fill"),kind:"other",create:({name,renamed,props})=>newGradientFill({...props,...renamed&&{name}})});}),
    item("Pattern…",()=>askNewLayer("Pattern Fill","New Pattern Fill Layer",()=>runPhotoCommand("layer.newFillLayer.pattern",{}))),
  ]:[
    item("Solid Color…",()=>pickSolidFill()),
    item("Gradient…",()=>void newGradientFill().catch(()=>{})),
    run("Pattern…","layer.newFillLayer.pattern"),
  ];
  const frameFromLayers=()=>{
    if(!state)return;
    const boxes=selectedBoxes();
    const edge=(pick:(box:[number,number,number,number])=>number,most:(...values:number[])=>number)=>most(...boxes.map(pick));
    openCommand(ADD_FRAME,{name:nextLayerName(state.layers,"Frame"),width:boxes.length?edge(box=>box[0]+box[2],Math.max)-edge(box=>box[0],Math.min):document.width,height:boxes.length?edge(box=>box[1]+box[3],Math.max)-edge(box=>box[1],Math.min):document.height});
  };
  const maskToggles=(kind:"layerMask"|"vectorMask",present:boolean,mask?:{enabled:boolean;linked:boolean}):MenuEntry[]=>[
    run(present&&mask?.enabled!==false?"Disable":"Enable",`layer.${kind}.enabled`,present,undefined,{enabled:mask?.enabled===false}),
    run(mask?.linked===false?"Link":"Unlink",`layer.${kind}.linked`,present,undefined,{linked:mask?.linked===false}),
  ];
  const currentPath=currentState?selectedPath(currentState,activePath):null;
  const hasType=!!currentState&&hasLayerKind(currentState.layers,"Type");
  const nextShapeName=()=>{const taken=new Set(currentState?.presets?.shapes?.flatMap(group=>group.presets.map(preset=>preset.name)));let index=1;while(taken.has(`Shape ${index}`))index++;return `Shape ${index}`;};
  const radio=(label:string,id:string,checked:boolean,enabled=true):MenuItem=>({...run(label,id,enabled&&!checked),checked,radio:true});
  const resetWorkspace=()=>{panels.reset("left");panels.reset("right");setUpperTab("Color");setMiddleTab("Properties");setLayersTab("Layers");setCollapsed({upper:false,middle:false,layers:false});setFlyout(null);setChrome({options:true,tools:true});if(!panels.left)panels.toggle("left");if(!panels.right)panels.toggle("right");};
  const shellWindow=()=>useShell.getState().windows.find(window=>window.app==="xdesign");
  const togglePanel=(name:PanelName)=>{
    if(!panelOpen(name))openPanel(name);
    else if((UPPER_PANELS as readonly string[]).includes(name))setCollapsed(c=>({...c,upper:true}));
    else if((MIDDLE_PANELS as readonly string[]).includes(name))setCollapsed(c=>({...c,middle:true}));
    else if((LAYER_PANELS as readonly string[]).includes(name))setCollapsed(c=>({...c,layers:true}));
    else setFlyout(null);
  };
  const clipItem=currentLayer?.clipped?run("Release Clipping Mask","layer.releaseClippingMask",true,"Alt+Mod+G"):run("Create Clipping Mask","layer.createClippingMask",!!currentLayer,"Alt+Mod+G"),mergeItem=run((state?.selectedLayers?.length??1)<=1?"Merge Down":"Merge Layers","layer.mergeLayers",!!currentLayer,"Mod+E");
  // The engine's Render filters that take their own parameters; they have no live preview, so they open plain dialogs.
  const renderExtras=[item("Flame…",()=>openCommand(FLAME),!!currentLayer&&!!(state?.paths?.work||state?.paths?.saved.length)),item("Picture Frame…",()=>openCommand(PICTURE_FRAME),!!currentLayer),item("Tree…",()=>openCommand(TREE),!!currentLayer)];
  const baseMenus:MenuSpec[]=[
    {label:"File",items:[
      // Unhandled, ⌘W reaches the native menu's Close Window and closes the whole app.
      item("Close",()=>{if(smartTrail.length)attempt(finishSmartContents(true));else usePhotoWorkspace.getState().close();},true,"Mod+W"),
      item("New from Clipboard",()=>attempt(createImageFromClipboard()),true),
      item("Save",saveImage,true,"Mod+S"),
      item("Save a Copy…",()=>setExportOpen("copy"),true,"Alt+Mod+S"),
      ...(!smartTrail.length?[item("Make Independent",()=>attempt(makeImageIndependent()))]:[]),
      "-",
      {label:"Export",items:[
        item("Export As…",()=>setExportOpen("export"),true,"Alt+Shift+Mod+W"),
        "-",
        item("Artboards to PDF…",()=>setFileDialog("artboardsPdf"),artboards.length>0),
        item("Layers to Files…",()=>setFileDialog("layersToFiles"),!!currentState),
        item("Color Lookup Tables…",()=>setFileDialog("colorLookup"),!!currentState?.layers.some(layer=>layer.kind==="Adjustment"&&layer.visible)),
        "-",
        item("Paths to Illustrator…",()=>setFileDialog("paths"),!!(currentState?.paths?.work||currentState?.paths?.saved.length)),
      ]},
      "-",
      item("Place Embedded…",()=>setPlaceDialog("embedded"),!!currentState?.features?.placeImages),
      item("Place Linked…",()=>setPlaceDialog("linked"),!!currentState?.features?.placeImages),
      "-",
      {label:"Automate",disabled:busy||!currentState,items:[item("Batch…",()=>{},false),item("PDF Presentation…",()=>{},false),item("Create Droplet…",()=>{},false),"-",run("Crop and Straighten Photos","file.automate.cropAndStraightenPhotos"),item("Contact Sheet II…",()=>{},false),"-",item("Conditional Mode Change…",()=>setFileDialog("conditionalMode")),item("Fit Image…",()=>setFileDialog("fitImage")),item("Lens Correction…",()=>{},false),item("Merge to HDR Pro…",()=>setFileDialog("hdr")),item("Photomerge…",()=>setFileDialog("photomerge"))]},
      {label:"Scripts",disabled:busy||!currentState,items:[run("Delete All Empty Layers","file.scripts.deleteAllEmptyLayers",true,undefined,{}),run("Flatten All Layer Effects","file.scripts.flattenAllLayerEffects",true,undefined,{}),run("Flatten All Masks","file.scripts.flattenAllMasks",true,undefined,{})]},
      "-",
      item("File Info…",()=>setFileDialog("info"),!!currentState,"Alt+Shift+Mod+I"),
    ]},
    {label:"Edit",items:[
      item("Undo",undo,canUndo,"Mod+Z"),
      item("Redo",redo,canRedo,"Mod+Shift+Z"),
      item("Toggle Last State",toggleLastState,canUndo||canRedo,"Alt+Mod+Z"),
      "-",
      item(currentState?.canFade?`Fade ${currentState.historySources?.find(source=>source.current)?.label??""}…`.replace(" …","…"):"Fade…",()=>openCommand(FADE),!!currentState?.canFade,"Mod+Shift+F"),
      "-",
      item("Cut",()=>clipboard("edit.cut"),!!currentState&&(grayscaleTarget||pixelLayer),"Mod+X"),
      item("Copy",()=>clipboard("edit.copy"),!!currentState&&(grayscaleTarget||pixelLayer),"Mod+C"),
      item("Copy Merged",()=>clipboard("edit.copyMerged"),!!currentState,"Mod+Shift+C"),
      item("Paste",()=>clipboard("edit.paste"),!!currentState,"Mod+V"),
      {label:"Paste Special",items:[
        item("Paste without Formatting",pasteWithoutFormatting,!!currentLayer?.text),
        "-",
        item("Paste in Place",()=>clipboard("edit.pasteSpecial.pasteInPlace"),!!currentState,"Mod+Shift+V"),
        item("Paste Into",()=>clipboard("edit.pasteSpecial.pasteInto"),hasSelection,"Alt+Shift+Mod+V"),
        item("Paste Outside",()=>clipboard("edit.pasteSpecial.pasteOutside"),hasSelection),
      ]},
      run("Clear","edit.clear",hasSelection),
      "-",
      item("Search",()=>setCommandsOpen(true),!geometryActive,"Mod+F"),
      item("Check Spelling…",()=>setEditDialog("spelling"),hasType),
      item("Find and Replace Text…",()=>setEditDialog("findReplace"),hasType),
      "-",
      item("Fill…",openFillDialog,!!currentState,"Shift+F5"),
      item("Stroke…",()=>openCommand(STROKE),!!currentState),
      item("Content-Aware Fill…",()=>openCommand(contentAwareFillCommand(state?.channels?.alpha??[])),pixelLayer&&hasSelection),
      "-",
      item("Content-Aware Scale…",()=>openCommand(CONTENT_AWARE_SCALE),pixelLayer,"Alt+Shift+Mod+C"),
      item("Puppet Warp",()=>openGeometry("puppet"),!!currentLayer),
      item("Perspective Warp",()=>openGeometry("perspective"),!!currentLayer),
      item("Free Transform",()=>startFreeTransform(),!!currentLayer,"Mod+T"),
      {label:"Transform",disabled:busy||!currentLayer,items:[
        run("Again","edit.transform.again",!warpSession,"Mod+Shift+T"),
        "-",
        ...(["scale","rotate","skew","distort","perspective"] as const).map(mode=>item(mode[0]!.toUpperCase()+mode.slice(1),()=>startFreeTransform(mode),!warpSession)),
        ...warpMenuItems(warpSession,busy,item("Warp",()=>openGeometry("warp"),!warpSession)),
        ...WARP_TURNS.flatMap(([label,how,id],index):MenuEntry[]=>[...(index===0||index===3?["-" as const]:[]),warpSession?item(label,()=>warpSession.turn(how)):run(label,id)]),
      ]},
      item("Auto-Align Layers…",()=>setEditDialog("autoAlign"),pixelLayers>=2),
      item("Auto-Blend Layers…",()=>setEditDialog("autoBlend"),pixelLayers>=2),
      "-",
      item("Define Brush Preset…",()=>setEditDialog("brushes"),hasSelection&&pixelLayer),
      item("Define Pattern…",()=>setEditDialog("patterns"),!!currentState),
      item("Define Custom Shape…",()=>setEditDialog("customShapes"),!!currentPath||currentLayer?.kind==="Shape"||!!currentLayer?.hasVectorMask),
      "-",
      {label:"Purge",disabled:busy||!currentState,items:[
        item("Clipboard",()=>setEditDialog("edit.purge.clipboard")),
        item("Histories",()=>setEditDialog("edit.purge.histories"),canUndo||canRedo),
        item("All",()=>setEditDialog("edit.purge.all")),
      ]},
      "-",
      {label:"Presets",disabled:busy||!currentState,items:[item("Preset Manager…",()=>setEditDialog("presets"))]},
      "-",
      item("Color Settings…",()=>setColorSettingsOpen(true),true,"Shift+Mod+K"),
      item("Assign Profile…",()=>setProfileDialog("assign"),!!state),
      item("Convert to Profile…",()=>setProfileDialog("convert"),!!state),
      "-",
      item("Keyboard Shortcuts…",()=>setCustomize("shortcuts"),true,"Alt+Shift+Mod+K"),item("Menus…",()=>setCustomize("menus"),true,"Alt+Shift+Mod+M"),item("Toolbar…",()=>setCustomize("toolbar")),
      "-",
      {label:"Preferences",items:[item("Units & Rulers…",()=>setPreferencesSection("units")),item("Guides, Grid & Slices…",()=>setPreferencesSection("guides"))]},
    ]},
    {label:"Image",items:[
      {label:"Mode",disabled:busy||!currentState,items:[
        item("Bitmap",()=>openCommand(BITMAP),currentState?.mode.toLowerCase()==="grayscale"&&currentState.depth===8),
        radio("Grayscale","image.mode.grayscale",currentState?.mode.toLowerCase()==="grayscale"),
        item("Duotone",()=>setImageDialog("duotone"),["grayscale","duotone"].includes(currentState?.mode.toLowerCase()??"")),
        item("Indexed Color…",()=>openCommand(INDEXED_COLOR),["rgb","grayscale"].includes(currentState?.mode.toLowerCase()??"")&&currentState?.depth===8),
        ...([["rgb","RGB Color"],["cmyk","CMYK Color"],["lab","Lab Color"]] as const).map(([mode,label])=>radio(label,`image.mode.${mode}`,currentState?.mode.toLowerCase()===mode)),
        "-",
        radio("Multichannel","image.mode.multichannel",currentState?.mode.toLowerCase()==="multichannel"),
        "-",
        ...([8,16,32] as const).map(bits=>radio(`${bits} Bits/Channel`,`image.mode.bits${bits}`,currentState?.depth===bits)),
        "-",
        item("Color Table…",()=>setImageDialog("colorTable"),currentState?.mode.toLowerCase()==="indexed"),
      ]},
      "-",
      {label:"Adjustments",items:[
        ...adjustments(false),
        "-",
        item("Shadows/Highlights…",()=>openCommand(SHADOWS_HIGHLIGHTS),!!currentLayer),
        item("HDR Toning…",()=>openCommand(HDR_TONING),!!currentLayer),
        "-",
        run("Desaturate","image.adjustments.desaturate",!!currentLayer,"Shift+Mod+U"),
        item("Match Color…",()=>openCommand(matchColorCommand(Object.values(documents).filter(other=>other.id!==document.id))),!!currentLayer),
        item("Replace Color…",()=>openCommand(REPLACE_COLOR,{color:paintColor}),!!currentLayer),
        run("Equalize","image.adjustments.equalize",!!currentLayer),
      ]},
      "-",
      run("Auto Tone","image.autoTone",!!currentLayer,"Shift+Mod+L"),
      run("Auto Contrast","image.autoContrast",!!currentLayer,"Alt+Shift+Mod+L"),
      run("Auto Color","image.autoColor",!!currentLayer,"Shift+Mod+B"),
      "-",
      item("Image Size…",()=>setImageDialog("size"),!!state,"Alt+Mod+I"),
      item("Canvas Size…",()=>setImageDialog("canvas"),!!state,"Alt+Mod+C"),
      {label:"Image Rotation",items:[
        run("180°","image.imageRotation.180"),
        run("90° Clockwise","image.imageRotation.90cw"),
        run("90° Counter Clockwise","image.imageRotation.90ccw"),
        item("Arbitrary…",()=>openCommand(ROTATE_CANVAS),!!currentState),
        "-",
        run("Flip Canvas Horizontal","image.imageRotation.flipCanvasHorizontal"),
        run("Flip Canvas Vertical","image.imageRotation.flipCanvasVertical"),
      ]},
      item("Crop",()=>{const bounds=currentState?.selectionBounds;if(bounds)command("image.crop",{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]});},!!currentState?.selectionBounds),
      item("Trim…",()=>setImageDialog("trim"),!!currentState),
      run("Reveal All","image.revealAll"),
      "-",
      item("Duplicate…",()=>setImageDialog("duplicate"),!!currentState),
      item("Apply Image…",()=>setCompositeDialog("apply"),!!state),
      item("Calculations…",()=>setCompositeDialog("calculations"),!!state),
      "-",
      item("Trap…",()=>openCommand(TRAP),currentState?.mode.toLowerCase()==="cmyk"),
      "-",
      {label:"Analysis",disabled:busy||!state,items:[
        {label:"Set Measurement Scale",disabled:busy||!state,items:[run("Default","image.analysis.setMeasurementScale",!!state,undefined,{preset:"default"}),item("Custom…",()=>withScale(({pixelLength,logicalLength,units})=>openCommand(MEASUREMENT_SCALE,{pixelLength,logicalLength,units})),!!state)]},
        {label:"Select Data Points",items:[item("Custom…",()=>useMeasurementLog.getState().set({dialog:true}),!!displayState?.panels)]},
        run("Record Measurements","image.analysis.recordMeasurements",!!state,"Shift+Mod+M",{source:"auto"}),
        "-",
        item("Ruler Tool",()=>setTool("ruler")),
        item("Count Tool",()=>setTool("count")),
        "-",
        item("Place Scale Marker…",openMarker,!!state),
      ]},
    ]},
    {label:"Layer",items:[
      {label:"New",items:[
        item("Layer…",newLayer,!!state,"Shift+Mod+N"),
        item("Layer from Background…",layerFromBackground,!!currentLayer),
        item("Group…",()=>newGroup(false),!!state),
        item("Group from Layers…",()=>newGroup(true),!!currentLayer),
        "-",
        item("Artboard…",()=>openCommand(NEW_ARTBOARD,{width:document.width,height:document.height}),!!state),
        item("Artboard from Group",()=>openCommand(ARTBOARD_FROM_GROUP),!!currentLayer?.children&&!!state?.layers.some(layer=>layer.id===currentLayer.id)),
        item("Artboard from Layers…",()=>openCommand(ARTBOARD_FROM_LAYERS),!!currentLayer),
        item("Frame from Layers…",frameFromLayers,!!currentLayer),
        "-",
        run("Layer Via Copy","layer.new.layerViaCopy",!!currentLayer,"Mod+J"),
        run("Layer Via Cut","layer.new.layerViaCut",!!currentLayer&&hasSelection,"Shift+Mod+J"),
      ]},
      item("Copy CSS",()=>copyLayerCode("layer.copyCSS"),codeLayers),
      item("Copy SVG",()=>copyLayerCode("layer.copySVG"),codeLayers),
      item(`${duplicateTitle}…`,duplicateLayer,!!currentLayer),
      {label:"Delete",items:[run("Layer","layer.delete",!!currentLayer),run("Hidden Layers","layer.delete.hiddenLayers")]},
      item("Rename Layer…",renameLayer,!!currentLayer&&!isBackgroundLayer(currentLayer)),
      "-",
      {label:"Layer Style",items:[
        ...styleItems,"-",
        run("Copy Layer Style","layer.layerStyle.copyLayerStyle",!!currentLayer?.effects?.items.length),
        run("Paste Layer Style","layer.layerStyle.pasteLayerStyle",!!currentLayer),
        item("Clear Layer Style",()=>{if(currentLayer)command("layer.layerStyle.clear",{layer:currentLayer.id});},!!currentLayer?.effects?.items.length),
        "-",
        item("Global Light…",()=>openCommand(GLOBAL_LIGHT,state?.globalLight),!!state),
        run("Create Layer","layer.layerStyle.createLayer",!!currentLayer?.effects?.items.length),
        run("Hide All Effects","layer.layerStyle.hideAllEffects"),
        run("Show All Effects","layer.layerStyle.showAllEffects"),
        item("Scale Effects…",()=>openCommand(SCALE_EFFECTS),!!currentLayer?.effects?.items.length),
      ]},
      {label:"New Fill Layer",items:fillLayerItems(true)},
      {label:"New Adjustment Layer",items:adjustments(true,true)},
      item("Layer Content Options…",()=>currentLayer?.gradientFill?setImageDialog("gradient"):openPanel("Properties"),!!(currentLayer?.adjustmentKind||currentLayer?.gradientFill)),
      {label:"Layer Mask",disabled:busy||!currentLayer,items:[
        run("Reveal All","layer.layerMask.revealAll",!currentLayer?.hasMask),
        run("Hide All","layer.layerMask.hideAll",!currentLayer?.hasMask),
        run("Reveal Selection","layer.layerMask.revealSelection",hasSelection&&!currentLayer?.hasMask),
        run("Hide Selection","layer.layerMask.hideSelection",hasSelection&&!currentLayer?.hasMask),
        run("From Transparency","layer.layerMask.fromTransparency",!currentLayer?.hasMask),
        "-",
        run("Delete","layer.layerMask.delete",!!currentLayer?.hasMask),
        run("Apply","layer.layerMask.apply",!!currentLayer?.hasMask),
        "-",
        ...maskToggles("layerMask",!!currentLayer?.hasMask,currentLayer?.mask),
      ]},
      {label:"Vector Mask",disabled:busy||!currentLayer,items:[
        run("Reveal All","layer.vectorMask.add",!currentLayer?.hasVectorMask),
        run("Hide All","layer.vectorMask.add",!currentLayer?.hasVectorMask,undefined,{hide:true}),
        run("Current Path","layer.vectorMask.currentPath",!currentLayer?.hasVectorMask&&!!currentPath,undefined,{name:currentPath}),
        "-",
        run("Delete","layer.vectorMask.delete",!!currentLayer?.hasVectorMask),
        "-",
        ...maskToggles("vectorMask",!!currentLayer?.hasVectorMask,currentLayer?.vectorMask),
      ]},
      run("Mask All Objects","layer.maskAllObjects",!!currentLayer),
      clipItem,
      "-",
      {label:"Smart Objects",disabled:busy||!currentLayer,items:[
        run("Convert to Smart Object","layer.smartObjects.convertToSmartObject",!currentLayer?.smartObject),
        run("New Smart Object via Copy","layer.smartObjects.newSmartObjectViaCopy",!!currentLayer?.smartObject),
        "-",
        item("Edit Contents",()=>{if(currentLayer)attempt(openSmartContents(currentLayer.id));},!!currentLayer?.smartObject),
        "-",
        run("Update Modified Content","layer.smartObjects.updateModifiedContent",currentLayer?.smartObject?.source==="linked"),
        run("Update All Modified Content","layer.smartObjects.updateAllModifiedContent"),
        run("Embed Linked","layer.smartObjects.convertToEmbedded",currentLayer?.smartObject?.source==="linked"),
        item("Relink to File…",relinkSmartObject,currentLayer?.smartObject?.source==="linked"),
        {label:"Stack Mode",disabled:busy||!currentLayer?.smartObject,items:STACK_MODES.map(([id,label])=>run(label,`layer.smartObjects.stackMode.${id}`))},
        "-",
        run("Rasterize","layer.smartObjects.rasterize",!!currentLayer?.smartObject),
        "-",
        run("Reveal in Finder","layer.smartObjects.revealInFinder",currentLayer?.smartObject?.source==="linked"),
      ]},
      {label:"Rasterize",disabled:busy||!currentLayer,items:[
        run("Type","layer.rasterize.type",!!typeText),
        run("Shape","layer.rasterize.shape"),
        run("Fill Content","layer.rasterize.fillContent"),
        run("Vector Mask","layer.rasterize.vectorMask",!!currentLayer?.hasVectorMask),
        run("Smart Object","layer.rasterize.smartObject",!!currentLayer?.smartObject),
        "-",
        run("Layer","layer.rasterize.layer"),
        run("All Layers","layer.rasterize.allLayers"),
      ]},
      "-",
      run("New Layer Based Slice","layer.newLayerBasedSlice",!!currentLayer),
      "-",
      run("Group Layers","layer.groupLayers",!!currentLayer,"Mod+G"),
      run("Ungroup Layers","layer.ungroupLayers",currentLayer?.kind==="Group","Shift+Mod+G"),
      currentLayer?.visible===false?run("Show Layers","layer.showLayers",true,"Mod+,"):run("Hide Layers","layer.hideLayers",!!currentLayer,"Mod+,"),
      "-",
      {label:"Arrange",disabled:busy||!currentLayer,items:[
        run("Bring to Front","layer.arrange.bringToFront",true,"Shift+Mod+]"),
        run("Bring Forward","layer.arrange.bringForward",true,"Mod+]"),
        run("Send Backward","layer.arrange.sendBackward",true,"Mod+["),
        run("Send to Back","layer.arrange.sendToBack",true,"Shift+Mod+["),
        "-",
        run("Reverse","layer.arrange.reverse",(state?.selectedLayers?.length??1)>1),
      ]},
      {label:"Combine Shapes",disabled:busy||currentLayer?.kind!=="Shape",items:([["unite","Unite Shapes"],["subtractFrontShape","Subtract Front Shape"],["intersectShapeAreas","Unite Shapes at Overlap"],["excludeOverlappingShapes","Subtract Shapes at Overlap"]] as const).map(([id,label])=>run(label,`layer.combineShapes.${id}`))},
      {label:"Align",disabled:busy||!currentLayer,items:ALIGN_EDGES.map(entry=>entry==="-"?entry:run(entry[1],`layer.align.${entry[0]}`))},
      {label:"Distribute",disabled:busy||!currentLayer,items:[...ALIGN_EDGES.map(entry=>entry==="-"?entry:run(entry[1],`layer.distribute.${entry[0]}`)),"-",run("Horizontally","layer.distribute.horizontally"),run("Vertically","layer.distribute.vertically")]},
      {...item("Lock Layers",()=>command("layer.lockLayers",{all:!locks?.all}),!!currentLayer,"Mod+/"),checked:!!locks?.all},
      "-",
      run("Link Layers","layer.linkLayers",!!currentLayer),
      run("Select Linked Layers","layer.selectLinkedLayers",currentLayer?.linkGroup!=null),
      "-",
      mergeItem,
      run("Merge Visible","layer.mergeVisible",true,"Shift+Mod+E"),
      run("Flatten Image","layer.flattenImage"),
      "-",
      {label:"Smart Filter",disabled:busy||!currentLayer?.smartObject,items:[
        item(currentLayer?.smartFiltersEnabled===false?"Enable Smart Filters":"Disable Smart Filters",()=>command("layer.smartFilter.disableSmartFilters",{layer:currentLayer!.id,enabled:currentLayer!.smartFiltersEnabled===false}),!!currentLayer?.smartFilters?.length),
        "-",
        run("Delete Filter Mask","layer.smartFilter.deleteFilterMask",!!currentLayer?.smartObject?.hasFilterMask,undefined,{layer:currentLayer?.id}),
        item(currentLayer?.smartObject?.filterMaskEnabled===false?"Enable Filter Mask":"Disable Filter Mask",()=>command("layer.smartFilter.disableFilterMask",{layer:currentLayer!.id,enabled:currentLayer!.smartObject!.filterMaskEnabled===false}),!!currentLayer?.smartObject?.hasFilterMask),
        "-",
        run("Clear Smart Filters","layer.smartFilter.clearSmartFilters"),
      ]},
      {label:"Matting",disabled:busy||!currentLayer,items:[
        item("Color Decontaminate…",()=>openCommand(COLOR_DECONTAMINATE)),
        item("Defringe…",()=>openCommand(DEFRINGE)),
        run("Remove Black Matte","layer.matting.removeBlackMatte"),
        run("Remove White Matte","layer.matting.removeWhiteMatte"),
      ]},
    ]},
    {label:"Type",items:[
      {label:"Panels",items:[item("Character Panel",()=>openPanel("Character")),item("Paragraph Panel",()=>openPanel("Paragraph")),"-",item("Glyphs Panel",()=>openPanel("Glyphs")),"-",item("Character Styles Panel",()=>openPanel("Character Styles")),item("Paragraph Styles Panel",()=>openPanel("Paragraph Styles"))]},
      "-",
      {label:"Anti-Alias",disabled:busy||!typeText,items:([["none","None"],["sharp","Sharp"],["crisp","Crisp"],["strong","Strong"],["smooth","Smooth"],["windowsLcd","Windows LCD"],["windows","Windows"]] as const).map(([id,label])=>radio(label,`type.antiAlias.${id}`,(typeText?.antialias??"smooth")===id))},
      {label:"Orientation",disabled:busy||!typeText,items:([["horizontal","Horizontal"],["vertical","Vertical"]] as const).map(([id,label])=>radio(label,`type.orientation.${id}`,(typeText?.orientation??"horizontal")===id))},
      {label:"OpenType",disabled:busy||!typeText,items:OPEN_TYPE.map(([id,label])=>run(label,`type.openType.${id}`))},
      "-",
      run("Create Work Path","type.createWorkPath",!!typeText),
      run("Convert to Shape","type.convertToShape",!!typeText),
      run("Rasterize Type Layer","type.rasterizeTypeLayer",!!typeText),
      typeText?.shape?.kind==="box"?run("Convert to Point Text","type.convertToPointText"):run("Convert to Paragraph Text","type.convertToParagraphText",!!typeText),
      "-",
      run("Update All Text Layers","type.updateAllTextLayers"),
      run("Replace All Missing Fonts","type.replaceAllMissingFonts"),
      run("Save Default Type Styles","type.saveDefaultTypeStyles",!!typeText),
      run("Load Default Type Styles","type.loadDefaultTypeStyles",!!typeText),
      "-",
      run("Paste Lorem Ipsum","type.pasteLoremIpsum",!!typeText),
    ]},
    {label:"Select",items:[
      run("All","select.all",true,"Mod+A"),
      run("Deselect","select.deselect",hasSelection,"Mod+D"),
      run("Reselect","select.reselect",true,"Shift+Mod+D"),
      run("Inverse","select.inverse",hasSelection,"Shift+Mod+I"),
      "-",
      run("All Layers","select.allLayers",true,"Alt+Mod+A"),
      run("Deselect Layers","select.deselectLayers",!!currentLayer),
      item("Find Layers",findLayers,!!state,"Alt+Shift+Mod+F"),
      run("Isolate Layers","select.isolateLayers",!!currentLayer),
      "-",
      item("Color Range…",()=>setSelectionDialog("color")),
      item("Focus Area…",()=>setSelectionDialog("focus")),
      run("Subject","select.subject"),
      run("Sky","select.sky"),
      "-",
      item("Select and Mask…",()=>setSelectionDialog("refine"),hasSelection,"Alt+Mod+R"),
      {label:"Modify",disabled:busy||!hasSelection,items:MODIFY_ORDER.map(id=>{const modify=SELECTION_MODIFY.find(entry=>entry.id===id)!;return item(`${modify.title.replace(" Selection","")}…`,()=>openCommand(modify),true,id==="select.modify.feather"?"Shift+F6":undefined);})},
      "-",
      run("Grow","select.grow",hasSelection),
      run("Similar","select.similar",hasSelection),
      "-",
      item("Transform Selection",startSelectionTransform,!!currentState?.selectionBounds),
      "-",
      {...item("Edit in Quick Mask Mode",()=>{setMask(false);command("select.editInQuickMaskMode");}),checked:!!state?.quickMask},
      "-",
      item("Load Selection…",()=>setCompositeDialog("load")),
      item("Save Selection…",()=>setSaveSelection(true),hasSelection),
    ]},
    {label:"Filter",items:[
      run("Last Filter","filter.lastFilter",!!currentLayer,"Ctrl+Mod+F"),
      "-",
      run("Convert for Smart Filters","filter.convertForSmartFilters",!!currentLayer&&!currentLayer.smartObject),
      "-",
      actionItem(FILTERS.find(action=>action.id==="filter.filterGallery")!,false),
      actionItem(FILTERS.find(action=>action.id==="filter.adaptiveWideAngle")!,false,"Alt+Shift+Mod+A"),
      item("Camera Raw Filter…",()=>setSpecialDialog("develop"),!!currentLayer,"Shift+Mod+A"),
      actionItem(FILTERS.find(action=>action.id==="filter.lensCorrection")!,false,"Shift+Mod+R"),
      item("Liquify…",()=>openGeometry("liquify"),!!currentLayer,"Shift+Mod+X"),
      "-",
      ...FILTER_MENU.map(category=>({label:category,items:[...FILTERS.filter(action=>action.category===category&&!LENS_FILTER_IDS.includes(action.id)).sort((a,b)=>category==="Blur Gallery"?0:a.label.localeCompare(b.label)).map(action=>actionItem(action,false)),...(category==="Render"?renderExtras:[])].sort((a,b)=>category==="Render"?a.label.localeCompare(b.label):0)})),
    ]},
    {label:"View",items:[
      {label:"Proof Setup",items:[item("Custom…",()=>setProfileDialog("proof"),!!state),"-",run("Working CMYK","view.proofSetup",!!colorView,undefined,{profile:"working-cmyk",kind:"profile",on:true}),...PROOF_PRESETS.slice(0,5).map(([id,label])=>run(label,`view.proofSetup.${id}`,!!colorView)),"-",run(PROOF_PRESETS[5][1],`view.proofSetup.${PROOF_PRESETS[5][0]}`,!!colorView),run("Internet Standard RGB (sRGB)","view.proofSetup",!!colorView,undefined,{profile:"srgb",kind:"profile",on:true}),item("Monitor RGB",()=>{},false),"-",...PROOF_PRESETS.slice(6).map(([id,label])=>run(label,`view.proofSetup.${id}`,!!colorView))]},
      {...run("Proof Colors","view.proofColors",!!colorView,"Mod+Y",{on:!colorView?.on}),checked:!!colorView?.on},
      {...run("Gamut Warning","view.gamutWarning",!!colorView,"Shift+Mod+Y",{on:!colorView?.gamutWarning}),checked:!!colorView?.gamutWarning},
      item("32-bit Preview Options…",()=>setProfileDialog("hdr"),state?.depth===32),
      "-",
      item("Zoom In",()=>zoomAt(z=>z*1.25),true,"Mod+="),
      item("Zoom Out",()=>zoomAt(z=>z/1.25),true,"Mod+-"),
      item("Fit on Screen",fit,true,"Mod+0"),
      item("Fit Layer(s) on Screen",fitLayers,selectedBoxes().length>0),
      item("100%",()=>zoomAt(()=>1),true,"Mod+1"),
      item("200%",()=>zoomAt(()=>2)),
      item("Print Size",()=>zoomAt(()=>screenResolution/(state?.resolution||screenResolution)),!!state),
      {label:"Flip Horizontal",checked:turn.flip,run:()=>turnView({flip:!turn.flip})},
      "-",
      {label:"Screen Mode",items:SCREEN_MODES.map((label,mode)=>({label,radio:true,checked:screenMode===mode,run:()=>chooseScreenMode(mode)}))},
      "-",
      {label:"Extras",checked:aids.extras,shortcut:"Mod+H",run:()=>useViewAids.getState().setFlags({extras:!aids.extras})},
      {label:"Show",items:[
        {label:"Layer Edges",checked:aids.layerEdges,run:()=>useViewAids.getState().setFlags({layerEdges:!aids.layerEdges})},
        {label:"Selection Edges",checked:aids.selectionEdges,run:()=>useViewAids.getState().setFlags({selectionEdges:!aids.selectionEdges})},
        {label:"Target Path",checked:aids.targetPath,shortcut:"Shift+Mod+H",run:()=>useViewAids.getState().setFlags({targetPath:!aids.targetPath})},
        {label:"Grid",checked:aids.grid,shortcut:"Mod+'",run:()=>useViewAids.getState().setFlags({grid:!aids.grid})},
        {label:"Guides",checked:aids.guides,shortcut:"Mod+;",run:()=>useViewAids.getState().setFlags({guides:!aids.guides})},
        {label:"Smart Guides",checked:aids.smartGuides,run:()=>useViewAids.getState().setFlags({smartGuides:!aids.smartGuides})},
        {label:"Pixel Grid",checked:aids.pixelGrid,run:()=>useViewAids.getState().setFlags({pixelGrid:!aids.pixelGrid})},
      ]},
      {label:"Rulers",checked:aids.rulers,shortcut:"Mod+R",run:()=>useViewAids.getState().setFlags({rulers:!aids.rulers})},
      "-",
      {label:"Snap",checked:aids.snap,shortcut:"Shift+Mod+;",run:()=>useViewAids.getState().setFlags({snap:!aids.snap})},
      {label:"Snap To",items:[
        {label:"Guides",checked:aids.snapTo.guides,run:()=>useViewAids.getState().setSnapTo({guides:!aids.snapTo.guides})},
        {label:"Grid",checked:aids.snapTo.grid,run:()=>useViewAids.getState().setSnapTo({grid:!aids.snapTo.grid})},
        {label:"Layers",checked:aids.snapTo.layers,run:()=>useViewAids.getState().setSnapTo({layers:!aids.snapTo.layers})},
        {label:"Document Bounds",checked:aids.snapTo.bounds,run:()=>useViewAids.getState().setSnapTo({bounds:!aids.snapTo.bounds})},
        "-",
        {label:"All",run:()=>useViewAids.getState().setSnapTo({guides:true,grid:true,layers:true,bounds:true})},
        {label:"None",run:()=>useViewAids.getState().setSnapTo({guides:false,grid:false,layers:false,bounds:false})},
      ]},
      "-",
      {label:"Guides",items:[
        item("Edit Selected Guides",()=>{},false),
        {label:"Lock Guides",checked:aids.lockGuides,shortcut:"Alt+Mod+;",run:()=>useViewAids.getState().setFlags({lockGuides:!aids.lockGuides})},
        {label:"Clear Guides",disabled:!guideList.length,run:()=>useViewAids.getState().clearGuides(document.id)},
        item("Clear Selected Guides",()=>{},false),
        {label:"Clear Selected Artboard Guides",disabled:!(activeArtboard&&guideList.some(guide=>guideInside(guide,activeArtboard.rect))),run:()=>useViewAids.getState().clearArtboardGuides(document.id,activeArtboard!.rect)},
        {label:"Clear Canvas Guides",disabled:!guideList.some(guide=>!artboards.some(board=>guideInside(guide,board.rect))),run:()=>useViewAids.getState().clearCanvasGuides(document.id,artboards.map(board=>board.rect))},
        {label:"New Guide…",run:()=>useViewAids.getState().setDialog("new")},
        {label:"New Guide Layout…",run:()=>useViewAids.getState().setDialog("layout")},
        {label:"New Guides From Shape",disabled:!(activeKind==="Shape"&&!!currentLayer?.bounds&&currentLayer.bounds[2]>0&&currentLayer.bounds[3]>0),run:()=>useViewAids.getState().addGuides(document.id,shapeGuides(currentLayer!.bounds!))},
      ]},
      "-",
      {label:"Lock Slices",checked:slicesLocked,disabled:busy||!state,run:()=>command("view.lockSlices",{on:!slicesLocked})},
      run("Clear Slices","view.clearSlices",!slicesLocked&&!!state?.analysis?.slices.some(slice=>slice.id!==null)),
    ]},
    {label:"Window",items:[
      // One document in one view: arrangements that need a second document or view are listed but off.
      {label:"Arrange",items:[...["Tile All Vertically","Tile All Horizontally","2-up Horizontal","2-up Vertical","3-up Horizontal","3-up Vertical","3-up Stacked","4-up","6-up","Consolidate All to Tabs"].map(label=>({label,disabled:true})),"-",...["Cascade","Tile","Float in Window","Float All in Windows"].map(label=>({label,disabled:true})),"-",...["Match Zoom","Match Location","Match Rotation","Match All"].map(label=>({label,disabled:true})),"-",{label:`New Window for ${document.name}`,disabled:true},"-",
        {label:"Minimize",shortcut:"Ctrl+Mod+M",run:()=>{const window=shellWindow();if(window)useShell.getState().minimizeWindow(window.id);}},{label:"Bring All to Front",run:()=>{const window=shellWindow();if(window)useShell.getState().focusWindow(window.id);}}]},
      // Essentials is the only workspace, so choosing it and resetting it are the same restore of the default panel layout.
      {label:"Workspace",items:[{label:"Essentials (Default)",radio:true,checked:true,run:resetWorkspace},"-",{label:"Reset Essentials",run:resetWorkspace},"-",{label:"Keyboard Shortcuts & Menus…",run:()=>setCustomize("shortcuts")}]},
      "-",...ALL_PANELS.map(name=>({label:name,checked:panelOpen(name),shortcut:PANEL_KEYS[name],run:()=>togglePanel(name)})),
      "-",{label:"Application Frame",checked:true,disabled:true},{label:"Options",checked:chrome.options,run:()=>setChrome(c=>({...c,options:!c.options}))},{label:"Tools",checked:chrome.tools,run:()=>setChrome(c=>({...c,tools:!c.tools}))},{label:"Contextual Task Bar",checked:!taskBar.hidden,run:()=>placeTaskBar({hidden:!taskBar.hidden})},
      "-",{label:document.name,radio:true,checked:true,run:()=>{const window=shellWindow();if(window)useShell.getState().focusWindow(window.id);}}]},
  ];
  const menus=customizeMenus(baseMenus,customization);
  // Photoshop binds these keys without listing them in any menu.
  const layerKeys:MenuItem[]=([["layer.stampVisible","Alt+Shift+Mod+E"],["layer.stampDown","Alt+Mod+E"],["layer.selectAbove","Alt+]"],["layer.selectBelow","Alt+["],["layer.selectTop","Alt+."],["layer.selectBottom","Alt+,"],["layer.addAboveToSelection","Alt+Shift+]"],["layer.addBelowToSelection","Alt+Shift+["]] as const).map(([id,shortcut])=>run(id,id,!!currentLayer,shortcut));
  const fromMenu=(path:string[],label?:string):MenuEntry[]=>{
    let found:MenuItem|undefined={label:"",items:menus},disabled=false;
    for(const part of path){found=found?.items?.find((entry):entry is MenuItem=>entry!=="-"&&entry.label===part);disabled=disabled||!!found?.disabled;}
    return found?[{...found,label:label??found.label,disabled}]:[];
  };
  // Photoshop's context menus never show shortcuts; its panel menus do.
  const bare=(entries:MenuEntry[]):MenuEntry[]=>entries.map(entry=>entry==="-"?entry:{...entry,shortcut:undefined});
  const multipleLayers=(state?.selectedLayers?.length??1)>1;
  const channelOptions=(channel:number|"quickMask"|null,spot=false)=>setChannelDialog({channel,spot});
  const pathItems:MenuEntry[]=currentState?pathsPanelMenu(currentState,selectedPath(currentState,activePath),busy,setActivePath):[];
  const allGroups=state?.layers.flatMap(groupIds)??[],collapseAll=item("Collapse All Groups",()=>fold(allGroups,false,true),allGroups.length>0);
  const layersPanelMenu=():MenuEntry[]=>[
    ...fromMenu(["Layer","New","Layer…"],"New Layer…"),...fromMenu(["Layer",`${duplicateTitle}…`]),...fromMenu(["Layer","Delete","Layer"],"Delete Layer"),...fromMenu(["Layer","Delete","Hidden Layers"],"Delete Hidden Layers"),
    "-",...fromMenu(["Layer","New","Group…"],"New Group…"),...fromMenu(["Layer","New","Group from Layers…"],"New Group from Layers…"),collapseAll,
    "-",item("Rename Layer…",renameLayer,!!currentLayer&&!isBackgroundLayer(currentLayer)),currentLayer?.visible===false?run("Show Layers","layer.showLayers"):run("Hide Layers","layer.hideLayers",!!currentLayer),...fromMenu(["Layer","Lock Layers"]),
    "-",...fromMenu(["Layer","Smart Objects","Convert to Smart Object"]),...fromMenu(["Layer","Smart Objects","Edit Contents"]),
    "-",blendingOptions,
    "-",clipItem,
    "-",...fromMenu(["Layer","Link Layers"]),...fromMenu(["Layer","Select Linked Layers"]),
    "-",mergeItem,...fromMenu(["Layer","Merge Visible"]),...fromMenu(["Layer","Flatten Image"]),
  ];
  const panelMenu=(name:PanelName):MenuEntry[]=>{
    const own:MenuEntry[]=name==="Layers"?layersPanelMenu():name==="Channels"&&state?channelsPanelMenu(state,busy,channelOptions,()=>setMergeDialog(true)):name==="Paths"?pathItems:name==="History"?[item("Step Forward",redo,canRedo,"Mod+Shift+Z"),item("Step Backward",undo,canUndo,"Mod+Z"),"-",item("New Snapshot…",()=>setImageDialog("snapshot"),historyReady),item("Delete",()=>historyActions(currentState!).remove(),historyReady&&historyActions(currentState!).canDelete),item("Clear History",()=>{},false),"-",item("New Document",()=>historyActions(currentState!).newDocument(),historyReady),"-",item("History Options…",()=>{},false)]:name==="Color"?colorPanelMenu(colorMode,setColorMode,paintColor):name==="Actions"?actionsPanelMenu(actions,busy):!displayState?.panels?[]:name==="Layer Comps"?layerCompsPanelMenu(displayState.panels.layerComps,busy):name==="Measurement Log"?measurementLogPanelMenu(displayState.panels.measurementLog,busy):name==="Character Styles"||name==="Paragraph Styles"?typeStylesPanelMenu(name==="Character Styles"?"character":"paragraph",displayState.panels.textStyles,busy):[];
    const group=(UPPER_PANELS as readonly string[]).includes(name)?"upper":(MIDDLE_PANELS as readonly string[]).includes(name)?"middle":(LAYER_PANELS as readonly string[]).includes(name)?"layers":null;
    const shut=group==="middle"?middleCollapsed:!!group&&collapsed[group];
    return [...own,...(own.length?["-" as const]:[]),group?{label:shut?"Expand Panel Group":"Collapse Panel Group",run:()=>setCollapsed(c=>({...c,[group]:!c[group]}))}:{label:"Close",run:()=>setFlyout(null)}];
  };
  // Reference order: canvas_tool_menu.rs and layer_menu_ui.rs, trimmed to commands the engine has.
  const layerContextMenu=():MenuEntry[]=>{
    const layer=currentLayer;
    const kind:MenuEntry[]=layer?.text?fromMenu(["Layer","Rasterize","Type"],"Rasterize Type"):layer?.smartObject?[...fromMenu(["Layer","Smart Objects","Edit Contents"]),...fromMenu(["Layer","Rasterize","Smart Object"],"Rasterize Layer")]:layer&&!["Pixel","Pixels","Raster","Group","Adjustment"].includes(layer.kind)?fromMenu(["Layer","Rasterize","Layer"],"Rasterize Layer"):[];
    const mask:MenuEntry[]=layer?.hasMask?[...fromMenu(["Layer","Layer Mask","Apply"],"Apply Layer Mask"),...fromMenu(["Layer","Layer Mask","Delete"],"Delete Layer Mask")]:fromMenu(["Layer","Layer Mask",hasSelection?"Reveal Selection":"Reveal All"],"Add Layer Mask");
    return [blendingOptions,
      "-",...fromMenu(["Layer",`${duplicateTitle}…`]),...fromMenu(["Layer","Delete","Layer"],multipleLayers?"Delete Layers":"Delete Layer"),...fromMenu(["Layer","New","Group from Layers…"]),collapseAll,
      "-",...fromMenu(["Layer","Smart Objects","Convert to Smart Object"]),...kind,
      ...(codeLayers?["-",...fromMenu(["Layer","Copy CSS"]),...fromMenu(["Layer","Copy SVG"])] as MenuEntry[]:[]),
      "-",...mask,clipItem,
      "-",...fromMenu(["Layer","Link Layers"]),...fromMenu(["Layer","Select Linked Layers"]),
      "-",...fromMenu(["Layer","Layer Style","Copy Layer Style"]),...fromMenu(["Layer","Layer Style","Paste Layer Style"]),...fromMenu(["Layer","Layer Style","Clear Layer Style"]),
      "-",mergeItem,...fromMenu(["Layer","Merge Visible"]),...fromMenu(["Layer","Flatten Image"]),
      "-",...LAYER_COLORS.map(([color,label]):MenuEntry=>({label,icon:LABEL_SWATCHES[color],disabled:busy||!layer,run:()=>attempt(runPhotoCommand("layer.setColor",{color}))}))];
  };
  const cropOptions=(values:PaintOptions)=>setPaintOptions(current=>({...current,crop:sanitizePaintOptions("crop",{...toolOptions,...values})}));
  // As in Photoshop, choosing a ratio refits the box to the largest of that shape centred in the image.
  const fitCrop=(ratioWidth:number,ratioHeight:number)=>{
    const width=Math.max(1,Math.min(document.width,Math.round(document.height*ratioWidth/ratioHeight))),height=Math.max(1,Math.min(document.height,Math.round(width*ratioHeight/ratioWidth)));
    setCropBox({x:Math.round((document.width-width)/2),y:Math.round((document.height-height)/2),width,height});
  };
  const cropToRatio=(ratioWidth:number,ratioHeight:number)=>{cropOptions({style:"fixedRatio",ratioWidth,ratioHeight});fitCrop(ratioWidth,ratioHeight);};
  // A new width or height refits the box like a ratio; a resolution alone leaves it be.
  const cropToSize=(values:CropSizeValues)=>{
    const next={...toolOptions,style:"size",...values},size=cropSizePixels(next,imagePpi);cropOptions(next);
    if(size&&("sizeWidth" in values||"sizeHeight" in values))fitCrop(size.width,size.height);
  };
  const rotateCropBox=()=>{
    if(!cropBox)return;const scale=Math.min(1,document.width/cropBox.height,document.height/cropBox.width),width=Math.max(1,Math.round(cropBox.height*scale)),height=Math.max(1,Math.round(cropBox.width*scale));
    setCropBox({x:Math.round(Math.min(document.width-width,Math.max(0,cropBox.x+(cropBox.width-width)/2))),y:Math.round(Math.min(document.height-height,Math.max(0,cropBox.y+(cropBox.height-height)/2))),width,height});
    if(toolOptions.style==="fixedRatio")cropOptions({ratioWidth:Number(toolOptions.ratioHeight),ratioHeight:Number(toolOptions.ratioWidth)});
    if(toolOptions.style==="size")cropOptions({sizeWidth:Number(toolOptions.sizeHeight),sizeWidthUnit:String(toolOptions.sizeHeightUnit),sizeHeight:Number(toolOptions.sizeWidth),sizeHeightUnit:String(toolOptions.sizeWidthUnit)});
  };
  const cropContextMenu=():MenuEntry[]=>{
    const saved=matchingCropPreset(cropPresets,toolOptions);
    const ratio=(label:string,width:number,height:number):MenuItem=>({label,radio:true,checked:!saved&&toolOptions.style==="fixedRatio"&&Number(toolOptions.ratioWidth)*height===Number(toolOptions.ratioHeight)*width,disabled:busy,run:()=>cropToRatio(width,height)});
    const sized=toolOptions.style==="size",size=(label:string):MenuItem=>({label,radio:true,checked:!saved&&sized&&cropSizeName(toolOptions)===label,disabled:busy,run:()=>cropToSize(cropSizeChoice(label,[document.width,document.height],imagePpi)!)});
    return [sized?{label:"Clear W x H x Resolution",disabled:busy||!Number(toolOptions.sizeWidth)&&!Number(toolOptions.sizeHeight)&&!Number(toolOptions.resolution),run:()=>cropToSize({sizeWidth:0,sizeHeight:0,resolution:0})}
      :{label:"Clear Ratio",disabled:busy||toolOptions.style!=="fixedRatio",run:()=>cropOptions({style:"normal"})},
      {label:"Reset Crop",disabled:busy,run:resetCrop},{label:"Rotate Crop Box",disabled:busy||!cropBox,run:rotateCropBox},
      "-",{label:"Use Front Image Aspect Ratio",disabled:busy,run:()=>cropToRatio(document.width,document.height)},
      {label:"Use Crop Box Aspect Ratio",disabled:busy||!cropBox,run:()=>{if(cropBox)cropOptions({style:"fixedRatio",ratioWidth:cropBox.width,ratioHeight:cropBox.height});}},
      "-",{label:"Use Front Image Size & Resolution",disabled:busy,run:()=>cropToSize(cropSizeChoice("Front Image",[document.width,document.height],imagePpi)!)},
      {label:"Use Crop Box Size & Resolution",disabled:busy||!cropBox,run:()=>{if(cropBox)cropOptions({style:"size",sizeWidth:cropBox.width,sizeWidthUnit:"px",sizeHeight:cropBox.height,sizeHeightUnit:"px",resolution:imagePpi,resolutionUnit:"in"});}},
      "-",ratio("Original Ratio",document.width,document.height),...CROP_RATIOS.map(([label,width,height])=>ratio(label,width,height)),
      "-",...CROP_SIZES.map(size),
      ...(cropPresets.length?["-" as const,...cropPresets.map((preset):MenuItem=>({label:preset.name,radio:true,checked:saved===preset,disabled:busy,run:()=>applyCropPreset(preset.values,{apply:cropToRatio,applySize:cropToSize,clear:()=>cropOptions({style:"normal"})})}))]:[])];
  };
  const selectionContextMenu=():MenuEntry[]=>hasSelection?[
    ...fromMenu(["Select","Deselect"]),...fromMenu(["Select","Inverse"],"Select Inverse"),...fromMenu(["Select","Modify","Feather…"]),...fromMenu(["Select","Select and Mask…"]),
    "-",...fromMenu(["Select","Save Selection…"]),item("Make Work Path",()=>{setActivePath("work");void command("select.toWorkPath",{tolerance:2});}),
    "-",...fromMenu(["Layer","New","Layer Via Copy"]),...fromMenu(["Layer","New","Layer Via Cut"]),
    "-",...fromMenu(["Edit","Free Transform"]),...fromMenu(["Select","Transform Selection"]),
    "-",...fromMenu(["Edit","Fill…"]),...fromMenu(["Edit","Stroke…"]),
    "-",...fromMenu(["Filter","Last Filter"]),
  ]:[
    ...fromMenu(["Select","All"],"Select All"),...fromMenu(["Select","Reselect"]),
    "-",...fromMenu(["Select","Color Range…"]),...fromMenu(["Select","Load Selection…"]),...fromMenu(["Select","Subject"],"Select Subject"),
    "-",...fromMenu(["Edit","Fill…"]),...fromMenu(["Edit","Stroke…"]),
    "-",...fromMenu(["Filter","Last Filter"]),
  ];
  const contextItems=(menu:NonNullable<typeof contextMenu>):MenuEntry[]=>bare(
    menu.kind==="pasteboard"?[...([["default","Default"],...PASTEBOARD_COLORS,["custom","Custom"]] as [Pasteboard["color"],string][]).map(([color,label]):MenuItem=>({label,checked:pasteboard.color===color,radio:true,disabled:pasteboard.color===color||color==="custom"&&!pasteboard.custom,run:()=>choosePasteboard({...pasteboard,color})})),"-",{label:"Select Custom Color…",run:()=>setPicker("pasteboard")}]:
    menu.kind==="ruler"?RULER_UNITS.map(([unit,label]):MenuItem=>({label,checked:rulerUnit===unit,radio:true,disabled:rulerUnit===unit,run:()=>{const failed=savePreferences({...currentPreferences(),rulerUnit:unit});if(failed)usePhotoWorkspace.setState({error:failed});}})):
    menu.kind==="layer"?layerContextMenu():menu.kind==="fx"?styleItems:menu.kind==="adjustment"?[...fillLayerItems(),"-" as const,...adjustments(true)]:menu.kind==="selection"?selectionContextMenu():menu.kind==="crop"?cropContextMenu():
    menu.kind==="path"?["Delete Path","-","Make Selection…","Fill Path…","Stroke Path…"].flatMap(label=>label==="-"?["-" as const]:pathItems.filter(entry=>entry!=="-"&&entry.label===label)):
    (menu.layers??[]).map(({layer,name})=>({label:name,disabled:busy,run:()=>attempt(runPhotoCommand("layer.select",{layer,target:"pixels",mode:"replace"}).then(()=>setMask(false)))})));
  const openLayerMenu=(layer:PhotoLayer,event:MouseEvent)=>{
    if(busy)return;const at={x:event.clientX,y:event.clientY,kind:"layer" as const};
    if(layer.selected||state?.activeLayer===layer.id)setContextMenu(at);
    else attempt(runPhotoCommand("layer.select",{layer:layer.id,target:"pixels",mode:"replace"}).then(()=>{setMask(false);setContextMenu(at);}));
  };
  const openCanvasMenu=(e:MouseEvent<HTMLCanvasElement>)=>{
    e.preventDefault();if(busy||strokeEnd.current||polygonDraft.current||geometryActive||!currentState||brushResize.current||springMove.current||e.altKey&&(brushTool||tool==="select.quick"))return;
    const at={x:e.clientX,y:e.clientY};
    // Move-tool right-click and Command-right-click list the layers under the pointer, as in Photoshop.
    if(tool==="move"||e.metaKey){const [fx,fy]=surfaceFraction(e.currentTarget,e.clientX,e.clientY);attempt(runPhotoCommand("layer.pickAt",{x:Math.floor(fx*document.width),y:Math.floor(fy*document.height),list:true}).then(result=>{const layers=(result as {layers?:{layer:number;name:string}[]}|null)?.layers;if(layers?.length)setContextMenu({...at,kind:"picker",layers});}));}
    else if(selectionTool)setContextMenu({...at,kind:"selection"});
    else if(tool==="crop")setContextMenu({...at,kind:"crop"});
    else if(brushTool)setBrushPickerAt({...at,tool});
    else if((PEN_TOOLS.includes(tool)||PATH_SELECT_TOOLS.includes(tool))&&selectedPath(currentState,activePath))setContextMenu({...at,kind:"path"});
  };
  const opacitySlider=(brushTool||colorTool)&&tool!=="paint.backgroundEraser"?<PopupSlider label="Opacity" ariaLabel="Brush opacity" unit="%" min={1} max={100} value={Math.round(opacity*100)} disabled={busy} change={value=>setOpacity(value/100)} commit={value=>command("tools.setBrush",{opacity:value/100})}/>:null;
  const toolFields=!!PAINT_TOOL_FIELDS[tool];
  // Scrubbing shows on the canvas as a preview; the layer changes once on release, so a scrub is one history step.
  const layerSlider=(key:"opacity"|"fill",label:string)=>{
    const saved=Math.round((currentLayer?.[key]??1)*100),draft=layerDraft&&layerDraft.layer===currentLayer?.id?layerDraft[key]:undefined;
    return <PopupSlider label={label} ariaLabel={`Layer ${key}`} unit="%" min={0} max={100} value={draft??saved} disabled={busy||!currentLayer}
      change={value=>{if(currentLayer)setLayerDraft(previous=>({...(previous?.layer===currentLayer.id?previous:{}),layer:currentLayer.id,[key]:value,committing:false}));}}
      commit={value=>{if(value===saved){setLayerDraft(null);return;}setLayerDraft(previous=>previous&&{...previous,committing:true});void untilShown(command("layer.setProps",{[key]:value/100})).then(()=>setLayerDraft(previous=>previous?.committing?null:previous));}}/>;
  };
  const pointerDown=(e:PointerEvent<HTMLCanvasElement>)=>{
      if(!isDesignDialogOpen()&&e.button===0&&(spacePan||tool==="hand"||tool==="zoom")){
        e.currentTarget.focus();if(!spacePan&&tool==="zoom"){
          if(scrubbyZoom){e.currentTarget.setPointerCapture(e.pointerId);scrub.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,startZoom:zoom,moved:false,out:e.altKey!==zoomOut};return;}
          zoomAt(z=>e.altKey!==zoomOut?z/1.25:z*1.25,e.clientX,e.clientY);return;}
        const view=stage.current;if(!view)return;e.currentTarget.setPointerCapture(e.pointerId);panDrag.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,left:view.scrollLeft,top:view.scrollTop};return;
      }
      if(!isDesignDialogOpen()&&e.button===0&&tool==="rotateView"){
        // The view turns about the centre of the window, by the angle the pointer sweeps around it.
        const view=stage.current;if(!view)return;e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
        const frame=view.getBoundingClientRect(),cx=frame.left+view.clientWidth/2,cy=frame.top+view.clientHeight/2;
        panDrag.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,left:view.scrollLeft,top:view.scrollTop,spin:{cx,cy,from:Math.atan2(e.clientY-cy,e.clientX-cx),angle:turn.angle}};return;
      }
      if(!isDesignDialogOpen()&&(brushTool||tool==="select.quick")&&e.altKey&&(e.ctrlKey||e.button===2)&&!e.metaKey&&!stroke.current.length&&!strokeEnd.current){
        e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
        brushResize.current={pointerId:e.pointerId,client:{x:e.clientX,y:e.clientY},imageX:point(e)[0],size:tool==="select.quick"?Number(toolOptions.size)||1:size,hardness};setResizeReadout({x:e.clientX,y:e.clientY});return;
      }
      if(isDesignDialogOpen()||e.button!==0||(viewPreview.active&&!viewPreview.url))return;
      const live=usePhotoWorkspace.getState();
      if(stateVersion!==document.version||(busy||live.busy)&&!polygonDraft.current){
        // As in Photoshop, a stroke begun while the previous edit still commits is kept and runs once it lands.
        if((!live.busy||live.quiet)&&!heldStroke.current&&!stroke.current.length&&(brushTool||selectionTool&&tool!=="polygonLasso"&&tool!=="magneticLasso"))holdStroke(e);
        return;
      }
      e.currentTarget.focus();
      // As in Photoshop, a held Command key is the Move tool's, so its Command-click toggles Auto-Select there too.
      if(e.metaKey&&!e.ctrlKey&&!e.altKey&&!polygonDraft.current&&!NO_SPRING_MOVE.includes(tool)){
        if(!autoSelect){const [x,y]=point(e);command("layer.pickAt",{x:Math.round(x),y:Math.round(y),target:autoSelectTarget});}
        gestureStart.current=gestureCurrent.current={shiftKey:e.shiftKey,altKey:e.altKey};e.currentTarget.setPointerCapture(e.pointerId);strokePointer.current=e.pointerId;stroke.current=[point(e)];seed.current=null;springMove.current=true;
        strokeEnd.current=holdImageGesture("Finish or cancel the image gesture before switching projects or disabling XDesign.");draw();return;
      }
      if(tool==="magneticLasso"||PATH_SELECT_TOOLS.includes(tool))return;
      if(tool==="eyedropper"||e.altKey&&SAMPLING_TOOLS.includes(tool)){
        const key=tool==="eyedropper"&&e.altKey?"background":"foreground";
        if(tool==="eyedropper"){e.currentTarget.setPointerCapture(e.pointerId);sampleDrag.current={pointerId:e.pointerId,key,busy:true};const previous=key==="background"?background:paintColor;if(showRing)setRing({x:e.clientX,y:e.clientY,color:previous,previous});sampleColor(e,key)?.finally(()=>{if(sampleDrag.current&&sampleDrag.current.pointerId===e.pointerId)sampleDrag.current.busy=false;});return;}
        sampleColor(e,key);return;
      }
      if(tool==="polygonLasso"){addPolygonPoint(e);return;}
      if(PEN_DRAFT_TOOLS.includes(tool)){addPenPoint(e);return;}
      if(tool==="text"){if(canvasText)return;const [x,y]=point(e),layer=state&&findTextLayer(state.layers,x,y);setCanvasText(layer?{layer}:{point:[x,y]});return;}
      if(tool==="move"&&autoSelect!==e.metaKey){const [x,y]=point(e);command("layer.pickAt",{x:Math.round(x),y:Math.round(y),target:autoSelectTarget});}
      if(e.altKey&&["paint.cloneStamp","paint.healingBrush"].includes(tool)){command("cloneSource.set",{...(cloneSources?{index:cloneSources.active}:{}),source:point(e).slice(0,2)});return;}
      if(["paint.cloneStamp","paint.healingBrush"].includes(tool)&&!cloneSource?.source){usePhotoWorkspace.setState({error:"Alt-click the image to choose a source point first."});return;}
      if(["paint.cloneStamp","paint.healingBrush"].includes(tool))cloneGesture.current=JSON.stringify([projectId,document.id,document.version,displayState?.viewKey,cloneSources]);
      if(tool==="paint.colorReplacement"&&grayscaleTarget){usePhotoWorkspace.setState({error:"Color replacement edits layer pixels. Select the layer pixels before painting."});return;}
      if(tool==="paint.historyBrush"||eraseToHistory){if(!historyChoice?.available){setPreviewStatus(historyChoice?historyChoice.reason??"The paint target did not exist in this history state.":historySource?"The History Brush source is no longer retained. Set another in the History panel.":"Set a History Brush source in the History panel before painting.");return;}if(!historySource)setHistorySource(historyChoice.id);}
      if(tool==="paint.patch"){
        if(!projectId||activeProjectId!==projectId){setPreviewStatus("Open this image from the current project before using Patch.");return;}
        if(!currentState?.hasSelection||!currentState.selectionBounds){setPreviewStatus("Make a bounded selection before using the Patch tool.");return;}
        if(state?.channels?.target?.kind==="color"){setPreviewStatus("Patch can target pixels, masks, alpha channels, or Quick Mask. Return to the composite to patch layer pixels.");return;}
        const pointerId=e.pointerId??1,start=point(e).slice(0,2) as [number,number],target=patchTarget({layer:state?.layerMaskView?.layer??currentLayer?.id??null,mask:paintingMask,quickMask:!!state?.quickMask&&state?.channels?.target?.kind!=="alpha",channel:state?.channels?.target});
        const drag:PatchDrag={pointerId,start,current:start,projectId,photoId:document.id,version:document.version,viewKey:displayState?.viewKey??"",mode:toolOptions.mode==="destination"?"destination":"source",target,bounds:currentState.selectionBounds};patchDrag.current=drag;
        e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);strokePointer.current=pointerId;stroke.current=[];seed.current=null;patchPreviewCount.current=0;setPreviewStatus(null);
        strokeEnd.current=holdImageGesture("Finish or cancel the Patch drag before switching projects or disabling XDesign.");
        if(nativeFeedback&&isTauri()&&displayState?.viewKey){const pixels=strokePixels(beginStrokeSurface(),"paint.patch");nativeStroke.current=new NativeStrokePreview(pixels.load,(_tiles,count,error)=>{strokeCount.current=count;setPreviewStatus(error);redrawStroke.current();},undefined,1_000_000,undefined,pixels.paint);}
      draw();previewStroke();return;
      }
      if(tool==="paint.magicEraser"||tool==="paint.backgroundEraser"){
        if(!projectId||activeProjectId!==projectId){setPreviewStatus("Open this image from the current project before using an eraser.");return;}
        const target:EraserTargetState={activeLayer:state?.activeLayer??null,layerKind:currentLayer?.kind??null,channelKind:state?.channels?.target?.kind??"composite",maskView:!!state?.layerMaskView,quickMask:!!state?.quickMask,paintingMask};
        const problem=eraserTargetProblem(target);if(problem){setPreviewStatus(problem);return;}
        eraserGesture.current={projectId,photoId:document.id,version:document.version,viewKey:displayState?.viewKey??"",layerId:state!.activeLayer!,target};eraserCommitOverflow.current=false;eraserPreviewCapped.current=false;
      }
      gestureStart.current=tool==="crop"||tool==="straighten"||SHAPE_TOOLS.includes(tool)?{shiftKey:false,altKey:false}:{shiftKey:e.shiftKey,altKey:e.altKey};gestureCurrent.current={shiftKey:e.shiftKey,altKey:e.altKey};setPreviewStatus(tool==="paint.backgroundEraser"&&!feedbackAvailable?"Native Background Eraser preview is limited to 16 megapixels; the complete stroke still commits.":null);
      e.currentTarget.setPointerCapture(e.pointerId);strokePointer.current=e.pointerId;stroke.current=strokeStart(e);seed.current=nativeStrokeTool?strokeSeed():null;
      strokeEnd.current=holdImageGesture("Finish or cancel the image gesture before switching projects or disabling XDesign.");
      if(nativeStrokeTool&&feedbackAvailable&&nativeFeedback&&isTauri()&&projectId&&displayState?.viewKey){const command=tool==="erase"?"paint.stroke":tool,strokeSeedForRelease=seed.current,isScratchEraser=tool==="paint.magicEraser"||tool==="paint.backgroundEraser",pixels=strokePixels(beginStrokeSurface(),command);
        nativeStroke.current=new NativeStrokePreview(pixels.load,(_tiles,count,error)=>{strokeCount.current=count;setPreviewStatus(error);redrawStroke.current();},undefined,tool==="paint.backgroundEraser"?4096:retouchPreview&&!continuousRetouch?2048:65536,{append:isScratchEraser?false:!retouchPreview||continuousRetouch,release:isScratchEraser?async()=>{}:()=>invoke("xdesign_photo_stroke_end",{projectId,photoId:document.id,version:document.version,viewKey:displayState.viewKey,seed:strokeSeedForRelease})},pixels.paint);}
      drawCloneMarker(stroke.current[0]!);draw();previewStroke();
    
  };
  const holdStroke=(e:PointerEvent<HTMLCanvasElement>)=>{
    e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
    const held:HeldStroke={pointerId:e.pointerId,tool,down:heldSample(e),moves:[],up:null,until:performance.now()+2000};heldStroke.current=held;
    const wait=()=>{
      if(heldStroke.current!==held||replayHeld.current())return;
      if(performance.now()<held.until){requestAnimationFrame(wait);return;}
      heldStroke.current=null;const canvas=overlay.current;if(canvas?.hasPointerCapture(held.pointerId))canvas.releasePointerCapture(held.pointerId);
      setPreviewStatus("The image was still busy; start the stroke again.");
    };
    requestAnimationFrame(wait);
  };
  replayHeld.current=()=>{
    const held=heldStroke.current,canvas=overlay.current;if(!held||!canvas)return true;
    if(busy||usePhotoWorkspace.getState().busy||stateVersion!==document.version)return false;
    heldStroke.current=null;
    if(held.tool!==tool){if(canvas.hasPointerCapture(held.pointerId))canvas.releasePointerCapture(held.pointerId);return true;}
    // The pointer is already captured, or released if the stroke ended while held.
    const target={getBoundingClientRect:()=>canvas.getBoundingClientRect(),closest:(selector:string)=>canvas.closest(selector),focus:()=>canvas.focus(),setPointerCapture:()=>{},hasPointerCapture:(id:number)=>canvas.hasPointerCapture(id),releasePointerCapture:(id:number)=>{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}};
    const event=(sample:HeldSample)=>({...sample,pointerId:held.pointerId,button:0,currentTarget:target,nativeEvent:sample,preventDefault:()=>{},getModifierState:(key:string)=>key==="CapsLock"&&capsLock}) as unknown as PointerEvent<HTMLCanvasElement>;
    pointerDown(event(held.down));for(const sample of held.moves)pointerMove(event(sample));if(held.up)finish(event(held.up));
    return true;
  };
  const pointerMove=(e:PointerEvent<HTMLCanvasElement>)=>{const scrubbing=scrub.current;if(scrubbing&&scrubbing.pointerId===e.pointerId){const dx=e.clientX-scrubbing.x;if(scrubbing.moved||Math.abs(dx)>3){scrubbing.moved=true;zoomAt(()=>scrubbing.startZoom*1.01**dx,scrubbing.x,scrubbing.y);}return;}const dragging=sampleDrag.current;if(dragging&&dragging.pointerId===e.pointerId){setRing(current=>current&&{...current,x:e.clientX,y:e.clientY});if(!dragging.busy){dragging.busy=true;sampleColor(e,dragging.key)?.finally(()=>{dragging.busy=false;});}return;}tipPointer.current={x:e.clientX,y:e.clientY};setCapsLock(e.getModifierState("CapsLock"));const held=heldStroke.current;if(held&&held.pointerId===e.pointerId){const coalesced=e.nativeEvent.getCoalescedEvents?.();for(const event of coalesced?.length?coalesced:[e.nativeEvent])held.moves.push({...heldSample(event),shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,ctrlKey:e.ctrlKey});placeBrushTip();return;}if(resizeBrush(e))return;placeBrushTip();if(brushTool&&(e.shiftKey||lineHint.current)&&!stroke.current.length)showLineHint(e.shiftKey);if(flyout==="Info"){const [x,y]=point(e);useInfoCursor.getState().set([x,y]);}const pan=panDrag.current;if(pan){if(pan.pointerId===e.pointerId&&pan.spin){const angle=pan.spin.angle+(Math.atan2(e.clientY-pan.spin.cy,e.clientX-pan.spin.cx)-pan.spin.from)*180/Math.PI;turnView({angle:e.shiftKey?Math.round(angle/15)*15:angle});}else if(pan.pointerId===e.pointerId&&stage.current){stage.current.scrollLeft=pan.left-(e.clientX-pan.x);stage.current.scrollTop=pan.top-(e.clientY-pan.y);}return;}if(!stroke.current.length)drawCloneMarker(point(e));if(penDragging.current){penHandles.current[penHandles.current.length-1]=point(e).slice(0,2) as [number,number];draw();return;}if(polygonDraft.current){const at=point(e),first=stroke.current[0]!,[shownWidth,shownHeight]=surfaceSize(e.currentTarget);setDraftClosing(stroke.current.length>=(PEN_DRAFT_TOOLS.includes(tool)?2:3)&&Math.hypot((at[0]-first[0])*shownWidth/document.width,(at[1]-first[1])*shownHeight/document.height)<=6);polygonCursor.current=polygonPoint(stroke.current.at(-1)!,at,e.shiftKey);draw();return;}if(patchDrag.current){if(patchDrag.current.pointerId!==(e.pointerId??1))return;patchDrag.current.current=point(e).slice(0,2) as [number,number];draw();previewStroke();return;}if(!stroke.current.length||strokePointer.current!==e.pointerId)return;if(tool==="paint.magicEraser"&&!springMove.current)return;gestureCurrent.current={shiftKey:e.shiftKey,altKey:e.altKey};const coalesced=e.nativeEvent.getCoalescedEvents?.();for(const event of coalesced?.length?coalesced:[e.nativeEvent]){if(tool==="paint.backgroundEraser"&&eraserCommitOverflow.current)continue;if(tool==="paint.backgroundEraser"&&stroke.current.length>=BACKGROUND_ERASER_COMMIT_SAMPLES){eraserCommitOverflow.current=true;nativeStroke.current?.clearReplacement();setPreviewStatus("Background Eraser exceeded the native 131,072-sample limit; release cancels without editing.");continue;}const next=constrained(point({...e,clientX:event.clientX,clientY:event.clientY,pressure:event.pressure,pointerType:event.pointerType??e.pointerType,tiltX:event.tiltX,tiltY:event.tiltY,twist:event.twist,timeStamp:event.timeStamp} as PointerEvent<HTMLCanvasElement>),e.shiftKey);if(next)stroke.current.push(next);}if(!eraserCommitOverflow.current){if(!springMove.current)drawCloneMarker(stroke.current.at(-1)!);draw();previewStroke();}};
  // WebKit doesn't focus clicked buttons, and fields blur to body on Enter; either way keys would miss this handler and reach the shell (⌘L → R.O.S.I.E).
  // WebKit's own menu offers Reload, which drops the open document; Photoshop shows none outside text fields.
  const cloneSourceControls=cloneSources&&<><label>Clone source<select aria-label="Clone source slot" disabled={busy} value={cloneSources.active} onChange={event=>command("cloneSource.select",{index:Number(event.target.value)})}>{cloneSources.sources.map(slot=><option key={slot.index} value={slot.index}>Source {slot.index+1}{slot.source?"":" · empty"}</option>)}</select></label>{cloneSource?.source&&<p className="xd-photo-section-help">Source: {Math.round(cloneSource.source[0])}, {Math.round(cloneSource.source[1])} · Alt-click to replace</p>}<CloneSourceSettings slot={cloneSource} context={cloneSourceContext} disabled={busy||!cloneSource?.source||!displayState} commit={(context,params)=>updateCloneSource(context,"cloneSource.set",params)} reset={context=>updateCloneSource(context,"cloneSource.resetTransform",{})}/><CloneOverlaySettings overlay={cloneSources.overlay} context={cloneSourceContext} disabled={busy||!displayState} commit={params=>command("cloneSource.overlay",params)}/></>;
  return <section className="xd-photo" tabIndex={-1} aria-label="Image editor" data-screen-mode={screenMode===1?"menu":screenMode===2?"full":undefined} data-full-panels={screenMode===2&&fullScreenPanels||undefined} onContextMenu={e=>{if(!editsText(e.target))e.preventDefault();}} onFocusCapture={()=>{if(isDesignDialogOpen())clearCloneMarker();}} onBlur={e=>{const section=e.currentTarget;if(!e.relatedTarget&&e.target!==section)requestAnimationFrame(()=>{const page=section.ownerDocument;if(page.activeElement===page.body&&page.hasFocus()&&section.isConnected&&!isDesignDialogOpen()&&!section.closest(".ot-window.unfocused"))section.focus({preventScroll:true});});}} onKeyUp={e=>{if(e.key===" ")setSpacePan(false);if(e.key==="Shift")showLineHint(false);}} onKeyDown={e=>{
    if(e.key==="Shift"&&!e.repeat)showLineHint(true);
    if(isDesignDialogOpen())return;
    if(e.key==="Escape"&&strokeEnd.current){e.preventDefault();e.stopPropagation();resetStroke();return;}
    if((e.target as HTMLElement).closest("input,select,textarea"))return;
    // Menu bar and flyout triggers keep focus after a choice, so single-key shortcuts, function keys, Delete and Escape pass through them as they would from Photoshop's document; Space, Enter, Tab and arrows stay with the button.
    const menuHost=(e.target as HTMLElement).closest(".xd-menu,.xd-menubar,.xd-editor-menu");
    if(!e.metaKey&&!e.ctrlKey&&menuHost&&!(!menuHost.classList.contains("xd-menu")&&(e.key.length===1&&e.key!==" "||/^(F\d+|Escape|Delete|Backspace)$/.test(e.key))))return;
    if(selectionBox&&(e.key==="Enter"||e.key==="Escape")){e.preventDefault();e.stopPropagation();if(e.key==="Enter")commitSelectionTransform();else setSelectionBox(null);return;}
    if(cropBox&&(e.key==="Enter"||e.key==="Escape")){e.preventDefault();e.stopPropagation();if(e.key==="Enter")commitCrop();else resetCrop();return;}
    // As in Photoshop, O cycles the crop overlay and Shift+O its orientation while a crop box is up.
    if(cropBox&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==="o"){e.preventDefault();e.stopPropagation();if(e.shiftKey)turnCropGuide();else cycleCropGuide();return;}
    // H, / and X are crop shortcuts only while a crop box is up; otherwise they keep their usual meaning.
    if(cropBox&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&["h","/","x"].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();const key=e.key.toLowerCase();if(key==="h")setCropShowCropped(value=>!value);else if(key==="/")setCropShield(value=>!value);else if(!busy)rotateCropBox();return;}
    if((e.metaKey||e.ctrlKey)&&!e.altKey&&["0","1","=","+","-"].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==="0")fit();else zoomAt(z=>e.key==="1"?1:e.key==="-"?z/1.25:z*1.25);return;}
    if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&/^[2-9]$/.test(e.key)&&state){const slot=channelSlots(state).find(item=>item.slot===Number(e.key));if(slot){e.preventDefault();e.stopPropagation();setMask(false);command("channel.target",{channel:slot.channel});return;}}
    if(e.key===" "&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!(e.target as HTMLElement).closest("[contenteditable]")){e.preventDefault();e.stopPropagation();if(!e.repeat)setSpacePan(true);return;}
    if(polygonDraft.current){
      if(e.key==="Enter"){e.preventDefault();e.stopPropagation();finishPolygon();}
      if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();e.stopPropagation();if(stroke.current.length>1){stroke.current.pop();penHandles.current.splice(stroke.current.length);setPolygonVertices(stroke.current.length);setPreviewStatus(null);draw();}else resetStroke();}
      return;
    }
    // Edit › Keyboard Shortcuts can move these, so the key is whatever the customised Edit menu binds.
    const clipboardId=(e.metaKey||e.ctrlKey)&&!(e.target as HTMLElement).closest("[contenteditable]")?CLIPBOARD_COMMANDS[findShortcut(menus.find(spec=>spec.label==="Edit")?.items??[],e.nativeEvent)?.label??""]:undefined;
    if(clipboardId){
      e.stopPropagation();if(busy||strokeEnd.current||e.repeat||e.nativeEvent.isComposing){e.preventDefault();return;}
      // ⌘V keeps its default so the app menu's Paste can deliver images copied in other apps.
      if(clipboardId.startsWith("edit.paste")){catchPaste(e.currentTarget,data=>{const image=clipboardImage(data);if(image)attempt(placeImageBlob(image));else clipboard(clipboardId);},()=>clipboard(clipboardId));return;}
      // Internal copies clear the system clipboard so an older outside image can't win the next paste.
      e.preventDefault();void navigator.clipboard?.writeText("").catch(()=>{});clipboard(clipboardId);return;
    }
    if(busy||strokeEnd.current)return;
    // As in Photoshop, F cycles the screen modes (Shift+F backwards) and Esc leaves Full Screen Mode.
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.repeat&&e.key.toLowerCase()==="f"&&!(e.target as HTMLElement).closest("[contenteditable]")){e.preventDefault();e.stopPropagation();chooseScreenMode((screenMode+(e.shiftKey?2:1))%3);return;}
    if(e.key==="Escape"&&screenMode===2){e.preventDefault();e.stopPropagation();chooseScreenMode(0);return;}

    const shortcut=(e.metaKey||e.ctrlKey||/^F\d+$/.test(e.key)||e.altKey&&!(e.target as HTMLElement).closest("input,textarea,select"))&&!e.nativeEvent.isComposing&&!(e.target as HTMLElement).closest("[contenteditable]")?findShortcut([...menus,{label:"",items:layerKeys}],e.nativeEvent):undefined;
    if(shortcut){e.preventDefault();e.stopPropagation();if(!e.repeat&&!shortcut.disabled&&shortcut.run)shortcut.run();return;}
    const letter=!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.repeat&&!geometryActive&&e.key.length===1?e.key.toUpperCase():"",choices=letter?toolbar.groups.flatMap(group=>group.tools).filter(item=>item.shortcut===letter):[];
    if(choices.length){e.preventDefault();e.stopPropagation();const index=choices.findIndex(item=>item.id===tool);setTool(index<0?(choices.find(item=>item.id===lastTools.current[letter])??choices[0]!).id:e.shiftKey?choices[(index+1)%choices.length]!.id:tool);return;}
    if((e.key==="Delete"||e.key==="Backspace")&&tool==="slice.select"){e.preventDefault();e.stopPropagation();const slice=findSlice(displayState?.analysis?.slices??[],useAnalysisTool.getState().slice);if(slice?.id!=null&&!displayState?.analysis?.slicesLocked)command("slice.delete",{slice:slice.id});return;}
    if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();e.stopPropagation();if(e.altKey||e.metaKey||e.ctrlKey)command("edit.fill",{contents:e.altKey?"foreground":"background"});else if(state?.hasSelection)command("edit.clear");else if(!paintingMask&&!state?.quickMask&&(!state?.channels?.target||state.channels.target.kind==="composite")&&currentLayer)command("layer.delete");}
    if(e.key.toLowerCase()==="q"&&!e.metaKey&&!e.ctrlKey){e.preventDefault();setMask(false);command("select.editInQuickMaskMode");}
    if(e.key.toLowerCase()==="x"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();e.stopPropagation();if(grayscaleTarget)setChannelColor(value=>value==="#000000"?"#ffffff":"#000000");else paletteCommand("tools.swapColors");}
    if(e.key.toLowerCase()==="d"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();e.stopPropagation();if(grayscaleTarget)setChannelColor("#000000");else paletteCommand("tools.defaultColors");}
    if(brushTool&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&(e.key==="{"||e.key==="}"||e.shiftKey&&(e.key==="["||e.key==="]"))){
      e.preventDefault();e.stopPropagation();const up=e.key==="}"||e.key==="]";setHardness(value=>Math.max(0,Math.min(1,(up?Math.floor(value*4+1e-9)+1:Math.ceil(value*4-1e-9)-1)/4)));
    }
    else if((brushTool||tool==="select.quick")&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&(e.key==="["||e.key==="]")){
      e.preventDefault();e.stopPropagation();const up=e.key==="]";
      if(tool==="select.quick")setPaintOptions(current=>({...current,[tool]:{...current[tool],size:stepBrushSize(Number(toolOptions.size),up,5000)}}));
      else setSize(value=>stepBrushSize(value,up,tool==="paint.backgroundEraser"?5000:1000));
    }
    // Airbrush swaps the keys: digits set Flow and Shift+digits Opacity. Tools that don't paint set the layer's Opacity, or its Fill with Shift.
    const airbrush=brushTool&&!!state?.brush?.settings?.buildUp&&!!BRUSH_BAR_ITEMS[tool]?.includes("airbrush")&&!!PAINT_TOOL_FIELDS[tool]?.some(field=>field.key==="flow");
    const nonPainting=!tool.startsWith("paint.")&&tool!=="erase",flowKey=e.shiftKey!==airbrush,layerKey=nonPainting&&!!currentLayer&&!isBackgroundLayer(currentLayer)&&!busy;
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&/^Digit\d$/.test(e.nativeEvent.code)&&(layerKey||(flowKey?PAINT_TOOL_FIELDS[tool]?.some(field=>field.key==="flow"):(brushTool||colorTool)&&tool!=="paint.backgroundEraser"))){
      e.preventDefault();e.stopPropagation();
      // Two digits typed quickly set an exact percentage; a single 0 means 100%.
      const digit=e.nativeEvent.code.slice(5),now=e.timeStamp,previous=typedDigit.current,pair=!!previous.digit&&now-previous.time<600;
      const percent=pair?Math.max(1,Number(previous.digit+digit)):digit==="0"?100:Number(digit)*10;
      typedDigit.current=pair?{digit:"",time:0}:{digit,time:now};
      if(layerKey)void command("layer.setProps",{[e.shiftKey?"fill":"opacity"]:percent/100});
      else if(flowKey)setPaintOptions(current=>({...current,[tool]:{...current[tool],flow:percent}}));else setOpacity(percent/100);
    }
    if(e.key==="Tab"&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&(e.target===e.currentTarget||e.target===overlay.current)){
      e.preventDefault();e.stopPropagation();if(screenMode===2){setFullScreenPanels(value=>!value);return;}const show=!panels.left&&!panels.right;if(panels.left!==show)panels.toggle("left");if(panels.right!==show)panels.toggle("right");
    }
  }}>
    <header className="xd-photo-header xd-ps-menubar" inert={geometryActive&&!warpSession}>
      <button className="xd-editor-icon-button" disabled={busy||geometryActive} aria-label={smartTrail.length?"Save contents and return to parent":"Back to design"} title={smartTrail.length?"Save contents and return to parent":"Back to design"} onClick={()=>{if(smartTrail.length)attempt(finishSmartContents(true));else usePhotoWorkspace.getState().close();}}><House size={15}/></button>
      {/* During a Warp only Edit › Transform stays live; the rest would change the document under it. */}
      <MenuBar label="Image menus" menus={warpSession?menus.map(menu=>({...menu,items:menu.items.map(entry=>entry==="-"||menu.label==="Edit"&&entry.label==="Transform"?entry:{...entry,disabled:true})})):menus}/>
      <span className="xd-ps-spacer"/>
      <div className="xd-editor-history" inert={geometryActive}><button className="xd-editor-icon-button" disabled={busy||!canUndo} aria-label="Undo" title="Undo (⌘Z)" onClick={undo}><Undo2 size={16}/></button><button className="xd-editor-icon-button" disabled={busy||!canRedo} aria-label="Redo" title="Redo (⇧⌘Z)" onClick={redo}><Redo2 size={16}/></button></div>
      <button className="xd-editor-icon-button" aria-label="Browse all image actions" title="Search image actions" disabled={busy||geometryActive} onClick={()=>setCommandsOpen(true)}><Search size={15}/></button>
      <div className="xd-editor-panel-toggles" inert={geometryActive}><button className="xd-editor-icon-button" aria-label={`${panels.left?"Hide":"Show"} properties panel`} title={`${panels.left?"Hide":"Show"} Properties`} aria-expanded={panels.left} aria-controls={panels.rightId} disabled={busy} onClick={()=>panels.toggle("left")}><SlidersHorizontal size={15}/></button><button className="xd-editor-icon-button" aria-label={`${panels.right?"Hide":"Show"} layers panel`} title={`${panels.right?"Hide":"Show"} Layers`} aria-expanded={panels.right} aria-controls={panels.rightId} disabled={busy} onClick={()=>panels.toggle("right")}><Layers size={15}/></button></div>
    </header>
    <div className="xd-photo-options xd-ps-options" hidden={!chrome.options} inert={busy||geometryActive&&!(perspectiveCrop&&tool==="perspectiveCrop")}><span className="xd-ps-tool-preset" role="img" aria-label={`Current tool: ${toolLabel}`} title={toolLabel}>{ToolIcon&&<ToolIcon size={16}/>}<ChevronDown size={9}/></span>
      {brushTool&&<BrushPresetPicker size={size} hardness={hardness} maxSize={tool==="paint.backgroundEraser"?5000:1000} presets={state?.brush?.presets??[]} revision={state?.brush?.revision} disabled={busy} at={brushPickerAt?.tool===tool?brushPickerAt:null} dismiss={()=>setBrushPickerAt(null)}
        change={patch=>{if(patch.size!==undefined)setSize(patch.size);if(patch.hardness!==undefined)setHardness(patch.hardness);}} commit={patch=>command("tools.setBrush",patch)}
        selectPreset={name=>attempt(runPhotoCommand("tools.setBrush",{preset:name}).then(()=>{const settings=usePhotoWorkspace.getState().state?.brush?.settings;if(settings)changedBrush(settings);}))}/>}
      {brushTool&&BRUSH_BAR_ITEMS[tool]&&<BrushSettingsToggle open={flyout==="Brush Settings"} toggle={()=>flyout==="Brush Settings"?setFlyout(null):openPanel("Brush Settings")}/>}
      {!toolFields&&opacitySlider}
      {PEN_TOOLS.includes(tool)&&<label>Mode<select aria-label="Pen mode" value={penMode} onChange={event=>setPenMode(event.target.value as "shape"|"path")}><option value="shape">Shape</option><option value="path">Path</option></select></label>}
      {(SHAPE_TOOLS.includes(tool)||PEN_TOOLS.includes(tool)&&penMode==="shape")&&<><ShapeStyleFields style={shapeStyle} change={patch=>setShapeStyle(current=>({...current,...patch}))}/><PathOpSelect value={pathOp} change={setPathOp} merge={currentLayer?.kind==="Shape"&&!busy?()=>command("layer.combineShapes.mergeShapeComponents"):undefined}/></>}
      {tool==="shape.rect"&&<label>Radius<input aria-label="Corner radius" className="xd-ps-number" type="number" min="0" max="10000" value={cornerRadius} onChange={event=>setCornerRadius(Math.max(0,Math.min(10000,event.target.valueAsNumber||0)))}/><span>px</span></label>}
      {tool==="shape.polygon"&&<><label>Sides<input aria-label="Number of sides" className="xd-ps-number" type="number" min="3" max="100" value={polygonSides} onChange={event=>setPolygonSides(Math.max(3,Math.min(100,Math.round(event.target.valueAsNumber)||3)))}/></label><label>Star Ratio<input aria-label="Star ratio" className="xd-ps-number" type="number" min="1" max="100" value={starRatio} onChange={event=>setStarRatio(Math.max(1,Math.min(100,Math.round(event.target.valueAsNumber)||100)))}/><span>%</span></label></>}
      {tool==="shape.line"&&<label>Weight<input aria-label="Line weight" type="number" min="1" max="1000" value={lineWeight} onChange={event=>setLineWeight(Math.max(1,Math.min(1000,event.target.valueAsNumber||1)))}/><span>px</span></label>}
      {colorTool&&grayscaleTarget&&<div className="xd-photo-mask-tones" aria-label="Channel paint tones"><button aria-label="Paint black" title="Paint black (X swaps black/white)" aria-pressed={channelColor==="#000000"} onClick={()=>setChannelColor("#000000")}><span style={{background:"#000000"}}/></button><button aria-label="Paint white" title="Paint white (X swaps black/white)" aria-pressed={channelColor==="#ffffff"} onClick={()=>setChannelColor("#ffffff")}><span style={{background:"#ffffff"}}/></button></div>}
      {selectionTool&&<SelectionModeCluster value={tool==="select.quick"&&selectionMode==="intersect"?"replace":selectionMode} modes={tool==="select.quick"?["replace","add","subtract"]:["replace","add","subtract","intersect"]} change={setSelectionMode}/>}
      {tool==="crop"&&document&&<CropRatioFields values={toolOptions} ratios={CROP_RATIOS} original={[document.width,document.height]} resolution={imagePpi} disabled={busy} apply={cropToRatio} applySize={cropToSize} clear={()=>cropOptions({style:"normal"})}/>}
      {tool==="paint.gradient"&&<><select aria-label="Gradient mode" disabled={grayscaleTarget} value={grayscaleTarget||!liveGradient?"classic":"live"} onChange={event=>setLiveGradient(event.target.value==="live")}><option value="live">Gradient</option><option value="classic">Classic gradient</option></select>{state?.presets&&<GradientToolPick current={state.presets.gradient} live={liveGradient&&!grayscaleTarget} foreground={paintColor} background={background} disabled={busy} select={params=>command("gradient.presets.select",params)}/>}<GradientTypeIcons value={gradientStyle} change={setGradientStyle}/></>}
      {tool==="perspectiveCrop"&&document&&<PerspectiveCropBar values={toolOptions} original={[document.width,document.height]} resolution={imagePpi} disabled={busy} change={values=>setPaintOptions(current=>({...current,perspectiveCrop:sanitizePaintOptions("perspectiveCrop",{...toolOptions,...values})}))}/>}
      {toolFields&&tool!=="crop"&&tool!=="perspectiveCrop"&&<div className="xd-ps-tool-options"><PaintToolOptions tool={tool} lead={opacitySlider} hide={tool==="paint.gradient"&&liveGradient&&!grayscaleTarget?["mode"]:undefined} before={tool==="paint.gradient"?{dither:<label><input type="checkbox" checked={gradientReverse} onChange={event=>setGradientReverse(event.target.checked)}/>Reverse</label>,method:(grayscaleTarget||!liveGradient)&&<label><input type="checkbox" aria-label="Gradient transparency" checked={gradientTransparency} onChange={event=>setGradientTransparency(event.target.checked)}/>Transparency</label>}:undefined} values={toolOptions} disabled={busy} presets={state?.presets} selectPattern={pattern=>command("pattern.presets.select",{pattern})} change={values=>setPaintOptions(current=>({...current,[tool]:sanitizePaintOptions(tool,values)}))}/></div>}<BrushBarItems tool={tool} settings={(state?.brush?.settings??{}) as BrushBarSettings} patch={patch=>command("tools.setBrush",patch)} symmetry={{current:symmetryChoice[document.id]??"",saved:state?.paths?.saved??[],hasWorkPath:!!state?.paths?.work,choose:chooseSymmetry}}/>
      {(nativeStrokeTool||tool==="paint.patch")&&<MenuButton label="Brush options" icon={GearIcon} iconOnly items={[{label:"Native feedback",checked:nativeFeedback&&feedbackAvailable,disabled:!feedbackAvailable,run:()=>setNativeFeedback(value=>!value)}]}/>}
      {tool==="move"&&<><label><input type="checkbox" aria-label="Auto-Select" checked={autoSelect} onChange={event=>setAutoSelect(event.target.checked)}/>Auto-Select:</label><select aria-label="Auto-Select target" disabled={!autoSelect} value={autoSelectTarget} onChange={event=>setAutoSelectTarget(event.target.value as "layer"|"group")}><option value="layer">Layer</option><option value="group">Group</option></select>
        <label><input type="checkbox" aria-label="Show Transform Controls" checked={transformControls} onChange={event=>setTransformControls(event.target.checked)}/>Show Transform Controls</label>
        <div role="group" aria-label="Align" className="xd-ps-icon-cluster">{ALIGN_BUTTONS.map(([edge,label,Icon])=><button key={edge} aria-label={label} title={label} disabled={busy||!currentLayer} onClick={()=>command(`layer.align.${edge}`)}><Icon size={16}/></button>)}</div><DistributeMenu disabled={busy||!currentLayer} run={id=>command(id)}/>
        </>}
      {tool==="text"&&<><TypeBar font={textLayer?.text?.font??textFont} size={textLayer?.text?.sizePt??textSize} style={textStyle} align={textAlign} antialias={textLayer?.text?.antialias??textAntialias} orientation={textLayer?.text?.orientation??textOrientation} fonts={fonts} warpDisabled={!textLayer} color={typeColorDraft??(textLayer?.text?(()=>{const value=rangeStyle(textLayer.text.runs??[],[0,Number.MAX_SAFE_INTEGER],"color");return typeof value==="string"?value.slice(0,7):typeColor??paintColor;})():typeColor??paintColor)} changeColor={setTypeColorDraft} commitColor={()=>{if(typeColorDraft===null)return;if(textLayer)command("type.setStyle",{layer:textLayer.id,color:typeColorDraft});else setTypeColor(typeColorDraft);setTypeColorDraft(null);}} patch={typePatch} warp={()=>setTextWarp(true)}/></>}
      {ANALYSIS_TOOLS.includes(tool)&&<AnalysisOptions tool={tool} analysis={displayState?.analysis} toggleNotes={()=>flyout==="Notes"?setFlyout(null):openPanel("Notes")}/>}
      {tool==="eyedropper"&&<label>Sample:<select aria-label="Sample layers" value={sampleLayer} onChange={event=>setSampleLayer(event.target.value as "all"|"current"|"currentBelow")}><option value="current">Current Layer</option><option value="currentBelow">Current &amp; Below</option><option value="all">All Layers</option></select></label>}
      {tool==="eyedropper"&&<label><input type="checkbox" aria-label="Show Sampling Ring" checked={showRing} onChange={event=>setShowRing(event.target.checked)}/>Show Sampling Ring</label>}
      {(tool==="eyedropper"||tool==="colorSampler")&&<label>Sample Size:<select aria-label="Sample size" value={sampleSize} onChange={event=>setSampleSize(Number(event.target.value))}>{SAMPLE_SIZES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      {tool==="colorSampler"&&<ClearSamplers documentId={document.id}/>}
      {PATH_SELECT_TOOLS.includes(tool)&&<><span className="xd-ps-label">Make:</span><button disabled={busy||!pathTarget} onClick={()=>command("path.toSelection",{name:pathTarget})}>Selection…</button><button disabled={busy||!pathTarget||pathTarget==="layer"||!currentLayer} onClick={()=>command("layer.vectorMask.fromPath",{name:pathTarget})}>Mask</button><button disabled={busy||!pathTarget||pathTarget==="layer"} onClick={()=>attempt(runPhotoCommand("path.info",{name:pathTarget}).then(result=>{const path=(result as {path?:PathData}|undefined)?.path;if(path)return runPhotoCommand("shape.create",shapeCreateParams({kind:"path",path}));}))}>Shape</button><ShapeStyleFields style={shapeStyle} change={patch=>{setShapeStyle(current=>({...current,...patch}));if(pathTarget==="layer"&&state?.activeLayer!=null){const next={...shapeStyle,...patch};command("shape.edit",{layer:state.activeLayer,...shapeStyleParams(next,paintColorValue)});}}}/></>}
      {tool==="zoom"&&<div role="group" aria-label="Zoom mode" className="xd-ps-icon-cluster"><button aria-label="Zoom in mode" title="Zoom in" aria-pressed={!zoomOut} onClick={()=>setZoomOut(false)}><ZoomIn size={16}/></button><button aria-label="Zoom out mode" title="Zoom out" aria-pressed={zoomOut} onClick={()=>setZoomOut(true)}><ZoomOut size={16}/></button></div>}
      {tool==="zoom"&&<label><input type="checkbox" aria-label="Scrubby Zoom" checked={scrubbyZoom} onChange={event=>setScrubbyZoom(event.target.checked)}/>Scrubby Zoom</label>}
      {tool==="rotateView"&&<><label>Rotation Angle:<input key={turn.angle} type="number" aria-label="Rotation Angle" min={-180} max={180} defaultValue={turn.angle} onBlur={event=>turnView({angle:Number(event.target.value)||0})} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/>°</label><button disabled={!turn.angle} onClick={()=>turnView({angle:0})}>Reset View</button></>}
      {(tool==="hand"||tool==="zoom")&&<><button onClick={()=>zoomAt(()=>1)}>100%</button><button onClick={fit}>Fit Screen</button><button onClick={fill}>Fill Screen</button></>}
      {selectionTool&&<>{["select.object","select.quick","select.magicWand"].includes(tool)&&<button disabled={busy} onClick={()=>command("select.subject")}>Select Subject</button>}<button disabled={busy||!hasSelection} onClick={()=>setSelectionDialog("refine")}>Select and Mask…</button></>}
      {tool==="crop"&&<button type="button" aria-label="Straighten crop" title="Draw a line along the horizon to level the crop" aria-pressed={cropStraighten} disabled={busy} onClick={()=>setCropStraighten(value=>!value)}><Ruler size={14}/>Straighten</button>}
      {tool==="crop"&&<MenuButton label="Crop overlay" icon={CROP_GUIDES[0]![2]} iconOnly items={[...CROP_GUIDES.map(([value,label,icon])=>({label,icon,radio:true,checked:cropGuide===value,run:()=>setCropGuide(value)})),"-",...CROP_OVERLAY_SHOWS.map(([value,label])=>({label,radio:true,checked:cropOverlayShow===value,run:()=>setCropOverlayShow(value)})),"-",{label:"Cycle Overlay",run:cycleCropGuide},{label:"Cycle Orientation",disabled:cropGuide!=="triangle"&&cropGuide!=="spiral",run:turnCropGuide}]}/>}
      {tool==="crop"&&<MenuButton label="Crop options" icon={GearIcon} iconOnly items={[{label:"Show Cropped Area",shortcut:"H",checked:cropShowCropped,run:()=>setCropShowCropped(value=>!value)},"-",{label:"Enable Crop Shield",checked:cropShield,run:()=>setCropShield(value=>!value)},{label:"Shield Opacity",disabled:!cropShield,items:[.25,.5,.75,1].map(value=>({label:`${value*100}%`,radio:true,checked:cropShieldOpacity===value,run:()=>setCropShieldOpacity(value)}))}]}/>}
      {tool==="crop"&&<div className="xd-ps-tool-options"><PaintToolOptions tool="crop" values={toolOptions} disabled={busy} change={values=>setPaintOptions(current=>({...current,crop:sanitizePaintOptions("crop",values)}))}/></div>}
      {tool==="crop"&&<CropFillField value={String(toolOptions.fill)} deleteCroppedPixels={toolOptions.deleteCroppedPixels===true} disabled={busy} change={fill=>cropOptions({fill})}/>}
      {selectionBox&&<><button disabled={busy} onClick={commitSelectionTransform}>Apply transform</button><button onClick={()=>setSelectionBox(null)}>Cancel transform</button></>}
      <FreeTransformBar untilShown={untilShown}/>
      {tool==="crop"&&cropBox&&<div role="group" aria-label="Crop actions" className="xd-ps-icon-cluster"><button aria-label="Reset crop" title="Reset the crop box and rotation" disabled={busy} onClick={resetCrop}><RotateCcw size={16}/></button>{!cropUntouched&&<><button aria-label="Cancel crop" title="Cancel the current crop (Esc)" onClick={resetCrop}><Ban size={16}/></button><button aria-label="Apply crop" title="Commit the current crop (Enter)" disabled={busy} onClick={commitCrop}><Check size={16}/></button></>}</div>}
    </div>
    <div className="xd-ps-doctabs" inert={geometryActive}>
      <div className="xd-ps-doctab" role="tab" aria-selected="true" title={`${document.width} × ${document.height} px`}><span>{document.name} @ {Math.round(zoom*100)}% ({docTabDetail(state,currentLayer)})</span><button type="button" aria-label="Close image" title="Close" disabled={busy} onClick={()=>{if(smartTrail.length)attempt(finishSmartContents(true));else usePhotoWorkspace.getState().close();}}><X size={11}/></button></div>
      {!!smartTrail.length&&<div className="xd-photo-contents-actions"><span>{smartTrail.at(-1)!.parent.name} / Contents</span><button disabled={busy} onClick={()=>attempt(finishSmartContents(true))}>Save contents</button><button disabled={busy} onClick={()=>attempt(finishSmartContents(false))}>Discard contents</button></div>}
    </div>
    <div ref={panels.body} className="xd-photo-body xd-editor-body xd-ps-body" data-overlay={panels.overlay} data-tools-wrap={toolsWrap||undefined}>
      {chrome.tools&&<EditorToolRail label="Image tools" groups={toolbar.groups} active={tool} select={setTool} disabled={busy||geometryActive}>
        <MenuButton label="Edit Toolbar" icon={Ellipsis} iconOnly items={[...toolbar.extra.map(entry=>({label:entry.label,icon:entry.icon,run:()=>setTool(entry.id)})),...toolbar.extra.length?["-" as const]:[],{label:"Edit Toolbar…",run:()=>setCustomize("toolbar")}]}/>
        <div className="xd-ps-colors" inert={busy||geometryActive}>
          {!grayscaleTarget&&<button className="xd-ps-color bg" aria-label="Paint background color" title="Set background color" value={background} style={{background}} onClick={()=>setPicker("background")}/>}
          <button className="xd-ps-color fg" aria-label="Paint color" title="Set foreground color" value={paintColor} style={{background:paintColor}} onClick={()=>setPicker("foreground")}/>
          {!grayscaleTarget&&<><button className="xd-ps-color-swap" aria-label="Swap paint colors" title="Switch foreground and background colors (X)" onClick={()=>paletteCommand("tools.swapColors")}><ArrowLeftRight size={9}/></button><button className="xd-ps-color-default" aria-label="Default paint colors" title="Default foreground and background colors (D)" onClick={()=>paletteCommand("tools.defaultColors")}><RotateCcw size={8}/></button></>}
        </div>
        <button className={`xd-editor-icon-button${state?.quickMask?" selected":""}`} aria-label="Quick Mask" aria-pressed={!!state?.quickMask} title="Quick Mask (Q)" disabled={busy||geometryActive} onClick={()=>{setMask(false);command("select.editInQuickMaskMode");}}><SquareDashed size={17}/></button>
        <button className="xd-editor-icon-button" aria-label="Screen Mode" title={`${SCREEN_MODES[screenMode]} (F)`} onClick={()=>chooseScreenMode((screenMode+1)%3)}><Maximize size={17}/></button>
      </EditorToolRail>}
      {/* The Ruler reads out in Info and the Note tool writes into Notes, so those stay open while the tool works. */}
      <div className="xd-ps-canvas" style={pasteboardColor?{"--xd-ps-pasteboard":pasteboardColor} as CSSProperties:undefined} onPointerDownCapture={()=>{if(flyout&&flyout!==(tool==="ruler"?"Info":tool==="note"?"Notes":null))setFlyout(null);}}>
    <div ref={stage} className="xd-photo-stage" tabIndex={0} aria-label="Image canvas" onContextMenu={e=>{if(image.current?.contains(e.target as Node))return;e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,kind:"pasteboard"});}} onScroll={()=>{clearCloneMarker();placeBrushTip();previewStroke();scheduleView();}}><div className="xd-photo-scroll-space" style={cropShifted?{overflow:"clip"}:undefined}><div ref={image} className="xd-photo-image" style={surfaceStyle(frame!.width*zoom,frame!.height*zoom)} data-view-angle={turn.angle||undefined} data-view-flip={turn.flip?"":undefined}>
      <img className="xd-photo-preview-source" src={viewPreview.active?viewPreview.url??undefined:convertFileSrc(document.previewPath)} hidden={viewPreview.active&&!viewPreview.url} alt="" draggable={false} onLoad={event=>{const {id,version,width,height}=document;void surface.show(event.currentTarget).then(shown=>{if(!shown)return;flushSync(()=>setShownSize({id,version,width,height}));imageShown();});}}/>
      <canvas ref={surface.attach} className="xd-photo-preview" role="img" aria-label={viewPreview.active?`${document.name} · ${editTarget}`:document.name} hidden={viewPreview.active&&!viewPreview.url}/>
      <PhotoTiles key={`${document.id}/${displayState?.viewKey}`} document={document} projectId={projectId} zoom={zoom} hasSelection={!!displayState?.hasSelection} selectionDisplay={selectionDisplay} edges={selectionEdgesVisible(aids)} viewKey={displayState?.viewKey} stage={stage} image={image} status={setPreviewStatus} surface={tileSurface}/>
      <CanvasDraftPreview document={document} draft={fillDraft??layerPropsDraft(layerDraft)} canvas={image.current}/>
      {tool==="magneticLasso"&&!geometryActive&&<MagneticLassoOverlay key={`${projectId}/${document.id}/${document.version}/${displayState?.viewKey}`} document={document} projectId={projectId} viewKey={displayState?.viewKey} options={toolOptions} mode={selectionMode} zoom={zoom} ready={stateVersion===document.version&&(!viewPreview.active||!!viewPreview.url)} changeWidth={width=>setPaintOptions(current=>({...current,magneticLasso:{...current.magneticLasso,width}}))}/> }
      {viewPreview.active&&!viewPreview.url&&<div className="xd-photo-view-loading" role="status">{viewPreview.error?<button onClick={viewPreview.retry}>Retry image view</button>:"Rendering image view…"}</div>}
      {pixelGridVisible(aids,zoom)&&<div className="xd-photo-pixel-grid" style={{backgroundSize:`${zoom}px ${zoom}px`}}/>}
      {layerEdgesVisible(aids)&&<svg className="xd-photo-layer-edges" viewBox={`0 0 ${document.width} ${document.height}`} aria-hidden="true">{selectedBoxes().map((box,index)=><rect key={index} x={box[0]} y={box[1]} width={box[2]} height={box[3]}/>)}</svg>}
      <canvas ref={overlay} width={document.previewWidth} height={document.previewHeight} tabIndex={geometryActive?-1:0} inert={geometryActive} aria-label="Paint and select image" className={spacePan||tool==="hand"||tool==="rotateView"?"xd-photo-pan":tool==="zoom"?(altHeld!==zoomOut?"xd-photo-zoom-out":"xd-photo-zoom"):springReady||springMove.current?"xd-photo-arrow":showTip&&(tipSize>=6||resizeReadout)?"xd-photo-brush":precise?"xd-photo-precise":PEN_DRAFT_TOOLS.includes(tool)?(!polygonDraft.current?"xd-photo-pen-new":draftClosing?"xd-photo-pen-close":"xd-photo-pen"):tool==="polygonLasso"&&polygonDraft.current&&draftClosing?"xd-photo-polygon-lasso-close":TOOL_CURSORS[tool]} onContextMenu={openCanvasMenu} onPointerDown={pointerDown} onPointerLeave={()=>{clearCloneMarker();tipPointer.current=null;placeBrushTip();useInfoCursor.getState().set(null);}} onPointerMove={pointerMove} onPointerUp={finish} onDoubleClick={()=>{if(polygonDraft.current)finishPolygon();}} onPointerCancel={event=>{if(scrub.current&&scrub.current.pointerId===event.pointerId)scrub.current=null;if(sampleDrag.current&&sampleDrag.current.pointerId===event.pointerId){sampleDrag.current=null;setRing(null);}if(heldStroke.current&&heldStroke.current.pointerId===event.pointerId)heldStroke.current=null;if(brushResize.current?.pointerId===event.pointerId)endBrushResize();if(panDrag.current?.pointerId===event.pointerId)panDrag.current=null;if(polygonDraft.current||strokePointer.current===event.pointerId||patchDrag.current?.pointerId===(event.pointerId??1))resetStroke();}} onLostPointerCapture={event=>{if(heldStroke.current&&heldStroke.current.pointerId===event.pointerId&&!heldStroke.current.up)heldStroke.current=null;if(brushResize.current?.pointerId===event.pointerId)endBrushResize();if(panDrag.current?.pointerId===event.pointerId)panDrag.current=null;if(strokePointer.current===event.pointerId||patchDrag.current?.pointerId===(event.pointerId??1))resetStroke();}}/>
      {cloneSources&&<svg ref={cloneOverlay} aria-label="Clone source overlay" aria-hidden="true" viewBox={`0 0 ${document.width} ${document.height}`} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",display:"none",overflow:"hidden",opacity:cloneSources.overlay.opacity/100,mixBlendMode:cloneSources.overlay.blend as CSSProperties["mixBlendMode"]}}><defs><clipPath id={cloneOverlayClip}><circle/></clipPath></defs><g clipPath={cloneSources.overlay.clipped?`url(#${cloneOverlayClip})`:undefined}><image href={viewPreview.active?viewPreview.url??undefined:convertFileSrc(document.previewPath)} width={document.width} height={document.height} preserveAspectRatio="none" style={{filter:cloneSources.overlay.invert?"invert(1)":undefined}}/></g></svg>}
      <svg ref={cloneMarker} aria-label="Clone source marker" aria-hidden="true" viewBox={`0 0 ${document.width} ${document.height}`} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",display:"none",overflow:"hidden"}}><path fill="none" stroke="rgba(0,0,0,0.6274509803921569)" strokeWidth="3" vectorEffect="non-scaling-stroke"/><path fill="none" stroke="white" strokeWidth="1" vectorEffect="non-scaling-stroke"/></svg>
      {ring&&<SamplingRing {...ring}/>}
      {showTip&&<div ref={brushTip} className={resizeReadout?"xd-photo-brush-tip resizing":"xd-photo-brush-tip"} aria-hidden="true" style={{width:`${tipSize}px`,height:`${tipSize}px`,...resizeReadout&&{"--hardness":`${tool==="select.quick"?100:hardness*100}%`}}}/>}
      {resizeReadout&&<div className="xd-photo-brush-readout" role="status" style={{left:resizeReadout.x+16,top:resizeReadout.y+18}}><span>Diameter:</span><span>{tool==="select.quick"?Number(toolOptions.size):size} px</span>{tool!=="select.quick"&&<><span>Hardness:</span><span>{Math.round(hardness*100)}%</span></>}</div>}
      {currentLayer&&(state?.selectedLayers?.length??1)<=1&&<MoveDragPreview key={`move/${document.id}/${currentLayer.id}`} document={document} layer={currentLayer.id} bind={movePreview} redraw={()=>redrawStroke.current?.()}/>}
      {(tool==="move"&&transformControls||freeTransforming)&&!geometryActive&&shownLayer&&<ImageTransformOverlay key={`${document.id}/${shownLayer.id}`} document={document} layer={shownLayer} zoom={zoom} untilShown={untilShown} autoSelect={tool==="move"&&autoSelect}/>}
      {tool==="crop"&&cropBox&&!cropStraighten&&!geometryActive&&<CropOverlay shade={cropShield} shadeOpacity={cropShieldOpacity} hideOutside={!cropShowCropped} width={frame!.width} height={frame!.height} zoom={zoom} box={cropBox} ratio={cropRatio} change={box=>setCropBox(snapCrop(box,cropBox))} angle={cropAngle} rotate={setCropAngle} guide={cropOverlayShow==="never"?"none":cropGuide} autoGuide={cropOverlayShow==="auto"} orientation={cropOrientation} menu={at=>{if(!busy)setContextMenu({...at,kind:"crop"});}} movable={!cropUntouched} pan={panCrop}/>}
      {editPath&&!PATH_SELECT_TOOLS.includes(tool)&&!geometryActive&&targetPathVisible(aids)&&<TargetPathOverlay width={document.width} height={document.height} zoom={zoom} path={editPath.path}/>}
      {(ANALYSIS_TOOLS.includes(tool)||!!displayState?.analysis||flyout==="Info")&&!geometryActive&&<AnalysisOverlay tool={tool} documentId={document.id} samplers={tool==="colorSampler"||flyout==="Info"} width={document.width} height={document.height} zoom={zoom} analysis={displayState?.analysis} active={ANALYSIS_TOOLS.includes(tool)&&!spacePan&&!busy} extras={aids.extras} openNotes={()=>openPanel("Notes")}/>}
      {editPath&&PATH_SELECT_TOOLS.includes(tool)&&!geometryActive&&<PathEditOverlay width={document.width} height={document.height} zoom={zoom} path={editPath.path} direct={tool==="path.direct"}
        commit={path=>editPath.layer!==undefined?command("shape.edit",{layer:editPath.layer,path}):command("path.set",{name:editPath.name,path})}
        move={(dx,dy)=>editPath.layer!==undefined?command("shape.edit",{layer:editPath.layer,move:[dx,dy]}):command("path.transform",{name:editPath.name,translateX:dx,translateY:dy})}/>}
      {canvasText&&<CanvasTextEditor key={canvasText.layer?`layer-${canvasText.layer.id}`:canvasText.point.join(",")} target={canvasText} zoom={zoom} resolution={state?.resolution??72} font={textFont} size={textSize} color={typeColor??paintColor} create={{...typeStyleParams(textStyle),...(textAlign!=="left"?{align:textAlign}:{})}} after={{antialias:textAntialias,orientation:textOrientation}} close={work=>{const closing=canvasText;if(!work){setCanvasText(null);return;}void untilShown(work).then(()=>setCanvasText(current=>current===closing?null:current));}}/>}
      {textWarp&&textLayer&&document&&<PhotoTextGeometryDialog key={`${textLayer.id}/warp`} kind="warp" document={document} layer={textLayer} close={()=>setTextWarp(false)}/>}
      {selectionBox&&!geometryActive&&<CropOverlay label="Selection" shade={false} width={frame!.width} height={frame!.height} zoom={zoom} box={selectionBox.box} change={box=>setSelectionBox(current=>current&&{...current,box})}/>}</div></div></div>
    <ViewAids stage={stage} image={image} docId={document.id} width={document.width} height={document.height} zoom={zoom} resolution={state?.resolution} moveTool={tool==="move"} onRulerMenu={at=>setContextMenu({...at,kind:"ruler"})} onRulerDoubleClick={()=>setPreferencesSection("units")}/>
      {tool==="crop"&&cropBox&&!geometryActive&&<ContextualTaskBar place={taskBar} change={placeTaskBar} busy={busy} anchor={()=>image.current?.querySelector('svg[aria-label="Crop box"] .xd-photo-crop-area')} trailing={!cropUntouched&&<><button onClick={resetCrop}>Cancel</button><button onClick={commitCrop}>Done</button></>}>
        <CropRatioSelect values={toolOptions} ratios={CROP_RATIOS} original={[document.width,document.height]} resolution={imagePpi} disabled={busy} apply={cropToRatio} applySize={cropToSize} clear={()=>cropOptions({style:"normal"})}/>
        <button aria-label="Straighten crop" title="Draw a line along the horizon to level the crop" aria-pressed={cropStraighten} onClick={()=>setCropStraighten(value=>!value)}><Ruler size={14}/></button>
      </ContextualTaskBar>}
      {!geometryActive&&!cropBox&&!selectionBox&&!canvasText&&<ContextualTaskBar place={taskBar} change={placeTaskBar} busy={busy}>
        {currentState?.hasSelection?<><button onClick={()=>command("select.inverse")}>Invert selection</button><button disabled={!currentLayer} onClick={()=>command("layer.layerMask.revealSelection")}>Create mask</button><button onClick={openFillDialog}>Fill selection</button><button disabled={!currentState.selectionBounds} onClick={startSelectionTransform}>Transform selection</button><button onClick={()=>command("select.deselect")}>Deselect</button></>:
          <><button onClick={()=>command("select.subject")}>Select subject</button><button disabled={!currentLayer} onClick={removeBackground}>Remove background</button><button onClick={()=>openPanel("Adjustments")}>Adjust colors</button></>}
      </ContextualTaskBar>}
      </div>
      <aside id={panels.rightId} className="xd-ps-dock xd-editor-panel xd-editor-panel-right" aria-label="Panels" hidden={!panels.left&&!panels.right} style={{width:panels.rightWidth+STRIP_WIDTH}}>
        {flyout&&<div className="xd-ps-flyout" role="region" aria-label={`${flyout} panel`}><header><strong>{flyout}</strong><span className="xd-ps-spacer"/><MenuButton label={`${flyout} panel options`} icon={Menu} iconOnly align="end" className="xd-ps-panel-menu" items={panelMenu(flyout)}/><button type="button" className="xd-editor-icon-button" aria-label="Collapse panel" title="Collapse to icon" onClick={()=>setFlyout(null)}><ChevronsRight size={13}/></button></header><div className="xd-ps-flyout-body">
          {flyout==="History"&&currentState&&<PhotoHistory state={currentState} disabled={busy} contents={!!smartTrail.length} name={document?.name} preview={document?convertFileSrc(document.previewPath):undefined} source={historySource} chooseSource={setHistorySource} newSnapshot={()=>setImageDialog("snapshot")}/>}
          {flyout==="Navigator"&&<div className="xd-ps-pad"><PhotoNavigator src={viewPreview.active?viewPreview.url??undefined:convertFileSrc(document.previewPath)} width={document.width} height={document.height} view={navigatorView} zoom={zoom} center={centerView} zoomTo={value=>zoomAt(()=>value)}/></div>}
          {flyout==="Info"&&<div className="xd-ps-pad"><InfoPanel width={document.width} height={document.height} selectionBounds={currentState?.selectionBounds} ruler={tool==="ruler"?displayState?.analysis?.ruler??null:undefined} documentId={document.id} refresh={`${document.version}/${displayState?.viewKey??""}/${sampleSize}`} sample={(x,y)=>projectId?sampleImageColor({projectId,photoId:document.id,version:document.version,viewKey:displayState?.viewKey??null,...sampleBox(x,y)}):Promise.resolve(null)}/></div>}
          {flyout==="Notes"&&<NotesPanel notes={displayState?.analysis?.notes??[]}/>}
          {flyout==="Brushes"&&state&&<div className="xd-ps-pad"><BrushPanel state={state} changed={changedBrush}/></div>}
          {flyout==="Brush Settings"&&state&&<div className="xd-ps-pad"><BrushSettingsPanel state={state} changed={changedBrush}/></div>}
          {flyout==="Clone Source"&&<div className="xd-ps-pad">{cloneSourceControls}</div>}
          {flyout==="Glyphs"&&<div className="xd-ps-pad"><GlyphsPanel family={textLayer?.text?.font??textFont} style={textStyle} insert={textLayer?insertGlyph:null}/></div>}
          {flyout==="Styles"&&(currentLayer?<div className="xd-ps-pad"><LayerEffects layer={currentLayer} state={state}/>{state&&<StylePresetsPanel state={state} layer={currentLayer}/>}</div>:<div className="xd-editor-empty"><strong>No layer selected</strong><p>Select a layer to add layer styles.</p></div>)}
          {flyout==="Shapes"&&state&&<div className="xd-ps-pad"><ShapePresetsPanel state={state} foreground={paintColorValue}/></div>}
          {flyout==="Histogram"&&<div className="xd-ps-pad"><HistogramPanel document={document} mode={currentState?.mode??"RGB"} activeLayer={currentState?.activeLayer??null}/></div>}
          {flyout==="Character"&&<div className="xd-ps-pad"><CharacterPanel layer={textLayer}/></div>}
          {flyout==="Paragraph"&&<div className="xd-ps-pad"><ParagraphPanel layer={textLayer}/></div>}
          {flyout==="Character Styles"&&displayState?.panels&&<TypeStylesPanel kind="character" styles={displayState.panels.textStyles}/>}
          {flyout==="Paragraph Styles"&&displayState?.panels&&<TypeStylesPanel kind="paragraph" styles={displayState.panels.textStyles}/>}
          {flyout==="Layer Comps"&&displayState?.panels&&<LayerCompsPanel comps={displayState.panels.layerComps}/>}
          {flyout==="Actions"&&<ActionsPanel/>}
          {flyout==="Measurement Log"&&displayState?.panels&&<MeasurementLogPanel log={displayState.panels.measurementLog}/>}
          {flyout==="Tool Presets"&&state&&<div className="xd-ps-pad"><ToolPresetsPanel state={state} tool={tool} options={{toolOptions:{gradientStyle,gradientReverse,liveGradient,selectionMode,paintOptions:sanitizePaintOptions(tool,toolOptions)},foreground:grayscaleTarget?paintColorRGBA(channelColor):nativeForeground??paintColorRGBA(color),background:nativeBackground??paintColorRGBA(background)}} choose={chooseToolPreset}/></div>}
        </div></div>}
        <nav className="xd-ps-strip" aria-label="Collapsed panels">{STRIP_PANELS.map(({name,icon:Icon})=><button key={name} type="button" aria-label={name} title={name} aria-pressed={flyout===name} onClick={()=>setFlyout(current=>current===name?null:name)}><Icon size={16}/></button>)}</nav>
        <div className="xd-ps-groups">
          <section className="xd-ps-group xd-ps-group-color" aria-label="Color panels" hidden={!panels.left} data-collapsed={collapsed.upper}>
            <PanelTabs label="Color panels" tabs={UPPER_PANELS} active={upperTab} collapsed={collapsed.upper} select={openPanel} toggle={()=>setCollapsed(c=>({...c,upper:!c.upper}))} menu={panelMenu(upperTab)}/>
            {!collapsed.upper&&<div className="xd-editor-panel-scroll xd-ps-pad">{upperTab==="Color"?<ColorPanel foreground={paintColor} background={background} disabled={busy} mode={colorMode} change={chooseColor} addToSwatches={addImageSwatch} swap={()=>{if(grayscaleTarget)setChannelColor(value=>value==="#000000"?"#ffffff":"#000000");else paletteCommand("tools.swapColors");}} reset={()=>{if(grayscaleTarget)setChannelColor("#000000");else paletteCommand("tools.defaultColors");}} openPicker={setPicker}/>:upperTab==="Swatches"?<PhotoSwatches foreground={paintColor} disabled={busy} choose={chooseColor}/>:upperTab==="Gradients"?(state&&<GradientPresetsPanel state={state} foreground={paintColor} background={grayscaleTarget?"#ffffff":background} foregroundValue={paintColorValue} backgroundValue={backgroundValue}/>):(state&&<PatternPresetsPanel state={state}/>)}</div>}
          </section>
          <section className="xd-ps-group xd-ps-group-properties xd-photo-properties" aria-label="Image properties" hidden={!panels.left} data-collapsed={middleCollapsed}>
            <PanelTabs label="Properties panels" tabs={MIDDLE_PANELS} active={middleTab} collapsed={middleCollapsed} inert={geometryActive} menu={panelMenu(middleTab)} select={openPanel} toggle={()=>setCollapsed(c=>({...c,middle:!c.middle}))}/>
            {!middleCollapsed&&<div ref={propertiesScroll} className="xd-editor-panel-scroll">{perspectiveCrop&&image.current?<PerspectiveCropDialog document={document} box={perspectiveCrop} canvas={{element:image.current,zoom}} options={{size:perspectiveSize,ppi:cropResolution(perspectiveOptions,imagePpi),showGrid:perspectiveOptions.showGrid!==false}} close={()=>setPerspectiveCrop(null)}/>:geometryActive&&image.current?<GeometryDialog kind={specialDialog as GeometryKind} document={document} layer={currentLayer!} canvas={{element:image.current,zoom}} close={()=>setSpecialDialog(null)}/>:<>
              {toolPreferencesNotice&&<p role="status" className="xd-photo-section-help">{toolPreferencesNotice}</p>}
              {middleTab==="Properties"&&<>{["paint.cloneStamp","paint.healingBrush"].includes(tool)&&cloneSources&&<InspectorSection title="Clone Source" defaultOpen>{cloneSourceControls}</InspectorSection>}
              {(currentLayer?<>
            {currentLayer.adjustmentKind?<AdjustmentProperties layer={currentLayer} document={document} canvas={image.current} untilShown={untilShown}/>:<>
            <TransformSection layer={currentLayer} size={[document.width,document.height]} resolution={state?.resolution??72} disabled={busy}/><AlignSection layers={state?.selectedLayers?.length??1} hasSelection={!!state?.hasSelection} disabled={busy}/>
            <InspectorSection title="Quick Actions" defaultOpen><div className="xd-photo-action-list"><button disabled={busy} onClick={()=>startFreeTransform()}>Transform</button>{([["warp","Warp"],["puppet","Puppet Warp"],["perspective","Perspective Warp"]] as const).map(([kind,label])=><button key={kind} disabled={busy} onClick={()=>openGeometry(kind)}>{label}</button>)}<button disabled={busy} onClick={()=>command("layer.arrange.bringForward")}>Forward</button><button disabled={busy} onClick={()=>command("layer.arrange.sendBackward")}>Backward</button><button disabled={busy} onClick={()=>command(currentLayer.clipped?"layer.releaseClippingMask":"layer.createClippingMask")}>{currentLayer.clipped?"Unclip":"Clip to below"}</button><button disabled={busy} onClick={()=>command("layer.new.group")}>New group</button>{currentLayer.smartObject?<button disabled={busy} onClick={()=>attempt(openSmartContents(currentLayer.id))}>Edit contents</button>:<button disabled={busy} onClick={()=>command("layer.smartObjects.convertToSmartObject")}>Smart object</button>}{currentLayer.text&&<button disabled={busy} onClick={()=>{setTextPoint(undefined);setImageDialog("text");}}>Edit text</button>}</div>
            </InspectorSection></>}
            {currentLayer.gradientFill&&<InspectorSection title="Gradient fill" defaultOpen><button disabled={busy} onClick={()=>setImageDialog("gradient")}>Edit gradient fill</button><p className="xd-photo-section-help">Gradient, style, angle, scale and Method. Drag the image to move the gradient.</p></InspectorSection>}
            {currentLayer.text&&<InspectorSection title="Typography" defaultOpen><ImageTypographyPanel key={currentLayer.id} layer={currentLayer} document={document}/></InspectorSection>}
            {currentLayer.smartObject&&<InspectorSection title="Smart object & filters" defaultOpen><SmartFilters layer={currentLayer} document={document} canvas={image.current}/></InspectorSection>}
            <MaskSection layer={currentLayer} view={state?.layerMaskView?.layer===currentLayer.id?state.layerMaskView.mode:"off"} hasSelection={!!state?.hasSelection} disabled={busy} refine={()=>setSelectionDialog("refine")} colorRange={()=>setSelectionDialog("color")}/>
          </>:<DocumentProperties state={state} disabled={busy} display={selectionDisplay} setDisplay={setSelectionDisplay} imageSize={()=>setImageDialog("size")} addText={()=>{setTextPoint([100,100]);setImageDialog("text");}} profileInfo={()=>setProfileDialog("info")} trim={()=>setImageDialog("trim")}/>)}</>}
              {middleTab==="Adjustments"&&<AdjustmentsPanel disabled={busy} add={newAdjustmentLayer}/>}
            </>}</div>}
          </section>
          <section className="xd-ps-group xd-ps-group-layers xd-photo-layers" aria-label="Image layers" hidden={!panels.right} inert={geometryActive} data-collapsed={collapsed.layers}>
            <PanelTabs label="Layer panels" tabs={LAYER_PANELS} active={layersTab} collapsed={collapsed.layers} menu={panelMenu(layersTab)} select={openPanel} toggle={()=>setCollapsed(c=>({...c,layers:!c.layers}))}/>
            {!collapsed.layers&&(layersTab==="Channels"?(state&&<PhotoChannels state={state} targetChanged={()=>setMask(false)} options={channelOptions} source={projectId&&document?{projectId,photoId:document.id,version:document.version}:null}/>):layersTab==="Paths"?(currentState&&<PhotoPaths state={currentState} disabled={busy} active={activePath} select={setActivePath} version={document?.version}/>):<>
              <LayerFilterRow filter={layerFilter} change={setLayerFilter}/>
              <div className="xd-photo-layer-controls"><select aria-label="Layer blend mode" disabled={busy||!currentLayer} value={currentLayer?.blend??"Normal"} onChange={event=>command("layer.setProps",{blend:event.target.value})}>{blendOptions(currentLayer?.children?["Pass Through",...BLEND_MODES]:BLEND_MODES)}</select>{layerSlider("opacity","Opacity:")}</div>
              <div className="xd-ps-lock-row"><span>Lock:</span>{([["transparency","Lock transparent pixels",Grid2x2],["pixels","Lock image pixels",Brush],["position","Lock position",Move],["all","Lock all attributes",Lock]] as const).map(([key,label,Icon])=><button key={key} type="button" className="xd-ps-lock" aria-label={label} title={label} aria-pressed={!!currentLayer?.locks?.[key]} disabled={busy||!currentLayer} onClick={()=>command("layer.lockLayers",{[key]:!currentLayer?.locks?.[key]})}><Icon size={12}/></button>)}<span className="xd-ps-spacer"/>{layerSlider("fill","Fill:")}</div>
              <div className="xd-photo-layer-list" ref={layerList}>{state&&<LayerRows layers={filterLayerTree(state.layers,layerFilter)} active={state.activeLayer} busy={busy} editMask={editMask} editingMask={mask} selectPixels={()=>setMask(false)} menu={openLayerMenu} thumbnails={thumbnails} masks={maskThumbnails} openStyle={(layer,pane)=>setLayerStyle({layer:layer.id,pane})} openProperties={()=>openPanel("Properties")} openFill={()=>setImageDialog("gradient")} folds={[folds,fold]}/>}</div>
              <div className="xd-photo-layer-actions xd-ps-layer-actions"><button aria-label="Link layers" title="Link layers" disabled={busy||!currentLayer} onClick={()=>command("layer.linkLayers")}><Link2 size={14}/></button><button aria-label="Add a layer style" title="Add a layer style" aria-haspopup="menu" disabled={busy||!styleable} onClick={event=>{const r=event.currentTarget.getBoundingClientRect();setContextMenu({x:r.left,y:r.top,kind:"fx"});}}><span className="xd-ps-fx">fx</span></button><button aria-label="Add a mask" title="Add a mask" disabled={busy||!currentLayer} onClick={()=>command("layer.layerMask.revealAll")}><SquareDashed size={14}/></button><button aria-label="Create new fill or adjustment layer" title="Create new fill or adjustment layer" aria-haspopup="menu" disabled={busy} onClick={event=>{const r=event.currentTarget.getBoundingClientRect();setContextMenu({x:r.left,y:r.top,kind:"adjustment"});}}><Contrast size={14}/></button><button aria-label="Create a new group" title="Create a new group" disabled={busy||!currentLayer} onClick={()=>command("layer.groupLayers")}><Folder size={14}/></button><button aria-label="Create a new layer" title="Create a new layer" disabled={busy} onClick={event=>{if(event.altKey)newLayer();else void command("layer.new.layer");}}><Plus size={14}/></button><button aria-label="Delete layer" title="Delete layer" disabled={busy||!currentLayer} onClick={()=>command("layer.delete")}><Trash2 size={14}/></button></div>
            </>)}
          </section>
        </div>
        <PanelResize side="right" panels={panels}/>
      </aside>
    </div>
    <footer className="xd-photo-footer xd-ps-status"><span role="status" className="xd-ps-status-text">{strokeEnd.current?previewStatus??(polygonDraft.current?PEN_DRAFT_TOOLS.includes(tool)?`${polygonVertices} anchor points · Click the first point to close · Enter or double-click finishes · Backspace removes · Esc cancels`:`${polygonVertices} polygon vertices · Enter or double-click finishes · Backspace removes · Esc cancels`:selectionTool?"Selecting… · Esc cancels the gesture":tool==="crop"||tool==="perspectiveCrop"?"Defining crop… · Esc cancels the gesture":tool==="straighten"?"Drawing reference line… · Esc cancels the gesture":SHAPE_TOOLS.includes(tool)?"Drawing shape… · Esc cancels the gesture":tool==="pen.freeform"?"Drawing path… · Esc cancels the gesture":"Painting… · Esc cancels the gesture"):busy?"Applying image edit…":error??viewPreview.error??previewStatus??(warnings.length?warnings.join("; "):editTarget!=="Layer pixels"?`Editing ${editTarget}`:toolHint||"Edits update every linked placement")}</span>{polygonDraft.current&&<><button aria-label={PEN_DRAFT_TOOLS.includes(tool)?"Finish path":"Finish polygon selection"} onClick={finishPolygon}>{PEN_DRAFT_TOOLS.includes(tool)?"Finish path":"Finish selection"}</button><button aria-label={PEN_DRAFT_TOOLS.includes(tool)?"Cancel path":"Cancel polygon selection"} onClick={()=>resetStroke()}>Cancel</button></>}<button disabled={busy} onClick={fit}>Fit</button><button disabled={busy} onClick={()=>zoomAt(()=>1)}>100%</button><button disabled={busy} title="Zoom out" onClick={()=>zoomAt(z=>z/1.25)}><ZoomOut size={14}/></button><span>{Math.round(zoom*100)}%</span><button disabled={busy} title="Zoom in" onClick={()=>zoomAt(z=>z*1.25)}><ZoomIn size={14}/></button><span className="xd-ps-doc-info">{document.width} px × {document.height} px ({state?.resolution??72} ppi)</span></footer>
    {specialDialog==="develop"&&currentLayer&&<DevelopDialog document={document} layer={currentLayer} close={()=>setSpecialDialog(null)}/>}
    {layerStyle&&<LayerStyleDialog key={layerStyle.layer} layerId={layerStyle.layer} initial={layerStyle.pane} onClose={()=>setLayerStyle(null)} document={document} canvas={image.current} untilShown={untilShown}/>}
    {contextMenu&&<ContextMenu x={contextMenu.x} y={contextMenu.y} label={contextMenu.kind==="picker"?"Layers":contextMenu.kind==="selection"?"Selection":contextMenu.kind==="path"?"Path":contextMenu.kind==="crop"?"Crop":contextMenu.kind==="fx"?"Layer Style":contextMenu.kind==="adjustment"?"New Fill or Adjustment Layer":"Layer"} close={()=>setContextMenu(null)} items={contextItems(contextMenu)}/>}
    {commandsOpen&&<PhotoCommandBrowser close={()=>setCommandsOpen(false)}/>}
    {placeDialog&&<ImagePlaceDialog key={`${document.id}/${placeDialog}`} linked={placeDialog==="linked"} close={()=>setPlaceDialog(null)}/>}
    {state&&channelDialog&&<ChannelOptionsDialog key={`${channelDialog.channel}/${channelDialog.spot}`} state={state} channel={channelDialog.channel} spot={channelDialog.spot} close={()=>setChannelDialog(null)}/>}
    {state&&mergeDialog&&<ChannelMergeDialog document={document} close={()=>setMergeDialog(false)}/>}
    {selectionDialog==="color"?<ColorRangeDialog key={document.id} document={document} canvas={image.current} close={()=>setSelectionDialog(null)}/>:selectionDialog&&<SelectionDialog key={`${document.id}/${selectionDialog}`} kind={selectionDialog} document={document} close={()=>setSelectionDialog(null)}/>}
    {colorSettingsOpen&&<ColorSettingsDialog close={()=>setColorSettingsOpen(false)}/>}
    {(customize==="shortcuts"||customize==="menus")&&<ShortcutsMenusDialog tab={customize} menus={baseMenus} close={()=>setCustomize(null)}/>}
    {customize==="toolbar"&&<ToolbarDialog groups={IMAGE_TOOL_GROUPS} close={()=>setCustomize(null)}/>}
    {preferencesSection&&<PreferencesDialog section={preferencesSection} close={()=>setPreferencesSection(null)}/>}
    {profileDialog&&<ColorProfileDialog key={`${document.id}/${profileDialog}`} kind={profileDialog} document={document} canvas={image.current} close={()=>setProfileDialog(null)}/>}
    {state&&saveSelection&&<SaveSelectionDialog document={document.name} close={()=>setSaveSelection(false)}/>}
    {state&&compositeDialog&&<ChannelCompositeDialog kind={compositeDialog} document={document} mask={mask} canvas={image.current} close={()=>setCompositeDialog(null)}/>}
    {dialog&&<PhotoActionDialog document={document} canvas={image.current} key={`${dialog.action.id}/${dialog.layer?.id??"new"}`} action={dialog.action} adjustment={dialog.adjustment} layer={dialog.layer} onClose={()=>setDialog(null)}/>}
    {state&&(imageDialog==="size"||imageDialog==="canvas")&&<ImageSizeDialog state={state} document={document} canvas={imageDialog==="canvas"} close={()=>setImageDialog(null)}/>}
    {state&&imageDialog==="trim"&&<ImageTrimDialog state={state} close={()=>setImageDialog(null)}/>}
    {state&&imageDialog==="duplicate"&&<DuplicateImageDialog name={state.name} layers={state.layers.length} close={()=>setImageDialog(null)}/>}
    {newLayerDialog&&<NewLayerDialog {...newLayerDialog} close={()=>setNewLayerDialog(null)}/>}
    <AnalysisDialogs analysis={displayState?.analysis}/>
    <LayerCompDialogs comps={displayState?.panels?.layerComps}/><ActionsDialogs/><DataPointsDialog log={displayState?.panels?.measurementLog}/><TypeStyleDialogs styles={displayState?.panels?.textStyles}/>
    {duplicateDialog&&<DuplicateLayerDialog {...duplicateDialog} close={()=>setDuplicateDialog(null)}/>}
    {state&&imageDialog==="duotone"&&<DuotoneDialog close={()=>setImageDialog(null)}/>}
    {state&&editDialog?.startsWith("edit.purge.")&&<PurgeDialog command={editDialog as PurgeCommand} close={()=>setEditDialog(null)}/>}
    {state&&(editDialog==="brushes"||editDialog==="patterns"||editDialog==="customShapes")&&<PresetNameDialog kind={editDialog} name={editDialog==="customShapes"?nextShapeName():document.name.replace(/\.[^.]+$/,"")||"Untitled"}
      apply={name=>runPhotoCommand(DEFINE_COMMANDS[editDialog],editDialog==="customShapes"&&currentPath?{name,path:currentPath}:{name})} close={()=>setEditDialog(null)}/>}
    {state&&editDialog==="findReplace"&&<FindReplaceTextDialog close={()=>setEditDialog(null)}/>}
    {state&&editDialog==="spelling"&&<CheckSpellingDialog close={()=>setEditDialog(null)}/>}
    {state&&editDialog==="presets"&&<PresetManagerDialog close={()=>setEditDialog(null)}/>}
    {state&&editDialog==="autoAlign"&&<AutoAlignDialog close={()=>setEditDialog(null)}/>}
    {state&&editDialog==="autoBlend"&&<AutoBlendDialog close={()=>setEditDialog(null)}/>}
    {state&&imageDialog==="colorTable"&&<ColorTableDialog close={()=>setImageDialog(null)}/>}
    {state&&imageDialog==="snapshot"&&<NewSnapshotDialog next={state.historySnapshotName??"Snapshot 1"} close={()=>setImageDialog(null)}/>}
    {imageDialog==="text"&&<ImageTextDialog layer={textPoint?undefined:currentLayer?.text?currentLayer:undefined} point={textPoint} close={()=>{setImageDialog(null);setTextPoint(undefined);}}/>}
    {(imageDialog==="gradient"||imageDialog==="newGradient")&&currentLayer?.gradientFill&&<GradientFillDialog document={document} layer={currentLayer} canvas={image.current} close={()=>setImageDialog(null)} cancel={imageDialog==="newGradient"?()=>{setImageDialog(null);const base=newFillBase.current;if(base===undefined)undo();else void command("history.select",{index:base,discardRedo:true});}:undefined}/>}
    {commandDialog&&<ImageCommandDialog key={commandDialog.command.id} document={document} canvas={image.current} command={commandDialog.command} initial={commandDialog.initial} close={()=>setCommandDialog(null)}/>}
    {exportOpen&&<ImageExportDialog key={exportOpen} name={document.name} copy={exportOpen==="copy"} choose={exportTo} close={()=>setExportOpen(false)}/>}
    {state&&fileDialog==="info"&&<FileInfoDialog close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="fitImage"&&<FitImageDialog width={state.width} height={state.height} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="conditionalMode"&&<ConditionalModeDialog mode={state.mode} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="colorLookup"&&<ColorLookupDialog name={document.name} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="paths"&&<PathsToIllustratorDialog name={document.name} paths={state.paths??{saved:[],work:false}} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="layersToFiles"&&<LayersToFilesDialog name={document.name} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="photomerge"&&<PhotomergeDialog current={document.name} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="hdr"&&<MergeToHdrDialog current={document.name} close={()=>setFileDialog(null)}/>}
    {state&&fileDialog==="artboardsPdf"&&<ArtboardsToPdfDialog name={document.name} selected={artboards.filter(board=>(state.selectedLayers??[state.activeLayer]).includes(board.id)).map(board=>board.id)} close={()=>setFileDialog(null)}/>}
    {picker&&<ColorPickerDialog addToSwatches={addImageSwatch} title={picker==="fillLayer"?"Color Picker (Solid Color)":picker==="pasteboard"?"Color Picker (Custom Canvas Color)":`Color Picker (${picker==="foreground"?"Foreground":"Background"} Color)`} color={picker==="background"?background:picker==="foreground"?paintColor:picker==="pasteboard"?pasteboard.custom??pasteboardColor??"#535353":color} preview={picker==="fillLayer"?hex=>setFillDraft(solidFill(hex)):undefined} close={()=>{setPicker(null);setFillDraft(null);}} choose={hex=>{if(picker==="fillLayer"){setFillDraft(solidFill(hex,true));void untilShown(withLayerOptions(()=>runPhotoCommand("layer.newFillLayer.solidColor",{color:hex}),solidFillOptions.current??{},"New Color Fill Layer")).then(()=>setFillDraft(previous=>previous?.committing?null:previous));}else if(picker==="pasteboard")choosePasteboard({color:"custom",custom:hex});else chooseColor(picker,hex);setPicker(null);}}/>}
    <GuideDialogs docId={document.id} width={document.width} height={document.height}/>
  </section>;
}
