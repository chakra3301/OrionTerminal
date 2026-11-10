export type IdentityGlyph = {
  version: 1;
  seed: number;
  family: "flare" | "triad" | "petal" | "orbit" | "crescent" | "split";
  path: string;
  svg: string;
  uri: string;
};

export function identitySeed(id: string): number {
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(id.normalize("NFC") || "orion")) {
    h = Math.imul(h ^ byte, 16777619);
  }
  return h >>> 0;
}

const n = (value: number) => Number(value.toFixed(3));
const p = (angle: number, radius: number, aspect = 1) => `${n(32 + Math.cos(angle) * radius)},${n(32 + Math.sin(angle) * radius * aspect)}`;

function flare(arms: number, rotation: number, waist: number, aspect: number, offset: number) {
  const step = Math.PI * 2 / arms;
  let path = `M${p(rotation, 28, aspect)}`;
  for (let i = 0; i < arms; i++) {
    const a = rotation + i * step, b = a + step;
    const radius = i % 2 ? 23 + offset : 28;
    path += `C${p(a + step * 0.12, waist, aspect)} ${p(b - step * 0.12, waist, aspect)} ${p(b, i === arms - 1 ? 28 : radius, aspect)}`;
  }
  return `${path}Z`;
}

function petals(arms: number, rotation: number, waist: number, twist: number, aspect: number) {
  let path = "";
  for (let i = 0; i < arms; i++) {
    const a = rotation + i / arms * Math.PI * 2;
    path += `M${p(a, 4, aspect)}C${p(a - .55 + twist, waist, aspect)} ${p(a - .15, 17, aspect)} ${p(a, 28, aspect)}C${p(a + .15, 17, aspect)} ${p(a + .55 + twist, waist, aspect)} ${p(a, 4, aspect)}Z`;
  }
  return path;
}

function ellipse(rx: number, ry: number, angle: number) {
  const point = (a: number) => {
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    return `${n(32 + x * Math.cos(angle) - y * Math.sin(angle))},${n(32 + x * Math.sin(angle) + y * Math.cos(angle))}`;
  };
  const k = .55228475;
  const cp = (x: number, y: number) => `${n(32 + x * Math.cos(angle) - y * Math.sin(angle))},${n(32 + x * Math.sin(angle) + y * Math.cos(angle))}`;
  return `M${point(0)}C${cp(rx, ry * k)} ${cp(rx * k, ry)} ${point(Math.PI / 2)}C${cp(-rx * k, ry)} ${cp(-rx, ry * k)} ${point(Math.PI)}C${cp(-rx, -ry * k)} ${cp(-rx * k, -ry)} ${point(Math.PI * 1.5)}C${cp(rx * k, -ry)} ${cp(rx, -ry * k)} ${point(0)}Z`;
}

// The grammar inherits the approved masks' tapered rays, curved cuts and orbital loops.
// Stable IDs supply all variation; labels, instructions and accent edits cannot change a mark.
export function generateGlyph(id: string): IdentityGlyph {
  const seed = identitySeed(id);
  let state = seed;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const families = ["flare", "triad", "petal", "orbit", "crescent", "split"] as const;
  const hints: [RegExp, IdentityGlyph["family"]][] = [
    [/\b(web|research|search|browser)\b/, "orbit"],
    [/\b(cite|sources|reference)\b/, "crescent"],
    [/\b(code|reviewer|debug|terminal)\b/, "flare"],
    [/\b(summarizer|summary|compress)\b/, "triad"],
    [/\b(data|analyst|metrics)\b/, "split"],
    [/\b(note|notes|writing|journal)\b/, "petal"],
  ];
  const family = hints.find(([pattern]) => pattern.test(id.toLowerCase()))?.[1] ?? families[seed % families.length]!;
  const rotation = -Math.PI / 2 + (rnd() - .5) * .6;
  const aspect = .72 + rnd() * .28;
  const waist = 5 + rnd() * 8;
  let path: string;
  switch (family) {
    case "flare": path = flare(4 + Math.floor(rnd() * 2), rotation, waist, aspect, rnd() * 5); break;
    case "triad": {
      path = flare(3, rotation, 15 + rnd() * 5, aspect, 2);
      for (let i = 0; i < 3; i++) {
        const a = rotation + (i + .5) / 3 * Math.PI * 2, r = 4 + rnd() * 2;
        const x = 32 + Math.cos(a) * 7, y = 32 + Math.sin(a) * 7 * aspect;
        path += `M${n(x - r)},${n(y)}a${n(r)},${n(r)} 0 1 0 ${n(r * 2)},0a${n(r)},${n(r)} 0 1 0 ${n(-r * 2)},0Z`;
      }
      break;
    }
    case "petal": path = petals(4 + Math.floor(rnd() * 3), rotation, 17 + rnd() * 7, (rnd() - .5) * .5, aspect); break;
    case "orbit": {
      const tilt = .4 + rnd() * .5, thin = 1.1 + rnd() * .7;
      path = "";
      for (const a of [rotation, rotation + tilt, rotation - tilt]) {
        path += ellipse(27, 8 + waist * .4, a) + ellipse(27 - thin, 8 + waist * .4 - thin, a);
      }
      path += flare(4, rotation, 3.5, 1, 0).replace(/[-\d.]+,[-\d.]+/g, (pair) => {
        const [x, y] = pair.split(",").map(Number);
        return `${n(32 + (x! - 32) * .25)},${n(32 + (y! - 32) * .25)}`;
      });
      break;
    }
    case "crescent": {
      const bend = 10 + rnd() * 6;
      path = `M8,32C${n(bend)},2 49,4 56,32C42,14 22,17 8,32ZM8,32C22,47 42,50 56,32C49,60 ${n(bend)},62 8,32Z`;
      path += flare(4, rotation, 5, aspect, 0).replace(/[-\d.]+,[-\d.]+/g, (pair) => {
        const [x, y] = pair.split(",").map(Number);
        return `${n(32 + (x! - 32) * .36)},${n(32 + (y! - 32) * .36)}`;
      });
      const angle = ((seed >>> 12) % 4) * Math.PI / 4;
      path = path.replace(/[-\d.]+,[-\d.]+/g, (pair) => {
        const [x, y] = pair.split(",").map(Number), dx = x! - 32, dy = y! - 32;
        return `${n(32 + dx * Math.cos(angle) - dy * Math.sin(angle))},${n(32 + dx * Math.sin(angle) + dy * Math.cos(angle))}`;
      });
      break;
    }
    case "split": {
      const arms = 2 + (seed >>> 8) % 3;
      path = petals(arms, rotation, 23 + rnd() * 4, .6 + rnd() * .5, aspect) + petals(arms, rotation + Math.PI / arms, 11, -.3, .6);
      break;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="white" fill-rule="evenodd" d="${path}"/></svg>`;
  return { version: 1, seed, family, path, svg, uri: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}
