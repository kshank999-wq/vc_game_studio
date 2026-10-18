import { describe, expect, it } from 'vitest';
import { cardIssues, cardText, createCardProject, curveDelta, starterCards, type CardGame } from '../cards/cards';
import { attack, canAttack, canPlay, cardReport, createDuel, endTurn, manaCurve, opponentTurn, playCard, runDuel, type Duel } from '../cards/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { cardData } from '../handoff/card-files';
import type { EngineId } from '../types';

const named = (g: CardGame, name: string) => g.cards.find((c) => c.name === name)!;
/** A duel with a hand, board and mana set by hand. */
const setUp = (g: CardGame, hand: string[], mana = 10): Duel => {
  const d = createDuel(g, 1, 'blue');
  return { ...d, sides: { ...d.sides, blue: { ...d.sides.blue, hand: hand.map((n) => named(g, n).id), mana, maxMana: mana } } };
};

describe('card game', () => {
  it('a new card game starts playable, and its path follows its data', () => {
    const p = createModuleProject('cards', 'Ink Duel', 'Alchemists duel.');
    expect(moduleOf(p)).toMatchObject({ id: 'cards', name: 'Card game' });
    expect(p.cards!.concept.premise).toBe('Alchemists duel.');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, rules: true, cards: true, decks: true, play: false, handoff: false });
  });

  it('says what would stop the game working', () => {
    const g = starterCards();
    expect(cardIssues(g)).toEqual([]);
    const broken: CardGame = { ...g, decks: { blue: [], red: [...g.decks.red, named(g, 'Wolf').id] }, cards: g.cards.map((c) => (c.name === 'Ogre' ? { ...c, cost: 11 } : c)) };
    const msgs = cardIssues(broken).map((i) => i.message);
    expect(msgs.some((m) => m.includes('player’s deck is empty'))).toBe(true);
    expect(msgs.some((m) => m.includes('3 copies of Wolf'))).toBe(true);
    expect(msgs.some((m) => m.includes('Ogre costs 11'))).toBe(true);
  });

  it('writes rules text from the numbers, and measures cards against the curve', () => {
    const g = starterCards();
    expect(cardText(named(g, 'Archer'))).toBe('When played: Deal 1 damage to an enemy.');
    expect(cardText(named(g, 'Knight'))).toBe('Guard.');
    expect(cardText(named(g, 'Insight'))).toBe('Draw 2 cards.');
    expect(curveDelta(named(g, 'Wolf'))).toBe(0);
    expect(curveDelta({ ...named(g, 'Wolf'), attack: 6 })).toBe(3);
  });

  it('deals opening hands, one more for the side that goes second, and grows mana each turn', () => {
    const g = starterCards();
    let d = createDuel(g, 4, 'blue');
    expect(d.sides.blue.hand).toHaveLength(g.rules.startHand + 1);
    expect(d.sides.red.hand).toHaveLength(g.rules.startHand + 1);
    expect(d.sides.blue.deck.length + d.sides.blue.hand.length).toBe(g.decks.blue.length);
    expect(d.sides.blue.mana).toBe(1);
    d = endTurn(g, endTurn(g, d));
    expect(d.sides.blue.mana).toBe(2);
    expect(d.active).toBe('blue');
  });

  it('plays minions and spells for their mana; spells hit what they aim at', () => {
    const g = starterCards();
    let d = setUp(g, ['Wolf', 'Firebolt', 'Ogre'], 3);
    expect(canPlay(g, d, 2)).toBe(false);
    d = playCard(g, d, 0);
    expect(d.sides.blue.board).toHaveLength(1);
    expect(d.sides.blue.mana).toBe(1);
    const hero = d.sides.red.hero;
    d = playCard(g, d, 0, 'hero');
    expect(d.sides.red.hero).toBe(hero - 2);
    expect(d.sides.blue.played).toHaveLength(2);
  });

  it('minions attack from the next turn unless they charge, and guards must go first', () => {
    const g = starterCards();
    let d = setUp(g, ['Wolf', 'Scout']);
    d = playCard(g, playCard(g, d, 0), 0);
    const [wolf, scout] = d.sides.blue.board;
    expect(canAttack(d, wolf!.uid, 'hero')).toBe(false);
    expect(canAttack(d, scout!.uid, 'hero')).toBe(true);
    const guard = { uid: 99, cardId: named(g, 'Shieldbearer').id, attack: 1, health: 4, maxHealth: 4, guard: true, canAttack: false };
    d = { ...d, sides: { ...d.sides, red: { ...d.sides.red, board: [guard] } } };
    expect(canAttack(d, scout!.uid, 'hero')).toBe(false);
    d = attack(g, d, scout!.uid, 99);
    expect(d.sides.red.board[0]!.health).toBe(2);
    // The guard hit back for 1: the scout (1 health) is gone.
    expect(d.sides.blue.board.map((m) => m.uid)).toEqual([wolf!.uid]);
  });

  it('a hero at 0 loses; an empty deck burns with fatigue', () => {
    const g = starterCards();
    let d = setUp(g, ['Firebolt']);
    d = { ...d, sides: { ...d.sides, red: { ...d.sides.red, hero: 2 } } };
    d = playCard(g, d, 0, 'hero');
    expect(d).toMatchObject({ phase: 'over', winner: 'blue' });
    let f = createDuel({ ...g, decks: { blue: [], red: g.decks.red } }, 1, 'red');
    // Four opening draws, then the turn's: 1 + 2 + 3 + 4 + 5.
    f = endTurn(g, f);
    expect(f.sides.blue).toMatchObject({ fatigue: 5, hero: g.rules.heroHealth - 15 });
  });

  it('the studio plays its turn and hands it back', () => {
    const g = starterCards();
    let d = createDuel(g, 5, 'red');
    d = opponentTurn(g, d);
    expect(d.active).toBe('blue');
    expect(d.sides.red.played.length + d.sides.red.hand.length).toBeGreaterThan(0);
  });

  it('two decks played by the studio finish, the same every time, and sum up', () => {
    const g = starterCards();
    const r = runDuel(g, 3);
    expect(['blue', 'red', 'draw']).toContain(r.winner);
    expect(runDuel(g, 3)).toEqual(r);
    const rep = cardReport(g, 20);
    expect(rep.wins.blue + rep.wins.red + rep.wins.draw).toBe(20);
    expect(rep.cards.find((c) => c.cardId === named(g, 'Dragon').id)!.games).toBe(0);
    expect(manaCurve(g, 'blue')[1]).toBe(6);
  });

  it('moves leave the state they were given as it was', () => {
    const g = starterCards();
    const d0 = setUp(g, ['Wolf', 'Firebolt']);
    const frozen = JSON.stringify(d0);
    playCard(g, d0, 0);
    opponentTurn(g, endTurn(g, d0));
    expect(JSON.stringify(d0)).toBe(frozen);
  });

  it('every engine gets cards.json and CARDS.md for a card game, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createCardProject('Ink Duel', 'Alchemists duel.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('cards.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-cards', version: 1, rules: { hero_health: 20 } });
      expect(plan.output!.files.find((f) => f.path.endsWith('CARDS.md'))!.content).toContain('# Card game');
      expect(plan.output!.files.some((f) => /(arena|shooter|defense)\.json$/.test(f.path))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'cards')).toBe(true);
    }
    const d = cardData(p.cards!);
    expect(d.decks.player).toHaveLength(20);
    expect(d.cards.find((c) => c.key === 'flame_wave')).toMatchObject({ kind: 'spell', effect: { kind: 'damage_all', amount: 2 } });
  });
});
