import { motion, sleep, whenVisible } from "./motion.js";
import { initHero } from "./hero.js";
import { initDesktop } from "./desktop.js";
import { initBrain } from "./brain.js";
import { initFx } from "./fx.js";
import { initSpotlight, initSpotMock } from "./spotlight.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if (!isMac) document.querySelectorAll("[data-mod-key]").forEach((k) => { k.textContent = "Ctrl K"; });

const nav = document.getElementById("nav");
const onScroll = () => nav?.classList.toggle("scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// staggered scroll reveals; added by JS so content is never hidden without it
const revealTargets = document.querySelectorAll(".section-head, .app-card, .tile, .steps li, .faq details, .brain-copy, .brain-viz, .spot-copy, .spot-demo, .ai-board, .fx-overlay, .desk-note, .fine");
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    io.unobserve(e.target);
  }
}, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
revealTargets.forEach((el) => {
  el.classList.add("reveal");
  const sibs = [...el.parentElement.children].filter((c) => c.matches(el.tagName.toLowerCase() + "." + [...el.classList][0]));
  const idx = Math.max(0, sibs.indexOf(el));
  if (idx) el.style.transitionDelay = `${Math.min(idx, 5) * 70}ms`;
  io.observe(el);
});
document.querySelectorAll(".hero .reveal").forEach((el) => requestAnimationFrame(() => el.classList.add("in")));

// cursor-tracked glow on app cards
document.querySelectorAll(".app-card").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
});

// motion toggle
const toggle = document.getElementById("motion-toggle");
const syncToggle = () => {
  if (!toggle) return;
  toggle.textContent = motion.userReduced ? "Turn motion on" : "Reduce motion";
  toggle.setAttribute("aria-pressed", String(motion.userReduced));
};
toggle?.addEventListener("click", () => motion.setUserReduced(!motion.userReduced));
motion.subscribe(syncToggle);
syncToggle();

const run = (name, fn) => {
  try { return fn(); } catch (err) { console.warn(`${name} failed`, err); return null; }
};

run("hero", initHero);
const desktop = run("desktop", initDesktop);
run("brain", initBrain);
run("fx", initFx);
run("spotlight", () => initSpotlight({ desktop }));
const spotDemo = document.querySelector(".spot-demo");
if (spotDemo) run("spot mock", () => initSpotMock(whenVisible(spotDemo)));

document.querySelectorAll("[data-try]").forEach((b) => b.addEventListener("click", () => {
  document.getElementById("desktop")?.scrollIntoView({ behavior: motion.reduced ? "auto" : "smooth", block: "start" });
  desktop?.open(b.dataset.try);
}));

// ---------- AI provider preview ----------
const PROVIDERS = {
  claude: { label: "claude", via: "your Claude subscription" },
  chatgpt: { label: "chatgpt", via: "your ChatGPT sign-in" },
  gemini: { label: "gemini", via: "your Google account" },
  cursor: { label: "cursor", via: "your Cursor key" },
};
const aiMsgs = document.getElementById("ai-msgs");
const aiButtons = [...document.querySelectorAll("[data-provider]")];
let aiRun = 0;

async function playChat(provider) {
  const id = ++aiRun;
  const p = PROVIDERS[provider];
  document.querySelectorAll("[data-provider-label]").forEach((el) => { el.textContent = p.label; });
  if (!aiMsgs) return;
  const waitAi = playChat.wait || (playChat.wait = whenVisible(document.querySelector(".ai-board") || aiMsgs));
  aiMsgs.textContent = "";
  await waitAi();
  if (id !== aiRun) return;
  const you = document.createElement("p");
  you.className = "msg you";
  you.textContent = "Summarize my week in three bullets.";
  aiMsgs.append(you);
  await sleep(motion.reduced ? 0 : 700);
  if (id !== aiRun) return;
  const ai = document.createElement("p");
  ai.className = "msg ai";
  aiMsgs.append(ai);
  const lines = ["Shipped the hero shader in Orion.", "Two new ideas are waiting in Mood Boards.", "Friday: the public alpha goes out."];
  ai.innerHTML = "";
  for (const line of lines) {
    const row = document.createElement("span");
    row.style.display = "block";
    ai.append(row);
    const text = `• ${line}`;
    if (motion.reduced) row.textContent = text;
    else for (const ch of text) {
      if (id !== aiRun) return;
      row.textContent += ch;
      await sleep(16);
    }
  }
  const meta = document.createElement("span");
  meta.style.cssText = "display:block;margin-top:.6em;font:12px var(--mono);color:var(--ink-3)";
  meta.innerHTML = `via <b>${p.label}</b> · ${p.via}`;
  ai.append(meta);
}

function selectProvider(btn, focus) {
  aiButtons.forEach((b) => {
    const on = b === btn;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  if (focus) btn.focus();
  playChat(btn.dataset.provider);
}
aiButtons.forEach((b, i) => {
  b.tabIndex = i === 0 ? 0 : -1;
  b.addEventListener("click", () => selectProvider(b));
  b.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectProvider(aiButtons[(i + d + aiButtons.length) % aiButtons.length], true);
  });
});
if (aiButtons[0]) playChat("claude");
