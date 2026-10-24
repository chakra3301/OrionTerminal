import { describe, expect, it } from "vitest";
import { penKnots, simplifyPath, smoothHandles } from "./penPath";

describe("pen path geometry",()=>{
  it("derives mirrored Catmull-Rom handles for open and closed paths",()=>{
    expect(smoothHandles([[0,0],[60,0],[60,60]],false)).toEqual([[10,0],[70,10],[60,70]]);
    expect(smoothHandles([[0,0],[60,0],[60,60]],true)).toEqual([[0,-10],[70,10],[50,60]]);
    expect(smoothHandles([[5,5]],false)).toEqual([null]);
    expect(penKnots([[0,0],[60,0]],[null,[70,10]])).toEqual([[0,0],{anchor:[60,0],in:[50,-10],out:[70,10],smooth:true}]);
  });
  it("keeps corners and drops points within the tolerance",()=>{
    const line=Array.from({length:21},(_,index)=>[index*5,index%2?.4:0] as [number,number]);
    expect(simplifyPath(line,1)).toEqual([[0,0],[100,0]]);
    expect(simplifyPath([[0,0],[50,1],[100,0],[100,50],[100.5,100]],2)).toEqual([[0,0],[100,0],[100.5,100]]);
    expect(simplifyPath([[0,0],[1,1]],1)).toEqual([[0,0],[1,1]]);
  });
});
