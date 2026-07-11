// Build-time character GLB optimizer. Meshy "merged animation" exports ship
// 7MB PNGs + full-precision float geometry (~18-21MB each). We shrink them to
// load fast in the live gallery WITHOUT needing a runtime decoder:
//   - textures → webp, resized to 1024 (WKWebView/Chromium decode natively)
//   - geometry → KHR_mesh_quantization (three's GLTFLoader supports natively)
//   - dedup / prune / weld to drop duplicate textures + junk
//
// Source GLBs live in scripts/characters-src/ (copied from the Meshy exports);
// optimized results overwrite public/characters/<slug>.glb.
//
// Run: node scripts/optimize-characters.mjs

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  weld,
  quantize,
  textureCompress,
} from "@gltf-transform/functions";
import sharp from "sharp";
import { readdir, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(root, "scripts", "characters-src");
const OUT = path.join(root, "public", "characters");

// Register all KHR/EXT extensions so KHR_mesh_quantization (geometry) and
// KHR_materials_specular survive the read→write round-trip. three's GLTFLoader
// supports both natively (no runtime decoder).
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function optimize(file) {
  const inPath = path.join(SRC, file);
  const outPath = path.join(OUT, file);
  const before = (await stat(inPath)).size;

  const doc = await io.read(inPath);

  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [1024, 1024],
      quality: 80,
    }),
    quantize({
      pattern: /.*/,
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
    }),
  );

  await io.write(outPath, doc);
  const after = (await stat(outPath)).size;
  const mb = (b) => (b / 1024 / 1024).toFixed(1);
  console.log(
    `${file}: ${mb(before)}MB → ${mb(after)}MB (${Math.round(
      (1 - after / before) * 100,
    )}% smaller)`,
  );
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SRC)).filter((f) => f.endsWith(".glb"));
  if (!files.length) {
    console.error(`No .glb files in ${SRC}`);
    process.exit(1);
  }
  for (const f of files) {
    try {
      await optimize(f);
    } catch (e) {
      console.error(`FAILED ${f}:`, e.message);
    }
  }
}

main();
