import { useEffect, useState, useRef } from "react";
import {
  Send,
  Square,
  Loader2,
  Target,
  Check,
  X,
  FolderOpen,
  ExternalLink,
  FileText,
  Share2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCommand } from "@/store/commandStore";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { type CCProfile, type CCChannel } from "@/apps/command/ccTypes";
import { AUTONOMY_LEVELS, autoDispatches } from "@/apps/command/ccAutonomy";
import {
  type CcSegment,
  parseArtifacts,
  artifactLabel,
  isImageArtifact,
  splitArtifactBlock,
  pathSegment,
} from "@/apps/command/ccArtifacts";
import { CommandGraph } from "@/apps/command/CommandGraph";
import "./command.css";

function openArtifact(seg: CcSegment) {
  void (async () => {
    try {
      if (seg.type === "url") await openUrl(seg.value);
      else if (seg.type === "path")
        await ipc.ccOpenPath(seg.value, seg.open === "reveal");
    } catch (e) {
      log.warn("open artifact failed", e);
    }
  })();
}

/** Lazy-loads a local image as a data URL (bypasses asset:// scope, which
 * skips hidden dirs like .previews). Falls back to an Open chip on failure. */
function CcThumb({ seg }: { seg: CcSegment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (seg.type !== "path") return;
    ipc
      .ccReadImage(seg.value)
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [seg]);
  if (failed) {
    return (
      <button className="cc-artifact" onClick={() => openArtifact(seg)} title={seg.value}>
        <FileText size={12} />
        {artifactLabel(seg)}
      </button>
    );
  }
  return (
    <button
      className="cc-thumb"
      onClick={() => openArtifact(seg)}
      title={`${seg.value} — click to open`}
    >
      {src ? (
        <img src={src} alt={artifactLabel(seg)} />
      ) : (
        <div className="cc-thumb-loading">
          <Loader2 size={16} className="cc-spin" />
        </div>
      )}
      <span className="cc-thumb-name">{artifactLabel(seg)}</span>
    </button>
  );
}

function renderSeg(seg: CcSegment, i: number) {
  if (seg.type === "text") return <span key={i}>{seg.value}</span>;
  if (isImageArtifact(seg)) {
    return <CcThumb key={i} seg={seg} />;
  }
  const Icon =
    seg.type === "url"
      ? ExternalLink
      : seg.open === "file"
        ? FileText
        : FolderOpen;
  return (
    <button
      key={i}
      className="cc-artifact"
      onClick={() => openArtifact(seg)}
      title={seg.value}
    >
      <Icon size={12} />
      {artifactLabel(seg)}
    </button>
  );
}

type VaultPage = { title: string; path: string; kind: string; mtime: number };

/** A profile's own growing brain — recent pages from its vault. */
function ProfileMemory({ profile }: { profile: CCProfile }) {
  const [pages, setPages] = useState<VaultPage[] | null>(null);
  useEffect(() => {
    let alive = true;
    setPages(null);
    ipc
      .ccVaultPages(profile.wikiRoot, 12)
      .then((p) => alive && setPages(p))
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, [profile.id, profile.wikiRoot]);
  return (
    <div className="cc-field">
      <div className="lbl">Memory · {profile.name}'s brain</div>
      {pages === null ? (
        <div className="val" style={{ color: "var(--t-tertiary)" }}>loading…</div>
      ) : pages.length === 0 ? (
        <div className="val" style={{ color: "var(--t-tertiary)" }}>
          No memories yet — grows as this division works.
        </div>
      ) : (
        <div className="cc-mem-list">
          {pages.map((pg) => (
            <button
              key={pg.path}
              className="cc-mem-item"
              onClick={() => void ipc.ccOpenPath(pg.path, false)}
              title={pg.path}
            >
              <span className="cc-mem-kind">{pg.kind}</span>
              <span className="cc-mem-title">{pg.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render a message body: prose with inline path/url chips, plus the
 * auto-attached artifact block (produced files) as thumbnails / Open chips. */
function MessageBody({ text }: { text: string }) {
  const { prose, artifacts } = splitArtifactBlock(text);
  const proseSegs = parseArtifacts(prose);
  return (
    <div className="body">
      {proseSegs.map((seg, i) => renderSeg(seg, i))}
      {artifacts.length > 0 && (
        <div className="cc-artifacts-block">
          <div className="cc-artifacts-label">Produced</div>
          <div className="cc-artifacts-grid">
            {artifacts.map((p, i) => renderSeg(pathSegment(p), 1000 + i))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Which profile answers in this channel: a division channel → its Captain;
 * command/cross → the General. */
function channelTarget(
  channel: CCChannel | null,
  profiles: CCProfile[],
): CCProfile | null {
  if (!channel) return null;
  if (channel.kind === "division") {
    return (
      profiles.find(
        (p) => p.rank === "captain" && p.division === channel.division,
      ) ?? null
    );
  }
  return profiles.find((p) => p.rank === "general") ?? null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/** Profile avatar: chosen image (loaded as a data URL via ccReadImage, so any
 * path works) or an accent circle with initials. */
function Avatar({ profile, size }: { profile: CCProfile; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (profile.avatarPath) {
      ipc
        .ccReadImage(profile.avatarPath)
        .then((d) => alive && setSrc(d))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [profile.avatarPath]);
  const radius = size > 40 ? 14 : size / 2;
  if (src) {
    return (
      <img
        className="cc-avatar"
        src={src}
        alt={profile.name}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <div
      className="cc-avatar-fallback"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: profile.accent,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {size >= 26 ? initials(profile.name) : ""}
    </div>
  );
}

function OrgNode({
  profile,
  active,
  indent,
  onClick,
}: {
  profile: CCProfile;
  active: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`cc-node${active ? " active" : ""}${indent ? " indent" : ""}`}
      onClick={onClick}
      title={profile.charter}
    >
      <Avatar profile={profile} size={22} />
      <span className="nm">{profile.name}</span>
      <span className="rk">{profile.rank}</span>
    </button>
  );
}

export function CommandCenterApp() {
  const loaded = useCommand((s) => s.loaded);
  const load = useCommand((s) => s.load);
  const selectedProfileId = useCommand((s) => s.selectedProfileId);
  const selectedChannelId = useCommand((s) => s.selectedChannelId);
  const selectProfile = useCommand((s) => s.selectProfile);
  const selectChannel = useCommand((s) => s.selectChannel);
  const profiles = useCommand((s) => s.profiles);
  const channels = useCommand((s) => s.channels);
  const messages = useCommand((s) => s.messages);
  const activeRun = useCommand((s) => s.activeRun);
  const sendToProfile = useCommand((s) => s.sendToProfile);
  const cancelRun = useCommand((s) => s.cancelRun);
  const planning = useCommand((s) => s.planning);
  const dispatching = useCommand((s) => s.dispatching);
  const setAutonomy = useCommand((s) => s.setAutonomy);
  const setAvatar = useCommand((s) => s.setAvatar);

  const pickAvatar = async (profileId: string) => {
    try {
      const path = await openDialog({
        multiple: false,
        filters: [
          { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (typeof path === "string") await setAvatar(profileId, path);
    } catch (e) {
      log.warn("pick avatar failed", e);
    }
  };
  const proposedPlan = useCommand((s) => s.proposedPlan);
  const startMission = useCommand((s) => s.startMission);
  const approveMission = useCommand((s) => s.approveMission);
  const rejectMission = useCommand((s) => s.rejectMission);

  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mBrief, setMBrief] = useState("");
  const [graphProfile, setGraphProfile] = useState<CCProfile | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeRun?.text]);

  const tree = useCommand.getState().orgTree();
  const visible = useCommand.getState().channelsForSelected();
  const selectedProfile = selectedProfileId
    ? profiles.find((p) => p.id === selectedProfileId) ?? null
    : null;
  const activeChannel: CCChannel | null = selectedChannelId
    ? channels.find((c) => c.id === selectedChannelId) ?? null
    : null;
  const threadMessages = activeChannel
    ? messages.filter((m) => m.channelId === activeChannel.id).sort((a, b) => a.ts - b.ts)
    : [];
  const target = channelTarget(activeChannel, profiles);
  const runHere = activeRun && activeChannel && activeRun.channelId === activeChannel.id
    ? activeRun
    : null;
  const busy = !!activeRun;

  const submit = () => {
    if (!activeChannel || !target || busy || !draft.trim()) return;
    void sendToProfile(target.id, activeChannel.id, draft);
    setDraft("");
  };

  const isCommandLevel =
    activeChannel?.kind === "command" || activeChannel?.kind === "cross";
  const missionBusy = planning || dispatching;
  const launchMission = () => {
    if (!mTitle.trim() || !mBrief.trim()) return;
    void startMission(mTitle, mBrief);
    setMTitle("");
    setMBrief("");
    setComposing(false);
  };

  return (
    <div className="cc-root">
      {/* LEFT — org tree + channels */}
      <div className="cc-rail">
        <div className="cc-rail-head">Command Center</div>
        <div className="cc-rail-scroll">
          <div className="cc-section-label">Org</div>
          {tree.commander && (
            <OrgNode
              profile={tree.commander}
              active={selectedProfileId === tree.commander.id}
              onClick={() => selectProfile(tree.commander!.id)}
            />
          )}
          {tree.general && (
            <OrgNode
              profile={tree.general}
              active={selectedProfileId === tree.general.id}
              indent
              onClick={() => selectProfile(tree.general!.id)}
            />
          )}
          {tree.captains.map((cap) => (
            <OrgNode
              key={cap.id}
              profile={cap}
              active={selectedProfileId === cap.id}
              indent
              onClick={() => selectProfile(cap.id)}
            />
          ))}

          <div className="cc-section-label">Channels</div>
          {visible.map((c) => (
            <button
              key={c.id}
              className={`cc-chan${selectedChannelId === c.id ? " active" : ""}`}
              onClick={() => selectChannel(c.id)}
            >
              <span className="hash">#</span>
              <span>{c.name}</span>
              {c.kind !== "division" && <span className="kindtag">{c.kind}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* CENTER — channel thread */}
      <div className="cc-main">
        <div className="cc-main-head">
          <span className="title">
            {activeChannel ? `#${activeChannel.name}` : "Select a channel"}
          </span>
          {activeChannel && (
            <span className="sub">{activeChannel.kind} channel</span>
          )}
          {isCommandLevel && (
            <button
              className="cc-mission-btn"
              style={{ marginLeft: "auto" }}
              onClick={() => setComposing((v) => !v)}
              disabled={missionBusy}
            >
              <Target size={13} /> New Mission
            </button>
          )}
        </div>

        {isCommandLevel &&
          (composing || missionBusy || proposedPlan) && (
            <div className="cc-mission-panel">
              {composing && !missionBusy && !proposedPlan && (
                <>
                  <input
                    className="cc-m-title"
                    placeholder="Mission title…"
                    value={mTitle}
                    onChange={(e) => setMTitle(e.target.value)}
                  />
                  <textarea
                    className="cc-m-brief"
                    placeholder="Brief the General: what do you want the org to accomplish?"
                    value={mBrief}
                    rows={3}
                    onChange={(e) => setMBrief(e.target.value)}
                  />
                  {(() => {
                    const gen = profiles.find((p) => p.rank === "general");
                    return gen && autoDispatches(gen.autonomyLevel) ? (
                      <div className="cc-auto-note">
                        ⚡ General autonomy is{" "}
                        {AUTONOMY_LEVELS[gen.autonomyLevel]?.label} — this mission
                        will dispatch automatically (no approval step).
                      </div>
                    ) : null;
                  })()}
                  <div className="cc-m-actions">
                    <button
                      className="cc-btn primary"
                      onClick={launchMission}
                      disabled={!mTitle.trim() || !mBrief.trim()}
                    >
                      <Target size={13} /> Brief the General
                    </button>
                    <button
                      className="cc-btn"
                      onClick={() => setComposing(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {planning && (
                <div className="cc-m-status">
                  <Loader2 size={14} className="cc-spin" /> The General is
                  planning the mission…
                </div>
              )}

              {proposedPlan && !dispatching && (
                <>
                  <div className="cc-m-head">
                    General's proposed plan — {proposedPlan.directives.length}{" "}
                    {proposedPlan.directives.length === 1
                      ? "directive"
                      : "directives"}
                  </div>
                  {proposedPlan.directives.length === 0 ? (
                    <div className="cc-m-empty">
                      The General found no division that fits. Reject and refine
                      the brief.
                    </div>
                  ) : (
                    proposedPlan.directives.map((d, i) => (
                      <div className="cc-directive" key={i}>
                        <span className="cc-dchip">{d.division}</span>
                        <div className="cc-dbody">
                          <div className="cc-dtitle">{d.title}</div>
                          <div className="cc-dinstr">{d.instruction}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div className="cc-m-actions">
                    <button
                      className="cc-btn primary"
                      onClick={() => void approveMission()}
                      disabled={proposedPlan.directives.length === 0}
                    >
                      <Check size={13} /> Approve & dispatch
                    </button>
                    <button
                      className="cc-btn"
                      onClick={() => void rejectMission()}
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                </>
              )}

              {dispatching && (
                <div className="cc-dispatch">
                  <div className="cc-m-status">
                    <Loader2 size={14} className="cc-spin" />
                    {activeRun
                      ? `${profiles.find((p) => p.id === activeRun.profileId)?.name ?? "A profile"} is working…`
                      : "Dispatching directives…"}
                    <button
                      className="cc-stop-inline"
                      onClick={cancelRun}
                      title="Stop the current run"
                    >
                      <Square size={11} /> Stop
                    </button>
                  </div>
                  {activeRun && (
                    <div className="cc-dispatch-peek">
                      {activeRun.tools.length > 0 && (
                        <span className="cc-peek-tools">
                          {activeRun.tools.length} tool
                          {activeRun.tools.length === 1 ? "" : "s"} ·{" "}
                          {activeRun.tools[activeRun.tools.length - 1]?.name}
                        </span>
                      )}
                      <span className="cc-peek-text">
                        {activeRun.text
                          ? activeRun.text.slice(-220)
                          : "thinking…"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        <div className="cc-thread">
          {threadMessages.length === 0 ? (
            <div className="cc-empty">
              <div className="big">No transmissions yet</div>
              <div className="small">
                Delegation, directives and reports will stream here once the pi
                engine lands (CC-1). For now this is the org you'll command.
              </div>
            </div>
          ) : (
            <div className="cc-thread-inner">
              {threadMessages.map((m) => {
                const from = profiles.find((p) => p.id === m.fromProfileId);
                return (
                  <div className="cc-msg" key={m.id}>
                    <div className="who" style={{ color: from?.accent }}>
                      {from?.name ?? "Unknown"}
                      {m.kind !== "chat" && (
                        <span className="kindpill">{m.kind}</span>
                      )}
                    </div>
                    <MessageBody text={m.body} />
                  </div>
                );
              })}
              {runHere && (
                <div className="cc-msg">
                  <div className="who" style={{ color: target?.accent }}>
                    {target?.name ?? "Agent"}
                    <Loader2 size={11} className="cc-spin" />
                  </div>
                  {runHere.tools.map((t) => (
                    <div className="cc-tool" key={t.id}>
                      <span className="tname">{t.name}</span>
                      <span className="tstate">
                        {t.result === undefined
                          ? "running…"
                          : t.isError
                            ? "error"
                            : "done"}
                      </span>
                    </div>
                  ))}
                  <div className="body">
                    {runHere.text || (
                      <span className="cc-thinking">thinking…</span>
                    )}
                  </div>
                </div>
              )}
              <div ref={threadEndRef} />
            </div>
          )}
        </div>

        {activeChannel && (
          <div className="cc-composer">
            <textarea
              className="cc-input"
              placeholder={
                target
                  ? `Message ${target.name}…`
                  : "No profile assigned to this channel"
              }
              value={draft}
              disabled={!target}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
            />
            {busy ? (
              <button className="cc-send stop" onClick={cancelRun} title="Stop">
                <Square size={15} />
              </button>
            ) : (
              <button
                className="cc-send"
                onClick={submit}
                disabled={!target || !draft.trim()}
                title="Send (⌘↵)"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — selected profile detail */}
      {selectedProfile ? (
        <div className="cc-aside">
          <button
            className="cc-portrait-btn"
            onClick={() => void pickAvatar(selectedProfile.id)}
            title="Choose a profile picture"
          >
            <Avatar profile={selectedProfile} size={56} />
            <span className="cc-portrait-edit">Change</span>
          </button>
          <div className="pname">{selectedProfile.name}</div>
          <div className="prole">
            {selectedProfile.rank}
            {selectedProfile.division ? ` · ${selectedProfile.division}` : ""}
          </div>

          {selectedProfile.wikiRoot && (
            <button
              className="cc-btn"
              style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
              onClick={() => {
                void (async () => {
                  try {
                    const abs = await ipc.ccWorkspacePath(
                      selectedProfile.wikiRoot,
                    );
                    await ipc.ccOpenPath(abs, true);
                  } catch (e) {
                    log.warn("open workspace failed", e);
                  }
                })();
              }}
            >
              <FolderOpen size={13} /> Open workspace folder
            </button>
          )}

          <div className="cc-field">
            <div className="lbl">Charter</div>
            <div className="val">{selectedProfile.charter}</div>
          </div>

          {selectedProfile.rank !== "commander" && (
            <>
              <div className="cc-field">
                <div className="lbl">Brain</div>
                <div className="val">
                  {selectedProfile.brainModel || "pi · model TBD (CC-1)"}
                </div>
              </div>
              <div className="cc-field">
                <div className="lbl">Skills</div>
                <div className="val">
                  {selectedProfile.skillIds.length
                    ? selectedProfile.skillIds.map((s) => (
                        <span className="cc-chip" key={s}>
                          {s}
                        </span>
                      ))
                    : "—"}
                </div>
              </div>
              <div className="cc-field">
                <div className="lbl">Memory vault</div>
                <div className="val" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>
                  {selectedProfile.wikiRoot}
                </div>
              </div>
              <div className="cc-field">
                <div className="lbl">
                  Autonomy
                  {selectedProfile.rank === "general" && " · drives missions"}
                </div>
                <div className="cc-auto-row">
                  {AUTONOMY_LEVELS.map((a) => (
                    <button
                      key={a.level}
                      className={`cc-auto-pill${selectedProfile.autonomyLevel === a.level ? " active" : ""}`}
                      title={a.hint}
                      onClick={() =>
                        void setAutonomy(selectedProfile.id, a.level)
                      }
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="cc-btn"
                style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
                onClick={() => setGraphProfile(selectedProfile)}
              >
                <Share2 size={13} /> Memory graph
              </button>
              <ProfileMemory profile={selectedProfile} />
            </>
          )}
        </div>
      ) : (
        <div className="cc-aside empty">
          <div className="cc-empty">
            <div className="big">Select a unit</div>
            <div className="small">
              Pick a profile from the org to inspect its charter, brain, skills
              and memory vault.
            </div>
          </div>
        </div>
      )}

      {graphProfile && (
        <CommandGraph
          profile={graphProfile}
          onClose={() => setGraphProfile(null)}
        />
      )}
    </div>
  );
}
