// === Orion (code editor) ===

const ORION_TREE = [
  { type: "folder", name: "orion-terminal", open: true, children: [
    { type: "folder", name: "src", open: true, children: [
      { type: "folder", name: "components", open: false, children: [
        { type: "file", name: "Dock.tsx" },
        { type: "file", name: "Window.tsx" },
        { type: "file", name: "Wallpaper.tsx" },
      ]},
      { type: "folder", name: "apps", open: true, children: [
        { type: "file", name: "Archives.tsx" },
        { type: "file", name: "Orion.tsx", active: true, dirty: true },
        { type: "file", name: "XDesign.tsx" },
      ]},
      { type: "file", name: "shell.tsx" },
      { type: "file", name: "claude.ts" },
    ]},
    { type: "folder", name: "styles", open: false, children: [
      { type: "file", name: "glass.css" },
      { type: "file", name: "neon.css" },
    ]},
    { type: "file", name: "package.json" },
    { type: "file", name: "README.md" },
    { type: "file", name: ".env" },
  ]},
];

function OrionTreeNode({ node, depth = 0 }) {
  const [open, setOpen] = React.useState(node.open || false);
  if (node.type === "folder") {
    return (
      <>
        <div className={"or-tree-item" + (open ? " open" : "")} style={{ paddingLeft: 12 + depth * 12 }} onClick={() => setOpen(!open)}>
          <window.I.chev size={10} className="chev" />
          <window.I.folder size={12} stroke={open ? "var(--neon-cyan)" : "var(--t-secondary)"} />
          <span>{node.name}</span>
        </div>
        {open && (
          <div>{node.children.map((c, i) => <OrionTreeNode key={i} node={c} depth={depth + 1} />)}</div>
        )}
      </>
    );
  }
  return (
    <div className={"or-tree-item" + (node.active ? " active" : "") + (node.dirty ? " dirty" : "")} style={{ paddingLeft: 12 + depth * 12 }}>
      <span style={{ width: 10 }} />
      <window.I.file size={12} />
      <span>{node.name}</span>
    </div>
  );
}

// Syntax-tokenized code lines for Orion.tsx
const ORION_CODE_LINES = [
  ["import ", { c: "kw", t: "React" }, " from ", { c: "str", t: "\"react\";" }],
  ["import ", { c: "kw", t: "{ ClaudeChat }" }, " from ", { c: "str", t: "\"../claude\";" }],
  ["import ", { c: "kw", t: "{ Editor, FileTree }" }, " from ", { c: "str", t: "\"../components\";" }],
  [""],
  [{ c: "com", t: "// orion :: an ai-first code editor with live visualizer" }],
  [{ c: "kw", t: "export default function" }, " ", { c: "fn", t: "Orion" }, "() {"],
  ["  ", { c: "kw", t: "const" }, " [", { c: "vr", t: "file" }, ", ", { c: "vr", t: "setFile" }, "] = ", { c: "fn", t: "useState" }, "(", { c: "str", t: "\"src/apps/Orion.tsx\"" }, ");"],
  ["  ", { c: "kw", t: "const" }, " [", { c: "vr", t: "preview" }, ", ", { c: "vr", t: "setPreview" }, "] = ", { c: "fn", t: "useState" }, "(", { c: "kw", t: "true" }, ");"],
  ["  ", { c: "kw", t: "const" }, " [", { c: "vr", t: "diff" }, ", ", { c: "vr", t: "setDiff" }, "] = ", { c: "fn", t: "useState" }, "<", { c: "fn", t: "Diff" }, " | ", { c: "kw", t: "null" }, ">(", { c: "kw", t: "null" }, ");"],
  [""],
  [{ c: "com", t: "  // claude :: scoped to the open file, the cursor, and the diff buffer" }],
  ["  ", { c: "kw", t: "const" }, " ", { c: "vr", t: "claude" }, " = ", { c: "fn", t: "useClaude" }, "({"],
  ["    ", { c: "attr", t: "scope" }, ": ", { c: "str", t: "\"orion\"" }, ","],
  ["    ", { c: "attr", t: "context" }, ": { ", { c: "vr", t: "file" }, ", ", { c: "vr", t: "cursor" }, ", ", { c: "vr", t: "selection" }, " },"],
  ["    ", { c: "attr", t: "onSuggest" }, ": (", { c: "vr", t: "d" }, ") => ", { c: "fn", t: "setDiff" }, "(", { c: "vr", t: "d" }, "),"],
  ["  });"],
  [""],
  ["  ", { c: "kw", t: "return" }, " ("],
  ["    <", { c: "tag", t: "Workspace" }, ">"],
  ["      <", { c: "tag", t: "FileTree" }, " ", { c: "attr", t: "onOpen" }, "={", { c: "vr", t: "setFile" }, "} />"],
  ["      <", { c: "tag", t: "Editor" }, " ", { c: "attr", t: "file" }, "={", { c: "vr", t: "file" }, "} ", { c: "attr", t: "diff" }, "={", { c: "vr", t: "diff" }, "} />"],
  [{ c: "kw", t: "      {" }, { c: "vr", t: "preview" }, " && <", { c: "tag", t: "Visualizer" }, " ", { c: "attr", t: "src" }, "={", { c: "vr", t: "file" }, "} />}"],
  ["      <", { c: "tag", t: "ClaudeChat" }, " {...", { c: "vr", t: "claude" }, "} />"],
  ["    </", { c: "tag", t: "Workspace" }, ">"],
  ["  );"],
  ["}"],
];

function Tok({ c, t }) {
  return <span className={"tok-" + c}>{t}</span>;
}

function OrionCodeLine({ tokens, num, current, diff }) {
  return (
    <div className={"or-line" + (current ? " current" : "") + (diff ? " diff-" + diff : "")}>
      <div className="or-gutter">{num}</div>
      <div className="or-code-content">
        {tokens.map((t, i) => typeof t === "string" ? <span key={i}>{t}</span> : <Tok key={i} {...t} />)}
      </div>
    </div>
  );
}

function OrionEditor({ showSuggestion, onAcceptSuggestion, onRejectSuggestion }) {
  return (
    <div className="or-code scroll">
      {ORION_CODE_LINES.map((line, i) => (
        <React.Fragment key={i}>
          <OrionCodeLine tokens={line} num={i + 1} current={i === 10} />
          {showSuggestion && i === 14 && (
            <div className="or-suggestion">
              <window.I.sparkles size={14} stroke="var(--neon-green)" />
              <div>
                <div style={{ color: "var(--neon-green)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 2 }}>Claude suggested</div>
                <div>Memoize the claude hook — file changes shouldn't re-trigger the subscription.</div>
              </div>
              <div className="actions">
                <button className="accept" onClick={onAcceptSuggestion}>⌘ ↵ ACCEPT</button>
                <button className="reject" onClick={onRejectSuggestion}>ESC</button>
              </div>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function OrionPreview() {
  return (
    <div className="or-preview">
      <div className="or-preview-bar">
        <span style={{ color: "var(--neon-cyan)" }}>● LIVE</span>
        <span>localhost:3047</span>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" style={{ color: "var(--t-secondary)" }}><window.I.refresh size={11} /></button>
      </div>
      <div className="or-preview-frame">
        {/* Mini Orion preview — a tiny rendering of the very thing being built */}
        <div style={{
          width: "100%", maxWidth: 280, aspectRatio: "16/10",
          borderRadius: 8,
          background: "linear-gradient(135deg, #050a0d 0%, #0a1015 100%)",
          border: "1px solid rgba(0, 224, 255, 0.2)",
          padding: 8,
          display: "flex", flexDirection: "column", gap: 6,
          position: "relative", overflow: "hidden",
          boxShadow: "0 0 30px rgba(0, 224, 255, 0.15)",
        }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 70% 80%, rgba(177,76,255,0.2), transparent 50%)" }} />
          <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 2, width: "30%", position: "relative", zIndex: 1 }} />
          <div style={{ display: "flex", gap: 6, flex: 1, position: "relative", zIndex: 1 }}>
            <div style={{ width: "20%", background: "rgba(255,255,255,0.04)", borderRadius: 4 }} />
            <div style={{ flex: 1, background: "rgba(0, 224, 255, 0.05)", borderRadius: 4, border: "1px solid rgba(0,224,255,0.15)" }} />
            <div style={{ width: "25%", background: "rgba(57,255,136,0.06)", borderRadius: 4 }} />
          </div>
          <div style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 3, zIndex: 2 }}>
            {[0,1,2,3].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: 3, background: ["#39ff88","#00e0ff","#e6ff3a","#b14cff"][i], opacity: 0.8 }} />)}
          </div>
        </div>
        <div style={{ marginTop: 16, fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--t-tertiary)", letterSpacing: "0.15em", textAlign: "center" }}>
          UPDATED 0.3s AGO · HOT RELOAD
        </div>
      </div>
    </div>
  );
}

function OrionTerminalPanel() {
  return (
    <div className="or-terminal">
      <div className="or-terminal-bar">
        <span style={{ color: "var(--neon-green)" }}>● dev</span>
        <span>build</span>
        <span>tests</span>
        <span style={{ color: "var(--t-faint)" }}>+</span>
        <div style={{ flex: 1 }} />
        <span>bash · zsh · claude</span>
      </div>
      <div className="or-terminal-content scroll">
        <div><span className="dim">~/orion-terminal $</span> <span className="ok">npm run dev</span></div>
        <div className="info">▲ next build · ready in 412ms</div>
        <div className="ok">✓ compiled successfully</div>
        <div className="warn">⚠ 2 warnings — unused import &lt;Visualizer&gt; in src/apps/Orion.tsx:22</div>
        <div className="info">○ event - compiled client and server successfully</div>
        <div><span className="prompt">claude ❯</span> <span className="dim">i can fix that warning — should i remove the import or wire up the visualizer?</span></div>
        <div className="dim">─────────────────────────────────────────────</div>
        <div><span className="path">~/orion-terminal $</span> <span style={{ color: "var(--t-primary)" }}>_</span><span style={{ color: "var(--neon-green)" }}>▌</span></div>
      </div>
    </div>
  );
}

function OrionApp() {
  const [showSuggestion, setShowSuggestion] = React.useState(true);
  return (
    <>
      <div className="or-files">
        <div className="or-files-header">
          <span>EXPLORER</span>
          <window.I.plus size={11} />
        </div>
        <div className="or-tree">
          {ORION_TREE.map((n, i) => <OrionTreeNode key={i} node={n} />)}
        </div>
        <div style={{ marginTop: "auto", padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.05)", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--t-tertiary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <window.I.branch size={11} stroke="var(--neon-green)" />
            <span style={{ color: "var(--neon-green)" }}>orion/glass-dock</span>
          </div>
          <div>3 changes · 1 staged</div>
        </div>
      </div>

      <div className="or-editor-area">
        <div className="or-tabs">
          <div className="or-tab active dirty">
            <window.I.file size={10} />
            <span>Orion.tsx</span>
            <span className="dot" style={{ color: "var(--neon-yellow)" }}>●</span>
          </div>
          <div className="or-tab">
            <window.I.file size={10} />
            <span>shell.tsx</span>
            <window.I.x size={10} className="x" />
          </div>
          <div className="or-tab">
            <window.I.file size={10} />
            <span>claude.ts</span>
            <window.I.x size={10} className="x" />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--t-tertiary)" }}>
            <span><window.I.play size={9} stroke="var(--neon-green)" /> run</span>
            <span><window.I.terminal size={11} /></span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <OrionPreview />
          <OrionEditor
            showSuggestion={showSuggestion}
            onAcceptSuggestion={() => setShowSuggestion(false)}
            onRejectSuggestion={() => setShowSuggestion(false)}
          />
        </div>

        <OrionTerminalPanel />

        <div className="or-statusbar">
          <span className="branch"><window.I.branch size={10} /> orion/glass-dock</span>
          <span className="item">⨯ 0</span>
          <span className="item">⚠ 2</span>
          <div style={{ flex: 1 }} />
          <span className="item">Ln 11, Col 23</span>
          <span className="item">TSX</span>
          <span className="item">UTF-8</span>
          <span style={{ color: "var(--neon-cyan)" }} className="item">⌘K claude</span>
        </div>
      </div>

      <window.ClaudeChat
        name="Code Companion"
        sub="reading · Orion.tsx · 27 lines"
        accent="var(--neon-cyan)"
        systemHint="You are Claude embedded inside Orion, an AI-first code editor. You have read-access to the file being edited. Help the user write, refactor, and explain code. Reply concisely (1-3 sentences). Reference code by line or symbol when relevant."
        suggestions={["Explain this file", "Refactor useClaude hook", "Add tests", "Fix the warning"]}
        initialMessages={[
          { role: "assistant", content: "I see Orion.tsx wires the file tree, editor, and visualizer in one workspace. Want me to extract the layout into a Workspace component, or keep it inline?" },
        ]}
      />
    </>
  );
}

window.OrionApp = OrionApp;
