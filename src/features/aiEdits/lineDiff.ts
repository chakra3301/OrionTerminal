/** Line-level diff (Myers O((N+M)D)) powering per-hunk review of agent
 * edits. Pure — no Monaco, no store. The review flow uses a fold model:
 * accepting a hunk applies it to `original`, rejecting removes it from
 * `updated`, so the remaining hunks always equal the undecided diff. */

export type Hunk = {
  /** 0-based line index into ORIGINAL where the hunk's removed run starts.
   * For a pure insertion this is the line BEFORE which nothing is removed —
   * the insertion sits between origStart-1 and origStart. */
  origStart: number;
  origLines: string[];
  /** 0-based line index into UPDATED where the inserted run starts. */
  newStart: number;
  newLines: string[];
};

/** Beyond this many diff steps we give up on a fine-grained script and
 * treat the change as one whole-file hunk (still correct, just coarse). */
const MAX_D = 4000;

function splitLines(s: string): string[] {
  return s.split("\n");
}

/** Myers greedy diff returning, for each line of a/b, whether it's kept.
 * Encoded as an edit script of [delCount, insCount] runs between common
 * lines is overkill — we just need per-index keep flags to group hunks. */
function myersKeep(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } | null {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;
  const offset = MAX;
  const width = 2 * MAX + 1;
  let v = new Int32Array(width);
  const trace: Int32Array[] = [];
  let foundD = -1;

  for (let d = 0; d <= Math.min(MAX, MAX_D); d++) {
    const snapshot = new Int32Array(v);
    trace.push(snapshot);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        foundD = d;
        break;
      }
    }
    if (foundD >= 0) break;
  }
  if (foundD < 0) return null; // exceeded MAX_D

  const keepA = new Array<boolean>(N).fill(false);
  const keepB = new Array<boolean>(M).fill(false);

  // Backtrack from (N, M) through the stored V snapshots.
  let x = N;
  let y = M;
  for (let d = foundD; d > 0; d--) {
    const vPrev = trace[d]!; // snapshot BEFORE round d ran = state of d-1
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vPrev[offset + k - 1]! < vPrev[offset + k + 1]!)) {
      prevK = k + 1; // came from an insertion (down)
    } else {
      prevK = k - 1; // came from a deletion (right)
    }
    const prevX = vPrev[offset + prevK]!;
    const prevY = prevX - prevK;
    // Snake (equal run) after the edit step.
    while (x > prevX && y > prevY && x > 0 && y > 0) {
      x--;
      y--;
      keepA[x] = true;
      keepB[y] = true;
    }
    if (prevK === k + 1) {
      y = prevY; // the step consumed one line of b (insertion)
    } else {
      x = prevX; // one line of a (deletion)
    }
  }
  // Leading snake before the first edit step (d=0 region).
  while (x > 0 && y > 0) {
    x--;
    y--;
    keepA[x] = true;
    keepB[y] = true;
  }
  return { keepA, keepB };
}

/** Diff original → updated into ordered hunks. Identical inputs → []. */
export function computeHunks(original: string, updated: string): Hunk[] {
  if (original === updated) return [];
  const a = splitLines(original);
  const b = splitLines(updated);

  const kept = myersKeep(a, b);
  if (!kept) {
    return [{ origStart: 0, origLines: a, newStart: 0, newLines: b }];
  }
  const { keepA, keepB } = kept;

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && keepA[i] && keepB[j]) {
      i++;
      j++;
      continue;
    }
    const origStart = i;
    const newStart = j;
    const origLines: string[] = [];
    const newLines: string[] = [];
    while (i < a.length && !keepA[i]) origLines.push(a[i++]!);
    while (j < b.length && !keepB[j]) newLines.push(b[j++]!);
    hunks.push({ origStart, origLines, newStart, newLines });
  }
  return hunks;
}

/** Rebuild content from ORIGINAL with the hunks whose indexes are in
 * `accepted` applied. accepted=all → updated; accepted=∅ → original. */
export function composeFromHunks(
  original: string,
  hunks: Hunk[],
  accepted: ReadonlySet<number>,
): string {
  const a = splitLines(original);
  const out: string[] = [];
  let cursor = 0;
  hunks.forEach((h, idx) => {
    while (cursor < h.origStart) out.push(a[cursor++]!);
    if (accepted.has(idx)) {
      out.push(...h.newLines);
      cursor += h.origLines.length;
    } else {
      out.push(...h.origLines);
      cursor += h.origLines.length;
    }
  });
  while (cursor < a.length) out.push(a[cursor++]!);
  return out.join("\n");
}

/** Accept-fold: original with ONLY this hunk applied (it disappears from
 * the remaining diff while updated stays untouched). */
export function foldHunkIntoOriginal(
  original: string,
  hunks: Hunk[],
  index: number,
): string {
  return composeFromHunks(original, hunks, new Set([index]));
}

/** Reject-fold: updated with this hunk reverted (all OTHER hunks applied
 * over original) — this is the new disk content. */
export function dropHunkFromUpdated(
  original: string,
  hunks: Hunk[],
  index: number,
): string {
  const accepted = new Set<number>(hunks.map((_, i) => i));
  accepted.delete(index);
  return composeFromHunks(original, hunks, accepted);
}

/** +added/-removed line counts across a hunk set (Changes panel badges). */
export function hunkStats(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    added += h.newLines.length;
    removed += h.origLines.length;
  }
  return { added, removed };
}
