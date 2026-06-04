// Shared high-frequency drag signal: written by CompanionAvatar's drag handlers,
// read by the 3D rig inside useFrame. A plain mutable singleton, deliberately
// NOT a store — drag fires at ~60Hz and we don't want to trigger React renders.
export const dragState = {
  dragging: false,
  vx: 0, // current drag velocity, screen px/ms (+x = right)
  vy: 0, // +y = down
};
