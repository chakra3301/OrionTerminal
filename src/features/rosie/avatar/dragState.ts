// Prevent proactive interruptions while the companion is being repositioned.
// NOT a store: drag fires at ~60Hz and must not trigger React renders.
export const dragState = {
  dragging: false,
  screenX: 0, // companion widget position, CSS pixels
  screenY: 0,
  resetVersion: 0, // bumped on discontinuities: hide/resume, summon, resize, cancel
};
