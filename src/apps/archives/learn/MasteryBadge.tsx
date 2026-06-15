// src/apps/archives/learn/MasteryBadge.tsx
import { useId, useMemo } from "react";
import type { Pt } from "./figure";

type Props = {
  topicTitle: string;
  outline?: Pt[] | null;
  masteredCount: number;
  total: number;
  size?: number;
  variant?: "full" | "medallion";
};

// Map a normalized (0..1) outline into a centered box of side `box` around (cx,cy).
function glyphPoints(outline: Pt[], cx: number, cy: number, box: number): string {
  return outline.map((p) => `${cx + (p.x - 0.5) * box},${cy + (p.y - 0.5) * box}`).join(" ");
}

// 8-point sunburst star (full badge, 120,120 space)
const STAR_FULL = "120,28 138,92 202,74 156,120 202,166 138,148 120,212 102,148 38,166 84,120 38,74 102,92";

// Small 8-point star for medallion (30,30 space)
const STAR_SMALL = "30,7 34.5,23 50.5,18.5 39,30 50.5,41.5 34.5,37 30,53 25.5,37 9.5,41.5 21,30 9.5,18.5 25.5,23";

export default function MasteryBadge({
  topicTitle,
  outline,
  masteredCount,
  total,
  size = 220,
  variant = "full",
}: Props) {
  const uid = useId();
  const pct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;
  const callsign = topicTitle.toUpperCase().slice(0, 14);

  const glyph = useMemo(
    () => (outline && outline.length >= 3 ? glyphPoints(outline, 120, 120, 70) : null),
    [outline],
  );

  const glyphSmall = useMemo(
    () => (outline && outline.length >= 3 ? glyphPoints(outline, 30, 30, 28) : null),
    [outline],
  );

  // ── Medallion variant (60×60) ──────────────────────────────────────────────
  if (variant === "medallion") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 60 60"
        style={{ overflow: "visible" }}
        aria-label={`${topicTitle} mastery medallion`}
      >
        {/* Octagon plate */}
        <polygon
          points="30,10 42,15 47,27 42,39 30,44 18,39 13,27 18,15"
          fill="rgba(var(--lr-gold-rgb), 0.08)"
          stroke="rgba(var(--lr-gold-rgb), 1)"
          strokeWidth="1.4"
        />
        {/* Centered glyph / fallback star */}
        <g
          stroke="#ffe89a"
          strokeWidth="1.1"
          fill="none"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 2px rgba(255,232,154,.5))" }}
        >
          <polygon points={glyphSmall ?? STAR_SMALL} />
        </g>
      </svg>
    );
  }

  // ── Full variant (240×240) ─────────────────────────────────────────────────
  const grainId = `grainF${uid}`;
  const discId = `discF${uid}`;
  const clipId = `plateClip${uid}`;
  const octagonPts = "120,40 168,58 188,108 168,158 120,176 72,158 52,108 72,58";
  const hexPts = "120,28 202,74 202,166 120,212 38,166 38,74"; // grain wash hex

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      style={{ overflow: "visible" }}
      className="lb-badge"
      aria-label={`${topicTitle} mastery badge — ${pct}% complete`}
    >
      <defs>
        {/* Grain texture filter */}
        <filter id={grainId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} result="noise" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" result="grain" />
          <feComposite in="grain" in2="SourceGraphic" operator="in" />
        </filter>

        {/* Disc radial gradient */}
        <radialGradient id={discId} cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor="rgba(var(--lr-gold-rgb), 0.14)" />
          <stop offset="100%" stopColor="rgba(var(--lr-gold-rgb), 0.02)" />
        </radialGradient>

        {/* Plate clip — octagon */}
        <clipPath id={clipId}>
          <polygon points={octagonPts} />
        </clipPath>
      </defs>

      {/* ── Sunburst rays ── */}
      {[
        [120, 22, 120, 218],
        [22, 120, 218, 120],
        [189, 51, 51, 189],
        [51, 51, 189, 189],
      ].map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="rgba(var(--lr-gold-rgb), 0.9)"
          strokeWidth="1.1"
        />
      ))}

      {/* ── Rotating outer reticle ── */}
      <g className="lb-reticle">
        <circle
          cx="120"
          cy="120"
          r="98"
          fill="none"
          stroke="rgba(var(--lr-gold-rgb), 0.35)"
          strokeWidth="0.8"
          strokeDasharray="2 9"
        />
        {/* Four cardinal ticks */}
        <path d="M120,14 v12"  stroke="rgba(var(--lr-gold-rgb), 1)" strokeWidth="1.3" />
        <path d="M120,226 v-12" stroke="rgba(var(--lr-gold-rgb), 1)" strokeWidth="1.3" />
        <path d="M14,120 h12"  stroke="rgba(var(--lr-gold-rgb), 1)" strokeWidth="1.3" />
        <path d="M226,120 h-12" stroke="rgba(var(--lr-gold-rgb), 1)" strokeWidth="1.3" />
      </g>

      {/* ── 8-point sunburst star plate ── */}
      <polygon
        points={STAR_FULL}
        fill="none"
        stroke="rgba(var(--lr-gold-rgb), 0.5)"
        strokeWidth="1"
      />

      {/* ── Insignia octagon plate (with disc gradient) ── */}
      <polygon
        points={octagonPts}
        fill={`url(#${discId})`}
        stroke="rgba(var(--lr-gold-rgb), 1)"
        strokeWidth="1.8"
      />

      {/* ── Inner octagon ring ── */}
      <polygon
        points="120,52 158,66 174,108 158,150 120,164 82,150 66,108 82,66"
        fill="none"
        stroke="rgba(var(--lr-gold-rgb), 0.4)"
        strokeWidth="0.8"
      />

      {/* ── Rivets at octagon vertices ── */}
      {(
        [
          [120, 40], [168, 58], [188, 108], [168, 158],
          [120, 176], [72, 158], [52, 108], [72, 58],
        ] as [number, number][]
      ).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={2} fill="rgba(var(--lr-gold-rgb), 1)" />
      ))}

      {/* ── Counter-rotating violet sub-dial ── */}
      <g className="lb-subdial">
        <circle
          cx="120"
          cy="120"
          r="46"
          fill="none"
          stroke="rgba(var(--lr-rgb), 0.45)"
          strokeWidth="0.9"
          strokeDasharray="16 7"
        />
        {/* Four dial ticks */}
        <path d="M120,74 v6"  stroke="rgba(var(--lr-rgb), 0.6)" strokeWidth="1" />
        <path d="M120,166 v-6" stroke="rgba(var(--lr-rgb), 0.6)" strokeWidth="1" />
        <path d="M74,120 h6"  stroke="rgba(var(--lr-rgb), 0.6)" strokeWidth="1" />
        <path d="M166,120 h-6" stroke="rgba(var(--lr-rgb), 0.6)" strokeWidth="1" />
      </g>

      {/* ── Scanline ── */}
      <g clipPath={`url(#${clipId})`}>
        <rect
          x={52}
          y={108}
          width={136}
          height={2.4}
          fill="rgba(255,240,180,.5)"
          className="lb-scan"
        />
      </g>

      {/* ── Centered glyph (topic figure outline or star fallback) ── */}
      <g
        stroke="#ffe89a"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 3px rgba(255,232,154,.6))" }}
      >
        <polygon points={glyph ?? STAR_FULL} />
      </g>

      {/* ── Laurel / chevron flourishes ── */}
      <g stroke="rgba(var(--lr-gold-rgb), 0.7)" strokeWidth="1.2" fill="none">
        <path d="M92,182 q-16,-6 -22,-22" />
        <path d="M148,182 q16,-6 22,-22" />
        <path d="M86,178 l-5,-2 M80,172 l-5,-2 M74,166 l-5,-3" />
        <path d="M154,178 l5,-2 M160,172 l5,-2 M166,166 l5,-3" />
      </g>

      {/* ── Grain wash over the whole badge hex ── */}
      <polygon
        points={hexPts}
        filter={`url(#${grainId})`}
        opacity={0.4}
      />

      {/* ── Stamps ── */}
      {/* Top: unit · callsign */}
      <text
        x={120}
        y={36}
        textAnchor="middle"
        fontFamily="var(--font-mono, ui-monospace)"
        fontSize={8}
        letterSpacing="0.18em"
        fill="var(--t-tertiary)"
      >
        {`UNIT · ${callsign}`}
      </text>

      {/* Bottom: MASTERED */}
      <text
        x={120}
        y={200}
        textAnchor="middle"
        fontFamily="var(--font-mono, ui-monospace)"
        fontSize={9}
        letterSpacing="0.26em"
        fill="rgba(var(--lr-gold-rgb), 1)"
      >
        MASTERED
      </text>

      {/* Stats: n/total · pct% */}
      <text
        x={120}
        y={213}
        textAnchor="middle"
        fontFamily="var(--font-mono, ui-monospace)"
        fontSize={7}
        letterSpacing="0.2em"
        fill="rgba(var(--lr-rgb), 1)"
      >
        {`${masteredCount}/${total} · ${pct}%`}
      </text>
    </svg>
  );
}
