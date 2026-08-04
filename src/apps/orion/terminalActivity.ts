let liveTerminalCount = 0;

export function beginLiveTerminal(): () => void {
  liveTerminalCount += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    liveTerminalCount = Math.max(0, liveTerminalCount - 1);
  };
}

export function hasLiveTerminals(): boolean {
  return liveTerminalCount > 0;
}
