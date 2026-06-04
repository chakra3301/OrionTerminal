// === Main app — wires shell + apps together ===

const { Wallpaper, MenuBar, WindowFrame, Dock, ClaudeChat, ArchivesApp, OrionApp, XDesignApp } = window;
const Icons = window.I;

const APPS = [
  { id: "archives", title: "Archives 47", icon: "archives", bg: "linear-gradient(135deg, rgba(57,255,136,0.18), rgba(0,224,255,0.10))", fg: "#39ff88", glow: "0 0 12px rgba(57,255,136,0.35)", titlebar: "ARCHIVES 47 · Today", accent: "var(--neon-green)" },
  { id: "orion", title: "Orion", icon: "orion", bg: "linear-gradient(135deg, rgba(0,224,255,0.18), rgba(177,76,255,0.12))", fg: "#00e0ff", glow: "0 0 12px rgba(0,224,255,0.35)", titlebar: "ORION · orion-terminal · Orion.tsx", accent: "var(--neon-cyan)" },
  { id: "xdesign", title: "XDesign", icon: "xdesign", bg: "linear-gradient(135deg, rgba(255,62,165,0.18), rgba(177,76,255,0.14))", fg: "#ff3ea5", glow: "0 0 12px rgba(255,62,165,0.35)", titlebar: "XDESIGN · orion-marketing", accent: "var(--neon-magenta)" },
];

function OrionTerminal() {
  const [windows, setWindows] = React.useState([
    { id: "archives", x: 60, y: 70, w: 1180, h: 740, z: 2, focused: false, minimized: false, maximized: false },
    { id: "orion", x: 220, y: 130, w: 1180, h: 720, z: 3, focused: true, minimized: false, maximized: false },
    { id: "xdesign", x: 380, y: 190, w: 1180, h: 700, z: 1, focused: false, minimized: false, maximized: false },
  ]);

  const focusWin = (id) => {
    setWindows(prev => {
      const maxZ = Math.max(...prev.map(w => w.z));
      return prev.map(w => ({ ...w, focused: w.id === id, z: w.id === id ? maxZ + 1 : w.z }));
    });
  };
  const launchWin = (id) => {
    setWindows(prev => {
      const existing = prev.find(w => w.id === id);
      if (existing) {
        const maxZ = Math.max(...prev.map(w => w.z));
        return prev.map(w => w.id === id ? { ...w, minimized: false, focused: true, z: maxZ + 1 } : { ...w, focused: false });
      }
      // shouldn't happen in this prototype
      return prev;
    });
  };
  const closeWin = (id) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: true, focused: false } : w));
  };
  const minWin = (id) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, minimized: true, focused: false } : w));
  };
  const maxWin = (id) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
  };

  const focusedId = windows.find(w => w.focused && !w.minimized)?.id;
  const openCount = windows.filter(w => !w.minimized).length;

  // Spotlight
  const [spotOpen, setSpotOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSpotOpen(s => !s);
      }
      if (e.key === "Escape") setSpotOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Wallpaper />
      <MenuBar activeApp={focusedId} />

      {windows.map(w => {
        const app = APPS.find(a => a.id === w.id);
        const Body = w.id === "archives" ? ArchivesApp : w.id === "orion" ? OrionApp : XDesignApp;
        return (
          <WindowFrame
            key={w.id}
            id={w.id}
            title={app.titlebar}
            accent={app.accent}
            x={w.x} y={w.y} width={w.w} height={w.h} z={w.z}
            focused={w.focused}
            minimized={w.minimized}
            maximized={w.maximized}
            onFocus={() => focusWin(w.id)}
            onClose={() => closeWin(w.id)}
            onMin={() => minWin(w.id)}
            onMax={() => maxWin(w.id)}
          >
            <Body />
          </WindowFrame>
        );
      })}

      <Dock
        apps={APPS}
        activeId={focusedId}
        onLaunch={launchWin}
        onSpotlight={() => setSpotOpen(true)}
      />

      {spotOpen && <Spotlight onClose={() => setSpotOpen(false)} onAction={(id) => { launchWin(id); setSpotOpen(false); }} />}
    </>
  );
}

function Spotlight({ onClose, onAction }) {
  const [q, setQ] = React.useState("");
  const items = [
    { id: "archives", label: "Open Archives 47", hint: "Today's journal", icon: "archives", k: "⌘1" },
    { id: "orion", label: "Open Orion", hint: "orion-terminal · 3 changes", icon: "orion", k: "⌘2" },
    { id: "xdesign", label: "Open XDesign", hint: "orion-marketing", icon: "xdesign", k: "⌘3" },
    { id: "claude", label: "Ask Claude anything", hint: "Global assistant", icon: "sparkles", k: "⌘↵" },
    { id: "new-journal", label: "New journal entry", hint: "Archives 47", icon: "pen", k: "" },
    { id: "new-canvas", label: "New design canvas", hint: "XDesign", icon: "square", k: "" },
  ];
  const filtered = q ? items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())) : items;
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 5000 }} onClick={onClose} />
      <div style={{
        position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)",
        width: 520, zIndex: 5001,
        background: "rgba(8,14,18,0.96)",
        border: "1px solid var(--glass-border-bright)",
        borderRadius: 16,
        boxShadow: "0 40px 100px -20px rgba(0,0,0,0.8), 0 0 60px -10px rgba(57,255,136,0.15)",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: 16, gap: 12, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="claude-orb" style={{ width: 20, height: 20 }} />
          <input
            autoFocus
            placeholder="Ask Claude, search archives, or run a command…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ flex: 1, fontSize: 16, color: "var(--t-primary)" }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {filtered.map((it, i) => {
            const IconCmp = window.I[it.icon] || Icons.sparkles;
            return (
              <div key={it.id} onClick={() => onAction(it.id)} style={{
                padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
                background: i === 0 ? "rgba(57,255,136,0.06)" : "transparent",
                borderLeft: i === 0 ? "2px solid var(--neon-green)" : "2px solid transparent",
                cursor: "pointer",
              }} onMouseEnter={e => { /* no-op */ }}>
                <IconCmp size={16} stroke={i === 0 ? "var(--neon-green)" : "var(--t-secondary)"} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: "var(--t-primary)" }}>{it.label}</div>
                  <div style={{ fontSize: 11, color: "var(--t-tertiary)", fontFamily: "var(--f-mono)" }}>{it.hint}</div>
                </div>
                {it.k && <span className="kbd">{it.k}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 14, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--t-tertiary)", letterSpacing: "0.1em" }}>
          <span><span className="kbd">↑↓</span> nav</span>
          <span><span className="kbd">↵</span> open</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: "var(--neon-green)" }}>● claude · listening</span>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<OrionTerminal />);
