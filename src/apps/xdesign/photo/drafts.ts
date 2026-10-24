import { validatePhotoDocuments, type PhotoDocument } from "./types";

export type SmartContentsFrame = {
  parent: PhotoDocument;
  childId: string;
  layer: number;
  past: PhotoDocument[];
  future: PhotoDocument[];
};

/** Navigation and immutable version references, persisted with the project. */
export type PhotoDraft = {
  id: string;
  shapeId: string;
  source: "legacy" | "pencil";
  updatedAt: number;
  trail: SmartContentsFrame[];
};

export function validatePhotoDrafts(value: unknown, documents: Record<string, PhotoDocument>): asserts value is PhotoDraft[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Invalid image draft recovery data");
  const ids = new Set<string>();
  for (const draft of value as PhotoDraft[]) {
    if (!draft || typeof draft.id !== "string" || ids.has(draft.id) || typeof draft.shapeId !== "string" ||
      !draft.shapeId || !["legacy", "pencil"].includes(draft.source) || !Number.isFinite(draft.updatedAt) ||
      !Array.isArray(draft.trail) || !draft.trail.length || draft.trail.length > 8 || draft.id !== draft.trail[0]?.childId) {
      throw new Error("Invalid image draft recovery data");
    }
    ids.add(draft.id);
    const seen = new Set<string>();
    for (const [index, frame] of draft.trail.entries()) {
      if (!frame?.parent || !documents[frame.parent.id] || !documents[frame.childId] ||
        seen.has(frame.childId) || frame.childId === frame.parent.id ||
        (index > 0 && frame.parent.id !== draft.trail[index - 1]!.childId) ||
        !Number.isSafeInteger(frame.layer) || frame.layer < 0 || !Array.isArray(frame.past) || !Array.isArray(frame.future) ||
        frame.past.length + frame.future.length > 100) throw new Error("Invalid smart-object draft history");
      seen.add(frame.parent.id); seen.add(frame.childId);
      validatePhotoDocuments({ [frame.parent.id]: frame.parent });
      for (const version of [...frame.past, ...frame.future]) {
        if (version?.id !== frame.childId) throw new Error("Invalid smart-object draft history");
        validatePhotoDocuments({ [version.id]: version });
      }
    }
  }
}
