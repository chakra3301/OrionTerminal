import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ulid } from "ulid";
import type { PhotoDocument } from "./types";
import { channelWorkspaceRequired } from "./channelSources";
import type { SelectionPreviewView } from "./selectionSettings";

export type PhotoPreviewRegion = { x: number; y: number; width: number; height: number; scale: number };
export type PhotoPreviewImageTile = PhotoPreviewRegion & { pixelWidth: number; pixelHeight: number; url: string };
type PhotoPreviewImageReply = PhotoPreviewRegion & { pixelWidth: number; pixelHeight: number; png: string };
type PhotoCommandPreviewReply = { width: number; height: number; png: string; result?: unknown; tiles?: PhotoPreviewImageReply[]; originalTiles?: PhotoPreviewImageReply[] };
type PreviewIdentity = { key: string; identity: string; regionsKey: string; regions: PhotoPreviewRegion[] };
type OwnedTile = Omit<PhotoPreviewImageTile, "url"> & { url: string };
type OwnedDetails = { key: string; regionsKey: string; tiles: OwnedTile[]; originalTiles: OwnedTile[]; inputTiles: OwnedTile[] };
type OwnedBase = { key: string; identity: string; url: string; result: unknown };
type ActiveCancelableRequest = { requestId: string; args: Record<string, unknown>; key: string; identity: string; cancelSent: boolean };
const regionPreviewCommands = new Set(["filter.blurGallery.fieldBlur", "filter.blurGallery.irisBlur", "filter.blurGallery.spinBlur", "filter.blurGallery.pathBlur", "filter.blurGallery.tiltShift"]);

function regionKey(regions: readonly PhotoPreviewRegion[]) { return JSON.stringify(regions); }

function regionRequestKey(key: string, regionsKey: string) { return JSON.stringify([key, regionsKey]); }

function validateRegions(regions: readonly PhotoPreviewRegion[], sourceWidth: number, sourceHeight: number) {
  if (![sourceWidth, sourceHeight].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff)) return false;
  if (regions.length > 8) return false;
  let pixels = 0;
  for (const region of regions) {
    if (![region.x, region.y, region.width, region.height, region.scale].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff) || region.width <= 0 || region.height <= 0 || region.x + region.width > sourceWidth || region.y + region.height > sourceHeight || region.scale < 1 || region.scale > 64 || (region.scale & (region.scale - 1)) !== 0) return false;
    const width = Math.ceil(region.width / region.scale), height = Math.ceil(region.height / region.scale);
    if (width < 1 || height < 1 || width > 512 || height > 512) return false;
    pixels += width * height;
  }
  return pixels <= 2_097_152;
}

function decodePNG(png: unknown, maximum: number) {
  if (typeof png !== "string" || png.length < 1 || png.length > maximum) throw new Error("The preview returned invalid image data.");
  try { return Uint8Array.from(atob(png), character => character.charCodeAt(0)); }
  catch { throw new Error("The preview returned invalid image data."); }
}

function validBase(reply: PhotoCommandPreviewReply) {
  if (!Number.isInteger(reply.width) || !Number.isInteger(reply.height) || reply.width < 1 || reply.height < 1 || reply.width > 2048 || reply.height > 2048) throw new Error("The preview returned invalid image data.");
  return decodePNG(reply.png, 24 * 1024 * 1024);
}

function validTiles(reply: PhotoCommandPreviewReply, regions: readonly PhotoPreviewRegion[], existingBlur = false, decodeDetails = true) {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const blur = record(record(reply.result).blurEdit), sourcePNG = record(blur.input).png, inputs = blur.inputTiles as PhotoPreviewImageReply[] | undefined;
  if (existingBlur && (typeof sourcePNG !== 'string' || !sourcePNG.length || sourcePNG.length > 24 * 1024 * 1024)) throw new Error('The preview returned invalid filter input data.');
  let total = reply.png.length + (existingBlur ? (sourcePNG as string).length : 0);
  if (!regions.length) {
    if (reply.tiles !== undefined || reply.originalTiles !== undefined || existingBlur && inputs !== undefined && (!Array.isArray(inputs) || inputs.length)) throw new Error("The preview returned invalid region data.");
    if (total > 48 * 1024 * 1024) throw new Error('The preview returned invalid image data.');
    if (existingBlur && decodeDetails) decodePNG(sourcePNG, 24 * 1024 * 1024);
    return { tiles: [] as Uint8Array[], originals: [] as Uint8Array[], inputs: [] as Uint8Array[] };
  }
  if (!Array.isArray(reply.tiles) || !Array.isArray(reply.originalTiles) || reply.tiles.length !== regions.length || reply.originalTiles.length !== regions.length) throw new Error("The preview returned invalid region data.");
  if (existingBlur && (!Array.isArray(inputs) || inputs.length !== regions.length)) throw new Error('The preview returned invalid filter input regions.');
  const validate = (tile: PhotoPreviewImageReply, region: PhotoPreviewRegion) => {
    if (!tile || tile.x !== region.x || tile.y !== region.y || tile.width !== region.width || tile.height !== region.height || tile.scale !== region.scale || tile.pixelWidth !== Math.ceil(region.width / region.scale) || tile.pixelHeight !== Math.ceil(region.height / region.scale)) throw new Error("The preview returned mismatched region data.");
    if (typeof tile.png !== "string" || tile.png.length < 1 || tile.png.length > 2 * 1024 * 1024) throw new Error("The preview returned invalid region data.");
    total += tile.png.length;
  };
  regions.forEach((region, index) => { validate(reply.tiles![index]!, region); validate(reply.originalTiles![index]!, region); if (existingBlur) validate(inputs![index]!, region); });
  if (total > 48 * 1024 * 1024) throw new Error("The preview returned invalid image data.");
  if (!decodeDetails) return { tiles: [] as Uint8Array[], originals: [] as Uint8Array[], inputs: [] as Uint8Array[] };
  if (existingBlur) decodePNG(sourcePNG, 24 * 1024 * 1024);
  const tiles = reply.tiles.map(tile => decodePNG(tile.png, 2 * 1024 * 1024));
  const originals = reply.originalTiles.map(tile => decodePNG(tile.png, 2 * 1024 * 1024));
  return { tiles, originals, inputs: existingBlur ? inputs!.map(tile => decodePNG(tile.png, 2 * 1024 * 1024)) : [] };
}

function imageURL(bytes: Uint8Array) { return URL.createObjectURL(new Blob([bytes], { type: "image/png" })); }
function storedResult(value: unknown, existingBlur: boolean) {
  if (!existingBlur || !value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  const result = value as Record<string, unknown>, metadata = { ...result.blurEdit as Record<string, unknown> }; delete metadata.inputTiles;
  return { ...result, blurEdit: metadata };
}
function filterInputPNG(value: unknown) {
  return (value as { blurEdit?: { input?: { png?: unknown } } } | null)?.blurEdit?.input?.png;
}
function filterInputFrame(value: unknown) {
  const metadata = (value as { blurEdit?: { mode?: unknown; bounds?: unknown } } | null)?.blurEdit;
  return JSON.stringify([metadata?.mode, metadata?.bounds]);
}

/** Serial rendering with coalesced controls; previews never commit an image version. */
export function usePhotoCommandPreview(document:PhotoDocument,projectId:string|null,command:string,params:Record<string,unknown>,options:{automatic?:boolean;enabled?:boolean;delay?:number;viewKey?:string;selectionView?:SelectionPreviewView;regions?:readonly PhotoPreviewRegion[];cancelable?:boolean;existingBlurCommand?:string;ordinarySmartBlur?:boolean}={}) {
  const automatic = options.automatic ?? false, enabled = options.enabled ?? true, delay = options.delay ?? 100;
  const cancelable = options.cancelable ?? false;
  const existingBlur = command === 'layer.smartFilter.setParams' && regionPreviewCommands.has(options.existingBlurCommand ?? '') && Number.isSafeInteger(params.layer) && Number(params.layer) >= 0 && Number.isSafeInteger(params.index) && Number(params.index) >= 0;
  const ordinarySmartBlur = options.ordinarySmartBlur === true && regionPreviewCommands.has(command), sourceAwareBlur = existingBlur || ordinarySmartBlur;
  const availability = useRef({ enabled, generation: 0 });
  if (availability.current.enabled !== enabled) availability.current = { enabled, generation: availability.current.generation + 1 };
  const regions = (options.regions ?? []).map(region => ({ x: region.x, y: region.y, width: region.width, height: region.height, scale: region.scale }));
  const identity = JSON.stringify([projectId, document.id, document.version, document.width, document.height, command, options.viewKey, options.selectionView, availability.current.generation, cancelable, ...(options.existingBlurCommand === undefined ? [] : [[options.existingBlurCommand, params.layer, params.index]]), ...(options.ordinarySmartBlur === undefined ? [] : [options.ordinarySmartBlur])]);
  const key = JSON.stringify([identity, params]);
  const regionsKey = regionKey(regions);
  const input = { key, identity, regionsKey, regions } satisfies PreviewIdentity;
  const current = useRef(input); current.current = input;
  const currentEnabled = useRef(enabled); currentEnabled.current = enabled;
  const currentAutomatic = useRef(automatic); currentAutomatic.current = automatic;
  const mounted = useRef(true), pending = useRef(false), manualQueued = useRef(false), timer = useRef<number | null>(null);
  const activeCancelable = useRef<ActiveCancelableRequest | null>(null);
  const base = useRef<OwnedBase | null>(null), details = useRef<OwnedDetails | null>(null);
  const attemptedBase = useRef<string | null>(null), attemptedDetails = useRef<string | null>(null), manualApproved = useRef<string | null>(null);
  const [baseView, setBaseView] = useState<OwnedBase | null>(null), [detailView, setDetailView] = useState<OwnedDetails | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const disposeDetails = () => {
    const owned = details.current; details.current = null;
    if (owned) for (const tile of [...owned.tiles, ...owned.originalTiles, ...owned.inputTiles]) URL.revokeObjectURL(tile.url);
    setDetailView(null);
  };
  const disposeBase = () => {
    const owned = base.current; base.current = null;
    if (owned) URL.revokeObjectURL(owned.url);
    setBaseView(null);
  };

  const cancelActive = () => {
    const active = activeCancelable.current;
    if (!active || active.cancelSent) return;
    active.cancelSent = true;
    const { projectId, photoId, version, command } = active.args;
    try { void invoke("xdesign_photo_command_preview", { projectId, photoId, version, command, params: {}, requestId: active.requestId, cancel: true }).catch(() => {}); }
    catch { /* Cancellation is best-effort; stale replies are still suppressed below. */ }
  };
  const clearTimer = () => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; };

  useEffect(() => {
    const active = activeCancelable.current;
    // A live drag changes settings faster than renders finish; cancelling each one would leave the canvas without a frame until the pointer stops.
    if (active && (active.identity !== identity || !automatic && active.key !== key)) cancelActive();
    const existing = base.current;
    if (!enabled || existing && (existing.identity !== identity || !automatic && existing.key !== key)) disposeBase();
    const detail = details.current;
    if (!enabled || !regions.length || detail && (detail.key !== key || detail.regionsKey !== regionsKey)) { disposeDetails(); attemptedDetails.current = null; }
    if (!enabled || !automatic && existing?.key !== key) { attemptedBase.current = null; attemptedDetails.current = null; }
    setError(null);
  }, [key, identity, regionsKey, enabled, automatic]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimer(); cancelActive(); const b = base.current; base.current = null; if (b) URL.revokeObjectURL(b.url); const d = details.current; details.current = null; if (d) for (const tile of [...d.tiles, ...d.originalTiles, ...d.inputTiles]) URL.revokeObjectURL(tile.url); }; }, []);

  const start = async (mode: "manual" | "automatic" | "regions", request: PreviewIdentity) => {
    if (pending.current) { if (mode === "manual") manualQueued.current = true; return; }
    if (!projectId || !currentEnabled.current) return;
    if (options.existingBlurCommand !== undefined && !existingBlur) { setError('Existing Blur preview needs an explicit layer, filter index and supported command.'); return; }
    if (options.ordinarySmartBlur === true && !ordinarySmartBlur) { setError('Smart Blur input is available only for Blur Gallery commands.'); return; }
    if (request.regions.length && (!regionPreviewCommands.has(command) && !existingBlur || !validateRegions(request.regions, document.width, document.height))) {
      if (mode === "automatic") attemptedBase.current = regionRequestKey(request.key, request.regionsKey);
      attemptedDetails.current = regionRequestKey(request.key, request.regionsKey);
      if (mounted.current) setError("The preview regions are invalid or exceed the native preview budget.");
      return;
    }
    pending.current = true; setLoading(true); setError(null);
    if (mode === "automatic") attemptedBase.current = regionRequestKey(request.key, request.regionsKey);
    attemptedDetails.current = regionRequestKey(request.key, request.regionsKey);
    try {
      const workspace = channelWorkspaceRequired(command, params);
      const requestId = cancelable && !workspace ? ulid() : undefined;
      const args = { projectId, photoId: document.id, version: document.version, command, params, ...(workspace ? { preview: true } : {}), ...(options.viewKey ? { viewKey: options.viewKey } : {}), ...(options.selectionView ? { selectionView: options.selectionView } : {}), ...(request.regions.length && !workspace ? { regions: request.regions } : {}), ...(requestId ? { requestId } : {}) };
      activeCancelable.current = requestId ? { requestId, args, key: request.key, identity: request.identity, cancelSent: false } : null;
      const reply = await invoke<PhotoCommandPreviewReply>(workspace ? "xdesign_photo_channel_operation" : "xdesign_photo_command_preview", args);
      // While live, an older frame is still the closest picture of the drag; it shows as stale until the newest settings render.
      const usable = () => mounted.current && currentEnabled.current && current.current.identity === request.identity && (current.current.key === request.key || mode === "automatic" && currentAutomatic.current);
      if (!usable()) return;
      const superseded = current.current.key !== request.key;
      const baseBytes = validBase(reply), currentRegions = current.current.regionsKey === request.regionsKey;
      const decoded = currentRegions || sourceAwareBlur ? validTiles(reply, request.regions, sourceAwareBlur, currentRegions) : { tiles: [] as Uint8Array[], originals: [] as Uint8Array[], inputs: [] as Uint8Array[] };
      const acceptDetails = request.regions.length > 0 && currentRegions && !superseded;
      const create: string[] = [];
      try {
        let nextBase: OwnedBase | null = null;
        const changedInput = sourceAwareBlur && currentRegions && mode === 'regions' && base.current?.key === request.key && (filterInputPNG(base.current.result) !== filterInputPNG(reply.result) || filterInputFrame(base.current.result) !== filterInputFrame(reply.result));
        if (mode !== "regions" || changedInput) nextBase = { key: request.key, identity: request.identity, url: imageURL(baseBytes), result: storedResult(reply.result, sourceAwareBlur) }, create.push(nextBase.url);
        let nextDetails: OwnedDetails | null = null;
        if (acceptDetails) {
          const make = (tiles: Uint8Array[]) => tiles.map((bytes, index) => {
            const url = imageURL(bytes); create.push(url);
            return { ...request.regions[index]!, pixelWidth: Math.ceil(request.regions[index]!.width / request.regions[index]!.scale), pixelHeight: Math.ceil(request.regions[index]!.height / request.regions[index]!.scale), url };
          });
          const tiles = make(decoded.tiles);
          const originalTiles = make(decoded.originals);
          nextDetails = { key: request.key, regionsKey: request.regionsKey, tiles, originalTiles, inputTiles: make(decoded.inputs) };
        }
        if (!usable()) { for (const url of create) URL.revokeObjectURL(url); return; }
        if (nextBase) { const old = base.current; base.current = nextBase; setBaseView(nextBase); if (old) URL.revokeObjectURL(old.url); }
        if (mode !== "regions" || acceptDetails) disposeDetails();
        if (nextDetails) { details.current = nextDetails; setDetailView(nextDetails); }
        if (mode !== "regions") manualApproved.current = mode === "manual" ? request.key : manualApproved.current;
        if (acceptDetails) attemptedDetails.current = regionRequestKey(request.key, request.regionsKey);
      } catch (allocationError) { for (const url of create) URL.revokeObjectURL(url); throw allocationError; }
    } catch (failure) { if (mounted.current && current.current.key === request.key && current.current.identity === request.identity && current.current.regionsKey === request.regionsKey) setError(String(failure)); }
    finally {
      if (activeCancelable.current?.key === request.key && activeCancelable.current.identity === request.identity) activeCancelable.current = null;
      pending.current = false;
      if (mounted.current) setLoading(false);
      if (manualQueued.current && mounted.current && currentEnabled.current) { manualQueued.current = false; queueMicrotask(() => { void latestManual.current(); }); }
      // Settings that changed during the render go out straight away, so a drag renders back to back.
      if (mounted.current) schedule(0);
    }
  };
  const latestManual = useRef<() => Promise<void>>(async () => {});
  latestManual.current = async () => start("manual", current.current);
  const preview = () => latestManual.current();

  const wanted = (): "automatic" | "regions" | null => {
    if (!currentEnabled.current || !projectId || pending.current) return null;
    const request = current.current, requestKey = regionRequestKey(request.key, request.regionsKey);
    const hasCurrentBase = base.current?.identity === request.identity && base.current.key === request.key;
    if (automatic && !hasCurrentBase && attemptedBase.current !== requestKey) return "automatic";
    return hasCurrentBase && request.regions.length > 0 && (automatic || manualApproved.current === request.key) && attemptedDetails.current !== requestKey ? "regions" : null;
  };
  const latestRun = useRef({ wanted, start }); latestRun.current = { wanted, start };
  // A throttle, not a debounce: further changes keep the pending timer, which renders whatever is newest when it fires.
  const schedule = (wait: number) => {
    if (timer.current !== null || !latestRun.current.wanted()) return;
    timer.current = window.setTimeout(() => { timer.current = null; const mode = latestRun.current.wanted(); if (mode) void latestRun.current.start(mode, current.current); }, wait);
  };
  useEffect(() => {
    if (!enabled || !projectId) { clearTimer(); return; }
    schedule(Math.max(100, delay));
  }, [automatic, enabled, projectId, key, regionsKey, regions.length, delay]);

  const currentBase = baseView;
  const baseVisible = enabled && currentBase?.identity === identity && (currentBase.key === key || automatic);
  const currentDetails = detailView;
  const detailVisible = enabled && !!regions.length && currentDetails?.key === key && currentDetails.regionsKey === regionsKey;
  return { url: baseVisible ? currentBase!.url : null, current: baseVisible && currentBase!.key === key, result: baseVisible && currentBase!.key === key ? currentBase!.result : null, tiles: detailVisible ? currentDetails!.tiles : [], originalTiles: detailVisible ? currentDetails!.originalTiles : [], inputTiles: detailVisible ? currentDetails!.inputTiles : [], loading, error, preview, stale: !!(baseVisible && currentBase!.key !== key) };
}
