// Record a <canvas> animation to a video file via MediaRecorder on the canvas's
// captureStream — the same primitive voice capture uses, so it works in this
// webview. Used by the motion-artifact "Export video" action.

/** Pick the best supported recording mime + file extension, given a tester
 * (defaults to MediaRecorder.isTypeSupported). Pure for testing. */
export function pickVideoMime(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): { mime: string; ext: string } | null {
  const candidates: { mime: string; ext: string }[] = [
    { mime: "video/mp4;codecs=h264", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    try {
      if (isSupported(c.mime)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Record `canvas` for `durationMs` and resolve the encoded bytes + extension.
 * Rejects when the webview can't record (no MediaRecorder / captureStream / a
 * supported codec). */
export async function recordCanvasToFile(
  canvas: HTMLCanvasElement,
  durationMs = 6000,
): Promise<{ bytes: Uint8Array; ext: string }> {
  const cap = (canvas as unknown as { captureStream?: (fps?: number) => MediaStream }).captureStream;
  if (typeof MediaRecorder === "undefined" || typeof cap !== "function") {
    throw new Error("video recording isn't supported in this webview — export the HTML instead");
  }
  const picked = pickVideoMime();
  if (!picked) throw new Error("no supported video codec in this webview — export the HTML instead");

  const stream = cap.call(canvas, 30);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: picked.mime }));
    recorder.onerror = () => reject(new Error("recording failed"));
  });

  recorder.start(100);
  await new Promise((r) => setTimeout(r, durationMs));
  if (recorder.state !== "inactive") recorder.stop();
  for (const t of stream.getTracks()) t.stop();

  const blob = await done;
  const buf = await blob.arrayBuffer();
  return { bytes: new Uint8Array(buf), ext: picked.ext };
}
