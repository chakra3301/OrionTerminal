#!/usr/bin/env python3
"""Fixture-only cold-recovery rehearsal. Never accepts an existing user profile.

Exercises the packaged database-copy command, generated historical schemas,
allowlisted data files, same-path promotion and preserved-original rollback.
Browser data here is a logical fixture export, NOT a WebKit profile transplant.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((REPO / "src-tauri/migrations").glob("*.sql"))
CONTENT_DIRS = ("assets", "wallpapers", "characters", "snapshots", "draft-recovery", "repolens", "command-center")
NOTE = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
PROJECT = "01ARZ3NDEKTSV4RRFFQ69G5FAW"


def mkdir(path):
    path.mkdir(mode=0o700)


def put(path, data):
    with path.open("xb") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Symlink in fixture recovery data")
        if path.is_dir():
            continue
        if not path.is_file():
            raise RuntimeError("Special file in fixture recovery data")
        key = path.relative_to(root).as_posix()
        if key != "manifest.json":
            result[key] = digest(path)
    return result


def seal(root):
    put(root / "manifest.json", json.dumps(inventory(root), sort_keys=True).encode())


def verify(root):
    if inventory(root) != json.loads((root / "manifest.json").read_text()):
        raise RuntimeError("Recovery manifest mismatch")


def clone(source, destination):
    if source.is_symlink():
        raise RuntimeError("Symlink in fixture recovery data")
    if source.is_dir():
        mkdir(destination)
        for child in source.iterdir():
            clone(child, destination / child.name)
    elif source.is_file():
        put(destination, source.read_bytes())
    else:
        raise RuntimeError("Special file in fixture recovery data")


@contextlib.contextmanager
def stopped_writer_lease(path):
    with path.open("a+b") as handle:
        os.fchmod(handle.fileno(), 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Fixture writer is still running") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def apply(conn, start, end):
    for index in range(start, end):
        sql = MIGRATIONS[index].read_text()
        conn.executescript("BEGIN;\n" + sql)
        conn.execute("INSERT INTO _sqlx_migrations(version,success,checksum) VALUES(?,1,?)", (index + 1, hashlib.sha384(sql.encode()).digest()))
        conn.commit()


def seed(path, count):
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL DEFAULT 0)")
        apply(conn, 0, count)
        conn.execute("INSERT INTO notes(id,title,blocks_json,plaintext,created_at,updated_at) VALUES(?, 'Persisted fixture', '[]', 'before',1,1)", (NOTE,))
        conn.execute("INSERT INTO app_state(key,value) VALUES('xdesign.projects', ?)", ('{"registry":[]}',))
    os.chmod(path, 0o600)


def copy_db(binary, source, destination):
    env = {k: v for k, v in os.environ.items() if not (k.endswith("_API_KEY") or k in {"ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "NODE_OPTIONS", "NODE_PATH"})}
    result = subprocess.run([str(binary), "--restore-db-copy", str(source), str(destination)], capture_output=True, timeout=45, env=env)
    if result.returncode:
        raise RuntimeError("Packaged database-copy command refused the fixture")


def promote(live, candidate, preserved, lease):
    with stopped_writer_lease(lease):
        verify(candidate)
        if preserved.exists() or preserved.is_symlink():
            raise RuntimeError("Preserved-original destination already exists")
        live.rename(preserved)
        try:
            candidate.rename(live)
        except BaseException:
            if not live.exists():
                preserved.rename(live)
            raise


def rollback(live, preserved, failed, lease):
    with stopped_writer_lease(lease):
        if failed.exists() or failed.is_symlink():
            raise RuntimeError("Failed-profile destination already exists")
        if not preserved.is_dir() or preserved.is_symlink():
            raise RuntimeError("Preserved original is unavailable")
        if live.exists() or live.is_symlink():
            live.rename(failed)
        preserved.rename(live)


def run(binary, root):
    report = {"scope": "Synthetic cold same-path data recovery; no live user profile or credentials read", "historicalSchemaPrefixes": []}
    for count in range(3, len(MIGRATIONS)):
        with tempfile.TemporaryDirectory(prefix="schema-", dir=root) as folder:
            folder = Path(folder)
            seed(folder / "old.db", count)
            original_hash = digest(folder / "old.db")
            copy_db(binary, folder / "old.db", folder / "copy")
            with sqlite3.connect(folder / "copy/orion.db") as conn:
                apply(conn, count, len(MIGRATIONS))
                assert conn.execute("SELECT title,plaintext FROM notes WHERE id=?", (NOTE,)).fetchone() == ("Persisted fixture", "before")
                assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                assert not conn.execute("PRAGMA foreign_key_check").fetchall()
                conn.execute("UPDATE notes SET plaintext='UPGRADE_FTS_PROOF' WHERE id=?", (NOTE,))
                assert conn.execute("SELECT entity_id FROM search_index WHERE search_index MATCH 'UPGRADE_FTS_PROOF'").fetchone()[0] == NOTE
            copy_db(binary, folder / "copy/orion.db", folder / "validated-upgrade")
            assert digest(folder / "old.db") == original_hash
            report["historicalSchemaPrefixes"].append(count)

    live, stage, preserved, failed = [root / name for name in ("live", "candidate", "preserved-original", "failed-restoration")]
    mkdir(live); mkdir(live / "app"); mkdir(live / "workspace")
    seed(live / "app/orion.db", len(MIGRATIONS))
    for directory in CONTENT_DIRS:
        mkdir(live / "app" / directory)
    asset = live / "app/assets/reference.svg"
    put(asset, b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>')
    put(live / "workspace/main.ts", b"export const restored = 47;\n")
    for directory in ("wallpapers", "characters", "snapshots", "repolens", "command-center"):
        put(live / "app" / directory / "fixture.bin", (directory + "-fixture").encode())
    put(live / "app/draft-recovery/01ARZ3NDEKTSV4RRFFQ69G5FAV.json", json.dumps({"version": 1, "revision": 1, "updated": 1, "items": [{"kind": "file", "path": str(live / "workspace/main.ts"), "contents": "unsaved fixture"}]}).encode())
    put(live / "app/draft-recovery/01ARZ3NDEKTSV4RRFFQ69G5FAV.lock", b"")
    put(live / "browser-project-data.json", json.dumps({"xd-html-artifact." + NOTE: {"html": "<h1>Logical browser-state fixture</h1>", "title": "Recovery fixture", "open": False}}).encode())
    mkdir(live / "app/codex-auth"); put(live / "app/codex-auth/NOT-A-CREDENTIAL", b"excluded fixture marker")
    document = {"pages": [{"id": "page-recovery", "name": "Recovery page", "shapes": [{"id": "reference", "name": "Reference", "kind": "image", "x": 0, "y": 0, "w": 1, "h": 1, "fill": "none", "stroke": "none", "strokeWidth": 0, "filePath": str(asset), "assetId": NOTE}]}], "activePageId": "page-recovery"}
    document["htmlArtifact"] = {"version": 1, "html": "<!doctype html><h1>SQLite webpage recovery — 🛰️</h1>", "title": "Recovery webpage", "open": True}
    registry = {"registry": [{"id": PROJECT, "kind": "design", "name": "Recovery fixture", "createdAt": 1, "updatedAt": 1}], "openIds": [PROJECT], "activeId": PROJECT}
    with sqlite3.connect(live / "app/orion.db") as conn:
        conn.execute("UPDATE app_state SET value=? WHERE key='xdesign.projects'", (json.dumps(registry),))
        conn.execute("INSERT INTO app_state(key,value) VALUES(?,?)", ("xdesign.project." + PROJECT, json.dumps(document)))
        conn.execute("INSERT INTO assets(id,kind,title,file_path,created_at) VALUES(?,'image','Reference',?,1)", (NOTE, str(asset)))
        conn.execute("INSERT INTO projects(id,name,root_path,last_opened_at) VALUES(?,'Workspace fixture',?,1)", (PROJECT, str(live / "workspace")))
    lease = root / "writer.lock"
    worker = subprocess.Popen([sys.executable, "-c", "import sqlite3,fcntl,sys,os; lock=open(sys.argv[1],'a+b'); fcntl.flock(lock,fcntl.LOCK_EX); c=sqlite3.connect(sys.argv[2]); c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA wal_autocheckpoint=0'); c.execute(\"UPDATE notes SET plaintext='COMMITTED_WAL_FIXTURE'\"); c.commit(); print('ready',flush=True); sys.stdin.readline(); os._exit(0)", str(lease), str(live / "app/orion.db")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        import select
        if not select.select([worker.stdout], [], [], 10)[0] or worker.stdout.readline().strip() != "ready":
            raise RuntimeError("Fixture writer did not become ready")
        try:
            with stopped_writer_lease(lease):
                raise AssertionError("Running writer was admitted")
        except RuntimeError as error:
            assert "still running" in str(error)
        worker.stdin.write("stop\n"); worker.stdin.flush(); worker.wait(timeout=10)
    finally:
        if worker.poll() is None:
            worker.kill(); worker.wait(timeout=10)
        worker.stdin.close(); worker.stdout.close()
    assert (live / "app/orion.db-wal").exists()
    assert (live / "app/orion.db-shm").exists()
    before = inventory(live)
    with stopped_writer_lease(lease):
        sqlite_input = root / "sqlite-input"
        mkdir(sqlite_input)
        # SQLite read-only connections can update SHM read marks. Recover a cold
        # copy so the original DB/WAL/SHM remains byte-for-byte preserved.
        for name in ("orion.db", "orion.db-wal", "orion.db-shm"):
            clone(live / "app" / name, sqlite_input / name)
        mkdir(stage); copy_db(binary, sqlite_input / "orion.db", stage / "app")
        for directory in CONTENT_DIRS:
            clone(live / "app" / directory, stage / "app" / directory)
        clone(live / "workspace", stage / "workspace")
        clone(live / "browser-project-data.json", stage / "browser-project-data.json")
        seal(stage)
    assert inventory(live) == before
    assert not (stage / "app/orion.db-wal").exists() and not (stage / "app/orion.db-shm").exists()
    assert not (stage / "app/codex-auth").exists()
    test_asset = stage / "app/assets/reference.svg"
    payload = test_asset.read_bytes(); test_asset.write_bytes(b"tampered")
    try:
        promote(live, stage, preserved, lease)
        raise AssertionError("Tampered candidate accepted")
    except RuntimeError as error:
        assert "manifest mismatch" in str(error)
    assert inventory(live) == before and not preserved.exists()
    test_asset.write_bytes(payload)
    link = stage / "app/assets/unsafe-link"
    link.symlink_to(asset)
    try:
        verify(stage)
        raise AssertionError("Symlink accepted")
    except RuntimeError as error:
        assert "Symlink" in str(error)
    link.unlink()
    with stopped_writer_lease(lease):
        live.rename(preserved)
    rollback(live, preserved, failed, lease)
    assert inventory(live) == before and not failed.exists()
    verify(stage)
    mkdir(preserved)
    try:
        promote(live, stage, preserved, lease)
        raise AssertionError("Existing preservation destination accepted")
    except RuntimeError as error:
        assert "already exists" in str(error)
    preserved.rmdir()
    promote(live, stage, preserved, lease)
    assert inventory(preserved) == before
    assert not (live / "app/orion.db-wal").exists() and not (live / "app/orion.db-shm").exists()
    with sqlite3.connect((live / "app/orion.db").as_uri() + "?mode=ro&immutable=1", uri=True) as conn:
        assert conn.execute("SELECT plaintext FROM notes WHERE id=?", (NOTE,)).fetchone()[0] == "COMMITTED_WAL_FIXTURE"
        assert json.loads(conn.execute("SELECT value FROM app_state WHERE key='xdesign.projects'").fetchone()[0]) == registry
        restored_doc = json.loads(conn.execute("SELECT value FROM app_state WHERE key=?", ("xdesign.project." + PROJECT,)).fetchone()[0])
        assert restored_doc == document
        shape = restored_doc["pages"][0]["shapes"][0]
        asset_path = conn.execute("SELECT file_path FROM assets WHERE id=?", (shape["assetId"],)).fetchone()[0]
        assert shape["filePath"] == asset_path and Path(asset_path).read_bytes() == payload
        workspace = conn.execute("SELECT root_path FROM projects WHERE id=?", (PROJECT,)).fetchone()[0]
        assert (Path(workspace) / "main.ts").read_bytes() == b"export const restored = 47;\n"
    restored_hashes = inventory(live)
    rollback(live, preserved, failed, lease)
    assert inventory(live) == before and inventory(failed) == restored_hashes
    report.update({"currentMigrationCount": len(MIGRATIONS), "activeFixtureWriterRefused": True, "committedWalRecovered": True, "originalDatabaseWalShmPreservedTogether": True, "staleSidecarsNotPromoted": True, "tamperedCandidateRefused": True, "symlinkRefused": True, "interruptedPromotionGapRolledBack": True, "existingPreservationDestinationRefused": True, "samePathAssetAndWorkspaceReferencesResolved": True, "sqliteWebpageRestored": True, "externalDataAndLogicalBrowserFixturePreserved": True, "credentialDirectoryExcluded": True, "rollbackPreservedBothVersions": True, "liveProfilePromotionAccepted": False, "webKitProfileRestoreAccepted": False, "realHistoricalUserDatabaseAccepted": False, "hardPowerLossAccepted": False})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not __debug__:
        parser.error("Recovery verification requires Python assertions; do not use -O or PYTHONOPTIMIZE")
    if args.report.exists() or args.report.is_symlink():
        parser.error("--report must be a new path; existing files are never overwritten")
    if not args.binary.is_absolute() or not args.binary.is_file():
        parser.error("--binary must identify an absolute built executable")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="orion-profile-fixture-", dir=args.report.parent) as folder:
        result = run(args.binary, Path(folder))
    result.update({"binarySha256": digest(args.binary), "fixturesRemoved": True})
    put(args.report, (json.dumps(result, indent=2) + "\n").encode())
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
