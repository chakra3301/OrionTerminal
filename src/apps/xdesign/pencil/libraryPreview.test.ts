// @vitest-environment node
import { beforeAll, expect, it } from "vitest";
import { SceneGraph } from "@open-pencil/scene-graph";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { fontManager } from "@open-pencil/core/text";
import type { CanvasKit } from "canvaskit-wasm";
import { serializeGraph, deserializeGraph } from "./document";
import { libraryPreviewChoices, renderLibraryPreview } from "./libraryPreview";
import type { LibraryUpdateReview } from "./librarySession";
let ck:CanvasKit;beforeAll(async()=>{ck=await getCanvasKit();fontManager.setOnlineFontProviders({google:false,fontshare:false,fontsource:false});});
it("renders isolated before/after instances without changing either reviewed graph",async()=>{
  const graph=new SceneGraph(),page=graph.getPages()[0]!,main=graph.createNode("COMPONENT",page.id,{name:"Button",width:40,height:40,fills:[{type:"SOLID",color:{r:1,g:0,b:0,a:1},opacity:1,visible:true}],librarySource:{identity:{libraryId:"test",revisionId:"old",assetKey:"button"},readOnly:true,sourceNodeId:"source"}}),instance=graph.createInstance(main.id,page.id)!;
  const originalGraph=serializeGraph(graph),updated=deserializeGraph(originalGraph);updated.updateNode(instance.id,{width:80,fills:[{type:"SOLID",color:{r:0,g:0,b:1,a:1},opacity:1,visible:true}]});
  const review:LibraryUpdateReview={libraryId:"test",name:"Library",currentRevisionId:"old",targetRevisionId:"new",originalGraph,updatedGraph:serializeGraph(updated),changes:[],affectedInstanceCount:1,fallbackInstanceCount:0,removedInstanceCount:0,discardedOverrideCount:0};
  expect(libraryPreviewChoices(review)).toContainEqual({id:instance.id,name:instance.name});const preview=await renderLibraryPreview(review,instance.id,ck);expect(preview.beforeSize).toBe("40 × 40");expect(preview.afterSize).toBe("80 × 40");expect(preview.before).not.toBe(preview.after);expect(serializeGraph(graph)).toBe(originalGraph);expect(serializeGraph(updated)).toBe(review.updatedGraph);
});
