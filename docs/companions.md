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
| Resting | Texting While Standing, looping |
| Picker selection / summon after dismissal | Standing Greeting, once |
| R.O.S.I.E error | Angry followed by Rejected, once each |
| Request starts | Kneeling Pointing, once |
| Request completes successfully | Clapping, once |
| Request refused | Rejected, once |
| Completed response asks for input | Surprised, once |
| Proactive question | Talking, once |
| Occasional idle fidget | Sad Idle, Happy, Bashful, Thankful, Cheering, Silly Dancing, Joyful Jump or Female Dynamic Pose |

Reactions crossfade back to Texting While Standing. Each preview and companion owns an
independent skeleton and mixer, so opening the picker cannot change the floating
companion's pose. Horizontal root travel is anchored in model space; vertical
motion is retained. Hidden companions pause rendering and playback. Fidgets begin
after 75 seconds of visible playback, then recur every 2–5 minutes while idle.

Grabbing the character picks a body joint from the clicked mesh's skin weights.
That surface point stays fixed under the cursor while gravity and damped,
bounded joints make the body and limbs hang around it. Authored animation pauses
during the hold, then resumes as the joints settle on release. The canvas has
extra drawing room and passes clicks outside the companion through to the app.
Bone offsets are restored before each mixer update so sparse clips cannot
accumulate head or spine rotations.

Spotlight's **Companion: Test Animation Clips** command opens the existing clip tester.
It exposes all 20 clips for the selected character and resets to the first clip
when changing characters. Falling and Sitting Clap remain manual. Kneeling
Pointing and Female Dynamic Pose retain placement notes in the manifest.

The packed Blender masters, source models and downloaded motion files remain
local under the ignored `scripts/characters-src/` directory. Fox, Angel and Robot
retain their original Tripo bones and skin weights. Their finger rotation keys
now transfer bends in each hand's anatomical bind frame: the donor and target
palms differ by roughly 90 degrees, which previously curled fingers sideways,
especially during Texting. All 20 clips receive the correction; mesh, skin,
textures, body motion and animation timing stay unchanged.

The three Mixamo rigs are unchanged. Demon has only thumb and index chains on
each hand; its original download contains bones but no usable finger skin
weights. Independent motion for all five fingers would require reskinning that
character. Mushroom's original skin was malformed, and Pigtail's supplied FBX
had no skeleton.

To regenerate the corrected library from the preserved canonical models and
cached donor FBX, then reinstall its verified runtime files:

```sh
node scripts/repair-companion-fingers.mjs
node scripts/install-companion-library.mjs
```

The installer checks all six hashes and their mesh/skin/clip contract before
copying any model. An optional first argument selects another library index.
The corrected index lives in `scripts/characters-src/companion-finger-repair-2026-10-12/`.
The original Blender masters predate this correction; import the corrected GLBs
for their updated hand motion, or run the repair after rebuilding a library.
