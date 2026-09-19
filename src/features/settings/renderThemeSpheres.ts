import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useThemeStore, type BuiltinThemeName, type ThemeName } from "@/store/themeStore";

const MATERIALS: Record<BuiltinThemeName, THREE.MeshPhysicalMaterialParameters> = {
  liquid: { color: "#294857", metalness: .1, roughness: .035, transmission: .45, thickness: 1.2, ior: 1.46, clearcoat: 1, attenuationColor: new THREE.Color("#5fe8ff"), attenuationDistance: 2 },
  minimal: { color: "#8b9c95", metalness: .05, roughness: .72 },
  "bmw-m": { color: "#ffffff", metalness: .5, roughness: .19, clearcoat: 1 },
  "ivory-keep": { color: "#e8dfc9", metalness: .2, roughness: .32, clearcoat: .6 },
};

let pending: Promise<Record<ThemeName, string>> | undefined;
let cacheKey = "";
let renderTail: Promise<void> = Promise.resolve();
export function themeSphereImages() {
  const customs = useThemeStore.getState().customThemes;
  const key = JSON.stringify(customs.map(t => [t.id, t.colors.accent, t.finish]));
  if (pending && key === cacheKey) return pending;
  cacheKey = key;
  const materials: Record<ThemeName, THREE.MeshPhysicalMaterialParameters> = { ...MATERIALS };
  for (const t of customs) materials[t.id] = { color: t.colors.accent, metalness: .2, roughness: t.finish === "glass" ? .08 : .38, clearcoat: .7 };
  pending = renderTail.then(() => render(materials));
  renderTail = pending.then(() => {}, () => {});
  return pending;
}

async function render(materials: Record<ThemeName, THREE.MeshPhysicalMaterialParameters>): Promise<Record<ThemeName, string>> {
  // One short-lived context, regardless of the number of theme thumbnails.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  let environment: THREE.WebGLRenderTarget | undefined;
  try {
    renderer.setSize(160, 160);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    environment = pmrem.fromScene(room, .04);
    const scene = new THREE.Scene();
    scene.environment = environment.texture;
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 20);
    camera.position.set(0, 0, 3.65);
    const initialMaterial = new THREE.MeshPhysicalMaterial();
    const sphere = new THREE.Mesh(geometry, initialMaterial);
    scene.add(sphere);
    initialMaterial.dispose();
    const result = {} as Record<ThemeName, string>;
    for (const theme of Object.keys(materials) as ThemeName[]) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const material = new THREE.MeshPhysicalMaterial(materials[theme]);
      let texture: THREE.Texture | undefined;
      try {
        if (theme === "bmw-m") {
          const pixels = new Uint8Array(128 * 4);
          for (let x = 0; x < 128; x++) {
            const color = new THREE.Color(x >= 48 && x < 55 ? "#58b8ee" : x >= 55 && x < 62 ? "#1c69d4" : x >= 62 && x < 69 ? "#e22718" : "#151820");
            pixels.set([color.r * 255, color.g * 255, color.b * 255, 255], x * 4);
          }
          texture = new THREE.DataTexture(pixels, 128, 1);
          texture.needsUpdate = true;
          material.map = texture;
        }
        sphere.material = material;
        sphere.rotation.set(.1, -Math.PI / 2, -.4);
        renderer.render(scene, camera);
        result[theme] = renderer.domElement.toDataURL("image/png");
      } finally { material.dispose(); texture?.dispose(); }
    }
    return result;
  } finally {
    geometry.dispose(); environment?.dispose(); room.dispose(); pmrem.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
