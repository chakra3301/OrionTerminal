import { create } from "zustand";
import type { MenuEntry, MenuItem } from "../menuModel";

export type WarpSplit="Crosswise"|"Vertically"|"Horizontally";
export type WarpTurn="rotate180"|"rotate90Cw"|"rotate90Ccw"|"flipHorizontal"|"flipVertical";
/** What Edit › Transform and the canvas menu reach while a Warp is open; the open GeometryDialog publishes it. */
export type WarpSession={split:(tool:WarpSplit)=>void;removeSplit:()=>void;convertAnchor:()=>void;toggleGuides:()=>void;turn:(turn:WarpTurn)=>void;canSplit:boolean;canRemove:boolean;canConvert:boolean};
export const useWarpSession=create<{session:WarpSession|null}>(()=>({session:null}));
/** Label, warp action and the native command it runs outside a Warp. */
export const WARP_TURNS:[string,WarpTurn,string][]=[["Rotate 180°","rotate180","edit.transform.rotate180"],["Rotate 90° Clockwise","rotate90Cw","edit.transform.rotate90Cw"],["Rotate 90° Counter Clockwise","rotate90Ccw","edit.transform.rotate90Ccw"],["Flip Horizontal","flipHorizontal","edit.transform.flipHorizontal"],["Flip Vertical","flipVertical","edit.transform.flipVertical"]];
/** Photoshop's warp group, shared by Edit › Transform and the canvas menu; greyed outside a Warp. */
export function warpMenuItems(session:WarpSession|null,busy:boolean,warp:MenuItem):MenuEntry[] {
  const off=busy||!session;
  return [warp,
    ...(["Horizontally","Vertically","Crosswise"] as const).map(tool=>({label:`Split Warp ${tool}`,run:()=>session?.split(tool),disabled:off||!session.canSplit})),
    {label:"Remove Warp Split",run:()=>session?.removeSplit(),disabled:off||!session.canRemove},"-",
    {label:"Convert warp anchor point",run:()=>session?.convertAnchor(),disabled:off||!session.canConvert},"-",
    {label:"Toggle Guides",run:()=>session?.toggleGuides(),disabled:off}];
}
