import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGlassRect } from "./glassRect";

// True liquid glass: render the core to a texture, then refract it through a
// rounded-rect lens (edge-weighted distortion + chromatic shift at the rim +
// bevel specular + faint frost), mirroring bea4dev's liquid-glass.frag. Works
// in WebKit, where backdrop-filter:url() does not. Operates in CSS-px,
// top-left-origin space; scene() flips Y to texture space. When a glass panel
// is active the pass owns the whole frame, so it bakes in the red ambient glow
// (the CSS glow sits behind the now-opaque canvas).
const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform vec2 uGlassCenter;
  uniform vec2 uGlassSize;
  uniform float uGlassRadius;
  uniform float uActive;
  uniform float uSpark;
  varying vec2 vUv;

  float sdRoundRect(vec2 p, vec2 b, float r){
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }
  vec3 scene(vec2 px){
    vec2 uv = vec2(px.x / uResolution.x, 1.0 - px.y / uResolution.y);
    return texture2D(uScene, clamp(uv, 0.0, 1.0)).rgb;
  }
  vec3 glowAt(vec2 px){
    vec2 c = (px - uResolution * 0.5) / (min(uResolution.x, uResolution.y) * 0.5);
    float g = exp(-dot(c, c) * 1.7);
    return vec3(1.0, 0.18, 0.26) * g * (0.42 + uSpark * 0.12);
  }
  vec3 bg(vec2 px){ return scene(px) + glowAt(px); }
  // 3x3 gaussian — frosts the busy wireframe into smooth glass.
  vec3 bgBlur(vec2 px, float rad){
    vec3 c = bg(px) * 4.0;
    c += bg(px + vec2(rad, 0.0)) * 2.0;
    c += bg(px + vec2(-rad, 0.0)) * 2.0;
    c += bg(px + vec2(0.0, rad)) * 2.0;
    c += bg(px + vec2(0.0, -rad)) * 2.0;
    c += bg(px + vec2(rad, rad));
    c += bg(px + vec2(-rad, rad));
    c += bg(px + vec2(rad, -rad));
    c += bg(px + vec2(-rad, -rad));
    return c / 16.0;
  }

  void main(){
    vec2 fragPx = vec2(vUv.x, 1.0 - vUv.y) * uResolution; // top-left CSS px
    vec3 base = bg(fragPx);
    if (uActive < 0.5){ gl_FragColor = vec4(base, 1.0); return; }

    vec2 gc = fragPx - uGlassCenter;
    float scl = max(max(uGlassSize.x, uGlassSize.y), 1.0);
    float sizeMin = max(min(uGlassSize.x, uGlassSize.y), 1.0);
    float inv = -sdRoundRect(gc / scl, (uGlassSize * 0.5) / scl, uGlassRadius / scl) * scl / sizeMin;
    if (inv < 0.0){ gl_FragColor = vec4(base, 1.0); return; }

    vec2 dir = gc / max(length(gc), 0.0001);

    // Edge-weighted lens: flat in the middle, bends hard near the rounded rim.
    float depth = 0.16;
    float dfc = 1.0 - clamp(inv / depth, 0.0, 1.0);
    float distortion = 1.0 - sqrt(max(1.0 - dfc * dfc, 0.0));
    vec2 offset = distortion * dir * uGlassSize * 0.5 * 0.18;
    vec2 coord = fragPx - offset;

    // Chromatic aberration — strongest at the very edge.
    float edge = smoothstep(0.0, 0.045, inv);
    vec2 shift = dir * (1.0 - edge) * (6.0 + uSpark * 4.0);
    float frost = 3.0;
    vec3 col = vec3(
      bgBlur(coord - shift, frost).r,
      bgBlur(coord, frost).g,
      bgBlur(coord + shift, frost).b
    );

    // Cool glass tint + darken so the panel reads as frosted glass and the
    // text on top stays legible.
    col *= vec3(0.9, 0.95, 1.02);
    col = mix(col, vec3(0.04, 0.05, 0.07), 0.26);

    // Bevel specular: bright at the rim, brightest along the top edge.
    float rim = 1.0 - smoothstep(0.0, 0.05, inv);
    float topLight = clamp(-dir.y, 0.0, 1.0);
    col += rim * (0.10 + 0.26 * topLight);
    // Faint inner light ring just inside the bevel.
    float ring = smoothstep(0.03, 0.055, inv) * (1.0 - smoothstep(0.055, 0.1, inv));
    col += ring * vec3(0.05, 0.09, 0.13);
    col += uSpark * 0.05;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Mounted inside the EnergyCore Canvas. With a glass rect present it takes over
 * rendering (useFrame priority 1): scene → FBO → fullscreen refraction quad.
 * With no rect (the launch splash) it renders the scene straight to screen,
 * preserving the transparent canvas + CSS glow. */
export function LiquidGlassPost() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(2, 2, {
        depthBuffer: true,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POST_VERT,
        fragmentShader: POST_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uScene: { value: null as THREE.Texture | null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uGlassCenter: { value: new THREE.Vector2(0, 0) },
          uGlassSize: { value: new THREE.Vector2(0, 0) },
          uGlassRadius: { value: 16 },
          uActive: { value: 0 },
          uSpark: { value: 0 },
        },
      }),
    [],
  );

  const postScene = useMemo(() => {
    const s = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    s.add(quad);
    return s;
  }, [material]);
  const postCamera = useMemo(() => new THREE.Camera(), []);

  useEffect(() => {
    return () => {
      target.dispose();
      material.dispose();
    };
  }, [target, material]);

  useFrame(() => {
    const rect = useGlassRect.getState().rect;
    if (!rect) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.floor(size.width * dpr));
    const h = Math.max(2, Math.floor(size.height * dpr));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    const u = material.uniforms;
    u.uScene!.value = target.texture;
    u.uResolution!.value.set(size.width, size.height);
    u.uGlassCenter!.value.set(rect.cx, rect.cy);
    u.uGlassSize!.value.set(rect.w, rect.h);
    u.uGlassRadius!.value = rect.r;
    u.uActive!.value = 1;
    // Reuse the particle spark envelope so the glass flares with typing.
    u.uSpark!.value = Math.min(1, (scene.userData.spark as number) ?? 0);

    gl.render(postScene, postCamera);
  }, 1);

  return null;
}
