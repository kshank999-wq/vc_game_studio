import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasAudio, takeSource } from '../audio-takes';
import { sunkenVault } from '../sample';
import { SAMPLE_TAKES, sampleTakeKey } from '../sample-takes';
import { lineKey } from '../script-export';

const dir = join(__dirname, '../../assets/sample-takes');

describe('the sample’s takes', () => {
  it('every line the sample says is recorded, its take named for the line', () => {
    const p = sunkenVault();
    const said = p.lines.filter((l) => l.kind === 'dialogue');
    expect(said.length).toBe(Object.keys(SAMPLE_TAKES).length);
    for (const l of said) {
      expect(l.vo).toBe('recorded');
      expect(l.take?.name).toBe(`${lineKey(p, l)}.mp3`);
      expect(sampleTakeKey(l.take!.id)).toBe(lineKey(p, l));
    }
  });

  it('each take is an MP3 the app ships, the size the line says', () => {
    for (const [key, t] of Object.entries(SAMPLE_TAKES)) {
      const file = join(dir, `${key}.mp3`);
      expect(statSync(file).size).toBe(t.bytes);
      // An MPEG audio frame (or an ID3 tag) at the start.
      const head = readFileSync(file).subarray(0, 3);
      expect(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)).toBe(true);
    }
  });

  it('is heard from the app’s own files, on any computer', async () => {
    const take = sunkenVault().lines.find((l) => l.take)!.take!;
    expect(await hasAudio(take.id)).toBe(true);
    expect((await takeSource(take.id))?.url).toMatch(/sc_\d\d_line_\d\d.*\.mp3/);
    expect(await hasAudio('take_sample_nope')).toBe(false);
  });
});
