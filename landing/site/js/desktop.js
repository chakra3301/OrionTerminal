import { motion, sleep, whenVisible } from "./motion.js";

const APP_NAMES = { archives: "Archives 47", orion: "Orion", xdesign: "XDesign" };
const MENUBAR_PCT = 7;

export function initDesktop() {
  const desk = document.getElementById("desk");
  const stage = document.getElementById("desk-stage");
  if (!desk || !stage) return null;

  const wins = new Map();
  let maxZ = 10;
  const mbApp = document.getElementById("mb-app");

  desk.querySelectorAll(".win").forEach((el) => {
    const s = el.style;
    const read = (k) => parseFloat(s.getPropertyValue(k));
    const init = { x: read("--x"), y: read("--y"), w: read("--w"), h: read("--h") };
    wins.set(el.dataset.app, { el, init, ...init });
  });

  const dockBtn = (app) => desk.querySelector(`.dock-btn[data-open="${app}"]`);
  const isOpen = (w) => !w.el.classList.contains("closed") && !w.el.classList.contains("minimized");

  function place(w) {
    w.el.style.setProperty("--x", `${w.x}%`);
    w.el.style.setProperty("--y", `${w.y}%`);
  }

  function syncDock() {
    for (const [app, w] of wins) {
      dockBtn(app)?.classList.toggle("running", !w.el.classList.contains("closed"));
      dockBtn(app)?.setAttribute("aria-pressed", String(w.el.classList.contains("focused")));
    }
  }

  function focus(app) {
    const w = wins.get(app);
    if (!w) return;
    w.el.classList.remove("closed", "minimized");
    w.el.style.zIndex = String(++maxZ);
    for (const o of wins.values()) o.el.classList.toggle("focused", o === w);
    if (mbApp) mbApp.textContent = APP_NAMES[app];
    syncDock();
  }

  function focusTopmost() {
    const open = [...wins.entries()].filter(([, w]) => isOpen(w));
    open.sort((a, b) => Number(b[1].el.style.zIndex || 0) - Number(a[1].el.style.zIndex || 0));
    if (open[0]) focus(open[0][0]);
    else {
      for (const w of wins.values()) w.el.classList.remove("focused");
      if (mbApp) mbApp.textContent = "Finder";
      syncDock();
    }
  }

  function hide(app, cls) {
    const w = wins.get(app);
    w.el.classList.add(cls);
    w.el.classList.remove("focused", "maximized");
    if (desk.classList.contains("compact")) {
      const next = [...wins.keys()].find((k) => k !== app && !wins.get(k).el.classList.contains("closed")) || [...wins.keys()].find((k) => k !== app);
      focus(next);
      return;
    }
    focusTopmost();
  }

  desk.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      const app = act.closest(".win").dataset.app;
      if (act.dataset.act === "close") hide(app, "closed");
      else if (act.dataset.act === "min") hide(app, "minimized");
      else if (act.dataset.act === "max") {
        wins.get(app).el.classList.toggle("maximized");
        focus(app);
      }
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) {
      const app = open.dataset.open;
      const w = wins.get(app);
      if (isOpen(w) && w.el.classList.contains("focused") && !desk.classList.contains("compact")) hide(app, "minimized");
      else focus(app);
      return;
    }
    if (e.target.closest("[data-desk-reset]")) reset();
  });

  desk.addEventListener("pointerdown", (e) => {
    const win = e.target.closest(".win");
    if (win) focus(win.dataset.app);
    const bar = e.target.closest("[data-drag]");
    if (!bar || e.target.closest("button") || e.button !== 0 || desk.classList.contains("compact")) return;
    const w = wins.get(win.dataset.app);
    if (w.el.classList.contains("maximized")) return;
    const r = desk.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    let raf = 0;
    w.el.classList.add("dragging");
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      w.x = Math.min(100 - 12, Math.max(-w.w + 12, ox + ((ev.clientX - sx) / r.width) * 100));
      w.y = Math.min(88, Math.max(MENUBAR_PCT - 3, oy + ((ev.clientY - sy) / r.height) * 100));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(w); });
    };
    const up = () => {
      w.el.classList.remove("dragging");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });

  desk.addEventListener("dblclick", (e) => {
    const bar = e.target.closest("[data-drag]");
    if (!bar || e.target.closest("button") || desk.classList.contains("compact")) return;
    const app = bar.closest(".win").dataset.app;
    wins.get(app).el.classList.toggle("maximized");
  });

  function reset() {
    for (const w of wins.values()) {
      Object.assign(w, w.init);
      w.el.classList.remove("closed", "minimized", "maximized");
      place(w);
    }
    focus("archives");
    focus("orion");
  }

  new ResizeObserver(() => {
    const compact = stage.clientWidth < 700;
    if (compact !== desk.classList.contains("compact")) {
      desk.classList.toggle("compact", compact);
      const focused = [...wins.entries()].find(([, w]) => w.el.classList.contains("focused"));
      focus(focused ? focused[0] : "orion");
    }
  }).observe(stage);

  const clock = document.getElementById("mb-clock");
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };
  tick();
  setInterval(tick, 15000);

  // scroll tilt: the desktop rises and settles flat as it enters
  let tiltRaf = 0;
  const tilt = () => {
    tiltRaf = 0;
    if (motion.reduced) {
      desk.style.setProperty("--rx", "0deg");
      desk.style.setProperty("--ds", "1");
      desk.style.setProperty("--dy", "0px");
      return;
    }
    const r = stage.getBoundingClientRect();
    const vh = innerHeight;
    let p = 1 - (r.top - vh * 0.1) / (vh * 0.8);
    p = Math.min(1, Math.max(0, p));
    const e = 1 - Math.pow(1 - p, 3);
    desk.style.setProperty("--rx", `${(1 - e) * 26}deg`);
    desk.style.setProperty("--ds", String(0.88 + 0.12 * e));
    desk.style.setProperty("--dy", `${(1 - e) * 30}px`);
  };
  addEventListener("scroll", () => { if (!tiltRaf) tiltRaf = requestAnimationFrame(tilt); }, { passive: true });
  motion.subscribe(tilt);
  tilt();

  focus("xdesign");
  focus("archives");
  focus("orion");

  const waitVisible = whenVisible(desk);
  runArchivesChat(waitVisible);
  runOrionEdit(waitVisible);

  return {
    open(app) {
      focus(app);
      const w = wins.get(app);
      if (!desk.classList.contains("compact") && w.x + w.w > 100) { w.x = 100 - w.w - 2; place(w); }
    },
    reset,
  };
}

async function typeInto(el, text, cps = 38) {
  if (motion.reduced) { el.textContent = text; return; }
  el.textContent = "";
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    await sleep(1000 / cps + (text[i] === " " ? 10 : 0));
  }
}

async function runArchivesChat(waitVisible) {
  const log = document.getElementById("arc-chat");
  if (!log) return;
  const script = [
    ["you", "What did I decide about the hero?"],
    ["ai", "Liquid glass that reacts to the cursor, kept quiet. It's linked from Hero frame and hero.ts."],
    ["you", "Turn the open items into tasks."],
    ["ai", "Done. Added 1 task to Launch week and tagged it #launch."],
  ];
  for (;;) {
    log.textContent = "";
    for (const [who, text] of script) {
      await waitVisible();
      await sleep(who === "you" ? 900 : 650);
      const m = document.createElement("p");
      m.className = `msg ${who}`;
      log.append(m);
      if (who === "you") m.textContent = text;
      else await typeInto(m, text, 46);
      await sleep(motion.reduced ? 200 : 1400);
    }
    await sleep(5000);
  }
}

const CODE = [
  `<span class="tk-k">import</span> { createOrb } <span class="tk-k">from</span> <span class="tk-s">"./orb"</span>;`,
  ``,
  `<span class="tk-c">// hero: liquid glass, quiet until touched</span>`,
  `<span class="tk-k">export function</span> <span class="tk-f">mountHero</span>(el: <span class="tk-f">HTMLElement</span>) {`,
  `  <span class="tk-k">const</span> orb = <span class="tk-f">createOrb</span>(el, { glow: <span class="tk-n">0.6</span> });`,
  `  orb.<span class="tk-f">idle</span>();`,
  `  <span class="tk-k">return</span> orb;`,
  `}`,
];
const EDIT_AT = 5;
const ADDED = [
  `  el.<span class="tk-f">addEventListener</span>(<span class="tk-s">"pointermove"</span>, (e) =&gt; {`,
  `    orb.<span class="tk-f">lookAt</span>(e.clientX, e.clientY);`,
  `  });`,
];

function renderCode(pre) {
  pre.innerHTML = CODE.map((l, i) => `<span class="ln" data-n="${i + 1}">${l || " "}</span>`).join("");
}

function renumber(pre) {
  let n = 0;
  pre.querySelectorAll(".ln").forEach((ln) => {
    if (!ln.classList.contains("del")) ln.dataset.n = String(++n);
  });
}

async function runOrionEdit(waitVisible) {
  const pre = document.getElementById("ori-code");
  const box = document.getElementById("ori-inline");
  const prompt = document.getElementById("ori-prompt");
  if (!pre || !box || !prompt) return;
  for (;;) {
    renderCode(pre);
    prompt.textContent = "";
    box.querySelector(".accept")?.remove();
    await waitVisible();
    await sleep(1600);
    box.classList.add("show");
    await sleep(400);
    await typeInto(prompt, "make the orb follow the cursor", 30);
    await sleep(500);
    const target = pre.children[EDIT_AT];
    target.classList.add("del");
    let after = target;
    for (const html of ADDED) {
      await sleep(motion.reduced ? 0 : 260);
      const ln = document.createElement("span");
      ln.className = "ln add";
      ln.innerHTML = html;
      after.after(ln);
      after = ln;
      renumber(pre);
    }
    const accept = document.createElement("span");
    accept.className = "accept";
    accept.textContent = "Accept ⌘↵";
    box.append(accept);
    await sleep(1800);
    target.remove();
    pre.querySelectorAll(".ln.add").forEach((ln) => ln.classList.remove("add"));
    renumber(pre);
    box.classList.remove("show");
    await sleep(5200);
  }
}
