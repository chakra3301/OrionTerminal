import { create } from "zustand";
import { ulid } from "ulid";
import { log } from "@/lib/log";
import { ipc } from "@/lib/ipc";
import {
  type CCProfileRow,
  type CCChannelRow,
  type CCMessageRow,
  type CCMissionRow,
  listCCProfiles,
  listCCChannels,
  listCCMessages,
  listCCMissions,
  insertCCProfile,
  updateCCProfile,
  insertCCChannel,
  insertCCMessage,
  insertCCMission,
  updateCCMission,
} from "@/lib/db";
import {
  type CCDirective,
  type CaptainInfo,
  type CCReport,
  buildPlanPrompt,
  parsePlan,
  buildBriefingPrompt,
} from "@/apps/command/ccPlan";
import {
  type CcRunState,
  type CcEvent,
  newRun,
  applyCcEvent,
} from "@/apps/command/ccRun";
import { ARTIFACT_MARKER } from "@/apps/command/ccArtifacts";
import { autoDispatches, applyBudget } from "@/apps/command/ccAutonomy";
import {
  type CCProfile,
  type CCChannel,
  type CCMessage,
  type CCMission,
  buildOrgTree,
  type CCOrgTree,
  visibleChannels,
} from "@/apps/command/ccTypes";
import { defaultSeed } from "@/apps/command/ccSeed";

// Vault roots are stored relative to the app-data dir; the Rust pi_engine
// resolves + creates the actual vault on first run.
const WIKI_BASE = "command-center";

// Default brain when a profile has no explicit model yet (CC-1). pi resolves
// auth from ~/.pi/agent/auth.json. CC-2 adds a per-profile model picker.
export const DEFAULT_BRAIN = "anthropic/claude-haiku-4-5";

// Resolves a streaming run's final text when its cc:exit lands (lets the
// delegation loop await a live-streamed Captain run instead of a silent
// one-shot). Module-level so finishRun can settle the awaiting dispatch.
const runResolvers = new Map<string, (text: string) => void>();

function rowToProfile(r: CCProfileRow): CCProfile {
  let skillIds: string[] = [];
  try {
    skillIds = JSON.parse(r.skill_ids_json || "[]");
  } catch {
    skillIds = [];
  }
  return {
    id: r.id,
    name: r.name,
    rank: r.rank as CCProfile["rank"],
    division: r.division,
    accent: r.accent,
    brainModel: r.brain_model,
    skillIds,
    wikiRoot: r.wiki_root,
    charter: r.charter,
    autonomyLevel: r.autonomy_level,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    avatarPath: r.avatar_path ?? "",
  };
}

function rowToChannel(r: CCChannelRow): CCChannel {
  return {
    id: r.id,
    kind: r.kind as CCChannel["kind"],
    division: r.division,
    name: r.name,
    position: r.position,
    createdAt: r.created_at,
  };
}

function rowToMessage(r: CCMessageRow): CCMessage {
  return {
    id: r.id,
    channelId: r.channel_id,
    fromProfileId: r.from_profile_id,
    toProfileId: r.to_profile_id,
    kind: r.kind as CCMessage["kind"],
    body: r.body,
    missionRef: r.mission_ref,
    ts: r.ts,
  };
}

function rowToMission(r: CCMissionRow): CCMission {
  return {
    id: r.id,
    title: r.title,
    brief: r.brief,
    status: r.status as CCMission["status"],
    autonomyLevel: r.autonomy_level,
    assignedProfileId: r.assigned_profile_id,
    originProfileId: r.origin_profile_id,
    ts: r.ts,
    updatedAt: r.updated_at,
  };
}

function profileToRow(p: CCProfile): CCProfileRow {
  return {
    id: p.id,
    name: p.name,
    rank: p.rank,
    division: p.division,
    accent: p.accent,
    brain_model: p.brainModel,
    skill_ids_json: JSON.stringify(p.skillIds),
    wiki_root: p.wikiRoot,
    charter: p.charter,
    autonomy_level: p.autonomyLevel,
    position: p.position,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    avatar_path: p.avatarPath ?? "",
  };
}

function channelToRow(c: CCChannel): CCChannelRow {
  return {
    id: c.id,
    kind: c.kind,
    division: c.division,
    name: c.name,
    position: c.position,
    created_at: c.createdAt,
  };
}

type CommandState = {
  profiles: CCProfile[];
  channels: CCChannel[];
  messages: CCMessage[];
  missions: CCMission[];
  loaded: boolean;
  selectedProfileId: string | null;
  selectedChannelId: string | null;

  activeRun: CcRunState | null;
  planning: boolean;
  dispatching: boolean;
  proposedPlan: { missionId: string; directives: CCDirective[] } | null;

  startMission: (title: string, brief: string) => Promise<void>;
  approveMission: () => Promise<void>;
  rejectMission: () => Promise<void>;
  setAutonomy: (profileId: string, level: number) => Promise<void>;
  setAvatar: (profileId: string, path: string) => Promise<void>;

  load: () => Promise<void>;
  selectProfile: (id: string | null) => void;
  selectChannel: (id: string | null) => void;

  sendToProfile: (profileId: string, channelId: string, text: string) => Promise<void>;
  dispatchRun: (
    profileId: string,
    channelId: string,
    prompt: string,
    meta: { fromId: string; toId: string; kind: "report"; missionRef: string },
  ) => Promise<string>;
  applyRunEvent: (runId: string, ev: CcEvent) => void;
  finishRun: (runId: string, error?: string) => Promise<void>;
  cancelRun: () => void;
  commanderId: () => string;

  orgTree: () => CCOrgTree;
  channelsForSelected: () => CCChannel[];
  messagesForChannel: (channelId: string) => CCMessage[];
  missionsForProfile: (profileId: string) => CCMission[];
  profileById: (id: string) => CCProfile | undefined;
};

export const useCommand = create<CommandState>((set, get) => ({
  profiles: [],
  channels: [],
  messages: [],
  missions: [],
  loaded: false,
  selectedProfileId: null,
  selectedChannelId: null,
  activeRun: null,
  planning: false,
  dispatching: false,
  proposedPlan: null,

  load: async () => {
    try {
      let [pRows, cRows] = await Promise.all([
        listCCProfiles(),
        listCCChannels(),
      ]);
      // Seed the default org once, on an empty vault.
      if (pRows.length === 0) {
        const seed = defaultSeed({ wikiBase: WIKI_BASE, now: Date.now() });
        await Promise.all([
          ...seed.profiles.map((p) => insertCCProfile(profileToRow(p))),
          ...seed.channels.map((c) => insertCCChannel(channelToRow(c))),
        ]);
        [pRows, cRows] = await Promise.all([listCCProfiles(), listCCChannels()]);
      }
      const [mRows, missionRows] = await Promise.all([
        listCCMessages(),
        listCCMissions(),
      ]);
      const channels = cRows.map(rowToChannel);
      set({
        profiles: pRows.map(rowToProfile),
        channels,
        messages: mRows.map(rowToMessage),
        missions: missionRows.map(rowToMission),
        loaded: true,
        selectedChannelId:
          get().selectedChannelId ?? channels[0]?.id ?? null,
      });
    } catch (e) {
      log.error("command center load failed", e);
      set({ loaded: true });
    }
  },

  selectProfile: (id) => set({ selectedProfileId: id }),
  selectChannel: (id) => set({ selectedChannelId: id }),

  orgTree: () => buildOrgTree(get().profiles),

  channelsForSelected: () => {
    const s = get();
    const profile = s.selectedProfileId
      ? s.profiles.find((p) => p.id === s.selectedProfileId) ?? null
      : null;
    return visibleChannels(profile, s.channels);
  },

  messagesForChannel: (channelId) =>
    get()
      .messages.filter((m) => m.channelId === channelId)
      .sort((a, b) => a.ts - b.ts),

  missionsForProfile: (profileId) =>
    get()
      .missions.filter((m) => m.assignedProfileId === profileId)
      .sort((a, b) => b.updatedAt - a.updatedAt),

  profileById: (id) => get().profiles.find((p) => p.id === id),

  commanderId: () =>
    get().profiles.find((p) => p.rank === "commander")?.id ?? "cc-prof-commander",

  sendToProfile: async (profileId, channelId, text) => {
    const body = text.trim();
    if (!body || get().activeRun) return;
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const now = Date.now();
    const commanderId = get().commanderId();

    const userRow: CCMessageRow = {
      id: ulid(),
      channel_id: channelId,
      from_profile_id: commanderId,
      to_profile_id: profileId,
      kind: "chat",
      body,
      mission_ref: "",
      ts: now,
    };
    try {
      await insertCCMessage(userRow);
    } catch (e) {
      log.error("cc user message insert failed", e);
    }
    set((s) => ({ messages: [...s.messages, rowToMessage(userRow)] }));

    const runId = ulid();
    set({
      activeRun: newRun(runId, profileId, channelId, {
        toId: commanderId,
        kind: "chat",
      }),
    });

    const model = profile.brainModel || DEFAULT_BRAIN;
    const sessionId = `cc_${profileId}`;
    try {
      await ipc.piSend(
        runId,
        body,
        model,
        sessionId,
        profile.charter,
        profile.wikiRoot,
      );
    } catch (e) {
      log.error("pi_send failed", e);
      await get().finishRun(runId, String(e));
    }
  },

  // Stream a profile run into a channel and resolve with its final text once
  // it exits. Used by the delegation loop so Captain work is visible live.
  dispatchRun: async (profileId, channelId, prompt, meta) => {
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return "";
    const runId = ulid();
    set({ activeRun: newRun(runId, profileId, channelId, meta) });
    const done = new Promise<string>((resolve) =>
      runResolvers.set(runId, resolve),
    );
    try {
      await ipc.piSend(
        runId,
        prompt,
        profile.brainModel || DEFAULT_BRAIN,
        `cc_${profileId}`,
        profile.charter,
        profile.wikiRoot,
      );
    } catch (e) {
      log.error("dispatch pi_send failed", e);
      await get().finishRun(runId, String(e));
    }
    return done;
  },

  applyRunEvent: (runId, ev) =>
    set((s) => {
      if (!s.activeRun || s.activeRun.runId !== runId) return {};
      return { activeRun: applyCcEvent(s.activeRun, ev) };
    }),

  finishRun: async (runId, error) => {
    const run = get().activeRun;
    if (!run || run.runId !== runId) {
      const dangling = runResolvers.get(runId);
      if (dangling) {
        runResolvers.delete(runId);
        dangling("");
      }
      return;
    }
    const now = Date.now();
    let text = error ? `⚠ ${error}` : run.text.trim();
    // Auto-surface artifacts the run produced (images/html/pdf created during
    // it), so the Commander gets clickable previews even when the agent didn't
    // print absolute paths. Appended as absolute paths -> MessageBody linkifies
    // them into inline thumbnails / Open chips.
    if (!error) {
      const profile = get().profiles.find((p) => p.id === run.profileId);
      if (profile?.wikiRoot) {
        try {
          const arts = await ipc.ccRecentArtifacts(
            profile.wikiRoot,
            run.startedAt,
            8,
          );
          const fresh = arts.filter((a) => !text.includes(a));
          if (fresh.length) {
            text = `${text}\n\n${ARTIFACT_MARKER}\n${fresh.join("\n")}`;
          }
        } catch (e) {
          log.warn("artifact scan failed", e);
        }
      }
    }
    if (text) {
      const row: CCMessageRow = {
        id: ulid(),
        channel_id: run.channelId,
        from_profile_id: run.fromId || run.profileId,
        to_profile_id: run.toId || get().commanderId(),
        kind: run.kind,
        body: text,
        mission_ref: run.missionRef,
        ts: now,
      };
      try {
        await insertCCMessage(row);
      } catch (e) {
        log.error("cc assistant message insert failed", e);
      }
      set((s) => ({ messages: [...s.messages, rowToMessage(row)] }));
    }
    set({ activeRun: null });
    const resolve = runResolvers.get(runId);
    if (resolve) {
      runResolvers.delete(runId);
      resolve(text);
    }
  },

  cancelRun: () => {
    const run = get().activeRun;
    if (!run) return;
    void ipc.piCancel(run.runId);
  },

  startMission: async (title, brief) => {
    const t = title.trim();
    const b = brief.trim();
    if (!t || !b || get().planning || get().dispatching) return;
    const general = get().profiles.find((p) => p.rank === "general");
    if (!general) {
      log.error("no General profile to plan the mission");
      return;
    }
    const now = Date.now();
    const missionRow = {
      id: ulid(),
      title: t,
      brief: b,
      status: "draft",
      autonomy_level: 1,
      assigned_profile_id: null,
      origin_profile_id: get().commanderId(),
      ts: now,
      updated_at: now,
    };
    try {
      await insertCCMission(missionRow);
    } catch (e) {
      log.error("mission insert failed", e);
    }
    set((s) => ({
      missions: [rowToMission(missionRow), ...s.missions],
      planning: true,
      proposedPlan: null,
    }));

    const captains: CaptainInfo[] = get()
      .profiles.filter((p) => p.rank === "captain")
      .map((c) => ({ division: c.division, name: c.name, charter: c.charter }));
    const known = captains.map((c) => c.division);
    const model = general.brainModel || DEFAULT_BRAIN;
    let directives: CCDirective[] = [];
    try {
      const { result } = await ipc.piOneshot(
        buildPlanPrompt(b, captains),
        model,
        general.charter,
        general.wikiRoot,
      );
      directives = parsePlan(result, known);
    } catch (e) {
      log.error("mission planning failed", e);
    }
    try {
      await updateCCMission(missionRow.id, {
        status: "planned",
        updated_at: Date.now(),
      });
    } catch {
      /* non-fatal */
    }
    // Autonomy: L0/L1 wait for your approval; L2/L3 auto-dispatch (L2 within a
    // directive budget).
    const auto = autoDispatches(general.autonomyLevel);
    const { kept } = auto
      ? applyBudget(directives, general.autonomyLevel)
      : { kept: directives };
    set((s) => ({
      planning: false,
      proposedPlan: { missionId: missionRow.id, directives: kept },
      missions: s.missions.map((m) =>
        m.id === missionRow.id ? { ...m, status: "planned" } : m,
      ),
    }));
    if (auto && kept.length > 0) {
      await get().approveMission();
    }
  },

  setAutonomy: async (profileId, level) => {
    const lvl = Math.max(0, Math.min(3, level));
    try {
      await updateCCProfile(profileId, { autonomy_level: lvl, updated_at: Date.now() });
    } catch (e) {
      log.error("setAutonomy failed", e);
    }
    set((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === profileId ? { ...p, autonomyLevel: lvl } : p,
      ),
    }));
  },

  setAvatar: async (profileId, path) => {
    try {
      await updateCCProfile(profileId, { avatar_path: path, updated_at: Date.now() });
    } catch (e) {
      log.error("setAvatar failed", e);
    }
    set((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === profileId ? { ...p, avatarPath: path } : p,
      ),
    }));
  },

  rejectMission: async () => {
    const pp = get().proposedPlan;
    if (pp) {
      try {
        await updateCCMission(pp.missionId, {
          status: "blocked",
          updated_at: Date.now(),
        });
      } catch {
        /* non-fatal */
      }
    }
    set((s) => ({
      proposedPlan: null,
      missions: pp
        ? s.missions.map((m) =>
            m.id === pp.missionId ? { ...m, status: "blocked" } : m,
          )
        : s.missions,
    }));
  },

  approveMission: async () => {
    const pp = get().proposedPlan;
    if (!pp || get().dispatching) return;
    const general = get().profiles.find((p) => p.rank === "general");
    const commandChannel = get().channels.find((c) => c.kind === "command");
    const mission = get().missions.find((m) => m.id === pp.missionId);
    if (!general || !commandChannel || !mission) return;

    set({ dispatching: true, proposedPlan: null });
    await updateCCMission(pp.missionId, {
      status: "running",
      updated_at: Date.now(),
    }).catch(() => {});
    set((s) => ({
      missions: s.missions.map((m) =>
        m.id === pp.missionId ? { ...m, status: "running" } : m,
      ),
    }));

    const post = async (
      channelId: string,
      fromId: string,
      toId: string,
      kind: "directive" | "report",
      body: string,
    ) => {
      const row: CCMessageRow = {
        id: ulid(),
        channel_id: channelId,
        from_profile_id: fromId,
        to_profile_id: toId,
        kind,
        body,
        mission_ref: pp.missionId,
        ts: Date.now(),
      };
      await insertCCMessage(row).catch((e) =>
        log.error("cc message insert failed", e),
      );
      set((s) => ({ messages: [...s.messages, rowToMessage(row)] }));
    };

    const reports: CCReport[] = [];
    for (const d of pp.directives) {
      const captain = get().profiles.find(
        (p) => p.rank === "captain" && p.division === d.division,
      );
      const divChannel = get().channels.find(
        (c) => c.kind === "division" && c.division === d.division,
      );
      if (!captain || !divChannel) continue;
      // General posts the directive, then the Captain runs it LIVE (streamed
      // into its channel); dispatchRun resolves + persists its report.
      await post(
        divChannel.id,
        general.id,
        captain.id,
        "directive",
        `**${d.title}**\n${d.instruction}`,
      );
      const reportText = await get().dispatchRun(
        captain.id,
        divChannel.id,
        d.instruction,
        {
          fromId: captain.id,
          toId: general.id,
          kind: "report",
          missionRef: pp.missionId,
        },
      );
      reports.push({ division: d.division, report: reportText });
    }

    // General writes the briefing live into #command (also persisted by the run).
    await get().dispatchRun(
      commandChannel.id,
      commandChannel.id,
      buildBriefingPrompt(mission.title, mission.brief, reports),
      {
        fromId: general.id,
        toId: get().commanderId(),
        kind: "report",
        missionRef: pp.missionId,
      },
    );

    await updateCCMission(pp.missionId, {
      status: "done",
      updated_at: Date.now(),
    }).catch(() => {});
    set((s) => ({
      dispatching: false,
      missions: s.missions.map((m) =>
        m.id === pp.missionId ? { ...m, status: "done" } : m,
      ),
    }));
  },
}));
