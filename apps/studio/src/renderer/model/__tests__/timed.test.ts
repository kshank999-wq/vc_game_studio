import { describe, expect, it } from 'vitest';
import { choose, playToDecision, promptOf, startPlay } from '../play';
import { evaluate } from '../rules';
import { setField } from '../details';
import { sunkenVault } from '../sample';
import { buildIR } from '../handoff/ir';
import { timeLimitOf, timeoutPick } from '../timed';

/** The sample's first choice, as the play-through offers it. */
const firstChoice = () => {
  const p = sunkenVault();
  const play = playToDecision(p, startPlay(p));
  const prompt = promptOf(p, play);
  if (prompt.kind !== 'choice') throw new Error('expected a choice');
  const choice = Object.values(p.objects).find((o) => o.type === 'choice' && prompt.title.endsWith(o.name))!;
  return { p, choice, prompt };
};

describe('timed choices', () => {
  it('time running out takes the option it names, else the first on offer', () => {
    const options = [
      { label: 'Wait', available: false },
      { label: 'Run', available: true },
      { label: 'Hide', available: true },
    ];
    expect(timeoutPick(options, '')).toBe(1);
    expect(timeoutPick(options, ' hide ')).toBe(2);
    expect(timeoutPick(options, 'Wait')).toBe(1); // not on offer
    expect(timeoutPick(options, 'Fly')).toBe(1);
    expect(timeoutPick([{ label: 'Wait', available: false }], '')).toBe(-1);
  });

  it('a choice without a limit is not timed', () => {
    const { prompt, choice } = firstChoice();
    expect(timeLimitOf(choice)).toBe(0);
    expect(prompt).not.toHaveProperty('timeLimit');
  });

  it('the play-through offers the clock, and the export carries it', () => {
    const { p, choice, prompt } = firstChoice();
    const last = prompt.options.filter((o) => o.available).at(-1)!;
    const q = setField(setField(p, choice.id, 'timeLimit', '8'), choice.id, 'onTimeout', last.label);
    const timed = promptOf(q, playToDecision(q, startPlay(q)));
    expect(timed).toMatchObject({ kind: 'choice', timeLimit: 8, onTimeout: prompt.options.indexOf(last) });
    expect(buildIR(q).choices.find((c) => c.id === choice.id)).toMatchObject({ timeLimit: 8, onTimeout: last.label });
    expect(timeLimitOf(setField(q, choice.id, 'timeLimit', 'soon').objects[choice.id])).toBe(0);
  });
});

describe('encounter conditions', () => {
  it('read whether a fight was won or come to', async () => {
    const { evaluate, emptyState, describeRule } = await import('../rules');
    const p = sunkenVault();
    const eels = Object.values(p.objects).find((o) => o.type === 'encounter')!;
    const rule = (op: 'won' | 'notWon' | 'met' | 'notMet') => ({ match: 'all' as const, items: [{ kind: 'encounter' as const, ref: eels.id, op }] });
    const fresh = emptyState();
    expect([evaluate(rule('won'), fresh), evaluate(rule('notWon'), fresh), evaluate(rule('met'), fresh), evaluate(rule('notMet'), fresh)]).toEqual([false, true, false, true]);
    const met = { ...fresh, met: { [eels.id]: true } };
    expect([evaluate(rule('won'), met), evaluate(rule('met'), met)]).toEqual([false, true]);
    // Won counts as fought.
    const won = { ...fresh, won: { [eels.id]: true } };
    expect([evaluate(rule('won'), won), evaluate(rule('notMet'), won)]).toEqual([true, false]);
    expect(describeRule(p, rule('won'))).toBe(`${eels.name} was won`);
  });

  it('hold in the play-through once the encounter is won', () => {
    const p = sunkenVault();
    const eels = Object.values(p.objects).find((o) => o.type === 'encounter')!;
    let play = playToDecision(p, startPlay(p));
    play = playToDecision(p, choose(p, play, 0));
    expect(promptOf(p, play)).toMatchObject({ kind: 'choice', symbol: 'encounter' });
    play = choose(p, play, 0);
    expect(evaluate({ match: 'all', items: [{ kind: 'encounter', ref: eels.id, op: 'won' }] }, play.world)).toBe(true);
  });
});
