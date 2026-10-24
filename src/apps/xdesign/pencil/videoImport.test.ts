import { afterEach, expect, it, vi } from 'vitest';
import { prepareVideo } from './videoPaints';
afterEach(() => vi.restoreAllMocks());
it('captures a bounded poster and releases the media element and object URL after decoding', async () => {
  const video = document.createElement('video'), canvas = document.createElement('canvas');
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 }, duration: { value: 6 } });
  const load = vi.spyOn(video, 'load').mockImplementation(() => { if (video.hasAttribute('src')) video.dispatchEvent(new Event('loadeddata')); }), pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  const draw = vi.fn(); vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage: draw } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
  const poster = new Blob(['png']); Object.defineProperty(poster, 'arrayBuffer', { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(poster));
  const create = document.createElement.bind(document); vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'video' ? video : tag === 'canvas' ? canvas : create(tag)) as typeof document.createElement);
  const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const file = new File(['clip'], 'clip.mp4'); Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3, 4]).buffer });
  const result = await prepareVideo(file); expect(result).toMatchObject({ width: 1920, height: 1080, duration: 6, mime: 'video/mp4' });
  expect(canvas.width).toBe(1280); expect(canvas.height).toBe(720); expect(draw).toHaveBeenCalled(); expect(pause).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledTimes(2); expect(video.hasAttribute('src')).toBe(false); expect(url).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:test');
});
it('rejects over-budget input without creating a decoder or reading bytes', async () => {
  const file = new File(['small'], 'clip.webm'); Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
  const create = vi.spyOn(document, 'createElement'); await expect(prepareVideo(file)).rejects.toThrow('8 MB'); expect(create).not.toHaveBeenCalled();
});
