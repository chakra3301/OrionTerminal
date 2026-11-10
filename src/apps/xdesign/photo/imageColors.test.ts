import { expect,it } from "vitest";
import { nativePaintColor,paintColorHex } from "./imageColors";
import { gradientPaintParams } from "./PresetPanels";
import { strokeParameters } from "./PaintToolOptions";

it("limits only display swatches while passing exact native RGBA through strokes and dynamic gradient stops",()=>{
  const foreground:[number,number,number,number]=[.123456,1.2,-.1,.75],background:[number,number,number,number]=[.2,.3,.4,.5];
  expect(paintColorHex(foreground,"#000000")).toBe("#1fff00");expect(nativePaintColor(foreground)).toEqual(foreground);
  expect(strokeParameters("paint.stroke",[[4,5]],12,.65,.42,foreground,1,85,{},false,null,null).color).toEqual(foreground);
  expect(gradientPaintParams({name:"Dynamic",stops:[[0,"foreground"],[1,"background"]],transparency:[]},foreground,background)).toEqual({stops:[[0,foreground],[1,background]],transparency:[]});
  expect(paintColorHex([NaN,0,0,1],"#123456")).toBe("#123456");expect(nativePaintColor([1,0,0])).toBeNull();
});
