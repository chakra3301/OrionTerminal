// === Archives 47 application ===

function ArchivesApp() {
  const [view, setView] = React.useState("today");
  const nav = [
    { id: "today", label: "Today", icon: "calendar", badge: "May 13" },
    { id: "journal", label: "Journal", icon: "pen" },
    { id: "notes", label: "Notes", icon: "file", badge: "47" },
    { id: "mood", label: "Mood Boards", icon: "image", badge: "12" },
    { id: "media", label: "Media", icon: "layers" },
  ];
  const collections = [
    { id: "personal", label: "Personal", color: "var(--neon-green)" },
    { id: "work", label: "Work", color: "var(--neon-cyan)" },
    { id: "research", label: "Research", color: "var(--neon-yellow)" },
    { id: "dreams", label: "Dreams & ideas", color: "var(--neon-magenta)" },
  ];

  return (
    <>
      <div className="sidebar">
        <div style={{ position: "relative", margin: "4px 4px 10px" }}>
          <window.I.search size={12} style={{ position: "absolute", left: 9, top: 8, color: "var(--t-tertiary)" }} />
          <input
            placeholder="Search archives…"
            style={{
              width: "100%", padding: "6px 10px 6px 28px",
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8, fontSize: 12,
            }}
          />
        </div>
        <div className="sidebar-section">Library</div>
        {nav.map(n => {
          const IconCmp = window.I[n.icon];
          return (
            <div key={n.id} className={"nav-item" + (view === n.id ? " active" : "")} onClick={() => setView(n.id)}>
              <IconCmp size={14} />
              <span>{n.label}</span>
              {n.badge && <span className="badge">{n.badge}</span>}
            </div>
          );
        })}
        <div className="sidebar-section">Collections</div>
        {collections.map(c => (
          <div key={c.id} className="nav-item">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
            <span>{c.label}</span>
          </div>
        ))}
        <div className="sidebar-section">Tags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 6px" }}>
          {["#midnight", "#systems", "#north-star", "#design", "#claude", "#orion-build"].map(t => (
            <span key={t} className="tag" style={{ fontSize: 10 }}>{t}</span>
          ))}
        </div>
      </div>

      <div className="main">
        <ArchivesToolbar view={view} />
        <div className="ar-content scroll">
          {view === "today" && <ArchivesToday onOpen={() => setView("journal")} />}
          {view === "journal" && <ArchivesJournal />}
          {view === "notes" && <ArchivesNotes />}
          {view === "mood" && <ArchivesMood />}
          {view === "media" && <ArchivesMedia />}
        </div>
      </div>

      <window.ClaudeChat
        name="Archive Assistant"
        sub="indexed · 1,284 notes · 412 media"
        accent="var(--neon-green)"
        systemHint="You are Claude embedded in Archives 47, the user's personal knowledge base for notes, journals, and mood boards. Help organize, summarize, find connections between ideas, suggest tags, and capture thoughts. Be warm and concise (1-3 sentences)."
        suggestions={["Summarize today's notes", "Find linked ideas", "Suggest tags", "What did I journal last week?"]}
        initialMessages={[
          { role: "assistant", content: "I noticed you wrote about Orion Terminal yesterday and again this morning — want me to start a thread linking the two entries?" },
        ]}
      />
    </>
  );
}

function ArchivesToolbar({ view }) {
  const labels = {
    today: "Today",
    journal: "Journal · The night Orion came online",
    notes: "Notes",
    mood: "Mood boards · Liquid HUD",
    media: "Media library",
  };
  return (
    <div className="ar-toolbar">
      <div className="crumb">
        <span>Archives 47</span>
        <span className="sep">/</span>
        <span className="here">{labels[view]}</span>
      </div>
      <div style={{ flex: 1 }} />
      <button className="icon-btn"><window.I.share size={14} /></button>
      <button className="icon-btn"><window.I.star size={14} /></button>
      <button className="icon-btn"><window.I.plus size={14} /></button>
      <button className="icon-btn"><window.I.more size={14} /></button>
    </div>
  );
}

function ArchivesToday({ onOpen }) {
  return (
    <>
      <div className="ar-today-hero">
        <div>
          <div className="date">Wed · May 13 · 2026</div>
          <h1>Good evening, Eli.</h1>
        </div>
        <div className="quote">"You are not behind. You are exactly where the work needed you to be." — yesterday's note to self</div>
      </div>

      <div className="ar-today-grid">
        <div>
          <div className="ar-card">
            <h3><span className="dot" /> Today's journal</h3>
            <div className="ar-journal-entry" onClick={onOpen}>
              <div className="meta">07:42 · morning pages</div>
              <div className="title">The night Orion came online</div>
              <div className="preview">Stayed up until 3am wiring the dock animation. Something about watching the constellation light up made the whole project feel real. Need to remember this for the launch story…</div>
            </div>
            <div className="ar-journal-entry">
              <div className="meta">14:15 · field note</div>
              <div className="title">Coffee with M. — synthwave is back</div>
              <div className="preview">She pulled up a 2018 mood board on her phone. I think we're in a third or fourth wave of '80s revival, but this time it's quieter, more architectural…</div>
            </div>
          </div>

          <div className="ar-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" style={{ background: "var(--neon-cyan)", boxShadow: "0 0 6px var(--neon-cyan)" }} /> Recent threads</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { t: "Orion Terminal — north star", tag: "systems", color: "green" },
                { t: "Tools that disappear", tag: "philosophy", color: "cyan" },
                { t: "Liquid materiality", tag: "design", color: "magenta" },
                { t: "On waking up at 3am", tag: "self", color: "yellow" },
              ].map(t => (
                <div key={t.t} style={{
                  padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8,
                  background: "rgba(255,255,255,0.015)", cursor: "pointer",
                }}>
                  <div style={{ fontSize: 13, color: "var(--t-primary)", marginBottom: 4 }}>{t.t}</div>
                  <span className={"tag " + t.color}>#{t.tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="ar-card">
            <h3><span className="dot" style={{ background: "var(--neon-yellow)", boxShadow: "0 0 6px var(--neon-yellow)" }} /> Captured today</h3>
            <div className="ar-media-row">
              <div className="placeholder-img ph">PHOTO</div>
              <div className="placeholder-img ph" style={{ background: "linear-gradient(135deg, rgba(177,76,255,0.2), rgba(255,62,165,0.2))" }}>SCREEN</div>
              <div className="placeholder-img ph" style={{ background: "linear-gradient(135deg, rgba(57,255,136,0.2), rgba(0,224,255,0.2))" }}>VIDEO</div>
              <div className="placeholder-img ph">VOICE</div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--t-tertiary)", fontFamily: "var(--f-mono)" }}>
              4 captures · 2 auto-tagged by Claude
            </div>
          </div>

          <div className="ar-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" style={{ background: "var(--neon-magenta)", boxShadow: "0 0 6px var(--neon-magenta)" }} /> On this day, last year</h3>
            <div style={{ fontSize: 13, color: "var(--t-secondary)", lineHeight: 1.7, fontStyle: "italic" }}>
              "Sketched a workstation concept I'm calling 'the terminal'. The idea is everything in one window, organized by feel not folder. Not sure if it's anything yet."
            </div>
            <div style={{ marginTop: 10, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--neon-cyan)", letterSpacing: "0.1em" }}>
              MAY 13 · 2025
            </div>
          </div>

          <div className="ar-card" style={{ marginTop: 14, background: "linear-gradient(135deg, rgba(57,255,136,0.04), rgba(0,224,255,0.02))", borderColor: "rgba(57,255,136,0.18)" }}>
            <h3 style={{ color: "var(--neon-green)" }}>
              <window.I.sparkles size={12} /> Claude's read of your week
            </h3>
            <div style={{ fontSize: 13, color: "var(--t-secondary)", lineHeight: 1.6 }}>
              Three recurring threads this week: <span style={{ color: "var(--neon-green)" }}>tools that disappear</span>, <span style={{ color: "var(--neon-cyan)" }}>night work</span>, and <span style={{ color: "var(--neon-yellow)" }}>finishing energy</span>. Two unfinished entries waiting on you.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.ArchivesApp = ArchivesApp;
