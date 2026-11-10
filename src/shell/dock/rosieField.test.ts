import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { orbModel, particlePhysics } from "./orbModel";
import { drawRosieField } from "./rosieField";
import type { OrbCanvas } from "./orbCanvas";

function fixture() {
  const paints: unknown[][] = [], properties: Record<PropertyKey, unknown> = {
    globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
  };
  let path: unknown[][] = [];
  const context = new Proxy({}, {
    get: (_, key) => properties[key] ?? ((...args: unknown[]) => {
      if (String(key).startsWith("create")) {
        const gradient = { type: key, args, stops: [] as unknown[][], addColorStop(...stop: unknown[]) { this.stops.push(stop); } };
        return gradient;
      }
      if (key === "beginPath") path = [];
      else if (key === "moveTo" || key === "lineTo") path.push([key, ...args]);
      else if (key === "stroke") paints.push([key, [...path], properties.strokeStyle, properties.lineWidth, properties.lineCap, properties.lineJoin, properties.globalAlpha, properties.globalCompositeOperation]);
      else if (key === "fillRect") paints.push([key, args, properties.fillStyle, properties.globalAlpha, properties.globalCompositeOperation]);
    }),
    set: (_, key, value) => { properties[key] = value; return true; },
  }) as CanvasRenderingContext2D;
  const model = orbModel();
  const orb: OrbCanvas = {
    x: context, P: 240, R: 62.5, q: 2.5, color: "#00e0ff", coreColor: "#9ff6ff", model,
    nodeXY: new Float32Array(model.nodes.pts.length * 3), m: null, last: null,
    st: { shell: particlePhysics(model.shell), nodes: particlePhysics(model.nodes), spikes: particlePhysics(model.spikes), core: particlePhysics(model.core) },
  };
  return { orb, paints };
}

it("preserves the original dock orb's complete paint output", () => {
  const { orb, paints } = fixture();
  drawRosieField(orb, 2.7, false);
  // Captured independently from the original renderer at 45f1b14.
  expect(createHash("sha256").update(JSON.stringify(paints)).digest("hex")).toBe("5bfdcc95204424675ffaf2f073077d0e86e921aa0f8478930ed120be04113764");
});

it("keeps every original particle and link when inserting a spatial interior", () => {
  const original = fixture(), layered = fixture();
  drawRosieField(original.orb, 2.7, false);
  let behind = 0;
  drawRosieField(layered.orb, 2.7, false, () => { behind = layered.paints.length; });
  expect(behind).toBeGreaterThan(320);
  expect(layered.paints.length - behind).toBeGreaterThan(100);
  expect(layered.paints.map((p) => JSON.stringify(p)).sort()).toEqual(original.paints.map((p) => JSON.stringify(p)).sort());
  expect(layered.orb.st).toEqual(original.orb.st);
});
