import { useEffect } from "react";
import { ipc } from "@/lib/ipc";
import { useRosie, extractSpeakableText } from "@/features/rosie/rosieStore";
import { useVoice } from "@/store/voiceStore";
import { useProjectStore } from "@/store/projectStore";
import { useShell } from "@/shell/store/useShell";
import { useNotesStore } from "@/store/notesStore";
import {
  useWorkspace,
  allTabs,
  activeFilePathInFocused,
} from "@/components/workspace/workspaceStore";
import { useCompanionProactive } from "./companionProactiveStore";
import { dragState } from "./dragState";

// Fallback check-ins if context-aware generation fails or is slow.
const FALLBACK = [
  "What are you building today?",
  "Need a hand with anything?",
  "Want me to pull up your recent notes?",
  "How's it going over there?",
  "Anything you want me to keep an eye on?",
  "Stuck on anything? I can help.",
  "What's the next move?",
  "I'm right here if you need me — what's next?",
];

const FIRST_DELAY = 90_000; // first check-in ~90s after launch
const MIN_GAP = 180_000; // then every 3–6 minutes
const MAX_GAP = 360_000;
const TICK = 15_000;
const RETRY = 30_000; // if she can't ask right now (busy), try again soon
const BUBBLE_CAP = 180; // chars before a reply is truncated in the bubble

// Rotating angles so her check-ins vary instead of always "what are you up to".
const ANGLES = [
  "their current work or the file they're in",
  "one of their recent notes or ideas",
  "a warm, general check-in about how it's going",
  "following up on what they last talked to you about",
  "something that fits the time of day",
  "a small, genuinely useful offer of help",
];

/** A snapshot of what the user is up to, fed to the model so her check-ins are
 * specific and personal rather than generic. Every read is defensive. */
function gatherContext(): string {
  const lines: string[] = [];
  try {
    const h = new Date().getHours();
    const tod =
      h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
    lines.push(`Time of day: ${tod}.`);
  } catch {
    /* ignore */
  }
  try {
    const name = useProjectStore.getState().active?.name;
    if (name) lines.push(`Active project: ${name}.`);
  } catch {
    /* ignore */
  }
  try {
    const shell = useShell.getState();
    const win = shell.windows.find((w) => w.id === shell.focusedWindowId);
    if (win) lines.push(`Focused app: ${win.app}.`);
    const ws = useWorkspace.getState();
    const path = activeFilePathInFocused(ws.root, ws.focusedPanelId);
    if (path) lines.push(`Open file: ${path.split(/[\\/]/).pop()}.`);
    const files = allTabs(ws.root)
      .map((tb) =>
        tb.descriptor.kind === "file"
          ? tb.descriptor.path.split(/[\\/]/).pop()
          : null,
      )
      .filter((n): n is string => !!n);
    if (files.length > 1) lines.push(`Open files: ${files.slice(0, 6).join(", ")}.`);
  } catch {
    /* ignore */
  }
  try {
    const notes = [...useNotesStore.getState().notes.values()]
      .filter((n) => n.title?.trim())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
      .map((n) => n.title.trim());
    if (notes.length) lines.push(`Recent notes: ${notes.join("; ")}.`);
  } catch {
    /* ignore */
  }
  try {
    const lastUser = [...useRosie.getState().messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUser && typeof lastUser.content === "string" && lastUser.content.trim()) {
      lines.push(
        `Last thing they asked you: "${lastUser.content.trim().slice(0, 120)}".`,
      );
    }
  } catch {
    /* ignore */
  }
  return lines.join("\n");
}

function pickFallback(): string {
  return FALLBACK[Math.floor(Math.random() * FALLBACK.length)]!;
}

async function generateQuestion(): Promise<string> {
  try {
    const ctx = gatherContext();
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)]!;
    const prompt =
      "You are R.O.S.I.E, a warm, witty JARVIS-style desktop AI companion living on the user's screen.\n" +
      "Here's what you currently know about them:\n" +
      (ctx || "(not much right now)") +
      "\n\nProactively check in with ONE short line (max ~14 words) — a friendly, specific question " +
      `or offer about ${angle}. Make it feel personal and natural, never generic or repetitive. ` +
      "Do not greet by name. Output ONLY the line, no quotes, no preamble.";
    const reply = await ipc.claudeOneshot(prompt);
    const line =
      reply
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    const cleaned = line.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (cleaned.length >= 4 && cleaned.length <= 160) return cleaned;
  } catch {
    /* fall through */
  }
  return pickFallback();
}

function canAskNow(): boolean {
  const rs = useRosie.getState();
  return (
    rs.companionVisible &&
    !rs.open &&
    !rs.running &&
    !dragState.dragging &&
    useVoice.getState().status === "idle" &&
    useCompanionProactive.getState().prompt === null
  );
}

/**
 * (1) Schedules occasional proactive, context-aware check-ins while she's idle
 * and unobtrusive. (2) Surfaces her completed chat replies in the bubble above
 * her head when the panel is closed (so she "talks" there — great hands-free).
 * Mount once (in Shell).
 */
export function useProactiveCompanion() {
  // (1) Proactive check-ins.
  useEffect(() => {
    let nextAt = Date.now() + FIRST_DELAY;
    const tick = () => {
      if (Date.now() < nextAt || !canAskNow()) {
        if (Date.now() >= nextAt) nextAt = Date.now() + RETRY;
        return;
      }
      nextAt = Date.now() + MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
      void (async () => {
        const q = await generateQuestion();
        if (!canAskNow()) return; // conditions may have changed while generating
        useCompanionProactive.getState().ask(q);
        if (useRosie.getState().ttsEnabled) {
          void import("@/lib/voiceSpeak").then((m) => m.speak(q));
        }
      })();
    };
    const id = setInterval(tick, TICK);
    return () => clearInterval(id);
  }, []);

  // (2) Her chat replies → bubble (only when the panel is closed).
  useEffect(() => {
    let lastId = "";
    return useRosie.subscribe((s, prev) => {
      if (!(prev.running && !s.running)) return; // only on turn completion
      if (s.open || s.error || !s.companionVisible) return;
      const last = [...s.messages].reverse().find((m) => m.role === "assistant");
      if (!last || last.id === lastId) return;
      const text = extractSpeakableText(last.content).trim();
      if (!text) return;
      lastId = last.id;
      const capped =
        text.length > BUBBLE_CAP ? text.slice(0, BUBBLE_CAP - 1).trimEnd() + "…" : text;
      useCompanionProactive.getState().say(capped);
    });
  }, []);
}
