export type MediaKind = "image" | "video" | "audio" | "pdf";

export type MediaType = { kind: MediaKind; mime: string };

// Extensions the webview can render directly (via a `data:` URL). Anything not
// listed falls through to the text editor (or its binary-file fallback).
const EXT_MEDIA: Record<string, MediaType> = {
  // images
  png: { kind: "image", mime: "image/png" },
  apng: { kind: "image", mime: "image/apng" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  bmp: { kind: "image", mime: "image/bmp" },
  ico: { kind: "image", mime: "image/x-icon" },
  // NOTE: svg is intentionally absent — it's valid UTF-8 text and routinely
  // hand-edited as source, so it stays in the code editor (lang.ts maps it to
  // xml), not the read-only image viewer.
  avif: { kind: "image", mime: "image/avif" },
  // video
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
  ogv: { kind: "video", mime: "video/ogg" },
  // audio
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  oga: { kind: "audio", mime: "audio/ogg" },
  opus: { kind: "audio", mime: "audio/ogg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  aac: { kind: "audio", mime: "audio/aac" },
  flac: { kind: "audio", mime: "audio/flac" },
  // documents
  pdf: { kind: "pdf", mime: "application/pdf" },
};

/** Lowercased extension of a path's basename, or "" for dotfiles / no-ext. */
export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  // dot > 0 so dotfiles like ".gitignore" (dot === 0) have no extension.
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The renderable media type for a path, or null if it isn't viewable media. */
export function mediaTypeForPath(path: string): MediaType | null {
  return EXT_MEDIA[extensionOf(path)] ?? null;
}
