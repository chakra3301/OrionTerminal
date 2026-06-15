import { create } from "zustand";
import { ulid } from "ulid";
import { useModelPrefs } from "@/store/modelPrefsStore";
import type { TopicRow, NodeRow, EdgeRow, Lesson } from "./learnTypes";
import type { Grade } from "./claude";
import { generateGraph, generateLesson, gradeAnswer, findRealLinks } from "./claude";
import {
  listTopics,
  insertTopic,
  insertNode,
  insertEdge,
  listNodes,
  listEdges,
  updateNode,
  insertReview,
  deleteTopic as dbDeleteTopic,
} from "./learnDb";
import { bktUpdate } from "./bkt";
import { recomputeStatuses } from "./gating";

interface LearnState {
  topics: Record<string, TopicRow>;
  openTopicId: string | null;
  nodes: Record<string, NodeRow>;
  edges: EdgeRow[];
  openNodeId: string | null;
  generatingGraph: boolean;
  generatingLesson: boolean;
  recentMisses: string[];
  loadTopics: () => Promise<void>;
  createTopic: (title: string) => Promise<void>;
  openTopic: (id: string) => Promise<void>;
  openNode: (id: string) => Promise<void>;
  closeNode: () => void;
  submitAnswer: (nodeId: string, q: { question: string; expected: string; concept: string; answer: string }) => Promise<Grade>;
  findLinks: (nodeId: string) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
}

function toRecord<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

const initialState = {
  topics: {} as Record<string, TopicRow>,
  openTopicId: null as string | null,
  nodes: {} as Record<string, NodeRow>,
  edges: [] as EdgeRow[],
  openNodeId: null as string | null,
  generatingGraph: false,
  generatingLesson: false,
  recentMisses: [] as string[],
};

export const useLearn = create<LearnState>((set, get) => ({
  ...initialState,

  async loadTopics() {
    const rows = await listTopics();
    set({ topics: toRecord(rows) });
  },

  async createTopic(title: string) {
    const model = useModelPrefs.getState().modelFor("learn");
    set({ generatingGraph: true });
    try {
      const spec = await generateGraph(title, model);
      const now = Date.now();
      const topicId = ulid();
      const topic: TopicRow = {
        id: topicId,
        title,
        summary: spec.summary,
        status: "active",
        created_at: now,
        updated_at: now,
      };
      await insertTopic(topic);

      // Build nodes with a key->id map for edge resolution
      const keyToId = new Map<string, string>();
      const nodeRows: NodeRow[] = [];
      for (const specNode of spec.nodes) {
        const nodeId = ulid();
        keyToId.set(specNode.key, nodeId);
        nodeRows.push({
          id: nodeId,
          topic_id: topicId,
          title: specNode.title,
          objective: specNode.objective ?? null,
          bloom_level: specNode.bloom_level ?? null,
          level: specNode.level,
          order_idx: nodeRows.length,
          lesson_json: null,
          lesson_at: null,
          p_mastery: 0,
          attempts: 0,
          last_seen: null,
          status: "locked",
        });
      }
      for (const row of nodeRows) await insertNode(row);

      // Build edges from prereq keys
      const edges: EdgeRow[] = [];
      for (let i = 0; i < spec.nodes.length; i++) {
        const specNode = spec.nodes[i];
        const nodeRow = nodeRows[i];
        if (!specNode || !nodeRow) continue;
        for (const prereqKey of specNode.prereqs) {
          const fromId = keyToId.get(prereqKey);
          if (!fromId) continue;
          const edge: EdgeRow = { topic_id: topicId, from_node: fromId, to_node: nodeRow.id };
          edges.push(edge);
          await insertEdge(edge);
        }
      }

      // Recompute statuses and persist only the status changes
      const initialRecord = toRecord(nodeRows);
      const recomputed = recomputeStatuses(nodeRows, edges);
      const finalRecord: Record<string, NodeRow> = {};
      for (const row of recomputed) {
        finalRecord[row.id] = row;
        const prev = initialRecord[row.id];
        if (prev && prev.status !== row.status) {
          await updateNode(row.id, { status: row.status });
        }
      }

      set((s) => ({
        topics: { ...s.topics, [topicId]: topic },
        openTopicId: topicId,
        nodes: finalRecord,
        edges,
        generatingGraph: false,
      }));
    } catch (err) {
      set({ generatingGraph: false });
      throw err;
    }
  },

  async openTopic(id: string) {
    const [nodeRows, edges] = await Promise.all([listNodes(id), listEdges(id)]);
    set({ openTopicId: id, nodes: toRecord(nodeRows), edges, openNodeId: null });
  },

  async openNode(id: string) {
    const model = useModelPrefs.getState().modelFor("learn");
    set({ openNodeId: id });
    const { nodes, edges, openTopicId, topics } = get();
    const node = nodes[id];
    if (!node) return;

    if (node.lesson_json === null) {
      set({ generatingLesson: true });
      try {
        // Gather prereq titles
        const priorTitles = edges
          .filter((e) => e.to_node === id)
          .map((e) => {
            const n = nodes[e.from_node];
            return n ? n.title : "";
          })
          .filter(Boolean);

        const topicTitle = openTopicId && topics[openTopicId] ? topics[openTopicId].title : "";
        const lesson = await generateLesson(
          {
            topic: topicTitle,
            nodeTitle: node.title,
            objective: node.objective ?? "",
            level: node.level,
            priorTitles,
          },
          model,
        );
        const json = JSON.stringify(lesson);
        const lessonAt = Date.now();
        await updateNode(id, { lesson_json: json, lesson_at: lessonAt });
        set((s) => {
          const existing = s.nodes[id];
          if (!existing) return {};
          return { nodes: { ...s.nodes, [id]: { ...existing, lesson_json: json, lesson_at: lessonAt } } };
        });
      } finally {
        set({ generatingLesson: false });
      }
    }

    // Mark in_progress if not mastered
    const current = get().nodes[id];
    if (current && current.status !== "mastered") {
      await updateNode(id, { status: "in_progress" });
      set((s) => {
        const existing = s.nodes[id];
        if (!existing) return {};
        return { nodes: { ...s.nodes, [id]: { ...existing, status: "in_progress" as const } } };
      });
    }
  },

  closeNode() {
    set({ openNodeId: null });
  },

  async submitAnswer(nodeId: string, q: { question: string; expected: string; concept: string; answer: string }): Promise<Grade> {
    const model = useModelPrefs.getState().modelFor("learn");
    const grade = await gradeAnswer(q, model);
    const { nodes, edges } = get();
    const node = nodes[nodeId];
    if (!node) return grade;

    const p = bktUpdate(node.p_mastery, grade.correct);
    const now = Date.now();
    const updatedNode: NodeRow = { ...node, p_mastery: p, attempts: node.attempts + 1, last_seen: now };
    const updatedRecord: Record<string, NodeRow> = { ...nodes, [nodeId]: updatedNode };

    await insertReview({ id: ulid(), node_id: nodeId, ts: now, correct: grade.correct ? 1 : 0, kind: "recall" });

    const recomputed = recomputeStatuses(Object.values(updatedRecord), edges);
    const finalRecord: Record<string, NodeRow> = {};
    for (const row of recomputed) {
      finalRecord[row.id] = row;
    }

    // Persist the answered node's full patch + status
    const finalNode = finalRecord[nodeId];
    if (finalNode) {
      await updateNode(nodeId, { p_mastery: p, attempts: updatedNode.attempts, last_seen: now, status: finalNode.status });
    }
    // Persist any other node whose status changed
    for (const row of recomputed) {
      const prev = nodes[row.id];
      if (row.id !== nodeId && prev && prev.status !== row.status) {
        await updateNode(row.id, { status: row.status });
      }
    }

    set({ nodes: finalRecord });

    if (grade.missed_concepts.length > 0) {
      set((s) => ({
        recentMisses: [...new Set([...s.recentMisses, ...grade.missed_concepts])].slice(0, 20),
      }));
    }

    return grade;
  },

  async findLinks(nodeId: string) {
    const model = useModelPrefs.getState().modelFor("learn");
    const { nodes, openTopicId, topics } = get();
    const node = nodes[nodeId];
    if (!node?.lesson_json) return;

    let lesson: Lesson;
    try {
      lesson = JSON.parse(node.lesson_json) as Lesson;
    } catch {
      return;
    }

    const topicTitle = openTopicId && topics[openTopicId] ? topics[openTopicId].title : "";
    const links = await findRealLinks({ topic: topicTitle, nodeTitle: node.title, keyTerms: lesson.key_terms ?? [] }, model);
    if (!links.length) return;

    const merged: Lesson = {
      ...lesson,
      suggested_resources: [
        ...(lesson.suggested_resources ?? []),
        ...links.map((l) => ({ type: l.type, title: l.title, search_query: l.title, url: l.url })),
      ],
    };
    const json = JSON.stringify(merged);
    await updateNode(nodeId, { lesson_json: json });
    set((s) => {
      const existing = s.nodes[nodeId];
      if (!existing) return {};
      return { nodes: { ...s.nodes, [nodeId]: { ...existing, lesson_json: json } } };
    });
  },

  async deleteTopic(id: string) {
    await dbDeleteTopic(id);
    set((s) => {
      const topics = { ...s.topics };
      delete topics[id];
      const wasOpen = s.openTopicId === id;
      return {
        topics,
        ...(wasOpen ? { openTopicId: null as string | null, nodes: {} as Record<string, NodeRow>, edges: [] as EdgeRow[], openNodeId: null as string | null } : {}),
      };
    });
  },
}));
