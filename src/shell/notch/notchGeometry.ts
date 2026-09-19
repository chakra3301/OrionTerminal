// Adapted from Codenotch's MIT-licensed Design, NotchLayout and SideNotchShape.
// Provenance and grant: ./NOTICE.md.
export const PX = 44 / 117;
export const NOTCH = {
  width: 186 * PX, curl: 103 * PX, corner: 78.8 * PX,
  padTop: 69.5 * PX, padBottom: 50.1 * PX, gap: 83.5 * PX,
  ring: 44, labelGap: 26.9 * PX, labelHeight: 18,
  pillWidth: 26 * PX, pillHeight: 210 * PX,
  cardWidth: 600 * PX, tail: 75 * PX, tailGap: 28 * PX,
};

export function notchLayout(count: number, scale: number, labels: boolean) {
  const cell = NOTCH.ring + NOTCH.labelGap + NOTCH.labelHeight + (labels ? 13 : 0);
  const height = 2 * NOTCH.curl + NOTCH.padTop + NOTCH.padBottom + count * cell + Math.max(0, count - 1) * NOTCH.gap;
  return {
    width: NOTCH.width * scale, height: height * scale,
    ringCenter: (index: number) => (NOTCH.curl + NOTCH.padTop + NOTCH.ring / 2 + index * (cell + NOTCH.gap)) * scale,
    cellTop: (index: number) => (NOTCH.curl + NOTCH.padTop + index * (cell + NOTCH.gap)) * scale,
  };
}

export function notchPath(width: number, height: number, scale = 1) {
  const wanted = Math.max(0, Math.min(NOTCH.corner * scale, width / 2));
  const curl = Math.max(0, Math.min(NOTCH.curl * scale, height / 2, width - wanted));
  const corner = Math.max(0, Math.min(wanted, (height - 2 * curl) / 2));
  const n = (v: number) => +v.toFixed(3);
  const w = n(width), h = n(height), q = n(curl), c = n(corner);
  return `M ${w} 0 A ${q} ${q} 0 0 1 ${n(width - curl)} ${q} L ${c} ${q} A ${c} ${c} 0 0 0 0 ${n(curl + corner)} L 0 ${n(height - curl - corner)} A ${c} ${c} 0 0 0 ${c} ${n(height - curl)} L ${n(width - curl)} ${n(height - curl)} A ${q} ${q} 0 0 1 ${w} ${h} Z`;
}

export function springEasing(response: number, damping: number, duration: number) {
  const omega = 2 * Math.PI / response;
  const root = Math.sqrt(1 - damping ** 2);
  const samples = Array.from({ length: 61 }, (_, i) => {
    if (i === 60) return "1";
    const t = i / 60 * duration;
    return (1 - Math.exp(-damping * omega * t) * (Math.cos(omega * root * t) + damping / root * Math.sin(omega * root * t))).toFixed(5);
  });
  return `linear(${samples.join(",")})`;
}
