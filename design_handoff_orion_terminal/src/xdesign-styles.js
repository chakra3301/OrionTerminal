// === XDesign styles ===
(function() {
  if (document.getElementById("xd-styles")) return;
  const style = document.createElement("style");
  style.id = "xd-styles";
  style.textContent = `
  .xd-toolrail {
    width: 52px;
    flex-shrink: 0;
    background: rgba(0,0,0,0.3);
    border-right: 1px solid rgba(255,255,255,0.05);
    display: flex; flex-direction: column;
    align-items: center;
    padding: 10px 0;
    gap: 4px;
  }
  .xd-tool {
    width: 36px; height: 36px;
    border-radius: 8px;
    display: grid; place-items: center;
    color: var(--t-secondary);
    cursor: pointer;
    position: relative;
  }
  .xd-tool:hover { background: rgba(255,255,255,0.05); color: var(--t-primary); }
  .xd-tool.active {
    background: linear-gradient(135deg, rgba(255,62,165,0.15), rgba(177,76,255,0.15));
    color: var(--neon-magenta);
    box-shadow: inset 0 0 0 1px rgba(255,62,165,0.3), 0 0 12px -2px rgba(255,62,165,0.4);
  }
  .xd-tool.active::after {
    content: ""; position: absolute; right: -8px; top: 50%; transform: translateY(-50%);
    width: 4px; height: 14px; border-radius: 2px;
    background: var(--neon-magenta); box-shadow: 0 0 6px var(--neon-magenta);
  }
  .xd-tool .kbd {
    position: absolute; bottom: 2px; right: 4px;
    font-size: 8px; opacity: 0.5; background: none; border: none; padding: 0;
  }
  .xd-tool-divider { width: 24px; height: 1px; background: rgba(255,255,255,0.06); margin: 4px 0; }

  .xd-panels {
    width: 240px; flex-shrink: 0;
    background: rgba(0,0,0,0.22);
    border-right: 1px solid rgba(255,255,255,0.05);
    display: flex; flex-direction: column;
  }
  .xd-panel-tabs {
    display: flex;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    height: 32px;
  }
  .xd-panel-tabs .t {
    flex: 1;
    display: grid; place-items: center;
    font-family: var(--f-mono);
    font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--t-tertiary);
    cursor: pointer;
    border-right: 1px solid rgba(255,255,255,0.05);
  }
  .xd-panel-tabs .t.active { color: var(--neon-magenta); box-shadow: inset 0 -2px 0 var(--neon-magenta); }

  .xd-panel-body { flex: 1; overflow-y: auto; padding: 8px 4px; }
  .xd-section { padding: 8px 10px 4px; font-family: var(--f-mono); font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--t-faint); }

  .xd-layer {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--t-secondary);
    cursor: pointer;
    border-radius: 4px;
    margin: 0 4px;
  }
  .xd-layer:hover { background: rgba(255,255,255,0.04); }
  .xd-layer.selected {
    background: linear-gradient(90deg, rgba(255,62,165,0.12), transparent);
    color: var(--t-primary);
    box-shadow: inset 2px 0 0 var(--neon-magenta);
  }
  .xd-layer .swatch {
    width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .xd-layer .name { flex: 1; }
  .xd-layer .ic { color: var(--t-tertiary); opacity: 0; transition: opacity 0.15s; }
  .xd-layer:hover .ic { opacity: 1; }
  .xd-layer.locked .ic.lock-on { opacity: 1; color: var(--neon-yellow); }

  /* canvas */
  .xd-canvas-area {
    flex: 1;
    min-width: 0;
    background:
      radial-gradient(circle at 50% 50%, #0a1015, #03060a 70%);
    background-image:
      radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px);
    background-size: 22px 22px;
    background-position: center center;
    overflow: hidden;
    position: relative;
    display: flex; flex-direction: column;
  }
  .xd-canvas-bar {
    height: 36px; padding: 0 14px;
    display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.25);
    font-family: var(--f-mono); font-size: 11px;
    color: var(--t-tertiary); letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .xd-canvas-bar .zoom { color: var(--t-secondary); display: flex; align-items: center; gap: 4px; }
  .xd-canvas-bar .pill {
    padding: 3px 10px; border-radius: 999px;
    background: rgba(255,62,165,0.08); color: var(--neon-magenta);
    border: 1px solid rgba(255,62,165,0.2);
  }
  .xd-canvas-stage {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .xd-canvas-inner {
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
  }

  /* artboard */
  .xd-artboard {
    position: absolute;
    background: linear-gradient(135deg, #060a0f, #0a1018);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    box-shadow: 0 30px 60px -20px rgba(0,0,0,0.8);
    overflow: hidden;
  }
  .xd-artboard-label {
    position: absolute;
    top: -22px; left: 0;
    font-family: var(--f-mono); font-size: 10px; letter-spacing: 0.1em;
    color: var(--t-tertiary);
  }
  .xd-artboard-label .res { color: var(--t-faint); margin-left: 8px; }

  .xd-selection {
    position: absolute;
    border: 1px solid var(--neon-magenta);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.3), 0 0 14px rgba(255,62,165,0.4);
    pointer-events: none;
  }
  .xd-handle {
    position: absolute;
    width: 8px; height: 8px;
    background: #fff;
    border: 1px solid var(--neon-magenta);
    border-radius: 1px;
    box-shadow: 0 0 4px rgba(255,62,165,0.5);
  }
  .xd-handle.tl { left: -4px; top: -4px; }
  .xd-handle.tr { right: -4px; top: -4px; }
  .xd-handle.bl { left: -4px; bottom: -4px; }
  .xd-handle.br { right: -4px; bottom: -4px; }
  .xd-handle.t { left: 50%; top: -4px; transform: translateX(-50%); }
  .xd-handle.b { left: 50%; bottom: -4px; transform: translateX(-50%); }
  .xd-handle.l { left: -4px; top: 50%; transform: translateY(-50%); }
  .xd-handle.r { right: -4px; top: 50%; transform: translateY(-50%); }

  .xd-floating-label {
    position: absolute;
    background: var(--neon-magenta);
    color: #001008;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: var(--f-mono);
    font-size: 9px; letter-spacing: 0.05em;
    font-weight: 600;
    bottom: -18px; left: 0;
    white-space: nowrap;
    box-shadow: 0 0 8px rgba(255,62,165,0.4);
  }

  /* right inspector */
  .xd-inspector {
    width: 240px; flex-shrink: 0;
    background: rgba(0,0,0,0.22);
    border-left: 1px solid rgba(255,255,255,0.05);
    display: flex; flex-direction: column;
  }
  .xd-inspector .field {
    display: grid; grid-template-columns: 60px 1fr; gap: 8px;
    align-items: center;
    padding: 4px 12px;
    font-size: 11px;
  }
  .xd-inspector .field .lbl {
    font-family: var(--f-mono);
    font-size: 10px;
    color: var(--t-tertiary);
    letter-spacing: 0.05em;
  }
  .xd-inspector .field .val {
    padding: 4px 8px;
    background: rgba(0,0,0,0.3);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--t-primary);
  }
  .xd-inspector .field .val.row { display: flex; gap: 4px; padding: 0; background: none; border: none; }
  .xd-inspector .field .val.row > * {
    flex: 1; padding: 4px 8px;
    background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
  }
  .xd-color-input {
    display: flex; align-items: center; gap: 6px;
    background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px; padding: 4px 8px; font-family: var(--f-mono); font-size: 11px;
  }
  .xd-color-input .sw { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }

  .xd-effect-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }
  .xd-effect-row .name { flex: 1; font-size: 12px; color: var(--t-primary); }
  .xd-effect-row .ic { color: var(--t-tertiary); }
  .xd-effect-row.glass .name::before { content: "◇ "; color: var(--neon-cyan); }
  .xd-effect-row.glow .name::before { content: "✦ "; color: var(--neon-magenta); }
  .xd-effect-row.blur .name::before { content: "≈ "; color: var(--neon-violet); }
  `;
  document.head.appendChild(style);
})();
