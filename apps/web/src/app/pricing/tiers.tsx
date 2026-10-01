'use client';

import { useState } from 'react';
import type { Interval, Plan } from '@/lib/env';

interface Tier {
  plan: Plan;
  name: string;
  tagline: string;
  features: string[];
  prices: Partial<Record<Interval, string>>;
}

export function PricingTiers({ tiers, signedIn }: { tiers: Tier[]; signedIn: boolean }) {
  const [interval, setInterval] = useState<Interval>('year');
  const [busy, setBusy] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscribe = async (plan: Plan) => {
    setError(null);
    if (!signedIn) {
      window.location.href = `/signin?next=${encodeURIComponent('/pricing')}`;
      return;
    }
    setBusy(plan);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string; signIn?: boolean };
      if (body.signIn) {
        window.location.href = `/signin?next=${encodeURIComponent('/pricing')}`;
        return;
      }
      if (!response.ok || !body.url) throw new Error(body.error ?? 'Checkout could not be started');
      window.location.href = body.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  return (
    <>
      <div className="toggle" role="group" aria-label="Billing">
        <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
          Monthly
        </button>
        <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
          Yearly
        </button>
      </div>
      <div className="tiers">
        {tiers.map((tier) => (
          <div key={tier.plan} className={`panel tier${tier.plan === 'studio' ? ' featured' : ''}`}>
            <div className="eyebrow">{tier.plan === 'studio' ? 'Everything, plus engines' : 'The design tool'}</div>
            <h2>{tier.name}</h2>
            <p className="muted">{tier.tagline}</p>
            <div className="price">
              {tier.prices[interval] ?? '—'} <small>/ {interval === 'year' ? 'year' : 'month'}</small>
            </div>
            <ul>
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button type="button" className={tier.plan === 'studio' ? 'button' : 'button secondary'} disabled={busy !== null} onClick={() => void subscribe(tier.plan)}>
              {busy === tier.plan ? 'Opening checkout…' : signedIn ? `Subscribe to ${tier.name}` : `Sign in to subscribe`}
            </button>
          </div>
        ))}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
