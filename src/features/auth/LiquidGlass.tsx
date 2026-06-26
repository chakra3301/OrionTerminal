import type { FormEvent, ReactNode } from "react";

/** Animated displacement filter — the "liquid" in liquid glass. feTurbulence
 * drives feDisplacementMap; the SMIL <animate> slowly morphs the noise so the
 * glass body shimmers like it's flowing. Mounted once per auth screen. */
export function GlassFilterDefs() {
  return (
    <svg
      className="ot-glass-defs"
      aria-hidden
      width="0"
      height="0"
      focusable="false"
    >
      <defs>
        <filter
          id="ot-liquid-glass"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.011 0.015"
            numOctaves={2}
            seed={11}
            result="noise"
          >
            <animate
              attributeName="baseFrequency"
              dur="18s"
              values="0.011 0.015;0.016 0.011;0.011 0.015"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feGaussianBlur in="noise" stdDeviation="0.5" result="soft" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="soft"
            scale="26"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/** Layered liquid-glass card. The real form content lives in `.ot-glass-body`
 * above the refraction / tint / specular / sheen layers. */
export function LiquidGlassCard({
  wide,
  onSubmit,
  children,
}: {
  wide?: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form
      className={`ot-auth-card ot-glass${wide ? " wide" : ""}`}
      onSubmit={onSubmit}
    >
      <span className="ot-glass-refract" aria-hidden />
      <span className="ot-glass-tint" aria-hidden />
      <span className="ot-glass-specular" aria-hidden />
      <span className="ot-glass-sheen" aria-hidden />
      <div className="ot-glass-body">{children}</div>
    </form>
  );
}
