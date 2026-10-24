import { parseColor } from "@open-pencil/core/color";
import type { Color, SceneNode } from "@open-pencil/scene-graph";
import type { DesignPlan, PlanNode, PlanLayout } from "../designPlan";
import { usePencilWorkspace, persistPencil } from "./runtime";
import { editPencilGraph } from "./toolExecution";

export function ingestPencilPlans(plans:DesignPlan[]):void {
  const editor=usePencilWorkspace.getState().editor;if(!editor)throw new Error("Wait for the design canvas to load");
  const roots:string[]=[];
  editPencilGraph(editor,"Generate designs",()=>{
    let collection=editor.getCollections().find(c=>c.name==="Design tokens");
    if(!collection)collection=editor.graph.createCollection("Design tokens");
    let cursorX=120;
    for(const plan of plans){
      const colors=new Map<string,string>();
      for(const token of plan.tokens.colors){const color=parseColor(token.value);if(!color)throw new Error(`Invalid color token ${token.name}`);let variable=editor.getVariablesForCollection(collection.id).find(v=>v.name===token.name&&v.type==="COLOR");if(!variable)variable=editor.graph.createVariable(token.name,"COLOR",collection.id,color);else variable.valuesByMode[collection.defaultModeId]=color;colors.set(token.name,variable.id);}
      const appearance=(value:string|undefined):{color:Color;variable?:string}=>{if(value?.startsWith("color/")){const id=colors.get(value.slice(6));if(!id)throw new Error(`Unknown color token ${value}`);return {color:editor.resolveColorVariable(id)!,variable:id};}const color=parseColor(value??"#d9d9d9");if(!color)throw new Error("Invalid design fill");return {color};};
      const layout=(value:PlanLayout|undefined):Partial<SceneNode>=>{const padding=value?.padding??0;return {layoutMode:value?.mode==="vertical"?"VERTICAL":value?.mode==="horizontal"?"HORIZONTAL":"NONE",itemSpacing:value?.gap??0,paddingTop:padding,paddingRight:padding,paddingBottom:padding,paddingLeft:padding,primaryAxisAlign:value?.primaryAlign?.toUpperCase().replaceAll("-","_") as SceneNode["primaryAxisAlign"]??"MIN",counterAxisAlign:value?.counterAlign?.toUpperCase() as SceneNode["counterAxisAlign"]??"MIN"};};
      const create=(input:PlanNode,parentId:string,x=0,y=0):string=>{
        const paint=appearance(input.fill);const type=input.type==="text"?"TEXT":input.type==="frame"?"FRAME":input.type==="ellipse"?"ELLIPSE":"RECTANGLE";
        const props:Partial<SceneNode>={name:input.name??input.type,x,y,width:input.w??100,height:input.h??40,cornerRadius:input.radius??0,fills:[{type:"SOLID",color:paint.color,opacity:1,visible:true}],...layout(input.layout)};
        if(type==="TEXT")Object.assign(props,{text:input.text??"",fontFamily:"Inter",fontSize:input.fontSize??16,fontWeight:input.fontWeight??400,lineHeight:input.lineHeight??null,textAlignHorizontal:input.textAlign?.toUpperCase()??"LEFT",textAutoResize:input.sizingH==="hug"?"WIDTH_AND_HEIGHT":input.sizingV==="hug"?"HEIGHT":"NONE"});
        const parent=editor.graph.getNode(parentId);const vertical=parent?.layoutMode==="VERTICAL";
        props.primaryAxisSizing=(input.layout?.mode==="horizontal"?input.sizingH??"fixed":input.sizingV??"fixed").toUpperCase() as SceneNode["primaryAxisSizing"];
        props.counterAxisSizing=(input.layout?.mode==="horizontal"?input.sizingV??"fixed":input.sizingH??"fixed").toUpperCase() as SceneNode["counterAxisSizing"];
        props.layoutGrow=(vertical?input.sizingV:input.sizingH)==="fill"?1:0;
        props.layoutAlignSelf=(vertical?input.sizingH:input.sizingV)==="fill"?"STRETCH":"AUTO";
        props.effects=(input.effects??[]).map(f=>({type:f.type==="inner"?"INNER_SHADOW":"DROP_SHADOW",color:parseColor(f.color??"#00000040")??{r:0,g:0,b:0,a:.25},offset:{x:f.offsetX??0,y:f.offsetY??4},radius:f.blur??8,spread:0,visible:true}));
        const node=editor.graph.createNode(type,parentId,props);if(paint.variable)editor.graph.bindVariable(node.id,"fills/0/color",paint.variable);
        for(const child of input.children??[])create(child,node.id);return node.id;
      };
      const root=create({type:"frame",name:plan.screen.name,w:plan.screen.w,h:plan.screen.h,fill:plan.screen.fill??"#ffffff",layout:plan.screen.layout,children:plan.screen.children},editor.state.currentPageId,cursorX,120);roots.push(root);cursorX+=plan.screen.w+160;
    }
  });
  editor.select(roots);persistPencil();void editor.loadFontsForNodes(roots);
}
