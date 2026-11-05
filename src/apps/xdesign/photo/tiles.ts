export const TILE_SIZE = 512;
export const TILE_CAPACITY = 64;
export type TileRect = { x: number; y: number; width: number; height: number; scale?: number; selectionOnly?: boolean; selectionOverlay?: boolean };
export type PhotoTile = TileRect & { png: string; selectionPath: string; selectionTruncated: boolean; selectionPng?: string; pixelWidth?: number; pixelHeight?: number };
export const tileKey = (tile: TileRect) => `${tile.x}/${tile.y}/${tile.scale ?? 1}/${!!tile.selectionOnly}/${!!tile.selectionOverlay}`;

/** Retain at least one native sample per device pixel, up to the source resolution. */
export function tileScale(zoom: number, pixelRatio = 1): number {
  const density = zoom * pixelRatio;
  if (!Number.isFinite(density) || density <= 0) return 1;
  return Math.min(64, 2 ** Math.max(0, Math.floor(Math.log2(1 / density))));
}

/** Whether the published preview already holds a pixel per device pixel, so tiles add no detail. */
export function previewCoversScreen(document: { width: number; height: number; previewWidth: number; previewHeight: number }, zoom: number, pixelRatio = 1): boolean {
  return document.width * zoom * pixelRatio <= document.previewWidth && document.height * zoom * pixelRatio <= document.previewHeight;
}

/** Visible document pixels, ordered nearest the viewport center first. */
export function visibleTiles(width: number, height: number, viewport: TileRect, options: Pick<TileRect, "scale" | "selectionOnly" | "selectionOverlay"> = {}): TileRect[] {
  if (![width, height, viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) ||
      width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0) return [];
  const left = Math.max(0, viewport.x), top = Math.max(0, viewport.y);
  const right = Math.min(width, viewport.x + viewport.width), bottom = Math.min(height, viewport.y + viewport.height);
  if (left >= right || top >= bottom) return [];
  const scale = options.scale ?? 1;
  if (scale < 1 || scale > 64 || !Number.isInteger(scale) || (scale & (scale - 1)) !== 0) return [];
  const edge = TILE_SIZE * scale, tiles: TileRect[] = [];
  for (let y = Math.floor(top / edge) * edge; y < bottom; y += edge) {
    for (let x = Math.floor(left / edge) * edge; x < right; x += edge) {
      tiles.push({ x, y, width: Math.min(edge, width - x), height: Math.min(edge, height - y), ...options });
    }
  }
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const distance = (tile: TileRect) => (tile.x + tile.width / 2 - cx) ** 2 + (tile.y + tile.height / 2 - cy) ** 2;
  return tiles.sort((a, b) => distance(a) - distance(b)).slice(0, TILE_CAPACITY);
}

function decodeImage(url: string) {
  const image = new Image(); image.src = url;
  return typeof image.decode === "function" ? image.decode().then(() => image, () => undefined) : undefined;
}

/** `image` is the decoded color tile; detail canvases draw it. */
export type DisplayTile = Omit<PhotoTile, "png" | "selectionPng"> & { url: string; selectionUrl?: string; image?: HTMLImageElement };
type CacheEntry = DisplayTile;
/** Two requests at a time, bounded decoded pixels, and no stale work after close/undo. */
export class PhotoTileCache {
  private entries = new Map<string, CacheEntry>();
  private requested: TileRect[] = [];
  private failed = new Set<string>();
  private pending = new Set<string>();
  private disposed = false;
  private error: string | null = null;

  constructor(
    private load: (rect: TileRect) => Promise<PhotoTile>,
    private changed: (tiles: CacheEntry[], error: string | null) => void,
    private urls: { create: (tile: PhotoTile) => string; revoke: (url: string) => void; decode?: (url: string) => Promise<unknown> | void } = {
      create: (tile: PhotoTile) => {
        const bytes = Uint8Array.from(atob(tile.png), char => char.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      },
      revoke: (url: string) => URL.revokeObjectURL(url),
      decode: decodeImage,
    },
  ) {}

  request(rects: TileRect[]) {
    if (this.disposed) return;
    this.requested = rects.slice(0, TILE_CAPACITY);
    for (const rect of this.requested) {
      const key = tileKey(rect), entry = this.entries.get(key);
      if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    }
    this.emit(null);
    this.pump();
  }

  private emit(error: string | null) {
    if (error) this.error = error;
    else if (!this.failed.size) this.error = null;
    if (!this.disposed) this.changed(this.requested.flatMap(rect => {
      const entry = this.entries.get(tileKey(rect)); return entry ? [entry] : [];
    }), this.error);
  }

  private pump() {
    if (this.disposed) return;
    for (const rect of this.requested) {
      if (this.pending.size >= 2) break;
      const key = tileKey(rect);
      if (this.entries.has(key) || this.pending.has(key) || this.failed.has(key)) continue;
      this.pending.add(key);
      void this.load(rect).then(tile => {
        if (this.disposed) return;
        if (tile.x !== rect.x || tile.y !== rect.y || tile.width !== rect.width || tile.height !== rect.height || (tile.scale ?? 1) !== (rect.scale ?? 1) ||
            (tile.pixelWidth !== undefined && tile.pixelWidth !== Math.ceil(rect.width / (rect.scale ?? 1))) ||
            (tile.pixelHeight !== undefined && tile.pixelHeight !== Math.ceil(rect.height / (rect.scale ?? 1)))) throw new Error("The image tile did not match the requested pixels");
        const url = rect.selectionOnly ? "" : this.urls.create(tile);
        let selectionUrl: string | undefined;
        try { if (tile.selectionPng) selectionUrl = this.urls.create({ ...tile, png: tile.selectionPng }); }
        catch (error) { if (url) this.urls.revoke(url); throw error; }
        const { png: _png, selectionPng: _selection, ...metadata } = tile;
        const entry: CacheEntry = { ...metadata, ...rect, url, selectionUrl }, decode = this.urls.decode;
        // Decoded before display, so swapping a tile to this URL never shows an empty frame.
        return decode ? Promise.all([url, selectionUrl].map(url => url ? decode(url) : undefined)).then(([image]) => image instanceof HTMLImageElement ? { ...entry, image } : entry) : entry;
      }).then(entry => {
        if (!entry) return;
        if (this.disposed) { this.release(entry); return; }
        this.entries.set(key, entry);
        while (this.entries.size > TILE_CAPACITY) {
          const victim = [...this.entries.keys()].find(id => !this.requested.some(rect => tileKey(rect) === id)) ?? this.entries.keys().next().value!;
          this.release(this.entries.get(victim)!); this.entries.delete(victim);
        }
        this.emit(null);
      }).catch(error => {
        if (this.disposed) return;
        this.failed.add(key);
        if (this.failed.size > TILE_CAPACITY * 2) this.failed.delete(this.failed.values().next().value!);
        this.emit(`Image detail preview failed: ${String(error)}`);
      }).finally(() => { this.pending.delete(key); this.pump(); });
    }
  }

  /** Every requested tile has arrived (or failed); 0 when nothing detailed is shown. */
  loaded(): number | null { return this.requested.every(rect => this.entries.has(tileKey(rect)) || this.failed.has(tileKey(rect))) ? this.requested.length : null; }
  retry() { this.failed.clear(); this.emit(null); this.pump(); }
  private release(tile: DisplayTile) {
    if (tile.url) this.urls.revoke(tile.url);
    if (tile.selectionUrl) this.urls.revoke(tile.selectionUrl);
  }
  /** Stop loading but keep the decoded tiles on screen until a replacement is ready. */
  retire() { this.disposed = true; }
  dispose() {
    this.disposed = true;
    for (const tile of this.entries.values()) this.release(tile);
    this.entries.clear(); this.requested = [];
  }
}
