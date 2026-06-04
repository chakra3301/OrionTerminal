import { useVoice } from "@/store/voiceStore";
import { log } from "@/lib/log";

/** All shared mutable state for an in-flight capture session lives here so
 * start/stop/abort can find each other across module re-entries. */
type Session = {
  stream: MediaStream;
  audioContext: AudioContext;
  analyser: AnalyserNode;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  rafHandle: number | null;
  /** Resolved with the audio blob when stop() finishes flushing. */
  donePromise: Promise<Blob>;
  resolveDone: (blob: Blob) => void;
};

let current: Session | null = null;

export async function startVoiceCapture(): Promise<void> {
  if (current) return; // already running
  const voice = useVoice.getState();
  voice.setStatus("requesting_mic");
  voice.setError(null);

  // Pre-flight: enumerate audio inputs. The KEY signal is whether device
  // labels are populated — empty labels mean macOS has NOT granted
  // permission (or TCC is confused) regardless of what System Settings
  // shows. Populated labels confirm full permission.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioIns = devices.filter((d) => d.kind === "audioinput");
    log.info(
      `[voice] enumerateDevices found ${audioIns.length} audio input(s):`,
      audioIns.map((d) => ({
        deviceId: d.deviceId ? d.deviceId.slice(0, 8) + "…" : "(none)",
        label: d.label || "(empty — permission likely denied)",
      })),
    );
  } catch (e) {
    log.warn("[voice] enumerateDevices failed", e);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "NotAllowedError"
        ? "Microphone access denied. Enable it in System Settings → Privacy & Security → Microphone, then try again."
        : e instanceof Error
          ? e.message
          : String(e);
    voice.setStatus("error");
    voice.setError(msg);
    throw new Error(msg);
  }

  // Diagnostic: surface what we got so silent-mic issues are debuggable.
  // (Track label is empty when macOS withholds permission — a common
  // failure mode where getUserMedia "succeeds" but no audio frames flow.)
  const tracks = stream.getAudioTracks();
  log.info(
    "[voice] got stream, audio tracks:",
    tracks.map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted })),
  );
  const firstTrack = tracks[0];
  // macOS silent-mute heuristic: when permission is denied at the OS level,
  // the track is delivered but `muted === true` and/or `label === ""` and
  // no audio frames ever arrive. Detect early and bail with a clear msg
  // instead of letting the user wait through a silent recording.
  if (firstTrack && (firstTrack.muted || firstTrack.label === "")) {
    const detail = firstTrack.muted ? "muted by OS" : "no device label";
    const msg = `Mic not delivering audio (${detail}). On macOS in dev mode you must grant mic access to the PARENT process (the Terminal/iTerm/VS Code window that ran \`npm run tauri dev\`), not Orion Terminal itself. Open System Settings → Privacy & Security → Microphone, enable that app, fully quit it, then re-run tauri dev. Or use \`npm run tauri build\` and launch the bundled .app instead.`;
    log.warn("[voice] " + msg);
    stream.getTracks().forEach((t) => t.stop());
    voice.setStatus("error");
    voice.setError(msg);
    throw new Error(msg);
  }
  // Also watch for mid-recording mute (mic disconnect, OS revokes perm).
  if (firstTrack) {
    firstTrack.onmute = () => {
      log.warn("[voice] track muted mid-recording");
    };
  }

  // Set up the Web Audio analyser for live amplitude → menubar waveform.
  // Use the DEFAULT sample rate (whatever the system gives us); forcing
  // 16kHz here is unreliable on Safari/WKWebView and unnecessary —
  // Whisper's decode step resamples on its own.
  const audioContext = new AudioContext();
  // Safari/WKWebView auto-suspend AudioContext until a user gesture
  // resumes it. The button click that called us IS a gesture, but the
  // suspended state survives the async getUserMedia hop on some
  // versions. Explicit resume is cheap and idempotent.
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (e) {
      log.warn("[voice] audioContext.resume failed", e);
    }
  }
  log.info(
    "[voice] audioContext state:",
    audioContext.state,
    "sampleRate:",
    audioContext.sampleRate,
  );
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  // MediaRecorder produces an Opus-in-webm blob. We decode it later via
  // AudioContext.decodeAudioData when handing to Whisper.
  const mimeCandidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  const mime = mimeCandidates.find((m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  );
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let resolveDone!: (b: Blob) => void;
  const donePromise = new Promise<Blob>((resolve) => {
    resolveDone = resolve;
  });
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    resolveDone(blob);
  };

  recorder.start();
  voice.setStatus("recording");

  // Drive the menubar waveform amplitude. RMS over a frame, smoothed
  // with exponential decay. 0..1 range.
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = 0;
  let peakRms = 0;
  let lastLog = 0;
  let rafHandle: number | null = null;
  const tick = () => {
    if (!current) return;
    analyser.getByteTimeDomainData(buffer);
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = (buffer[i]! - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buffer.length); // 0..1
    if (rms > peakRms) peakRms = rms;
    // Scale a bit — speech rarely fills the dynamic range, so we boost.
    const scaled = Math.min(1, rms * 4);
    smoothed = smoothed * 0.6 + scaled * 0.4;
    useVoice.getState().setAmplitude(smoothed);
    // Log a peak summary every second so silent-mic issues show up in
    // the console without flooding it.
    const now = performance.now();
    if (now - lastLog > 1000) {
      log.info(
        `[voice] peak rms last 1s = ${peakRms.toFixed(4)} (smoothed=${smoothed.toFixed(3)})`,
      );
      peakRms = 0;
      lastLog = now;
    }
    rafHandle = requestAnimationFrame(tick);
  };
  rafHandle = requestAnimationFrame(tick);

  current = {
    stream,
    audioContext,
    analyser,
    recorder,
    chunks,
    rafHandle,
    donePromise,
    resolveDone,
  };
}

/** Stop recording and return the transcript. Resolves with empty string if
 * nothing was captured or transcription failed. */
export async function stopAndTranscribe(): Promise<string> {
  if (!current) return "";
  const session = current;
  if (session.rafHandle) cancelAnimationFrame(session.rafHandle);
  current = null;
  // MediaRecorder's onstop fires after data is flushed. Await the promise.
  if (session.recorder.state !== "inactive") {
    session.recorder.stop();
  }
  const blob = await session.donePromise;
  log.info(
    `[voice] recording stopped, blob size = ${blob.size} bytes (${blob.type})`,
  );
  // Cleanup audio graph + mic permission lease.
  session.stream.getTracks().forEach((t) => t.stop());
  try {
    await session.audioContext.close();
  } catch {
    /* ignore */
  }

  useVoice.getState().setStatus("transcribing");
  useVoice.getState().setAmplitude(0);

  if (blob.size < 1000) {
    // Almost-empty blob. Skip the whisper call (it would either error
    // or return empty) and surface a clear hint to the user.
    log.warn("[voice] blob too small — mic likely captured no audio");
    useVoice.getState().setStatus("error");
    useVoice.getState().setError(
      "No audio captured. Check macOS System Settings → Privacy & Security → Microphone and ensure Orion Terminal is allowed.",
    );
    return "";
  }

  try {
    const { transcribeBlob } = await import("@/lib/voiceTranscribe");
    const text = await transcribeBlob(blob);
    log.info(`[voice] transcript: "${text}"`);
    useVoice.getState().setStatus("idle");
    return text;
  } catch (e) {
    log.warn("transcribe failed", e);
    useVoice.getState().setStatus("error");
    useVoice.getState().setError(
      e instanceof Error ? e.message : String(e),
    );
    return "";
  }
}

/** Discard the in-flight session without transcribing. */
export function abortVoiceCapture(): void {
  if (!current) return;
  const session = current;
  current = null;
  if (session.rafHandle) cancelAnimationFrame(session.rafHandle);
  if (session.recorder.state !== "inactive") {
    try {
      session.recorder.stop();
    } catch {
      /* ignore */
    }
  }
  session.stream.getTracks().forEach((t) => t.stop());
  void session.audioContext.close().catch(() => undefined);
}
