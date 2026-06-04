/** Text-to-speech via the browser's built-in SpeechSynthesis API. Works
 * in Tauri's WKWebView using the macOS Speech Synthesis voices (the same
 * ones Siri uses, depending on what the user has installed). No model
 * download, no network calls — instant. */

import { log } from "@/lib/log";

let preferredVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;

/** Pick a "best available" voice once on first use. Prefers English voices
 * with "Premium" / "Enhanced" in the name (those are the high-quality
 * Siri-grade ones macOS bundles separately) and falls back to the OS
 * default. We don't expose voice selection in the UI for v1. */
function ensureVoice(): void {
  if (voicesLoaded) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return; // not yet enumerated; will retry
  voicesLoaded = true;
  // Heuristic ordering: premium English first, then any English, then any.
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  preferredVoice =
    en.find((v) => /premium|enhanced/i.test(v.name)) ??
    en.find((v) => /samantha|alex|ava|evan|nathan|joelle/i.test(v.name)) ??
    en[0] ??
    voices[0] ??
    null;
  log.info(
    "[tts] picked voice:",
    preferredVoice?.name,
    `(${preferredVoice?.lang})`,
  );
}

/** Strip markdown + code fences so the synthesizer doesn't read raw
 * syntax aloud. Light-touch — preserves sentence structure. Exported for
 * unit testing. */
export function speakableText(raw: string): string {
  let s = raw;
  // Remove fenced code blocks entirely.
  s = s.replace(/```[\s\S]*?```/g, " ");
  // Inline code → its content.
  s = s.replace(/`([^`]+)`/g, "$1");
  // Headings, bullets, emphasis markers.
  s = s.replace(/[*_~]{1,3}/g, "");
  s = s.replace(/^#+\s*/gm, "");
  s = s.replace(/^[-*+]\s+/gm, "");
  // Links: keep the visible label, drop the URL.
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Cancel any in-flight speech. Idempotent. */
export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

/** Speak the given text. Cancels any prior speech first so consecutive
 * calls (e.g. a multi-turn agent burst) don't queue up. Resolves when
 * the utterance ends OR is interrupted. */
export function speak(rawText: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve();
        return;
      }
      const text = speakableText(rawText);
      if (!text) {
        resolve();
        return;
      }
      stopSpeaking();
      ensureVoice();
      const utterance = new SpeechSynthesisUtterance(text);
      if (preferredVoice) utterance.voice = preferredVoice;
      // A touch faster than default — JARVIS-style brisk pacing.
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        log.warn("[tts] utterance error", e.error);
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      log.warn("[tts] speak failed", e);
      resolve();
    }
  });
}

/** macOS WKWebView loads voices asynchronously. Trigger a load so by the
 * time the user actually speaks, voices are enumerated. Cheap. */
export function warmTts(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => ensureVoice();
}
