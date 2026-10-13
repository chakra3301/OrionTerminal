import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bindTransforms, handFrame } from "./companion-hand-retarget.mjs";
import { handContactGeometry } from "./companion-hand-contact.mjs";

test("keeps all six real hand skins separated through contact clips, including frames between baked keys", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, "public/characters/manifest.json"), "utf8"));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
  for (const character of manifest.characters) {
    const bytes = await readFile(path.join(root, "public", character.model));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const rest = bindTransforms(gltf.scene);
    const hands = ["l", "r"].map((side) => handFrame(rest, side, character.id === "horned-demon" ? "thumb" : "pinky"));
    const contact = handContactGeometry(gltf.scene, hands, rest);
    assert.ok(contact.counts.every((count) => count > 300));
    for (const name of ["Clapping", "Sitting Clap", "Angry"]) {
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const clip = gltf.animations.find((clip) => clip.name === name);
      const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      let minimum = Infinity, maximum = -Infinity;
      for (let time = 0; time <= clip.duration; time += 1 / 120) {
        mixer.setTime(time);
        const { gap } = contact.measure();
        assert.ok(Number.isFinite(gap));
        minimum = Math.min(minimum, gap); maximum = Math.max(maximum, gap);
      }
      assert.ok(minimum >= 0, `${character.id}/${name} intersects by ${-minimum * 1000} mm`);
      assert.ok(maximum - minimum > contact.margin, `${character.id}/${name} does not reopen`);
      mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    }
  }
});
