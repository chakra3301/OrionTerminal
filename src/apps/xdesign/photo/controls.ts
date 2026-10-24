export type NumberControl = { key: string; label: string; min: number; max: number; value: number; step?: number; text?: string; unit?: string; group?: string };
export type FilterOption = { key: string; label: string; kind: "enum" | "boolean" | "color"; value: string | boolean; choices?: string[]; text?: string; radios?: boolean; labels?: Record<string, string> };
export type PhotoAction = { id: string; label: string; category?: string; fields?: NumberControl[]; options?: FilterOption[]; defaults?: Record<string, unknown>; structured?: "kernel" | "shear" | "lights" | "field" | "iris" | "spin" | "paths" | "gallery" | "lens" | "wide"; file?: { key: string; label: string; extensions: string[] }; direct?: boolean };
const n = (key: string, label: string, min: number, max: number, value: number, step = 1): NumberControl => ({key,label,min,max,value,step});
const e = (key: string, label: string, value: string, choices: string[]) => ({key,label,kind:"enum" as const,value,choices});
const b = (key: string, label: string, value: boolean) => ({key,label,kind:"boolean" as const,value});

export const ADJUSTMENTS: PhotoAction[] = [
  {id:"brightnessContrast",label:"Brightness/Contrast",fields:[n("brightness","Brightness",-150,150,0),n("contrast","Contrast",-50,100,0)]},
  {id:"levels",label:"Levels",fields:[n("inBlack","Input black",0,253,0),n("gamma","Gamma",0.01,9.99,1,0.01),n("inWhite","Input white",2,255,255),n("outBlack","Output black",0,255,0),n("outWhite","Output white",0,255,255)]},
  {id:"curves",label:"Curves"},
  {id:"exposure",label:"Exposure",fields:[n("exposure","Exposure",-20,20,0,0.01),n("offset","Offset",-0.5,0.5,0,0.0001),n("gamma","Gamma",0.01,9.99,1,0.01)]},
  {id:"vibrance",label:"Vibrance",fields:[n("vibrance","Vibrance",-100,100,0),n("saturation","Saturation",-100,100,0)]},
  {id:"hueSaturation",label:"Hue/Saturation",fields:[n("hue","Hue",-180,180,0),n("saturation","Saturation",-100,100,0),n("lightness","Lightness",-100,100,0)]},
  {id:"blackWhite",label:"Black & White",fields:[n("reds","Reds",-200,300,40),n("yellows","Yellows",-200,300,60),n("greens","Greens",-200,300,40),n("cyans","Cyans",-200,300,60),n("blues","Blues",-200,300,20),n("magentas","Magentas",-200,300,80)]},
  {id:"colorBalance",label:"Color Balance",fields:[n("cyanRed","Cyan / Red",-100,100,0),n("magentaGreen","Magenta / Green",-100,100,0),n("yellowBlue","Yellow / Blue",-100,100,0)]},
  {id:"photoFilter",label:"Photo Filter",fields:[n("density","Density",0,100,25)]},
  {id:"channelMixer",label:"Channel Mixer",fields:[n("red","Red",-200,200,100),n("green","Green",-200,200,0),n("blue","Blue",-200,200,0),n("constant","Constant",-200,200,0)]},
  {id:"gradientMap",label:"Gradient Map"},
  {id:"selectiveColor",label:"Selective Color",fields:[n("cyan","Cyan",-100,100,0),n("magenta","Magenta",-100,100,0),n("yellow","Yellow",-100,100,0),n("black","Black",-100,100,0)]},
  {id:"colorLookup",label:"Color Lookup"},
  {id:"invert",label:"Invert"},
  {id:"posterize",label:"Posterize",fields:[n("levels","Levels",2,255,4)]},
  {id:"threshold",label:"Threshold",fields:[n("level","Threshold",1,255,128)]},
];
export const BASIC_FILTERS: PhotoAction[] = [
  {id:"filter.blur.gaussianBlur",label:"Gaussian Blur",fields:[n("radius","Radius",0.1,1000,1,0.1)]},
  {id:"filter.blur.boxBlur",label:"Box Blur",fields:[n("radius","Radius",1,2000,1)]},
  {id:"filter.blur.motionBlur",label:"Motion Blur",fields:[n("angle","Angle",-360,360,0),n("distance","Distance",1,2000,10)]},
  {id:"filter.blur.radialBlur",label:"Radial Blur",fields:[n("amount","Amount",1,100,10),n("centerX","Center X",0,1,0.5,0.01),n("centerY","Center Y",0,1,0.5,0.01)],options:[e("method","Method","spin",["spin","zoom"])]},
  {id:"filter.blur.surfaceBlur",label:"Surface Blur",fields:[n("radius","Radius",1,100,5),n("threshold","Threshold",2,255,15)]},
  {id:"filter.sharpen.unsharpMask",label:"Unsharp Mask",fields:[n("amount","Amount",1,500,50),n("radius","Radius",0.1,1000,1,0.1),n("threshold","Threshold",0,255,0)]},
  {id:"filter.sharpen.smartSharpen",label:"Smart Sharpen",fields:[n("amount","Amount",1,500,100),n("radius","Radius",0.1,64,1,0.1),n("reduceNoise","Reduce noise",0,100,10)]},
  {id:"filter.noise.addNoise",label:"Add Noise",fields:[n("amount","Amount",0.1,400,12.5,0.1),n("seed","Seed",0,4294967295,0)],options:[e("distribution","Distribution","uniform",["uniform","gaussian"]),b("monochromatic","Monochromatic",false)]},
  {id:"filter.noise.median",label:"Median",fields:[n("radius","Radius",1,500,1)]},
  {id:"filter.noise.dustAndScratches",label:"Dust & Scratches",fields:[n("radius","Radius",1,500,1),n("threshold","Threshold",0,255,0)]},
  {id:"filter.pixelate.mosaic",label:"Mosaic",fields:[n("cellSize","Cell size",2,200,10)]},
  {id:"filter.stylize.emboss",label:"Emboss",fields:[n("angle","Angle",-180,180,135),n("height","Height",1,100,3),n("amount","Amount",1,500,100)]},
  {id:"filter.stylize.findEdges",label:"Find Edges"},
  {id:"filter.stylize.solarize",label:"Solarize"},
  {id:"filter.distort.twirl",label:"Twirl",fields:[n("angle","Angle",-999,999,50)]},
  {id:"filter.distort.pinch",label:"Pinch",fields:[n("amount","Amount",-100,100,50)]},
  {id:"filter.distort.spherize",label:"Spherize",fields:[n("amount","Amount",-100,100,100)],options:[e("mode","Mode","normal",["normal","horizontalOnly","verticalOnly"])]},
  {id:"filter.distort.wave",label:"Wave",fields:[n("generators","Generators",1,999,5),n("wavelengthMin","Minimum wavelength",1,998,10),n("wavelengthMax","Maximum wavelength",2,999,120),n("amplitudeMin","Minimum amplitude",1,998,5),n("amplitudeMax","Maximum amplitude",1,999,35),n("seed","Seed",0,4294967295,0)],options:[e("type","Wave type","sine",["sine","triangle","square"]),e("undefinedAreas","Edge behavior","wrap",["wrap","repeat"])]},
  {id:"filter.distort.ripple",label:"Ripple",fields:[n("amount","Amount",-999,999,100)],options:[e("size","Size","medium",["small","medium","large"])]},
  {id:"filter.distort.polarCoordinates",label:"Polar Coordinates",options:[e("mode","Mode","rectangularToPolar",["rectangularToPolar","polarToRectangular"])]},
  {id:"filter.other.highPass",label:"High Pass",fields:[n("radius","Radius",0.1,1000,10,0.1)]},
  {id:"filter.other.minimum",label:"Minimum",fields:[n("radius","Radius",0.2,500,1,0.1)],options:[e("preserve","Preserve","squareness",["squareness","roundness"])]},
  {id:"filter.other.maximum",label:"Maximum",fields:[n("radius","Radius",0.2,500,1,0.1)],options:[e("preserve","Preserve","squareness",["squareness","roundness"])]},
  {id:"filter.other.offset",label:"Offset",fields:[n("horizontal","Horizontal",-2147483648,2147483647,0),n("vertical","Vertical",-2147483648,2147483647,0)],options:[e("undefinedAreas","Undefined areas","wrap",["transparent","repeat","wrap"])]},
];
const FILTER_CATEGORY: Record<string, string> = { blur: "Blur", sharpen: "Sharpen", noise: "Noise", pixelate: "Pixelate", stylize: "Stylize", distort: "Distort", other: "Other" };
BASIC_FILTERS.forEach(action => { action.category = FILTER_CATEGORY[action.id.split(".")[1] ?? ""] ?? "Filter"; });
export const FILTER_PRESETS: PhotoAction[] = [
  {id:"filter.blur.blur",label:"Blur",category:"Blur",defaults:{},direct:true},
  {id:"filter.blur.blurMore",label:"Blur More",category:"Blur",defaults:{},direct:true},
  {id:"filter.sharpen.sharpen",label:"Sharpen",category:"Sharpen",defaults:{},direct:true},
  {id:"filter.sharpen.sharpenMore",label:"Sharpen More",category:"Sharpen",defaults:{},direct:true},
  {id:"filter.sharpen.sharpenEdges",label:"Sharpen Edges",category:"Sharpen",defaults:{},direct:true},
  {id:"filter.noise.despeckle",label:"Despeckle",category:"Noise",defaults:{},direct:true},
];
export const REPEAT_FILTER: PhotoAction = {id:"filter.lastFilter",label:"Last Filter",category:"Recent",defaults:{}};
import { EXTENDED_FILTERS } from "./extendedFilters";
import { GALLERY_ACTION, GALLERY_FILTERS } from "./galleryFilters";
import { LENS_FILTERS } from "./lensFilters";
export const FILTERS: PhotoAction[] = [...BASIC_FILTERS,...FILTER_PRESETS,REPEAT_FILTER,...EXTENDED_FILTERS,...GALLERY_FILTERS,GALLERY_ACTION,...LENS_FILTERS];
export const BLEND_MODES = ["Normal","Dissolve","Darken","Multiply","Color Burn","Linear Burn","Darker Color","Lighten","Screen","Color Dodge","Linear Dodge (Add)","Lighter Color","Overlay","Soft Light","Hard Light","Vivid Light","Linear Light","Pin Light","Hard Mix","Difference","Exclusion","Subtract","Divide","Hue","Saturation","Color","Luminosity"];

export const COLOR_LOOKS = [["none","None"],["warm","Warm Filter"],["cool","Cool Filter"],["tealOrange","Teal & Orange"],["bleachBypass","Bleach Bypass"],["fadedFilm","Faded Film"],["dayForNight","Day for Night"],["monoContrast","Mono High Contrast"],["crossProcess","Cross Process"]] as const;

/** Never show a raw camelCase value. */
export const humanize = (value: string) => value === "a" || value === "b" ? value : value.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
export const choiceLabel = (option: Pick<FilterOption, "labels">, value: string) => option.labels?.[value] ?? humanize(value);

// `label` stays the stable name behind aria-labels; `text` is what Photoshop shows. Parameter keys and ranges are untouched.
type Wording = { text?: string; unit?: string; group?: string; radios?: boolean; labels?: Record<string, string> };
const px: Wording = { unit: "Pixels" }, pct: Wording = { unit: "%" }, deg: Wording = { unit: "\u00b0" }, levels: Wording = { unit: "levels" };
// Photoshop's Offset says "Set to Background"; the engine value is `transparent`.
const edge = { wrap: "Wrap Around", repeat: "Repeat Edge Pixels", transparent: "Set to Background" };
const lensEdge = { transparency: "Transparency", edgeExtension: "Edge Extension", black: "Black Color", white: "White Color" };
const WORDING: Record<string, Record<string, Wording>> = {
  levels: { inBlack: { text: "Black", group: "Input Levels" }, gamma: { text: "Gamma", group: "Input Levels" }, inWhite: { text: "White", group: "Input Levels" }, outBlack: { text: "Black", group: "Output Levels" }, outWhite: { text: "White", group: "Output Levels" } },
  exposure: { gamma: { text: "Gamma Correction" } },
  blackWhite: { reds: pct, yellows: pct, greens: pct, cyans: pct, blues: pct, magentas: pct },
  photoFilter: { density: pct },
  channelMixer: { red: pct, green: pct, blue: pct, constant: pct },
  selectiveColor: { cyan: pct, magenta: pct, yellow: pct, black: pct },
  threshold: { level: { text: "Threshold Level" } },
  "filter.blur.gaussianBlur": { radius: px },
  "filter.blur.boxBlur": { radius: px },
  "filter.blur.motionBlur": { angle: deg, distance: px },
  "filter.blur.radialBlur": { method: { text: "Blur Method", radios: true } },
  "filter.blur.surfaceBlur": { radius: px, threshold: levels },
  "filter.sharpen.unsharpMask": { amount: pct, radius: px, threshold: levels },
  "filter.sharpen.smartSharpen": { amount: pct, radius: { unit: "px" }, reduceNoise: { text: "Reduce Noise", unit: "%" } },
  "filter.noise.addNoise": { amount: pct, distribution: { radios: true } },
  "filter.noise.median": { radius: px },
  "filter.noise.dustAndScratches": { radius: px, threshold: levels },
  "filter.pixelate.mosaic": { cellSize: { text: "Cell Size", unit: "square" } },
  "filter.stylize.emboss": { angle: deg, height: px, amount: pct },
  "filter.distort.twirl": { angle: deg },
  "filter.distort.pinch": { amount: pct },
  "filter.distort.spherize": { amount: pct, mode: { labels: { horizontalOnly: "Horizontal only", verticalOnly: "Vertical only" } } },
  "filter.distort.wave": { generators: { text: "Number of Generators" }, wavelengthMin: { text: "Min.", group: "Wavelength" }, wavelengthMax: { text: "Max.", group: "Wavelength" }, amplitudeMin: { text: "Min.", group: "Amplitude" }, amplitudeMax: { text: "Max.", group: "Amplitude" }, type: { text: "Type", radios: true }, undefinedAreas: { text: "Undefined Areas", radios: true, labels: edge } },
  "filter.distort.ripple": { amount: pct },
  "filter.distort.polarCoordinates": { mode: { radios: true, labels: { rectangularToPolar: "Rectangular to Polar", polarToRectangular: "Polar to Rectangular" } } },
  "filter.other.highPass": { radius: px },
  "filter.other.minimum": { radius: px, preserve: { radios: true } },
  "filter.other.maximum": { radius: px, preserve: { radios: true } },
  "filter.other.offset": { horizontal: { unit: "pixels right" }, vertical: { unit: "pixels down" }, undefinedAreas: { text: "Undefined Areas", radios: true, labels: edge } },
  "filter.pixelate.colorHalftone": { maxRadius: { text: "Max. Radius", unit: "pixels" }, channel1: { text: "Channel 1", unit: "\u00b0" }, channel2: { text: "Channel 2", unit: "\u00b0" }, channel3: { text: "Channel 3", unit: "\u00b0" }, channel4: { text: "Channel 4", unit: "\u00b0" } },
  "filter.pixelate.crystallize": { cellSize: { text: "Cell Size" } },
  "filter.pixelate.pointillize": { cellSize: { text: "Cell Size" } },
  "filter.blur.shapeBlur": { radius: px },
  "filter.blur.lensBlur": { distribution: { radios: true } },
  "filter.noise.reduceNoise": { preserveDetails: { text: "Preserve Details", unit: "%" }, reduceColorNoise: { text: "Reduce Color Noise", unit: "%" }, sharpenDetails: { text: "Sharpen Details", unit: "%" } },
  "filter.stylize.traceContour": { edge: { radios: true } },
  "filter.lensCorrection": { distortion: { text: "Remove Distortion" }, redCyan: { text: "Fix Red/Cyan Fringe" }, blueYellow: { text: "Fix Blue/Yellow Fringe" }, vignetteAmount: { text: "Amount", group: "Vignette" }, vignetteMidpoint: { text: "Midpoint", group: "Vignette" }, vertical: { text: "Vertical Perspective", group: "Transform" }, horizontal: { text: "Horizontal Perspective", group: "Transform" }, angle: { text: "Angle", unit: "\u00b0", group: "Transform" }, scale: { text: "Scale", unit: "%", group: "Transform" },
    correctDistortion: { text: "Geometric Distortion" }, correctVignette: { text: "Vignette" }, correctCA: { text: "Chromatic Aberration" }, autoScale: { text: "Auto Scale Image" }, edge: { text: "Edge", labels: lensEdge } },
  "filter.gallery.charcoal": { lightDarkBalance: { text: "Light/Dark Balance" } },
  "filter.gallery.graphicPen": { lightDarkBalance: { text: "Light/Dark Balance" } },
  "filter.gallery.stamp": { lightDarkBalance: { text: "Light/Dark Balance" } },
};
const SMALL = new Set(["a", "an", "and", "by", "for", "in", "of", "on", "or", "the", "to"]);
const titleCase = (value: string) => value.split(" ").map((word, index) => index && SMALL.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
// Labels written as "Focal length (mm)" become "Focal Length" with a "mm" suffix.
function phrase(label: string): Wording {
  const match = /^(.*?)\s*\(([^)]+)\)$/.exec(label), text = titleCase(match?.[1] ?? label);
  return { ...(text !== label ? { text } : {}), ...(match ? { unit: match[2] } : {}) };
}
for (const action of [...ADJUSTMENTS, ...FILTERS]) {
  const words = WORDING[action.id] ?? {};
  for (const field of action.fields ?? []) Object.assign(field, phrase(field.label), words[field.key]);
  for (const option of action.options ?? []) Object.assign(option, { text: phrase(option.label).text }, words[option.key]);
}
