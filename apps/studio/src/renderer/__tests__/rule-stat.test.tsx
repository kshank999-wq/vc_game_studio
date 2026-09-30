/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RuleEditor } from '../components/rules/RuleEditor';
import type { Rule } from '../model/rules';
import { sunkenVault } from '../model/sample';

afterEach(cleanup);

describe('a stat condition in the rule editor', () => {
  it('chooses from the stats equipment has, and a number to compare with', () => {
    const project = sunkenVault();
    let last: Rule | undefined;
    const Harness = () => {
      const [rule, setRule] = useState<Rule | undefined>();
      return <RuleEditor project={project} rule={rule} label="Plays when" onChange={(r) => { last = r; setRule(r); }} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ Condition' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'About' }), { target: { value: 'stat' } });
    const stat = screen.getByRole('combobox', { name: 'Stat' }) as HTMLSelectElement;
    expect([...stat.options].map((o) => o.value)).toEqual(['Damage', 'Light']);
    fireEvent.change(stat, { target: { value: 'Light' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Test' }), { target: { value: 'below' } });
    const value = screen.getByRole('spinbutton', { name: 'Stat value' });
    fireEvent.change(value, { target: { value: '3' } });
    fireEvent.blur(value);
    expect(last).toEqual({ match: 'all', items: [{ kind: 'stat', ref: 'Light', op: 'below', value: 3 }] });
    expect(screen.getByText('Light is below 3')).toBeTruthy();
  });
});
