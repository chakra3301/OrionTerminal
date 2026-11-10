# Brief 02: Rename "Orion Terminal" to "Orion Studio" in the owner's videos (phase 1: inventory and one proof)

Assigned to: GPT 6.1 (Codex). Coordinator: Claude. Owner: Luca.

## The one rule that matters

The owner, verbatim: "it's very important that nothing else in those videos change because they are perfect as is except for the naming."

Only the product name changes. Leave everything else exactly as it is: the logo/mark graphics (keep the old mark), fonts, sizes, tracking, colours, positions, timing, cuts, motion, audio and length. If you can't change the name without changing something else, stop and report. Don't improvise.

## Where things are

- `~/Desktop/video gen`: a git repo, on `main`, clean.
  - Films live in `videos/NN-*/`, Rust + SkSL. Each film's `run.sh` documents its commands; the Cargo target is `~/Library/Caches/video-gen/target`.
  - Orion films are probably `01-ot05-enter`, `05-ot06-astral`, `06-ot07-blades` and `07-ot02-rosie-cyber`. Check the others too (`02`, `03`, `04`), but skip them if they don't show the name.
- `~/OpenMontage`: a git repo, on `main`, clean. It contains `projects/orion-terminal-beta/` (HyperFrames: `hyperframes/index.html`; renders in `renders/`).
- Delivered files, read-only for you:
  - `~/Movies/Orion Terminal Teaser 07/`, whose `SOURCE.txt` points at `06-ot07-blades`
  - any other `~/Movies/*Orion*` folders

## Hard rules

- **Never overwrite, move, re-encode in place, or delete any existing video, audio, image or media file.**
  - Every render goes to a new path with an explicit `-o`, under `<film>/output/orion-studio/`. Never use a command's default output path, because it overwrites the existing render.
  - Don't edit existing files in `ref/`, `media/`, `music/` or `dynamic_media/`. If a step would regenerate one (for example `./run.sh source` writing `dynamic_media/src.mp4`), stop and report instead of running it.
- Source edits only on a new branch `rename-orion-studio` in each repo. Leave them uncommitted. No pushes, no uploads, no posting.
- Disk is tight. Run `df -h ~` before every render and stop if less than 8 GB is free. Delete your own temporary frame dumps when you finish.
- The coordinator has recorded the size and modification time of every existing media file. Anything you change will show up.

## Phase 1 (this run)

### 1. Inventory

Do this for every Orion video, whether it's in a film folder, in OpenMontage, or delivered in `~/Movies`.

1. List the delivered files: path, length, resolution, fps, codec, and whether an audio track is present (use `ffprobe`).
2. List every place the name appears:
   - in source, as `file:line`. Search case-insensitively for `orion terminal`, `orion-terminal`, `oriontermina`, and a standalone `TERMINAL` next to `ORION`.
   - also check the frames themselves: extract stills (`./run.sh frame` / `strip`, or `ffmpeg`) and look.
3. For each appearance, record:
   - the exact on-screen string and its timestamps
   - how it's made: a text string rendered with a font, a drawn shape or glyph, an image asset, or **baked into a screen recording**. Baked-in names can't be renamed without re-recording, so flag them clearly.
   - whether it animates per letter. "Orion Studio" is two characters shorter than "Orion Terminal". Say what that would change: centring, letter timing, when the animation finishes.
4. Work out which source commit each delivered file was rendered from, if you can tell.

### 2. One proof: `06-ot07-blades` (Teaser 07)

Use the delivered `~/Movies/Orion Terminal Teaser 07/orion-terminal-teaser-07-v4-web.mp4`. Its settings are in the film's `NOTES.md`, `run.sh`, and the git log.

1. **Baseline.** Render the *unchanged* source with the delivered file's settings into `output/orion-studio/baseline.mp4`. Compare it with the delivered file frame by frame (`ffmpeg` PSNR/SSIM per frame).
   - If the baseline doesn't reproduce the delivered video, stop and report why. That would be a source change since delivery, randomness, or different settings. Anything beyond encoder noise counts. Do not continue.
2. **Rename.** Change only the name string(s). Render with identical settings into `output/orion-studio/orion-studio-teaser-07-v4-web.mp4`.
3. **Prove only the name changed.** Diff the renamed render against the baseline:
   - List the frame ranges that differ, with each difference's bounding box.
   - Show that every difference is inside the name's area.
   - Confirm the audio is identical (`ffmpeg -map 0:a -f md5`), and that length, fps and resolution match.
   - Save a few before/after stills of the name frames to `output/orion-studio/check/`.
4. Do **not** rename any other film in this run.

## Deliverable

Write `~/Desktop/video gen/docs/orion-studio-rename-report.md` with these sections:

1. **Inventory:** a table per video.
2. **Proof results:** the baseline-vs-delivered numbers, the renamed-vs-baseline numbers, the differing regions, the audio hash match, and the still paths.
3. **Per-video plan for phase 2:** the approach, the risk, and render time.
4. **Videos that can't be renamed cleanly, and why.**

End your final message with the report path and a one-paragraph verdict: can the rename be done without changing anything else?
