import { describe, expect, it } from "vitest";
import { SceneGraph } from "@open-pencil/scene-graph";
import { parseDesignJSX, renderDesignJSX } from "./designJsx";

describe("declarative Design JSX",()=>{
  it("accepts design constants, gradients, effects, text and inline SVG",()=>{
    const trees=parseDesignJSX('const accent = "#ff0088";\n<Frame w={320} h={240} fills={[solid(accent)]} effects={[dropShadow({radius:8})]}><Text size={24}>Hello</Text><svg viewBox="0 0 24 24"><path d="M0 0L24 24" stroke={accent}/></svg></Frame>');
    expect(trees[0]?.type).toBe("frame");expect(trees[0]?.children).toHaveLength(2);expect(trees[0]?.props.w).toBe(320);
  });
  it("renders fragments as editable siblings and replaces at the original position",async()=>{
    const graph=new SceneGraph(),page=graph.getPages()[0]!;const target=graph.createNode("RECTANGLE",page.id,{x:120,y:80,name:"Placeholder"});
    const result=await renderDesignJSX(graph,page.id,{replace_id:target.id,jsx:'<><Frame name="Card" w={200} h={120}/><Text>Caption</Text></>'});
    expect(graph.getNode(target.id)).toBeUndefined();expect(graph.getNode(result.id)?.x).toBe(120);expect(result.siblings).toHaveLength(1);expect(graph.getNode(page.id)?.childIds[0]).toBe(result.id);
  });
  it.each([
    '<Frame w={globalThis.location}/>',
    '<Frame w={(()=>{globalThis.__xdesignInjected=true;return 100;})()}/>',
    '<Frame w={Function("return 100")()}/>',
    '<Frame data={{__proto__:{injected:true}}}/>',
    'const x = {};\n<Frame w={x.constructor}/>',
    '<Icon name="unapproved:remote-icon"/>'
  ])("rejects code execution and implicit external resources: %s",source=>{
    expect(()=>parseDesignJSX(source)).toThrow();expect(Reflect.get(globalThis,"__xdesignInjected")).toBeUndefined();
  });
});
