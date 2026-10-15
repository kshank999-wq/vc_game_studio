/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { subtitlesFor, subtitleWho, takeGroups } from '../components/play/takes-player';
import { attachTake, putAudio } from '../model/audio-takes';
import { sunkenVault } from '../model/sample';
import { sceneLines } from '../model/scene';
import type { Project } from '../model/types';

/** What was played, as the take blobs' text, in order; and the audio elements still going. */
let played: string[] = [];
let live: HTMLAudioElement[] = [];
const blobs = new Map<string, string>();

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  let n = 0;
  URL.createObjectURL = (b: Blob) => {
    const url = `blob:test/${n++}`;
    blobs.set(url, (b as Blob & { label?: string }).label ?? '');
    return url;
  };
  URL.revokeObjectURL = () => {};
  HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
    played.push(blobs.get(this.src) ?? this.src);
    live.push(this);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function (this: HTMLAudioElement) {
    live = live.filter((a) => a !== this);
  };
});
beforeEach(() => {
  played = [];
  live = [];
  localStorage.clear();
});
afterEach(cleanup);

/** Every take of the sample's Vault Door, each audio saying whose line it is. */
const withTakes = async (): Promise<{ p: Project; vault: string }> => {
  let p = sunkenVault();
  const vault = Object.values(p.objects).find((o) => o.type === 'scene' && o.name === 'The Vault Door')!.id;
  for (const l of sceneLines(p, vault).filter((l) => l.kind === 'dialogue')) {
    const id = `take_${l.id}`;
    const blob = Object.assign(new Blob([l.text]), { label: l.text });
    await putAudio(id, blob);
    p = attachTake(p, l.id, { id, name: `${id}.wav`, type: 'audio/wav', bytes: 1, at: '' });
  }
  return { p, vault };
};

const toLine = (text: string) => {
  for (let i = 0; i < 8 && !screen.queryAllByText(text).length; i++) fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
};

describe('recorded takes in the play-through', () => {
  it('a dual line plays both voices at once; lines without takes are skipped', async () => {
    const { p, vault } = await withTakes();
    const entries = [{ kind: 'line', speaker: 'A', text: 'x', sceneId: vault, lineId: sceneLines(p, vault)[1]!.id, with: { speaker: 'B', text: 'y', lineId: sceneLines(p, vault)[2]!.id } }, { kind: 'line', speaker: 'C', text: 'z', sceneId: vault, lineId: 'nope' }] as const;
    expect(takeGroups(p, entries as never)).toEqual([[sceneLines(p, vault)[1]!.id, sceneLines(p, vault)[2]!.id]]);
  });

  it('lines speak as they come up, with a replay; Voices off keeps them quiet', async () => {
    const { p, vault } = await withTakes();
    render(<PlayView project={p} from={vault} onNavigate={() => {}} />);
    toLine('Stand back. I’ll find it.');
    await waitFor(() => expect(played).toEqual(expect.arrayContaining(['Water’s holding it shut. There’s a lever somewhere.', 'Stand back. I’ll find it.'])));
    expect(screen.getAllByLabelText('Speaking')).toHaveLength(2);
    // Finished: the voices go quiet.
    act(() => live.forEach((a) => a.onended?.(new Event('ended'))));
    await waitFor(() => expect(screen.queryAllByLabelText('Speaking')).toHaveLength(0));
    played = [];
    fireEvent.click(screen.getByRole('button', { name: /^Hear “Water’s holding/ }));
    await waitFor(() => expect(played).toHaveLength(2));
    // Off: the next line is read, not heard.
    fireEvent.click(screen.getByRole('button', { name: '🔊 Voices' }));
    played = [];
    // Step back and on again: the line comes up again, read only.
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.queryAllByText('Stand back. I’ll find it.')).toHaveLength(0);
    toLine('Stand back. I’ll find it.');
    await new Promise((r) => setTimeout(r, 20));
    expect(played).toEqual([]);
    expect(localStorage.getItem('vcgs.play.voices')).toBe('off');
  });

  it('subtitles show what each voice says while its take plays, and can be turned off', async () => {
    const { p, vault } = await withTakes();
    render(<PlayView project={p} from={vault} onNavigate={() => {}} />);
    toLine('Stand back. I’ll find it.');
    // Both voices of the dual line: a row each, Mara (left) first.
    const band = await screen.findByRole('status', { name: 'Subtitles' });
    const rows = [...band.querySelectorAll('.play-subtitle')].map((r) => r.textContent);
    expect(rows).toEqual(['Mara: Water’s holding it shut. There’s a lever somewhere.', 'The Explorer: Stand back. I’ll find it.']);
    // The takes end: the subtitles go.
    act(() => live.forEach((a) => a.onended?.(new Event('ended'))));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Subtitles' })).toBeNull());
    // Off: the takes play, the subtitles don't; remembered.
    fireEvent.click(screen.getByRole('button', { name: 'CC Subtitles' }));
    expect(localStorage.getItem('vcgs.play.subtitles')).toBe('off');
    played = [];
    fireEvent.click(screen.getByRole('button', { name: /^Hear “Water’s holding/ }));
    await waitFor(() => expect(played).toHaveLength(2));
    expect(screen.queryByRole('status', { name: 'Subtitles' })).toBeNull();
    // Voices off: no takes, so no subtitles and no switch for them.
    fireEvent.click(screen.getByRole('button', { name: '🔊 Voices' }));
    expect(screen.queryByRole('button', { name: 'CC Subtitles' })).toBeNull();
  });

  it('Play Mode’s beat: a subtitle for each voice speaking now, in the beat’s order', () => {
    const beat = [
      { speaker: 'Mara', text: 'Left.', lineId: 'a' },
      { speaker: 'The Explorer', text: 'Right.', lineId: 'b' },
    ];
    expect(subtitlesFor(beat, new Set(['b', 'a'])).map((r) => `${r.who}: ${r.text}`)).toEqual(['Mara: Left.', 'The Explorer: Right.']);
    // A voice without a take isn't speaking, so it has no subtitle.
    expect(subtitlesFor(beat, new Set(['b'])).map((r) => r.lineId)).toEqual(['b']);
    expect(subtitlesFor(beat, new Set())).toEqual([]);
  });

  it('a voiceover’s subtitle says where it plays from', () => {
    expect(subtitleWho({ speaker: 'Mara', text: '', lineId: 'a' })).toBe('Mara');
    expect(subtitleWho({ speaker: 'Radio', from: 'Radio', text: '', lineId: 'a' })).toBe('Radio (V.O.)');
    expect(subtitleWho({ speaker: 'Mara', from: 'Radio', text: '', lineId: 'a' })).toBe('Mara (V.O., Radio)');
    expect(subtitleWho({ speaker: null, text: '', lineId: 'a' })).toBe('');
  });

  it('no takes in the project: no Voices button', () => {
    const p = { ...sunkenVault(), lines: sunkenVault().lines.map(({ take: _t, ...l }) => l) };
    render(<PlayView project={p} onNavigate={() => {}} />);
    expect(screen.queryByRole('button', { name: /Voices/ })).toBeNull();
  });
});
