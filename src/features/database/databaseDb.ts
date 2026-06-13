import { getDb } from "@/lib/db";
import { ulid } from "ulid";
import type { Property, PropertyType, SelectOption, Filter } from "./propertyTypes";

/** DB layer for the collection-database tables (migration 0020). Thin
 * wrappers; the store mirrors these into memory. */

type PropertyRow = {
  id: string;
  collection_id: string;
  name: string;
  type: string;
  options_json: string;
  position: number;
};

function rowToProperty(r: PropertyRow): Property {
  let options: SelectOption[] = [];
  try {
    options = JSON.parse(r.options_json) as SelectOption[];
  } catch {
    options = [];
  }
  return {
    id: r.id,
    collectionId: r.collection_id,
    name: r.name,
    type: r.type as PropertyType,
    options,
    position: r.position,
  };
}

export async function listProperties(collectionId: string): Promise<Property[]> {
  const db = await getDb();
  const rows = await db.select<PropertyRow[]>(
    "SELECT id, collection_id, name, type, options_json, position FROM collection_properties WHERE collection_id = $1 ORDER BY position, created_at",
    [collectionId],
  );
  return rows.map(rowToProperty);
}

export async function createProperty(
  collectionId: string,
  name: string,
  type: PropertyType,
  position: number,
): Promise<Property> {
  const db = await getDb();
  const id = ulid();
  await db.execute(
    "INSERT INTO collection_properties(id, collection_id, name, type, options_json, position, created_at) VALUES ($1,$2,$3,$4,'[]',$5,$6)",
    [id, collectionId, name, type, position, Date.now()],
  );
  return { id, collectionId, name, type, options: [], position };
}

export async function updateProperty(
  id: string,
  patch: { name?: string; type?: PropertyType; options?: SelectOption[]; position?: number },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); args.push(patch.name); }
  if (patch.type !== undefined) { sets.push(`type = $${i++}`); args.push(patch.type); }
  if (patch.options !== undefined) { sets.push(`options_json = $${i++}`); args.push(JSON.stringify(patch.options)); }
  if (patch.position !== undefined) { sets.push(`position = $${i++}`); args.push(patch.position); }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute(
    `UPDATE collection_properties SET ${sets.join(", ")} WHERE id = $${i}`,
    args,
  );
}

export async function deleteProperty(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM note_property_values WHERE property_id = $1", [id]);
  await db.execute("DELETE FROM collection_properties WHERE id = $1", [id]);
}

/** All property values for the notes in a collection: note_id -> (prop_id -> value). */
export async function listValuesForCollection(
  collectionId: string,
): Promise<Map<string, Map<string, string>>> {
  const db = await getDb();
  const rows = await db.select<Array<{ note_id: string; property_id: string; value: string }>>(
    `SELECT v.note_id, v.property_id, v.value
     FROM note_property_values v
     JOIN collection_properties p ON p.id = v.property_id
     WHERE p.collection_id = $1`,
    [collectionId],
  );
  const out = new Map<string, Map<string, string>>();
  for (const r of rows) {
    let m = out.get(r.note_id);
    if (!m) { m = new Map(); out.set(r.note_id, m); }
    m.set(r.property_id, r.value);
  }
  return out;
}

export async function setValue(
  noteId: string,
  propertyId: string,
  value: string,
): Promise<void> {
  const db = await getDb();
  if (value === "") {
    await db.execute(
      "DELETE FROM note_property_values WHERE note_id = $1 AND property_id = $2",
      [noteId, propertyId],
    );
    return;
  }
  await db.execute(
    `INSERT INTO note_property_values(note_id, property_id, value) VALUES ($1,$2,$3)
     ON CONFLICT(note_id, property_id) DO UPDATE SET value = excluded.value`,
    [noteId, propertyId, value],
  );
}

// ── Saved views ─────────────────────────────────────────────────────────────

export type ViewType = "table" | "board" | "gallery" | "calendar";

export type ViewConfig = {
  filters?: Filter[];
  sort?: { propertyId: string; dir: "asc" | "desc" } | null;
  groupBy?: string | null; // propertyId for board grouping
  hidden?: string[]; // hidden property ids
};

export type CollectionView = {
  id: string;
  collectionId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: number;
};

type ViewRow = {
  id: string;
  collection_id: string;
  name: string;
  type: string;
  config_json: string;
  position: number;
};

function rowToView(r: ViewRow): CollectionView {
  let config: ViewConfig = {};
  try { config = JSON.parse(r.config_json) as ViewConfig; } catch { config = {}; }
  return {
    id: r.id,
    collectionId: r.collection_id,
    name: r.name,
    type: r.type as ViewType,
    config,
    position: r.position,
  };
}

export async function listViews(collectionId: string): Promise<CollectionView[]> {
  const db = await getDb();
  const rows = await db.select<ViewRow[]>(
    "SELECT id, collection_id, name, type, config_json, position FROM collection_views WHERE collection_id = $1 ORDER BY position, created_at",
    [collectionId],
  );
  return rows.map(rowToView);
}

export async function createView(
  collectionId: string,
  name: string,
  type: ViewType,
  position: number,
  config: ViewConfig = {},
): Promise<CollectionView> {
  const db = await getDb();
  const id = ulid();
  await db.execute(
    "INSERT INTO collection_views(id, collection_id, name, type, config_json, position, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, collectionId, name, type, JSON.stringify(config), position, Date.now()],
  );
  return { id, collectionId, name, type, config, position };
}

export async function updateView(
  id: string,
  patch: { name?: string; type?: ViewType; config?: ViewConfig },
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); args.push(patch.name); }
  if (patch.type !== undefined) { sets.push(`type = $${i++}`); args.push(patch.type); }
  if (patch.config !== undefined) { sets.push(`config_json = $${i++}`); args.push(JSON.stringify(patch.config)); }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute(`UPDATE collection_views SET ${sets.join(", ")} WHERE id = $${i}`, args);
}

export async function deleteView(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM collection_views WHERE id = $1", [id]);
}
