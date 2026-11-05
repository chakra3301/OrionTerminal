import { createShaderCanvas, textureFromImage, NOISE } from "./gl.js";
import { motion } from "./motion.js";

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uTexRes;
uniform float uTime;
uniform vec2 uMouse;
uniform vec2 uTrail[6];
uniform float uEnergy;
uniform float uScroll;
${NOISE}

vec2 coverUv(vec2 uv) {
  float sr = uRes.x / uRes.y, tr = uTexRes.x / uTexRes.y;
  vec2 s = sr > tr ? vec2(1.0, tr / sr) : vec2(sr / tr, 1.0);
  return (uv - 0.5) * s + 0.5;
}

// height of the liquid surface: slow domain-warped flow plus ripples left by the cursor trail
float height(vec2 p) {
  float t = uTime * 0.045;
  vec2 q = vec2(fbm(p * 1.4 + vec2(t, -t * 0.7)), fbm(p * 1.4 + vec2(-t * 0.8, t) + 3.1));
  float h = fbm(p * 1.1 + q * 1.6 + t * 0.6) * 0.55;
  float aspect = uRes.x / uRes.y;
  for (int i = 0; i < 6; i++) {
    vec2 d = (p - uTrail[i] * vec2(aspect, 1.0));
    float r = length(d);
    float k = float(i) / 6.0;
    float fall = exp(-r * r * (34.0 - k * 18.0));
    h += sin(r * 34.0 - uTime * 4.0 + k * 2.4) * fall * (0.05 + uEnergy * 0.11) * (1.0 - k * 0.7);
    h += fall * 0.06 * (1.0 - k);
  }
  return h;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  float e = 1.5 / uRes.y;
  float h = height(p);
  vec2 g = vec2(height(p + vec2(e, 0.0)) - h, height(p + vec2(0.0, e)) - h) / e;
  vec3 n = normalize(vec3(-g * 0.045, 1.0));

  vec2 uv = coverUv(vUv);
  float scrollWarp = uScroll * 0.06;
  vec2 off = n.xy * (0.022 + scrollWarp);
  float ca = 0.004 + length(n.xy) * 0.012;
  vec3 col;
  col.r = texture(uTex, uv + off * (1.0 + ca * 40.0)).r;
  col.g = texture(uTex, uv + off).g;
  col.b = texture(uTex, uv + off * (1.0 - ca * 40.0)).b;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 L = normalize(vec3((uMouse - vUv) * vec2(aspect, 1.0) * 1.4, 0.9));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 48.0);
  float rim = pow(1.0 - n.z, 1.6);
  vec3 tint = mix(vec3(0.0, 0.88, 1.0), vec3(0.22, 1.0, 0.53), 0.5 + 0.5 * sin(uTime * 0.2 + p.x * 1.5));
  float chrome = smoothstep(0.05, 0.35, lum);
  col += tint * spec * (0.35 + chrome * 1.2);
  col += tint * rim * 0.9 * (0.25 + chrome);

  float md = length((vUv - uMouse) * vec2(aspect, 1.0));
  col += tint * exp(-md * md * 9.0) * 0.06 * (0.6 + uEnergy);

  vec2 vq = vUv - 0.5;
  col *= 1.0 - dot(vq, vq) * 0.9;
  col *= 1.0 - uScroll * 0.55;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.025;
  o = vec4(col, 1.0);
}`;

export function initHero() {
  const canvas = document.getElementById("hero-gl");
  const hero = canvas?.closest(".hero");
  if (!canvas || !hero) return;

  const img = new Image();
  img.decoding = "async";
  img.src = "assets/wallpaper.webp";

  const mouse = { x: 0.62, y: 0.55, tx: 0.62, ty: 0.55, energy: 0 };
  const trail = Array.from({ length: 6 }, () => [0.62, 0.55]);
  let scroll = 0;
  let trailTick = 0;
  let idle = 0;

  let sc;
  try {
    sc = createShaderCanvas(canvas, {
      dprCap: 1.25,
      resolution: 0.8,
      stillTime: 18,
      onFrame({ gl, u, t, dt, reduced }) {
        idle += dt;
        if (!reduced && idle > 2.5) {
          mouse.tx = 0.6 + Math.cos(t * 0.31) * 0.18;
          mouse.ty = 0.5 + Math.sin(t * 0.43) * 0.2;
        }
        const k = 1 - Math.pow(0.0015, dt || 0.016);
        const px = mouse.x, py = mouse.y;
        mouse.x += (mouse.tx - mouse.x) * k;
        mouse.y += (mouse.ty - mouse.y) * k;
        const speed = Math.hypot(mouse.x - px, mouse.y - py) / Math.max(dt, 0.001);
        mouse.energy += (Math.min(speed * 0.9, 1.4) - mouse.energy) * Math.min(1, dt * 4);
        trailTick += dt;
        if (trailTick > 0.06) {
          trailTick = 0;
          trail.pop();
          trail.unshift([mouse.x, mouse.y]);
        }
        gl.uniform2f(u.uMouse, mouse.x, mouse.y);
        if (u["uTrail[0]"]) gl.uniform2fv(u["uTrail[0]"], trail.flat());
        gl.uniform1f(u.uEnergy, reduced ? 0 : mouse.energy);
        gl.uniform1f(u.uScroll, scroll);
      },
    });
  } catch (err) {
    console.warn("hero shader unavailable", err);
    return;
  }
  if (!sc) return;

  img.onload = () => {
    try {
      sc.use("hero", FRAG);
      const { gl } = sc;
      textureFromImage(gl, img, 0);
      gl.uniform1i(sc.uniforms.uTex, 0);
      gl.uniform2f(sc.uniforms.uTexRes, img.naturalWidth, img.naturalHeight);
      sc.draw();
      requestAnimationFrame(() => canvas.classList.add("ready"));
    } catch (err) {
      console.warn("hero shader failed", err);
    }
  };

  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / r.width;
    mouse.ty = 1 - (e.clientY - r.top) / r.height;
    idle = 0;
    if (motion.reduced) sc.draw();
  }, { passive: true });

  const orb = document.getElementById("orb-tilt");
  let orbRaf = 0;
  let ox = 0, oy = 0;
  hero.addEventListener("pointermove", (e) => {
    if (motion.reduced || !orb) return;
    ox = e.clientX / innerWidth - 0.5;
    oy = e.clientY / innerHeight - 0.5;
    if (!orbRaf) orbRaf = requestAnimationFrame(() => {
      orbRaf = 0;
      orb.style.setProperty("--ory", `${ox * 22}deg`);
      orb.style.setProperty("--orx", `${-oy * 18}deg`);
      orb.style.setProperty("--otx", `${ox * 26}px`);
      orb.style.setProperty("--oty", `${oy * 18}px`);
      orb.style.setProperty("--sx", `${32 + ox * 40}%`);
      orb.style.setProperty("--sy", `${26 + oy * 40}%`);
    });
  }, { passive: true });

  addEventListener("scroll", () => {
    const s = Math.min(1, Math.max(0, scrollY / (hero.offsetHeight || 1)));
    if (Math.abs(s - scroll) > 0.002) {
      scroll = s;
      if (motion.reduced) sc.draw();
    }
  }, { passive: true });
}
