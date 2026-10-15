/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBible } from '../components/bible/GameBible';
import { buildIR } from '../model/handoff/ir';
import { sunkenVault } from '../model/sample';
import type { Project } from '../model/types';

afterEach(cleanup);

const lineSaying = (p: Project, words: string) => p.lines.find((l) => l.text.startsWith(words))!;
const open = (p: Project, focus: string) => render(<GameBible project={p} onCommit={() => {}} focus={focus} onNavigate={() => {}} onOpenCode={() => {}} onDelete={() => {}} />);

describe('subtitles in the Game Bible', () => {
  it('a line’s detail shows its subtitle as the engines get it, and how long it shows', () => {
    const p = sunkenVault();
    const mara = lineSaying(p, 'Water’s holding');
    const { container } = open(p, mara.id);
    const field = screen.getByRole('group', { name: 'Subtitle' });
    const handed = buildIR(p).lines.find((l) => l.id === 'sc_03_line_02')!;
    expect(within(field).getByText(handed.subtitle)).toBeTruthy();
    expect(field.textContent).toContain('Shows for 2.5s: its take’s length');
    // The list's row says it too.
    const row = [...container.querySelectorAll('.bible-row-sub')].map((r) => r.textContent).find((t) => t?.includes('#2') && t.includes('SC-03'));
    expect(row).toContain('subtitle 2.5s');
  });

  it('without a take: the time to read it', () => {
    const p = sunkenVault();
    const bare = { ...p, lines: p.lines.map(({ take: _t, ...l }) => l) };
    open(bare, lineSaying(bare, 'Water’s holding').id);
    expect(screen.getByRole('group', { name: 'Subtitle' }).textContent).toContain('Shows for 3.85s: the time to read it');
  });
});
