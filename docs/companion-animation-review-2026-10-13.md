# Companion animation review — 2026-10-13

Reviewed the 19 non-Texting clips on all six companions at commit `1cb4a9a`.
The accepted Texting repair remains intact. This review changes no models,
animation tracks, triggers or production UI.

**Follow-up:** The remaining gesture hand angles have since been repaired with
anatomical wrist/finger transfer. Full hand rigs also receive contact-specific
spacing correction for clapping. All six receive a mesh-based contact limit,
verified at 120 Hz between baked keys; Demon uses its original wrist paths as
the reference instead of donor spacing.
The accepted Texting tracks are preserved exactly. The Angry source and kneeling
grounding issues below remain outstanding. The findings and screenshots in this
document describe the original audited state at `1cb4a9a`.

The library needs further repair. The largest issues are the wrong Angry motion,
hand orientation in gesture clips, and grounding in Kneeling Pointing.

## Confirmed findings

1. **Angry is Sitting Clap.** All six GLBs contain identical animation values for
   those two names, with the same 5.6667-second duration. The two cached FBX files
   have different container bytes but identical decoded animation tracks
   (`e6cfdc49bafeb2541035e29cfb54c4eac9e710bd79fc5497ab8a416c14ac7376`).
   Replace the Angry download with the genuine standing-angry motion before
   rebuilding; renaming a clip or changing the reaction mapping will not repair it.
2. **The original palm-frame mismatch remains outside Texting.** Source/target
   anatomical hand frames differ by roughly a quarter-turn on Fox, Angel, Robot
   and Pigtail. This is visible in Clapping and Sitting Clap: wrists cross or palms
   face forward instead of meeting. Surprised and Kneeling Pointing also warrant
   hand/finger repair. Other gestures remain recognisable, but that does not prove
   their hand retargeting is correct. Apply anatomical wrist/finger transfer,
   preserving the accepted Texting keys. Use hand-contact spacing correction for
   relevant gestures; applying Texting's paired-hand IK to every gesture would
   change waves, raised arms and pointing positions unnecessarily.
3. **Kneeling Pointing needs grounding.** Angel visibly hovers above its standing
   baseline while kneeling. The sampled mesh minimum at the midpoint is about
   0.257 m above model-space floor. Fox's tail/body extends below that baseline.
   Ground contact should follow feet/knees, not the minimum of all vertices,
   because wings, tails and clothing can extend below them. Keep jump height and
   the source's intentionally floating poses separate from this correction.
4. **Context-sensitive manual clips remain context-sensitive.** Sitting Clap has
   no chair; Falling ends on the floor. Female Dynamic Pose is the source's
   floating, forward-bent pose. Preserve the existing trigger choices: Sitting
   Clap and Falling are manual, Female Dynamic Pose is an owner-requested fidget.
5. **Demon's hand rig remains partial.** It has thumb/index chains only. Retargeting
   cannot provide independent motion to its other fingers without reskinning.

## Clip coverage

Each row covers all six characters. “Readable” describes the body gesture; it
is not approval of the unrepaired hand orientation.

| Clip | Observed body/placement | Hand review |
| --- | --- | --- |
| Sad Idle | Readable standing idle | Secondary; hands mostly at sides |
| Silly Dancing | Readable dancing movement | Wrist/fist orientation needs repair |
| Joyful Jump | Takeoff, airborne pose and landing retain vertical motion | Review raised-hand orientation |
| Female Dynamic Pose | Forward-bent floating pose matches its intended source | Secondary; preserve its intended pose |
| Sitting Clap | Seated pose without a chair | High priority: palms/crossed wrists |
| Angry | Wrong seated-clap motion | Replace source first |
| Falling | Falls toward floor; manual/context dependent | Secondary to placement/context |
| Standing Greeting | Recognisable raised-hand greeting | Wave palm orientation needs repair |
| Telling A Secret | Recognisable leaning/whisper gesture | Review hand-to-face orientation |
| Kiss | Recognisable upward/partner-directed gesture | Review hand-to-face orientation |
| Thankful | Recognisable hand-at-chest gesture | Review palm orientation |
| Kneeling Pointing | Kneeling/pointing readable; grounding varies by rig | High priority: pointing hand and palm |
| Rejected | Recognisable slumped/rejected gesture | Secondary; hands mostly lowered |
| Cheering | Recognisable raised arms/fists | Review fist orientation |
| Clapping | Recognisable arm movement; palm contact incorrect | High priority: palms/crossed wrists |
| Talking | Recognisable conversational gesture | Review open-hand orientation |
| Surprised | Recognisable hand/finger reaction | High priority: palm/finger presentation |
| Bashful | Recognisable bowed/closed posture | Secondary; hands partly hidden |
| Happy | Recognisable standing-happy motion | Review open-hand orientation |

## Validation and limits

- Sampled all 114 character/clip pairs at seven points, including both endpoints
  (798 poses). Sampled bone transforms and 256 skinned vertices per pose were
  finite; no numerical deformation failure was found.
- Rendered all 19 clips with six full-body views and six hand views. Checked
  additional early/late poses for Clapping, Kneeling Pointing, Joyful Jump and
  Surprised. Sparse pose sampling does not establish perfect contact throughout
  every animation frame.
- Exercised each of the 114 queued reactions through the actual
  `CompanionAnimator` at 30 Hz. All returned to running Texting idle with full
  weight, without a stuck reaction.
- Inspection used the local dev frontend and current GLBs, not the older
  installed desktop binary. Native widget framing still merits visual checks
  after the repairs; this gallery is an inspection view, not a framing verdict.
- No model or runtime-source changes were made. Existing dirty work is preserved.

## Local review artifacts

The interactive gallery, audit script and JSON are in the ignored local folder
`scripts/characters-src/animation-audit-2026-10-13/`. With the current dev server,
open [the clip review page](http://localhost:1420/scripts/characters-src/animation-audit-2026-10-13/gallery.html).
Select a clip, press Play, or scrub its pose slider; columns show Fox, Demon,
Mushroom, Angel, Robot and Pigtail.

Screenshots are saved locally as `/private/tmp/orion-audit-*.png`. The numerical
report is `audit.json`; regenerate it with:

```sh
node scripts/characters-src/animation-audit-2026-10-13/tools/audit.mjs
```

Repair order: genuine Angry source; anatomical hand transfer for remaining clips
with gesture-specific contact checks; kneeling grounding; native framing and
transition review. Independent Demon fingers require a separate skinning repair.
