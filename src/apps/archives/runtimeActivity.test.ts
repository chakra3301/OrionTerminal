import { afterEach, describe, expect, it } from "vitest";
import {
  archivesActivityReason,
  clearArchivesActivities,
  setArchivesActivity,
  withArchivesActivity,
} from "./runtimeActivity";

afterEach(clearArchivesActivities);

describe("Archives runtime activity", () => {
  it("tracks subscribed background work", () => {
    setArchivesActivity("repolens", true, "RepoLens is running");
    expect(archivesActivityReason()).toBe("RepoLens is running");
    setArchivesActivity("repolens", false, "");
    expect(archivesActivityReason()).toBeNull();
  });

  it("keeps concurrent async work active until every task settles", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = withArchivesActivity(
      "learn",
      "Learn is running",
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    const second = withArchivesActivity(
      "learn",
      "Learn is running",
      () => new Promise<void>((resolve) => { finishSecond = resolve; }),
    );

    expect(archivesActivityReason()).toBe("Learn is running");
    finishFirst();
    await first;
    expect(archivesActivityReason()).toBe("Learn is running");
    finishSecond();
    await second;
    expect(archivesActivityReason()).toBeNull();
  });
});
