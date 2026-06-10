# Cursor research — June 2026 (Phase 1 ground truth)

Condensed from two web-research passes (features + user sentiment). Full citations were
verified at research time; key uncertainty flags noted inline.

## What Cursor is now
Cursor 3.7 (June 2026), in-house Composer 2.5 model. Product pivoted hard to an
**agent-execution platform** (Agents Window, cloud agents, /multitask fleets, worktree
parallelism). Notably: the editor-first power-user crowd is vocally unhappy about that
pivot — they stay for Tab + visible diffs, not the swarm UI. (Orion Terminal already has
the swarm surface in Hermes; Orion the editor should stay editor-first.)

## Tab autocomplete (the #1 loved feature, by far)
- Runs on every user action (keystroke, cursor move, file switch); a learned policy
  decides whether to SHOW — quiet when low-confidence. 400M+ req/day.
- Suggests **diffs, not just insertions**: multi-line edits, auto-imports, coordinated
  changes; edit suggestions render as a small diff popup beside the cursor.
- **Jump-to-next-edit**: after accept, Tab again jumps to the predicted next edit site
  (incl. cross-file "portals") — the "tab-tab-tab through a refactor" signature.
- Context: **recent edit history**, surrounding code, **linter errors**.
- Accept: Tab = full · ⌘→ = word-by-word · Esc/keep-typing = dismiss. Snooze/per-filetype off.
- Latency: ~260ms server (secondary source); users measured ~320ms vs Copilot ~890ms and
  still called BOTH "friction in flow state" — latency IS the product.

## Agent/review (the trust anchor)
- Inline red/green diffs with accept/reject is the most-loved review UX; its regressions
  (silent direct-to-disk writes, diffs missing files, "Undo all" leaving partial state)
  caused the loudest 2026 forum revolts. **Silent disk writes = betrayal.**
- Review bar: per-file nav, Keep All / Undo All, commit&push from review (2.1),
  consolidated multi-file review pane (2.0). Per-hunk chips historically; in flux 2026.
- **Checkpoints**: auto before significant changes, local, separate from git, one-click
  preview/restore → "fearless experimentation." Restore semantics must never destroy history.
- Plan Mode: numbered file-level plan, clarifying questions, plan saved as editable file.

## ⌘K inline edit
Selection-scoped, streams the rewrite in place, follow-up instructions without
reselecting, ⌥Return = quick question about selection ("do it" converts to edit),
⌘Enter accept / ⌘N reject. Terminal ⌘K: NL → shell command (Esc insert, ⌘Enter run).

## @-context + indexing
- 2026 canonical mentions: @file, @folder, @Docs, @Terminals, @Past Chats,
  @Commit (working diff), @Branch (diff vs main), @Browser. (Older @Web/@Code/@Lint
  folded into automatic agent tools.)
- Indexing: chunks = functions/classes/logical blocks → embeddings; auto-index on open,
  searchable at 80%; **incremental sync ~5min, changed files only**; respects
  .gitignore/.cursorignore; large-monorepo jank is a top-10 complaint (index bounded!).
- Context opacity is complaint #4: "I don't know what it sent" / truncation suspicion.
  → **context pills showing exactly what was attached is a validated differentiator.**

## Git
AI commit messages (wand), commit&push from review, @Branch/@Commit context, Agent
Review vs main, PR-review UI, Cursor Blame (AI-vs-human authorship), Bugbot hosted PR
review. Baseline VS Code source-control panel underneath.

## Top daily workflows (frequency-ranked, inferred)
1. Tab chain through an edit (constant) · 2. ⌘P/⌘⇧P/⌘⇧F navigation (constant) ·
3. @-mention context per prompt · 4. Agent a feature (⌘I/⌘L, ~80% of AI time) ·
5. Review multi-file diff → commit from review · 6. ⌘K selection rewrite ·
7. Allowlisted test loop ("code until tests pass") · 8. Terminal ⌘K · 9. AI commit msg ·
10. Plan Mode for non-trivial · 11. Parallel agents/worktrees · 12. Cloud agents ·
13. Pre-PR AI review · 14. Design Mode UI iteration · 15. Debug Mode.

## Sentiment — what to copy / what to dodge
**Loved:** Tab next-edit prediction · whole-codebase semantic context · inline red/green
review · zero learning curve · checkpoints · loop speed · multi-model · ⌘K.
**Hated (and our structural answers):** pricing opacity (n/a — subscription CLI + local) ·
memory bloat 20-100GB, daily restarts (stay lean — Phase 0 perf discipline) · "models got
dumber" Auto-routing distrust (we pin explicit models) · context opacity (context pills) ·
review regressions (never write without staged review — P2a architecture is exactly right) ·
agent-first drift (Hermes owns swarms; Orion stays editor-first) · monorepo indexing jank
(bound the index, incremental only).
**Feel laws:** latency is the product · visible diffs are the trust anchor · reversibility
= courage · Tab is a navigation verb, not autocomplete · predictability is a feature.
