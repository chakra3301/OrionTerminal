# Companion library

Orion's built-in companions are Fox, Demon, Mushroom, Angel, Robot, Pigtail and Rosie.
Choose one in Settings → Characters. Each GLB contains its own rig,
textures and the same 20 Mixamo clip names. Fox is the default; retired built-in selections
fall back to Fox. Saved custom uploads remain selectable.

Rosie's fitted source has no skeleton. Her runtime copy uses a local humanoid rig
and Blender heat binding, after Mixamo repeatedly returned “Unknown error while
generating motion.” Coincident UV-seam vertices are welded before reduction so
the body forms one connected mesh. The copy has 79,999 triangles (down from
1,909,852), a self-contained 2K matte atlas, zero metallic and 0.88 roughness.
The editable source Blender master, fitted GLB, shape keys and original 4K atlas
remain unchanged.

Her hands are closed glove shapes. They follow their wrists as rigid mitts, with
unweighted thumb/index landmarks used only to calibrate palm orientation; there
is no independent finger deformation. Texting uses the existing anatomical hand
transfer with a glove surface contact limit. Clapping and Sitting Clap also keep the surfaces separated and add the
donor's normalized opening stroke beyond contact, scaled to her glove size. Her
Angry clip is a fresh, verified standing motion rather than the older duplicated
Sitting Clap source. The original six assets and their accepted grips remain exact.

Prepare, bind, bake, correct and reinstall her with the local source files present:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/prepare-rosie-companion.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/rig-rosie-companion.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/build-rosie-animations.py
node scripts/repair-rosie-animations.mjs
node scripts/install-rosie-companion.mjs
```

The preparation also exports `scripts/characters-src/rosie-companion-2026-10-13/sources/rosie-static-mixamo.fbx`
for auto-rigging. It contains geometry only; the matte material stays local for restoration
after rigging. Cached donors remain in the original library; Rosie's genuine Angry
download is `rosie-companion-2026-10-13/sources/angry.fbx`. Her installer checks the
prepared, bound, baked and corrected source hashes, and preserves separately installed
companions. The local pre-correction Blender library is
`rosie-companion-2026-10-13/exports/rosie-animation-library.blend`; import the final
`public/characters/rosie-stylized.glb` for the corrected wrist keys. A packed final
copy with all 20 corrected actions and Texting selected is saved locally at
`rosie-companion-2026-10-13/exports/rosie-companion-ready.blend`.

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

Dragging repositions the widget while its normal animation keeps playing.
Fling-to-dismiss, hide, click-to-chat and long-hold chat suppression remain;
there is no ragdoll or procedural body swing. The canvas has extra drawing room
for motion clips and passes clicks outside the companion through to the app.
Authored bone rotations are restored before each mixer update so sparse clips
cannot accumulate procedural attention offsets.

Texting transfers the donor's actual palm orientation and finger bends in each
character's anatomical bind frame. The donor and target palms can differ by a
quarter-turn even when both rigs use Mixamo bone names. Arm rotations are baked
with two-bone IK to match the source wrist spacing at each character's hand size,
preserving bone lengths and the gesture's original center. The old runtime
relaxed-finger substitution is removed. These corrected tracks live in the GLBs,
so the companion, picker, clip tester and Blender imports share the same grip.
Built-in model URLs include their manifest hash so repaired files replace stale
loader-cache entries. The accepted Texting tracks are preserved exactly.

The remaining 19 clips now transfer wrist orientation and local finger bends in
the same anatomical frames. Waving exposes the palm, pointing retains its grip,
and clapping turns the palms toward each other. Clapping and Sitting Clap also
match donor wrist spacing at each full hand rig's proportions. A mesh-based contact
limit keeps the palms/fingers on their anatomical sides, using the actual skinned
hand surfaces rather than the source's thin human hands. Stable downward elbow
bends and contact keys sampled at 60 Hz prevent crossings between keys. The
currently mislabeled Angry source uses the same seated-clap contact treatment.
Other gestures keep their authored arm positions. Demon uses its authored wrist
paths as the contact reference, without donor spacing, and receives the same
surface limit. Meshes, textures, skin weights, timing and other body channels
are preserved; only the three contact clips adjust arm rotations.

Spotlight's **Companion: Test Animation Clips** command opens the existing clip tester.
It exposes all 20 clips for the selected character and resets to the first clip
when changing characters. Falling and Sitting Clap remain manual. Kneeling
Pointing and Female Dynamic Pose retain placement notes in the manifest.

The packed Blender masters, source models and downloaded motion files remain
local under the ignored `scripts/characters-src/` directory. Fox, Angel and Robot
retain their original Tripo bones and skin weights. Their finger rotation keys
now transfer bends in each hand's anatomical bind frame: the donor and target
palms differ by roughly 90 degrees, which previously curled fingers sideways
and presented the backs or edges of hands during gestures. All 20 clips now
receive anatomical hand transfer while retaining their original rigs and weights.

The correction also covers the three Mixamo rigs. Demon has only thumb and index
chains on each hand; its original download contains bones but no usable finger skin
weights. Independent motion for all five fingers would require reskinning that
character. Mushroom's original skin was malformed, and Pigtail's supplied FBX
had no skeleton.

The [dated animation audit](companion-animation-review-2026-10-13.md) records the
original issues. Hand orientation is now repaired. Its separate Angry-download
and kneeling-grounding findings on the original six remain outstanding; hand-angle corrections cannot
replace a mislabeled source motion or establish floor contact.

To regenerate the corrected library from the preserved canonical models and
cached donor FBX, then reinstall its verified runtime files:

```sh
node scripts/repair-companion-fingers.mjs
node scripts/repair-companion-texting.mjs
node scripts/repair-companion-gestures.mjs
node scripts/install-companion-library.mjs
```

The installer checks all six hashes and their mesh/skin/clip contract before
copying any model, and verifies and retains separately installed companions such as Rosie.
An optional first argument selects another library index.
The current index lives in `scripts/characters-src/companion-hand-library-2026-10-13/`.
The original Blender masters predate this correction; import the corrected GLBs
for their updated hand motion, or run the repair after rebuilding a library.
