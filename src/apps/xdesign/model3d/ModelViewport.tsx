/**
 * Live r3f viewport for the img2model studio: the current pass's
 * `THREE.Group` (from `useModelStore`), an optional translucent reference
 * overlay, orbit controls, and the render-capture bridge the agent's
 * `model_request_render`/multi-angle tools call through (real captures via
 * a dedicated offscreen renderer, not the interactive canvas, so a capture
 * never fights the user's live camera).
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useModelStore } from "./modelStore";
import { registerModelRenderBridge, type OrbitCapture } from "./modelRenderBridge";

function ReferenceOverlay() {
  const reference = useModelStore((s) => s.reference);
  const show = useModelStore((s) => s.showReferenceOverlay);
  const texture = useMemo(() => {
    if (!reference) return null;
    const tex = new THREE.TextureLoader().load(reference.dataUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [reference?.dataUrl]);
  if (!reference || !show || !texture) return null;
  const aspect = reference.w / reference.h;
  const h = 1.6, w = h * aspect;
  return (
    <mesh position={[0, h / 2 - 0.1, -0.6]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

function LiveModel() {
  const root = useModelStore((s) => s.root);
  if (!root) return null;
  return <primitive object={root} />;
}

/** Sets up an offscreen renderer sharing the live scene's model, and
 * registers capture functions the agent tools call through. Lives inside
 * the Canvas so it can read the live `gl`'s context config, but renders to
 * its OWN canvas/renderer so a capture never disturbs the user's camera. */
function CaptureBridge(): null {
  const { scene } = useThree();
  const offscreenRef = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; lights: THREE.Group } | null>(null);

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(512, 512, false);
    renderer.setClearColor(0x000000, 0);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const lights = new THREE.Group();
    lights.add(new THREE.DirectionalLight(0xffffff, 1.0));
    (lights.children[0] as THREE.DirectionalLight).position.set(2, 3, 2.5);
    lights.add(new THREE.AmbientLight(0x404040, 0.6));
    offscreenRef.current = { renderer, camera, lights };
    return () => {
      renderer.dispose();
      offscreenRef.current = null;
    };
  }, []);

  useEffect(() => {
    const captureAt = (angleDeg: number, canvasEl: HTMLCanvasElement): void => {
      const off = offscreenRef.current;
      if (!off) return;
      const root = useModelStore.getState().root;
      const box = new THREE.Box3();
      if (root) box.setFromObject(root);
      if (!root || box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const rad = (angleDeg * Math.PI) / 180;
      const dist = size * 1.6;
      off.camera.position.set(center.x + Math.sin(rad) * dist, center.y + size * 0.25, center.z + Math.cos(rad) * dist);
      off.camera.lookAt(center);
      off.camera.updateProjectionMatrix();

      const hadLights = !!scene.getObjectByProperty("uuid", off.lights.uuid);
      if (!hadLights) scene.add(off.lights);
      off.renderer.render(scene, off.camera);
      if (!hadLights) scene.remove(off.lights);

      const ctx = canvasEl.getContext("2d")!;
      canvasEl.width = 512; canvasEl.height = 512;
      ctx.clearRect(0, 0, 512, 512);
      ctx.fillStyle = "#0a1015";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(off.renderer.domElement, 0, 0, 512, 512);
    };

    registerModelRenderBridge({
      captureReviewShot: async () => {
        const canvasEl = document.createElement("canvas");
        captureAt(35, canvasEl);
        return canvasEl;
      },
      captureOrbit: async (angles: number[]): Promise<OrbitCapture[]> =>
        angles.map((angleDeg) => {
          const canvasEl = document.createElement("canvas");
          captureAt(angleDeg, canvasEl);
          return { angleDeg, canvas: canvasEl };
        }),
    });
    return () => registerModelRenderBridge(null);
  }, [scene]);

  return null;
}

export function ModelViewport() {
  const orbitAutoSpin = useModelStore((s) => s.orbitAutoSpin);
  return (
    <div className="xd-model-viewport">
      <Canvas
        camera={{ position: [1.6, 1.1, 1.8], fov: 45 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 3, 2.5]} intensity={0.9} />
        <Grid args={[6, 6]} cellColor="#1a2530" sectionColor="#243543" fadeDistance={6} position={[0, -0.6, 0]} />
        <ReferenceOverlay />
        <LiveModel />
        <CaptureBridge />
        <OrbitControls autoRotate={orbitAutoSpin} autoRotateSpeed={1.4} enableDamping dampingFactor={0.1} />
      </Canvas>
    </div>
  );
}
