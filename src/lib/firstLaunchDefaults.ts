import { getDb } from "./db";

const DEFAULTS = [
  ["plugins.state", { version: 1, disabled: ["@orion/command-center", "@orion/hermes"] }],
  ["wallpaper", { mode: "default", customPath: null, originalName: null, overlay: "none", overlayIntensity: 0.6, matrixHue: 145, coreHue: 354 }],
  // The tour remains available from Help, without becoming a third setup step.
  ["onboarding.completed", true],
] as const;

export function firstLaunchDefaultsStatement(tables: string[]) {
  const emptyTables = tables.map(name => `NOT EXISTS (SELECT 1 FROM "${name.replaceAll('"', '""')}")`);
  const condition = ["NOT EXISTS (SELECT 1 FROM app_state WHERE key NOT IN ('window_size', 'shell.windows', 'shell.focusedWindowId'))", ...emptyTables].join(" AND ");
  return {
    checkSql: `SELECT 1 AS fresh WHERE ${condition}`,
    sql: `INSERT OR IGNORE INTO app_state (key, value)
      SELECT key, value FROM (${DEFAULTS.map((_, i) => `SELECT $${i * 2 + 1} AS key, $${i * 2 + 2} AS value`).join(" UNION ALL ")})
      WHERE ${condition}`,
    values: DEFAULTS.flatMap(([key, value]) => [key, JSON.stringify(value)]),
  };
}

export async function initializeFirstLaunchDefaults(): Promise<void> {
  const db = await getDb();
  // FTS shadow tables contain configuration even in an empty database. Only
  // real user tables count; schema history and automatic window sizing do not.
  const tables = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table'
      AND name NOT LIKE 'sqlite_%' AND name NOT IN ('app_state', '_sqlx_migrations')`,
  );
  const { sql, checkSql, values } = firstLaunchDefaultsStatement(tables.map(table => table.name));
  if (!(await db.select<{ fresh: number }[]>(checkSql)).length) return;
  await db.execute(sql, values);
}
