import { describe, expect, it } from 'vitest';
import { planHandoff, setTarget } from '../handoff';
import { meshesFor } from '../level/geometry';
import { levelsOf, placeAsset } from '../level/level';
import { sunkenVault } from '../sample';

describe('a pyramid looks like a pyramid', () => {
  const withPyramid = () => {
    const base = sunkenVault();
    const lv = levelsOf(base).levels[0]!;
    const placed = placeAsset(base, lv.id, lv.floors[0]!.id, 'struct.pyramid', { x: 200, y: 200 });
    return { p: placed.project, id: placed.ids[0]!, levelId: lv.id };
  };

  it('is a square pyramid in the graybox, not a ramp', () => {
    const { p, id, levelId } = withPyramid();
    const piece = meshesFor(levelsOf(p), levelId).find((m) => m.itemId === id && m.part === 'solid')!;
    expect(piece.shape).toBe('pyramid');
  });

  it('goes to Godot as a four-sided point, to Unity as its own mesh, to Unreal as a cone', () => {
    const { p } = withPyramid();
    const godot = planHandoff(p).output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!.content;
    expect(godot).toMatch(/CylinderMesh[\s\S]*?radial_segments = 4/);
    const unity = planHandoff(setTarget(p, { engine: 'unity' })).output!.files;
    expect(unity.find((f) => f.path.endsWith('VcgsLevelBuilder.cs'))!.content).toContain('static Mesh Pyramid()');
    expect(unity.find((f) => f.path.endsWith('sunken_vault.json'))!.content).toContain('"pyramid"');
    const unreal = planHandoff(setTarget(p, { engine: 'unreal' }));
    expect(unreal.output!.files.find((f) => f.path.endsWith('build_level.py'))!.content).toContain('"pyramid": "/Engine/BasicShapes/Cone.Cone"');
  });
});
