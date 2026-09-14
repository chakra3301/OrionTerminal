import { describe, expect, it, vi } from "vitest";
import { createQuitCoordinator } from "./quitCoordinator";
const id = "01M2BEKZ9HN58B3845N5FDJWS5";
function setup() {
  const thaw = vi.fn();
  const deps = { risks: vi.fn((): string[] => []), confirm: vi.fn(async () => false), decide: vi.fn(async () => {}), freeze: vi.fn(() => thaw), report: vi.fn() };
  return { deps, thaw, coordinator: createQuitCoordinator(deps) };
}
describe("quit handshake", () => {
  it("freezes input then allows a clean quit without a discard dialog", async () => {
    const { deps, coordinator, thaw } = setup(); await coordinator.request(id);
    expect(deps.freeze).toHaveBeenCalledOnce(); expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.decide).toHaveBeenCalledWith(id, true); expect(thaw).not.toHaveBeenCalled();
    await coordinator.request("01M2BEKZ9HN58B3845N5FDJWS6"); expect(deps.decide).toHaveBeenCalledOnce();
    coordinator.dispose(); expect(thaw).toHaveBeenCalledOnce();
  });
  it("keeps working when the user cancels and ignores duplicate event/query delivery", async () => {
    const { deps, coordinator, thaw } = setup(); deps.risks.mockReturnValue(["Unsaved note"]);
    await coordinator.request(id); await coordinator.request(id);
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(["Unsaved note"]);
    expect(deps.decide).toHaveBeenCalledExactlyOnceWith(id, false); expect(thaw).toHaveBeenCalledOnce();
    await coordinator.request("01M2BEKZ9HN58B3845N5FDJWS6"); expect(deps.confirm).toHaveBeenCalledTimes(2);
  });
  it("requires explicit confirmation for dirty work and coalesces repeated quit keys", async () => {
    const { deps, coordinator } = setup(); let accept!: (value: boolean) => void;
    deps.risks.mockReturnValue(["Unsaved file"]); deps.confirm.mockImplementation(() => new Promise((r) => { accept = r; }));
    const request = coordinator.request(id); await Promise.resolve();
    await coordinator.request(id); expect(deps.confirm).toHaveBeenCalledOnce(); expect(deps.decide).not.toHaveBeenCalled();
    accept(true); await request; expect(deps.decide).toHaveBeenCalledWith(id, true);
  });
  it("reads newly staged work after input has frozen", async () => {
    const { deps, coordinator } = setup(); const request = coordinator.request(id);
    deps.risks.mockReturnValue(["Just staged note"]); await request;
    expect(deps.confirm).toHaveBeenCalledWith(["Just staged note"]); expect(deps.decide).toHaveBeenCalledWith(id, false);
  });
  it("fails closed on assessment/dialog failure and releases input", async () => {
    const { deps, coordinator, thaw } = setup(); deps.risks.mockImplementation(() => { throw new Error("assessment failed"); });
    await coordinator.request(id); expect(deps.decide).toHaveBeenCalledWith(id, false); expect(deps.report).toHaveBeenCalledOnce(); expect(thaw).toHaveBeenCalledOnce();
  });
  it("never approves a disposed handler's late confirmation and thaws exactly once", async () => {
    const { deps, coordinator, thaw } = setup(); let accept!: (v: boolean) => void;
    deps.risks.mockReturnValue(["draft"]); deps.confirm.mockImplementation(() => new Promise((r) => { accept = r; }));
    const request = coordinator.request(id); await Promise.resolve(); coordinator.dispose();
    expect(thaw).toHaveBeenCalledOnce(); accept(true); await request;
    expect(deps.decide).not.toHaveBeenCalled(); expect(thaw).toHaveBeenCalledOnce();
  });
  it("rejects malformed event identities", async () => {
    const { deps, coordinator } = setup(); await coordinator.request(null); await coordinator.request("bad"); expect(deps.freeze).not.toHaveBeenCalled();
  });
});
