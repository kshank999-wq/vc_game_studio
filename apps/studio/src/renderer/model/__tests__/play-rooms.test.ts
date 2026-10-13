import { describe, expect, it } from 'vitest';
import { createProject, placeNew } from '../project';
import { spineLane } from '../layout';
import { addSubScene } from '../subscene';
import { choose, playToDecision, promptOf, startPlay } from '../play';

describe('the play-through and rooms', () => {
  it('offers a scene’s rooms when it is done, plays one, comes back out, and leaves when asked', () => {
    let p = createProject('Rooms');
    const scene = placeNew(p, 'scene', spineLane(p).id, 400)!;
    p = scene.project;
    const study = addSubScene(p, scene.id, 'The Study')!;
    p = study.project;
    const closet = addSubScene(p, study.id, 'The Closet')!;
    p = closet.project;

    let play = playToDecision(p, startPlay(p, scene.id));
    let prompt = promptOf(p, play);
    expect(prompt.kind === 'choice' && prompt.prompt).toBe('Where now?');
    expect(prompt.kind === 'choice' && prompt.options.map((o) => o.label)).toEqual(['Go into The Study', 'Leave New scene']);

    // Into the study, which has a room of its own.
    play = playToDecision(p, choose(p, play, 0));
    expect(play.log.some((e) => e.kind === 'heading' && e.text.endsWith('The Study'))).toBe(true);
    prompt = promptOf(p, play);
    expect(prompt.kind === 'choice' && prompt.options.map((o) => o.label)).toEqual(['Go into The Closet', 'Leave The Study']);
    // Into the closet and out: back in the study's choice; leave the study: back in the scene's, the study marked as been.
    play = playToDecision(p, choose(p, play, 0));
    prompt = promptOf(p, play);
    expect(prompt.kind === 'choice' && prompt.options[0]!.label).toBe('Go into The Closet (been)');
    play = playToDecision(p, choose(p, play, 1));
    prompt = promptOf(p, play);
    expect(prompt.kind === 'choice' && prompt.options[0]!.label).toBe('Go into The Study (been)');

    // Leaving the scene goes on along the spine.
    play = playToDecision(p, choose(p, play, 1));
    expect(play.decisions!.map((d) => d.kind === 'choice' && d.option)).toEqual(['Go into The Study', 'Go into The Closet', 'Leave The Study', 'Leave New scene']);
    expect(play.log.some((e) => e.kind === 'picked' && e.text === 'Leave New scene')).toBe(true);
    expect(play.where.nodeId).not.toBe(scene.id);
  });
});
