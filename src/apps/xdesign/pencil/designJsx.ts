import { parse, type AnyNode } from "acorn";
import { createElement, resolveToTree, transformDesignJSXExpression, renderTree, dropShadow, innerShadow, layerBlur, backgroundBlur, foregroundBlur, solid, gradient, linearGradient, radialGradient, angularGradient, diamondGradient, designVar, defineVars, type TreeNode } from "@open-pencil/core/design-jsx";
import type { SceneGraph } from "@open-pencil/scene-graph";

const elements:Record<string,string>={Frame:"frame",View:"frame",Text:"text",Rectangle:"rectangle",Rect:"rectangle",Ellipse:"ellipse",Line:"line",Star:"star",Polygon:"polygon",Vector:"vector",Group:"group",Section:"section",Component:"component",ComponentSet:"component-set",Instance:"instance",Page:"frame",__fragment:""};
const helpers:Record<string,Function>={dropShadow,innerShadow,layerBlur,backgroundBlur,foregroundBlur,solid,gradient,linearGradient,radialGradient,angularGradient,diamondGradient,designVar,defineVars};
const forbidden=new Set(["__proto__","prototype","constructor"]);

/** Interpret declarative JSX data; never execute authored JavaScript. */
export function parseDesignJSX(source:string):TreeNode[] {
  if(source.length>512*1024)throw new Error("Design JSX exceeds 512KB");
  const program=parse(transformDesignJSXExpression(source),{ecmaVersion:"latest",allowReturnOutsideFunction:true});
  const bindings:Record<string,unknown>=Object.assign(Object.create(null),elements,{undefined:undefined});
  let budget=50_000;
  const evaluate=(input:AnyNode,depth=0):unknown=>{
    if(--budget<0||depth>128)throw new Error("Design JSX exceeds its complexity limit");
    const visit=(node:unknown)=>evaluate(node as AnyNode,depth+1);
    switch(input.type){
      case "Literal":if(input.regex||input.bigint||typeof input.value==="number"&&!Number.isFinite(input.value))throw new Error("Unsupported JSX literal");return input.value;
      case "Identifier":if(Object.hasOwn(bindings,input.name))return bindings[input.name];throw new Error(`Unknown JSX value: ${input.name}`);
      case "ArrayExpression":return input.elements.map(n=>n?visit(n):null);
      case "ObjectExpression":{
        const result:Record<string,unknown>=Object.create(null);
        for(const entry of input.properties){
          if(entry.type==="SpreadElement"){const value=visit(entry.argument);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("JSX spread must be an object");for(const [key,item] of Object.entries(value)){if(forbidden.has(key))throw new Error("Unsupported JSX property");result[key]=item;}continue;}
          if(entry.kind!=="init"||entry.method||entry.computed)throw new Error("JSX properties must be plain data");
          const key=entry.key.type==="Identifier"?entry.key.name:entry.key.type==="Literal"?String(entry.key.value):"";
          if(!key||forbidden.has(key))throw new Error("Unsupported JSX property");result[key]=visit(entry.value);
        }return result;
      }
      case "UnaryExpression":{const value=visit(input.argument);if(input.operator==="-"&&typeof value==="number")return -value;if(input.operator==="+"&&typeof value==="number")return value;if(input.operator==="!")return !value;throw new Error("Unsupported JSX expression");}
      case "MemberExpression":{
        const object=visit(input.object),key=input.computed?visit(input.property):input.property.type==="Identifier"?input.property.name:null;
        if(!object||typeof object!=="object"||typeof key!=="string"&&typeof key!=="number"||forbidden.has(String(key)))throw new Error("Unsupported JSX value access");
        const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor||!Object.hasOwn(descriptor,"value")||typeof descriptor.value==="function")throw new Error("Unknown JSX property");return descriptor.value;
      }
      case "CallExpression":{
        if(input.callee.type!=="Identifier"||input.arguments.some(a=>a.type==="SpreadElement"))throw new Error("Only design helpers can be called in JSX");
        const args=input.arguments.map(visit),name=input.callee.name;
        if(name==="__h"){
          const [type,props,...children]=args;
          if(typeof type!=="string"||!["",...Object.values(elements),"svg","path","circle","rect","ellipse","line","polyline","polygon","g"].includes(type))throw new Error("Unsupported design element; import SVG for external icons");
          if(props!==null&&(!props||typeof props!=="object"||Array.isArray(props)))throw new Error("JSX props must be an object");
          return Reflect.apply(createElement,undefined,[type,props,...children]);
        }
        if(!Object.hasOwn(helpers,name))throw new Error(`Unsupported design helper: ${name}`);return Reflect.apply(helpers[name]!,undefined,args);
      }
      default:throw new Error(`Unsupported JSX expression: ${input.type}`);
    }
  };
  let element:unknown;
  for(const statement of program.body){
    if(statement.type==="VariableDeclaration"&&statement.kind==="const"){
      for(const declaration of statement.declarations){if(declaration.id.type!=="Identifier"||!declaration.init||Object.hasOwn(bindings,declaration.id.name)||Object.hasOwn(helpers,declaration.id.name)||forbidden.has(declaration.id.name))throw new Error("JSX declarations must introduce a new data constant");bindings[declaration.id.name]=evaluate(declaration.init as AnyNode);}
    }else if(statement.type==="ReturnStatement"&&statement.argument)element=evaluate(statement.argument as AnyNode);
    else throw new Error("Use design elements and data constants in JSX");
  }
  const tree=resolveToTree(element);if(!tree)throw new Error("JSX must contain design elements");
  const trees=tree.type===""?tree.children.filter((child):child is TreeNode=>typeof child!=="string"):[tree];
  if(!trees.length)throw new Error("JSX must contain design elements");return trees;
}

export async function renderDesignJSX(graph:SceneGraph,pageId:string,args:Record<string,unknown>) {
  const trees=parseDesignJSX(String(args.jsx));
  const target=typeof args.replace_id==="string"?graph.getNode(args.replace_id):undefined;
  if(args.replace_id&&!target)throw new Error("The layer to replace no longer exists");
  if(target&&["DOCUMENT","CANVAS"].includes(target.type))throw new Error("Choose a design layer to replace");
  const parentId=target?.parentId??String(args.parent_id??pageId),parent=graph.getNode(parentId);
  if(!parent)throw new Error("The JSX parent no longer exists");
  const insertion=target?parent.childIds.indexOf(target.id):typeof args.insert_index==="number"?args.insert_index:parent.childIds.length;
  const results=[];
  for(const tree of trees){const result=await renderTree(graph,tree,{parentId,x:typeof args.x==="number"?args.x:target?.x,y:typeof args.y==="number"?args.y:target?.y});graph.reorderChild(result.id,parentId,insertion+results.length);results.push(result);}
  if(target)graph.deleteNode(target.id);
  const result=results[0]!;return {id:result.id,name:result.name,type:result.type,children:result.childIds,...(results.length>1?{siblings:results.slice(1).map(n=>({id:n.id,name:n.name,type:n.type}))}:{})};
}
