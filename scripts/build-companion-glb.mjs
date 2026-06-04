// Build-time asset step: Meshy exports the companion as 11 separate ~12MB GLBs
// (base mesh + one animation each, every file redundantly carrying the full
// skinned mesh + texture). They all share the IDENTICAL 26-node skeleton, so we
// merge the base mesh ONCE with every animation clip into a single GLB —
// dropping ~117MB of duplicate mesh/texture. No runtime decoder needed.
//
// Usage: node scripts/build-companion-glb.mjs [srcDir]
//   srcDir defaults to /tmp/meshy/Meshy_AI_Nocturne_Lolita_biped
import { NodeIO } from "@gltf-transform/core";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR =
  process.argv[2] || "/tmp/meshy/Meshy_AI_Nocturne_Lolita_biped";
const OUT = "public/companion/companion.glb";

const baseFile = fs
  .readdirSync(SRC_DIR)
  .find((f) => f.endsWith("_Character_output.glb"));
if (!baseFile) throw new Error("base Character_output.glb not found in " + SRC_DIR);

const cleanName = (file) => {
  const m = file.match(/_Animation_(.+?)_withSkin\.glb$/);
  return m ? m[1] : file.replace(/\.glb$/, "");
};

const io = new NodeIO();
const base = await io.read(path.join(SRC_DIR, baseFile));
const buffer = base.getRoot().listBuffers()[0];
const nameMap = new Map(base.getRoot().listNodes().map((n) => [n.getName(), n]));

// Drop the base's own default clip so only the named animation clips remain.
for (const a of base.getRoot().listAnimations()) a.dispose();

const animFiles = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.includes("_Animation_") && f.endsWith(".glb"))
  .sort();

const report = [];
for (const file of animFiles) {
  const name = cleanName(file);
  const doc = await io.read(path.join(SRC_DIR, file));
  const srcAnim = doc.getRoot().listAnimations()[0];
  if (!srcAnim) {
    console.warn("  (no animation in", file + ")");
    continue;
  }
  const anim = base.createAnimation(name);
  let copied = 0;
  let missing = 0;
  for (const ch of srcAnim.listChannels()) {
    const targetName = ch.getTargetNode()?.getName();
    const baseNode = targetName ? nameMap.get(targetName) : null;
    if (!baseNode) {
      missing++;
      continue;
    }
    const samp = ch.getSampler();
    const inAcc = samp.getInput();
    const outAcc = samp.getOutput();
    const newIn = base
      .createAccessor()
      .setType(inAcc.getType())
      .setNormalized(inAcc.getNormalized())
      .setArray(inAcc.getArray().slice())
      .setBuffer(buffer);
    const newOut = base
      .createAccessor()
      .setType(outAcc.getType())
      .setNormalized(outAcc.getNormalized())
      .setArray(outAcc.getArray().slice())
      .setBuffer(buffer);
    const newSamp = base
      .createAnimationSampler()
      .setInput(newIn)
      .setOutput(newOut)
      .setInterpolation(samp.getInterpolation());
    const newCh = base
      .createAnimationChannel()
      .setTargetNode(baseNode)
      .setTargetPath(ch.getTargetPath())
      .setSampler(newSamp);
    anim.addSampler(newSamp).addChannel(newCh);
    copied++;
  }
  report.push(`${name} (${copied}ch${missing ? `, ${missing} skipped` : ""})`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, base);
const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log(`\nWrote ${OUT} — ${sizeMB} MB`);
console.log(`Clips (${report.length}): ${report.join("; ")}`);
