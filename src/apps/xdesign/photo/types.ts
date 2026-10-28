export type PhotoDocument = {
  id: string;
  version: string;
  name: string;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  bundlePath: string;
  previewPath: string;
  originalPath: string | null;
  historyBrushSourceId?: string;
};

export type PhotoTextRun={start:number;end:number;style:Record<string,unknown>};
export type PhotoTextShape={kind:"point"}|{kind:"box";x:number;y:number;width:number;height:number};
export type PhotoTextWarp={style:string;bend:number;horizontalDistortion:number;verticalDistortion:number;orientation:"horizontal"|"vertical"};
export type GradientFill={style:string;angle:number;scale:number;offset:[number,number];reverse:boolean;dither:boolean;align:boolean;from:[number,number];to:[number,number];stops:[number,string][];transparency:[number,number][];midpoints:number[]};
export type LayerColor = "none"|"red"|"orange"|"yellow"|"green"|"blue"|"violet"|"gray";
export type PhotoLayer = {
  id: number;
  name: string;
  kind: string;
  visible: boolean;
  opacity: number;
  fill: number;
  blend: string;
  clipped: boolean;
  hasMask: boolean;
  mask?: {enabled:boolean;linked:boolean};
  hasVectorMask?: boolean;
  vectorMask?: {enabled:boolean;linked:boolean};
  hasPixels?: boolean;
  selected?: boolean;
  locks?: {transparency:boolean;pixels:boolean;position:boolean;all:boolean};
  /** Photoshop's layer colour label. */
  color?: LayerColor;
  linkGroup?: number|null;
  children?: PhotoLayer[];
  expanded?: boolean;
  artboard?: {rect:[number,number,number,number];background:string;preset:string|null};
  adjustment?: Record<string, unknown>;
  adjustmentKind?: string;
  adjustmentParams?: Record<string, unknown>;
  bounds?: [number,number,number,number] | null;
  transformBounds?: [number,number,number,number];
  text?: {text:string;font:string;sizePt:number;runs?:PhotoTextRun[];paragraphs?:PhotoTextRun[];truncated?:boolean;antialias?:string;orientation?:string;shape?:PhotoTextShape;transform?:[number,number,number,number,number,number];warp?:PhotoTextWarp|null};
  gradientFill?:GradientFill;
  effects?: {enabled:boolean;items:PhotoEffect[]};
  smartObject?: {source:"embedded"|"linked";name:string;hasFilterMask:boolean;filterMaskEnabled?:boolean};
  smartFilters?: {command:string;params:Record<string,unknown>;visible:boolean;opacity:number;blend:string}[];
  smartFiltersEnabled?:boolean;
  blendIf?: {channel:number;thisLayer:number[];underlying:number[]}[];
};
export type PhotoEffect = {kind:string;type:string;enabled:boolean;settings:Record<string,unknown>;colors:Record<string,string>};

export type PhotoChannelTarget = {kind:"composite"} | {kind:"color"|"alpha";index:number};
export type PhotoMaskView = {layer:number;mode:"gray"|"overlay"};
export type PhotoChannels = {
  composite?:string;
  compositeVisible?:boolean;
  colors?:{name:string;visible:boolean}[];
  alpha:{index:number;name:string;spot:unknown;visible?:boolean;color?:number[];opacity?:number;indicates?:string}[];
  target?:PhotoChannelTarget;
  quickMask?:{visible:boolean;color:number[];opacity:number;indicates:string}|null;
};

export type GradientPreset={name:string;stops:[number,string][];transparency:[number,number][]};
export type PhotoCloneSource={index:number;source:[number,number]|null;anchor:[number,number]|null;offset:[number,number]|null;layer:number|null;width:number;height:number;rotation:number;flipH:boolean;flipV:boolean};
export type PhotoCloneSources={active:number;sources:PhotoCloneSource[];overlay:{show:boolean;opacity:number;clipped:boolean;auto_hide:boolean;invert:boolean;blend:string}};
export type PhotoRulerInfo={x:number;y:number;w:number;h:number;angle:number;l1:number;l2:number|null;length:number;units:string;protractor:boolean};
/** Colours are 0..1 RGB. */
export type PhotoCountGroup={name:string;color:number[];markerSize:number;labelSize:number;visible:boolean;points:[number,number][]};
export type PhotoNote={index:number;author:string;text:string;color:number[];position:[number,number];open:boolean;modified:string};
export type PhotoSlice={number:number;id:number|null;origin:"auto"|"layer"|"user";name:string;rect:[number,number,number,number];kind:string;layer:number|null;url:string;target:string;message:string;alt:string;cellText:string;background:string|null};
export type PhotoAnalysis={ruler:{start:[number,number];end:[number,number];protractor:[number,number]|null;info:PhotoRulerInfo}|null;count:{total:number;activeGroup:number;groups:PhotoCountGroup[]};notes:PhotoNote[];slices:PhotoSlice[];slicesLocked:boolean};
export type PhotoLayerComp={id:number;name:string;comment:string;visibility:boolean;position:boolean;appearance:boolean;missingLayers:number};
export type PhotoDataPoint={key:string;name:string};
export type PhotoMeasureSource="selection"|"ruler"|"count";
/** `attrs` and `resolved` hold the engine's model fields (`size_pt`, `font_family`, `align`, …). */
export type PhotoCharacterStyle={id:number;name:string;attrs:Record<string,unknown>;resolved:Record<string,unknown>};
export type PhotoParagraphStyle={id:number;name:string;paragraphAttrs:Record<string,unknown>;characterAttrs:Record<string,unknown>;resolved:{paragraph:Record<string,unknown>;character:Record<string,unknown>}};
/** `current` is null without a selected type layer; a style id is null when the text mixes styles. */
export type PhotoPanels={
  layerComps:{comps:PhotoLayerComp[];lastApplied:number|null;hasLastDocumentState:boolean};
  measurementLog:{rows:{id:number;values:Record<string,unknown>}[];columns:PhotoDataPoint[];dataPoints:Record<PhotoMeasureSource,string[]>;available:Record<PhotoMeasureSource,PhotoDataPoint[]>};
  textStyles:{character:PhotoCharacterStyle[];paragraph:PhotoParagraphStyle[];current:{character:number|null;characterOverride:boolean;paragraph:number|null;paragraphOverride:boolean}|null};
};
export type PhotoRGBA = [number,number,number,number];
export type PhotoColor = string | PhotoRGBA;
export type PhotoState = {
  name: string;
  width: number;
  height: number;
  mode: string;
  depth: number;
  resolution: number;
  activeLayer: number | null;
  selectedLayers?: number[];
  hasSelection: boolean;
  selectionBounds: [number, number, number, number] | null;
  layers: PhotoLayer[];
  channels?: PhotoChannels;
  quickMask?:boolean;
  layerMaskView?:PhotoMaskView|null;
  viewKey?:string;
  features?: {selectionEdgeBrush?:boolean;perspectiveCrop?:boolean;magneticLasso?:boolean;placeImages?:boolean};
  tools?: {foreground:PhotoRGBA;background:PhotoRGBA};
  colorView?: {profile:string;description:string;kind:string;intent:string;bpc:boolean;simulatePaper:boolean;on:boolean;gamutWarning:boolean;threshold:number;hdr:{highlightCompression:boolean;exposure:number;gamma:number};active:boolean};
  colorSettings?: PhotoColorSettings;
  colorProfile?: {description:string;colorSpace:string;embedded:boolean;bytes:number};
  brush?: {revision?:number;settings:Record<string,unknown>;sampledTip:boolean;sampledTexture:boolean;presets:{name:string;group:string;builtin:boolean;size:number;hardness:number}[]};
  presets?: {revision?:number;gradient:GradientPreset;gradients:{name:string;presets:GradientPreset[]}[];styles:{name:string;presets:{name:string;effects:string[]}[]}[];
    patterns?:{name:string;presets:{id:string;name:string;width:number;height:number}[]}[];pattern?:string|null;
    shapes?:{name:string;presets:{name:string}[]}[];tools?:{name:string;tool:string}[];cloneSource?:PhotoCloneSources};
  globalLight?: {angle:number;altitude:number};
  analysis?: PhotoAnalysis;
  panels?: PhotoPanels;
  canUndo: boolean;
  canRedo: boolean;
  canFade?: boolean;
  canCancelPreview?: boolean;
  historySources?:PhotoHistorySource[];
  historyRedo?:string[];
  historySnapshots?:PhotoHistorySnapshot[];
  historySnapshotName?:string;
  historyOpenThumbnail?:string|null;
  paths?:{saved:string[];work:boolean};
};
export type PhotoHistorySnapshot={id:string;name:string;source:string;current:boolean;thumbnail?:string|null};
export type PhotoHistorySource={id:string;index:number;label:string;current:boolean;available:boolean;reason?:string|null};

export type PhotoColorSettings = {revision:string;settings:{workingRgb:string;workingCmyk:string;workingGray:string;policyRgb:"preserve"|"convert"|"off";policyCmyk:"preserve"|"convert"|"off";policyGray:"preserve"|"convert"|"off";askOnMismatch:boolean;askOnPaste:boolean;askOnMissing:boolean;intent:string;bpc:boolean;dither:boolean;blendTextGamma:number;monitorProfile:string};working:Record<"workingRgb"|"workingCmyk"|"workingGray",{description:string;colorSpace:string;custom:boolean;source:string|null}>};
export type PhotoColorDecision = {token:string;projectId:string;photoId:string;report:{name:string;mode:string;depth:number;missing?:boolean;mismatch?:boolean;embedded?:string;working:string;policy:"preserve"|"convert"|"off";ask:boolean};settings:PhotoColorSettings;choices:("preserve"|"convert"|"discard"|"assignWorking"|"assignProfile")[]};
export type PhotoPasteDecision={token:string;requestId:string;projectId:string;photoId:string;version:string;viewKey:string;command:string;report:{sourceName:string;sourceProfile:string;targetProfile:string;sourceMode:string;targetMode:string;canKeepNumbers:boolean;policy:"preserve"|"convert"|"off";intent:string;bpc:boolean};choices:("convert"|"numbers")[]};
export type PhotoClipboardReply=PhotoReply|{pasteDecision:PhotoPasteDecision}|{pasteCanceled:true};
export type PhotoOpenReply = PhotoReply | {colorDecision:PhotoColorDecision};
export type PhotoReply = { document: PhotoDocument; state: PhotoState; warnings: string[]; result?:unknown };
export type PhotoCommand = { id: string; label: string; menu: string[]; shortcut: string | null; params: string; hostDispatch: boolean };

const ID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
export const PSD_PATH = /\.(psd|psb)$/i;
export function validatePhotoSavePaths(value: unknown): asserts value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 1024 ||
    Object.entries(value).some(([id, path]) => !ID.test(id) || typeof path !== "string" || !PSD_PATH.test(path))) throw new Error("Invalid saved image locations");
}
export type PhotoResume = { source: "legacy" | "pencil"; placementId: string; documentId: string };
// Shape only: an image that no longer exists falls back to the board when reopening, instead of refusing to load the project.
export function validatePhotoResume(value: unknown): asserts value is PhotoResume {
  const resume = value as PhotoResume | null;
  if (!resume || typeof resume !== "object" || Array.isArray(resume) || !["legacy", "pencil"].includes(resume.source) ||
    typeof resume.placementId !== "string" || !resume.placementId || resume.placementId.length > 128 ||
    typeof resume.documentId !== "string" || !ID.test(resume.documentId)) throw new Error("Invalid open image");
}
export function validatePhotoDocuments(value: unknown): asserts value is Record<string, PhotoDocument> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid image document registry");
  const entries = Object.entries(value);
  if (entries.length > 1024) throw new Error("Image document registry exceeds its limit");
  for (const [key, doc] of entries) {
    if (!doc || doc.id !== key || !ID.test(key) || !ID.test(doc.version) || typeof doc.name !== "string" ||
      ![doc.width, doc.height, doc.previewWidth, doc.previewHeight].every(n => Number.isInteger(n) && n > 0) ||
      doc.width * doc.height > 268_435_456 || doc.previewWidth > doc.width || doc.previewHeight > doc.height ||
      typeof doc.bundlePath !== "string" || !doc.bundlePath.endsWith(`${doc.version}.pcraft`) ||
      typeof doc.previewPath !== "string" || !doc.previewPath.endsWith(`${doc.version}.png`) ||
      (doc.originalPath !== null && typeof doc.originalPath !== "string") ||
      (doc.historyBrushSourceId !== undefined && (typeof doc.historyBrushSourceId !== "string" || !ID.test(doc.historyBrushSourceId)))) throw new Error("Invalid or unsupported image document data");
  }
}
