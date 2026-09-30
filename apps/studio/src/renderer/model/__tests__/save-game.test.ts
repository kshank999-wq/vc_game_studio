import { describe, expect, it } from 'vitest';
import { advance, choose, playToDecision, promptOf, startPlay } from '../play';
import { sunkenVault } from '../sample';
import { playFromSave, saveText, whereOf } from '../save-game';

const p = sunkenVault();

describe('saving a play-through', () => {
  it('saves the whole play-through, and loading carries on from the very line', () => {
    const play = choose(p, playToDecision(p, startPlay(p)), 0);
    const text = saveText(p, play, 1234);
    const save = JSON.parse(text);
    expect(save).toMatchObject({ format: 'vcgs-play-save', version: 1, project: p.id, story: 'The Sunken Vault', at: whereOf(p, play), savedAt: 1234 });
    const read = playFromSave(p, text);
    if ('error' in read) throw new Error(read.error);
    expect(read.play).toEqual(play);
    // It plays on the same as the original.
    expect(promptOf(p, advance(p, read.play))).toEqual(promptOf(p, advance(p, play)));
    expect(advance(p, read.play).log).toEqual(advance(p, play).log);
  });

  it('says where the player is in words', () => {
    const play = playToDecision(p, startPlay(p));
    expect(whereOf(p, play)).toBe('C1 Take the lantern');
    expect(whereOf(p, { ...play, cursor: { at: 'end', outcome: 'ending', text: '' } })).toBe('The end');
  });

  it('will not load what is not a save, one from another project, or one at a part since deleted', () => {
    expect(playFromSave(p, 'not json')).toEqual({ error: 'That is not a saved game.' });
    expect(playFromSave(p, '{"format":"vcgs-codex-notes-sync"}')).toEqual({ error: 'That is not a saved game.' });
    const play = playToDecision(p, startPlay(p));
    expect(playFromSave({ ...p, id: 'other' }, saveText(p, play))).toEqual({ error: 'That game was saved from another project (The Sunken Vault).' });
    const scene = play.where.sceneId!;
    const { [scene]: _gone, ...objects } = p.objects;
    const cut = { ...p, objects };
    const at = { ...play, cursor: { at: 'event' as const, sceneId: scene, track: 'main', index: 0 } };
    expect(playFromSave(cut, saveText(p, at))).toEqual({ error: 'That game was saved at a part of the story that is no longer there.' });
  });

  it('fills in kinds of state the story gained since the save', () => {
    const play = playToDecision(p, startPlay(p));
    const old = JSON.parse(saveText(p, play));
    delete old.play.world.used;
    const read = playFromSave(p, JSON.stringify(old));
    if ('error' in read) throw new Error(read.error);
    expect(read.play.world.used).toEqual({});
  });
});
