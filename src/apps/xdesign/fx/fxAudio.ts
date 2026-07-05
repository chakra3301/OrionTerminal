/**
 * Microphone → a single smoothed loudness scalar (0..1) the render loop
 * samples each frame for the `uAudio` uniform and the "audio" bind source.
 * Permission-gated, fails soft (returns 0 when denied/unavailable).
 */

import { log } from "@/lib/log";

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let bins: Uint8Array | null = null;
let level = 0;
let active = false;

export function fxAudioActive(): boolean {
  return active;
}

export async function startAudio(): Promise<boolean> {
  if (active) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    bins = new Uint8Array(analyser.frequencyBinCount);
    active = true;
    return true;
  } catch (e) {
    log.warn("fx audio: mic unavailable", e);
    stopAudio();
    return false;
  }
}

export function stopAudio(): void {
  active = false;
  level = 0;
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  if (ctx) {
    void ctx.close();
    ctx = null;
  }
  analyser = null;
  bins = null;
}

/** Current smoothed loudness 0..1. Cheap; call once per frame. */
export function sampleAudio(): number {
  if (!active || !analyser || !bins) return 0;
  analyser.getByteFrequencyData(bins);
  let sum = 0;
  for (let i = 0; i < bins.length; i++) sum += bins[i]!;
  const avg = sum / bins.length / 255;
  const target = Math.min(1, avg * 1.9);
  level += (target - level) * 0.3;
  return level;
}
