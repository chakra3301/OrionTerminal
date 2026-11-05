import { motion } from "./motion.js";

const TYPES = {
  note: { rgb: [57, 255, 136], label: "Note" },
  code: { rgb: [0, 224, 255], label: "File" },
  design: { rgb: [255, 62, 165], label: "Design" },
  chat: { rgb: [177, 76, 255], label: "Chat" },
  tag: { rgb: [230, 244, 236], label: "Tag" },
};

const CLUSTERS = [
  { hub: ["note", "Launch week"], items: [["code", "hero.ts"], ["design", "Hero frame"], ["chat", "Hero ideas"], ["tag", "#launch"], ["note", "Headline drafts"], ["code", "orb.ts"], ["design", "Social card"], ["note", "Press list"], ["chat", "Launch copy"], ["code", "index.html"]] },
  { hub: ["note", "Journal · Oct"], items: [["note", "Morning pages"], ["tag", "#ideas"], ["note", "Reading list"], ["chat", "Weekly recap"], ["note", "Sleep notes"], ["tag", "#health"], ["note", "Gratitude"], ["note", "Book quotes"]] },
  { hub: ["design", "Pitch deck"], items: [["design", "Cover slide"], ["note", "Talking points"], ["chat", "Deck feedback"], ["design", "Pricing slide"], ["code", "deck.html"], ["tag", "#work"], ["design", "Roadmap slide"], ["note", "Q4 goals"]] },
  { hub: ["code", "app/"], items: [["code", "router.ts"], ["code", "store.ts"], ["code", "api.ts"], ["chat", "Refactor plan"], ["note", "Bug log"], ["code", "styles.css"], ["code", "tests/"], ["code", "auth.ts"], ["code", "db.ts"], ["chat", "Explain router"]] },
  { hub: ["note", "Moodboard · ice"], items: [["design", "Palette"], ["design", "Type scale"], ["note", "References"], ["tag", "#visual"], ["design", "Shader study"], ["chat", "Color names"], ["design", "Icon set"], ["note", "Film stills"]] },
  { hub: ["chat", "Learning GLSL"], items: [["note", "Noise basics"], ["code", "shader.glsl"], ["design", "Aurora layer"], ["note", "Lighting notes"], ["tag", "#learn"], ["code", "raymarch.glsl"], ["note", "Book of Shaders"]] },
  { hub: ["note", "Travel · Japan"], items: [["note", "Itinerary"], ["design", "Photos"], ["chat", "Packing list"], ["note", "Food spots"], ["design", "Trip zine"], ["tag", "#travel"]] },
];
const BRIDGES = [["hero.ts", "app/"], ["Hero frame", "Moodboard · ice"], ["Shader study", "shader.glsl"], ["Aurora layer", "Hero frame"], ["Talking points", "Launch week"], ["Weekly recap", "Launch week"], ["Social card", "Pitch deck"], ["#ideas", "Headline drafts"], ["Bug log", "Journal · Oct"], ["Palette", "styles.css"], ["Reading list", "Noise basics"], ["deck.html", "router.ts"], ["Trip zine", "Type scale"], ["Itinerary", "Journal · Oct"], ["Film stills", "Photos"], ["Explain router", "router.ts"], ["Launch copy", "Headline drafts"], ["Q4 goals", "Launch week"]];

function buildGraph() {
  const nodes = [];
  const edges = [];
  const byName = new Map();
  const add = (type, name, hub = false) => {
    const n = { id: nodes.length, type, name, hub, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, deg: 0 };
    nodes.push(n);
    byName.set(name, n);
    return n;
  };
  const link = (a, b) => { edges.push([a.id, b.id]); a.deg++; b.deg++; };
  for (const c of CLUSTERS) {
    const hub = add(c.hub[0], c.hub[1], true);
    let prev = null;
    c.items.forEach(([t, name], i) => {
      const n = add(t, name);
      link(hub, n);
      if (prev && i % 2 === 0) link(prev, n);
      prev = n;
    });
  }
  for (const [a, b] of BRIDGES) if (byName.has(a) && byName.has(b)) link(byName.get(a), byName.get(b));
  const hubs = nodes.filter((n) => n.hub);
  for (let i = 0; i < hubs.length; i++) link(hubs[i], hubs[(i + 1) % hubs.length]);

  // Fibonacci-sphere seed, then a short 3D force simulation done once up front
  const N = nodes.length;
  nodes.forEach((n, i) => {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.39996;
    n.x = Math.cos(th) * r; n.y = y; n.z = Math.sin(th) * r;
  });
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const f = 0.012 / d2;
        dx *= f; dy *= f; dz *= f;
        a.vx += dx; a.vy += dy; a.vz += dz;
        b.vx -= dx; b.vy -= dy; b.vz -= dz;
      }
    }
    for (const [ia, ib] of edges) {
      const a = nodes[ia], b = nodes[ib];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      const rest = a.hub && b.hub ? 0.9 : 0.36;
      const f = (d - rest) * 0.05;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; a.vz += (dz / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; b.vz -= (dz / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.01; n.vy -= n.y * 0.01; n.vz -= n.z * 0.01;
      n.x += n.vx * cool; n.y += n.vy * cool; n.z += n.vz * cool;
      n.vx *= 0.6; n.vy *= 0.6; n.vz *= 0.6;
    }
  }
  let maxR = 0;
  for (const n of nodes) maxR = Math.max(maxR, Math.hypot(n.x, n.y, n.z));
  for (const n of nodes) { n.x /= maxR; n.y /= maxR; n.z /= maxR; }
  const adj = nodes.map(() => new Set());
  for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); }
  return { nodes, edges, adj };
}

export function initBrain() {
  const canvas = document.getElementById("brain-canvas");
  const label = document.getElementById("brain-label");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { nodes, edges, adj } = buildGraph();
  const proj = nodes.map(() => ({ x: 0, y: 0, z: 0, s: 1 }));
  const pulses = [];
  let yaw = 0.6, pitch = -0.25, vyaw = 0, vpitch = 0;
  let hover = -1;
  let dragging = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  function project() {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const R = Math.min(W, H) * 0.47;
    const cam = 2.6;
    nodes.forEach((n, i) => {
      const x1 = n.x * cy - n.z * sy;
      const z1 = n.x * sy + n.z * cy;
      const y1 = n.y * cp - z1 * sp;
      const z2 = n.y * sp + z1 * cp;
      const s = cam / (cam - z2);
      const p = proj[i];
      p.x = W / 2 + x1 * R * s; p.y = H / 2 - y1 * R * s; p.z = z2; p.s = s;
    });
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const focusSet = hover >= 0 ? adj[hover] : null;

    for (const [a, b] of edges) {
      const pa = proj[a], pb = proj[b];
      const depth = (pa.z + pb.z) * 0.25 + 0.5;
      let alpha = 0.08 + depth * 0.22;
      if (focusSet) alpha = (a === hover || b === hover) ? 0.75 : 0.025;
      const ca = TYPES[nodes[a].type].rgb, cb = TYPES[nodes[b].type].rgb;
      const g = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
      g.addColorStop(0, `rgba(${ca},${alpha})`);
      g.addColorStop(1, `rgba(${cb},${alpha})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = focusSet && (a === hover || b === hover) ? 1.4 : 0.8;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }

    for (const p of pulses) {
      const [a, b] = edges[p.e];
      const pa = proj[a], pb = proj[b];
      const k = p.dir ? p.k : 1 - p.k;
      const x = pa.x + (pb.x - pa.x) * k, y = pa.y + (pb.y - pa.y) * k;
      const c = TYPES[nodes[p.dir ? b : a].type].rgb;
      const r = 7 * ((pa.s + pb.s) / 2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},0.9)`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }

    const order = nodes.map((_, i) => i).sort((i, j) => proj[i].z - proj[j].z);
    for (const i of order) {
      const n = nodes[i], p = proj[i];
      const c = TYPES[n.type].rgb;
      const depth = p.z * 0.5 + 0.5;
      let a = 0.35 + depth * 0.65;
      if (focusSet && i !== hover && !focusSet.has(i)) a *= 0.18;
      const base = (n.hub ? 7 : 3.4 + Math.min(n.deg, 5) * 0.4) * p.s;
      const glow = base * (i === hover ? 7 : 4.2);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
      g.addColorStop(0, `rgba(${c},${0.55 * a})`); g.addColorStop(0.35, `rgba(${c},${0.12 * a})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, base * 0.55, 0, 6.283); ctx.fill();
      if (n.hub) {
        ctx.strokeStyle = `rgba(${c},${0.55 * a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, base * 2.4, base * 0.9, t * 0.4 + i, 0, 6.283); ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.font = `500 12px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    for (const i of order) {
      const n = nodes[i], p = proj[i];
      const show = i === hover || (focusSet && focusSet.has(i)) || (!focusSet && n.hub && p.z > -0.2);
      if (!show) continue;
      const strong = i === hover;
      ctx.fillStyle = strong ? "#fff" : `rgba(230,244,236,${focusSet ? 0.8 : 0.55})`;
      ctx.fillText(n.name, p.x + 10 * p.s + 4, p.y);
    }
  }

  function step(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const reduced = motion.reduced;
    if (!dragging) {
      yaw += vyaw; pitch += vpitch;
      vyaw *= 0.94; vpitch *= 0.94;
      if (!reduced && hover < 0) yaw += dt * 0.12;
      pitch += (-0.25 - pitch) * dt * 0.6;
    }
    if (!reduced) {
      if (Math.random() < dt * 5 && pulses.length < 14) pulses.push({ e: (Math.random() * edges.length) | 0, k: 0, dir: Math.random() < 0.5 });
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].k += dt * 0.7;
        if (pulses[i].k >= 1) pulses.splice(i, 1);
      }
    }
    project();
    draw(now / 1000);
    const moving = Math.abs(vyaw) + Math.abs(vpitch) > 1e-4;
    if (visible && !document.hidden && (!reduced || dragging || moving)) raf = requestAnimationFrame(step);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

  new ResizeObserver(() => { resize(); kick(); }).observe(canvas);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); }, { rootMargin: "60px" }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  motion.subscribe(kick);

  let px = 0, py = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    dragging = true; px = e.clientX; py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    kick();
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (dragging) {
      vyaw = (e.clientX - px) * 0.006; vpitch = (e.clientY - py) * 0.004;
      yaw += vyaw; pitch = Math.max(-1.2, Math.min(1.2, pitch + vpitch));
      px = e.clientX; py = e.clientY;
    }
    let best = -1, bd = 22 * 22;
    proj.forEach((p, i) => {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd && p.z > -0.6) { bd = d; best = i; }
    });
    if (best !== hover) {
      hover = best;
      if (label) {
        if (hover >= 0) {
          const n = nodes[hover];
          label.textContent = `${TYPES[n.type].label} · ${n.name} · ${adj[hover].size} links`;
          label.classList.add("on");
        } else {
          label.textContent = "Drag to orbit · hover a node";
          label.classList.remove("on");
        }
      }
    }
    kick();
  });
  const end = () => { dragging = false; kick(); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (!dragging && hover >= 0) { hover = -1; label?.classList.remove("on"); if (label) label.textContent = "Drag to orbit · hover a node"; kick(); } });

  resize();
  kick();
}
