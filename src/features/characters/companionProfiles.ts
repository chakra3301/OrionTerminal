// The four Orion companions share one Rigify deform skeleton (DEF-*). None of
// them has hands: oversized closed sleeves cover the DEF-hand joints, so every
// gesture is built from arm, sleeve, shoulder, spine and head motion.

export type CompanionId = "rosie" | "mxshy" | "suki" | "ang3l";

export type SwingSpringSpec = {
  bone: string;
  region: "hair" | "sleeves";
  frequencyHz: number;
  dampingRatio: number;
  lengthMeters: number;
  maxAngleDegrees: number;
};

export type MotionProfile = {
  /** Overall amplitude/tempo of gestures. 1 = R.O.S.I.E. */
  energy: number;
  /** Idle arm angle below horizontal, radians. Sleeves need clearance from the hips. */
  armDown: number;
  /** Idle arm swing toward the front, radians (0 = sideways, π/2 = straight ahead). */
  armForward: number;
  /** Resting head pitch, radians (+ = looking down). */
  headPitch: number;
  /** Hop height in rig units for celebratory clips. */
  hop: number;
  /** A.N.G.3.L's rigid back fins. */
  fins: boolean;
};

const hairAndSleeves = (
  hair: [number, number, number, number, number],
  back: [number, number, number, number, number],
  upper: number,
  fore: number,
): SwingSpringSpec[] => [
  ...(["L", "R"] as const).map((side) => ({
    bone: `DEF-bob.tip.${side}`, region: "hair" as const,
    frequencyHz: hair[0], dampingRatio: hair[1], lengthMeters: hair[2], maxAngleDegrees: hair[3],
  })),
  { bone: "DEF-bob.tip.back", region: "hair", frequencyHz: back[0], dampingRatio: back[1], lengthMeters: back[2], maxAngleDegrees: back[3] },
  ...(["L", "R"] as const).flatMap((side) => [
    { bone: `DEF-sleeve.upper.${side}`, region: "sleeves" as const, frequencyHz: 3.5, dampingRatio: 0.73, lengthMeters: upper, maxAngleDegrees: 1.7 },
    { bone: `DEF-sleeve.fore.${side}`, region: "sleeves" as const, frequencyHz: 3.5, dampingRatio: 0.73, lengthMeters: fore, maxAngleDegrees: 1.7 },
  ]),
];

// Spring parameters are the authored values from each companion's live-spring
// handoff (Mushroom / Cream v2 / ANGEL v2). R.O.S.I.E's handoff covers only her
// soft body; her sleeves reuse the shared sleeve tuning and her ponytails use
// the Cream v2 hair response.
export const SWING_SPRINGS: Record<CompanionId, SwingSpringSpec[]> = {
  mxshy: hairAndSleeves([3.1, 0.72, 0.0898, 1.0, 0], [3.3, 0.74, 0.072, 0.8, 0], 0.0958, 0.0928),
  suki: hairAndSleeves([0.9, 0.48, 0.083, 6.0, 0], [1.05, 0.5, 0.057, 4.5, 0], 0.0724, 0.0904),
  ang3l: hairAndSleeves([0.9, 0.48, 0.06, 6.0, 0], [1.05, 0.5, 0.055, 4.5, 0], 0.0751, 0.0762),
  rosie: [
    ...(["L", "R"] as const).flatMap((side) => [
      { bone: `DEF-ponytail.01.${side}`, region: "hair" as const, frequencyHz: 0.9, dampingRatio: 0.48, lengthMeters: 0.078, maxAngleDegrees: 6 },
      { bone: `DEF-ponytail.02.${side}`, region: "hair" as const, frequencyHz: 1.05, dampingRatio: 0.5, lengthMeters: 0.07, maxAngleDegrees: 4.5 },
      { bone: `DEF-sleeve.upper.${side}`, region: "sleeves" as const, frequencyHz: 3.5, dampingRatio: 0.73, lengthMeters: 0.08, maxAngleDegrees: 1.7 },
      { bone: `DEF-sleeve.fore.${side}`, region: "sleeves" as const, frequencyHz: 3.5, dampingRatio: 0.73, lengthMeters: 0.08, maxAngleDegrees: 1.7 },
    ]),
  ],
};

export const MOTION_PROFILES: Record<CompanionId, MotionProfile> = {
  rosie: { energy: 1, armDown: 1.12, armForward: 0.42, headPitch: 0.02, hop: 0.018, fins: false },
  mxshy: { energy: 1.15, armDown: 1.08, armForward: 0.5, headPitch: 0, hop: 0.026, fins: false },
  suki: { energy: 0.72, armDown: 1.16, armForward: 0.46, headPitch: 0.07, hop: 0.01, fins: false },
  ang3l: { energy: 0.85, armDown: 1.1, armForward: 0.4, headPitch: 0.03, hop: 0.014, fins: true },
};
