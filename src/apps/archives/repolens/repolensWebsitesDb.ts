import { getDb } from "@/lib/db";

export type WebsiteStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled"
  | "paused";

export type WebsiteRipRow = {
  id: string;
  url: string;
  hostname: string;
  title: string;
  status: WebsiteStatus;
  phase: string;
  project_path: string;
  thumbnail_path: string | null;
  log: string;
  session_id: string | null;
  error: string | null;
  model: string;
  design_json: string | null;
  design_at: number | null;
  created_at: number;
  updated_at: number;
};

export async function listRips(limit = 100): Promise<WebsiteRipRow[]> {
  const db = await getDb();
  return db.select<WebsiteRipRow[]>(
    `SELECT * FROM repolens_websites ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getRip(id: string): Promise<WebsiteRipRow | null> {
  const db = await getDb();
  const rows = await db.select<WebsiteRipRow[]>(
    `SELECT * FROM repolens_websites WHERE id=$1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteRipRow(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM repolens_websites WHERE id=$1`, [id]);
}
