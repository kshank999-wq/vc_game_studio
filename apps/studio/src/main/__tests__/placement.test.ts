import { describe, expect, it } from 'vitest';
import { arrange, beside, centreDisplay, onScreen, sideDisplay, type Display } from '../placement';

const screen = (id: number, x: number, width = 1920, height = 1080): Display => ({ id, workArea: { x, y: 0, width, height } });
const three = [screen(2, 1920), screen(1, 0), screen(3, 3840)];

describe('window placement', () => {
  it('puts the spine on the middle of three monitors, or the primary of two', () => {
    expect(centreDisplay(three, 1).id).toBe(2);
    expect(centreDisplay([screen(1, 0), screen(2, 1920)], 2).id).toBe(2);
    expect(centreDisplay([screen(1, 0)], 1).id).toBe(1);
  });

  it('finds the monitor to each side, or the other side when there is none', () => {
    expect(sideDisplay(three, 2, 'left')!.id).toBe(1);
    expect(sideDisplay(three, 2, 'right')!.id).toBe(3);
    expect(sideDisplay([screen(1, 0), screen(2, 1920)], 1, 'left')!.id).toBe(2);
    expect(sideDisplay([screen(1, 0)], 1, 'right')).toBeNull();
  });

  it('arranges the Bible left and the other views right, sharing a monitor in columns', () => {
    const layout = arrange(three, 1, [
      { key: 'bible', side: 'left' },
      { key: 'engine', side: 'right' },
      { key: 'scene', side: 'right' },
    ]);
    expect(layout.main.x).toBe(1920);
    expect(layout.panels['bible']).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(layout.panels['engine']).toEqual({ x: 3840, y: 0, width: 960, height: 1080 });
    expect(layout.panels['scene']).toEqual({ x: 4800, y: 0, width: 960, height: 1080 });
  });

  it('shares one monitor: the spine on the left, the others stacked on the right', () => {
    const layout = arrange([screen(1, 0)], 1, [{ key: 'bible', side: 'left' }, { key: 'engine', side: 'right' }]);
    expect(layout.main).toEqual({ x: 0, y: 0, width: 1152, height: 1080 });
    expect(layout.panels['bible']).toEqual({ x: 1152, y: 0, width: 768, height: 540 });
    expect(layout.panels['engine']!.y).toBe(540);
    expect(beside(screen(1, 0).workArea, 1).x).toBeLessThan(beside(screen(1, 0).workArea, 0).x);
  });

  it('reuses saved bounds only while they are mostly on a monitor', () => {
    expect(onScreen({ x: 100, y: 100, width: 800, height: 600 }, three)).toBe(1);
    expect(onScreen({ x: 6000, y: 0, width: 800, height: 600 }, three)).toBe(0);
  });
});
