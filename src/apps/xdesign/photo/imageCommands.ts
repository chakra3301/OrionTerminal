import { BLEND_MODES } from "./controls";

// `more` fields appear only under Show More Options; `off` disables a field from the dialog's state.
type Field = {key:string;label:string;group?:string;more?:boolean;off?:(values:Record<string,unknown>,hasSelection:boolean)=>boolean};
export type CommandField = Field & (
  | {kind:"number";min:number;max:number;step?:number;value:number;unit?:string}
  | {kind:"enum";choices:[string,string][];value:string;radios?:boolean}
  | {kind:"boolean";value:boolean}
  | {kind:"color";value:string}
  | {kind:"text";value:string});
export type ImageCommand = {id:string;title:string;fields:CommandField[];sliders?:boolean;preview?:boolean;moreOptions?:boolean;settingsFile?:boolean;params?:(values:Record<string,unknown>)=>Record<string,unknown>};

const n=(key:string,label:string,min:number,max:number,value:number,unit?:string,group?:string,step=1,more=false):CommandField=>({key,label,kind:"number",min,max,value,step,unit,group,...(more?{more}:{})});
const radius=(id:string,title:string,label:string,min:number,max:number,step=1):ImageCommand=>({id,title,fields:[n("radius",label,min,max,1,"pixels",undefined,step)]});

export const SELECTION_MODIFY:ImageCommand[]=[
  radius("select.modify.expand","Expand Selection","Expand By",1,500),
  radius("select.modify.contract","Contract Selection","Contract By",1,500),
  radius("select.modify.feather","Feather Selection","Feather Radius",.1,1000,.1),
  radius("select.modify.smooth","Smooth Selection","Sample Radius",1,500),
  radius("select.modify.border","Border Selection","Width",1,200),
];
export const FILL:ImageCommand={id:"edit.fill",title:"Fill",fields:[
  {key:"contents",label:"Contents",kind:"enum",value:"foreground",choices:[["foreground","Foreground Color"],["background","Background Color"],["contentAware","Content-Aware"],["pattern","Pattern"],["history","History"],["black","Black"],["gray","50% Gray"],["white","White"]]},
  n("opacity","Opacity",0,100,100,"%","Blending"),
  {key:"preserveTransparency",label:"Preserve Transparency",kind:"boolean",value:false,group:"Blending"},
]};
export const STROKE:ImageCommand={id:"edit.stroke",title:"Stroke",fields:[
  n("width","Width",1,250,1,"px","Stroke"),
  {key:"location",label:"Location",kind:"enum",value:"center",radios:true,choices:[["inside","Inside"],["center","Center"],["outside","Outside"]]},
  n("opacity","Opacity",0,100,100,"%","Blending"),
]};
export const FADE:ImageCommand={id:"edit.fade",title:"Fade",sliders:true,fields:[
  n("opacity","Opacity",0,100,100,"%"),
  {key:"mode",label:"Mode",kind:"enum",value:"Normal",choices:BLEND_MODES.map(mode=>[mode,mode] as [string,string])},
]};
export const ROTATE_CANVAS:ImageCommand={id:"image.rotation.arbitrary",title:"Rotate Canvas",fields:[
  n("angle","Angle",-359.99,359.99,0,undefined,undefined,.01),
  {key:"direction",label:"Direction",kind:"enum",value:"cw",radios:true,choices:[["cw","°CW"],["ccw","°CCW"]]},
]};
export const CONTENT_AWARE_SCALE:ImageCommand={id:"edit.contentAwareScale",title:"Content-Aware Scale",fields:[
  n("scaleX","Width",1,400,100,"%"),n("scaleY","Height",1,400,100,"%"),n("amount","Amount",0,100,100,"%"),
  {key:"protectSkinTones",label:"Protect Skin Tones",kind:"boolean",value:false},
]};
export const SHADOWS_HIGHLIGHTS:ImageCommand={id:"image.adjustments.shadowsHighlights",title:"Shadows/Highlights",sliders:true,preview:true,moreOptions:true,settingsFile:true,fields:[
  n("shadowAmount","Amount",0,100,35,"%","Shadows"),n("shadowTone","Tone",0,100,50,"%","Shadows",1,true),n("shadowRadius","Radius",0,2500,30,"px","Shadows",1,true),
  n("highlightAmount","Amount",0,100,0,"%","Highlights"),n("highlightTone","Tone",0,100,50,"%","Highlights",1,true),n("highlightRadius","Radius",0,2500,30,"px","Highlights",1,true),
  n("color","Color",-100,100,20,undefined,"Adjustments",1,true),n("midtone","Midtone",-100,100,0,undefined,"Adjustments",1,true),
  n("blackClip","Black Clip",0,50,.01,"%","Adjustments",.01,true),n("whiteClip","White Clip",0,50,.01,"%","Adjustments",.01,true),
]};
export const REPLACE_COLOR:ImageCommand={id:"image.adjustments.replaceColor",title:"Replace Color",sliders:true,preview:true,settingsFile:true,fields:[
  {key:"color",label:"Color",kind:"color",value:"#000000",group:"Selection"},n("fuzziness","Fuzziness",0,200,40,undefined,"Selection"),
  n("hue","Hue",-180,180,0,undefined,"Replacement"),n("saturation","Saturation",-100,100,0,undefined,"Replacement"),n("lightness","Lightness",-100,100,0,undefined,"Replacement"),
]};
export function matchColorCommand(images:{id:string;version:string;name:string}[]):ImageCommand {
  return {id:"image.adjustments.matchColor",title:"Match Color",sliders:true,preview:true,fields:[
    n("luminance","Luminance",1,200,100,undefined,"Image Options"),n("intensity","Color Intensity",1,200,100,undefined,"Image Options"),n("fade","Fade",0,100,0,undefined,"Image Options"),
    {key:"neutralize",label:"Neutralize",kind:"boolean",value:false,group:"Image Options"},
    {key:"useSelectionInSource",label:"Use Selection in Source to Calculate Colors",kind:"boolean",value:false,group:"Image Statistics",off:(values)=>!values.sourceImage},
    {key:"useSelectionInTarget",label:"Use Selection in Target to Calculate Colors",kind:"boolean",value:false,group:"Image Statistics",off:(_,hasSelection)=>!hasSelection},
    {key:"sourceImage",label:"Source",kind:"enum",value:"",group:"Image Statistics",choices:[["","None"],...images.map(image=>[image.id,image.name] as [string,string])]},
  ],params:({sourceImage,...values})=>{const image=images.find(item=>item.id===sourceImage);return image?{...values,sourcePhoto:{id:image.id,version:image.version}}:values;}};
}
export const DEFRINGE:ImageCommand={id:"layer.matting.defringe",title:"Defringe",fields:[n("width","Width",1,200,1,"pixels")]};
export const COLOR_DECONTAMINATE:ImageCommand={id:"layer.matting.colorDecontaminate",title:"Color Decontaminate",fields:[n("amount","Amount",0,100,100,"%"),n("radius","Radius",1,100,4,"pixels")]};
export const SCALE_EFFECTS:ImageCommand={id:"layer.layerStyle.scaleEffects",title:"Scale Layer Effects",fields:[n("scale","Scale",1,1000,100,"%")]};
export const HDR_TONING:ImageCommand={id:"image.adjustments.hdrToning",title:"HDR Toning",fields:[
  n("radius","Radius",1,500,30,"px","Edge Glow"),n("strength","Strength",.1,4,.5,undefined,"Edge Glow",.1),
  n("gamma","Gamma",.1,2,1,undefined,"Tone and Detail",.01),n("exposure","Exposure",-5,5,0,undefined,"Tone and Detail",.1),n("detail","Detail",-100,300,30,"%","Tone and Detail"),
  n("shadow","Shadow",-100,100,0,"%","Advanced"),n("highlight","Highlight",-100,100,0,"%","Advanced"),n("vibrance","Vibrance",-100,100,0,"%","Advanced"),n("saturation","Saturation",-100,100,20,"%","Advanced"),
]};

type Values=Record<string,unknown>;
const choice=(key:string,label:string,value:string,choices:[string,string][],group?:string,off?:Field["off"],radios?:boolean):CommandField=>({key,label,kind:"enum",value,choices,group,...(off?{off}:{}),...(radios?{radios}:{})});
const flag=(key:string,label:string,value:boolean,group?:string,off?:Field["off"]):CommandField=>({key,label,kind:"boolean",value,group,...(off?{off}:{})});
const swatch=(key:string,label:string,value:string,group?:string,off?:Field["off"]):CommandField=>({key,label,kind:"color",value,group,...(off?{off}:{})});
const text=(key:string,label:string,value:string):CommandField=>({key,label,kind:"text",value});
// The engine reads `color` only when background is custom.
const artboardParams=({color,...rest}:Values)=>rest.background==="custom"?{...rest,color}:rest;
const ARTBOARD_BACKGROUND:CommandField[]=[
  choice("background","Background Contents","white",[["white","White"],["black","Black"],["transparent","Transparent"],["custom","Custom…"]]),
  swatch("color","Color","#ffffff",undefined,values=>values.background!=="custom"),
];

const FIXED_PALETTES=["exact","systemMac","systemWindows","web"];
export const INDEXED_COLOR:ImageCommand={id:"image.mode.indexedColor",title:"Indexed Color",fields:[
  choice("palette","Palette","selective",[["exact","Exact"],["systemMac","System (Mac OS)"],["systemWindows","System (Windows)"],["web","Web"],["uniform","Uniform"],["perceptual","Local (Perceptual)"],["selective","Local (Selective)"],["adaptive","Local (Adaptive)"]],"Palette"),
  {...n("colors","Colors",2,256,256,undefined,"Palette"),off:values=>FIXED_PALETTES.includes(String(values.palette))},
  choice("forced","Forced","blackWhite",[["none","None"],["blackWhite","Black and White"],["primaries","Primaries"],["web","Web"]],"Palette",values=>values.palette==="uniform"||FIXED_PALETTES.includes(String(values.palette))),
  flag("transparency","Transparency",true,"Options"),
  choice("dither","Dither","diffusion",[["none","None"],["diffusion","Diffusion"],["pattern","Pattern"],["noise","Noise"]],"Options",values=>values.palette==="exact"),
  {...n("amount","Amount",0,100,75,"%","Options"),off:values=>values.palette==="exact"||values.dither!=="diffusion"},
]};
const notHalftone=(values:Values)=>values.method!=="halftone";
export const BITMAP:ImageCommand={id:"image.mode.bitmap",title:"Bitmap",fields:[
  choice("method","Use","diffusion",[["threshold","50% Threshold"],["pattern","Pattern Dither"],["diffusion","Diffusion Dither"],["halftone","Halftone Screen"]],"Method"),
  {...n("frequency","Frequency",1,999,53,"lines/inch","Halftone Screen"),off:notHalftone},
  {...n("angle","Angle",-180,180,45,"degrees","Halftone Screen"),off:notHalftone},
  choice("shape","Shape","round",[["round","Round"],["ellipse","Ellipse"],["line","Line"],["square","Square"],["diamond","Diamond"],["cross","Cross"]],"Halftone Screen",notHalftone),
]};
export const TRAP:ImageCommand={id:"image.trap",title:"Trap",fields:[n("width","Width",1,10,1,"pixels")]};
export const MEASUREMENT_SCALE:ImageCommand={id:"image.analysis.setMeasurementScale",title:"Measurement Scale",fields:[
  n("pixelLength","Pixel Length",.0001,1000000,1,"pixels",undefined,.0001),n("logicalLength","Logical Length",.0001,1000000,1,undefined,undefined,.0001),text("units","Logical Units","pixels"),
]};
export const SCALE_MARKER:ImageCommand={id:"image.analysis.placeScaleMarker",title:"Place Scale Marker",fields:[
  n("length","Length",.0001,1000000,1,undefined,undefined,.0001),n("fontSize","Font Size",1,500,12,"pt"),flag("displayText","Display Text",true),
  choice("textPosition","Text Position","bottom",[["top","Top"],["bottom","Bottom"]],undefined,undefined,true),
  choice("color","Color","black",[["black","Black"],["white","White"]],undefined,undefined,true),
]};
export const NEW_ARTBOARD:ImageCommand={id:"layer.new.artboard",title:"New Artboard",params:artboardParams,fields:[text("name","Name","Artboard"),n("width","Width",1,16384,1080,"px"),n("height","Height",1,16384,1080,"px"),...ARTBOARD_BACKGROUND]};
export const ARTBOARD_FROM_GROUP:ImageCommand={id:"layer.new.artboardFromGroup",title:"Artboard from Group",params:artboardParams,fields:ARTBOARD_BACKGROUND};
export const ARTBOARD_FROM_LAYERS:ImageCommand={id:"layer.new.artboardFromLayers",title:"Artboard from Layers",params:artboardParams,fields:[text("name","Name","Artboard"),...ARTBOARD_BACKGROUND]};

export const FLAME:ImageCommand={id:"filter.render.flame",title:"Flame",fields:[
  choice("flameType","Flame Type","oneFlameAlongPath",[["oneFlameAlongPath","One Flame Along Path"],["multipleFlamesAlongPath","Multiple Flames Along Path"],["multipleFlamesPathDirections","Multiple Flames Path Directions"],["multipleFlamesVariousLength","Multiple Flames Various Length"],["candleLight","Candle Light"],["multipleFlamesOneDirection","Multiple Flames One Direction"]],"Basic"),
  n("length","Length",1,1000,150,undefined,"Basic"),n("width","Width",1,1000,40,undefined,"Basic"),n("angle","Angle",-180,180,0,"degrees","Basic"),n("interval","Interval",1,1000,60,undefined,"Basic"),
  flag("randomizeLength","Randomize Flame Length",false,"Basic"),flag("adjustIntervalForLoops","Adjust Interval for Loops",true,"Basic"),
  flag("useCustomColor","Use Custom Color",false,"Basic"),swatch("color","Color","#ff6a00","Basic",values=>!values.useCustomColor),
  n("turbulent","Turbulent",0,100,25,undefined,"Basic"),n("jag","Jag",0,100,25,undefined,"Basic"),n("opacity","Opacity",0,100,75,"%","Basic"),
  n("flameLines","Flame Lines",1,100,20,undefined,"Advanced"),n("flameBottomAlignment","Flame Bottom Alignment",0,100,20,undefined,"Advanced"),
  choice("flameStyle","Flame Style","normal",[["normal","Normal"],["violent","Violent"],["flat","Flat"]],"Advanced"),
  choice("flameShape","Flame Shape","parallel",[["parallel","Parallel"],["toCenter","To Center"],["spread","Spread"],["oval","Oval"],["pointed","Pointed"]],"Advanced"),
  flag("randomizeShapes","Randomize Shapes",false,"Advanced"),
  choice("quality","Quality","medium",[["draft","Draft"],["low","Low"],["medium","Medium"],["high","High"],["fine","Fine"]],"Advanced"),
]};
export const PICTURE_FRAME:ImageCommand={id:"filter.render.pictureFrame",title:"Picture Frame",fields:[
  choice("frame","Frame","vineWithFlowers",[["vineWithFlowers","Vine with Flowers"],["vineWithLeaves","Vine with Leaves"],["ivy","Ivy"],["roses","Roses"],["daisies","Daisies"],["berries","Berries"],["bamboo","Bamboo"],["waves","Waves"],["zigzag","Zigzag"],["dots","Dots"],["rope","Rope"],["scallops","Scallops"],["doubleLine","Double Line"],["snowflakes","Snowflakes"],["stars","Stars"],["hearts","Hearts"]],"Frame"),
  n("margin","Margin",0,30,4,undefined,"Frame"),n("size","Size",1,100,50,undefined,"Frame"),n("arrangement","Arrangement",1,100,50,undefined,"Frame"),n("lines","Lines",1,5,1,undefined,"Frame"),n("thickness","Thickness",1,100,30,undefined,"Frame"),n("fade","Fade",0,100,0,undefined,"Frame"),
  swatch("vineColor","Vine Color","#3d7a2a","Colors"),swatch("flowerColor","Flower Color","#d94a7a","Colors"),swatch("leafColor","Leaf Color","#5aa03a","Colors"),
]};
export const TREE:ImageCommand={id:"filter.render.tree",title:"Tree",fields:[
  n("baseTreeType","Base Tree Type",1,34,1,undefined,"Tree"),n("lightDirection","Light Direction",1,5,3,undefined,"Tree"),
  n("leavesAmount","Leaves Amount",0,100,50,undefined,"Leaves"),n("leavesSize","Leaves Size",0,200,100,undefined,"Leaves"),
  flag("defaultLeaves","Default Leaves",true,"Leaves"),swatch("leavesColor","Leaves Color","#4f8a2b","Leaves",values=>!!values.defaultLeaves),
  n("branchesHeight","Branches Height",50,300,100,undefined,"Branches"),n("branchesThickness","Branches Thickness",50,200,100,undefined,"Branches"),
  flag("customBranchColor","Custom Branch Color",false,"Branches"),swatch("branchesColor","Branches Color","#6b4a2b","Branches",values=>!values.customBranchColor),
  flag("flatShading","Flat Shading",false,"Branches"),
]};
