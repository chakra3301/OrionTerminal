// === Orion (code editor) styles ===
(function() {
  if (document.getElementById("orion-styles")) return;
  const style = document.createElement("style");
  style.id = "orion-styles";
  style.textContent = `
  .or-files {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.22);
    overflow-y: auto;
    padding: 10px 0;
    display: flex; flex-direction: column;
  }
  .or-files-header {
    padding: 4px 14px 10px;
    font-family: var(--f-mono);
    font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--t-tertiary);
    display: flex; align-items: center; justify-content: space-between;
  }
  .or-tree { font-family: var(--f-mono); font-size: 12px; }
  .or-tree-item {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 14px 3px 12px;
    color: var(--t-secondary);
    cursor: pointer;
    line-height: 1.3;
  }
  .or-tree-item:hover { background: rgba(255,255,255,0.04); color: var(--t-primary); }
  .or-tree-item.active {
    background: linear-gradient(90deg, rgba(0, 224, 255, 0.10), transparent);
    color: var(--t-primary);
    box-shadow: inset 2px 0 0 var(--neon-cyan);
  }
  .or-tree-item.dirty::after { content: "•"; color: var(--neon-yellow); margin-left: auto; }
  .or-tree-item .chev { transition: transform 0.15s; color: var(--t-tertiary); }
  .or-tree-item.open .chev { transform: rotate(90deg); }
  .or-tree-children { border-left: 1px solid rgba(255,255,255,0.05); margin-left: 18px; }

  .or-editor-area { display: flex; flex-direction: column; flex: 1; min-width: 0; }

  .or-tabs {
    display: flex;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.18);
    height: 32px;
    flex-shrink: 0;
  }
  .or-tab {
    display: flex; align-items: center; gap: 8px;
    padding: 0 12px;
    font-family: var(--f-mono); font-size: 11px;
    color: var(--t-secondary);
    border-right: 1px solid rgba(255,255,255,0.05);
    cursor: pointer;
  }
  .or-tab .x { opacity: 0.4; }
  .or-tab.active {
    background: rgba(0,0,0,0.4);
    color: var(--t-primary);
    box-shadow: inset 0 2px 0 var(--neon-cyan);
  }
  .or-tab.dirty .dot { color: var(--neon-yellow); }

  .or-code {
    flex: 1;
    overflow: auto;
    font-family: var(--f-mono);
    font-size: 12.5px;
    line-height: 1.65;
    background: rgba(3, 6, 10, 0.5);
    position: relative;
    padding: 14px 0;
  }
  .or-line { display: flex; padding: 0 18px 0 0; min-width: max-content; }
  .or-gutter {
    color: var(--t-faint);
    font-size: 11px;
    width: 50px;
    text-align: right;
    padding-right: 14px;
    user-select: none;
    flex-shrink: 0;
  }
  .or-code-content { color: var(--t-primary); white-space: pre; }
  .or-line.current { background: rgba(0, 224, 255, 0.04); }
  .or-line.current .or-gutter { color: var(--neon-cyan); }
  .or-line.diff-add { background: rgba(57, 255, 136, 0.08); }
  .or-line.diff-add .or-gutter { color: var(--neon-green); }
  .or-line.diff-add .or-gutter::before { content: "+ "; }
  .or-line.diff-del { background: rgba(255, 94, 94, 0.06); opacity: 0.7; }
  .or-line.diff-del .or-gutter::before { content: "− "; }

  .or-line.suggestion-anchor {
    position: relative;
  }
  .or-suggestion {
    margin: 8px 0 8px 60px;
    border-radius: 8px;
    border: 1px solid rgba(57,255,136,0.3);
    background: linear-gradient(135deg, rgba(57,255,136,0.06), rgba(0,224,255,0.03));
    padding: 8px 10px;
    font-size: 11px;
    color: var(--t-secondary);
    max-width: 600px;
    display: flex; align-items: center; gap: 10px;
  }
  .or-suggestion .actions { margin-left: auto; display: flex; gap: 6px; }
  .or-suggestion button {
    font-family: var(--f-mono);
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    letter-spacing: 0.08em;
  }
  .or-suggestion button.accept { background: rgba(57,255,136,0.15); color: var(--neon-green); border: 1px solid rgba(57,255,136,0.3); }
  .or-suggestion button.reject { background: rgba(255,255,255,0.04); color: var(--t-secondary); border: 1px solid rgba(255,255,255,0.06); }

  .tok-kw { color: #ff7eb6; }
  .tok-fn { color: var(--neon-cyan); }
  .tok-str { color: var(--neon-yellow); }
  .tok-num { color: var(--neon-magenta); }
  .tok-com { color: var(--t-faint); font-style: italic; }
  .tok-tag { color: #b14cff; }
  .tok-attr { color: var(--neon-green); }
  .tok-pn { color: var(--t-secondary); }
  .tok-vr { color: #f8e88c; }

  /* preview pane */
  .or-preview {
    width: 360px;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.15);
    display: flex; flex-direction: column;
  }
  .or-preview-bar {
    height: 32px;
    display: flex; align-items: center; gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    font-family: var(--f-mono); font-size: 10px;
    color: var(--t-tertiary);
    letter-spacing: 0.1em;
  }
  .or-preview-frame {
    flex: 1;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 50% 50%, #0f1820, #050a0d);
    padding: 18px;
    overflow: auto;
  }

  /* terminal */
  .or-terminal {
    height: 150px;
    flex-shrink: 0;
    border-top: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.4);
    display: flex; flex-direction: column;
  }
  .or-terminal-bar {
    height: 28px; padding: 0 12px;
    display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    font-family: var(--f-mono); font-size: 10px;
    color: var(--t-tertiary); letter-spacing: 0.1em;
  }
  .or-terminal-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px;
    font-family: var(--f-mono);
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--t-secondary);
  }
  .or-terminal-content .prompt { color: var(--neon-green); }
  .or-terminal-content .path { color: var(--neon-cyan); }
  .or-terminal-content .ok { color: var(--neon-green); }
  .or-terminal-content .warn { color: var(--neon-yellow); }
  .or-terminal-content .info { color: var(--t-secondary); }
  .or-terminal-content .dim { color: var(--t-faint); }

  .or-statusbar {
    height: 24px;
    background: rgba(0,0,0,0.4);
    border-top: 1px solid rgba(255,255,255,0.05);
    padding: 0 12px;
    display: flex; align-items: center; gap: 14px;
    font-family: var(--f-mono); font-size: 10px;
    color: var(--t-tertiary); letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .or-statusbar .branch { color: var(--neon-green); display: flex; align-items: center; gap: 4px; }
  .or-statusbar .item { display: flex; align-items: center; gap: 4px; }
  `;
  document.head.appendChild(style);
})();
