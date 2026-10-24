export const MAX_FIG_INPUT_BYTES=64*1024*1024;
/** Eager upstream population can expand large component libraries beyond the
 * WebView heap. Reject before allocating or replacing the current document. */
export function assertDesignImportSize(name:string,bytes:number):void {
  const limit=name.toLowerCase().endsWith(".fig")?MAX_FIG_INPUT_BYTES:256*1024*1024;
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>limit)throw new Error(`Design import exceeds ${limit/1024/1024}MB or is empty. Export a smaller page or library from the source application.`);
}
