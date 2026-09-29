/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBible } from '../components/bible/GameBible';
import { sunkenVault } from '../model/sample';
import type { Project } from '../model/types';

afterEach(cleanup);

const open = (start: Project, name: string) => {
  const seen = { project: start };
  const focus = Object.values(start.objects).find((o) => o.name === name)!.id;
  const Harness = () => {
    const [project, setProject] = useState(start);
    seen.project = project;
    return <GameBible project={project} onCommit={setProject} focus={focus} onNavigate={() => {}} onOpenCode={() => {}} onDelete={() => {}} />;
  };
  render(<Harness />);
  return { seen, focus };
};

describe('Only by an effect', () => {
  it('stands in for a quest\'s start rule, and switches back to it', () => {
    const { seen, focus } = open(sunkenVault(), 'Open the vault');
    const box = screen.getByRole('checkbox', { name: /Only by an effect/ }) as HTMLInputElement;
    // The sample's quest starts when the key is found (an effect), so its start rule is hidden.
    expect(box.checked).toBe(true);
    expect(screen.getByText('Starts only when an effect starts it')).toBeTruthy();
    expect(screen.queryByText(/Starts when/)).toBeNull();
    expect(screen.getByText('Complete when')).toBeTruthy();
    fireEvent.click(box);
    expect(seen.project.objects[focus]!.data.byEffect).toBeUndefined();
    expect(screen.getByText(/Starts when/)).toBeTruthy();
  });

  it('stands in for a mechanic\'s rule', () => {
    open(sunkenVault(), 'Lantern oil');
    expect((screen.getByRole('checkbox', { name: /Only by an effect/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Available only when an effect makes it available')).toBeTruthy();
    expect(screen.queryByText(/Available when/)).toBeNull();
  });
});
