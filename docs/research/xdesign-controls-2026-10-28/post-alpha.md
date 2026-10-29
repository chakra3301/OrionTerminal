# XDesign controls parity — deferred to after the alpha

What the controls-parity work (plan `docs/superpowers/plans/2026-10-28-xdesign-controls-parity.md`) left open, from the build ledgers. Low-impact rows were out of scope by the plan's impact rule; the engine gaps need photocraft changes.

## Engine gaps (need photocraft)
- Mixer Brush textured loads (Load Solid Colors Only off): the mixer reservoir is one RGBA colour, so every load behaves as solid.
- Mixer Brush ignores Paint Symmetry (the engine's mixer has no symmetry); its bar shows no symmetry control.
- Gradient Fill layers: the Method isn't stored on the fill, opacity stops take no midpoints, and picking a gradient preset on a fill layer clears its colour midpoints. The Gradient tool's live gradient layers start without the current gradient's colour midpoints.
- Rounded Triangle/Polygon and arrowhead Lines are stored as path shapes: the first re-edit needs the full geometry, and `shape.info` reports them as paths.
- Shape Pattern strokes are partial on shapes rendered through the split fill/stroke path.

## Host gaps the UI reflects
- Levels/Curves eyedroppers are off on CMYK images (no ink targets defined).
- Mask and channel planes are labelled "Gray" and have no Show Clipping. Show Clipping is also off in Lab and CMYK.
- Pattern fields have no thumbnails.
- A reload forgets which image a Clone Source slot was set in.
- Pixels mode (shape tools) can't paint masks or channels.
- Select and Mask Brush: no Sample All Layers (the host ignores it).
- Paint Symmetry: no on-canvas guide, so the centre, angle and size of a preset can't be set from the UI.

## Adjustments
- Legacy Brightness ±100 (only an unverified report; XDesign uses ±150).
- Double-click eyedropper target pickers; Exposure eyedroppers in Properties.
- Color Lookup: .csp, Abstract/Device Link tabs, Data Order/Table Order.
- Gradient Map Noise/Smoothness.
- Shadows/Highlights Load/Save/Save Defaults; HDR Toning presets, Load/Save, Edge Smoothness and Toning Curve corner points.
- Match Color Load/Save Statistics.
- Equalize's two selection options.
- Auto Tone/Contrast/Color menu commands ignore the saved Auto defaults.

## Paint, brush and retouch
- Patch Transparent and Use Pattern; Pattern Stamp scale; Use Sample Size; Clone Source aspect link and panel button on Healing; Alt+Shift overlay move.
- Brush rename; picker Create New Brush icon; per-control Control pop-ups; Clear Brush Controls; angle/roundness drag box; stroke preview strip; presets that include tool settings/colour; Convert All to Brush Presets.
- Tool preset flyout extras: Sort by Tool, Include Color, Rename, Reset Tool / Reset All Tools.
- Mixer Airbrush; Background Eraser pen-size menu; Blur/Sharpen/Smudge Mode lists; Impressionist.
- Gradient Noise type, Smoothness, GRD/ABR export, Replace Gradients, on-canvas colour HUD.
- New brush engines: Bristle, Erodible and Airbrush tips.

## Shapes, paths and type
- Path arrangement, Gear Thickness/Color, Align Edges, Constrain Path Dragging, Smooth Star Indents.
- Distribute in path alignment, Save/Load stroke presets, per-component path selection, Curvature Pen Auto Add/Delete, Make Selection dialog.

## Selection and transform
- Select and Mask: Marching Ants / Onion Skin views, Show Edge, Show Original, High Quality Preview, view settings, Output to New Document, Presets, Clear Selection, the Object Selection / Lasso / Hand / Zoom tools inside it.
- Object Finder, Refine Mode Object Aware, Refine Hair (out of scope: AI).
- Free Transform: Relative positioning, Bicubic Smoother/Sharper/Automatic, Alt-scale about a custom reference point.
- Quick Selection brush picker (Hardness, Spacing, Angle, Roundness, pressure).
- Marquee Swap W/H.

## From the final review (minor)
- Clone Source set in another image: loading that image holds the host's sessions lock, and an evicted source is reloaded on every live step.
- Gradient midpoints aren't saved when there is no profile directory, and the command still reports success.
- A corrupt `brush-groups.json` is overwritten on the next group change; group names aren't trimmed on rename or delete.
- The shape tools' bar sets the layer style before `shape.edit` succeeds, so a failed edit leaves the new style.
- Patch with Content-Aware can read a context box past 16 MP on huge selections (the job stays cancellable).
- Match Color and Replace Color add a History step on an empty layer.
- Free Transform bar Cancel, and the Symmetry and brush-bar menu items, stay enabled while a job runs.
- The gradient stops overlay doesn't handle a lost pointer capture; healing modes aren't greyed out on masks.
