import { convertFileSrc } from "@tauri-apps/api/core";

export async function loadImageBitmap(path: string): Promise<ImageBitmap> {
  const response = await fetch(convertFileSrc(path));
  if (!response.ok) throw new Error("The image preview could not be loaded");
  return createImageBitmap(await response.blob());
}

export async function scaleToPng(source: CanvasImageSource, width: number, height: number, maxEdge: number): Promise<Uint8Array> {
  if (!(width > 0 && height > 0)) throw new Error("There is nothing to preview");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The preview could not be drawn");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The preview could not be encoded");
  return new Uint8Array(await blob.arrayBuffer());
}
