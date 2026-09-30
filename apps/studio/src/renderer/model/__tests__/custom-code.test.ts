import { describe, expect, it } from 'vitest';
import { customCode, customRegion, keepCustom, withoutCustom } from '../handoff/custom';
import { hunksOf, lineDiff, reviewSend, fileHash } from '../handoff/review';
import type { ExportRecord } from '../types';

const gd = (body: string, extra = '') => ['extends Node', `const NAME := "${body}"`, extra, ...customRegion('#'), ''].filter((l) => l !== '').join('\n') + '\n';
const withCode = (text: string, code: string, name = 'code') => text.replace(`# BEGIN CUSTOM: ${name}\n`, `# BEGIN CUSTOM: ${name}\n${code}\n`);

describe('custom code regions', () => {
  it('are two marker lines under a note', () => {
    expect(customRegion('//', 'keys', '    ')).toEqual([
      '    // Your own code goes between these two lines: VC Game Studio keeps it when it exports again.',
      '    // BEGIN CUSTOM: keys',
      '    // END CUSTOM: keys',
    ]);
  });

  it('read each region’s code by name, and empty them', () => {
    const text = withCode(gd('a'), 'func extra() -> int:\n\treturn 1');
    expect(customCode(text).get('code')).toBe('func extra() -> int:\n\treturn 1');
    expect(withoutCustom(text)).toBe(gd('a'));
    expect(customCode('no regions here').size).toBe(0);
  });

  it('carry the code over into a newly generated file', () => {
    const old = withCode(gd('old name'), 'var mine := 3');
    const merged = keepCustom(gd('new name'), old);
    expect(merged.kept).toEqual(['code']);
    expect(merged.content).toBe(withCode(gd('new name'), 'var mine := 3'));
    // Nothing there, or nothing in the region: the file as generated.
    expect(keepCustom(gd('x'), null)).toEqual({ content: gd('x'), kept: [], moved: [], lost: [] });
    expect(keepCustom(gd('x'), gd('y')).kept).toEqual([]);
  });

  it('keep code from a region the new file no longer has in its first region, or say it has nowhere to go', () => {
    const old = withCode(['extends Node', ...customRegion('#', 'hooks'), ''].join('\n'), 'func hook() -> void:\n\tpass', 'hooks');
    const merged = keepCustom(gd('a'), old);
    expect(merged.moved).toEqual(['hooks']);
    expect(customCode(merged.content).get('code')).toBe('# (Kept from the custom region "hooks", which this file no longer has.)\nfunc hook() -> void:\n\tpass');
    expect(keepCustom('extends Node\n', old).lost).toEqual(['hooks']);
  });
});

describe('the review before sending', () => {
  it('diffs line by line, and gathers the changes with a little context', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nx\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const changed = [...long];
    changed[10] = 'changed';
    const hunks = hunksOf(lineDiff(long.join('\n'), changed.join('\n')), 2);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.at).toBe(9);
    expect(hunks[0]!.lines.map((l) => l.kind)).toEqual(['same', 'same', 'del', 'add', 'same', 'same']);
  });

  it('says what is new, changed or the same, carries custom code over, and finds edits made outside the regions', () => {
    const files = [
      { path: 'a.gd', content: gd('a2'), kind: 'generated' as const },
      { path: 'b.gd', content: gd('b'), kind: 'generated' as const },
      { path: 'c.gd', content: gd('c2'), kind: 'generated' as const },
      { path: 'new.gd', content: gd('n'), kind: 'generated' as const },
    ];
    const last: ExportRecord = { at: '', engine: 'godot', fingerprints: {}, files: 3, fileHashes: { 'a.gd': fileHash(gd('a')), 'b.gd': fileHash(gd('b')), 'c.gd': fileHash(gd('c')) } };
    const onDisk = {
      // Custom code only: kept, and not an edit.
      'a.gd': withCode(gd('a'), 'var mine := 1'),
      // As written, and nothing new: the same.
      'b.gd': gd('b'),
      // Changed outside the region in the engine.
      'c.gd': gd('c', '# a line added in Godot'),
      'new.gd': null,
    };
    const review = reviewSend(files, onDisk, last);
    const by = (p: string) => review.files.find((f) => f.path === p)!;
    expect(by('a.gd')).toMatchObject({ status: 'changed', kept: ['code'], edited: false, added: 1, removed: 1 });
    expect(by('a.gd').content).toBe(withCode(gd('a2'), 'var mine := 1'));
    expect(by('b.gd')).toMatchObject({ status: 'same', edited: false });
    expect(by('c.gd')).toMatchObject({ status: 'changed', edited: true });
    expect(by('new.gd')).toMatchObject({ status: 'new', added: gd('n').split('\n').length - 1 });
    expect(review).toMatchObject({ changes: 3, kept: 1, edited: ['c.gd'], lost: [] });
  });
});
