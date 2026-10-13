# Companion library

Orion's built-in companions are Fox, Demon, Mushroom, Angel, Robot and Pigtail.
Choose one in Settings → Characters. Each GLB contains its own rig, textures
and the same 20 Mixamo clips. Fox is the default; retired built-in selections
fall back to Fox. Saved custom uploads remain selectable.

The runtime contract is `public/characters/manifest.json`: stable character IDs,
model URLs, SHA-256 hashes, rig details, clip names, durations and placement notes.
These files need no runtime retargeting or external texture requests.

| Trigger | Animation |
| --- | --- |
| Resting | Sad Idle, looping |
| Picker selection / summon after dismissal | Standing Greeting, once |
| R.O.S.I.E error | Angry, once |
| Proactive question | Talking, once |
| Occasional idle fidget | Happy, Bashful, Thankful or Cheering, once |

Reactions crossfade back to Sad Idle. Each preview and companion owns an
independent skeleton and mixer, so opening the picker cannot change the floating
companion's pose. Horizontal root travel is anchored in model space; vertical
motion is retained. Hidden companions pause rendering and playback.

Spotlight's **Companion: Test Animation Clips** command opens the existing clip tester.
It exposes all 20 clips for the selected character and resets to the first clip
when changing characters. Falling, Sitting Clap, Kneeling Pointing and Female
Dynamic Pose have placement notes in the manifest and are not automatic fidgets.

The packed Blender masters, source models and downloaded motion files remain
local under the ignored `scripts/characters-src/` directory. To reinstall the
verified runtime files from those local masters:

```sh
node scripts/install-companion-library.mjs
```

The installer checks all six hashes and their mesh/skin/clip contract before
copying any model. An optional first argument selects another library index.
