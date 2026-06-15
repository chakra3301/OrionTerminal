import { create } from "zustand";
import { ulid } from "ulid";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { toast } from "@/store/toastStore";
import type { TopicRow, NodeRow, EdgeRow, Lesson, TopicProgress, AchievementRow } from "./learnTypes";
import type { Grade } from "./claude";
import { generateGraph, generateLesson, gradeAnswer, findRealLinks, generateFigure } from "./claude";
import {
  listTopics,
  insertTopic,
  updateTopic,
  insertNode,
  insertEdge,
  listNodes,
  listEdges,
  updateNode,
  insertReview,
  deleteTopic as dbDeleteTopic,
  listAchievements,
  insertAchievement,
  topicProgress,
} from "./learnDb";
import { bktUpdate } from "./bkt";
import { recomputeStatuses } from "./gating";
import { detectNewAchievements, achievementKey } from "./achievements";

interface LearnState {
  topics: Record<string, TopicRow>;
  openTopicId: string | null;
  nodes: Record<string, NodeRow>;
  edges: EdgeRow[];
  openNodeId: string | null;
  generatingGraph: boolean;
  generatingLesson: boolean;
  recentMisses: string[];
  progress: Record<string, TopicProgress>;
  earnedKeys: Set<string>;
  trophyShelfOpen: boolean;
  celebrateTopicId: string | null;
  loadTopics: () => Promise<void>;
  createTopic: (title: string) => Promise<void>;
  openTopic: (id: string) => Promise<void>;
  openNode: (id: string) => Promise<void>;
  closeNode: () => void;
  submitAnswer: (nodeId: string, q: { question: string; expected: string; concept: string; answer: string }) => Promise<Grade>;
  findLinks: (nodeId: string) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  loadTopicProgress: () => Promise<void>;
  shapeTopic: (id: string) => Promise<void>;
  allAchievements: AchievementRow[];
  loadAllAchievements: () => Promise<void>;
  openTrophyShelf: (open: boolean) => void;
  dismissCelebration: () => void;
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
  progress: {} as Record<string, TopicProgress>,
  earnedKeys: new Set<string>() as Set<string>,
  trophyShelfOpen: false,
  celebrateTopicId: null as string | null,
  allAchievements: [] as AchievementRow[],
};

export const useLearn = create<LearnState>((set, get) => ({
  ...initialState,

  async loadTopics() {
    const rows = await listTopics();
    set({ topics: toRecord(rows) });
    await get().loadTopicProgress();
  },

  async loadTopicProgress() {
    set({ progress: await topicProgress() });
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
        figure_json: null,
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
        earnedKeys: new Set<string>(),
        generatingGraph: false,
      }));

      // Figure generation is fail-soft and must never block topic creation.
      void get().shapeTopic(topicId);
      await get().loadTopicProgress();
    } catch (err) {
      set({ generatingGraph: false });
      throw err;
    }
  },

  async openTopic(id: string) {
    const [nodeRows, edges, achv] = await Promise.all([listNodes(id), listEdges(id), listAchievements(id)]);
    const earnedKeys = new Set(achv.map((a) => a.kind === "node" ? achievementKey("node", a.node_id ?? "") : achievementKey("topic")));
    set({ openTopicId: id, nodes: toRecord(nodeRows), edges, openNodeId: null, earnedKeys, trophyShelfOpen: false });
  },

  async shapeTopic(id: string) {
    const model = useModelPrefs.getState().modelFor("learn");
    const { topics, openTopicId } = get();
    const topic = topics[id];
    if (!topic) return;
    const nodeCount = openTopicId === id
      ? Object.keys(get().nodes).length
      : (get().progress[id]?.total ?? 0);
    const figure = await generateFigure(topic.title, Math.max(1, nodeCount), model);
    if (!figure) return;
    const json = JSON.stringify(figure);
    await updateTopic(id, { figure_json: json });
    set((s) => {
      const t = s.topics[id];
      if (!t) return {};
      return { topics: { ...s.topics, [id]: { ...t, figure_json: json } } };
    });
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

  async loadAllAchievements() {
    set({ allAchievements: await listAchievements() });
  },
  openTrophyShelf(open: boolean) {
    set({ trophyShelfOpen: open });
    if (open) void get().loadAllAchievements();
  },
  dismissCelebration() { set({ celebrateTopicId: null }); },

  async submitAnswer(nodeId: string, q: { question: string; expected: string; concept: string; answer: string }): Promise<Grade> {
    const model = useModelPrefs.getState().modelFor("learn");
    const grade = await gradeAnswer(q, model);

    // Synchronous read-modify-write — no awaits between read and set
    const prevNodes = get().nodes;
    const { edges } = get();
    const node = prevNodes[nodeId];
    if (!node) return grade;

    const p = bktUpdate(node.p_mastery, grade.correct);
    const now = Date.now();
    const updatedNode: NodeRow = { ...node, p_mastery: p, attempts: node.attempts + 1, last_seen: now };
    const updatedRecord: Record<string, NodeRow> = { ...prevNodes, [nodeId]: updatedNode };

    const recomputed = recomputeStatuses(Object.values(updatedRecord), edges);
    const finalRecord: Record<string, NodeRow> = {};
    for (const row of recomputed) {
      finalRecord[row.id] = row;
    }

    set({ nodes: finalRecord });

    // Achievement detection — pure diff over status transitions, idempotent.
    const { earnedKeys, openTopicId } = get();
    const det = detectNewAchievements(prevNodes, finalRecord, earnedKeys);
    if (det.nodeIds.length || det.topicEarned) {
      const nextEarned = new Set(earnedKeys);
      const ts = Date.now();
      for (const nid of det.nodeIds) {
        nextEarned.add(achievementKey("node", nid));
        const title = finalRecord[nid]?.title ?? "Concept";
        toast.success(`Node mastered — ${title}`, { body: "Achievement unlocked" });
        void insertAchievement({ id: ulid(), topic_id: openTopicId ?? "", kind: "node", node_id: nid, title, earned_at: ts });
      }
      if (det.topicEarned && openTopicId) {
        nextEarned.add(achievementKey("topic"));
        const tTitle = get().topics[openTopicId]?.title ?? "Topic";
        void insertAchievement({ id: ulid(), topic_id: openTopicId, kind: "topic", node_id: null, title: tTitle, earned_at: ts });
        set({ celebrateTopicId: openTopicId });
      }
      set({ earnedKeys: nextEarned });
      if (openTopicId) {
        const vals = Object.values(finalRecord);
        set((s) => ({ progress: { ...s.progress, [openTopicId]: { total: vals.length, mastered: vals.filter((n) => n.status === "mastered").length } } }));
      }
    }

    if (grade.missed_concepts.length > 0) {
      set((s) => ({
        recentMisses: [...new Set([...s.recentMisses, ...grade.missed_concepts])].slice(0, 20),
      }));
    }

    // Persist after set — DB writes don't race with in-memory state
    const finalNode = finalRecord[nodeId];
    await insertReview({ id: ulid(), node_id: nodeId, ts: now, correct: grade.correct ? 1 : 0, kind: "recall" });
    if (finalNode) {
      await updateNode(nodeId, { p_mastery: p, attempts: updatedNode.attempts, last_seen: now, status: finalNode.status });
    }
    for (const row of recomputed) {
      const prev = prevNodes[row.id];
      if (row.id !== nodeId && prev && prev.status !== row.status) {
        await updateNode(row.id, { status: row.status });
      }
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

    try {
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
    } catch (e) {
      console.error("learn findLinks failed", e);
    }
  },

  async deleteTopic(id: string) {
    await dbDeleteTopic(id);
    set((s) => {
      const topics = { ...s.topics };
      delete topics[id];
      const progress = { ...s.progress };
      delete progress[id];
      const wasOpen = s.openTopicId === id;
      return {
        topics,
        progress,
        ...(wasOpen ? { openTopicId: null as string | null, nodes: {} as Record<string, NodeRow>, edges: [] as EdgeRow[], openNodeId: null as string | null } : {}),
      };
    });
  },
}));
