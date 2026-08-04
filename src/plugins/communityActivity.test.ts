import { afterEach, describe, expect, it } from "vitest";
import {
  beginCommunityPluginCall,
  communityPluginDisableReason,
  resetCommunityActivity,
} from "@/plugins/communityActivity";

afterEach(resetCommunityActivity);

describe("community plugin activity leases", () => {
  it("blocks disable until every privileged request finishes", () => {
    const first = beginCommunityPluginCall("dev.orion.hello");
    const second = beginCommunityPluginCall("dev.orion.hello");
    expect(communityPluginDisableReason("dev.orion.hello")).toContain("2 privileged plugin requests");
    first();
    expect(communityPluginDisableReason("dev.orion.hello")).toContain("1 privileged plugin request");
    second();
    expect(communityPluginDisableReason("dev.orion.hello")).toBeNull();
  });
});
