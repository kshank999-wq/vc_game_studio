/**
 * Where the studio's windows go across monitors. Pure geometry, so it can be
 * tested without Electron: the main window (the spine) on the middle monitor,
 * the Game Bible on the monitor to its left, other views to its right.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Display {
  id: number;
  workArea: Rect;
}

export type Side = 'left' | 'right';

const byPosition = (displays: Display[]) => [...displays].sort((a, b) => a.workArea.x - b.workArea.x || a.workArea.y - b.workArea.y);

/** The monitor in the middle: with three or more, the middle one from left to right; with one or two, the primary. */
export const centreDisplay = (displays: Display[], primaryId: number): Display => {
  const sorted = byPosition(displays);
  if (sorted.length >= 3) return sorted[Math.floor((sorted.length - 1) / 2)]!;
  return sorted.find((d) => d.id === primaryId) ?? sorted[0]!;
};

/** The monitor beside `fromId` on that side, else on the other side; null with one monitor. */
export const sideDisplay = (displays: Display[], fromId: number, side: Side): Display | null => {
  const sorted = byPosition(displays);
  const at = sorted.findIndex((d) => d.id === fromId);
  if (at < 0 || sorted.length < 2) return null;
  const want = sorted[side === 'left' ? at - 1 : at + 1];
  return want ?? sorted[side === 'left' ? at + 1 : at - 1] ?? null;
};

/** Split an area into equal columns. */
export const columns = (area: Rect, count: number): Rect[] => {
  const width = Math.floor(area.width / count);
  return Array.from({ length: count }, (_, i) => ({ x: area.x + i * width, y: area.y, width: i === count - 1 ? area.width - i * width : width, height: area.height }));
};

/** How much of a rectangle lies on some monitor (0 to 1): saved bounds are reused only if it is mostly on screen. */
export const onScreen = (rect: Rect, displays: Display[]): number => {
  const area = rect.width * rect.height;
  if (area <= 0) return 0;
  let covered = 0;
  for (const { workArea: d } of displays) {
    const w = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x);
    const h = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y);
    if (w > 0 && h > 0) covered += w * h;
  }
  return covered / area;
};

/** A new window's place on one monitor: the right part of it, stepped for each window already open. */
export const beside = (area: Rect, index: number): Rect => {
  const width = Math.round(area.width * 0.45);
  const step = 28 * index;
  return { x: area.x + area.width - width - step, y: area.y + step, width, height: area.height - step };
};

/**
 * Everything in its place: the main window fills the middle monitor; each
 * other window takes the monitor on its side (sharing it in columns when
 * several go the same way). With one monitor, the main window keeps the left
 * of the screen and the others share the right.
 */
export const arrange = (displays: Display[], primaryId: number, panels: { key: string; side: Side }[]): { main: Rect; panels: Record<string, Rect> } => {
  const centre = centreDisplay(displays, primaryId);
  const out: Record<string, Rect> = {};
  if (displays.length < 2 || panels.length === 0) {
    if (!panels.length) return { main: centre.workArea, panels: out };
    const a = centre.workArea;
    const mainWidth = Math.round(a.width * 0.6);
    const rest: Rect = { x: a.x + mainWidth, y: a.y, width: a.width - mainWidth, height: a.height };
    const stacked = panels.map((_, i) => ({ x: rest.x, y: rest.y + Math.floor((rest.height / panels.length) * i), width: rest.width, height: Math.floor(rest.height / panels.length) }));
    panels.forEach((p, i) => (out[p.key] = stacked[i]!));
    return { main: { ...a, width: mainWidth }, panels: out };
  }
  const groups = new Map<number, { display: Display; keys: string[] }>();
  for (const p of panels) {
    const d = sideDisplay(displays, centre.id, p.side)!;
    const g = groups.get(d.id) ?? { display: d, keys: [] };
    g.keys.push(p.key);
    groups.set(d.id, g);
  }
  for (const { display, keys } of groups.values()) columns(display.workArea, keys.length).forEach((r, i) => (out[keys[i]!] = r));
  return { main: centre.workArea, panels: out };
};
