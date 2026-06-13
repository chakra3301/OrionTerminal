import { getDb } from "@/lib/db";
import type { RepoAnalysis, Lenses, Platform } from "./types";

export type ScanRow = {
  repo_id: string;
  platform: Platform;
  model: string;
  tone: string;
  analysis: RepoAnalysis;
  lenses: Lenses;
  created_at: number;
  updated_at: number;
};

type RawRow = {
  repo_id: string;
  platform: Platform;
  model: string;
  tone: string;
  analysis_json: string;
  lenses_json: string;
  created_at: number;
  updated_at: number;
};

function hydrate(r: RawRow): ScanRow {
  return {
    repo_id: r.repo_id,
    platform: r.platform,
    model: r.model,
    tone: r.tone,
    analysis: JSON.parse(r.analysis_json) as RepoAnalysis,
    lenses: JSON.parse(r.lenses_json || "{}") as Lenses,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function saveScan(row: {
  repo_id: string;
  platform: Platform;
  model: string;
  tone: string;
  analysis: RepoAnalysis;
  lenses?: Lenses;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO repolens_scans (repo_id, platform, model, tone, analysis_json, lenses_json, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT(repo_id) DO UPDATE SET platform=$2, model=$3, tone=$4, analysis_json=$5, lenses_json=$6, updated_at=$7`,
    [
      row.repo_id,
      row.platform,
      row.model,
      row.tone,
      JSON.stringify(row.analysis),
      JSON.stringify(row.lenses ?? {}),
      now,
    ],
  );
}

export async function updateLenses(repoId: string, lenses: Lenses): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE repolens_scans SET lenses_json=$2, updated_at=$3 WHERE repo_id=$1`, [
    repoId,
    JSON.stringify(lenses),
    Date.now(),
  ]);
}

export async function getScan(repoId: string): Promise<ScanRow | null> {
  const db = await getDb();
  const rows = await db.select<RawRow[]>(`SELECT * FROM repolens_scans WHERE repo_id=$1`, [repoId]);
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function listScans(limit = 100): Promise<ScanRow[]> {
  const db = await getDb();
  const rows = await db.select<RawRow[]>(
    `SELECT * FROM repolens_scans ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(hydrate);
}

export async function deleteScan(repoId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM repolens_scans WHERE repo_id=$1`, [repoId]);
}
