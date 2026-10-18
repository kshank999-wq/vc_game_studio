import { cardText, type CardGame } from '../cards/cards';
import { TURN_LIMIT } from '../cards/sim';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A card game for the engine (game modules): cards.json, the whole game as
 * data (rules, every card with its rules text, both decks), and CARDS.md,
 * the rules the studio's play preview runs by and how to build them in the
 * engine, so what the designer balanced is what the engine plays.
 */

export const CARDS_FORMAT = 'vcgs-cards';

const key = (name: string, taken: Set<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'card';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  taken.add(k);
  return k;
};

/** cards.json's content: keys for cards instead of ids. */
export const cardData = (g: CardGame) => {
  const taken = new Set<string>();
  const keys = new Map(g.cards.map((c) => [c.id, key(c.name, taken)]));
  const r = g.rules;
  return {
    format: CARDS_FORMAT,
    version: 1,
    concept: g.concept,
    rules: { hero_health: r.heroHealth, mana_start: r.manaStart, mana_growth: r.manaGrowth, mana_max: r.manaMax, start_hand: r.startHand, hand_max: r.handMax, board_max: r.boardMax, max_copies: r.maxCopies, turn_limit: TURN_LIMIT },
    cards: g.cards.map((c) => ({
      key: keys.get(c.id),
      name: c.name,
      kind: c.kind,
      cost: c.cost,
      ...(c.kind === 'minion' ? { attack: c.attack, health: c.health, guard: c.guard, charge: c.charge } : {}),
      effect: c.effect.kind === 'none' || c.effect.amount <= 0 ? null : { kind: c.effect.kind === 'damageAll' ? 'damage_all' : c.effect.kind, amount: c.effect.amount },
      text: cardText(c),
    })),
    decks: { player: g.decks.blue.filter((id) => keys.has(id)).map((id) => keys.get(id)), opponent: g.decks.red.filter((id) => keys.has(id)).map((id) => keys.get(id)) },
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/cards.json"))`. A Control scene a card (its `text` is ready to show), an HBoxContainer each for the hands and boards.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/cards").text)` (or Newtonsoft), or make a ScriptableObject a card. A UI prefab a card, layout groups for the hands and boards.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`, or import the cards as a Data Table. A UMG widget a card, horizontal boxes for the hands and boards.',
  custom: "Read it with your engine's JSON reader.",
};

/** CARDS.md: what cards.json holds and the rules the studio plays it by. */
export const cardMarkdown = (g: CardGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  return `# Card game

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The game is in \`cards.json\`, as designed and balanced in VC Game Studio's play preview. Build the engine's version to the same rules and it plays the same.

## Loading it

${load}

## The data

- \`rules\`: \`hero_health\`; mana starts at \`mana_start\` on a side's first turn, grows by \`mana_growth\` each turn after, to \`mana_max\`; \`start_hand\` cards to begin (the side that goes second draws one more); \`hand_max\`; \`board_max\` minions a side; \`max_copies\` of one card a deck; \`turn_limit\` turns, both sides together, before a draw.
- \`cards\`: \`kind\` (minion or spell), \`cost\`; a minion's \`attack\`, \`health\`, \`guard\`, \`charge\`; an \`effect\` (a spell's, or a minion's when played) with its \`amount\`; \`text\`, the rules text written from the numbers.
- \`decks\`: the player's and the opponent's, a key a copy.

## The rules

1. A turn: mana refills (growing as above), the side's minions can attack again, it draws a card. Drawing from an empty deck instead deals fatigue damage to its hero: 1, then 2, and so on. A card drawn into a full hand is lost.
2. Playing a card costs its mana. A minion goes on the board (if there is room); it can attack from the next turn, or this one with \`charge\`.
3. Effects: \`damage\` hits one enemy, minion or hero, of the player's choosing; \`damage_all\` hits every enemy minion; \`heal\` restores the side's hero, to its starting health at most; \`draw\` draws cards; \`buff\` gives one friendly minion +amount attack and +amount health.
4. A minion attacks once a turn: an enemy minion (both deal their attack to each other) or the enemy hero. While the enemy has a \`guard\` minion, attacks must go at a guard. Spells ignore guard.
5. A minion at 0 health is gone. A hero at 0 loses.

## The studio's opponent

Each turn it plays the dearest cards it can afford: damage at the strongest minion it kills (or the hero), buffs on a minion that can still attack; it holds a board-wide spell for two or more targets, healing until its hero is hurt, drawing until there is room. Then it attacks: guards first, the hero when that wins, trades that kill and survive, the rest at the hero.

## Balanced as

${g.cards.length} cards; decks of ${g.decks.blue.length} and ${g.decks.red.length}; heroes with ${g.rules.heroHealth} health.
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** cards.json and CARDS.md for a card game project, and the handoff screen's row for them. None for other projects. */
export const cardFiles = (game: CardGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(cardData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/cards.json`, content: data, kind: 'generated' },
    { path: `${dir}/CARDS.md`, content: cardMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: {
      id: 'cards',
      label: 'Card game',
      symbol: 'inventory',
      group: 'World',
      generates: `cards.json · ${game.cards.length} cards, 2 decks + CARDS.md → ${dir}/`,
      files: files.map((f) => f.path),
      fingerprint: fingerprint(data),
    },
  };
};
