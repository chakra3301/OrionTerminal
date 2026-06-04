// === XDesign app ===

const XD_TOOLS = [
  { id: "move", icon: "move", k: "V" },
  { id: "hand", icon: "hand", k: "H" },
  { id: "rect", icon: "square", k: "R" },
  { id: "ellipse", icon: "circle", k: "E" },
  { id: "vector", icon: "vector", k: "P" },
  { id: "text", icon: "type", k: "T" },
  { id: "image", icon: "image", k: "I" },
  { id: "pen", icon: "pen", k: "B" },
];

const XD_LAYERS = [
  { id: "bg", name: "Background", swatch: "#03060a", depth: 0 },
  { id: "aurora", name: "Aurora · violet", swatch: "linear-gradient(135deg,#b14cff,#ff3ea5)", depth: 0 },
  { id: "horizon", name: "Synthwave horizon", swatch: "linear-gradient(90deg,#00e0ff,#39ff88,#e6ff3a)", depth: 0 },
  { id: "grid", name: "Perspective grid", swatch: "#00e0ff", depth: 0, locked: true },
  { id: "windows", name: "▼ Window stack", swatch: "rgba(255,255,255,0.1)", depth: 0, group: true },
  { id: "w-archives", name: "Archives 47", swatch: "#39ff88", depth: 1, selected: true },
  { id: "w-orion", name: "Orion editor", swatch: "#00e0ff", depth: 1 },
  { id: "w-xdesign", name: "XDesign", swatch: "#ff3ea5", depth: 1 },
  { id: "dock", name: "Dock · pill", swatch: "rgba(255,255,255,0.15)", depth: 0 },
  { id: "menubar", name: "Menu bar", swatch: "rgba(0,0,0,0.5)", depth: 0 },
];

function XDToolRail({ active, onSelect }) {
  return (
    <div className="xd-toolrail">
      {XD_TOOLS.map((t, i) => {
        if (i === 2 || i === 6) {
          return (
            <React.Fragment key={t.id}>
              {i === 2 || i === 6 ? <div className="xd-tool-divider" /> : null}
              <ToolBtn t={t} active={active} onSelect={onSelect} />
            </React.Fragment>
          );
        }
        return <ToolBtn key={t.id} t={t} active={active} onSelect={onSelect} />;
      })}
      <div style={{ marginTop: "auto" }} />
      <div className="xd-tool" title="AI tool">
        <window.I.sparkles size={16} stroke="var(--neon-green)" />
      </div>
    </div>
  );
}

function ToolBtn({ t, active, onSelect }) {
  const IconCmp = window.I[t.icon];
  return (
    <div className={"xd-tool" + (active === t.id ? " active" : "")} onClick={() => onSelect(t.id)} title={t.id}>
      <IconCmp size={16} />
      <span className="kbd">{t.k}</span>
    </div>
  );
}

function XDLayers({ selected, onSelect }) {
  return (
    <div className="xd-panels">
      <div className="xd-panel-tabs">
        <div className="t active">Layers</div>
        <div className="t">Assets</div>
        <div className="t">Pages</div>
      </div>
      <div className="xd-panel-body scroll">
        <div className="xd-section">Page · orion-marketing</div>
        {XD_LAYERS.map(l => (
          <div
            key={l.id}
            className={"xd-layer" + (selected === l.id ? " selected" : "") + (l.locked ? " locked" : "")}
            style={{ paddingLeft: 10 + l.depth * 14 }}
            onClick={() => onSelect(l.id)}
          >
            <span className="swatch" style={{ background: l.swatch }} />
            <span className="name">{l.name}</span>
            <window.I.eye size={11} className="ic" />
            <window.I.lock size={11} className="ic lock-on" />
          </div>
        ))}
        <div className="xd-section" style={{ marginTop: 16 }}>Recent · auto-saved</div>
        <div style={{ padding: "0 12px", fontSize: 11, color: "var(--t-tertiary)", lineHeight: 1.7 }}>
          <div>orion-hero · 2m ago</div>
          <div>onboarding-flow · 1h ago</div>
          <div>landing-page · yesterday</div>
        </div>
      </div>
    </div>
  );
}

function XDCanvas() {
  // The "design" being built is a stylized version of Orion Terminal itself
  return (
    <div className="xd-canvas-area">
      <div className="xd-canvas-bar">
        <span className="zoom">100%</span>
        <span style={{ color: "var(--t-faint)" }}>·</span>
        <span>X 2,847</span>
        <span>Y 1,632</span>
        <div style={{ flex: 1 }} />
        <span className="pill">Archives 47 · Frame</span>
        <span style={{ color: "var(--t-faint)" }}>1280 × 800</span>
        <span style={{ color: "var(--neon-cyan)" }}>✦ Claude designing</span>
      </div>
      <div className="xd-canvas-stage">
        <div className="xd-canvas-inner">
          {/* the canvas frame */}
          <div className="xd-artboard" style={{ width: 540, height: 340, left: -270, top: -170, position: "relative" }}>
            <div className="xd-artboard-label">
              Orion Hero / Frame 02 <span className="res">540 × 340</span>
            </div>

            {/* wallpaper layer */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse 400px 200px at 50% 110%, rgba(177,76,255,0.4), transparent 60%), radial-gradient(circle at 30% 20%, rgba(0,224,255,0.2), transparent 50%), radial-gradient(circle, #07101a, #03060a)",
            }} />
            <div style={{
              position: "absolute", left: "-10%", right: "-10%", bottom: "-10%", height: "55%",
              backgroundImage: "linear-gradient(to right, rgba(0,224,255,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,224,255,0.25) 1px, transparent 1px)",
              backgroundSize: "30px 30px",
              transform: "perspective(300px) rotateX(60deg)",
              transformOrigin: "50% 100%",
              opacity: 0.5,
            }} />
            <div style={{
              position: "absolute", left: 0, right: 0, bottom: "45%", height: 1,
              background: "linear-gradient(to right, transparent, #00e0ff, #39ff88, #e6ff3a, transparent)",
              filter: "blur(0.5px)",
              boxShadow: "0 0 12px #00e0ff",
            }} />

            {/* mini menu bar */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 16, background: "rgba(3,6,10,0.85)", display: "flex", alignItems: "center", padding: "0 8px", gap: 6, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#39ff88", boxShadow: "0 0 4px #39ff88" }} />
              <span style={{ fontSize: 7, color: "#e6f4ec", letterSpacing: "0.2em", fontFamily: "var(--f-mono)" }}>ORION TERMINAL</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 7, color: "#9ab0a8", fontFamily: "var(--f-mono)" }}>20:18:42</span>
            </div>

            {/* mini Archives window - SELECTED */}
            <div style={{
              position: "absolute", left: 50, top: 50, width: 340, height: 200,
              background: "rgba(8,14,18,0.92)",
              border: "1px solid rgba(180,255,220,0.18)",
              borderRadius: 8,
              boxShadow: "0 20px 40px -10px rgba(0,0,0,0.6)",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
              <div style={{ height: 18, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", padding: "0 6px", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff5e5e" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e6ff3a" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#39ff88" }} />
                <span style={{ fontSize: 6, color: "#9ab0a8", letterSpacing: "0.15em", marginLeft: 8 }}>ARCHIVES 47</span>
              </div>
              <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                <div style={{ width: 70, borderRight: "1px solid rgba(255,255,255,0.05)", padding: 6, fontSize: 6, color: "#9ab0a8", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ padding: "2px 4px", borderRadius: 3, background: "rgba(57,255,136,0.12)", boxShadow: "inset 1px 0 0 #39ff88", color: "#e6f4ec" }}>Today</div>
                  <div>Journal</div>
                  <div>Notes</div>
                  <div>Mood</div>
                  <div>Media</div>
                </div>
                <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 10, color: "#e6f4ec", letterSpacing: "-0.01em" }}>Good evening, Eli.</div>
                  <div style={{ height: 30, borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", padding: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ height: 2, background: "rgba(255,255,255,0.1)", width: "60%", borderRadius: 1 }} />
                    <div style={{ height: 2, background: "rgba(255,255,255,0.06)", width: "80%", borderRadius: 1 }} />
                    <div style={{ height: 2, background: "rgba(255,255,255,0.06)", width: "40%", borderRadius: 1 }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, marginTop: 2 }}>
                    {["rgba(57,255,136,0.2)","rgba(0,224,255,0.2)","rgba(255,62,165,0.2)","rgba(230,255,58,0.2)"].map((c,i) => (
                      <div key={i} style={{ height: 16, background: c, borderRadius: 3 }} />
                    ))}
                  </div>
                </div>
                <div style={{ width: 60, borderLeft: "1px solid rgba(255,255,255,0.05)", padding: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, #fff, #39ff88, #00e0ff)", boxShadow: "0 0 6px rgba(57,255,136,0.5)" }} />
                  <div style={{ marginTop: 4, height: 12, borderRadius: 2, background: "rgba(57,255,136,0.08)", border: "1px solid rgba(57,255,136,0.2)" }} />
                  <div style={{ marginTop: 3, height: 12, borderRadius: 2, background: "rgba(255,255,255,0.04)" }} />
                </div>
              </div>
            </div>
            {/* selection overlay on Archives window */}
            <div className="xd-selection" style={{ left: 50, top: 50, width: 340, height: 200 }}>
              <div className="xd-handle tl" />
              <div className="xd-handle tr" />
              <div className="xd-handle bl" />
              <div className="xd-handle br" />
              <div className="xd-handle t" />
              <div className="xd-handle b" />
              <div className="xd-handle l" />
              <div className="xd-handle r" />
              <div className="xd-floating-label">340 × 200</div>
            </div>

            {/* mini dock */}
            <div style={{
              position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
              display: "flex", gap: 4, padding: "4px 6px",
              background: "rgba(8,14,18,0.85)",
              border: "1px solid rgba(180,255,220,0.18)", borderRadius: 8,
            }}>
              {["#39ff88","#00e0ff","#ff3ea5"].map((c,i) => (
                <div key={i} style={{ width: 16, height: 16, borderRadius: 3, background: `linear-gradient(135deg, ${c}, rgba(0,0,0,0.4))`, boxShadow: `0 0 6px ${c}40` }} />
              ))}
              <div style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, #fff, #39ff88, #00e0ff)" }} />
            </div>
          </div>

          {/* a second artboard nearby (Frame 01) */}
          <div className="xd-artboard" style={{ width: 280, height: 180, left: 320, top: -200, position: "absolute" }}>
            <div className="xd-artboard-label">
              Onboarding / Frame 01 <span className="res">280 × 180</span>
            </div>
            <div style={{ width: "100%", height: "100%", background: "radial-gradient(circle at 50% 60%, rgba(57,255,136,0.15), transparent 60%), #060a0f", display: "grid", placeItems: "center" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, #fff, #39ff88, #00e0ff)", boxShadow: "0 0 16px #39ff88" }} />
            </div>
          </div>

          {/* a third artboard */}
          <div className="xd-artboard" style={{ width: 220, height: 180, left: -540, top: -180, position: "absolute" }}>
            <div className="xd-artboard-label">
              Logo / Mark <span className="res">220 × 180</span>
            </div>
            <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#060a0f" }}>
              <svg width="100" height="120" viewBox="0 0 100 120">
                <g stroke="#00e0ff" strokeWidth="0.5" fill="none" opacity="0.4">
                  <line x1="20" y1="20" x2="80" y2="40" />
                  <line x1="80" y1="40" x2="50" y2="60" />
                  <line x1="50" y1="60" x2="55" y2="75" />
                  <line x1="55" y1="75" x2="65" y2="90" />
                  <line x1="50" y1="60" x2="30" y2="100" />
                </g>
                <circle cx="20" cy="20" r="3" fill="#fff" />
                <circle cx="80" cy="40" r="3" fill="#fff" />
                <circle cx="50" cy="60" r="2" fill="#00e0ff" />
                <circle cx="55" cy="75" r="2" fill="#00e0ff" />
                <circle cx="65" cy="90" r="2" fill="#00e0ff" />
                <circle cx="30" cy="100" r="3" fill="#39ff88" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function XDInspector() {
  return (
    <div className="xd-inspector">
      <div className="xd-panel-tabs">
        <div className="t active">Design</div>
        <div className="t">Prototype</div>
      </div>
      <div className="xd-panel-body scroll">
        <div className="xd-section">Frame · Archives 47</div>
        <div className="field"><span className="lbl">X / Y</span><span className="val row"><span>50</span><span>50</span></span></div>
        <div className="field"><span className="lbl">W / H</span><span className="val row"><span>340</span><span>200</span></span></div>
        <div className="field"><span className="lbl">Rotate</span><span className="val">0°</span></div>
        <div className="field"><span className="lbl">Radius</span><span className="val">8</span></div>

        <div className="xd-section">Fill</div>
        <div className="field"><span className="lbl">Glass</span>
          <span className="xd-color-input">
            <span className="sw" style={{ background: "rgba(8,14,18,0.7)" }} />
            <span style={{ flex: 1 }}>08 0E 12</span>
            <span style={{ color: "var(--t-tertiary)" }}>70%</span>
          </span>
        </div>
        <div className="field"><span className="lbl">Backdrop</span><span className="val">blur 20</span></div>

        <div className="xd-section">Stroke</div>
        <div className="field"><span className="lbl">Color</span>
          <span className="xd-color-input">
            <span className="sw" style={{ background: "#b4ffdc", opacity: 0.4 }} />
            <span style={{ flex: 1 }}>B4 FF DC</span>
            <span style={{ color: "var(--t-tertiary)" }}>18%</span>
          </span>
        </div>
        <div className="field"><span className="lbl">Weight</span><span className="val">1</span></div>

        <div className="xd-section">Effects</div>
        <div className="xd-effect-row glass"><span className="name">Liquid glass</span><window.I.eye size={11} className="ic" /></div>
        <div className="xd-effect-row glow"><span className="name">Outer glow · magenta</span><window.I.eye size={11} className="ic" /></div>
        <div className="xd-effect-row blur"><span className="name">Drop shadow · 40/20</span><window.I.eye size={11} className="ic" /></div>

        <div className="xd-section">Auto-layout</div>
        <div className="field"><span className="lbl">Direction</span><span className="val">→ Horizontal</span></div>
        <div className="field"><span className="lbl">Gap</span><span className="val">0</span></div>
        <div className="field"><span className="lbl">Padding</span><span className="val">0</span></div>
      </div>
    </div>
  );
}

function XDesignApp() {
  const [tool, setTool] = React.useState("move");
  const [layer, setLayer] = React.useState("w-archives");
  return (
    <>
      <XDToolRail active={tool} onSelect={setTool} />
      <XDLayers selected={layer} onSelect={setLayer} />
      <XDCanvas />
      <XDInspector />
      <window.ClaudeChat
        name="Design Partner"
        sub="watching · Archives 47 Frame · 340×200"
        accent="var(--neon-magenta)"
        systemHint="You are Claude embedded inside XDesign, an AI-assisted design studio (figma + photoshop + illustrator hybrid). You can see the user's selected layer and suggest visual changes, generate variations, critique compositions, or write design rationale. Reply concisely (1-3 sentences). Speak like a design partner, not a tutorial."
        suggestions={["Critique this frame", "Try 3 hue variants", "Tighten the hierarchy", "Add a dark variant"]}
        initialMessages={[
          { role: "assistant", content: "Selection looks balanced but the hero text is fighting the dock for attention. Want me to push the type up two steps and dim the dock by 20%?" },
        ]}
      />
    </>
  );
}

window.XDesignApp = XDesignApp;
