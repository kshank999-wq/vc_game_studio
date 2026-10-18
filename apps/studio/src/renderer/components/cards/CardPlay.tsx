import { useEffect, useMemo, useState } from 'react';
import { curveDelta, type CardGame, type Side } from '../../model/cards/cards';
import { attack, canAttack, canPlay, cardReport, createDuel, endTurn, opponentTurn, playCard, targetKind, type Duel, type Target } from '../../model/cards/sim';
import { CardFace } from './CardFace';

type Pick = { from: 'hand'; index: number } | { from: 'board'; uid: number } | null;

const GAMES = 100;

/**
 * Play and balance: play the player's deck against the studio's opponent,
 * and read a hundred games of the studio playing both decks: who wins,
 * what going first is worth, and how each card does when it is played.
 */
export const CardPlay = ({ game }: { game: CardGame }) => {
  const [first, setFirst] = useState<Side>('blue');
  const [seed, setSeed] = useState(1);
  const [duel, setDuel] = useState<Duel>(() => createDuel(game, seed, first));
  const [pick, setPick] = useState<Pick>(null);

  useEffect(() => {
    setPick(null);
    setDuel(createDuel(game, seed, first));
  }, [game, seed, first]);

  // The studio takes its turn after a moment, so the player sees it coming.
  useEffect(() => {
    if (duel.phase !== 'playing' || duel.active !== 'red') return;
    const t = setTimeout(() => setDuel((d) => (d.active === 'red' ? opponentTurn(game, d) : d)), 700);
    return () => clearTimeout(t);
  }, [duel, game]);

  const report = useMemo(() => cardReport(game, GAMES), [game]);
  const cardOf = new Map(game.cards.map((c) => [c.id, c]));
  const you = duel.sides.blue;
  const them = duel.sides.red;
  const yourTurn = duel.phase === 'playing' && duel.active === 'blue';
  const picked = pick?.from === 'hand' ? cardOf.get(you.hand[pick.index] ?? '') : undefined;
  const wants = picked ? targetKind(picked) : pick?.from === 'board' ? 'enemy' : null;

  const onHand = (index: number) => {
    if (!yourTurn) return;
    const c = cardOf.get(you.hand[index] ?? '');
    if (!c || !canPlay(game, duel, index)) return;
    const kind = targetKind(c);
    const anyFriendly = you.board.length > 0;
    if (!kind || (kind === 'friendly' && !anyFriendly)) {
      setDuel(playCard(game, duel, index));
      setPick(null);
    } else setPick(pick?.from === 'hand' && pick.index === index ? null : { from: 'hand', index });
  };
  const onTarget = (side: Side, target: Target) => {
    if (!yourTurn || !pick) return;
    if (pick.from === 'hand') {
      if ((wants === 'enemy' && side !== 'red') || (wants === 'friendly' && side !== 'blue')) return;
      setDuel(playCard(game, duel, pick.index, target));
      setPick(null);
    } else if (side === 'red') {
      setDuel(attack(game, duel, pick.uid, target));
      setPick(null);
    }
  };
  const onOwnMinion = (uid: number) => {
    if (pick?.from === 'hand' && wants === 'friendly') return onTarget('blue', uid);
    if (!yourTurn) return;
    const m = you.board.find((x) => x.uid === uid);
    if (!m?.canAttack || m.attack <= 0) return;
    setPick(pick?.from === 'board' && pick.uid === uid ? null : { from: 'board', uid });
  };
  const aimable = (side: Side, target: Target) => {
    if (!pick || !yourTurn) return false;
    if (pick.from === 'board') return side === 'red' && canAttack(duel, pick.uid, target);
    return (wants === 'enemy' && side === 'red') || (wants === 'friendly' && side === 'blue' && target !== 'hero');
  };

  const status = duel.phase === 'over' ? (duel.winner === 'blue' ? 'You won!' : duel.winner === 'red' ? 'They won' : 'A draw') : yourTurn ? (pick ? (pick.from === 'board' ? 'Pick what to attack' : 'Pick a target') : 'Your turn') : 'Their turn…';
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const decided = report.wins.blue + report.wins.red;
  const rows = report.cards.map((st) => ({ st, card: cardOf.get(st.cardId)! })).filter((r) => r.card);

  const minions = (side: Side) =>
    duel.sides[side].board.map((m) => {
      const c = cardOf.get(m.cardId);
      if (!c) return null;
      const selected = pick?.from === 'board' && pick.uid === m.uid;
      const ready = side === 'blue' && yourTurn && m.canAttack && m.attack > 0;
      return (
        <button
          key={m.uid}
          className={`crd-slot${selected ? ' on' : ''}${aimable(side, m.uid) ? ' aim' : ''}${ready ? ' ready' : ''}${m.guard ? ' guard' : ''}`}
          aria-label={`${side === 'blue' ? 'Your' : 'Their'} ${c.name}, ${m.attack} attack, ${m.health} health${m.guard ? ', guard' : ''}`}
          onClick={() => (side === 'blue' ? onOwnMinion(m.uid) : onTarget('red', m.uid))}
        >
          <CardFace card={c} size="small" attack={m.attack} health={m.health} hurt={m.health < m.maxHealth} />
        </button>
      );
    });

  return (
    <div className="dfn-play">
      <div className="dfn-play-main crd-table">
        <div className="dfn-hud" role="status">
          <span className="dfn-hud-wave">{status}</span>
          <span>Turn {Math.ceil(duel.turn / 2)}</span>
        </div>
        <div className="crd-row crd-them">
          <button className={`crd-hero red${aimable('red', 'hero') ? ' aim' : ''}`} aria-label={`Their hero, ${them.hero} health`} onClick={() => onTarget('red', 'hero')}>
            ♥ {them.hero}
          </button>
          <span className="dfn-hint">
            {them.hand.length} in hand · {them.deck.length} in deck · {them.mana}/{them.maxMana < 0 ? 0 : them.maxMana} mana
          </span>
        </div>
        <div className="crd-board red" aria-label="Their board">
          {minions('red')}
        </div>
        <div className="crd-board blue" aria-label="Your board">
          {minions('blue')}
        </div>
        <div className="crd-row">
          <button className={`crd-hero blue${aimable('blue', 'hero') ? ' aim' : ''}`} aria-label={`Your hero, ${you.hero} health`} disabled>
            ♥ {you.hero}
          </button>
          <span className="crd-mana" aria-label={`${you.mana} of ${Math.max(0, you.maxMana)} mana`}>
            {Array.from({ length: Math.max(0, you.maxMana) }, (_, i) => (
              <span key={i} className={i < you.mana ? 'full' : ''} />
            ))}
            <em>
              {you.mana}/{Math.max(0, you.maxMana)}
            </em>
          </span>
          <span className="dfn-hint">{you.deck.length} in deck</span>
          <button className="tb-btn primary" disabled={!yourTurn} onClick={() => (setPick(null), setDuel(endTurn(game, duel)))}>
            End turn
          </button>
          {pick ? (
            <button className="tb-btn" onClick={() => setPick(null)}>
              Cancel
            </button>
          ) : null}
        </div>
        <div className="crd-hand" aria-label="Your hand">
          {you.hand.map((id, i) => {
            const c = cardOf.get(id);
            if (!c) return null;
            const playable = yourTurn && canPlay(game, duel, i);
            return (
              <button key={`${id}${i}`} className={`crd-slot${pick?.from === 'hand' && pick.index === i ? ' on' : ''}${playable ? ' ready' : ' dim'}`} aria-label={`${c.name}, costs ${c.cost}`} onClick={() => onHand(i)}>
                <CardFace card={c} />
              </button>
            );
          })}
        </div>
        <div className="dfn-controls">
          <button className="tb-btn" onClick={() => setSeed((s) => s + 1)}>
            New game
          </button>
          <label className="dfn-check">
            <input type="checkbox" checked={first === 'red'} onChange={(e) => setFirst(e.target.checked ? 'red' : 'blue')} /> They go first
          </label>
        </div>
        <ol className="crd-log" aria-label="What happened">
          {duel.log.slice(-6).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
      <aside className="dfn-play-side">
        <h3>{GAMES} games</h3>
        <p className="dfn-hint">The studio plays both decks against each other, each going first in turn.</p>
        <p className={`dfn-verdict ${Math.abs(report.wins.blue - report.wins.red) <= GAMES * 0.1 ? 'won' : 'lost'}`}>
          Your deck wins {pct(report.wins.blue / GAMES)}, theirs {pct(report.wins.red / GAMES)}
          {report.wins.draw ? `, ${report.wins.draw} draws` : ''}. Going first wins {pct(report.firstShare)}. Games last about {Math.round(report.turns / 2)} turns each.
        </p>
        {decided && (report.firstShare > 0.6 || report.firstShare < 0.4) ? <p className="dfn-hint">Going {report.firstShare > 0.6 ? 'first' : 'second'} is worth a lot: give the other side more (an extra card, a mana boost).</p> : null}
        <table className="dfn-table">
          <thead>
            <tr>
              <th>Card</th>
              <th title="Against the usual curve: + is more than its cost buys">Curve</th>
              <th title="Games a side played it in">Played</th>
              <th title="Of those, how often that side won">Won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ st, card }) => {
              const rate = st.games ? st.wins / st.games : 0;
              const d = curveDelta(card);
              return (
                <tr key={card.id} className={st.games >= 10 && (rate >= 0.6 || rate <= 0.4) ? 'leaky' : ''}>
                  <td>{card.name}</td>
                  <td>{d > 0 ? `+${d}` : d}</td>
                  <td>{st.games}</td>
                  <td>{st.games ? pct(rate) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dfn-hint">Played counts each side of each game ({GAMES * 2} in all) that played the card; Won is how often that side won. A card won with far more or less than half the time is the one to look at. A card never played is in no deck, or the studio always holds it.</p>
      </aside>
    </div>
  );
};
