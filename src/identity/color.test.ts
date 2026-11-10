import { expect, it } from "vitest";
import { identityAccent, skillAccent } from "./color";
import { STARTER_SKILLS } from "@/features/agents/seedData";

it("gives starter skills distinct colours while preserving explicit custom accents", () => {
  const colors = STARTER_SKILLS.map((s) => skillAccent(s.id, s.accent));
  expect(new Set(colors).size).toBe(6);
  expect(skillAccent("builtin:web-research", "#ff8352")).toBe("#ff8352");
  expect(skillAccent("custom:example", "#00e0ff")).toBe("#00e0ff");
});

it("generates stable usable colour values for new Unicode and untrusted IDs", () => {
  const ids = ["skill:custom:café", "skill:custom:cafe\u0301", "app:<script>", "app:unknown", "skill:unknown"];
  const colors = ids.map(identityAccent);
  expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  expect(colors[0]).toBe(colors[1]);
  expect(identityAccent(ids[2]!)).toBe(colors[2]);
  expect(colors[3]).not.toBe(colors[4]);
  expect(skillAccent("imported:stable", "")).toBe(identityAccent("skill:imported:stable"));
});
