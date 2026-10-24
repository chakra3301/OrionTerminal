export type PresetPreviewRequest = { kind: 'brush'|'style'|'pattern'|'shape'; preset: string; group?: string; revision: number };
type Reply = { width: number; height: number; png: string };
type Listener = (url: string|null, error: string|null) => void;
type Job = { request: PresetPreviewRequest; listeners: Set<Listener>; running: boolean };

/** Two native renders at a time; hidden/removed cards leave the queue immediately. */
export class PresetPreviewCache {
  private cache = new Map<string, string>();
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private active = 0;
  constructor(private invoke: (request: PresetPreviewRequest) => Promise<Reply>) {}
  subscribe(request: PresetPreviewRequest, listener: Listener): () => void {
    const key = JSON.stringify(request), cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); listener(cached, null); return () => {}; }
    let job = this.jobs.get(key);
    if (!job) {
      if (this.queue.length >= 64) { listener(null, 'Preset previews are busy. Scroll back to retry.'); return () => {}; }
      job = { request, listeners: new Set(), running: false }; this.jobs.set(key, job); this.queue.push(key);
    }
    job.listeners.add(listener); this.drain();
    return () => {
      job!.listeners.delete(listener);
      if (!job!.running && !job!.listeners.size) { this.jobs.delete(key); this.queue = this.queue.filter(value => value !== key); }
    };
  }
  private drain() {
    while (this.active < 2 && this.queue.length) {
      const key = this.queue.shift()!, job = this.jobs.get(key); if (!job || !job.listeners.size) continue;
      job.running = true; this.active++;
      void Promise.resolve().then(() => this.invoke(job.request)).then(reply => {
        if (reply.width !== 96 || reply.height !== 64 || typeof reply.png !== 'string' || reply.png.length > 128 * 1024) throw new Error('Invalid preset thumbnail');
        const bytes = Uint8Array.from(atob(reply.png), char => char.charCodeAt(0));
        if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) throw new Error('Invalid preset thumbnail');
        const header = new DataView(bytes.buffer);
        if (header.getUint32(16) !== 96 || header.getUint32(20) !== 64) throw new Error('Invalid preset thumbnail dimensions');
        const url = `data:image/png;base64,${reply.png}`;
        this.cache.delete(key); this.cache.set(key, url);
        while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
        for (const listener of job.listeners) listener(url, null);
      }).catch(error => { for (const listener of job.listeners) listener(null, String(error)); })
        .finally(() => { this.jobs.delete(key); this.active--; this.drain(); });
    }
  }
}
