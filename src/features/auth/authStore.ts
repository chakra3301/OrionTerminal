import { create } from "zustand";
import {
  getAppState,
  setAppState,
  deleteAppState,
  hasAnyUserData,
} from "@/lib/db";
import { log } from "@/lib/log";
import { deriveHash, randomSalt, randomToken, constantTimeEqual } from "./crypto";

export type AuthUser = {
  username: string;
  salt: string;
  hash: string;
  displayName: string;
  createdAt: number;
};
export type AuthSession = { token: string; expiresAt: number };

export type AuthPhase = "probing" | "unlocked" | "locked" | "first-run";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Dev-only gate bypass. Statically false in the bundled .app (import.meta.env.DEV),
 * so the real auth is never weakened to make iteration easier. Enable with
 * `localStorage.setItem('orion.authBypass','1')` or VITE_AUTH_BYPASS=1. */
export function authBypass(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    if (localStorage.getItem("orion.authBypass") === "1") return true;
  } catch {
    /* localStorage may be unavailable */
  }
  return import.meta.env.VITE_AUTH_BYPASS === "1";
}

type AuthState = {
  phase: AuthPhase;
  hasAccount: boolean;
  username: string | null;
  displayName: string | null;
  /** A valid unexpired session existed at boot → warm unlock (skip the splash). */
  warm: boolean;
  busy: boolean;
  error: string | null;

  /** Resolve the gate from app_state. Fails OPEN on any error — a gate bug
   * must never lock the owner out of their own vault. */
  probe: () => Promise<void>;
  unlock: (
    username: string,
    password: string,
    remember: boolean,
  ) => Promise<boolean>;
  createAccount: (
    username: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  /** Change the password (verifies the current one first). Keeps username +
   * display name; rotates salt + session. */
  changePassword: (current: string, next: string) => Promise<boolean>;
  /** Sign out: drop the session and return to the locked screen. */
  lock: () => Promise<void>;
  /** Escape hatch: wipe ONLY auth.user + auth.session, never user data. */
  resetAuth: () => Promise<void>;
  clearError: () => void;
};

export const useAuth = create<AuthState>((set) => ({
  phase: "probing",
  hasAccount: false,
  username: null,
  displayName: null,
  warm: false,
  busy: false,
  error: null,

  probe: async () => {
    if (authBypass()) {
      set({ phase: "unlocked", warm: true, hasAccount: false });
      return;
    }
    try {
      const user = await getAppState<AuthUser>("auth.user");
      if (!user) {
        // No account. Existing data ⇒ stay unlocked (opt-in via Settings);
        // a truly empty vault ⇒ first-run setup.
        const hasData = await hasAnyUserData();
        set({
          phase: hasData ? "unlocked" : "first-run",
          hasAccount: false,
          warm: false,
          username: null,
          displayName: null,
        });
        return;
      }
      const session = await getAppState<AuthSession>("auth.session");
      const valid = !!session && session.expiresAt > Date.now();
      set({
        phase: valid ? "unlocked" : "locked",
        hasAccount: true,
        warm: valid,
        username: user.username,
        displayName: user.displayName,
      });
    } catch (e) {
      // Fail OPEN — never trap the owner behind a broken gate.
      log.error("auth probe failed — failing open to the vault", e);
      set({ phase: "unlocked", warm: false, hasAccount: false });
    }
  },

  unlock: async (username, password, remember) => {
    set({ busy: true, error: null });
    try {
      const user = await getAppState<AuthUser>("auth.user");
      if (!user) {
        // Account vanished out from under us — nothing to verify against.
        set({ phase: "unlocked", busy: false });
        return true;
      }
      const hash = await deriveHash(password, user.salt);
      const ok =
        username.trim() === user.username && constantTimeEqual(hash, user.hash);
      if (!ok) {
        set({ busy: false, error: "Incorrect username or password." });
        return false;
      }
      if (remember) {
        await setAppState("auth.session", {
          token: randomToken(),
          expiresAt: Date.now() + SESSION_MS,
        });
      } else {
        await deleteAppState("auth.session");
      }
      set({ phase: "unlocked", busy: false, error: null });
      return true;
    } catch (e) {
      log.error("unlock failed", e);
      set({
        busy: false,
        error: "Couldn't unlock. If you're stuck, use Reset below.",
      });
      return false;
    }
  },

  createAccount: async (username, password, displayName) => {
    set({ busy: true, error: null });
    try {
      const salt = randomSalt();
      const hash = await deriveHash(password, salt);
      const uname = username.trim();
      const user: AuthUser = {
        username: uname,
        salt,
        hash,
        displayName: displayName.trim() || uname,
        createdAt: Date.now(),
      };
      await setAppState("auth.user", user);
      await setAppState("auth.session", {
        token: randomToken(),
        expiresAt: Date.now() + SESSION_MS,
      });
      set({
        phase: "unlocked",
        hasAccount: true,
        warm: true,
        username: user.username,
        displayName: user.displayName,
        busy: false,
        error: null,
      });
    } catch (e) {
      log.error("createAccount failed", e);
      set({ busy: false, error: "Couldn't create the account." });
      throw e;
    }
  },

  changePassword: async (current, next) => {
    set({ busy: true, error: null });
    try {
      const user = await getAppState<AuthUser>("auth.user");
      if (!user) {
        set({ busy: false, error: "No account to update." });
        return false;
      }
      const curHash = await deriveHash(current, user.salt);
      if (!constantTimeEqual(curHash, user.hash)) {
        set({ busy: false, error: "Current password is incorrect." });
        return false;
      }
      const salt = randomSalt();
      const hash = await deriveHash(next, salt);
      await setAppState("auth.user", { ...user, salt, hash });
      await setAppState("auth.session", {
        token: randomToken(),
        expiresAt: Date.now() + SESSION_MS,
      });
      set({ busy: false, error: null });
      return true;
    } catch (e) {
      log.error("changePassword failed", e);
      set({ busy: false, error: "Couldn't change the password." });
      return false;
    }
  },

  lock: async () => {
    await deleteAppState("auth.session");
    const user = await getAppState<AuthUser>("auth.user");
    if (user) {
      set({
        phase: "locked",
        warm: false,
        username: user.username,
        displayName: user.displayName,
      });
    }
  },

  resetAuth: async () => {
    await deleteAppState("auth.user");
    await deleteAppState("auth.session");
    const hasData = await hasAnyUserData();
    set({
      phase: hasData ? "unlocked" : "first-run",
      hasAccount: false,
      warm: false,
      username: null,
      displayName: null,
      busy: false,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
