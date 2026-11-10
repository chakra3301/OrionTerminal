import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Blocks, Download, ArrowUpRight, Pause, Play } from "lucide-react";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import { DockIcon } from "@/shell/dock/DockIcon";
import { drawOrb, type OrbCanvas } from "@/shell/dock/orbCanvas";
import { orbModel, particlePhysics } from "@/shell/dock/orbModel";
import { STARTER_SKILLS } from "@/features/agents/seedData";
import { ParticleOrb } from "./ParticleOrb";
import { subscribeOrb } from "./orbFrames";
import { generateGlyph } from "./glyph";
import { appGlyph } from "./appGlyph";
import { identityAccent, skillAccent } from "./color";
import { spatialIdentity, SPATIAL_LABELS } from "./spatialIdentity";
import { surfaceKind, SURFACE_LABELS } from "./particleSurface";
import "./preview.css";

const BASE = [
  { id: "archives", name: "Archives 47", color: "#39ff88" },
  { id: "orion", name: "Orion", color: "#00e0ff" },
  { id: "xdesign", name: "XDesign", color: "#ff3ea5" },
  { id: "incubator", name: "Incubator", color: "#b14cff" },
];
const EXAMPLES = [
  { id: "community:sonic-lab", name: "Sonic Lab", color: "#e6ff3a" },
  { id: "community:atlas", name: "Atlas", color: "#00e0ff" },
  { id: "community:studio-capture", name: "Capture", color: "#ff3ea5" },
  { id: "community:loom", name: "Loom", color: "#b14cff" },
  { id: "community:field-notes", name: "Field Notes", color: "#39ff88" },
  { id: "community:prism", name: "Prism", color: "#e6ff3a" },
].map((app) => ({ ...app, color: identityAccent(`app:${app.id}`) }));
const SKILLS = [...STARTER_SKILLS.map((s) => ({ ...s, accent: skillAccent(s.id, s.accent) })), { ...STARTER_SKILLS[0]!, id: "imported:motion-director", name: "Motion Director", accent: "#ff8a54" }, { ...STARTER_SKILLS[0]!, id: "imported:sound-design", name: "Sound Design", accent: "#47ddbc" }];

function ReferenceOrb({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, x = cv.getContext("2d")!;
    const q = Math.min(devicePixelRatio || 1, 2) * 1.25 * 2.5, P = Math.round(96 * q), model = orbModel();
    cv.width = cv.height = P;
    const orb: OrbCanvas = { x, P, R: 25 * q, q, model, color: "#00e0ff", coreColor: "#9ff6ff", m: null, last: null,
      st: { shell: particlePhysics(model.shell), nodes: particlePhysics(model.nodes), spikes: particlePhysics(model.spikes), core: particlePhysics(model.core) }, nodeXY: new Float32Array(model.nodes.pts.length * 3) };
    const start = performance.now();
    let stop: (() => void) | undefined, onscreen = true;
    const visibility = () => {
      stop?.(); stop = undefined; orb.m = orb.last = null;
      if (document.hidden || !onscreen) return;
      if (reduced) drawOrb(orb, 0, true);
      else stop = subscribeOrb((now) => drawOrb(orb, (now - start) / 1000, false));
    };
    const move = (e: PointerEvent) => {
      if (reduced || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const r = cv.getBoundingClientRect(); orb.m = { x: (e.clientX - r.left) * P / r.width, y: (e.clientY - r.top) * P / r.height };
    };
    const leave = () => { orb.m = orb.last = null; };
    cv.addEventListener("pointermove", move); cv.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => { onscreen = entry?.isIntersecting ?? false; visibility(); });
    observer.observe(cv); visibility();
    return () => { stop?.(); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerleave", leave); };
  }, [reduced]);
  return <canvas ref={ref} width="300" height="300" className="reference-orb" aria-label="Original Rosie particle orb" />;
}

function IconSample({ id, name, color, reduced, base = false }: { id: string; name: string; color: string; reduced: boolean; base?: boolean }) {
  const [lifted, setLifted] = useState(false);
  return <button type="button" className="icon-sample" onPointerEnter={() => setLifted(true)} onPointerLeave={() => setLifted(false)} onFocus={() => setLifted(true)} onBlur={() => setLifted(false)} style={{ "--dock-color": color } as CSSProperties} aria-label={`${name} · ${base ? "approved" : "generated"} icon`}>
    <span className="icon-bed"><DockIcon key={color} glyph={appGlyph(id)} Icon={Blocks} lifted={lifted} reduced={reduced} /></span>
    <span className="sample-name">{name}</span><span className="sample-meta"><i className="identity-swatch" style={{ background: color }} />{base ? "Approved reference" : generateGlyph(`app:${id}`).family}</span>
  </button>;
}

function Preview() {
  const [mono, setMono] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => { document.documentElement.dataset.colorMode = light ? "light" : "dark"; }, [light]);
  const [frozen, setFrozen] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [selected, setSelected] = useState(SKILLS[0]!);
  const [name, setName] = useState("Dream Journal");
  const [revision, setRevision] = useState(0);
  const customId = `preview:${name.trim().normalize("NFC").toLowerCase() || "untitled"}:${revision}`;
  const customGlyph = useMemo(() => generateGlyph(`app:${customId}`), [customId]);
  const customColor = mono ? "#00e0ff" : identityAccent(`app:${customId}`);
  const selectedSpatial = useMemo(() => spatialIdentity(`skill:${selected.id}`), [selected.id]);
  const exportGlyph = () => {
    const url = URL.createObjectURL(new Blob([customGlyph.svg], { type: "image/svg+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = "orion-generated-glyph.svg"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <header className="topbar"><a className="wordmark" href="#top">O.T <span>IDENTITY SYSTEM <i> / STUDY 01</i></span></a><nav><a href="#icons">App icons</a><a href="#orbs">Skill orbs</a><a href="#generator">Generator <ArrowUpRight size={13} /></a></nav></header>
    <main id="top">
      <div className="intro"><div><p className="eyebrow">ORION STUDIO · ALPHA</p><h1>A mark.<br /><span>A presence.</span></h1></div><div className="intro-copy"><p>One visual language for every app.<br />One living orb for every skill.</p><p className="muted">Your approved icons stay the source. Each skill gets a sculpted particle surface and a spatial form.</p><div className="controls"><label><input id="same-colour" type="checkbox" checked={mono} onChange={(e) => setMono(e.target.checked)} /> Same colour</label><label><input id="light-background" type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} /> Light background</label><button type="button" id="freeze" onClick={() => setFrozen(!frozen)}>{frozen ? <Play size={13} /> : <Pause size={13} />}{frozen ? "Resume motion" : "Freeze motion"}</button></div></div></div>
      <section id="orbs" className="orb-study"><div className="section-line"><h2>01 / THE LIVING FIELD</h2><span>Move through the particles.</span></div>
        <div className="orb-comparison"><article className="orb-specimen"><div className="specimen-label"><span>THE REFERENCE</span><span>R.O.S.I.E</span></div><div className="specimen-stage"><ReferenceOrb reduced={frozen} /></div><footer><strong>The original.</strong><p>Untouched. Independent particles,<br />breathing core and spring response.</p></footer></article>
        <article className="orb-specimen"><div className="specimen-label"><span>THE NEW SURFACES</span><span>SKILL ORB</span></div><div className="specimen-stage"><ParticleOrb identity={`skill:${selected.id}`} accent={mono ? "#00e0ff" : selected.accent} size={176} reduced={frozen} /></div><footer><strong>{selected.name}</strong><p>{SPATIAL_LABELS[selectedSpatial.kind]}.<br />{SURFACE_LABELS[surfaceKind(`skill:${selected.id}`, selectedSpatial.kind)]}.</p></footer></article>
        <aside className="glyph-detail"><span className="eyebrow">THE SPATIAL FORM</span><ParticleOrb identity={`skill:${selected.id}`} accent={mono ? "#00e0ff" : selected.accent} size={128} reduced={frozen} showField={false} /><h3>{SPATIAL_LABELS[selectedSpatial.kind]}.</h3><p>Volume, crossings and changing perspective. Every structure extends through space.</p><p className="smallprint">Select a skill below to inspect it.</p></aside></div>
        <div className="skill-strip" aria-label="Skill orb examples">{SKILLS.map((s) => <button key={s.id} type="button" className={`skill-sample${selected.id === s.id ? " selected" : ""}`} aria-pressed={selected.id === s.id} onClick={() => setSelected(s)}><ParticleOrb identity={`skill:${s.id}`} accent={mono ? "#00e0ff" : s.accent} size={72} reduced={frozen} /><span>{s.name}</span><i>{SPATIAL_LABELS[spatialIdentity(`skill:${s.id}`).kind]}</i></button>)}</div>
      </section>
      <section id="icons"><div className="section-line"><h2>02 / THE ICON FAMILY</h2><span>Hover or focus to lift the glass.</span></div><div className="icon-families"><div><h3>The originals.</h3><p className="muted">Your four approved silhouettes, preserved.</p><div className="icon-grid approved">{BASE.map((app) => <IconSample key={app.id} {...app} color={mono ? "#00e0ff" : app.color} reduced={frozen} base />)}</div></div><div><h3>What comes next.</h3><p className="muted">Generated silhouettes. The same glass, rim light and bloom.</p><div className="icon-grid generated">{EXAMPLES.map((app) => <IconSample key={app.id} {...app} color={mono ? "#00e0ff" : app.color} reduced={frozen} />)}</div></div></div></section>
      <section id="generator" className="generator"><div><p className="eyebrow">03 / TRY A NEW IDENTITY</p><h2>No custom<br />artwork needed.</h2><p className="muted">Enter a name to try the shape system. In Orion, the saved app or skill ID keeps its mark stable when its name or colour changes.</p><label className="name-label" htmlFor="identity-name">App or skill name</label><input id="identity-name" maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setRevision(0); }} /><div className="generator-actions"><button type="button" onClick={() => setRevision((r) => r + 1)}>Try another identity <ArrowUpRight size={14} /></button><button type="button" onClick={exportGlyph}><Download size={14} /> Export glyph</button></div></div>
        <div className="generated-specimens"><div><IconSample key={customId} id={customId} name={name.trim() || "Untitled"} color={customColor} reduced={frozen} /><span className="eyebrow">APP / PLUGIN</span></div><div><ParticleOrb identity={`app:${customId}`} accent={customColor} size={144} reduced={frozen} /><span className="eyebrow">A SPATIAL IDENTITY & LIVING FIELD</span></div></div>
      </section>
    </main><footer className="page-footer"><span>ORION STUDIO / GENERATIVE IDENTITY</span><p>Local generation. Stable identities. No image service or manual uploads.</p><span>DESIGN REVIEW · UNCOMMITTED</span></footer>
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
