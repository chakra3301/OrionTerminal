/** Initialize `@xenova/transformers` for the Tauri webview environment.
 *
 * Background: the library defaults to `env.allowLocalModels = true`, which
 * makes it try to fetch model files from a path relative to the current
 * page URL FIRST before falling back to the Hugging Face CDN. In a Tauri
 * webview that "relative path" lands on the custom protocol's catch-all
 * route, which returns `index.html`. JSON.parse on `<!DOCTYPE html>...`
 * then throws `SyntaxError: Unrecognized token '<'`.
 *
 * Setting `allowLocalModels = false` forces the library to skip that
 * doomed local probe and hit the CDN directly. Models are still cached
 * in IndexedDB via `useBrowserCache = true` (the default), so subsequent
 * loads stay fast.
 *
 * Both the embeddings indexer (semantic search) and the voice transcriber
 * (Whisper) import + await this so we're guaranteed env is configured
 * before the first model fetch. */
let configuredPromise: Promise<void> | null = null;

export function configureTransformers(): Promise<void> {
  if (configuredPromise) return configuredPromise;
  configuredPromise = (async () => {
    const mod = await import("@xenova/transformers");
    mod.env.allowLocalModels = false;
    // Be explicit about the CDN — the default is already huggingface.co
    // but writing it down makes the failure mode obvious if it ever
    // changes upstream.
    mod.env.remoteHost = "https://huggingface.co";
    mod.env.useBrowserCache = true;
  })();
  return configuredPromise;
}
