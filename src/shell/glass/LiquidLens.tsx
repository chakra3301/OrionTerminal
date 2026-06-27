import { useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShell } from "@/shell/store/useShell";
import { useThemeStore } from "@/store/themeStore";
import { useWallpaperStore } from "@/store/wallpaperStore";

// === Liquid Lens =============================================================
// True refraction glass for the desktop. WebKit (Tauri's macOS engine) no-ops
// SVG-displacement on backdrop-filter, and WebGL can't read live DOM pixels —
// so the only thing we *can* refract is content we render ourselves. The thing
// behind every window is the wallpaper, which we express as a function in the
// shader (procedural sky, or the user's custom image as a texture). We then
// refract that backdrop through a rounded-rect lens under each window rect:
// edge-lens distortion + chromatic aberration at the rim + a water ripple +
// bevel specular — the same recipe as the login glass (Splash/LiquidGlassPost),
// generalised from one card to N windows and with the scene replaced by a
// procedural backdrop (no FBO needed).
//
// Mounts only under the "liquid" theme with glass on. Sits at z-index 1: above
// the CSS wallpaper (which it covers) and below the windows (z >= 11), whose
// translucent interiors let the refraction show through.

const MAX_RECTS = 8;
const LENS_RADIUS = 20; // matches liquid theme --r-lg

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec2  uResolution;   // CSS px
  uniform float uTime;
  uniform float uHasImage;
  uniform sampler2D uImage;
  uniform vec2  uImageRes;     // natural px of the custom image
  uniform int   uRectCount;
  uniform vec4  uRects[${MAX_RECTS}]; // cx, cy, halfW, halfH (top-left px)

  // accents (liquid theme): violet / cyan / green
  const vec3 VIOLET = vec3(0.753, 0.482, 1.0);
  const vec3 CYAN   = vec3(0.373, 0.910, 1.0);
  const vec3 GREEN  = vec3(0.302, 1.0, 0.627);

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  // soft radial glow, anisotropic; pos/spread in 0..1 uv (y down)
  float glow(vec2 uv, vec2 pos, vec2 spread) {
    vec2 d = (uv - pos) / spread;
    return exp(-dot(d, d));
  }
  // procedural deep-space sky matching .ot-wallpaper's default gradient
  vec3 sky(vec2 px) {
    vec2 uv = px / uResolution;
    // smooth vertical gradient: near-black top, faintly lifted deep-blue bottom
    vec3 col = mix(vec3(0.010, 0.020, 0.034), vec3(0.020, 0.045, 0.075),
                   smoothstep(0.0, 1.0, uv.y));
    // soft, premium accent glows
    col += VIOLET * 0.13 * glow(uv, vec2(0.5, 1.08), vec2(0.60, 0.40));
    col += CYAN   * 0.07 * glow(uv, vec2(0.16, 0.96), vec2(0.42, 0.32));
    col += GREEN  * 0.05 * glow(uv, vec2(0.85, 0.04), vec2(0.48, 0.34));
    // subtle, sparse stars
    vec2 cell = floor(px / 3.5);
    float s = hash(cell);
    float twinkle = 0.5 + 0.5 * sin(uTime * 1.2 + s * 40.0);
    col += step(0.9986, s) * vec3(0.7, 0.85, 1.0) * twinkle * 0.8;
    // gentle vignette for depth
    col *= 1.0 - 0.22 * smoothstep(0.4, 1.15, length(uv - 0.5));
    return col;
  }
  // custom wallpaper sampled with CSS background-size: cover
  vec3 imageBg(vec2 px) {
    vec2 uv = px / uResolution;
    float screenA = uResolution.x / uResolution.y;
    float imgA = uImageRes.x / max(uImageRes.y, 1.0);
    vec2 t = uv;
    if (screenA > imgA) {        // screen wider — crop top/bottom
      float scale = imgA / screenA;
      t.y = (uv.y - 0.5) * scale + 0.5;
    } else {                      // screen taller — crop sides
      float scale = screenA / imgA;
      t.x = (uv.x - 0.5) * scale + 0.5;
    }
    return texture2D(uImage, clamp(t, 0.0, 1.0)).rgb;
  }
  vec3 bg(vec2 px) {
    return uHasImage > 0.5 ? imageBg(px) : sky(px);
  }
  // 5-tap frost so the desktop reads as smooth glass, not sharp pixels
  vec3 bgFrost(vec2 px, float rad) {
    vec3 c = bg(px) * 2.0;
    c += bg(px + vec2(rad, 0.0));
    c += bg(px + vec2(-rad, 0.0));
    c += bg(px + vec2(0.0, rad));
    c += bg(px + vec2(0.0, -rad));
    return c / 6.0;
  }

  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }
  // height field whose gradient warps the sample (à la water-terminal.frag)
  float waterHeight(vec2 c, float t) {
    const float PI = 3.14159265;
    float dT = 2.0 * PI / 7.0;
    float h = 0.0;
    for (int i = 0; i < 8; i++) {
      float th = dT * float(i);
      vec2 a = c;
      a.x += cos(th) * t * 0.16;
      a.y -= sin(th) * t * 0.13;
      h += cos((a.x * cos(th) - a.y * sin(th)) * 5.5) * 0.55;
    }
    return cos(h);
  }

  void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uResolution; // top-left CSS px
    vec3 col = bg(px);

    // Topmost window rect that contains this pixel (uRects ordered top→bottom).
    for (int i = 0; i < ${MAX_RECTS}; i++) {
      if (i >= uRectCount) break;
      vec4 R = uRects[i];
      vec2 center = R.xy;
      vec2 halfSize = R.zw;
      vec2 gc = px - center;

      float scl = max(max(halfSize.x, halfSize.y) * 2.0, 1.0);
      float sizeMin = max(min(halfSize.x, halfSize.y) * 2.0, 1.0);
      float inv = -sdRoundRect(gc / scl, halfSize / scl, ${LENS_RADIUS.toFixed(1)} / scl) * scl / sizeMin;
      if (inv < 0.0) continue; // outside this rounded rect → try next

      vec2 dir = gc / max(length(gc), 0.0001);

      // whole-panel magnification + hard edge-lens bulge near the rim
      float depth = 0.22;
      float dfc = 1.0 - clamp(inv / depth, 0.0, 1.0);
      float distortion = 1.0 - sqrt(max(1.0 - dfc * dfc, 0.0));
      vec2 zoomed = center + (px - center) * 0.97;
      vec2 coord = zoomed - distortion * dir * halfSize * 0.34;

      // liquid water ripple — gradient of the height field warps the sample
      vec2 wuv = (px - (center - halfSize)) / max(halfSize * 2.0, vec2(1.0));
      float eps = 0.004;
      float wch = waterHeight(wuv, uTime);
      float wdx = waterHeight(wuv + vec2(eps, 0.0), uTime) - wch;
      float wdy = waterHeight(wuv + vec2(0.0, eps), uTime) - wch;
      coord += vec2(wdx, wdy) * 140.0;

      // chromatic aberration — strongest at the rim
      float edge = smoothstep(0.0, 0.05, inv);
      vec2 shift = dir * ((1.0 - edge) * 11.0 + 2.0);
      float frost = 4.2;
      vec3 g = vec3(
        bgFrost(coord - shift, frost).r,
        bgFrost(coord, frost).g,
        bgFrost(coord + shift, frost).b
      );

      // bright cool glass
      g *= vec3(0.96, 0.99, 1.06);
      g = mix(g, vec3(0.03, 0.05, 0.08), 0.26);
      g *= 1.12;

      // ripple crests catch a cool light
      float ripple = clamp(dot(normalize(vec2(wdx, wdy) + 1e-4),
                               normalize(vec2(-0.4, -0.8))), 0.0, 1.0);
      g += ripple * vec3(0.10, 0.16, 0.22) * 0.45;

      // bevel specular: bright at the rim, brightest along the top edge
      float rim = 1.0 - smoothstep(0.0, 0.05, inv);
      float topLight = clamp(-dir.y, 0.0, 1.0);
      g += rim * (0.10 + 0.28 * topLight);
      float ring = smoothstep(0.03, 0.055, inv) * (1.0 - smoothstep(0.055, 0.1, inv));
      g += ring * vec3(0.06, 0.10, 0.14);

      col = g;
      break; // topmost wins
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

function LensQuad() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const customPath = useWallpaperStore((s) =>
    s.mode === "custom" ? s.customPath : null,
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uHasImage: { value: 0 },
          uImage: { value: null as THREE.Texture | null },
          uImageRes: { value: new THREE.Vector2(1, 1) },
          uRectCount: { value: 0 },
          uRects: {
            value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()),
          },
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

  // Load / swap the custom wallpaper image as a texture.
  useEffect(() => {
    if (!customPath) {
      material.uniforms.uHasImage!.value = 0;
      return;
    }
    let cancelled = false;
    new THREE.TextureLoader().load(convertFileSrc(customPath), (tex) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      const prev = material.uniforms.uImage!.value;
      material.uniforms.uImage!.value = tex;
      material.uniforms.uImageRes!.value.set(
        tex.image?.width ?? 1,
        tex.image?.height ?? 1,
      );
      material.uniforms.uHasImage!.value = 1;
      prev?.dispose();
    });
    return () => {
      cancelled = true;
    };
  }, [customPath, material]);

  useEffect(() => {
    return () => {
      material.dispose();
      postScene.clear();
    };
  }, [material, postScene]);

  useFrame((state) => {
    const u = material.uniforms;
    u.uResolution!.value.set(size.width, size.height);
    u.uTime!.value = state.clock.elapsedTime;

    // Topmost-first so the shader's first containing rect wins. Skip windows
    // that don't float over the desktop (minimized / maximized / fullscreen).
    const rects = useShell
      .getState()
      .windows.filter((w) => !w.minimized && !w.maximized && !w.fullscreen)
      .sort((a, b) => b.z - a.z)
      .slice(0, MAX_RECTS);
    rects.forEach((w, i) => {
      (u.uRects!.value[i] as THREE.Vector4).set(
        w.x + w.w / 2,
        w.y + w.h / 2,
        w.w / 2,
        w.h / 2,
      );
    });
    u.uRectCount!.value = rects.length;

    gl.setRenderTarget(null);
    gl.render(postScene, postCamera);
  }, 1);

  return null;
}

/** Desktop-wide liquid refraction. Mounted by Shell only under the liquid
 * theme with glass enabled. Marks <html> with `ot-lens` so the CSS can drop
 * the window backdrop-blur (the shader is the backdrop now). */
export function LiquidLens() {
  const reduceGlass = useThemeStore((s) => s.reduceGlass);
  // Shell mounts this only on the liquid theme. The container (with its CSS
  // fallback sky) ALWAYS renders here so the desktop reads as the liquid sky
  // even if WebGL is unavailable; the Canvas adds the live refraction on top.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("ot-lens");
    return () => root.classList.remove("ot-lens");
  }, []);

  return (
    <div className="ot-liquid-lens" aria-hidden>
      {!reduceGlass && (
        <Canvas
          frameloop="always"
          camera={{ position: [0, 0, 3.4], fov: 52 }}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          style={{ background: "transparent" }}
        >
          <LensQuad />
        </Canvas>
      )}
    </div>
  );
}
