import { SkiaRenderer } from '@open-pencil/core/canvas';
import { computeImageHash, type Fill, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { Editor } from '@open-pencil/core/editor';
import { designPaintSource } from './proceduralPaints';

export type VideoAsset = { videoHash: string; posterHash: string; mime: 'video/mp4' | 'video/webm' | 'video/ogg'; name: string; width: number; height: number; duration: number; autoplay: boolean; loop: boolean; muted: boolean; controls: boolean };
export type PreparedVideo = Omit<VideoAsset, 'videoHash' | 'posterHash' | 'autoplay' | 'loop' | 'muted' | 'controls'> & { bytes: Uint8Array; poster: Uint8Array };
const PLUGIN = 'orion.xdesign', KEY = 'videoResources';
export const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const mimeFor = (file: Pick<File, 'name' | 'type'>) => ({ mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg' } as Record<string, string>)[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? file.type;
export function isVideoFile(file: Pick<File, 'name' | 'type'>) { return ['video/mp4', 'video/webm', 'video/ogg'].includes(mimeFor(file)); }
export function videoAssets(node: SceneNode): VideoAsset[] {
  const raw = node.pluginData.find(entry => entry.pluginId === PLUGIN && entry.key === KEY)?.value;
  if (!raw || raw.length > 64 * 1024) return [];
  try {
    const values: unknown = JSON.parse(raw); if (!Array.isArray(values) || values.length > 128) return [];
    return values.filter((value): value is VideoAsset => value && typeof value === 'object' &&
      [value.videoHash, value.posterHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{1,128}$/i.test(hash)) &&
      ['video/mp4', 'video/webm', 'video/ogg'].includes(value.mime) && typeof value.name === 'string' && value.name.length <= 512 &&
      [value.width, value.height, value.duration].every(number => typeof number === 'number' && Number.isFinite(number) && number > 0) &&
      value.width * value.height <= 16_000_000 && value.duration <= 3600 &&
      ['autoplay', 'loop', 'muted', 'controls'].every(key => typeof value[key] === 'boolean'));
  } catch { return []; }
}
export function videoAsset(node: SceneNode, fill: Fill) { return videoAssets(node).find(asset => asset.posterHash === fill.imageHash); }
export function videoResourceHashes(nodes: Iterable<SceneNode>) {
  const hashes = new Set<string>();
  for (const node of nodes) for (const fill of node.fills) if (fill.type === 'VIDEO') {
    const asset = videoAsset(node, fill); if (fill.imageHash) hashes.add(fill.imageHash); if (asset) hashes.add(asset.videoHash);
  }
  return hashes;
}
export function copyVideoResources(source: SceneGraph, target: SceneGraph, nodes: Iterable<SceneNode> = target.nodes.values()) {
  for (const hash of videoResourceHashes(nodes)) { const bytes = source.images.get(hash); if (!bytes) throw new Error('A video resource is missing. Restore it before copying this design.'); target.images.set(hash, bytes); }
}
export function videoDataUrl(bytes: Uint8Array, mime: string) {
  let binary = ''; for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export function updateVideoAsset(editor: Editor, node: SceneNode, asset: VideoAsset, patch: Partial<Pick<VideoAsset, 'autoplay' | 'loop' | 'muted' | 'controls'>>) {
  const assets = videoAssets(node).map(current => current.posterHash === asset.posterHash ? { ...current, ...patch, autoplay: patch.muted === false ? false : patch.autoplay ?? current.autoplay, muted: patch.autoplay === true ? true : patch.muted ?? current.muted } : current);
  editor.updateNodeWithUndo(node.id, { pluginData: [...node.pluginData.filter(entry => !(entry.pluginId === PLUGIN && entry.key === KEY)), { pluginId: PLUGIN, key: KEY, value: JSON.stringify(assets) }] }, 'Change video playback');
}
let installed = false;
export function installVideoPaints() {
  if (installed) return; installed = true;
  const apply = SkiaRenderer.prototype.applyFill;
  SkiaRenderer.prototype.applyFill = function(fill, node, graph, index = 0) { return apply.call(this, fill.type === 'VIDEO' ? { ...fill, type: 'IMAGE' } : fill, node, fill.type === 'VIDEO' ? designPaintSource(this, graph) : graph, index); };
}
export function bakeVideoPosters(graph: SceneGraph) {
  for (const node of graph.nodes.values()) if (node.fills.some(fill => fill.type === 'VIDEO')) graph.updateNode(node.id, { fills: node.fills.map(fill => fill.type === 'VIDEO' ? { ...fill, type: 'IMAGE' } : fill) });
}

export async function prepareVideo(file: File): Promise<PreparedVideo> {
  const mime = mimeFor(file);
  if (!isVideoFile(file)) throw new Error('Choose an MP4, WebM or Ogg video supported by this device.');
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error('Video fills support files up to 8 MB.');
  const video = document.createElement('video'), url = URL.createObjectURL(file);
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('This video could not be decoded within 15 seconds.')), 15_000);
      const loaded = () => done(), failed = () => done(new Error('This video codec is not supported by this device.'));
      const done = (error?: Error) => { clearTimeout(timer); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed); if (error) reject(error); else resolve(); };
      video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed); video.src = url; video.load();
    });
    if (![video.videoWidth, video.videoHeight, video.duration].every(value => Number.isFinite(value) && value > 0) || video.videoWidth * video.videoHeight > 16_000_000 || video.duration > 3600) throw new Error('Video fills support a finite duration up to one hour and a source up to 16 megapixels.');
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('A video poster could not be created.'); context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('A video poster could not be saved.')), 'image/png'));
    return { mime: mime as PreparedVideo['mime'], name: file.name.slice(0, 512), width: video.videoWidth, height: video.videoHeight, duration: video.duration, bytes: new Uint8Array(await file.arrayBuffer()), poster: new Uint8Array(await poster.arrayBuffer()) };
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

export function placePreparedVideo(editor: Editor, prepared: PreparedVideo, x: number, y: number, parentId = editor.state.currentPageId) {
  if (!prepared.bytes.byteLength || prepared.bytes.byteLength > MAX_VIDEO_BYTES || !prepared.poster.byteLength || prepared.poster.byteLength > MAX_VIDEO_BYTES) throw new Error('The video or its poster exceeds the resource limit.');
  const videoHash = computeImageHash(prepared.bytes), posterHash = computeImageHash(prepared.poster);
  const added = new Map([[videoHash, prepared.bytes], [posterHash, prepared.poster]]);
  const total = [...editor.graph.images].reduce((bytes, [hash, data]) => bytes + (added.has(hash) ? 0 : data.byteLength), 0) + [...added.values()].reduce((bytes, data) => bytes + data.byteLength, 0);
  if (total > MAX_MEDIA_BYTES) throw new Error('This design exceeds 24 MB of embedded media.');
  const { bytes: _bytes, poster: _poster, ...settings } = prepared;
  const metadata: VideoAsset = { ...settings, videoHash, posterHash, autoplay: false, loop: false, muted: true, controls: true };
  if (!videoAssets({ pluginData: [{ pluginId: PLUGIN, key: KEY, value: JSON.stringify([metadata]) }] } as SceneNode).length) throw new Error('Invalid video dimensions, duration or media type.');
  const ratio = Math.min(1, 600 / Math.max(prepared.width, prepared.height));
  const previous = new Set(editor.state.selectedIds);
  const newHashes = [...added.keys()].filter(hash => !editor.graph.images.has(hash));
  editor.undo.beginBatch('Place video');
  try {
    for (const [hash, data] of added) editor.graph.images.set(hash, data);
    const id = editor.createShape('RECTANGLE', x, y, prepared.width * ratio, prepared.height * ratio, parentId, prepared.name);
    editor.updateNodeWithUndo(id, { fills: [{ type: 'VIDEO', imageHash: posterHash, imageScaleMode: 'FILL', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, opacity: 1 }], pluginData: [{ pluginId: PLUGIN, key: KEY, value: JSON.stringify([metadata]) }] }, 'Set video fill');
    editor.select([id]); editor.undo.commitBatch(); editor.requestRender(); return id;
  } catch (error) { editor.undo.rollbackBatch(); newHashes.forEach(hash => editor.graph.images.delete(hash)); editor.select([...previous]); throw error; }
}
