import { describe, expect, it } from 'vitest';
import { addPath, checkAllPaths, checkPath, describeDecision, pathOf, removePath, updatePath } from '../paths';
import { choose, endFreePlay, interact, playToDecision, promptOf, startPlay, type Play } from '../play';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

/** Play the story to its end, taking the last option on offer at every choice and using what free play offers. */
const playThrough = (project: Project, pick: 'first' | 'last' = 'last'): Play => {
  let play = playToDecision(project, startPlay(project));
  for (let n = 0; n < 60; n++) {
    const prompt = promptOf(project, play);
    if (prompt.kind === 'end') break;
    if (prompt.kind === 'continue') play = playToDecision(project, { ...play, cursor: play.cursor.at === 'wait' ? play.cursor.next : play.cursor });
    else if (prompt.kind === 'choice') {
      const on = prompt.options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
      // Encounters are won; choices take the first or last option on offer.
      play = choose(project, play, prompt.symbol === 'encounter' ? 0 : pick === 'last' ? on.at(-1)! : on[0]!);
    } else {
      const verb = prompt.objects.flatMap((o) => o.verbs.filter((v) => v.available).map((v) => [o.id, v.id] as const))[0];
      play = verb ? interact(project, play, verb[0], verb[1]) : endFreePlay(project, play);
    }
    play = playToDecision(project, play);
  }
  return play;
};

describe('expected paths', () => {
  it('record the decisions, the scenes gone through and how it ended', () => {
    const p = sunkenVault();
    const play = playThrough(p);
    const path = pathOf(play, 'Pocket the ring', undefined, 1000);
    expect(path.decisions.length).toBeGreaterThan(1);
    expect(path.decisions.map((d) => d.kind)).toContain('choice');
    expect(path.through.map((id) => p.objects[id]!.name)).toContain('The Vault Door');
    expect(path.ending?.outcome).toBeDefined();
    expect(describeDecision(p, path.decisions[0]!)).toMatch(/: /);
  });

  it('still pass on the story they were recorded on, and fail with a reason once it changes', () => {
    const p = sunkenVault();
    const path = pathOf(playThrough(p), 'Last options', undefined, 1000);
    const withPath = addPath(p, path);
    // The sample's own two expected paths, and this one: all still go their way.
    expect(checkAllPaths(withPath).map((c) => c.check.ok)).toEqual([true, true, true]);
    expect(checkPath(p, path)).toMatchObject({ ok: true, followed: path.decisions.length, extra: [], missed: [] });

    // Rename the option it took: that option is gone.
    const choice = path.decisions.find((d) => d.kind === 'choice' && p.connections.some((c) => c.kind === 'branch' && c.sourceId === d.at && (c.label || '') === d.option))!;
    expect(choice).toBeTruthy();
    const branch = p.connections.find((c) => c.kind === 'branch' && c.sourceId === choice.at && c.label === (choice as { option: string }).option)!;
    const renamed: Project = { ...p, connections: p.connections.map((c) => (c.id === branch.id ? { ...c, label: 'Something else' } : c)) };
    const gone = checkPath(renamed, path);
    expect(gone.ok).toBe(false);
    expect(gone.problem).toMatch(/no longer offers “.+”\.$/);
    expect(gone.followed).toBeLessThan(path.decisions.length);

    // Give it a condition the path can't meet: it says what the option needs.
    const locked: Project = { ...p, connections: p.connections.map((c) => (c.id === branch.id ? { ...c, conditions: { match: 'all', items: [{ kind: 'visited', ref: Object.keys(p.objects).find((id) => p.objects[id]!.name === 'Lost Below')!, op: 'visited' }] } } : c)) };
    const needs = checkPath(locked, path);
    expect(needs.ok).toBe(false);
    expect(needs.problem).toMatch(/isn’t on offer: it needs .+/);

    // Taking the story's way now as the expected way passes again.
    const updated = updatePath(addPath(renamed, path), path.id, checkPath(renamed, { ...path, decisions: [] }).play);
    expect(updated.paths!.at(-1)!.id).toBe(path.id);
    expect(removePath(updated, path.id).paths).toHaveLength(2);
  });

  it('say where a path goes differently when the same decisions lead elsewhere', () => {
    const p = sunkenVault();
    const first = pathOf(playThrough(p, 'first'), 'First options', undefined, 1000);
    const last = pathOf(playThrough(p, 'last'), 'Last options', undefined, 1000);
    // The first options' decisions, expected to go the last options' way.
    const wrong = checkPath(p, { ...last, decisions: first.decisions });
    expect(wrong.ok).toBe(false);
    expect(wrong.problem).toBeTruthy();
  });
});
