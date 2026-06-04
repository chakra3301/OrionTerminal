// === Wallpaper ===

function Wallpaper() {
  // Orion constellation roughly
  const stars = [
    { x: 30, y: 20, bright: true, name: "Betelgeuse" },
    { x: 170, y: 50, bright: true, name: "Bellatrix" },
    { x: 95, y: 110, bright: false },
    { x: 110, y: 130, bright: true },
    { x: 130, y: 150, bright: false },
    { x: 50, y: 220, bright: true, name: "Rigel" },
    { x: 180, y: 240, bright: false, name: "Saiph" },
  ];
  const lines = [[0,2],[1,2],[2,3],[3,4],[2,5],[2,6]];
  return (
    <div className="wallpaper">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="wallpaper-stars" />
      <div className="wallpaper-grid" />
      <div className="wallpaper-horizon" />
      <div className="constellation">
        <svg viewBox="0 0 220 280">
          {lines.map(([a,b], i) => (
            <line key={i} x1={stars[a].x+2} y1={stars[a].y+2} x2={stars[b].x+2} y2={stars[b].y+2} />
          ))}
        </svg>
        {stars.map((s, i) => (
          <div key={i} className={"star" + (s.bright ? " bright" : "")} style={{ left: s.x, top: s.y }} />
        ))}
      </div>
    </div>
  );
}

// === Menu bar ===

function MenuBar({ activeApp, onCommand }) {
  const [time, setTime] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const items = activeApp === "archives" ? ["File", "Edit", "View", "Insert", "Format"]
    : activeApp === "orion" ? ["File", "Edit", "Selection", "View", "Run", "Terminal"]
    : activeApp === "xdesign" ? ["File", "Edit", "Object", "Type", "Effect", "View"]
    : ["File", "Edit", "View", "Window"];
  return (
    <div className="menubar">
      <div className="menubar-logo">
        <span className="dot" />
        <span>ORION TERMINAL</span>
      </div>
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
      <div className="menubar-items">
        <span style={{ color: "var(--t-primary)", fontWeight: 600, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {activeApp === "archives" ? "Archives 47" : activeApp === "orion" ? "Orion" : activeApp === "xdesign" ? "XDesign" : "Desktop"}
        </span>
        {items.map(it => <span key={it} style={{ cursor: "pointer" }}>{it}</span>)}
      </div>
      <div className="menubar-spacer" />
      <div className="menubar-status">
        <span className="pill">
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--neon-green)", boxShadow: "0 0 6px var(--neon-green)" }} />
          CLAUDE • ONLINE
        </span>
        <span style={{ color: "var(--t-secondary)" }}><window.I.wifi size={13} /></span>
        <span style={{ color: "var(--t-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
          <window.I.battery size={14} /> 84%
        </span>
        <span style={{ color: "var(--t-tertiary)" }}>{date}</span>
        <span style={{ color: "var(--t-primary)" }}>{fmt}</span>
      </div>
    </div>
  );
}

window.Wallpaper = Wallpaper;
window.MenuBar = MenuBar;
