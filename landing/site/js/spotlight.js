import { motion } from "./motion.js";

const DMG = "https://github.com/chakra3301/OrionTerminal/releases/download/v0.1.0-alpha.1/Orion-Terminal_aarch64.dmg";
const REPO = "https://github.com/chakra3301/OrionTerminal";
const C = { green: "57,255,136", cyan: "0,224,255", magenta: "255,62,165", violet: "177,76,255", ink: "230,244,236", yellow: "230,255,58" };

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Subsequence match with bonuses for word starts and runs; returns null when not all chars match. */
export function fuzzy(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const hits = Array.from({ length: q.length }, (_, i) => direct + i);
    return { score: 100 - direct + (direct === 0 || /\W/.test(t[direct - 1]) ? 40 : 0), hits, direct: true };
  }
  let score = 0, ti = 0, run = 0;
  const hits = [];
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    const wordStart = at === 0 || /\W/.test(t[at - 1]);
    run = at === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(at - ti, 6) * 0.4;
    hits.push(at);
    ti = at + 1;
  }
  if (score < q.replace(/ /g, "").length * 2) return null;
  return { score, hits };
}

/** Secondary text only counts when the query appears at the start of a word, so long answers don't match everything. */
function wordMatch(query, text) {
  const q = query.toLowerCase();
  if (q.length < 2) return -Infinity;
  const re = new RegExp(`(^|\\W)${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  const m = re.exec(text);
  return m ? 40 - Math.min(m.index, 200) * 0.05 : -Infinity;
}

function highlight(text, hits) {
  if (!hits.length) return esc(text);
  const set = new Set(hits);
  let out = "";
  for (let i = 0; i < text.length; i++) out += set.has(i) ? `<mark>${esc(text[i])}</mark>` : esc(text[i]);
  return out;
}

export function initSpotlight({ desktop } = {}) {
  const dialog = document.getElementById("spotlight");
  const input = document.getElementById("sp-input");
  const list = document.getElementById("sp-results");
  if (!dialog || !input || !list || typeof dialog.showModal !== "function") return;

  const go = (hash) => () => {
    const el = document.querySelector(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: motion.reduced ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", hash);
  };
  const openApp = (app) => () => {
    go("#desktop")();
    desktop?.open(app);
  };
  const ext = (href) => () => window.open(href, "_blank", "noopener,noreferrer");

  const items = [
    { g: "Pages", t: "Try the interactive desktop", s: "Drag windows, use the dock", i: "monitor", c: C.cyan, k: "demo try play windows", run: go("#desktop") },
    { g: "Pages", t: "The three apps", s: "Archives 47, Orion, XDesign", i: "layers", c: C.ink, k: "features apps overview", run: go("#apps") },
    { g: "Pages", t: "One brain", s: "How your work connects", i: "brain-circuit", c: C.violet, k: "graph links connect knowledge", run: go("#brain") },
    { g: "Pages", t: "Bring your own AI", s: "Claude, ChatGPT, Gemini, Cursor", i: "sparkles", c: C.green, k: "ai assistant claude chatgpt openai gemini cursor subscription model", run: go("#ai") },
    { g: "Pages", t: "XDesign FX", s: "Live shaders you can play with", i: "zap", c: C.magenta, k: "effects shader motion aurora nebula glyph synthwave", run: go("#fx") },
    { g: "Pages", t: "Privacy and local storage", s: "Your work stays on your Mac", i: "hard-drive", c: C.cyan, k: "privacy data local offline backup security open source", run: go("#local") },
    { g: "Pages", t: "Download", s: "Free · macOS on Apple Silicon", i: "arrow-down-to-line", c: C.green, k: "install get mac dmg", run: go("#download") },
    { g: "Apps", t: "Archives 47", s: "Notes, journal, mood boards · open in demo", i: "archive", c: C.green, k: "notes notion journal wiki second brain", run: openApp("archives") },
    { g: "Apps", t: "Orion", s: "AI code editor · open in demo", i: "code-xml", c: C.cyan, k: "code editor cursor vscode programming", run: openApp("orion") },
    { g: "Apps", t: "XDesign", s: "Design, decks and motion · open in demo", i: "palette", c: C.magenta, k: "design figma canvas prototype deck", run: openApp("xdesign") },
    { g: "Commands", cmd: true, t: "Download for Mac", s: "Orion-Terminal_aarch64.dmg · 55.8 MB", i: "arrow-down-to-line", c: C.green, k: "dmg install get", run: () => { location.href = DMG; } },
    { g: "Commands", cmd: true, t: "Open GitHub", s: "Source code · Apache-2.0", i: "github", c: C.ink, k: "source repo code open", run: ext(REPO) },
    { g: "Commands", cmd: true, t: "Read release notes", s: "v0.1.0-alpha.1", i: "book-open", c: C.ink, k: "changelog whats new", run: ext(`${REPO}/releases/tag/v0.1.0-alpha.1`) },
    { g: "Commands", cmd: true, t: "Open setup guide", s: "Install and first launch", i: "settings", c: C.ink, k: "help install guide", run: ext(`${REPO}/blob/v0.1.0-alpha.1/BETA.md`) },
    { g: "Commands", cmd: true, t: "Reset demo desktop", s: "Put the windows back", i: "history", c: C.cyan, k: "reset windows", run: () => { go("#desktop")(); desktop?.reset(); } },
    { g: "Commands", cmd: true, get t() { return motion.userReduced ? "Turn motion back on" : "Reduce motion"; }, s: "Pause animations on this site", i: "feather", c: C.yellow, k: "animation accessibility motion calm", run: () => motion.setUserReduced(!motion.userReduced) },
    { g: "Commands", cmd: true, t: "Back to top", s: "", i: "arrow-right", c: C.ink, k: "top home start", run: go("#top") },
  ];
  document.querySelectorAll(".faq details").forEach((d) => {
    const q = d.querySelector("summary").textContent.trim();
    const a = d.querySelector("p").textContent.trim();
    items.push({ g: "Questions", t: q, s: a.slice(0, 90) + (a.length > 90 ? "…" : ""), i: "chevron-down", c: C.ink, k: `${d.dataset.k || ""} ${a}`, run: () => { d.open = true; d.scrollIntoView({ behavior: motion.reduced ? "auto" : "smooth", block: "center" }); d.querySelector("summary").focus({ preventScroll: true }); } });
  });

  let results = [];
  let active = 0;
  let opener = null;

  function compute() {
    let q = input.value.trim();
    const cmdOnly = q.startsWith(">");
    if (cmdOnly) q = q.slice(1).trim();
    const pool = items.filter((it) => !cmdOnly || it.cmd);
    if (!q) {
      results = cmdOnly ? pool.map((it) => ({ it, hits: [] })) : ["Try the interactive desktop", "Download", "The three apps", "Bring your own AI", "Privacy and local storage", "Download for Mac", "Open GitHub"].map((t) => ({ it: items.find((x) => x.t === t), hits: [] }));
      results = results.map((r) => ({ ...r, group: r.it.cmd ? "Commands" : "Suggested" }));
    } else {
      results = pool.map((it) => {
        const mt = fuzzy(q, it.t);
        const mk = wordMatch(q, `${it.s} ${it.k}`);
        const score = Math.max(mt ? mt.score + (mt.direct ? 20 : -10) - it.t.length * 0.3 : -Infinity, mk);
        return score === -Infinity ? null : { it, hits: mt ? mt.hits : [], score, group: it.g };
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 10);
      const groupOrder = [...new Set(results.map((r) => r.group))];
      results.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || b.score - a.score);
    }
    active = 0;
    render();
  }

  function render() {
    if (!results.length) {
      list.innerHTML = `<li class="sp-empty" role="presentation">Nothing matches “${esc(input.value)}”. Try “ai”, “download” or “&gt;”.</li>`;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    let html = "";
    let group = "";
    results.forEach((r, i) => {
      if (r.group !== group) {
        group = r.group;
        html += `<li class="sp-group" role="presentation">${group}</li>`;
      }
      html += `<li class="sp-item" role="option" id="sp-opt-${i}" data-i="${i}" aria-selected="${i === active}" style="--c:${r.it.c}">
        <span class="sw"><svg class="ic" aria-hidden="true"><use href="#i-${r.it.i}"/></svg></span>
        <div><b>${highlight(r.it.t, r.hits)}</b>${r.it.s ? `<span>${esc(r.it.s)}</span>` : ""}</div>
        <kbd aria-hidden="true">↵</kbd></li>`;
    });
    list.innerHTML = html;
    input.setAttribute("aria-activedescendant", `sp-opt-${active}`);
  }

  function move(d) {
    if (!results.length) return;
    active = (active + d + results.length) % results.length;
    list.querySelectorAll(".sp-item").forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.i) === active)));
    input.setAttribute("aria-activedescendant", `sp-opt-${active}`);
    list.querySelector(`#sp-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }

  function runActive(i = active) {
    const r = results[i];
    if (!r) return;
    opener = null;
    dialog.close();
    r.it.run();
  }

  function open() {
    if (dialog.open) { dialog.close(); return; }
    opener = document.activeElement;
    input.value = "";
    compute();
    dialog.showModal();
    input.focus();
  }

  input.addEventListener("input", compute);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); runActive(); }
    else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
  });
  list.addEventListener("pointermove", (e) => {
    const li = e.target.closest(".sp-item");
    if (li && Number(li.dataset.i) !== active) { active = Number(li.dataset.i); move(0); }
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest(".sp-item");
    if (li) runActive(Number(li.dataset.i));
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
    else if (e.key === "/" && !typing && !dialog.open) { e.preventDefault(); open(); }
  });
  document.querySelectorAll("[data-spotlight-open]").forEach((b) => b.addEventListener("click", open));
}

/** The looping, non-interactive Spotlight illustration in the Spotlight band. */
export function initSpotMock(waitVisible) {
  const typed = document.getElementById("spot-typed");
  const ul = document.getElementById("spot-mock-results");
  if (!typed || !ul) return;
  const scenes = [
    ["hero", [["sticky-note", C.green, "Launch week", "Note"], ["code-xml", C.cyan, "hero.ts", "site/"], ["palette", C.magenta, "Hero frame", "XDesign"], ["sparkles", C.violet, "Hero ideas", "Chat · Tue"]]],
    [">new", [["sticky-note", C.green, "New note", "Archives"], ["file-code", C.cyan, "New file", "Orion"], ["layers", C.magenta, "New design", "XDesign"], ["book-open", C.green, "New journal entry", "Archives"]]],
    ["shader", [["zap", C.magenta, "Aurora layer", "FX"], ["code-xml", C.cyan, "shader.glsl", "learn/"], ["sticky-note", C.green, "Noise basics", "Note"], ["sparkles", C.violet, "Learning GLSL", "Chat"]]],
  ];
  const draw = (rows, on) => {
    ul.innerHTML = rows.map(([i, c, t, s], n) => `<li class="${n === on ? "on" : ""}" style="animation-delay:${n * 60}ms"><span class="sw" style="--c:${c}"><svg class="ic"><use href="#i-${i}"/></svg></span>${esc(t)}<small>${esc(s)}</small></li>`).join("");
  };
  (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; ; s = (s + 1) % scenes.length) {
      const [q, rows] = scenes[s];
      await waitVisible();
      typed.textContent = "";
      ul.innerHTML = "";
      for (const ch of q) {
        typed.textContent += ch;
        await sleep(motion.reduced ? 0 : 120);
      }
      draw(rows, 0);
      for (let k = 1; k < 3; k++) {
        await sleep(motion.reduced ? 2000 : 900);
        ul.querySelectorAll("li").forEach((li, n) => li.classList.toggle("on", n === k));
      }
      await sleep(2200);
    }
  })();
}
