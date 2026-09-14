import { log } from "@/lib/log";
import { useVoice } from "@/store/voiceStore";
import { InferenceClient } from "./inferenceClient";
import type { SpeechRequest } from "./speechWorker";

const speech = new InferenceClient<SpeechRequest, string>(
  () => new Worker(new URL("./speechWorker.ts", import.meta.url), { type: "module" }),
);

/** Decode a recorded audio blob (Opus/WebM, MP4, etc.) into mono float32
 * samples Whisper expects. We let the system pick the sample rate (Safari/
 * WKWebView rejects custom rates on AudioContext) and resample manually
 * to 16kHz below. */
async function blobToSamples(blob: Blob): Promise<Float32Array> {
  log.info(`[voice] decode start, blob size=${blob.size} type=${blob.type}`);
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } catch (e) {
    await audioContext.close().catch(() => undefined);
    log.warn(
      "[voice] decodeAudioData failed — WKWebView may not support this codec:",
      blob.type,
      e,
    );
    throw new Error(
      `Audio decode failed (${blob.type}). WKWebView may not support this codec. Try again — different containers cycle through automatically.`,
    );
  }
  await audioContext.close().catch(() => undefined);

  log.info(
    `[voice] decoded: ${audioBuffer.duration.toFixed(2)}s, ` +
      `${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz, ` +
      `${audioBuffer.length} frames`,
  );

  // Mix down to mono.
  let mono: Float32Array;
  if (audioBuffer.numberOfChannels === 1) {
    mono = audioBuffer.getChannelData(0);
  } else {
    const len = audioBuffer.length;
    mono = new Float32Array(len);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        mono[i] = (mono[i] ?? 0) + data[i]! / audioBuffer.numberOfChannels;
      }
    }
  }

  return resampleTo16k(mono, audioBuffer.sampleRate);
}

const WHISPER_RATE = 16_000;

/** Linear-interpolation resample of mono float samples to 16kHz (Whisper's
 * expected input). Whisper is robust to linear resampling for speech. */
export function resampleTo16k(
  mono: Float32Array,
  sourceRate: number,
): Float32Array {
  if (sourceRate === WHISPER_RATE) return mono;
  const ratio = sourceRate / WHISPER_RATE;
  const outLen = Math.floor(mono.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(mono.length - 1, i0 + 1);
    const t = srcIdx - i0;
    out[i] = mono[i0]! * (1 - t) + mono[i1]! * t;
  }
  return out;
}

/** Transcribe raw mono float samples already at 16kHz. Used by the ambient
 * wake-word listener which captures PCM directly (no Opus round-trip).
 * `quiet` suppresses the verbose per-call logging since the listener fires
 * frequently. */
export async function transcribeSamples(
  samples16k: Float32Array,
  quiet = false,
): Promise<string> {
  if (samples16k.length < 1600) return "";
  if (!speech.ready) useVoice.getState().setStatus("loading_model");
  const samples = new Float32Array(samples16k).buffer;
  try {
    const text = await speech.request({ op: "transcribe", samples }, [samples]);
    if (!quiet) log.info("[voice] inference completed");
    return text;
  } catch (err) {
    log.warn("[voice] whisper inference failed", err);
    throw err;
  }
}

export async function transcribeBlob(blob: Blob): Promise<string> {
  const samples = await blobToSamples(blob);
  if (samples.length < 1600) {
    log.warn(`[voice] only ${samples.length} samples — too short, skipping`);
    return "";
  }
  return transcribeSamples(samples);
}

export async function warmSpeech(): Promise<void> {
  await speech.request({ op: "warm" });
}

/** True once the model has loaded successfully. Cheap UI hook. */
export function isWhisperReady(): boolean {
  return speech.ready;
}
