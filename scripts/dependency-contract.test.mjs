import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);

test("Transformers' patched sharp supports image creation, metadata and resizing", async () => {
  const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
  const sharp = fromTransformers("sharp");
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "#39ff88" } }).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 3);
  assert.equal((await sharp(png).resize(1, 1).raw().toBuffer()).length, 3);
});

test("ONNX installer ZIP override retains decoding and rejects symlink extraction", () => {
  const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
  const fromOnnx = createRequire(fromTransformers.resolve("onnxruntime-node"));
  const Zip = fromOnnx("adm-zip");
  const zip = new Zip();
  zip.addFile("nested/probe.txt", Buffer.from("probe"));
  assert.equal(new Zip(zip.toBuffer()).readAsText("nested/probe.txt"), "probe");
  const root = mkdtempSync(join(tmpdir(), "orion-zip-contract-"));
  try {
    const target = join(root, "extract"), outside = join(root, "outside");
    mkdirSync(target); mkdirSync(outside);
    symlinkSync(outside, join(target, "nested"));
    assert.throws(() => zip.extractAllTo(target, true));
    assert.equal(existsSync(join(outside, "probe.txt")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("BlockNote's reviewed uuid override retains the v4 API used by its sources", () => {
  const fromBlockNote = createRequire(require.resolve("@blocknote/core"));
  const { v4 } = fromBlockNote("uuid");
  const ids = new Set(Array.from({ length: 100 }, () => v4()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("Cursor loads with the reviewed Undici Headers override without making a request", async () => {
  const fromCursor = createRequire(require.resolve("@cursor/sdk"));
  const fromConnect = createRequire(fromCursor.resolve("@connectrpc/connect-node"));
  const { Headers } = fromConnect("undici");
  const headers = new Headers({ "content-type": "application/json" });
  assert.equal(headers.get("Content-Type"), "application/json");
  const sdk = await import("@cursor/sdk");
  assert.equal(typeof sdk.Agent.create, "function");
});
