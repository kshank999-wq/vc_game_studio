import { describe, expect, it } from 'vitest';
import { CAD_TAG, guessRole, guessUnits, importPlan, parseCad, parseDxf, parseSvg, readPlan, type CadDrawing, type CadRole } from '../level/cad';
import { assetOf, frameOf } from '../level/geometry';
import { addLevel, levelsOf } from '../level/level';
import { createStructure, structureGraph } from '../level/structure';
import { createProject } from '../project';

/** A DXF as a CAD program writes it: group code, value, one per line. */
const dxf = (...entities: (string | number)[][]) => [...entities.flat(), 0, 'EOF'].join('\n');
const header = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'];
const poly = (layer: string, pts: [number, number][], closed = true) => [0, 'LWPOLYLINE', 8, layer, 90, pts.length, 70, closed ? 1 : 0, ...pts.flatMap(([x, y]) => [10, x, 20, y])];
const line = (layer: string, a: [number, number], b: [number, number]) => [0, 'LINE', 8, layer, 10, a[0], 20, a[1], 11, b[0], 21, b[1]];
const arc = (layer: string, c: [number, number], r: number, a0: number, a1: number) => [0, 'ARC', 8, layer, 10, c[0], 20, c[1], 40, r, 50, a0, 51, a1];
const text = (layer: string, at: [number, number], s: string, kind = 'TEXT') => [0, kind, 8, layer, 10, at[0], 20, at[1], 1, s];

/** A 20 × 10 m plan in millimetres: a hall, an L-shaped store, a small room drawn as loose lines, two doors and a stair. */
const PLAN = dxf(
  header,
  [0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 8, '0', 2, 'DOOR-900', 10, 0, 20, 0, ...line('0', [0, 0], [0, 900]), ...arc('0', [0, 0], 900, 0, 90), 0, 'ENDBLK', 0, 'ENDSEC'],
  [
    0, 'SECTION', 2, 'ENTITIES',
    ...poly('A-WALL', [[0, 0], [20000, 0], [20000, 10000], [0, 10000]]),
    ...poly('A-AREA', [[0, 0], [10000, 0], [10000, 10000], [0, 10000]]),
    ...poly('A-AREA', [[10000, 0], [20000, 0], [20000, 10000], [15000, 10000], [15000, 6000], [10000, 6000]]),
    ...line('A-AREA', [10000, 6000], [15000, 6000]),
    ...line('A-AREA', [15000, 6000], [15000, 10000]),
    ...line('A-AREA', [10000, 10000], [10000, 6000]),
    ...line('A-AREA', [15000, 10000], [10000, 10000]),
    ...text('A-ANNO', [5000, 5000], 'Hall'),
    ...text('A-ANNO', [17000, 3000], '{\\fArial|b1;Store}\\PLevel 1', 'MTEXT'),
    ...arc('A-DOOR', [10000, 2000], 900, 0, 90),
    0, 'INSERT', 8, 'A-DOOR', 2, 'DOOR-900', 10, 12500, 20, 6000, 41, 1, 42, 1, 50, 0,
    ...poly('A-STAIRS', [[1000, 7000], [3000, 7000], [3000, 9000], [1000, 9000]]),
    0, 'CIRCLE', 8, 'A-FURN', 10, 4000, 20, 4000, 40, 300,
    0, 'DIMENSION', 8, 'A-DIMS',
    0, 'ENDSEC',
  ],
);

const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="2000cm" height="1000cm" viewBox="0 0 2000 1000">
  <defs><rect id="ghost" x="0" y="0" width="5" height="5"/></defs>
  <g inkscape:groupmode="layer" inkscape:label="Outline"><rect x="0" y="0" width="2000" height="1000"/></g>
  <g inkscape:groupmode="layer" inkscape:label="Rooms">
    <rect x="0" y="0" width="1000" height="1000"/>
    <g transform="translate(1000,0)"><polygon points="0,0 1000,0 1000,1000 500,1000 500,400 0,400"/></g>
    <path d="M 1000 400 h 500 v 600 H 1000 Z"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Labels">
    <text x="500" y="500"><tspan>Nave</tspan></text>
    <text x="1700" y="300">Vestry</text>
    <text x="1250" y="700">Chapel</text>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Doors"><path d="M 960 200 L 1040 200 L 1040 290 L 960 290 Z"/></g>
</svg>`;

const structure = () => {
  const base = addLevel(createProject('Test'), 'A');
  const lv = levelsOf(base.project).levels[0]!;
  const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type: 'temple', seed: 5 });
  const level = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
  const ground = [...level.floors].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0]!;
  return { p: made.project, id: made.id, floorId: ground.id };
};
const roles = (d: CadDrawing): Record<string, CadRole> => Object.fromEntries(d.layers.map((l) => [l, guessRole(l)]));

describe('imported CAD plans (structure spec V2)', () => {
  it('reads a DXF: polylines, lines, arcs, text, block inserts, and the units it says it is in', () => {
    const d = parseDxf(PLAN);
    expect(d.units).toBe('mm');
    expect(d.layers).toEqual(['A-ANNO', 'A-AREA', 'A-DIMS', 'A-DOOR', 'A-FURN', 'A-STAIRS', 'A-WALL'].filter((l) => l !== 'A-DIMS'));
    expect(d.shapes.filter((s) => s.block?.name === 'DOOR-900')).toHaveLength(2);
    expect(d.texts.map((t) => t.text)).toEqual(['Hall', 'Store\nLevel 1']);
    expect(d.notes[0]).toContain('1 dimension');
    expect(parseCad('plan.dxf', PLAN).format).toBe('dxf');
  });

  it('gives each layer a role from its name', () => {
    expect(['A-WALL', 'A-AREA', 'A-DOOR', 'A-STAIRS', 'A-ANNO', 'A-FURN', 'Outline', 'Rooms', 'Doors', 'Labels'].map(guessRole)).toEqual(['walls', 'rooms', 'doors', 'stairs', 'labels', 'ignore', 'footprint', 'rooms', 'doors', 'labels']);
  });

  it('reads the plan: rooms named by their labels, joined loose lines, door swings on the wall, stairs, footprint', () => {
    const d = parseDxf(PLAN);
    const plan = readPlan(d, { roles: roles(d), units: guessUnits(d) });
    expect(plan.size).toEqual({ w: 20, d: 10 });
    expect(plan.rooms.map((r) => [r.name, r.area])).toEqual([
      ['Hall', 100],
      ['Store', 80],
      ['Room 1', 20],
    ]);
    // North up: the hall is on the west, and y runs south on the plan.
    const hall = plan.rooms.find((r) => r.name === 'Hall')!;
    expect(Math.min(...hall.points.map((p) => p.x))).toBe(-10);
    // The swing hinged at (10, 2) m opens on the wall between the hall and the store: its middle is on x = 10 m.
    expect(plan.doors.map((x) => [x.at.x, x.at.y, x.width])).toEqual([
      [2.95, -1, 0.9],
      [0, 2.55, 0.9],
    ]);
    expect(plan.stairs).toHaveLength(1);
  });

  it('puts it on a structure’s floor: the footprint reshaped, rooms, outlined rooms, doors in walls, all joined up', () => {
    const { p, id, floorId } = structure();
    const d = parseDxf(PLAN);
    const out = importPlan(p, id, floorId, readPlan(d, { roles: roles(d), units: 'mm' }));
    expect(out.problems).toEqual([]);
    expect(out.counts).toEqual({ rooms: 3, doors: 2, stairs: 1 });
    const set = levelsOf(out.project);
    const on = set.items.filter((i) => i.levelId === id && i.floorId === floorId);
    const fp = on.find((i) => assetOf(set, i).role === 'footprint')!;
    expect(frameOf(set, fp)).toMatchObject({ w: 20, d: 10 });
    const store = on.find((i) => i.name === 'Store')!;
    expect(store.outline).toHaveLength(6);
    expect(on.find((i) => i.name === 'Hall')!.outline).toBeUndefined();
    for (const door of on.filter((i) => i.assetId === 'arch.door')) {
      expect(door.host).toBeDefined();
      expect(door.tags).toContain(CAD_TAG);
    }
    const graph = structureGraph(set, id);
    const names = (sid: string) => set.items.find((i) => i.id === sid)?.name;
    const joined = graph.edges.filter((e) => e.kind === 'door').map((e) => [names(e.from), names(e.to)].sort().join('–'));
    expect(joined).toEqual(expect.arrayContaining(['Hall–Store', 'Room 1–Store']));
  });

  it('reads an SVG: layers from its groups, transforms, paths, the units from its width', () => {
    const d = parseSvg(SVG);
    expect(d.units).toBe('cm');
    expect(d.layers).toEqual(['Doors', 'Labels', 'Outline', 'Rooms']);
    expect(parseCad('plan.svg', SVG).format).toBe('svg');
    const plan = readPlan(d, { roles: roles(d), units: guessUnits(d) });
    expect(plan.size).toEqual({ w: 20, d: 10 });
    expect(plan.rooms.map((r) => r.name).sort()).toEqual(['Chapel', 'Nave', 'Vestry']);
    expect(plan.doors).toEqual([{ at: { x: 0, y: -2.55 }, width: 0.9 }]);
    const { p, id, floorId } = structure();
    const out = importPlan(p, id, floorId, plan);
    expect(out.counts).toEqual({ rooms: 3, doors: 1, stairs: 0 });
    // SVG y runs down the page, as the plan's does: the nave stays north-west.
    const nave = levelsOf(out.project).items.find((i) => i.name === 'Nave')!;
    expect([nave.x, nave.y]).toEqual([-5, 0]);
  });

  it('says what it can’t do: a door off every wall, a file with nothing in it', () => {
    const { p, id, floorId } = structure();
    const d = parseDxf(dxf(header, [0, 'SECTION', 2, 'ENTITIES', ...poly('A-AREA', [[0, 0], [5000, 0], [5000, 5000], [0, 5000]]), ...arc('A-DOOR', [2500, 2500], 900, 0, 90), 0, 'ENDSEC']));
    const out = importPlan(p, id, floorId, readPlan(d, { roles: roles(d), units: 'mm' }));
    expect(out.counts.doors).toBe(0);
    expect(out.problems[0]).toMatch(/isn’t on any room’s wall/);
    expect(parseDxf('0\nEOF').notes).toContain('No lines or shapes found. Is it a DXF saved as text (ASCII), not binary?');
  });
});
