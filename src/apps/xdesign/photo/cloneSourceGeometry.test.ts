import { describe, expect, it } from "vitest";
import { cloneSourcePoint } from "./cloneSourceGeometry";
import { strokeParameters } from "./PaintToolOptions";
import type { PhotoCloneSource } from "./types";

const slot=():PhotoCloneSource=>({index:2,source:[10,20],anchor:null,offset:null,layer:987,width:100,height:100,rotation:0,flipH:false,flipV:false});
describe("native Clone Source marker mapping",()=>{
  it("uses first and retained aligned anchors while nonaligned strokes restart at their press",()=>{
    const source=slot(),before=JSON.stringify(source);
    expect(cloneSourcePoint(source,[50,40],null,{})).toEqual([10,20]);
    expect(cloneSourcePoint(source,[50,40],[40,30],{})).toEqual([20,30]);
    source.anchor=[30,25];expect(cloneSourcePoint(source,[50,40],[40,30],{})).toEqual([30,35]);
    expect(cloneSourcePoint(source,[50,40],[40,30],{aligned:false})).toEqual([20,30]);
    expect(cloneSourcePoint(source,[50,40],null,{aligned:false})).toEqual([10,20]);
    source.anchor=null;expect(JSON.stringify(source)).toBe(before);
  });
  it.each([
    {width:200,height:50,rotation:0,flipH:false,flipV:false,expected:[12,32]},
    {width:200,height:50,rotation:90,flipH:false,flipV:false,expected:[7,28]},
    {width:200,height:50,rotation:90,flipH:true,flipV:false,expected:[13,28]},
    {width:200,height:50,rotation:90,flipH:true,flipV:true,expected:[13,12]},
  ])("matches native inverse scale/rotation/flip fixture $expected",({expected,...transform})=>{
    const source={...slot(),...transform};const result=cloneSourcePoint(source,[44,36],[40,30],{})!;expect(result[0]).toBeCloseTo(expected[0]!,12);expect(result[1]).toBeCloseTo(expected[1]!,12);
  });
  it("uses exactly the opt-in native fields produced by the actual Clone/Healing stroke parameter builder",()=>{
    for(const tool of ["paint.cloneStamp","paint.healingBrush"]){const source={...slot(),width:200,height:50,rotation:90,flipH:true};const before=JSON.stringify(source);
      const inherited=strokeParameters(tool,[],5,1,1,"#000000",1,null,{transformSource:false,sourceWidth:900,rotation:-45},false,null,null);
      expect(cloneSourcePoint(source,[44,36],[40,30],inherited)).toEqual([13,28]);
      const overridden=strokeParameters(tool,[],5,1,1,"#000000",1,null,{transformSource:true,sourceWidth:100,sourceHeight:200,rotation:0,flipH:false,flipV:true},false,null,null);
      expect(cloneSourcePoint(source,[44,36],[40,30],overridden)).toEqual([14,17]);expect(JSON.stringify(source)).toBe(before);
    }
  });
  it("refuses missing/nonfinite points and never treats the informational layer as a donor identity",()=>{
    expect(cloneSourcePoint(undefined,[1,2],null,{})).toBeNull();expect(cloneSourcePoint({...slot(),source:null},[1,2],null,{})).toBeNull();expect(cloneSourcePoint(slot(),[Infinity,2],null,{})).toBeNull();
    expect(cloneSourcePoint({...slot(),layer:1},[44,36],[40,30],{})).toEqual(cloneSourcePoint({...slot(),layer:999},[44,36],[40,30],{}));
  });
});
