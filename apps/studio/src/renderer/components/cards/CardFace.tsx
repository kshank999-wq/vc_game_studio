import { cardText, type Card } from '../../model/cards/cards';

/**
 * A card as the player sees it: cost, name, rules text, and a minion's
 * attack and health. On the board a minion shows what it has now, which can
 * differ from the card.
 */
export const CardFace = ({ card, size = 'full', attack, health, hurt = false, className = '' }: { card: Card; size?: 'full' | 'small'; attack?: number; health?: number; hurt?: boolean; className?: string }) => {
  const text = cardText(card);
  return (
    <div className={`crd-card ${card.kind} ${size} ${className}`.trim()}>
      <span className="crd-cost" aria-label={`Costs ${card.cost}`}>
        {card.cost}
      </span>
      <span className="crd-name">{card.name}</span>
      {size === 'full' ? <span className="crd-kind">{card.kind === 'minion' ? 'Minion' : 'Spell'}</span> : null}
      {text ? <span className="crd-text">{text}</span> : null}
      {card.kind === 'minion' ? (
        <>
          <span className="crd-attack" aria-label={`Attack ${attack ?? card.attack}`}>
            {attack ?? card.attack}
          </span>
          <span className={`crd-health${hurt ? ' hurt' : ''}`} aria-label={`Health ${health ?? card.health}`}>
            {health ?? card.health}
          </span>
        </>
      ) : null}
    </div>
  );
};
