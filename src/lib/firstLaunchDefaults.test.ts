import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => db }));
import { firstLaunchDefaultsStatement, initializeFirstLaunchDefaults } from "./firstLaunchDefaults";

function apply(seed = "", race = "") {
  const statement = firstLaunchDefaultsStatement(["notes", "hermes_tasks"]);
  return JSON.parse(execFileSync("python3", ["-c", `
import sqlite3, json, sys
s = json.loads(sys.argv[1]); db = sqlite3.connect(':memory:')
db.executescript('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE notes(id TEXT); CREATE TABLE hermes_tasks(id TEXT);')
db.executescript(sys.argv[2])
before = dict(db.execute('SELECT key,value FROM app_state'))
fresh = list(db.execute(s['checkSql']))
db.executescript(sys.argv[3])
bindings = {str(i+1): value for i, value in enumerate(s['values'])}
db.execute(s['sql'], bindings)
after = dict(db.execute('SELECT key,value FROM app_state'))
db.execute(s['sql'], bindings)
assert after == dict(db.execute('SELECT key,value FROM app_state'))
print(json.dumps({'before':before, 'after':after, 'fresh':bool(fresh)}))
`, JSON.stringify(statement), seed, race], { encoding: "utf8" }));
}

describe("first-install defaults", () => {
  it("atomically seeds only three apps, a still wallpaper and optional tour, once", () => {
    const { after } = apply("INSERT INTO app_state VALUES('window_size','{\"width\":800}');");
    expect(JSON.parse(after["plugins.state"])).toEqual({ version: 1, disabled: ["@orion/command-center", "@orion/hermes"] });
    expect(JSON.parse(after.wallpaper).overlay).toBe("none");
    expect(JSON.parse(after["onboarding.completed"])).toBe(true);
    expect(after.window_size).toBe('{"width":800}');
    expect(Object.keys(after)).toHaveLength(4);
  });

  it("preserves existing preferences and even old invalid state rather than reseeding", () => {
    for (const seed of [
      "INSERT INTO app_state VALUES('plugins.state','{\"version\":1,\"disabled\":[]}');",
      "INSERT INTO app_state VALUES('wallpaper','{\"overlay\":\"matrix\"}');",
      "INSERT INTO app_state VALUES('theme','\"liquid\"');",
      "INSERT INTO app_state VALUES('wallpaper','broken');",
    ]) {
      const result = apply(seed);
      expect(result.fresh).toBe(false);
      expect(result.after).toEqual(result.before);
    }
  });

  it("does not alter data-rich legacy installs with no app_state yet", () => {
    for (const table of ["notes", "hermes_tasks"]) expect(apply(`INSERT INTO ${table} VALUES('keep');`).after).toEqual({});
  });

  it("rechecks at insertion and never overwrites a concurrent preference", () => {
    const result = apply("", "INSERT INTO app_state VALUES('plugins.state','{\"version\":1,\"disabled\":[]}');");
    expect(result.fresh).toBe(true);
    expect(result.after).toEqual({ "plugins.state": '{"version":1,"disabled":[]}' });
  });

  it("checks real tables, excludes schema/FTS bookkeeping and avoids legacy writes", async () => {
    db.select.mockReset().mockResolvedValueOnce([{ name: "notes" }]).mockResolvedValueOnce([]);
    db.execute.mockReset();
    await initializeFirstLaunchDefaults();
    expect(db.select.mock.calls[0]![0]).toContain("type = 'table'");
    expect(db.select.mock.calls[0]![0]).toContain("'_sqlx_migrations'");
    expect(db.execute).not.toHaveBeenCalled();
  });
});
