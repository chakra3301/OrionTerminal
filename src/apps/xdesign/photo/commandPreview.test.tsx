import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoCommandPreview, type PhotoPreviewRegion } from "./commandPreview";
import type { PhotoDocument } from "./types";
import type { SelectionPreviewView } from "./selectionSettings";
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke}));
const doc:PhotoDocument={id:"photo",version:"v1",name:"Image",width:80,height:60,previewWidth:80,previewHeight:60,bundlePath:"",previewPath:"",originalPath:null};
let root:Root,container:HTMLDivElement,create:ReturnType<typeof vi.fn>,revoke:ReturnType<typeof vi.fn>;
function Harness({exposure=1,version="v1",automatic=false,enabled=true,viewKey,selectionView}:{exposure?:number;version?:string;automatic?:boolean;enabled?:boolean;viewKey?:string;selectionView?:SelectionPreviewView}) {
  const preview=usePhotoCommandPreview({...doc,version},"project",selectionView?"select.refineEdge":"filter.cameraRaw",{exposure},{automatic,enabled,delay:100,viewKey,selectionView});
  return <div data-url={preview.url??""} data-error={preview.error??""} data-stale={preview.stale}><button disabled={preview.loading} onClick={()=>void preview.preview()}>Preview</button></div>;
}
const render=async(exposure=1,version="v1")=>act(async()=>root.render(<Harness exposure={exposure} version={version}/>));
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.invoke.mockReset();
  const taskCreate=vi.fn((_object:Blob|MediaSource)=>`blob:${create.mock.calls.length}`),taskRevoke=vi.fn((_url:string)=>{});
  create=taskCreate;revoke=taskRevoke;
  vi.stubGlobal("URL",class extends URL {static override createObjectURL(object:Blob|MediaSource){return taskCreate(object);}static override revokeObjectURL(url:string){taskRevoke(url);}});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});

const blurRegion: PhotoPreviewRegion = { x: 0, y: 0, width: 20, height: 16, scale: 1 }, movedBlurRegion = { ...blurRegion, x: 24 };
function blurReply(regions = [blurRegion]) {
  const tile = (region: PhotoPreviewRegion, png: string) => ({ ...region, pixelWidth: region.width, pixelHeight: region.height, png });
  return { width: 80, height: 60, png: 'AA==', result: { unknown: { keep: true }, blurEdit: { input: { png: 'AQ==', width: 80, height: 60, pixelWidth: 80, pixelHeight: 60, vendor: 'source' }, bounds: [0, 0, 80, 60], inputTiles: regions.map(region => tile(region, 'BA==')), vendor: 'metadata' } }, tiles: regions.map(region => tile(region, 'Ag==')), originalTiles: regions.map(region => tile(region, 'Aw==')) };
}
function ExistingBlurHarness({ regions = [blurRegion], value = 15, layer = 4, index = 1, effective = 'filter.blurGallery.fieldBlur', enabled = true, automatic = false, version = 'v1', cancelable = false, omitLayer = false }: { regions?: PhotoPreviewRegion[]; value?: number; layer?: unknown; index?: unknown; effective?: string; enabled?: boolean; automatic?: boolean; version?: string; cancelable?: boolean; omitLayer?: boolean }) {
  const preview = usePhotoCommandPreview({ ...doc, version }, 'project', 'layer.smartFilter.setParams', { ...(omitLayer ? {} : { layer }), index, params: { blur: value } }, { existingBlurCommand: effective, regions, enabled, automatic, delay: 100, cancelable });
  return <div data-url={preview.url ?? ''} data-error={preview.error ?? ''}><button disabled={preview.loading} onClick={() => void preview.preview()}>Preview</button><output data-input={JSON.stringify(preview.inputTiles)} data-final={JSON.stringify(preview.tiles)} data-original={JSON.stringify(preview.originalTiles)} data-result={JSON.stringify(preview.result)}/></div>;
}
const existingRender = (props: Parameters<typeof ExistingBlurHarness>[0] = {}) => act(async () => root.render(<ExistingBlurHarness {...props}/>));
const tileURLs = (family = 'input') => JSON.parse(container.querySelector('output')!.getAttribute(`data-${family}`)!) as { url: string; x: number }[];

function OrdinarySmartBlurHarness({ regions = [blurRegion], command = 'filter.blurGallery.fieldBlur', smart = true, version = 'v1', cancelable = false }: { regions?: PhotoPreviewRegion[]; command?: string; smart?: boolean; version?: string; cancelable?: boolean }) {
  const preview = usePhotoCommandPreview({ ...doc, version }, 'project', command, { blur: 15 }, { ordinarySmartBlur: smart ? true : undefined, regions, delay: 100, cancelable });
  return <div data-url={preview.url ?? ''} data-error={preview.error ?? ''}><button disabled={preview.loading} onClick={() => void preview.preview()}>Preview</button><output data-input={JSON.stringify(preview.inputTiles)} data-final={JSON.stringify(preview.tiles)} data-original={JSON.stringify(preview.originalTiles)} data-result={JSON.stringify(preview.result)}/></div>;
}
const ordinaryRender = (props: Parameters<typeof OrdinarySmartBlurHarness>[0] = {}) => act(async () => root.render(<OrdinarySmartBlurHarness {...props}/>));
describe('ordinary Smart Blur input ownership', () => {
  it.each(['fieldBlur', 'irisBlur', 'spinBlur', 'pathBlur', 'tiltShift'])('owns source details for %s without adding a native request field', async family => {
    const response = blurReply(); native.invoke.mockResolvedValueOnce(response); await ordinaryRender({ command: `filter.blurGallery.${family}` }); await click();
    expect(native.invoke.mock.lastCall![1]).toEqual({ projectId: 'project', photoId: 'photo', version: 'v1', command: `filter.blurGallery.${family}`, params: { blur: 15 }, regions: [blurRegion] });
    expect(tileURLs()).toMatchObject([{ url: 'blob:4' }]); expect(tileURLs('original')).toMatchObject([{ url: 'blob:3' }]); expect(tileURLs('final')).toMatchObject([{ url: 'blob:2' }]);
    const result = JSON.parse(container.querySelector('output')!.getAttribute('data-result')!); expect(result.blurEdit.inputTiles).toBeUndefined(); expect(result.blurEdit.input.vendor).toBe('source'); expect(response.result.blurEdit.inputTiles).toHaveLength(1);
    await act(async () => root.render(null)); expect(new Set(revoke.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:1', 'blob:2', 'blob:3', 'blob:4']));
  });
  it.each(['missing input', 'missing tiles', 'mismatched tiles', 'oversized input', 'aggregate'] as const)('refuses %s without acquiring partial source URLs', async kind => {
    const response = blurReply(); if (kind === 'missing input') delete (response.result.blurEdit as { input?: unknown }).input;
    if (kind === 'missing tiles') delete (response.result.blurEdit as { inputTiles?: unknown }).inputTiles;
    if (kind === 'mismatched tiles') response.result.blurEdit.inputTiles[0]!.x++;
    if (kind === 'oversized input') response.result.blurEdit.input.png = 'A'.repeat(24 * 1024 * 1024 + 1);
    if (kind === 'aggregate') response.png = response.result.blurEdit.input.png = 'A'.repeat(24 * 1024 * 1024);
    native.invoke.mockResolvedValueOnce(response); await ordinaryRender(); await click(); expect(create).not.toHaveBeenCalled(); expect(tileURLs()).toEqual([]); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toMatch(/invalid|mismatched/);
  });
  it('accepts a native frame change on a regions response even when source pixels are unchanged', async () => {
    vi.useFakeTimers(); const first = { ...blurReply(), result: { ...blurReply().result, blurEdit: { ...blurReply().result.blurEdit, mode: 'source' } } }, next = { ...blurReply([movedBlurRegion]), result: { ...blurReply([movedBlurRegion]).result, blurEdit: { ...blurReply([movedBlurRegion]).result.blurEdit, mode: 'cache', bounds: [8, 6, 40, 30] } } };
    native.invoke.mockResolvedValueOnce(first).mockResolvedValueOnce(next); await ordinaryRender(); await click(); await ordinaryRender({ regions: [movedBlurRegion] }); await act(async () => vi.advanceTimersByTime(100));
    expect(container.querySelector('[data-url]')!.getAttribute('data-url')).toBe('blob:5'); expect(tileURLs()).toMatchObject([{ url: 'blob:8' }]); const result = JSON.parse(container.querySelector('output')!.getAttribute('data-result')!); expect(result.blurEdit).toMatchObject({ mode: 'cache', bounds: [8, 6, 40, 30] }); expect(revoke).toHaveBeenCalledWith('blob:1');
  });
  it('refetches disposed detail coordinates after Fit while avoiding retries for an unchanged failed region', async () => {
    vi.useFakeTimers(); native.invoke.mockResolvedValue(blurReply()); await ordinaryRender(); await click(); const old = tileURLs()[0]!.url;
    await ordinaryRender({ regions: [] }); expect(tileURLs()).toEqual([]); expect(revoke).toHaveBeenCalledWith(old); await ordinaryRender(); await act(async () => vi.advanceTimersByTime(100)); expect(native.invoke).toHaveBeenCalledTimes(2); expect(tileURLs()).toMatchObject([{ url: 'blob:7' }]);
    await ordinaryRender({ regions: [] }); native.invoke.mockRejectedValueOnce(new Error('detail retry is manual')); await ordinaryRender(); await act(async () => vi.advanceTimersByTime(100)); expect(native.invoke).toHaveBeenCalledTimes(3); await act(async () => vi.advanceTimersByTime(1000)); expect(native.invoke).toHaveBeenCalledTimes(3); expect(tileURLs()).toEqual([]); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('detail retry is manual');
  });
  it('keeps ordinary raster detail previews independent of Smart metadata', async () => {
    const response = blurReply(); delete (response as { result?: unknown }).result; native.invoke.mockResolvedValueOnce(response); await ordinaryRender({ smart: false }); await click(); expect(create).toHaveBeenCalledTimes(3); expect(tileURLs()).toEqual([]); expect(tileURLs('final')).toHaveLength(1); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toBe('');
  });
  it('refuses the optional Smart route for a command outside the five Gallery filters', async () => {
    await ordinaryRender({ command: 'filter.cameraRaw', regions: [] }); await click(); expect(native.invoke).not.toHaveBeenCalled(); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('only for Blur Gallery');
  });
  it('discards stale input regions and preserves the exact seven-field cancellation payload', async () => {
    let finish!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({}); await ordinaryRender({ cancelable: true }); await click(); const request = native.invoke.mock.calls[0]![1]; await ordinaryRender({ cancelable: true, version: 'v2' }); expect(native.invoke.mock.lastCall![1]).toEqual({ projectId: 'project', photoId: 'photo', version: 'v1', command: 'filter.blurGallery.fieldBlur', params: {}, requestId: request.requestId, cancel: true }); await act(async () => finish(blurReply())); expect(create).not.toHaveBeenCalled(); expect(tileURLs()).toEqual([]);
  });
});

describe('source-aware existing Blur detail previews', () => {
  it('owns a distinct source-input tile family and excludes raw tile transport from retained base metadata', async () => {
    const response = blurReply(); native.invoke.mockResolvedValue(response); await existingRender(); await click();
    expect(native.invoke).toHaveBeenCalledWith('xdesign_photo_command_preview', { projectId: 'project', photoId: 'photo', version: 'v1', command: 'layer.smartFilter.setParams', params: { layer: 4, index: 1, params: { blur: 15 } }, regions: [blurRegion] });
    expect(tileURLs()).toMatchObject([{ x: 0, url: 'blob:4' }]); expect(tileURLs('final')).toMatchObject([{ url: 'blob:2' }]); expect(tileURLs('original')).toMatchObject([{ url: 'blob:3' }]);
    const result = JSON.parse(container.querySelector('output')!.getAttribute('data-result')!); expect(result.blurEdit.inputTiles).toBeUndefined(); expect(result.blurEdit.input.vendor).toBe('source'); expect(result.unknown).toEqual({ keep: true }); expect(result.blurEdit.vendor).toBe('metadata'); expect(response.result.blurEdit.inputTiles).toHaveLength(1);
    await act(async () => root.render(null)); expect(new Set(revoke.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:1', 'blob:2', 'blob:3', 'blob:4']));
  });

  it('revokes all old tile families on pan, preserves the base, and releases the new source tiles on fit', async () => {
    vi.useFakeTimers(); native.invoke.mockResolvedValueOnce(blurReply()).mockResolvedValueOnce(blurReply([movedBlurRegion])); await existingRender(); await click(); await existingRender({ regions: [movedBlurRegion] }); expect(tileURLs()).toEqual([]); for (const url of ['blob:2', 'blob:3', 'blob:4']) expect(revoke).toHaveBeenCalledWith(url); expect(revoke).not.toHaveBeenCalledWith('blob:1');
    await act(async () => vi.advanceTimersByTime(100)); expect(tileURLs()).toMatchObject([{ x: 24, url: 'blob:7' }]); expect(container.querySelector('[data-url]')!.getAttribute('data-url')).toBe('blob:1'); await existingRender({ regions: [] }); for (const url of ['blob:5', 'blob:6', 'blob:7']) expect(revoke).toHaveBeenCalledWith(url); expect(tileURLs()).toEqual([]); expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it.each(['params', 'target', 'effective', 'disable', 'version'] as const)('releases source detail ownership on a %s change and refuses stale replies', async change => {
    vi.useFakeTimers(); native.invoke.mockResolvedValueOnce(blurReply()); await existingRender({ automatic: true }); await click(); const props = change === 'params' ? { value: 25 } : change === 'target' ? { layer: 9 } : change === 'effective' ? { effective: 'filter.blurGallery.spinBlur' } : change === 'disable' ? { enabled: false } : { version: 'v2' }; await existingRender({ automatic: true, ...props }); expect(tileURLs()).toEqual([]); expect(revoke).toHaveBeenCalledWith('blob:4');
    let finish!: (value: unknown) => void; native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); await existingRender(); await click(); await existingRender({ version: 'changed' }); await act(async () => finish(blurReply())); expect(create).toHaveBeenCalledTimes(4);
  });

  it.each(['missing', 'mismatch', 'pixel dimensions', 'invalid base64', 'oversized tile', 'missing input'] as const)('rejects %s source tiles before publishing partial URLs', async kind => {
    const response = blurReply(); if (kind === 'missing') delete (response.result.blurEdit as { inputTiles?: unknown }).inputTiles; if (kind === 'mismatch') response.result.blurEdit.inputTiles[0]!.x++; if (kind === 'pixel dimensions') response.result.blurEdit.inputTiles[0]!.pixelWidth--; if (kind === 'invalid base64') response.result.blurEdit.inputTiles[0]!.png = '%%%'; if (kind === 'oversized tile') response.result.blurEdit.inputTiles[0]!.png = 'A'.repeat(2 * 1024 * 1024 + 1); if (kind === 'missing input') delete (response.result.blurEdit as { input?: unknown }).input; native.invoke.mockResolvedValueOnce(response); await existingRender(); await click(); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toMatch(/invalid|mismatched/); expect(create).not.toHaveBeenCalled(); expect(tileURLs()).toEqual([]);
  });

  it('preflights the shared encoded budget including source base and all three tile families before decoding details', async () => {
    const response = blurReply(); response.png = 'A'.repeat(24 * 1024 * 1024); response.result.blurEdit.input.png = 'A'.repeat(24 * 1024 * 1024); native.invoke.mockResolvedValueOnce(response); const decode = vi.spyOn(globalThis, 'atob').mockReturnValue('\0'); await existingRender(); await click(); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('invalid image data'); expect(decode).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled(); decode.mockRestore();
  });

  it('unwinds source URLs already allocated when a later source tile allocation fails', async () => {
    native.invoke.mockResolvedValueOnce(blurReply([blurRegion, movedBlurRegion])); create.mockImplementation(() => { if (create.mock.calls.length === 7) throw new Error('source URL failure'); return `blob:${create.mock.calls.length}`; }); await existingRender({ regions: [blurRegion, movedBlurRegion] }); await click(); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('source URL failure'); expect(tileURLs()).toEqual([]); expect(new Set(revoke.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:1', 'blob:2', 'blob:3', 'blob:4', 'blob:5', 'blob:6']));
  });

  it.each([{ omitLayer: true }, { layer: null }, { index: -1 }, { index: .5 }, { effective: 'filter.cameraRaw' }])('requires an exact explicit existing Gallery target %j', async props => {
    await existingRender(props); await click(); expect(native.invoke).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(container.querySelector('[data-error]')!.getAttribute('data-error')).toContain('explicit layer');
  });

  it('preflights obsolete region replies without decoding or owning their input tiles, then renders the newest draft', async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void; native.invoke.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(blurReply([movedBlurRegion])); await existingRender(); await click(); await existingRender({ regions: [movedBlurRegion] }); const decode = vi.spyOn(globalThis, 'atob'); await act(async () => finish(blurReply())); expect(decode).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce(); expect(tileURLs()).toEqual([]); await act(async () => vi.advanceTimersByTime(100)); expect(tileURLs()).toMatchObject([{ x: 24 }]); expect(native.invoke.mock.lastCall![1].params.params.blur).toBe(15); decode.mockRestore();
  });

  it('coalesces live draft and pan changes into the latest explicit source-aware request', async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async (_id, args) => blurReply(args.regions)); await existingRender({ automatic: true }); await act(async () => vi.advanceTimersByTime(100)); await existingRender({ automatic: true, value: 25, regions: [movedBlurRegion] }); await existingRender({ automatic: true, value: 35, regions: [movedBlurRegion] }); await act(async () => vi.advanceTimersByTime(500)); expect(native.invoke).toHaveBeenCalledOnce(); await act(async () => finish(blurReply())); expect(create).toHaveBeenCalledOnce(); expect(tileURLs()).toEqual([]); await act(async () => vi.advanceTimersByTime(100)); expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.invoke.mock.lastCall![1]).toMatchObject({ command: 'layer.smartFilter.setParams', params: { layer: 4, index: 1, params: { blur: 35 } }, regions: [movedBlurRegion] }); expect(tileURLs()).toMatchObject([{ x: 24 }]);
  });

  it('retains the exact seven-field native cancellation envelope for an existing Blur source change', async () => {
    let finish!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({}); await existingRender({ cancelable: true }); await click(); const request = native.invoke.mock.calls[0]![1]; await existingRender({ cancelable: true, version: 'v2' }); expect(native.invoke.mock.lastCall![1]).toEqual({ projectId: 'project', photoId: 'photo', version: 'v1', command: 'layer.smartFilter.setParams', params: {}, requestId: request.requestId, cancel: true }); await act(async () => finish(blurReply())); expect(create).not.toHaveBeenCalled();
  });

  it('refreshes base pixels and source metadata together when current detail input content changes', async () => {
    vi.useFakeTimers(); const response = blurReply([movedBlurRegion]); response.result.blurEdit.input.png = 'BQ=='; native.invoke.mockResolvedValueOnce(blurReply()).mockResolvedValueOnce(response); await existingRender(); await click(); await existingRender({ regions: [movedBlurRegion] }); await act(async () => vi.advanceTimersByTime(100)); expect(container.querySelector('[data-url]')!.getAttribute('data-url')).toBe('blob:5'); expect(tileURLs()).toMatchObject([{ url: 'blob:8' }]); expect(revoke).toHaveBeenCalledWith('blob:1'); const result = JSON.parse(container.querySelector('output')!.getAttribute('data-result')!); expect(result.blurEdit.input.png).toBe('BQ=='); expect(result.blurEdit.inputTiles).toBeUndefined();
  });

  it('preflights an obsolete oversized detail response without replacing the current base or allocating nested images', async () => {
    vi.useFakeTimers(); native.invoke.mockResolvedValueOnce(blurReply()); await existingRender(); await click(); let finish!: (value: unknown) => void; native.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await existingRender({ regions: [movedBlurRegion] }); await act(async () => vi.advanceTimersByTime(100)); const latest = { ...blurRegion, x: 48 }; await existingRender({ regions: [latest] }); const oversized = blurReply([movedBlurRegion]); oversized.png = oversized.result.blurEdit.input.png = 'A'.repeat(24 * 1024 * 1024); const decode = vi.spyOn(globalThis, 'atob').mockReturnValue('\0'); await act(async () => finish(oversized)); expect(create).toHaveBeenCalledTimes(4); expect(decode).toHaveBeenCalledOnce(); expect(container.querySelector('[data-url]')!.getAttribute('data-url')).toBe('blob:1'); expect(tileURLs()).toEqual([]); decode.mockRestore();
  });
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const click=async()=>act(async()=>container.querySelector("button")!.click());
describe("unapplied image previews",()=>{
  it("forwards selection presentation separately and rejects late previews from another view",async()=>{
    let finish!:(value:unknown)=>void;native.invoke.mockReturnValueOnce(new Promise(resolve=>finish=resolve)).mockResolvedValue({width:80,height:60,png:"AA=="});await act(async()=>root.render(<Harness selectionView="mask"/>));await click();expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_command_preview",expect.objectContaining({command:"select.refineEdge",selectionView:"mask",params:{exposure:1}}));await act(async()=>root.render(<Harness selectionView="overlay"/>));await act(async()=>finish({width:80,height:60,png:"AA=="}));expect(create).not.toHaveBeenCalled();await click();expect(native.invoke.mock.lastCall![1].selectionView).toBe("overlay");expect(create).toHaveBeenCalledOnce();await act(async()=>root.render(<Harness selectionView="result"/>));expect(revoke).toHaveBeenCalledWith("blob:1");
  });
  it("pins preview pixels to the channel/mask view even when the image version stays the same",async()=>{
    let finish!:(value:unknown)=>void;native.invoke.mockReturnValueOnce(new Promise(resolve=>finish=resolve)).mockResolvedValue({width:80,height:60,png:"AA=="});
    await act(async()=>root.render(<Harness viewKey="mask"/>));await click();expect(native.invoke.mock.lastCall![1]).toMatchObject({viewKey:"mask"});
    await act(async()=>root.render(<Harness viewKey="alpha"/>));await act(async()=>finish({width:80,height:60,png:"AA=="}));expect(create).not.toHaveBeenCalled();
    await click();expect(create).toHaveBeenCalledOnce();await act(async()=>root.render(<Harness viewKey="mask"/>));expect(revoke).toHaveBeenCalledWith("blob:1");
  });
  it("requests the pinned native version and revokes previews when settings change or close",async()=>{
    native.invoke.mockResolvedValue({width:80,height:60,png:"AA=="});await render();await click();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview",{projectId:"project",photoId:"photo",version:"v1",command:"filter.cameraRaw",params:{exposure:1}});
    expect(container.querySelector("[data-url]")?.getAttribute("data-url")).toBe("blob:1");
    await render(2);expect(revoke).toHaveBeenCalledWith("blob:1");await click();
    act(()=>root.unmount());expect(revoke).toHaveBeenCalledWith("blob:2");root=createRoot(container);
  });
  it("rejects late pixels after settings or document versions change, with one request in flight",async()=>{
    let finish!:(value:unknown)=>void;native.invoke.mockReturnValue(new Promise(resolve=>finish=resolve));await render();await click();
    await click();expect(native.invoke).toHaveBeenCalledOnce();await render(2,"v2");
    await act(async()=>finish({width:80,height:60,png:"AA=="}));expect(create).not.toHaveBeenCalled();
    expect(container.querySelector("button")?.disabled).toBe(false);
  });
  it("discards results after closing without allocating image URLs",async()=>{
    let finish!:(value:unknown)=>void;native.invoke.mockReturnValue(new Promise(resolve=>finish=resolve));await render();await click();
    act(()=>root.unmount());root=createRoot(container);await act(async()=>finish({width:80,height:60,png:"AA=="}));expect(create).not.toHaveBeenCalled();
  });
  it("reports malformed data and failed native renders, then allows retry",async()=>{
    native.invoke.mockResolvedValueOnce({width:3000,height:60,png:"AA=="}).mockRejectedValueOnce(new Error("Unsupported input")).mockResolvedValue({width:80,height:60,png:"AA=="});
    await render();await click();expect(container.textContent).toContain("Preview");expect(container.querySelector("[data-error]")?.getAttribute("data-error")).toContain("invalid image data");
    await click();expect(container.querySelector("[data-error]")?.getAttribute("data-error")).toContain("Unsupported input");await click();expect(create).toHaveBeenCalledOnce();
  });
  it("coalesces live controls, keeps an older frame as stale and renders the newest straight after it",async()=>{
    vi.useFakeTimers();let finish!:(value:unknown)=>void;
    native.invoke.mockReturnValueOnce(new Promise(resolve=>finish=resolve)).mockResolvedValue({width:80,height:60,png:"AA=="});
    await act(async()=>root.render(<Harness automatic/>));
    await act(async()=>vi.advanceTimersByTime(100));expect(native.invoke).toHaveBeenCalledOnce();
    await act(async()=>root.render(<Harness automatic exposure={2}/>));await act(async()=>root.render(<Harness automatic exposure={3}/>));
    await act(async()=>vi.advanceTimersByTime(500));expect(native.invoke).toHaveBeenCalledOnce();
    await act(async()=>finish({width:80,height:60,png:"AA=="}));expect(create).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-url]")?.getAttribute("data-url")).toBe("blob:1");expect(container.querySelector("[data-stale]")?.getAttribute("data-stale")).toBe("true");
    await act(async()=>vi.advanceTimersByTime(0));expect(native.invoke).toHaveBeenCalledTimes(2);expect(native.invoke.mock.calls[1]![1].params).toEqual({exposure:3});expect(create).toHaveBeenCalledTimes(2);expect(revoke).toHaveBeenCalledWith("blob:1");
    await act(async()=>root.render(<Harness automatic exposure={4}/>));expect(container.querySelector("[data-url]")?.getAttribute("data-url")).toBe("blob:2");expect(container.querySelector("[data-stale]")?.getAttribute("data-stale")).toBe("true");
    await act(async()=>vi.advanceTimersByTime(100));expect(revoke).toHaveBeenCalledWith("blob:2");expect(create).toHaveBeenCalledTimes(3);
  });
  it("keeps rendering through a continuous drag instead of waiting for the controls to rest",async()=>{
    vi.useFakeTimers();native.invoke.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({width:80,height:60,png:"AA=="}),40)));
    for(let exposure=1;exposure<=20;exposure++){await act(async()=>root.render(<Harness automatic exposure={exposure}/>));await act(async()=>vi.advanceTimersByTime(16));}
    expect(native.invoke.mock.calls.map(call=>call[1].params.exposure)).toEqual([7,10,13,16,19]);expect(create).toHaveBeenCalledTimes(4);
  });
  it("does not retry a failed live render forever or render while disabled, and can resume",async()=>{
    vi.useFakeTimers();native.invoke.mockRejectedValueOnce(new Error("Render failed")).mockResolvedValue({width:80,height:60,png:"AA=="});
    await act(async()=>root.render(<Harness automatic enabled={false}/>));await act(async()=>vi.advanceTimersByTime(500));expect(native.invoke).not.toHaveBeenCalled();
    await act(async()=>root.render(<Harness automatic/>));await act(async()=>vi.advanceTimersByTime(100));await act(async()=>vi.advanceTimersByTime(1000));expect(native.invoke).toHaveBeenCalledOnce();
    await act(async()=>root.render(<Harness automatic enabled={false}/>));await act(async()=>root.render(<Harness automatic/>));await act(async()=>vi.advanceTimersByTime(100));expect(native.invoke).toHaveBeenCalledTimes(2);expect(create).toHaveBeenCalledOnce();
    await act(async()=>root.render(<Harness automatic exposure={2}/>));act(()=>root.unmount());root=createRoot(container);await act(async()=>vi.advanceTimersByTime(1000));expect(native.invoke).toHaveBeenCalledTimes(2);
  });
});
