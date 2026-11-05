// Same digest as computeImageHash from @open-pencil/scene-graph/images, unrolled by five.
// Its per-byte `i % 5` switch takes 130-200ms on a multi-MB photo preview until JSC tiers
// it up, which landed as a dropped frame after every photo edit; this runs in ~4ms.
export function imageHash(data: Uint8Array): string {
  const prime = 0x01000193, end = data.length - data.length % 5;
  let h1 = 0x811c9dc5, h2 = h1, h3 = h1, h4 = h1, h5 = h1, i = 0;
  for (; i < end; i += 5) {
    h1 = Math.imul(h1 ^ data[i]!, prime);
    h2 = Math.imul(h2 ^ data[i + 1]!, prime);
    h3 = Math.imul(h3 ^ data[i + 2]!, prime);
    h4 = Math.imul(h4 ^ data[i + 3]!, prime);
    h5 = Math.imul(h5 ^ data[i + 4]!, prime);
  }
  if (i < data.length) h1 = Math.imul(h1 ^ data[i++]!, prime);
  if (i < data.length) h2 = Math.imul(h2 ^ data[i++]!, prime);
  if (i < data.length) h3 = Math.imul(h3 ^ data[i++]!, prime);
  if (i < data.length) h4 = Math.imul(h4 ^ data[i++]!, prime);
  h5 = Math.imul(h5 ^ data.length, prime);
  return [h1, h2, h3, h4, h5].map(hash => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}
