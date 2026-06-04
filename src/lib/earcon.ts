/** Synthesized UI earcons via Web Audio — no audio assets to bundle. Short,
 * soft, JARVIS-ish blips. Used by the wake-word flow to confirm "I'm
 * listening" (armed) and "I heard you" (triggered). */

import { log } from "@/lib/log";

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch (e) {
      log.warn("[earcon] no AudioContext", e);
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Play a sequence of short tones. Each step: {freq, start, dur}. Gain
 * envelope is a quick attack + exponential decay so it reads as a "blip"
 * not a beep. Peak gain kept low (0.12) — confirmation, not alarm. */
function playTones(
  steps: Array<{ freq: number; start: number; dur: number }>,
  peak = 0.12,
): void {
  const ac = audioCtx();
  if (!ac) return;
  const now = ac.currentTime;
  for (const s of steps) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = s.freq;
    osc.connect(gain);
    gain.connect(ac.destination);
    const t0 = now + s.start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);
    osc.start(t0);
    osc.stop(t0 + s.dur + 0.02);
  }
}

/** Played when wake-word listening is armed (⌘⇧J on). Single soft mid tone. */
export function earconArmed(): void {
  playTones([{ freq: 660, start: 0, dur: 0.18 }], 0.08);
}

/** Played when listening is disarmed. Single lower tone (descending feel). */
export function earconDisarmed(): void {
  playTones([{ freq: 440, start: 0, dur: 0.16 }], 0.07);
}

/** Played the instant a wake word is recognized. Two ascending tones —
 * bright, affirmative "I heard you". */
export function earconWake(): void {
  playTones(
    [
      { freq: 880, start: 0, dur: 0.12 },
      { freq: 1320, start: 0.07, dur: 0.16 },
    ],
    0.13,
  );
}
