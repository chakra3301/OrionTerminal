import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory app_state. `dataPresent` stands in for the user's vault tables —
// the recovery test asserts reset never touches it.
const mem = new Map<string, unknown>();
let dataPresent = false;

vi.mock("@/lib/db", () => ({
  getAppState: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k) : null)),
  setAppState: vi.fn(async (k: string, v: unknown) => {
    mem.set(k, v);
  }),
  deleteAppState: vi.fn(async (k: string) => {
    mem.delete(k);
  }),
  hasAnyUserData: vi.fn(async () => dataPresent),
}));

import { useAuth } from "./authStore";
import { deleteAppState } from "@/lib/db";

const reset = () => {
  mem.clear();
  dataPresent = false;
  vi.clearAllMocks();
  useAuth.setState({
    phase: "probing",
    hasAccount: false,
    username: null,
    displayName: null,
    warm: false,
    busy: false,
    error: null,
  });
};

describe("authStore gate resolution", () => {
  beforeEach(reset);

  it("empty vault, no account → first-run setup", async () => {
    await useAuth.getState().probe();
    expect(useAuth.getState().phase).toBe("first-run");
  });

  it("existing data, no account → unlocked (never forced to sign in)", async () => {
    dataPresent = true;
    await useAuth.getState().probe();
    expect(useAuth.getState().phase).toBe("unlocked");
    expect(useAuth.getState().warm).toBe(false);
  });

  it("account + valid session → warm unlock (skip splash)", async () => {
    await useAuth.getState().createAccount("luca", "hunter2", "Luca");
    // simulate relaunch
    await useAuth.getState().probe();
    expect(useAuth.getState().phase).toBe("unlocked");
    expect(useAuth.getState().warm).toBe(true);
  });

  it("account + expired session → locked", async () => {
    await useAuth.getState().createAccount("luca", "hunter2", "Luca");
    mem.set("auth.session", { token: "x", expiresAt: Date.now() - 1000 });
    await useAuth.getState().probe();
    expect(useAuth.getState().phase).toBe("locked");
  });
});

describe("authStore unlock", () => {
  beforeEach(reset);

  it("rejects a wrong password, accepts the right one", async () => {
    await useAuth.getState().createAccount("luca", "correct horse", "Luca");
    await useAuth.getState().lock();
    expect(useAuth.getState().phase).toBe("locked");

    const bad = await useAuth.getState().unlock("luca", "nope", true);
    expect(bad).toBe(false);
    expect(useAuth.getState().phase).toBe("locked");
    expect(useAuth.getState().error).toBeTruthy();

    const ok = await useAuth.getState().unlock("luca", "correct horse", true);
    expect(ok).toBe(true);
    expect(useAuth.getState().phase).toBe("unlocked");
    expect(mem.get("auth.session")).toBeTruthy();
  });

  it("respects the wrong username even with the right password", async () => {
    await useAuth.getState().createAccount("luca", "pw1234", "Luca");
    await useAuth.getState().lock();
    const bad = await useAuth.getState().unlock("someoneelse", "pw1234", true);
    expect(bad).toBe(false);
  });

  it("remember=false leaves no session behind", async () => {
    await useAuth.getState().createAccount("luca", "pw1234", "Luca");
    await useAuth.getState().lock();
    await useAuth.getState().unlock("luca", "pw1234", false);
    expect(mem.get("auth.session")).toBeUndefined();
  });
});

describe("authStore reset escape hatch (recovery)", () => {
  beforeEach(reset);

  it("wipes ONLY auth keys and reopens the vault with data intact", async () => {
    dataPresent = true; // the user has a full vault
    await useAuth.getState().createAccount("luca", "forgotten", "Luca");
    expect(mem.get("auth.user")).toBeTruthy();

    await useAuth.getState().resetAuth();

    // both auth keys gone…
    expect(mem.get("auth.user")).toBeUndefined();
    expect(mem.get("auth.session")).toBeUndefined();
    // …reset deleted exactly the two auth keys, nothing else
    expect(deleteAppState).toHaveBeenCalledWith("auth.user");
    expect(deleteAppState).toHaveBeenCalledWith("auth.session");
    expect(vi.mocked(deleteAppState).mock.calls.every(
      ([k]) => k === "auth.user" || k === "auth.session",
    )).toBe(true);
    // the vault data flag was never touched → owner lands back in, unlocked
    expect(dataPresent).toBe(true);
    expect(useAuth.getState().phase).toBe("unlocked");
    expect(useAuth.getState().hasAccount).toBe(false);
  });

  it("reset on an empty vault returns to first-run", async () => {
    await useAuth.getState().createAccount("luca", "pw1234", "Luca");
    await useAuth.getState().resetAuth();
    expect(useAuth.getState().phase).toBe("first-run");
  });
});
