// In-app Help content. Plain Markdown strings rendered by HelpWindow — kept as
// data (not a doc file on disk) so the viewer works in the bundled .app without
// any filesystem access.

export type HelpSection = { id: string; title: string; body: string };

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: `# Orion Terminal

A personal workstation: one desktop shell hosting three deeply-integrated apps,
with Claude embedded inside each as a context-specific collaborator.

- **Archives 47** — your personal knowledge base (notes, journal, projects,
  mood boards, media). _Green._
- **Orion** — an AI-first code editor (files, Monaco, preview, terminal, Git).
  _Cyan._
- **XDesign** — a design studio (canvas, vector, layout, prototypes, export).
  _Magenta._

Everything lives in one window. Apps open as draggable in-canvas windows you can
move, resize, maximize and full-screen.

### The fastest way in
Press **⌘K** for Spotlight — search apps, files, notes, recent work and every
command from one box. Type \`>\` first to search commands only.

### Your AI
Press **⌘L** to summon **R.O.S.I.E**, the terminal-wide assistant. Each app also
has its own Claude surface tuned to what you're doing there.`,
  },
  {
    id: "shell",
    title: "Shell & Spotlight",
    body: `# The shell

The desktop is the shell: wallpaper, a menu bar up top, and a dock at the bottom.
Open an app from the dock or with its shortcut.

### Windows
- Drag a window by its title bar. Drag edges/corners to resize.
- **⌘M** minimize · maximize via the title bar · **⌃⌘F** full screen.
- Each app remembers its position between launches.

### Spotlight — ⌘K
One box for everything:
- **Apps** — "Open Orion", "Open Archives", "Open XDesign".
- **Files** — fuzzy-jump to any file in the open project.
- **Notes & archive** — full-text search across your notes, journals and chats.
- **Recent** — pick up what you were just doing across apps.
- **Commands** — type \`>\` to filter to commands only.

### Handy shortcuts
| Action | Keys |
| --- | --- |
| Spotlight | ⌘K |
| Commands only | ⌘⇧P |
| Open Archives / Orion / XDesign | ⌘1 / ⌘2 / ⌘3 |
| Summon R.O.S.I.E | ⌘L |
| Settings / Control Panel | ⌘, |
| Keyboard shortcuts | ⌘/ |
| This help | type "Help" in ⌘K |`,
  },
  {
    id: "archives",
    title: "Archives 47",
    body: `# Archives 47

Your personal Notion — for thinking, writing and collecting.

- **Notes, journals & projects** — rich block editor. **⌘N** new note.
- **Quick Capture** — **⌘⇧N** to jot something without leaving what you're doing.
- **Ask your Archive** — **⌘⇧A** asks questions across everything you've written
  (semantic + full-text retrieval).
- **Wikilinks** — type \`[[\` to link notes; backlinks are tracked automatically.
- **Media & mood boards** — drop in images/files; arrange visual boards.
- **Database views** — table / board views over your notes with properties.
- **Export** — send a note to PDF from the command palette.

Claude lives in the Archive Assistant rail, with the context of what you're
reading and writing.`,
  },
  {
    id: "orion",
    title: "Orion (code)",
    body: `# Orion

An AI-first code editor. Open a folder with **Open Project** (⌘K → "Open
Project") and you get a full IDE:

- **Editor** — Monaco, tabs, split panes, real LSP (TypeScript, Python, Rust).
- **Inline edit** — select code and press **⌘K** to have Claude rewrite it in
  place with a live diff.
- **Tab autocomplete** — ghost-text suggestions as you type (toggle in the
  palette).
- **Claude Code** — **⌘⇧L** opens the agentic CLI surface for larger changes.
- **Preview** — live preview of web projects.
- **Terminal** — **⌘\`** toggles an integrated terminal.
- **Git** — stage, diff and commit from the Git panel; checkpoints + blame let
  you roll back AI edits safely.

### Editing shortcuts
| Action | Keys |
| --- | --- |
| Go to File | ⌘P |
| Save / Save All | ⌘S / ⌘⇧S |
| Find in Files | ⌘⇧F |
| Go to Symbol | ⌘⇧O |
| Inline edit (selection) | ⌘K |
| Toggle terminal | ⌘\` |`,
  },
  {
    id: "xdesign",
    title: "XDesign",
    body: `# XDesign

A single-player design studio — a hybrid of Figma, illustration and motion
tools.

- **Canvas** — frames, shapes, text, images; pan/zoom; snapping and layout.
- **Vector** — boolean operations (union/subtract/intersect) for real path
  editing.
- **Layout systems** — auto-layout-style frames and design tokens.
- **Generate** — describe what you want and XDesign builds editable layouts,
  prototypes, decks (HTML / PDF / PPTX), images and motion.
- **Prototypes** — wire flows and **present** them (⌘K → "Present Prototype").
- **Export to code** — turn a selection into React with **⌘K → "Export
  Selection to React"**.

Brand contracts and built-in design systems keep generated work on-style.`,
  },
  {
    id: "signin",
    title: "Sign-in & recovery",
    body: `# Sign-in

Sign-in is **optional** and off by default. Turn it on in **Settings →
Account** ("Enable sign-in"). It adds a lock screen on launch — a privacy gate,
**not disk encryption**.

- A successful unlock is remembered for **7 days** (then it re-prompts).
- **Change or disable** sign-in any time in Settings → Account.

### You can't get locked out of your own data
Forgetting the password is never fatal:

1. **Reset on the lock screen.** "Forgot password? Reset" removes the password
   only — your notes, files and designs are kept — and reopens the vault.
2. If the gate ever misbehaves it **fails open** to your data rather than
   trapping you.
3. **Last resort (manual):** quit the app and clear the credential from the
   database:
   \`\`\`sh
   sqlite3 ~/Library/Application\\ Support/com.lucaorion.orion-terminal/orion.db \\
     "DELETE FROM app_state WHERE key IN ('auth.user','auth.session');"
   \`\`\`
   Next launch opens unlocked with everything intact.`,
  },
];
