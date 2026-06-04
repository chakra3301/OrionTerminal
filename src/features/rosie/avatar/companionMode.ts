import { useRosie, currentActivity } from "@/features/rosie/rosieStore";
import { useVoice } from "@/store/voiceStore";

export type CompanionMode =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "speaking";

/**
 * Derives the companion's expressive mode from R.O.S.I.E + voice state so the
 * 3D avatar can react. You addressing her (voice) wins over her own turn state.
 * Returns just the (rarely-changing) mode — live values like mic amplitude are
 * read inside the render loop via getState() to avoid 60Hz React re-renders.
 */
export function useCompanionMode(): CompanionMode {
  const activity = useRosie((s) => currentActivity(s));
  const voiceStatus = useVoice((s) => s.status);

  if (voiceStatus === "listening" || voiceStatus === "recording") return "listening";
  if (activity.startsWith("running ")) return "working";
  if (activity.startsWith("responding")) return "speaking";
  if (activity !== "idle") return "thinking";
  return "idle";
}
