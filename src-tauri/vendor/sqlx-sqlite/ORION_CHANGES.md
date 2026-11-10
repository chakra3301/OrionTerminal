# Orion SQLite compatibility patch

Upstream: sqlx-sqlite 0.8.6, published crate SHA-256 c2d12fe70b2c1b4401038055f90f151b78208de1f9f89a7dbfd41587a10c3eea. The published Rust source and licenses are unchanged.

Only the libsqlite3-sys requirement in Cargo.toml and Cargo.toml.orig moves from 0.30.1 to 0.39.1. This lets Tauri 2's SQLx 0.8 driver share patched SQLite 3.54.1 with rusqlite 0.41, addressing RUSTSEC-2026-0459 without a Tauri 3 alpha upgrade or database migration.

Remove this patch once the supported upstream Tauri SQL plugin accepts a SQLx driver with libsqlite3-sys 0.39 or later. Validate migrations, backup/recovery and MCP database operations with the native suite and packaged recovery rehearsal.
