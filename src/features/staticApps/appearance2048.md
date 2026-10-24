# Declared Orion appearance overlay

This UI explicitly opts into data-orion-appearance="v1" and the host-owned 2048 recipe. Newly opted-in UI defaults to Orion, subject to a saved host preference for this package identity. Original remains a per-app styling choice; it does not restore upstream localStorage/input or change package lifecycle.

Coverage: typography, score/control/status panels, board/cells/tile positioning, game-end overlays and notices. Existing host theme is the authority; built-in light/dark and validated custom palettes, material/reduction flags, semantic value progression and soft theme-correct radii are mapped without arbitrary CSS or new grants. Embedded source CSS/fonts and notices remain retained. Unrelated document/canvas/SVG content is not normalized. Skin compatibility/edge-state/input/visual acceptance is bounded and requires separate review.

Host theme/mode changes update in place with source/session/version-bound read-only data, not a regenerated document or game reset. Appearance preferences belong to host plugins.appearance metadata, not this package or private game storage. The owned skin can evolve independently of this immutable candidate. Local opaque material does not expose parent wallpaper.
