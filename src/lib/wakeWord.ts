import { useVoice } from "@/store/voiceStore";
import { useRosie } from "@/features/rosie/rosieStore";
import { resampleTo16k, transcribeSamples } from "@/lib/voiceTranscribe";
import { configureTransformers } from "@/lib/transformersEnv";
import { earconWake } from "@/lib/earcon";
import { matchTrigger } from "@/lib/wakePhrase";
import { log } from "@/lib/log";

/** Ambient ("always listening") wake-word mode.
 *
 * Design: keep the mic open and run a cheap energy-based VAD on raw PCM
 * (via ScriptProcessorNode). Whisper only runs on a completed speech burst
 * — never continuously — so idle cost is just the analyser loop (~0%).
 * On each burst we transcribe and check whether it opens with a trigger
 * phrase ("core", "hey core", "jarvis", …). If so, strip the trigger and
 * auto-send the remainder to Core (hands-free). Non-trigger bursts are
 * discarded.
 *
 * Tradeoffs accepted for v1: main-thread ScriptProcessorNode (deprecated
 * but universally supported in WKWebView; AudioWorklet would need a
 * separate worklet file), and local Whisper-tiny rather than a dedicated
 * wake-word model. Good enough for a personal workstation; revisit with
 * Porcupine if false-trigger rate is annoying. */

// VAD tuning (RMS on normalized -1..1 samples).
const SPEECH_RMS = 0.025; // above → speech
const START_CHUNKS = 2; // consecutive speech chunks to begin capture
const SILENCE_MS = 650; // trailing silence that ends an utterance
const MAX_UTTERANCE_MS = 12_000; // hard cap so a long noise doesn't run forever
const PREROLL_CHUNKS = 2; // include a little audio before detected onset

type Session = {
  stream: MediaStream;
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
  zeroGain: GainNode;
};

let session: Session | null = null;
let transcribing = false;

export async function startListening(): Promise<void> {
  if (session) return;
  const voice = useVoice.getState();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "NotAllowedError"
        ? "Microphone access denied. Enable it in System Settings → Privacy & Security → Microphone."
        : e instanceof Error
          ? e.message
          : String(e);
    voice.setStatus("error");
    voice.setError(msg);
    voice.setListenMode(false);
    throw new Error(msg);
  }

  // Pre-warm Whisper so the first detected utterance isn't delayed by a
  // model download mid-conversation.
  void configureTransformers();

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }
  const source = audioContext.createMediaStreamSource(stream);
  // ScriptProcessor must be connected to a destination to fire; route
  // through a zero-gain node so we don't echo the mic to the speakers.
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const zeroGain = audioContext.createGain();
  zeroGain.gain.value = 0;
  source.connect(processor);
  processor.connect(zeroGain);
  zeroGain.connect(audioContext.destination);

  const sampleRate = audioContext.sampleRate;
  const chunkMs = (4096 / sampleRate) * 1000;
  const silenceChunksToEnd = Math.ceil(SILENCE_MS / chunkMs);
  const maxChunks = Math.ceil(MAX_UTTERANCE_MS / chunkMs);

  let speechRun = 0; // consecutive speech chunks (for onset)
  let silenceRun = 0; // consecutive silence chunks (for offset)
  let capturing = false;
  let captured: Float32Array[] = [];
  const preroll: Float32Array[] = [];

  log.info(
    `[wake] listening: sampleRate=${sampleRate}, chunk≈${chunkMs.toFixed(0)}ms, ` +
      `silenceToEnd=${silenceChunksToEnd} chunks`,
  );

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // RMS of this chunk.
    let sumSq = 0;
    for (let i = 0; i < input.length; i++) sumSq += input[i]! * input[i]!;
    const rms = Math.sqrt(sumSq / input.length);
    // Feed the menubar waveform a smoothed amplitude even while just armed.
    useVoice.getState().setAmplitude(Math.min(1, rms * 4));

    const isSpeech = rms > SPEECH_RMS;

    if (!capturing) {
      // Maintain a short pre-roll ring so we don't clip the word onset.
      preroll.push(new Float32Array(input));
      while (preroll.length > PREROLL_CHUNKS) preroll.shift();
      if (isSpeech) {
        speechRun++;
        if (speechRun >= START_CHUNKS) {
          capturing = true;
          silenceRun = 0;
          captured = [...preroll]; // include pre-roll
          captured.push(new Float32Array(input));
        }
      } else {
        speechRun = 0;
      }
      return;
    }

    // Capturing.
    captured.push(new Float32Array(input));
    if (isSpeech) {
      silenceRun = 0;
    } else {
      silenceRun++;
    }
    const tooLong = captured.length >= maxChunks;
    if (silenceRun >= silenceChunksToEnd || tooLong) {
      // Utterance complete — hand off (copy then reset for next one).
      const segment = concat(captured);
      capturing = false;
      speechRun = 0;
      silenceRun = 0;
      captured = [];
      void handleUtterance(segment, sampleRate);
    }
  };

  session = { stream, audioContext, processor, zeroGain };
  voice.setStatus("listening");
}

export function stopListening(): void {
  const s = session;
  session = null;
  if (!s) return;
  try {
    s.processor.onaudioprocess = null;
    s.processor.disconnect();
    s.zeroGain.disconnect();
  } catch {
    /* ignore */
  }
  s.stream.getTracks().forEach((t) => t.stop());
  void s.audioContext.close().catch(() => undefined);
  const v = useVoice.getState();
  v.setAmplitude(0);
  if (v.status === "listening") v.setStatus("idle");
}

function concat(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function handleUtterance(
  segment: Float32Array,
  sampleRate: number,
): Promise<void> {
  // Don't pile up transcriptions — if one's already running, drop this
  // burst (the listener stays armed for the next).
  if (transcribing) return;
  transcribing = true;
  try {
    const samples16k = resampleTo16k(segment, sampleRate);
    const durationMs = (segment.length / sampleRate) * 1000;
    if (durationMs < 350) return; // too short to be a command
    const text = (await transcribeSamples(samples16k, true)).toLowerCase().trim();
    if (!text) return;
    log.info(`[wake] heard: "${text}"`);

    const match = matchTrigger(text);
    if (!match) return; // no wake word — ignore

    // Acknowledge: chime + screen-edge glow so hands-free use confirms it
    // heard the trigger even before the response streams.
    earconWake();
    useVoice.getState().pulse();

    const command = match.remainder.trim();
    const rosie = useRosie.getState();
    rosie.openPanel();
    if (command.length > 0) {
      // Auto-send: hands-free is the whole point of wake mode.
      log.info(`[wake] dispatching command: "${command}"`);
      void rosie.send(command);
    } else {
      // Bare wake word with no command — just surface R.O.S.I.E, ready
      // for a follow-up.
      log.info("[wake] bare trigger — panel opened, awaiting follow-up");
    }
  } catch (e) {
    log.warn("[wake] utterance handling failed", e);
  } finally {
    transcribing = false;
  }
}
