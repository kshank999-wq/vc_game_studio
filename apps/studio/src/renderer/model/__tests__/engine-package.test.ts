import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { sunkenVault } from '../sample';
import { planHandoff, setTarget } from '../handoff';
import { packageFor, tar } from '../handoff/package';

/** The entries of an uncompressed tar: name and content. */
const untar = (bytes: Uint8Array) => {
  const out: { name: string; text: string }[] = [];
  const decoder = new TextDecoder();
  for (let at = 0; at + 512 <= bytes.length; ) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
    const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/s, ''), 8);
    // The checksum: the header's bytes summed with its own field as spaces.
    const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    expect(parseInt(decoder.decode(header.subarray(148, 154)), 8)).toBe(sum);
    out.push({ name, text: decoder.decode(bytes.subarray(at + 512, at + 512 + size)) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
};

const filesFor = (engine: 'godot' | 'unity' | 'unreal') => planHandoff(setTarget(sunkenVault(), { engine })).output!.files;

describe('a file to import into each engine', () => {
  it('Unity: a .unitypackage with every asset, folder and .meta under its GUID', async () => {
    const files = filesFor('unity');
    const pkg = await packageFor('unity', 'The Sunken Vault', files);
    expect(pkg.fileName).toBe('the-sunken-vault-unity.unitypackage');
    const entries = untar(gunzipSync(pkg.bytes));
    const byGuid = new Map<string, Record<string, string>>();
    for (const e of entries) {
      const [guid, part] = e.name.split('/');
      byGuid.set(guid!, { ...(byGuid.get(guid!) ?? {}), [part!]: e.text });
    }
    const assets = files.filter((f) => !f.path.endsWith('.meta'));
    expect([...byGuid.values()].filter((g) => 'asset' in g).length).toBe(assets.length);
    for (const [guid, g] of byGuid) {
      expect(g['asset.meta']).toContain(`guid: ${guid}`);
      expect(g.pathname!.startsWith('Assets/')).toBe(true);
      const source = files.find((f) => f.path === g.pathname);
      if (source) expect(g.asset).toBe(source.content);
    }
  });

  it('Godot: a .zip with one root folder, which its installer leaves out', async () => {
    const pkg = await packageFor('godot', 'The Sunken Vault', filesFor('godot'));
    const text = new TextDecoder().decode(pkg.bytes);
    expect(text).toContain('the-sunken-vault/addons/vcgs_runtime/plugin.cfg');
    expect(text).toContain('the-sunken-vault/vcgs/generated/play_story.tscn');
    expect(pkg.steps.join(' ')).toContain('VCGS Runtime');
  });

  it('Unreal: a .zip of Plugins and Content, to unzip beside the .uproject', async () => {
    const pkg = await packageFor('unreal', 'The Sunken Vault', filesFor('unreal'));
    const text = new TextDecoder().decode(pkg.bytes);
    expect(text).toContain('Plugins/VCGS/VCGS.uplugin');
    expect(pkg.fileName).toBe('the-sunken-vault-unreal.zip');
  });

  it('writes tar headers a reader accepts', () => {
    const t = tar([{ name: 'a/asset', data: new TextEncoder().encode('hello') }]);
    expect(untar(t)).toEqual([{ name: 'a/asset', text: 'hello' }]);
    expect(t.length % 512).toBe(0);
  });
});
