const draws = new Set<(now: number) => void>();
let frame = 0;

function tick(now: number) {
  frame = 0;
  for (const draw of [...draws]) if (draws.has(draw)) draw(now);
  if (draws.size && !frame) frame = requestAnimationFrame(tick);
}

export function subscribeOrb(draw: (now: number) => void): () => void {
  draws.add(draw);
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    draws.delete(draw);
    if (!draws.size) { cancelAnimationFrame(frame); frame = 0; }
  };
}
