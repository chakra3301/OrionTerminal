import { describe, expect, it } from "vitest";
import { designTurnModel, STRONGEST_DESIGN_MODEL } from "./designModel";
import { MODELS } from "@/lib/models";

describe("designTurnModel", () => {
  it("upgrades a weaker built-in Claude to the strongest", () => {
    const weaker = MODELS.find((m) => m.id !== STRONGEST_DESIGN_MODEL)!;
    expect(designTurnModel(weaker.id)).toBe(STRONGEST_DESIGN_MODEL);
  });

  it("leaves the strongest model unchanged (no-op)", () => {
    expect(designTurnModel(STRONGEST_DESIGN_MODEL)).toBe(STRONGEST_DESIGN_MODEL);
  });

  it("passes agents through untouched", () => {
    expect(designTurnModel("agent:abc123")).toBe("agent:abc123");
  });

  it("passes non-builtin provider model ids through untouched", () => {
    expect(designTurnModel("gpt-5.2")).toBe("gpt-5.2");
    expect(designTurnModel("gemini-3-pro")).toBe("gemini-3-pro");
  });

  it("STRONGEST_DESIGN_MODEL is a real built-in Claude id", () => {
    expect(MODELS.some((m) => m.id === STRONGEST_DESIGN_MODEL)).toBe(true);
  });
});
