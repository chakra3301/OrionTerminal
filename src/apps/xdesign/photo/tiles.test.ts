import { describe, expect, it, vi } from "vitest";
import { PhotoTileCache, visibleTiles, tileScale, TILE_CAPACITY, type PhotoTile, type TileRect } from "./tiles";

const tile = (rect: TileRect): PhotoTile => ({ ...rect, png: "", selectionPath: "", selectionTruncated: false });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("native image tile viewer", () => {
  it("chooses device-resolution levels and covers a large fit view without thousands of source tiles", () => {
    expect([1,.75,.5,.25,.01].map(zoom=>tileScale(zoom))).toEqual([1,1,2,4,64]);
    expect(tileScale(.25,2)).toBe(2);
    expect(tileScale(NaN)).toBe(1);
    const tiles=visibleTiles(16384,16384,{x:0,y:0,width:16384,height:16384},{scale:16,selectionOnly:true});
    expect(tiles).toHaveLength(4);
    expect(tiles.every(tile=>tile.width/16<=512&&tile.height/16<=512&&tile.selectionOnly)).toBe(true);
    expect(visibleTiles(20,20,{x:0,y:0,width:20,height:20},{scale:3})).toEqual([]);
  });

  it("keeps selection and resolution requests distinct and releases both pixel URLs", async () => {
    let sequence=0;const create=vi.fn(()=>`blob:${sequence++}`),revoke=vi.fn(),changed=vi.fn();
    const load=vi.fn(async(rect:TileRect)=>({...tile(rect),selectionPng:"coverage",pixelWidth:Math.ceil(rect.width/(rect.scale??1)),pixelHeight:Math.ceil(rect.height/(rect.scale??1))}));
    const cache=new PhotoTileCache(load,changed,{create,revoke});
    const rect={x:0,y:0,width:512,height:512};
    cache.request([{...rect,scale:2,selectionOnly:true,selectionOverlay:true}]);await flush();
    expect(create).toHaveBeenCalledTimes(1);expect(changed.mock.calls.at(-1)![0][0]).toMatchObject({url:"",selectionUrl:"blob:0"});
    cache.request([{...rect,scale:1,selectionOverlay:true}]);await flush();
    expect(load).toHaveBeenCalledTimes(2);expect(create).toHaveBeenCalledTimes(3);
    cache.dispose();expect(revoke.mock.calls.flat().sort()).toEqual(["blob:0","blob:1","blob:2"]);
  });

  it("rejects stale resolution pixels and cleans up a partial URL allocation failure", async () => {
    const rect={x:0,y:0,width:512,height:512,scale:2};
    const create=vi.fn().mockReturnValueOnce("blob:color").mockImplementationOnce(()=>{throw new Error("decode failed");});
    const revoke=vi.fn();const load=vi.fn().mockResolvedValueOnce({...tile(rect),scale:1}).mockResolvedValue({...tile(rect),selectionPng:"mask"});
    const cache=new PhotoTileCache(load,vi.fn(),{create,revoke});
    cache.request([rect]);await flush();expect(create).not.toHaveBeenCalled();
    cache.retry();await flush();expect(revoke).toHaveBeenCalledWith("blob:color");cache.dispose();
  });
  it("clips to document pixels, handles edge tiles and prioritizes the visible center", () => {
    const tiles = visibleTiles(1100, 700, { x: 490, y: 490, width: 700, height: 400 });
    expect(tiles[0]).toEqual({ x: 512, y: 512, width: 512, height: 188 });
    expect(tiles).toContainEqual({ x: 1024, y: 512, width: 76, height: 188 });
    expect(visibleTiles(200, 200, { x: -500, y: 0, width: 100, height: 100 })).toEqual([]);
    expect(visibleTiles(40000, 40000, { x: 0, y: 0, width: 40000, height: 40000 })).toHaveLength(TILE_CAPACITY);
  });

  it("limits concurrent requests and ignores pixels from a closed image version", async () => {
    const pending: { rect: TileRect; resolve: (value: PhotoTile) => void }[] = [];
    const load = vi.fn((rect: TileRect) => new Promise<PhotoTile>(resolve => pending.push({ rect, resolve })));
    const changed = vi.fn(), create = vi.fn(() => "blob:tile"), revoke = vi.fn();
    const cache = new PhotoTileCache(load, changed, { create, revoke });
    cache.request(visibleTiles(2048, 2048, { x: 0, y: 0, width: 1100, height: 1100 }));
    expect(load).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(tile(pending[0]!.rect)); await flush();
    expect(load).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(1);
    cache.dispose(); const calls = changed.mock.calls.length;
    pending[1]!.resolve(tile(pending[1]!.rect)); pending[2]!.resolve(tile(pending[2]!.rect)); await flush();
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:tile");
  });

  it("reuses cached pixels while panning and releases them on eviction and close", async () => {
    let sequence = 0;
    const create = vi.fn(() => `blob:${sequence++}`), revoke = vi.fn();
    const load = vi.fn(async (rect: TileRect) => tile(rect));
    const cache = new PhotoTileCache(load, vi.fn(), { create, revoke });
    const first = { x: 0, y: 0, width: 512, height: 512 };
    cache.request([first]); await flush(); cache.request([first]); await flush();
    expect(load).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= TILE_CAPACITY; i++) { cache.request([{ ...first, x: i * 512 }]); await flush(); }
    expect(revoke).toHaveBeenCalledTimes(1);
    cache.dispose(); expect(revoke).toHaveBeenCalledTimes(TILE_CAPACITY + 1);
  });

  it("does not endlessly retry a failed or mismatched tile", async () => {
    const rect = { x: 0, y: 0, width: 512, height: 512 };
    const load = vi.fn(async () => tile({ ...rect, x: 1 })), changed = vi.fn();
    const cache = new PhotoTileCache(load, changed, { create: vi.fn(), revoke: vi.fn() });
    cache.request([rect]); await flush(); cache.request([rect]); await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls.some(([, error]) => error?.includes("did not match"))).toBe(true);
    cache.retry(); await flush(); expect(load).toHaveBeenCalledTimes(2); cache.dispose();
  });
});
