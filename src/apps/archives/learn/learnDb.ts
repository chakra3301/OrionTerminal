// src/apps/archives/learn/learnDb.ts
import { getDb } from "@/lib/db";
import type { TopicRow, NodeRow, EdgeRow, ReviewRow } from "./learnTypes";

export async function listTopics(): Promise<TopicRow[]> {
  const db = await getDb();
  return db.select<TopicRow[]>("SELECT * FROM learn_topics WHERE status='active' ORDER BY updated_at DESC", []);
}

export async function insertTopic(r: TopicRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_topics (id,title,summary,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [r.id, r.title, r.summary, r.status, r.created_at, r.updated_at],
  );
}

export async function deleteTopic(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM learn_reviews WHERE node_id IN (SELECT id FROM learn_nodes WHERE topic_id=$1)",
    [id],
  );
  await db.execute("DELETE FROM learn_nodes WHERE topic_id=$1", [id]);
  await db.execute("DELETE FROM learn_edges WHERE topic_id=$1", [id]);
  await db.execute("DELETE FROM learn_topics WHERE id=$1", [id]);
}

export async function listNodes(topicId: string): Promise<NodeRow[]> {
  const db = await getDb();
  return db.select<NodeRow[]>("SELECT * FROM learn_nodes WHERE topic_id=$1 ORDER BY order_idx", [topicId]);
}

export async function insertNode(r: NodeRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_nodes (id,topic_id,title,objective,bloom_level,level,order_idx,lesson_json,lesson_at,p_mastery,attempts,last_seen,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [r.id, r.topic_id, r.title, r.objective, r.bloom_level, r.level, r.order_idx, r.lesson_json, r.lesson_at, r.p_mastery, r.attempts, r.last_seen, r.status],
  );
}

export async function updateNode(id: string, patch: Partial<NodeRow>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const db = await getDb();
  const set = cols.map((c, i) => `${c}=$${i + 2}`).join(",");
  await db.execute(`UPDATE learn_nodes SET ${set} WHERE id=$1`, [id, ...cols.map((c) => (patch as any)[c])]);
}

export async function insertEdge(e: EdgeRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO learn_edges (topic_id,from_node,to_node) VALUES ($1,$2,$3)",
    [e.topic_id, e.from_node, e.to_node],
  );
}

export async function listEdges(topicId: string): Promise<EdgeRow[]> {
  const db = await getDb();
  return db.select<EdgeRow[]>("SELECT * FROM learn_edges WHERE topic_id=$1", [topicId]);
}

export async function insertReview(r: ReviewRow): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO learn_reviews (id,node_id,ts,correct,kind) VALUES ($1,$2,$3,$4,$5)",
    [r.id, r.node_id, r.ts, r.correct, r.kind],
  );
}
