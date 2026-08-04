import { afterEach, describe, expect, it } from "vitest";
import {
  beginOrionActivity,
  clearOrionActivities,
  orionActivityReason,
  trackOrionActivity,
} from "./runtimeActivity";

afterEach(clearOrionActivities);

describe("Orion runtime activity", () => {
  it("reference-counts overlapping work and makes cleanup idempotent", () => {
    const endFirst = beginOrionActivity("git", "Git is running.");
    const endSecond = beginOrionActivity("git", "Git is running.");
    expect(orionActivityReason()).toBe("Git is running.");
    endFirst();
    endFirst();
    expect(orionActivityReason()).toBe("Git is running.");
    endSecond();
    expect(orionActivityReason()).toBeNull();
  });

  it("clears tracked work after rejection", async () => {
    await expect(
      trackOrionActivity("save", "Saving.", async () => {
        throw new Error("disk unavailable");
      }),
    ).rejects.toThrow("disk unavailable");
    expect(orionActivityReason()).toBeNull();
  });
});
