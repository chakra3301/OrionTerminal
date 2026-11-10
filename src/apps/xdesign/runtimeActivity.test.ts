import { afterEach, describe, expect, it } from "vitest";
import {
  beginXDesignActivity,
  clearXDesignActivities,
  trackXDesignActivity,
  xdesignActivityReason,
  xdesignProjectChangeReason,
} from "./runtimeActivity";

afterEach(clearXDesignActivities);

describe("XDesign runtime activity", () => {
  it("keeps a reason active until every concurrent operation ends", () => {
    const endFirst = beginXDesignActivity("images", "Images are generating.");
    const endSecond = beginXDesignActivity("images", "Images are generating.");
    expect(xdesignActivityReason()).toBe("Images are generating.");
    endFirst();
    expect(xdesignActivityReason()).toBe("Images are generating.");
    endSecond();
    expect(xdesignActivityReason()).toBeNull();
  });

  it("clears tracked work after rejection", async () => {
    await expect(
      trackXDesignActivity("export", "Exporting.", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(xdesignActivityReason()).toBeNull();
  });
  it("prevents project changes until a library operation finishes",()=>{
    const end=beginXDesignActivity("component-library","Wait for library publishing before switching projects.");
    expect(xdesignProjectChangeReason()).toContain("library publishing");end();expect(xdesignProjectChangeReason()).toBeNull();
  });
});
