import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { SkiaRenderer } from "@open-pencil/core/canvas";
import { renderNodesToImage, computeContentBounds } from "@open-pencil/core/io";
import { parseFigWithSlots } from "../src/apps/xdesign/pencil/figSlots";
import { instanceSlotFrames, ownsSlotContent } from "../src/apps/xdesign/pencil/slots";
import { fontManager } from "@open-pencil/core/text";
import type { CanvasKit } from "canvaskit-wasm";
import { deserializeGraph, serializeGraph } from "../src/apps/xdesign/pencil/document";
import { convertFigImageModes, exportFigImageCompatible } from "../src/apps/xdesign/pencil/figPaintCompatibility";
import { installProceduralPaints } from "../src/apps/xdesign/pencil/proceduralPaints";
import { assertDesignImportSize } from "../src/apps/xdesign/pencil/designImportLimits";
const fixtures=process.env.XDESIGN_OPEN_PENCIL_FIXTURES;
if(!fixtures)throw new Error("Set XDESIGN_OPEN_PENCIL_FIXTURES to the pinned OpenPencil tests/fixtures directory. Missing authored fixtures cannot pass acceptance.");
const output=process.env.XDESIGN_FIDELITY_OUTPUT??"/tmp/xdesign-authored-fidelity";
const report:{name:string;status:string;[key:string]:unknown}[]=[];let ck:CanvasKit;
beforeAll(async()=>{
  await mkdir(output,{recursive:true});ck=await getCanvasKit();installProceduralPaints();fontManager.setOnlineFontProviders({google:false,fontshare:false,fontsource:false});
  const data=await readFile(path.join(fixtures!,"fonts/InterVariable-Latin.ttf"));fontManager.markLoaded("Inter","Regular",new Uint8Array(data).buffer);
});
afterAll(async()=>{await writeFile(path.join(output,"report.json"),JSON.stringify({kind:"Orion import, project persistence and re-export consistency; not a Figma screenshot oracle",fixtureDirectory:fixtures,createdAt:new Date().toISOString(),cases:report},null,2));});
for(const name of ["slots","variable-override-precedence","circle-text","gold-preview","material3","nuxtui"].filter(name=>!process.env.XDESIGN_FIDELITY_CASE||name===process.env.XDESIGN_FIDELITY_CASE)){
  it(`authored ${name}.fig imports, saves and re-exports without sampled visual changes`,async()=>{
    const started=performance.now(),measurements:{stage:unknown;elapsedMs:number;rssBytes:number;heapBytes:number}[]=[];
    const record:{name:string;status:string;[key:string]:unknown}={name,status:"running",measurements};report.push(record);const save=async()=>{const memory=process.memoryUsage();measurements.push({stage:record.stage,elapsedMs:Math.round(performance.now()-started),rssBytes:memory.rss,heapBytes:memory.heapUsed});record.peakRssKiB=process.resourceUsage().maxRSS;await writeFile(path.join(output,`${name}.json`),JSON.stringify(record,null,2));};
    let renderer:SkiaRenderer|undefined;
    try {
      record.stage="Import preflight";await save();const bytes=await readFile(path.join(fixtures!,`${name}.fig`));record.inputBytes=bytes.length;assertDesignImportSize(`${name}.fig`,bytes.length);
      record.stage="Native fig decode";await save();const graph=await parseFigWithSlots(new Uint8Array(bytes).buffer);convertFigImageModes(graph,"import");record.stage="Imported";record.nodes=graph.nodes.size;record.pages=graph.getPages().length;await save();
      if(name==="slots"){
        const assigned=[...graph.nodes.values()].filter(node=>node.type==="INSTANCE").flatMap(node=>instanceSlotFrames(graph,node).filter(frame=>ownsSlotContent(graph,frame)).map(frame=>({instance:node.name,layers:frame.childIds.length,texts:graph.getChildren(frame.id).map(child=>child.text)})));
        record.slots=assigned;expect(assigned.find(slot=>slot.instance==="A filled")?.layers).toBe(2);expect(assigned.find(slot=>slot.instance==="B modified")?.layers).toBe(3);expect(assigned.find(slot=>slot.instance==="B cleared")?.layers).toBe(0);expect(assigned.find(slot=>slot.instance==="D two items")?.layers).toBe(2);expect(assigned.find(slot=>slot.instance==="Panel switched to large")?.layers).toBe(1);
      }
      record.stage="Project persistence";await save();const serialized=serializeGraph(graph),saved=deserializeGraph(serialized);record.projectBytes=new TextEncoder().encode(serialized).length;expect(saved.nodes.size).toBe(graph.nodes.size);
      record.paintTypes=Object.fromEntries([...new Set([...graph.nodes.values()].flatMap(node=>node.fills.map(fill=>fill.type)))].map(type=>[type,[...graph.nodes.values()].reduce((sum,node)=>sum+node.fills.filter(fill=>fill.type===type).length,0)]));
      record.fontFamilies=[...new Set([...graph.nodes.values()].filter(node=>node.type==="TEXT").map(node=>node.fontFamily))];record.fontCoverage="Inter Regular loaded; other authored fonts may fall back in both renders";
      renderer=new SkiaRenderer(ck,ck.MakeSurface(64,64)!);await renderer.loadFonts();
      record.stage="Fig export";await save();const exported=await exportFigImageCompatible(deserializeGraph(serialized),ck,renderer,saved.getPages()[0]!.id);record.exportBytes=exported.length;
      record.stage="Re-import";await save();const reopened=await parseFigWithSlots(new Uint8Array(exported).buffer);convertFigImageModes(reopened,"import");record.reopenedNodes=reopened.nodes.size;
      record.stage="Sampled render";await save();const samples=[];
      if(name==='slots'){
        const instances=[...saved.nodes.values()].filter(node=>node.type==='INSTANCE'&&instanceSlotFrames(saved,node).some(frame=>ownsSlotContent(saved,frame)));
        const slotSamples=[];
        for(const instance of instances){
          const next=[...reopened.nodes.values()].find(node=>node.type==='INSTANCE'&&node.source.id===instance.source.id&&node.name===instance.name);expect(next,instance.name).toBeDefined();
          const contents=instanceSlotFrames(saved,instance).filter(frame=>ownsSlotContent(saved,frame)),nextContents=instanceSlotFrames(reopened,next!).filter(frame=>ownsSlotContent(reopened,frame));
          expect(nextContents.map(frame=>reopened.getChildren(frame.id).map(child=>[child.type,child.text])),instance.name).toEqual(contents.map(frame=>saved.getChildren(frame.id).map(child=>[child.type,child.text])));
          const pageOf=(graph:typeof saved,id:string)=>{let node=graph.getNode(id);while(node&&node.type!=='CANVAS')node=node.parentId?graph.getNode(node.parentId):undefined;return node!.id;};
          const bounds=computeContentBounds(saved,[instance.id]);if(!bounds)continue;const scale=Math.min(1,512/Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY));
          renderer.invalidateAllPictures();const before=renderNodesToImage(ck,renderer,saved,pageOf(saved,instance.id),[instance.id],{format:'PNG',scale});renderer.invalidateAllPictures();const after=renderNodesToImage(ck,renderer,reopened,pageOf(reopened,next!.id),[next!.id],{format:'PNG',scale});expect(before).toBeTruthy();expect(after).toBeTruthy();
          const a=ck.MakeImageFromEncoded(before!)!,b=ck.MakeImageFromEncoded(after!)!;
          try{expect([b.width(),b.height()],instance.name).toEqual([a.width(),a.height()]);const info={width:a.width(),height:a.height(),alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB},x=a.readPixels(0,0,info)!,y=b.readPixels(0,0,info)!;let changed=0;for(let i=0;i<x.length;i++)if(Math.abs(x[i]!-y[i]!)>2)changed++;slotSamples.push({instance:instance.name,changedChannelFraction:changed/x.length});expect(changed/x.length,instance.name).toBeLessThan(.001);}finally{a.delete();b.delete();}
        }
        record.slotSamples=slotSamples;
      }
      for(let pageIndex=0;pageIndex<Math.min(saved.getPages().length,2);pageIndex++){
        const page=saved.getPages()[pageIndex]!,nextPage=reopened.getPages()[pageIndex];expect(nextPage).toBeDefined();
        const roots=saved.getChildren(page.id),nextRoots=reopened.getChildren(nextPage!.id);expect(nextRoots.length).toBe(roots.length);
        const index=roots.findIndex(node=>node.visible&&node.width>0&&node.height>0);if(index<0)continue;
        const node=roots[index]!,next=nextRoots[index]!,bounds=computeContentBounds(saved,[node.id]);if(!bounds)continue;
        const scale=Math.min(1,512/Math.max((bounds.maxX-bounds.minX),(bounds.maxY-bounds.minY)));
        renderer.invalidateAllPictures();const before=renderNodesToImage(ck,renderer,saved,page.id,[node.id],{format:"PNG",scale});renderer.invalidateAllPictures();const after=renderNodesToImage(ck,renderer,reopened,nextPage!.id,[next.id],{format:"PNG",scale});
        expect(before).toBeTruthy();expect(after).toBeTruthy();await writeFile(path.join(output,`${name}-${pageIndex}-before.png`),before!);await writeFile(path.join(output,`${name}-${pageIndex}-after.png`),after!);
        const a=ck.MakeImageFromEncoded(before!)!,b=ck.MakeImageFromEncoded(after!)!;
        try{expect([b.width(),b.height()]).toEqual([a.width(),a.height()]);const info={width:a.width(),height:a.height(),alphaType:ck.AlphaType.Unpremul,colorType:ck.ColorType.RGBA_8888,colorSpace:ck.ColorSpace.SRGB},x=a.readPixels(0,0,info)!,y=b.readPixels(0,0,info)!;let changed=0,error=0;for(let i=0;i<x.length;i++){const difference=Math.abs(x[i]!-y[i]!);if(difference>2)changed++;error+=difference;}samples.push({node:node.name,page:pageIndex,width:a.width(),height:a.height(),changedChannelFraction:changed/x.length,meanChannelError:error/x.length});expect(changed/x.length).toBeLessThan(.001);}finally{a.delete();b.delete();}
      }
      record.samples=samples;record.status="passed";await save();
    }catch(error){record.status="failed";record.error=String(error);await save();throw error;}finally{renderer?.destroy();}
  });
}
