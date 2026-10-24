# Orion changes to photocraft-format

`crates/format` is photocraft-format 0.3.0 from https://github.com/storytold/photocraft at
`47f9306fd06d5dee11acb84b108606f4c867222a` (the revision `src-tauri/Cargo.toml` pins), with the
repository's `LICENSE-MIT`, `LICENSE-APACHE` and `NOTICE` alongside. It is wired in through
`[patch."https://github.com/storytold/photocraft"]` in `src-tauri/Cargo.toml`.

Changes from upstream:

- `src/store.rs`: `PcraftWriter::save_dir` writes its new tiles and blobs as one batch
  (`write_new_objects`). Each object still goes through a temporary file and a rename, but gets a
  plain `fsync` instead of `atomic_write`'s two `F_FULLFSYNC`s, and one full flush after the last
  object makes the batch durable before any rename. A whole-image save of a 4000×3000 photo (192
  new tiles) through Orion's `write_document` went from 2.66–3.02s to 0.81–1.01s.
- `Cargo.toml`: workspace-inherited fields are spelled out, and `nix` 0.28 with `fs` (already
  shipped through portable-pty) is added for the plain `fsync`, which `std` doesn't expose on
  macOS (its `sync_all` and `sync_data` are both `F_FULLFSYNC` there).
- Upstream's `tests/` and `fuzz/` are not copied.

Delete this directory and the `[patch]` once the pinned revision saves new objects with a single
flush.
