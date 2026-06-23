import { registry } from "@/commands/registry";
import { useSpotify } from "@/store/spotifyStore";

let installed = false;

/** Spotify transport as registry commands — so they surface in Spotlight
 * (track controls) AND get app-level hotkeys via HotkeyHost in one shot. Each
 * re-polls the widget after firing (the store's control()/seek() already do). */
export function installSpotifyCommands() {
  if (installed) return;
  installed = true;

  registry.register({
    id: "spotify.playPause",
    label: "Play / Pause Spotify",
    hotkey: "mod+shift+space",
    globalOnly: true,
    keywords: ["spotify", "music", "play", "pause", "resume", "now playing"],
    group: "Media",
    run: () => useSpotify.getState().control("playpause"),
  });

  registry.register({
    id: "spotify.next",
    label: "Next Track (Spotify)",
    hotkey: "mod+shift+.",
    globalOnly: true,
    keywords: ["spotify", "music", "skip", "next", "forward"],
    group: "Media",
    run: () => useSpotify.getState().control("next"),
  });

  registry.register({
    id: "spotify.previous",
    label: "Previous Track (Spotify)",
    hotkey: "mod+shift+,",
    globalOnly: true,
    keywords: ["spotify", "music", "back", "previous", "rewind"],
    group: "Media",
    run: () => useSpotify.getState().control("previous"),
  });
}
