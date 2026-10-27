import { describe, expect, it } from "vitest";
import { polygonPoints, polygonRect } from "./polygonShape";

const bounds=(points:[number,number][])=>{const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];};

describe("polygon shape geometry",()=>{
  it("matches the engine's vertices: the first point on top, a star alternating with its inner radius",()=>{
    const square=polygonPoints([0,0,100,100],4);
    expect(square.map(([x,y])=>[Math.round(x),Math.round(y)])).toEqual([[50,0],[100,50],[50,100],[0,50]]);
    const star=polygonPoints([0,0,100,100],5,.5);
    expect(star).toHaveLength(10);expect(Math.hypot(star[1]![0]-50,star[1]![1]-50)).toBeCloseTo(25);
  });
  it("sizes the ellipse so the triangle, polygon or star fills the dragged box",()=>{
    const box={x:100,y:50,width:100,height:100};
    expect(polygonRect(box,3)).toEqual([92.26,50,115.47,133.33]);
    for(const [sides,ratio] of [[3,1],[5,1],[6,.5],[5,.9]] as const){
      const [x0,y0,x1,y1]=bounds(polygonPoints(polygonRect(box,sides,ratio),sides,ratio));
      expect(x0).toBeCloseTo(100,1);expect(y0).toBeCloseTo(50,1);expect(x1).toBeCloseTo(200,1);expect(y1).toBeCloseTo(150,1);
    }
  });
});
