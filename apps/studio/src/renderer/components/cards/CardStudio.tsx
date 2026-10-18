import { cardIssues, curveDelta, newMinion, newSpell, starterCards, updateCards, type Card, type CardGame, type EffectKind, type Side } from '../../model/cards/cards';
import { manaCurve } from '../../model/cards/sim';
import type { CardTab } from '../../model/modules';
import type { Project } from '../../model/types';
import { Num, Text } from '../defense/fields';
import { ConceptPane, Intro, StepTabs } from '../modules/parts';
import { CardFace } from './CardFace';
import { CardPlay } from './CardPlay';

const TABS: { id: CardTab; label: string }[] = [
  { id: 'concept', label: 'Concept' },
  { id: 'rules', label: 'Rules' },
  { id: 'cards', label: 'Cards' },
  { id: 'decks', label: 'Decks' },
  { id: 'play', label: 'Play and balance' },
];

const EFFECTS: { id: EffectKind; label: string }[] = [
  { id: 'none', label: 'Nothing' },
  { id: 'damage', label: 'Damage an enemy' },
  { id: 'damageAll', label: 'Damage every enemy minion' },
  { id: 'heal', label: 'Heal your hero' },
  { id: 'draw', label: 'Draw cards' },
  { id: 'buff', label: 'Buff a friendly minion' },
];

/**
 * The card game workspace (game modules): one tab a step of its path,
 * concept to play. It starts from a small game with two decks that plays
 * from the first minute, and is refined from there.
 */
export const CardStudio = ({ project, tab: asked, onTab, onCommit }: { project: Project; tab: string; onTab: (t: CardTab) => void; onCommit: (p: Project) => void }) => {
  const tab: CardTab = TABS.find((t) => t.id === asked)?.id ?? 'concept';
  const game = project.cards ?? starterCards();
  const change = (f: (g: CardGame) => CardGame) => onCommit(updateCards(project, f));
  return (
    <div className="dfn-studio">
      <StepTabs label="Card game" tabs={TABS} tab={tab} onTab={onTab} issues={cardIssues(game)} />
      <section className="dfn-body">
        {tab === 'concept' && (
          <ConceptPane
            concept={game.concept}
            set={(patch) => change((g) => ({ ...g, concept: { ...g.concept, ...patch } }))}
            premiseHint="e.g. Rival alchemists duel with summoned creatures and brewed spells."
            themeHint="e.g. Ink-and-watercolour fantasy"
            notesHint="Ideas for later: hero powers, card sets, a campaign against named rivals…"
          />
        )}
        {tab === 'rules' && <RulesTab game={game} change={change} />}
        {tab === 'cards' && <CardsTab game={game} change={change} />}
        {tab === 'decks' && <DecksTab game={game} change={change} />}
        {tab === 'play' && <CardPlay game={game} />}
      </section>
    </div>
  );
};

type Change = (f: (g: CardGame) => CardGame) => void;

const RulesTab = ({ game, change }: { game: CardGame; change: Change }) => {
  const set = (patch: Partial<CardGame['rules']>) => change((g) => ({ ...g, rules: { ...g.rules, ...patch } }));
  const r = game.rules;
  const full = r.manaGrowth > 0 ? Math.max(1, Math.ceil((r.manaMax - r.manaStart) / r.manaGrowth) + 1) : 1;
  return (
    <div className="dfn-pane narrow">
      <Intro title="Rules">The shape of a game: how tough the heroes are, how fast mana grows, how many cards to start with, how crowded the board gets.</Intro>
      <div className="dfn-grid">
        <Num label="Hero health" value={r.heroHealth} min={1} onCommit={(v) => set({ heroHealth: v })} />
        <Num label="Mana on turn 1" value={r.manaStart} min={0} onCommit={(v) => set({ manaStart: v })} />
        <Num label="More each turn" value={r.manaGrowth} min={0} onCommit={(v) => set({ manaGrowth: v })} />
        <Num label="Most mana" value={r.manaMax} min={1} onCommit={(v) => set({ manaMax: v })} />
        <Num label="Opening hand" value={r.startHand} min={0} max={10} suffix="cards" title="The side that goes second gets one more" onCommit={(v) => set({ startHand: v })} />
        <Num label="Hand holds" value={r.handMax} min={1} suffix="cards" onCommit={(v) => set({ handMax: v })} />
        <Num label="Board holds" value={r.boardMax} min={1} suffix="minions" onCommit={(v) => set({ boardMax: v })} />
        <Num label="Copies a deck" value={r.maxCopies} min={1} onCommit={(v) => set({ maxCopies: v })} />
      </div>
      <p className="dfn-hint">Mana reaches its most ({r.manaMax}) on turn {full}. The side that goes second starts with {r.startHand + 1} cards.</p>
    </div>
  );
};

const CardsTab = ({ game, change }: { game: CardGame; change: Change }) => {
  const set = (id: string, patch: Partial<Card>) => change((g) => ({ ...g, cards: g.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const sorted = [...game.cards].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return (
    <div className="dfn-pane">
      <Intro title="Cards">
        Rough the numbers in; the curve says what’s off. A card’s worth is about twice its cost and one (attack and health together, a point a keyword); + is more than its cost buys, − less.
      </Intro>
      <div className="crd-editors">
        {sorted.map((c) => {
          const d = curveDelta(c);
          return (
            <article key={c.id} className="dfn-card crd-editor" aria-label={c.name}>
              <CardFace card={c} />
              <div className="crd-fields">
                <div className="dfn-card-head">
                  <Text label="Name" value={c.name} onCommit={(v) => set(c.id, { name: v.trim() || c.name })} />
                  <button className="icon-btn small" aria-label={`Remove ${c.name}`} title="Remove" onClick={() => change((g) => ({ ...g, cards: g.cards.filter((x) => x.id !== c.id), decks: { blue: g.decks.blue.filter((id) => id !== c.id), red: g.decks.red.filter((id) => id !== c.id) } }))}>
                    ×
                  </button>
                </div>
                <div className="dfn-grid">
                  <label className="dfn-text">
                    <span>Kind</span>
                    <select className="inp small" value={c.kind} aria-label="Kind" onChange={(e) => set(c.id, { kind: e.target.value as Card['kind'], ...(e.target.value === 'minion' && c.health < 1 ? { attack: 1, health: 1 } : {}) })}>
                      <option value="minion">Minion</option>
                      <option value="spell">Spell</option>
                    </select>
                  </label>
                  <Num label="Cost" value={c.cost} min={0} onCommit={(v) => set(c.id, { cost: v })} />
                  {c.kind === 'minion' ? (
                    <>
                      <Num label="Attack" value={c.attack} min={0} onCommit={(v) => set(c.id, { attack: v })} />
                      <Num label="Health" value={c.health} min={1} onCommit={(v) => set(c.id, { health: v })} />
                    </>
                  ) : null}
                  <label className="dfn-text">
                    <span>{c.kind === 'minion' ? 'When played' : 'Does'}</span>
                    <select className="inp small" value={c.effect.kind} aria-label="Effect" onChange={(e) => set(c.id, { effect: { kind: e.target.value as EffectKind, amount: c.effect.amount || 1 } })}>
                      {EFFECTS.filter((x) => c.kind === 'minion' || x.id !== 'none').map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {c.effect.kind !== 'none' ? <Num label="Amount" value={c.effect.amount} min={1} onCommit={(v) => set(c.id, { effect: { ...c.effect, amount: v } })} /> : null}
                </div>
                {c.kind === 'minion' ? (
                  <div className="dfn-row">
                    <label className="dfn-check">
                      <input type="checkbox" checked={c.guard} onChange={(e) => set(c.id, { guard: e.target.checked })} /> Guard
                    </label>
                    <label className="dfn-check">
                      <input type="checkbox" checked={c.charge} onChange={(e) => set(c.id, { charge: e.target.checked })} /> Charge
                    </label>
                  </div>
                ) : null}
                <p className={`crd-curve${d >= 2 ? ' high' : d <= -2 ? ' low' : ''}`}>{d === 0 ? 'On the curve.' : d > 0 ? `+${d}: more than its cost buys.` : `${d}: less than its cost buys.`}</p>
              </div>
            </article>
          );
        })}
      </div>
      <div className="dfn-row">
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, cards: [...g.cards, newMinion()] }))}>
          + Minion
        </button>
        <button className="tb-btn" onClick={() => change((g) => ({ ...g, cards: [...g.cards, newSpell()] }))}>
          + Spell
        </button>
      </div>
    </div>
  );
};

const Curve = ({ game, side }: { game: CardGame; side: Side }) => {
  const curve = manaCurve(game, side);
  const top = Math.max(1, ...curve);
  return (
    <div className="crd-curvebars" role="img" aria-label={`Mana curve: ${curve.map((n, i) => `${n} at ${i}`).join(', ')}`}>
      {curve.map((n, i) => (
        <div key={i} className="crd-bar">
          <span style={{ height: `${(100 * n) / top}%` }} />
          <em>{i === curve.length - 1 && curve.length > 1 ? `${i}+` : i}</em>
        </div>
      ))}
    </div>
  );
};

const DecksTab = ({ game, change }: { game: CardGame; change: Change }) => {
  const count = (side: Side, id: string) => game.decks[side].filter((x) => x === id).length;
  const add = (side: Side, id: string) => change((g) => ({ ...g, decks: { ...g.decks, [side]: [...g.decks[side], id] } }));
  const remove = (side: Side, id: string) =>
    change((g) => {
      const deck = [...g.decks[side]];
      const i = deck.lastIndexOf(id);
      if (i >= 0) deck.splice(i, 1);
      return { ...g, decks: { ...g.decks, [side]: deck } };
    });
  const sorted = [...game.cards].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return (
    <div className="dfn-pane narrow">
      <Intro title="Decks">The cards each side brings, up to {game.rules.maxCopies} of each. The bars show how many cards of each cost a deck holds: most decks want plenty to play early.</Intro>
      <div className="arn-decks">
        {(['blue', 'red'] as const).map((side) => (
          <section key={side} className={`dfn-card arn-deck ${side}`} aria-label={side === 'blue' ? 'The player’s deck' : 'The opponent’s deck'}>
            <h3 className="arn-sub">
              {side === 'blue' ? 'The player' : 'The opponent'} · {game.decks[side].length} cards
            </h3>
            <Curve game={game} side={side} />
            {sorted.map((c) => {
              const n = count(side, c.id);
              return (
                <div key={c.id} className="crd-deckrow">
                  <span className="crd-cost small">{c.cost}</span>
                  <span className={n ? '' : 'muted'}>{c.name}</span>
                  <button className="icon-btn small" aria-label={`One fewer ${c.name}`} disabled={!n} onClick={() => remove(side, c.id)}>
                    −
                  </button>
                  <span className="crd-count">{n}</span>
                  <button className="icon-btn small" aria-label={`One more ${c.name}`} disabled={n >= game.rules.maxCopies} onClick={() => add(side, c.id)}>
                    +
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <button className="tb-btn" onClick={() => change((g) => ({ ...g, decks: { ...g.decks, red: [...g.decks.blue] } }))}>
        Give the opponent the player’s deck
      </button>
    </div>
  );
};
