// Command Center — pure domain types + helpers (no IO). The org is a flat
// three-rank tree: commander (the user) -> general (pure coordinator) ->
// captains (one per division). No worker tier. See the design spec.

export type CCRank = "commander" | "general" | "captain";

export type CCProfile = {
  id: string;
  name: string;
  rank: CCRank;
  division: string; // "" for commander/general
  accent: string;
  brainModel: string; // "" for the commander (that's you)
  skillIds: string[];
  wikiRoot: string;
  charter: string;
  autonomyLevel: number; // 0 manual | 1 approve-each | 2 budget | 3 auto
  position: number;
  createdAt: number;
  updatedAt: number;
  avatarPath: string; // absolute image path the Commander picks ("" = initials)
};

export type CCChannelKind = "command" | "division" | "cross" | "dm";

export type CCChannel = {
  id: string;
  kind: CCChannelKind;
  division: string;
  name: string;
  position: number;
  createdAt: number;
};

export type CCMessageKind = "chat" | "directive" | "report" | "handoff";

export type CCMessage = {
  id: string;
  channelId: string;
  fromProfileId: string;
  toProfileId: string | null;
  kind: CCMessageKind;
  body: string;
  missionRef: string;
  ts: number;
};

export type CCMissionStatus =
  | "draft"
  | "planned"
  | "running"
  | "review"
  | "done"
  | "blocked";

export type CCMission = {
  id: string;
  title: string;
  brief: string;
  status: CCMissionStatus;
  autonomyLevel: number;
  assignedProfileId: string | null;
  originProfileId: string | null;
  ts: number;
  updatedAt: number;
};

export const RANK_ORDER: Record<CCRank, number> = {
  commander: 0,
  general: 1,
  captain: 2,
};

/** The starting divisions. Accents drawn from the neon token palette. */
export const DIVISIONS: { division: string; name: string; accent: string }[] = [
  { division: "design", name: "Design", accent: "#ff3ea5" },
  { division: "marketing", name: "Marketing", accent: "#e6ff3a" },
  { division: "research", name: "Research", accent: "#b14cff" },
  { division: "dev", name: "Dev", accent: "#00e0ff" },
];

export const AUTONOMY_LABELS: Record<number, string> = {
  0: "Manual",
  1: "Approve each",
  2: "Auto within budget",
  3: "Full auto",
};

/** Sort profiles by rank, then their stored position, then name — stable. */
export function sortByRank(profiles: CCProfile[]): CCProfile[] {
  return [...profiles].sort(
    (a, b) =>
      RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
      a.position - b.position ||
      a.name.localeCompare(b.name),
  );
}

export type CCOrgTree = {
  commander: CCProfile | null;
  general: CCProfile | null;
  captains: CCProfile[]; // division-sorted by position then name
};

/** Build the org tree. Tolerant of missing/duplicate ranks: takes the first
 * commander/general by position, all captains under them. */
export function buildOrgTree(profiles: CCProfile[]): CCOrgTree {
  const sorted = sortByRank(profiles);
  return {
    commander: sorted.find((p) => p.rank === "commander") ?? null,
    general: sorted.find((p) => p.rank === "general") ?? null,
    captains: sorted.filter((p) => p.rank === "captain"),
  };
}

/** Channels a profile can see, per the comms graph:
 *  commander -> everything; general -> command + all divisions + cross;
 *  captain  -> command + its own division + cross. */
export function visibleChannels(
  profile: CCProfile | null,
  channels: CCChannel[],
): CCChannel[] {
  if (!profile) return channels;
  if (profile.rank === "commander" || profile.rank === "general") {
    return channels;
  }
  return channels.filter(
    (c) =>
      c.kind === "command" ||
      c.kind === "cross" ||
      (c.kind === "division" && c.division === profile.division),
  );
}
