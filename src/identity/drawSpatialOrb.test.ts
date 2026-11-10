import { expect, it } from "vitest";
import { drawOrb, type OrbCanvas } from "@/shell/dock/orbCanvas";
import { orbModel, particlePhysics } from "@/shell/dock/orbModel";
import { spatialIdentity } from "./spatialIdentity";
import { particleSurface } from "./particleSurface";

const fixture = (identity: string) => {
  const properties: Record<PropertyKey, unknown> = {};
  const commands: unknown[][] = [], model = orbModel(), spatial = spatialIdentity(identity);
  const context = new Proxy({}, {
    get: (_, key) => properties[key] ?? ((...args: unknown[]) => {
      commands.push([key, ...args]);
      if (String(key).startsWith("create")) return { addColorStop: (...stops: unknown[]) => commands.push(["colorStop", ...stops]) };
    }),
    set: (_, key, value) => { properties[key] = value; return true; },
  }) as CanvasRenderingContext2D;
  const orb: OrbCanvas = {
    x: context, P: 176, R: 66, q: 1, color: "#4ed4ef", coreColor: "#bfefff", model, nodeXY: new Float32Array(model.nodes.pts.length * 3), m: null, last: null,
    st: { shell: particlePhysics(model.shell), nodes: particlePhysics(model.nodes), spikes: particlePhysics(model.spikes), core: particlePhysics(model.core) },
    glyph: { spatial, state: particlePhysics(spatial.group), showField: true, ink: "#e6f4ec", surface: particleSurface(identity, 176, spatial.kind) },
  };
  return { orb, commands };
};

it("renders every spatial form inside its particle surface with finite projected drawing coordinates", () => {
  const ids = ["web-research", "cite-sources", "code-reviewer", "summarizer", "data-analyst", "note-taker", "motion-director", "sound-design"];
  for (const id of ids) {
    const { orb, commands } = fixture(`skill:${id}`);
    drawOrb(orb, 2.7, false);
    expect(commands.length).toBeGreaterThan(200);
    expect(commands.flat().filter((v) => typeof v === "number").every(Number.isFinite)).toBe(true);
  }
});

it("freezes the complete 3D form and field under reduced motion", () => {
  const { orb, commands } = fixture("skill:web-research");
  drawOrb(orb, 1, true); const first = [...commands]; commands.length = 0;
  drawOrb(orb, 25, true);
  expect(commands).toEqual(first);
  commands.length = 0; drawOrb(orb, 3, false);
  expect(commands).not.toEqual(first);
});
