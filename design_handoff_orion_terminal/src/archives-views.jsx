// === Archives 47 — Journal, Notes, Mood, Media views ===

function ArchivesJournal() {
  const tools = [
    [{ icon: "heading", label: "H1" }, { icon: "bold" }, { icon: "italic" }],
    [{ icon: "list" }, { icon: "quote" }, { icon: "code" }],
    [{ icon: "image" }, { icon: "link" }],
  ];
  return (
    <>
      <div className="ar-editor-bar">
        {tools.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <div className="sep" />}
            {group.map((t, i) => {
              const IconCmp = window.I[t.icon];
              return <button key={i} className={"b" + (i === 0 && gi === 0 ? "" : "")}><IconCmp size={14} /></button>;
            })}
          </React.Fragment>
        ))}
        <div style={{ flex: 1 }} />
        <span className="tag green">draft · auto-saved 14:42</span>
      </div>
      <div className="ar-editor-page">
        <h1>The night Orion came online</h1>
        <div className="stamp">
          <span>WED · MAY 13 · 07:42</span>
          <span style={{ color: "var(--t-faint)" }}>·</span>
          <span className="tag cyan">#orion-build</span>
          <span className="tag">#systems</span>
        </div>
        <p>
          Stayed up until 3am wiring the dock animation. Something about watching the constellation light up — those seven points snapping into place across the wallpaper — made the whole project feel real for the first time. Not a pitch deck. Not a sketch. A thing I can open and use.
        </p>
        <blockquote>
          The best tools have a moment where they stop being a project and start being a place. Last night was that.
        </blockquote>
        <p>
          I think the reason this matters more than the previous attempts is that I stopped trying to make it look like an OS and started letting it feel like a workshop. Archives is the back wall — sketches pinned up, notebooks open. Orion is the workbench. XDesign is the easel. Claude is whoever happens to be in the room with me at 3am.
        </p>
        <h2>What worked tonight</h2>
        <ul>
          <li>Letting the wallpaper breathe. The aurora layer was too saturated until I dropped it to 35%.</li>
          <li>Glass on glass on glass. The dock floats over the wallpaper, the windows float over the dock's blur, and the menubar quietly anchors everything.</li>
          <li>Letting Claude live inside each app instead of hovering above. It feels like a colleague at the next desk.</li>
        </ul>
        <div className="ai-callout">
          <window.I.sparkles size={14} stroke="var(--neon-green)" />
          <div>
            <div className="label">Claude noted</div>
            This is the third entry this month where you described a tool as a "place." Want me to start a thread? I can pull the May 2 and April 27 entries into a single board.
          </div>
        </div>
        <p>
          Tomorrow: get XDesign's vector tool to feel less like a Figma clone. The thing that always bothered me about Figma was that it imagined design as object-manipulation, when most of the time it's mood-translation. I want the canvas to feel more like Photoshop's painterly looseness and less like a CAD program.
        </p>
        <p style={{ color: "var(--t-tertiary)" }}>
          [continue writing]
        </p>
      </div>
    </>
  );
}

function ArchivesNotes() {
  const notes = [
    { t: "Tools that disappear", p: "The best interfaces are the ones you stop noticing. Like a paintbrush in your hand — once it's the right one, you just paint…", tag: "philosophy", color: "cyan", date: "May 11" },
    { t: "Liquid materiality", p: "Frosted glass works because it pretends to be a thing. Pretends to refract. Pretends to be cold to the touch. The illusion is the point…", tag: "design", color: "magenta", date: "May 9" },
    { t: "On waking up at 3am", p: "Three things I keep finding at 3am: clarity, grief, and the next move. Usually in that order…", tag: "self", color: "yellow", date: "May 8" },
    { t: "Notes from Iron Man rewatch", p: "Jarvis works because Tony talks to him like a peer, not a service. The whole vibe of the interface is 'we are in this together.'", tag: "research", color: "green", date: "May 5" },
    { t: "Orion Terminal — north star", p: "A workstation that's a collaborator, not a launcher. Apps as rooms. Claude as ambient presence…", tag: "systems", color: "green", date: "May 4" },
    { t: "What Cursor got right", p: "Inline diffs. Cmd-K. Chat that has read your whole project. The wrong thing: making it feel like an IDE with a chat plugin instead of a notebook with code in it…", tag: "research", color: "cyan", date: "May 3" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
      {notes.map(n => (
        <div key={n.t} className="ar-card" style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className={"tag " + n.color}>#{n.tag}</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--t-tertiary)", letterSpacing: "0.08em" }}>{n.date}</span>
          </div>
          <div style={{ fontSize: 16, color: "var(--t-primary)", marginBottom: 8, fontWeight: 500 }}>{n.t}</div>
          <div style={{ fontSize: 13, color: "var(--t-secondary)", lineHeight: 1.6 }}>{n.p}</div>
        </div>
      ))}
    </div>
  );
}

function ArchivesMood() {
  // hand-curated palette of "tiles" — using gradient placeholders to evoke liquid HUD vibes
  const tiles = [
    { h: 200, label: "Cyan refraction · still", grad: "linear-gradient(135deg, #00e0ff, #b14cff)" },
    { h: 140, label: "Glass on glass", grad: "linear-gradient(160deg, rgba(255,255,255,0.4), rgba(0,224,255,0.2), transparent)" },
    { h: 280, label: "Vaporwave horizon · S+G", grad: "linear-gradient(to bottom, #b14cff 0%, #ff3ea5 40%, #ff9a4c 70%, #e6ff3a 100%)" },
    { h: 160, label: "Wireframe topology · 03", grad: "linear-gradient(135deg, #0a1015, #1a2030)" },
    { h: 220, label: "Neon green on near-black", grad: "linear-gradient(135deg, #050a0d 0%, #39ff88 100%)" },
    { h: 180, label: "Severance refit interior", grad: "linear-gradient(180deg, #1a1f24, #4a5560)" },
    { h: 260, label: "Tron grid · perspective", grad: "linear-gradient(180deg, #03060a 30%, #00e0ff 100%)" },
    { h: 150, label: "Liquid mercury", grad: "linear-gradient(135deg, #c8d4e0, #5a6a7a, #c8d4e0)" },
    { h: 200, label: "Iron Man HUD · 2008", grad: "linear-gradient(135deg, #ff9a4c, #ff3ea5)" },
    { h: 180, label: "Visionos crystalline glass", grad: "linear-gradient(135deg, rgba(255,255,255,0.2), rgba(0,224,255,0.15))" },
    { h: 240, label: "Constellation drawing · ink", grad: "radial-gradient(circle at 30% 30%, #fff 1px, transparent 1px), radial-gradient(circle at 70% 60%, #fff 1px, transparent 1px), #050a0d" },
    { h: 170, label: "Acid green moment", grad: "linear-gradient(135deg, #39ff88, #e6ff3a)" },
  ];

  return (
    <>
      <div className="ar-mood-board-header">
        <h2>Liquid HUD</h2>
        <span className="meta">12 tiles · last edit 2h ago</span>
        <div style={{ flex: 1 }} />
        <span className="tag cyan">collaborative</span>
        <span className="tag green">claude · curating</span>
      </div>
      <div className="ar-mood">
        {tiles.map((t, i) => (
          <div key={i} className="ar-mood-tile">
            <div className="ph placeholder-img" style={{ height: t.h, background: t.grad, fontSize: 0 }} />
            <div className="label">{t.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function ArchivesMedia() {
  const files = [
    { name: "orion-dock-spin.mov", type: "video", size: "12.4 MB", tag: "orion-build", color: "green" },
    { name: "constellation-final.svg", type: "vector", size: "8 KB", tag: "design", color: "magenta" },
    { name: "synth-horizon-ref.jpg", type: "image", size: "2.1 MB", tag: "mood", color: "cyan" },
    { name: "voice-memo-may13-3am.wav", type: "audio", size: "4.2 MB", tag: "thoughts", color: "yellow" },
    { name: "claude-conversation-04.md", type: "doc", size: "32 KB", tag: "research", color: "green" },
    { name: "iron-man-hud-frames.zip", type: "archive", size: "184 MB", tag: "research", color: "magenta" },
    { name: "type-pairing-tests.fig", type: "figma", size: "1.2 MB", tag: "design", color: "cyan" },
    { name: "wallpaper-aurora-v3.png", type: "image", size: "8.7 MB", tag: "orion-build", color: "green" },
    { name: "dream-may10.txt", type: "doc", size: "2 KB", tag: "personal", color: "yellow" },
    { name: "screen-2026-05-12.png", type: "image", size: "1.1 MB", tag: "ref", color: "violet" },
  ];
  const typeBg = {
    video: "linear-gradient(135deg, rgba(255,62,165,0.18), rgba(177,76,255,0.18))",
    vector: "linear-gradient(135deg, rgba(0,224,255,0.18), rgba(57,255,136,0.18))",
    image: "linear-gradient(135deg, rgba(230,255,58,0.15), rgba(255,154,76,0.18))",
    audio: "linear-gradient(135deg, rgba(57,255,136,0.18), rgba(0,224,255,0.10))",
    doc: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
    archive: "linear-gradient(135deg, rgba(177,76,255,0.18), rgba(255,62,165,0.10))",
    figma: "linear-gradient(135deg, rgba(0,224,255,0.18), rgba(177,76,255,0.18))",
  };

  return (
    <>
      <div className="ar-media-toolbar">
        <span className="tag green">All · 412</span>
        <span className="tag">Images · 184</span>
        <span className="tag">Video · 31</span>
        <span className="tag">Audio · 22</span>
        <span className="tag">Docs · 175</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--t-tertiary)", letterSpacing: "0.08em" }}>
          <window.I.filter size={11} /> auto-tagged by Claude
        </span>
        <button className="icon-btn"><window.I.grid size={14} /></button>
      </div>
      <div className="ar-media-grid">
        {files.map(f => (
          <div key={f.name} className="ar-media-tile">
            <div className="ph placeholder-img" style={{ background: typeBg[f.type] || typeBg.doc, height: 110 }}>
              {f.type.toUpperCase()}
            </div>
            <div className="meta">
              <div className="name">{f.name}</div>
              <div className="small" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{f.size}</span>
                <span className={"tag " + f.color} style={{ fontSize: 9, padding: "1px 5px" }}>#{f.tag}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

window.ArchivesJournal = ArchivesJournal;
window.ArchivesNotes = ArchivesNotes;
window.ArchivesMood = ArchivesMood;
window.ArchivesMedia = ArchivesMedia;
