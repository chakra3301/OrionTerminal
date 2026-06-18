import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Folder,
  MessageSquare,
  Calendar,
  Image as ImageIcon,
  FileText,
  Music,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useNotesStore, type Note } from "@/store/notesStore";
import {
  listAllChats,
  getAppState,
  setAppState,
  type ChatRow,
} from "@/lib/db";
import {
  useAssetsStore,
  sortAssetsDesc,
  type Asset,
} from "@/store/assetsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { openChatById } from "@/apps/archives/searchNav";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { relativeTime } from "@/lib/time";

function greetingForHour(h: number): string {
  if (h < 5) return "Still up?";
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  if (h < 21) return "Good evening.";
  return "Late again.";
}

function formatDateLong(d: Date): string {
  return d
    .toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .replace(/, /g, " · ");
}

function chatTagColor(idx: number): string {
  return ["green", "cyan", "magenta", "yellow", "violet"][idx % 5]!;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function ArchivesToday() {
  const notes = useNotesStore((s) => s.notes);
  const assetsMap = useAssetsStore((s) => s.assets);
  const setView = useArchives((s) => s.setView);
  const setSelectedNoteId = useArchives((s) => s.setSelectedNoteId);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [now] = useState(() => new Date());

  const startNewEntry = async () => {
    try {
      const note = await useNotesStore.getState().create(null, "journal");
      setSelectedNoteId(note.id);
    } catch (e) {
      log.error("note create failed", e);
    }
    setView("journal");
  };

  const openInJournal = (noteId: string) => {
    setSelectedNoteId(noteId);
    setView("journal");
  };

  useEffect(() => {
    let cancelled = false;
    listAllChats(12)
      .then((rows) => {
        if (!cancelled) setChats(rows);
      })
      .catch((e) => log.error("listAllChats failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  const todayMs = startOfDay(now.getTime());
  const noteList = useMemo(
    () =>
      Array.from(notes.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  );
  const allAssets = useMemo(() => sortAssetsDesc(assetsMap), [assetsMap]);

  const todaysJournal = noteList
    .filter((n) => n.kind === "journal" && n.updatedAt >= todayMs)
    .slice(0, 3);
  const recentNotes = noteList.filter((n) => n.kind === "note").slice(0, 4);

  const todaysAssets = allAssets
    .filter((a) => a.createdAt >= todayMs)
    .slice(0, 4);

  const recentChats = chats.slice(0, 4);

  const yearAgo = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  const onThisDay = noteList.find((n) => {
    const d = new Date(n.createdAt);
    return (
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate() &&
      n.createdAt <= yearAgo + 7 * 24 * 60 * 60 * 1000 &&
      n.createdAt >= yearAgo - 7 * 24 * 60 * 60 * 1000
    );
  });

  return (
    <div className="ar-today scroll">
      <header className="ar-today-hero">
        <div>
          <div className="date">{formatDateLong(now)}</div>
          <h1>{greetingForHour(now.getHours())}</h1>
        </div>
        <div className="quote">
          “The best tools have a moment where they stop being a project and start being a place.”
        </div>
      </header>

      <div className="ar-today-grid">
        {/* Left column */}
        <div className="col">
          <article className="ar-card">
            <h3>
              <span className="dot" style={{ background: "var(--neon-green)" }} />
              Today's journal
            </h3>
            {todaysJournal.length === 0 ? (
              <button
                type="button"
                className="ar-card-cta"
                onClick={() => void startNewEntry()}
              >
                <span>Nothing yet today — start a new entry?</span>
              </button>
            ) : (
              <div className="ar-journal-list">
                {todaysJournal.map((n) => (
                  <JournalEntry
                    key={n.id}
                    note={n}
                    onOpen={() => openInJournal(n.id)}
                  />
                ))}
              </div>
            )}
          </article>

          <article className="ar-card">
            <h3>
              <span className="dot" style={{ background: "var(--neon-cyan)" }} />
              Recent threads
              <button
                type="button"
                className="ar-card-link"
                onClick={() => setView("chats")}
              >
                View all
              </button>
            </h3>
            {recentChats.length === 0 ? (
              <div className="ar-empty">
                <MessageSquare size={16} color="var(--t-faint)" />
                <span>No conversations yet. Send Claude a message in the rail.</span>
              </div>
            ) : (
              <div className="ar-recent-chats">
                {recentChats.map((c, i) => (
                  <button
                    type="button"
                    key={c.id}
                    className="ar-thread-tile"
                    title={c.title}
                    onClick={() =>
                      openChatById(c.id).catch((e) =>
                        log.warn("openChatById failed", e),
                      )
                    }
                  >
                    <div className="title">{c.title || "Untitled thread"}</div>
                    <div className="row">
                      <span className={`tag ${chatTagColor(i)}`}>
                        #{c.project_id ? "orion" : "archive"}
                      </span>
                      <span className="when">{relativeTime(c.updated_at, now.getTime())}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </article>
        </div>

        {/* Right column */}
        <div className="col">
          <article className="ar-card">
            <h3>
              <span className="dot" style={{ background: "var(--neon-yellow)" }} />
              Captured today
            </h3>
            {todaysAssets.length === 0 ? (
              <button
                type="button"
                className="ar-card-cta"
                onClick={() => setView("media")}
              >
                <span>
                  Nothing captured yet — drag a file anywhere in this window.
                </span>
              </button>
            ) : (
              <div className="ar-captures">
                {todaysAssets.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className={`ar-capture kind-${a.kind}`}
                    onClick={() =>
                      useArchives.getState().setPreviewingAssetId(a.id)
                    }
                    title={a.title}
                  >
                    <CaptureThumb asset={a} />
                  </button>
                ))}
              </div>
            )}
            <div className="ar-card-meta">
              {allAssets.length} {allAssets.length === 1 ? "asset" : "assets"} ·
              drag-drop to capture · auto-tags wire up next
            </div>
          </article>

          {onThisDay && (
            <article className="ar-card">
              <h3>
                <span className="dot" style={{ background: "var(--neon-magenta)" }} />
                On this day, last year
              </h3>
              <div className="ar-quote-block">
                {onThisDay.plaintext.slice(0, 240)}
                {onThisDay.plaintext.length > 240 ? "…" : ""}
              </div>
              <div className="ar-on-this-day-stamp">
                {new Date(onThisDay.createdAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </article>
          )}

          <article className="ar-card claude-read">
            <h3 style={{ color: "var(--neon-green)" }}>
              <Sparkles size={12} /> Claude's read of your week
            </h3>
            <ClaudeWeekRead recentNotes={recentNotes} recentChats={recentChats} />
          </article>
        </div>
      </div>

      <footer className="ar-today-footer">
        <FooterStat icon={<Folder size={11} />} label="Notes" value={notes.size} />
        <FooterStat icon={<MessageSquare size={11} />} label="Chats" value={chats.length} />
        <FooterStat icon={<ImageIcon size={11} />} label="Media" value={0} />
        <FooterStat icon={<Calendar size={11} />} label="Streak" value="—" />
      </footer>
    </div>
  );
}

function CaptureThumb({ asset }: { asset: Asset }) {
  if (asset.kind === "image" && asset.filePath) {
    return (
      <img
        src={convertFileSrc(asset.filePath)}
        alt={asset.title}
        loading="lazy"
        className="capture-thumb-img"
      />
    );
  }
  if (asset.kind === "video" && asset.filePath) {
    return (
      <video
        src={convertFileSrc(asset.filePath)}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          try {
            v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
          } catch {
            /* ignore */
          }
        }}
        className="capture-thumb-img"
      />
    );
  }
  const Icon =
    asset.kind === "doc"
      ? FileText
      : asset.kind === "audio"
        ? Music
        : ImageIcon;
  return (
    <span className="capture-thumb-icon">
      <Icon size={14} />
      <span className="capture-thumb-label">
        {asset.kind.toUpperCase()}
      </span>
    </span>
  );
}

function JournalEntry({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const d = new Date(note.updatedAt);
  const stamp = `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  return (
    <button type="button" className="ar-journal-entry" onClick={onOpen}>
      <div className="meta">{stamp} · entry</div>
      <div className="title">{note.title || "Untitled"}</div>
      <div className="preview">
        {note.plaintext.slice(0, 180) || (
          <span style={{ color: "var(--t-faint)", fontStyle: "italic" }}>
            (empty)
          </span>
        )}
      </div>
    </button>
  );
}

type CachedWeekRead = {
  generatedAt: number;
  text: string;
};

const WEEK_READ_TTL_MS = 24 * 60 * 60 * 1000;

function ClaudeWeekRead({
  recentNotes,
  recentChats,
}: {
  recentNotes: Note[];
  recentChats: ChatRow[];
}) {
  const [cached, setCached] = useState<CachedWeekRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate cached read on mount.
  useEffect(() => {
    let cancelled = false;
    getAppState<CachedWeekRead>("today.weekRead")
      .then((v) => {
        if (cancelled) return;
        if (v && v.text && Date.now() - v.generatedAt < WEEK_READ_TTL_MS) {
          setCached(v);
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = useCallback(async () => {
    if (recentNotes.length === 0 && recentChats.length === 0) {
      setError("Nothing recent to summarize yet.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prompt = buildWeekReadPrompt(recentNotes, recentChats);
      const reply = await ipc.claudeOneshot(prompt);
      const text = (reply || "").trim();
      if (!text) {
        setError("Empty reply from Claude.");
        return;
      }
      const next: CachedWeekRead = { generatedAt: Date.now(), text };
      setCached(next);
      void setAppState("today.weekRead", next);
    } catch (e) {
      log.error("week-read failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [recentNotes, recentChats]);

  // First-load: if nothing cached and the user has any data, kick off a
  // background generation. Cached results last 24h.
  useEffect(() => {
    if (!hydrated || cached || loading) return;
    if (recentNotes.length === 0 && recentChats.length === 0) return;
    void generate();
    // We only want this to fire once after hydration, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (recentNotes.length === 0 && recentChats.length === 0) {
    return (
      <div className="ar-week-read empty">
        Once you've written a few notes and had a couple of conversations, I'll
        surface the threads worth pulling on.
      </div>
    );
  }

  return (
    <div className="ar-week-read">
      {loading && !cached ? (
        <div className="ar-week-read-loading">
          <Loader2 size={12} className="ar-spin" /> Reading the week…
        </div>
      ) : cached ? (
        <p style={{ whiteSpace: "pre-wrap" }}>{cached.text}</p>
      ) : (
        <p style={{ color: "var(--t-tertiary)" }}>
          {error ?? "No synthesis yet — generate one to see Claude's read."}
        </p>
      )}
      <div className="ar-week-read-footer">
        {cached && (
          <span className="ar-week-read-stamp">
            generated{" "}
            {new Date(cached.generatedAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="ar-week-read-btn"
          onClick={() => void generate()}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 size={11} className="ar-spin" /> Working…
            </>
          ) : (
            <>
              <RefreshCw size={11} /> {cached ? "Regenerate" : "Generate"}
            </>
          )}
        </button>
      </div>
      {error && cached && (
        <div className="ar-week-read-error">last attempt failed: {error}</div>
      )}
    </div>
  );
}

function buildWeekReadPrompt(notes: Note[], chats: ChatRow[]): string {
  const noteLines = notes.slice(0, 8).map((n) => {
    const date = new Date(n.updatedAt).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    const body = (n.plaintext || "").slice(0, 220).replace(/\s+/g, " ").trim();
    return `- [${date}] ${n.title || "Untitled"}${body ? ` — ${body}` : ""}`;
  });
  const chatLines = chats.slice(0, 8).map((c) => {
    const date = new Date(c.updated_at).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    return `- [${date}] ${c.title || "Untitled thread"}`;
  });

  return [
    "Read this person's recent journal entries, notes, and chat thread titles.",
    "Reply with 2 to 3 short sentences synthesizing the patterns you notice —",
    "themes, contradictions, what they keep returning to. Speak directly to",
    "them, warmly, without preamble. No headers, no lists, no markdown.",
    "",
    "Recent notes / journal:",
    noteLines.length > 0 ? noteLines.join("\n") : "(none)",
    "",
    "Recent threads with Claude:",
    chatLines.length > 0 ? chatLines.join("\n") : "(none)",
    "",
    "Your read:",
  ].join("\n");
}

function FooterStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="ar-stat">
      <span className="ar-stat-icon">{icon}</span>
      <span className="ar-stat-label">{label}</span>
      <span className="ar-stat-value">{value}</span>
    </div>
  );
}
