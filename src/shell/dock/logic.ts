const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=/<>{}[]_";

export function decodeName(name: string, elapsed: number, reduced = false, random = Math.random): string {
  if (reduced) return name;
  return Array.from(name, (ch, i) => ch === " " || elapsed >= 90 + i * 30 ? ch : CODE[Math.floor(random() * CODE.length)]!).join("");
}

export function dockLabel(name: string, shortcut?: string): string {
  return shortcut ? `${name} (${shortcut})` : name;
}

export function dockApps<T extends { dock: { hidden?: boolean } }>(apps: readonly T[]): T[] {
  return apps.filter((app) => !app.dock.hidden);
}

export function fixedDockAccent(accent: string): string {
  return accent.replace(/^var\(--neon-(green|cyan|yellow|magenta|violet)\)$/, "var(--dock-$1)");
}

export function magnifyScale(distance: number, peak = 1.55): number {
  if (distance >= 110) return 1;
  return 1 + (peak - 1) * (1 - Math.cos((1 - distance / 110) * Math.PI)) / 2;
}

export function pickLifted(items: readonly { id: string; center: number; width: number }[], cursorX: number | null): string | null {
  let lifted: string | null = null, best = Infinity;
  if (cursorX == null) return lifted;
  for (const item of items) {
    const distance = Math.abs(cursorX - item.center);
    if (distance < best && distance < item.width / 2 + 5) {
      lifted = item.id;
      best = distance;
    }
  }
  return lifted;
}
