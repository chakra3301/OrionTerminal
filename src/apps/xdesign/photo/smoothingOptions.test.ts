import { describe, expect, it, vi } from "vitest";
import { smoothingMenu } from "./smoothingOptions";
import type { MenuItem } from "../menuModel";

describe("Photoshop Smoothing options",()=>{
  it("lists the four options from the brush's smoothing settings and toggles one at a time",()=>{
    const set=vi.fn();
    const items=smoothingMenu({smoothing:{amount:.1,pulledString:false,catchUp:true,catchUpOnEnd:true,adjustForZoom:false}},false,set) as MenuItem[];
    expect(items.map(item=>[item.label,item.checked,item.disabled])).toEqual([["Pulled String Mode",false,false],["Stroke Catch-up",true,false],["Catch-up on Stroke End",true,false],["Adjust for Zoom",false,false]]);
    items[0]!.run!();items[1]!.run!();
    expect(set.mock.calls).toEqual([[{pulledString:true}],[{catchUp:false}]]);
  });
  it("disables the options while busy or before the brush has loaded",()=>{
    const set=vi.fn();
    expect((smoothingMenu({smoothing:{pulledString:true}},true,set) as MenuItem[]).every(item=>item.disabled)).toBe(true);
    const unloaded=smoothingMenu(undefined,false,set) as MenuItem[];
    expect(unloaded.every(item=>item.disabled&&!item.checked)).toBe(true);
  });
});
