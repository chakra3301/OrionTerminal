import { describe, it, expect } from "vitest";
import { deriveFit, firstSentence } from "./verdict";

describe("verdict", () => {
  it("strong: high health, no warns", () => {
    expect(deriveFit({ health: { score: 90 }, red_flags: [], pros: ["a"], cons: [] }).level).toBe("strong");
  });
  it("solid: 70s, one warn", () => {
    expect(
      deriveFit({ health: { score: 75 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level,
    ).toBe("solid");
  });
  it("care: 50s", () => {
    expect(
      deriveFit({ health: { score: 55 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level,
    ).toBe("care");
  });
  it("risky: low health", () => {
    expect(
      deriveFit({ health: { score: 30 }, red_flags: [{ severity: "warning" }], pros: [], cons: [] }).level,
    ).toBe("risky");
  });
  it("firstSentence", () => {
    expect(firstSentence("Hello world. Second.")).toBe("Hello world.");
  });
});
