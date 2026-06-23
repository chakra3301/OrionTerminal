import { getDb } from "@/lib/db";
import { parseDesignSystem, type DesignSystem } from "@/apps/xdesign/designSystem";

type DSRow = {
  id: string;
  name: string;
  data_json: string;
  builtin: number;
  created_at: number;
  updated_at: number;
};

export async function listDesignSystems(): Promise<DesignSystem[]> {
  const db = await getDb();
  const rows = await db.select<DSRow[]>(
    "SELECT * FROM xd_design_systems ORDER BY builtin DESC, name",
    [],
  );
  return rows
    .map((r) => {
      let raw: unknown = {};
      try {
        raw = JSON.parse(r.data_json);
      } catch {
        raw = {};
      }
      return parseDesignSystem(
        { ...(raw as object), id: r.id, name: r.name, builtin: r.builtin === 1 },
        r.id,
      );
    })
    .filter((d): d is DesignSystem => !!d);
}

export async function upsertDesignSystem(ds: DesignSystem): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO xd_design_systems (id,name,data_json,builtin,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, data_json=excluded.data_json,
       updated_at=excluded.updated_at`,
    [ds.id, ds.name, JSON.stringify(ds), ds.builtin ? 1 : 0, ds.createdAt, ds.updatedAt],
  );
}

export async function deleteDesignSystem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM xd_design_systems WHERE id=$1 AND builtin=0", [id]);
}

export async function getActiveDesignSystemId(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ ds_id: string | null }[]>(
    "SELECT ds_id FROM xd_active_design_system WHERE k='active'",
    [],
  );
  return rows[0]?.ds_id ?? null;
}

export async function setActiveDesignSystemId(id: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO xd_active_design_system (k, ds_id) VALUES ('active', $1)
     ON CONFLICT(k) DO UPDATE SET ds_id=excluded.ds_id`,
    [id],
  );
}
