import { create } from "zustand";
import { ipc, type SpotifyNowPlaying } from "@/lib/ipc";
import { toast } from "@/store/toastStore";

type SpotifyState = {
  now: SpotifyNowPlaying | null;
  /** Authoritative "is Spotify linked" — keychain-backed, network-free. */
  connected: boolean;
  /** Whether a poll has ever completed (gates the widget's first paint). */
  loaded: boolean;
  connecting: boolean;
  /** Last connect error, surfaced inline in the connect form. */
  error: string | null;
  refreshStatus: () => Promise<void>;
  poll: () => Promise<void>;
  connect: (clientId: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  control: (action: "playpause" | "next" | "previous") => Promise<void>;
  seek: (positionS: number) => Promise<void>;
};

export const useSpotify = create<SpotifyState>((set, get) => ({
  now: null,
  connected: false,
  loaded: false,
  connecting: false,
  error: null,
  refreshStatus: async () => {
    try {
      const { connected } = await ipc.spotifyStatus();
      set({ connected, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  poll: async () => {
    try {
      const now = await ipc.spotifyNowPlaying();
      set({ now, connected: now.connected, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  connect: async (clientId) => {
    set({ connecting: true, error: null });
    try {
      const { connected } = await ipc.spotifyConnect(clientId);
      if (connected) {
        set({ connected: true });
        toast.success("Spotify linked");
        await get().poll();
      } else {
        set({ error: "Spotify did not confirm the link. Please try again." });
      }
      return connected;
    } catch (e) {
      set({ error: String(e) });
      return false;
    } finally {
      set({ connecting: false });
    }
  },
  disconnect: async () => {
    try {
      await ipc.spotifyDisconnect();
    } catch {
      /* ignore */
    }
    set({ now: null, connected: false });
  },
  control: async (action) => {
    try {
      await ipc.spotifyControl(action);
    } catch (e) {
      toast.error("Spotify", { body: String(e) });
    }
    setTimeout(() => void get().poll(), 250);
  },
  seek: async (positionS) => {
    try {
      await ipc.spotifySeek(positionS);
    } catch (e) {
      toast.error("Spotify", { body: String(e) });
    }
    setTimeout(() => void get().poll(), 200);
  },
}));
