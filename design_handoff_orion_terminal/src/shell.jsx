// === Window manager + Dock ===

function useDraggable(ref, position, setPosition, onFocus) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const titlebar = el.querySelector(".window-titlebar");
    if (!titlebar) return;
    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;
    const onDown = (e) => {
      if (e.target.closest(".traffic")) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = position.x; origY = position.y;
      onFocus && onFocus();
      document.body.style.userSelect = "none";
    };
    const onMove = (e) => {
      if (!dragging) return;
      setPosition({ x: origX + (e.clientX - startX), y: Math.max(32, origY + (e.clientY - startY)) });
    };
    const onUp = () => { dragging = false; document.body.style.userSelect = ""; };
    titlebar.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      titlebar.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [position.x, position.y]);
}

function WindowFrame({ id, title, accent, width, height, x, y, z, focused, minimized, onFocus, onClose, onMin, onMax, children, maximized }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState({ x, y });
  const [size, setSize] = React.useState({ w: width, h: height });
  useDraggable(ref, pos, setPos, onFocus);
  React.useEffect(() => { setPos({ x, y }); }, [x, y]);

  const style = maximized
    ? { left: 12, top: 44, width: "calc(100vw - 24px)", height: "calc(100vh - 110px)", zIndex: z }
    : { left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z };

  if (minimized) return null;

  return (
    <div
      ref={ref}
      className="window"
      style={{ ...style, opacity: focused ? 1 : 0.96, filter: focused ? "none" : "saturate(0.85) brightness(0.92)" }}
      onMouseDown={onFocus}
    >
      <div className="window-titlebar">
        <div className="traffic">
          <div className="light close" onClick={onClose} title="Close" />
          <div className="light min" onClick={onMin} title="Minimize" />
          <div className="light max" onClick={onMax} title="Maximize" />
        </div>
        <div className="window-title">
          <span>{title.split("·")[0]}</span>
          {title.includes("·") && <span className="accent" style={{ color: accent || "var(--neon-green)" }}> · {title.split("·")[1].trim()}</span>}
        </div>
        <div className="window-tools">
          <span>⌘K</span>
        </div>
      </div>
      <div className="window-body">{children}</div>
    </div>
  );
}

function Dock({ apps, activeId, onLaunch, onSpotlight }) {
  return (
    <div className="dock-wrap">
      <div className="dock">
        {apps.map(a => {
          const IconCmp = window.I[a.icon];
          return (
            <div key={a.id} className={"dock-item" + (activeId === a.id ? " active" : "")} onClick={() => onLaunch(a.id)} title={a.title}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: a.bg,
                display: "grid", placeItems: "center",
                boxShadow: a.glow,
              }}>
                <IconCmp size={18} stroke={a.fg} />
              </div>
            </div>
          );
        })}
        <div className="dock-divider" />
        <div className="dock-item" onClick={onSpotlight} title="Spotlight">
          <window.I.search size={18} />
        </div>
        <div className="dock-item" title="Claude">
          <div className="claude-orb" style={{ width: 24, height: 24 }} />
        </div>
      </div>
    </div>
  );
}

window.WindowFrame = WindowFrame;
window.Dock = Dock;
