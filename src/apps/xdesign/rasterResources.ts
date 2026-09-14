const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;

function localResource(value: string): boolean {
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) return value.length <= Math.ceil(MAX_IMAGE * 4 / 3) + 128;
  try {
    const url = new URL(value, window.location.href);
    if (url.username || url.password) return false;
    return (url.protocol === "asset:" && url.hostname === "localhost" && !url.port) ||
      (["http:", "https:"].includes(url.protocol) && url.hostname === "asset.localhost" && !url.port) ||
      ((url.protocol === "blob:" || url.protocol === window.location.protocol) && url.origin === window.location.origin);
  } catch { return false; }
}

function rasterMime(bytes: Uint8Array): string {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8) === "WEBP") return "image/webp";
  throw new Error("Raster export supports PNG, JPEG, GIF and WebP images. Convert other image assets first.");
}

async function imageDataUrl(url: string, signal: AbortSignal): Promise<string> {
  if (!localResource(url)) throw new Error("Import remote images locally before exporting. Unsupported image reference.");
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not read an image for export.");
  if (Number(response.headers.get("content-length")) > MAX_IMAGE) { await response.body.cancel(); throw new Error("Export image exceeds 20MB."); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE) throw new Error("Export image exceeds 20MB.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const mime = rasterMime(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function embedRasterResources(svg: string): Promise<string> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid export SVG.");
  const images = [...doc.querySelectorAll("image")];
  const cached = new Map<string, string>(); let total = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    for (const image of images) {
      const href = image.getAttribute("href") || image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href) throw new Error("An image has no source for export.");
      let data = cached.get(href);
      if (!data) {
        data = await imageDataUrl(href, controller.signal);
        cached.set(href, data);
      }
      total += data.length * 0.75;
      if (total > MAX_TOTAL) throw new Error("Export image resources exceed 64MB.");
      image.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      image.setAttribute("href", data);
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  } finally { clearTimeout(timer); }
}
