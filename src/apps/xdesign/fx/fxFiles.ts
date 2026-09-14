export const FX_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "avif",
] as const;

const IMAGE_EXTENSIONS = new Set<string>(FX_IMAGE_EXTENSIONS);

export function isFxImagePath(path: string): boolean {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function fxImagePaths(paths: string[]): string[] {
  return paths.filter(isFxImagePath);
}

export function imageMimeForPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const ext = clean.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "avif") return "image/avif";
  return "image/png";
}
