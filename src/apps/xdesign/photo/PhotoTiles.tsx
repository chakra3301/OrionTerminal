import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PhotoDocument } from "./types";
import { PhotoTileCache, previewCoversScreen, visibleTiles, tileScale, tileKey, type PhotoTile, type DisplayTile } from "./tiles";
import { TileSurface } from "./strokeCanvas";
import { useViewTurn, visibleArea } from "./viewTurn";

export function PhotoTiles({ document, projectId, zoom, hasSelection, selectionDisplay = "outline", edges = true, viewKey, stage, image, status, ready, surface, children }: {
  document: PhotoDocument; projectId: string | null; zoom: number;
  hasSelection: boolean;
  selectionDisplay?: "outline" | "overlay" | "both";
  /** Photoshop's View > Show > Selection Edges, also governed by Extras. */
  edges?: boolean;
  viewKey?:string;
  stage: RefObject<HTMLDivElement | null>; image: RefObject<HTMLDivElement | null>;
  status: (message: string | null) => void;
  /** Called with the tile count once the visible detail of `version` has finished loading. */
  ready?: (count: number, version: string) => void;
  /** Where live stroke pixels are patched into the color tiles. */
  surface?: TileSurface;
  /** Drawn above the color tiles and below the selection, e.g. live stroke feedback. */
  children?: ReactNode;
}) {
  const readyRef = useRef(ready); readyRef.current = ready;
  const [ownSurface] = useState(() => new TileSurface());
  const [tiles, setTiles] = useState<DisplayTile[]>([]);
  const [failure,setFailure] = useState<string|null>(null);
  const currentCache = useRef<PhotoTileCache|null>(null);
  const detail = useRef({ zoom, hasSelection, selectionDisplay }); detail.current = { zoom, hasSelection, selectionDisplay };
  const refresh = useRef<(() => void) | null>(null);
  // The previous version's tiles stay on screen until the new version's visible set has fully
  // decoded; swapping them one by one (or blanking first) flashes the low-resolution preview.
  const retired = useRef<{ cache: PhotoTileCache; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isTauri() || !projectId) return;
    if (retired.current && (retired.current.width !== document.width || retired.current.height !== document.height)) { retired.current.cache.dispose(); retired.current = null; setTiles([]); }
    const cache = new PhotoTileCache(rect => invoke<PhotoTile>("xdesign_photo_tile", {
      projectId, photoId: document.id, version: document.version, viewKey:viewKey??null, ...rect,
    }), (tiles, error) => {
      setFailure(error); status(error ?? (tiles.some(tile => tile.selectionTruncated) ? "Complex selection shown as coverage" : null));
      const count = cache.loaded();
      if (retired.current && count == null) return;
      retired.current?.cache.dispose(); retired.current = null;
      setTiles(tiles); if (count != null) readyRef.current?.(count, document.version);
    });
    currentCache.current = cache;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scroller = stage.current, surface = image.current;
        if (!scroller || !surface) return;
        const bounds = surface.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return;
        const { zoom, hasSelection, selectionDisplay } = detail.current;
        const pixelRatio = window.devicePixelRatio || 1;
        const selectionOnly = previewCoversScreen(document, zoom, pixelRatio);
        if (!hasSelection && selectionOnly) { cache.request([]); return; }
        cache.request(visibleTiles(document.width, document.height, visibleArea(scroller, surface, zoom, document.width, document.height), { scale: tileScale(zoom, pixelRatio), selectionOnly, selectionOverlay: hasSelection && selectionDisplay !== "outline" }));
      });
    };
    const scroller = stage.current;
    refresh.current = update;
    scroller?.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update); if (scroller) resize.observe(scroller);
    update();
    return () => {
      cancelAnimationFrame(frame); scroller?.removeEventListener("scroll", update); resize.disconnect();
      refresh.current = null; currentCache.current = null; status(null);
      if (retired.current) cache.dispose();
      else { cache.retire(); retired.current = { cache, width: document.width, height: document.height }; }
    };
  }, [document.id, document.version, document.width, document.height, document.previewWidth, projectId,viewKey, stage, image, status]);
  useEffect(() => () => { retired.current?.cache.dispose(); retired.current = null; }, []);
  const turn = useViewTurn(state => state.turns[document.id]);
  useEffect(() => { refresh.current?.(); }, [zoom, hasSelection, selectionDisplay, turn]);
  const layers = { document, tiles, zoom, selectionDisplay, edges, surface: surface ?? ownSurface };
  return <><PhotoTileLayers {...layers} part="color"/>{children}<PhotoTileLayers {...layers} part="selection"/>{failure&&<button className="xd-photo-preview-retry" onClick={()=>currentCache.current?.retry()}>Retry detail preview</button>}</>;
}

/** Tile and image elements are keyed by position and role, not URL or version, so a newer
 * tile replaces the old pixels in place instead of remounting over the empty checker. */
export function PhotoTileLayers({document,tiles,zoom=1,selectionDisplay,edges=true,part,surface}:{document:PhotoDocument;tiles:DisplayTile[];zoom?:number;selectionDisplay:"outline"|"overlay"|"both";edges?:boolean;part?:"color"|"selection";surface:TileSurface}) {
  const layers = tiles.flatMap(tile => {
    const color = part !== "selection" ? tile.url : "";
    const selection = part !== "color" && (selectionDisplay !== "outline" || edges && tile.selectionTruncated) ? tile.selectionUrl : undefined;
    const contour = edges && part !== "color" && selectionDisplay !== "overlay" ? tile.selectionPath : "";
    return color || selection || contour ? [{ tile, images: ([["color", color], ["selection", selection]] as const).filter(([, url]) => url), contour }] : [];
  });
  if (!layers.length) return null;
  const checker = (tile: DisplayTile) => ({ backgroundPosition: `${-tile.x * zoom}px ${-tile.y * zoom}px` });
  return <div className="xd-photo-tiles" aria-hidden="true">{layers.map(({tile,images,contour}) => <div key={tileKey(tile)} className="xd-photo-tile" style={{
    left: `${tile.x / document.width * 100}%`, top: `${tile.y / document.height * 100}%`, width: `${tile.width / document.width * 100}%`, height: `${tile.height / document.height * 100}%`,
  }}>{images[0]?.[0]==="color"&&<div className="xd-photo-tile-under" style={checker(tile)}/>}{images.length>0&&<div className={`xd-photo-tile-pixels${images[0]![0]==="color"?" has-color":""}`} style={checker(tile)}>{images.map(([role,url])=>{const style={width:`${(tile.pixelWidth??tile.width)*(tile.scale??1)/tile.width*100}%`,height:`${(tile.pixelHeight??tile.height)*(tile.scale??1)/tile.height*100}%`};return role==="color"?<TileCanvas key={role} tile={tile} surface={surface} style={style}/>:<img key={role} src={url} alt="" draggable={false} style={style}/>;})}</div>}{contour && <svg viewBox={`0 0 ${tile.width} ${tile.height}`} preserveAspectRatio="none"><path d={contour} className="xd-photo-contour-back"/><path d={contour} className="xd-photo-contour"/></svg>}</div>)}</div>;
}

function TileCanvas({tile,surface,style}:{tile:DisplayTile;surface:TileSurface;style:CSSProperties}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{const element=canvas.current;if(!element)return;surface.show(element,tile);return()=>surface.detach(element);},[surface,tile]);
  return <canvas ref={canvas} style={style}/>;
}
