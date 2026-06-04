// === Archives 47 — styles (scoped) ===
// Inserts a <style> tag with all Archives-specific styles to keep markup clean.

(function() {
  if (document.getElementById("archives-styles")) return;
  const style = document.createElement("style");
  style.id = "archives-styles";
  style.textContent = `
  .ar-toolbar {
    height: 44px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex; align-items: center; gap: 14px;
    padding: 0 18px;
    background: rgba(0,0,0,0.15);
    flex-shrink: 0;
  }
  .ar-toolbar .crumb {
    font-family: var(--f-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--t-tertiary);
  }
  .ar-toolbar .crumb .sep { margin: 0 8px; color: var(--t-faint); }
  .ar-toolbar .crumb .here { color: var(--t-primary); }
  .ar-toolbar .icon-btn {
    width: 28px; height: 28px; border-radius: 6px;
    display: grid; place-items: center;
    color: var(--t-secondary);
    border: 1px solid transparent;
  }
  .ar-toolbar .icon-btn:hover { background: rgba(255,255,255,0.04); color: var(--t-primary); border-color: rgba(255,255,255,0.06); }

  .ar-content { flex: 1; min-height: 0; overflow-y: auto; padding: 28px 44px; }

  /* Today view */
  .ar-today-hero { display: flex; align-items: baseline; gap: 18px; margin-bottom: 28px; }
  .ar-today-hero .date {
    font-family: var(--f-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--neon-green);
  }
  .ar-today-hero h1 {
    font-size: 38px; font-weight: 500; letter-spacing: -0.02em; color: var(--t-primary);
  }
  .ar-today-hero .quote { color: var(--t-tertiary); font-style: italic; font-size: 13px; margin-left: auto; max-width: 280px; text-align: right; line-height: 1.5; }

  .ar-today-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 18px;
  }
  .ar-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    padding: 18px;
  }
  .ar-card h3 {
    font-family: var(--f-mono);
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--t-tertiary);
    margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .ar-card h3 .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--neon-green); box-shadow: 0 0 6px var(--neon-green); }

  .ar-journal-entry {
    padding: 12px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    cursor: pointer;
  }
  .ar-journal-entry:last-child { border-bottom: none; }
  .ar-journal-entry .meta { font-family: var(--f-mono); font-size: 10px; color: var(--t-tertiary); letter-spacing: 0.06em; }
  .ar-journal-entry .title { font-size: 14px; color: var(--t-primary); margin: 4px 0; }
  .ar-journal-entry .preview { font-size: 12px; color: var(--t-secondary); line-height: 1.5; }

  .ar-media-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .ar-media-row .placeholder-img { height: 70px; border-radius: 8px; font-size: 9px; }

  /* Journal editor */
  .ar-editor-bar {
    display: flex; gap: 4px; padding: 10px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: rgba(0,0,0,0.18);
  }
  .ar-editor-bar .b {
    width: 30px; height: 28px;
    border-radius: 6px;
    display: grid; place-items: center;
    color: var(--t-secondary);
  }
  .ar-editor-bar .b:hover { background: rgba(255,255,255,0.05); color: var(--t-primary); }
  .ar-editor-bar .b.on { background: rgba(57,255,136,0.1); color: var(--neon-green); }
  .ar-editor-bar .sep { width: 1px; background: rgba(255,255,255,0.06); margin: 4px 6px; }

  .ar-editor-page {
    padding: 38px 60px;
    max-width: 760px;
    margin: 0 auto;
  }
  .ar-editor-page h1 {
    font-size: 36px; font-weight: 500; letter-spacing: -0.02em; margin-bottom: 6px; color: var(--t-primary);
  }
  .ar-editor-page .stamp {
    font-family: var(--f-mono); font-size: 11px; color: var(--t-tertiary); letter-spacing: 0.1em; margin-bottom: 28px;
    display: flex; align-items: center; gap: 12px;
  }
  .ar-editor-page p {
    font-size: 15px; line-height: 1.75; color: var(--t-primary); margin-bottom: 18px;
  }
  .ar-editor-page blockquote {
    border-left: 2px solid var(--neon-cyan);
    padding: 6px 14px;
    color: var(--t-secondary);
    font-style: italic;
    margin: 18px 0;
    font-size: 14px;
  }
  .ar-editor-page h2 { font-size: 22px; margin: 24px 0 12px; color: var(--t-primary); font-weight: 500; }
  .ar-editor-page ul { padding-left: 20px; margin-bottom: 18px; }
  .ar-editor-page li { font-size: 15px; line-height: 1.75; color: var(--t-primary); margin-bottom: 4px; }
  .ar-editor-page .ai-callout {
    margin: 24px 0;
    padding: 14px 16px;
    background: linear-gradient(135deg, rgba(57,255,136,0.06), rgba(0,224,255,0.04));
    border: 1px solid rgba(57,255,136,0.2);
    border-radius: 12px;
    font-size: 13px;
    color: var(--t-secondary);
    line-height: 1.6;
    display: flex; gap: 12px; align-items: flex-start;
  }
  .ar-editor-page .ai-callout .label {
    font-family: var(--f-mono); font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--neon-green); margin-bottom: 4px;
  }

  /* Mood board */
  .ar-mood {
    columns: 3;
    column-gap: 14px;
    padding: 4px;
  }
  .ar-mood-tile {
    break-inside: avoid;
    margin-bottom: 14px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    position: relative;
    cursor: grab;
  }
  .ar-mood-tile:hover { border-color: rgba(57,255,136,0.3); }
  .ar-mood-tile .ph { width: 100%; }
  .ar-mood-tile .label {
    position: absolute; bottom: 0; left: 0; right: 0;
    padding: 8px 10px;
    background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
    font-family: var(--f-mono); font-size: 10px; color: var(--t-secondary); letter-spacing: 0.06em;
    opacity: 0; transition: opacity 0.15s;
  }
  .ar-mood-tile:hover .label { opacity: 1; }
  .ar-mood-board-header {
    display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px;
  }
  .ar-mood-board-header h2 { font-size: 24px; font-weight: 500; }
  .ar-mood-board-header .meta { font-family: var(--f-mono); font-size: 10px; color: var(--t-tertiary); letter-spacing: 0.1em; }

  /* Media library */
  .ar-media-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .ar-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .ar-media-tile {
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255,255,255,0.02);
  }
  .ar-media-tile:hover { border-color: rgba(57,255,136,0.25); }
  .ar-media-tile .ph { height: 110px; }
  .ar-media-tile .meta { padding: 8px 10px; font-size: 11px; color: var(--t-secondary); }
  .ar-media-tile .meta .name { color: var(--t-primary); margin-bottom: 2px; font-size: 12px; }
  .ar-media-tile .meta .small { font-family: var(--f-mono); font-size: 9px; color: var(--t-tertiary); letter-spacing: 0.05em; }
  `;
  document.head.appendChild(style);
})();
