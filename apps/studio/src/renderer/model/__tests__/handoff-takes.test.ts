import { describe, expect, it } from 'vitest';
import { attachTake, putAudio } from '../audio-takes';
import { engineById, planHandoff, setTarget } from '../handoff';
import { buildIR } from '../handoff/ir';
import { unityPackage } from '../handoff/package';
import { encodeWav, gatherTakes, takePlan } from '../handoff/takes';
import { gunzipSync } from 'node:zlib';
import { sunkenVault } from '../sample';
import type { EngineId, Project } from '../types';

const forEngine = (engine: EngineId): Project => setTarget(sunkenVault(), { engine });
const fileOf = (p: Project, path: string) => planHandoff(p).output!.files.find((f) => f.path === path)!.content;

describe('recorded takes in the engine handoff', () => {
  it('each line names its take, and the take goes where the engine looks for it', () => {
    const ir = buildIR(sunkenVault());
    expect(ir.lines.find((l) => l.id === 'sc_03_line_02')!.audio).toBe('vo/sc_03_line_02.mp3');
    const where = (engine: EngineId) => takePlan(forEngine(engine), engineById(engine), engineById(engine).defaultOutputPath).map((t) => t.path);
    expect(where('godot')).toContain('vcgs/generated/vo/sc_03_line_02.mp3');
    expect(where('unity')).toContain('Assets/VCGS/Generated/Resources/VCGS/vo/sc_03_line_02.mp3');
    expect(where('unreal')).toContain('VCGS/SourceAudio/vo/sc_03_line_02.wav');
    expect(where('custom')).toContain('vcgs/vo/sc_03_line_02.mp3');
    expect(where('godot')).toHaveLength(6);
  });

  it('every engine’s data points at the take', () => {
    expect(fileOf(forEngine('godot'), 'vcgs/generated/dialogue/dialogue_table.gd')).toContain('"audio": "res://vcgs/generated/vo/sc_03_line_02.mp3"');
    expect(fileOf(forEngine('godot'), 'vcgs/generated/dialogue/dialogue_table.gd')).toContain('static func audio(line_id: String) -> AudioStream:');
    const unity = JSON.parse(fileOf(forEngine('unity'), 'Assets/VCGS/Generated/story.json'));
    expect(unity.lines.find((l: { id: string }) => l.id === 'sc_03_line_02').audio).toBe('VCGS/vo/sc_03_line_02');
    const unreal = forEngine('unreal');
    expect(JSON.parse(fileOf(unreal, 'Content/VCGS/Generated/story.json')).lines.find((l: { id: string }) => l.id === 'sc_03_line_02').audio).toBe('/Game/VCGS/VO/sc_03_line_02.sc_03_line_02');
    expect(fileOf(unreal, 'Content/VCGS/Generated/DataTables/Lines.csv').split('\n')[0]).toMatch(/,Audio$/);
    expect(fileOf(unreal, 'Content/VCGS/Generated/import_vo.py')).toContain('DESTINATION = "/Game/VCGS/VO"');
  });

  it('Unity and Unreal each get a debug player that plays the takes', () => {
    const unity = planHandoff(forEngine('unity')).output!.files;
    const player = unity.find((f) => f.path.endsWith('/VcgsDebugPlayer.cs'))!.content as string;
    expect(player).toContain('StoryWalker.Voice(VcgsGame.Instance.State, id)');
    expect(unity.find((f) => f.path.endsWith('README.md'))!.content).toContain('VcgsDebugPlayer');
    const unreal = planHandoff(forEngine('unreal')).output!.files;
    const hud = unreal.find((f) => f.path.endsWith('/Private/VcgsDebugHUD.cpp'))!.content as string;
    expect(hud).toContain('UGameplayStatics::SpawnSound2D(this, Sound)');
    expect(unreal.find((f) => f.path.endsWith('/Public/VcgsCore.h'))!.content).toContain('class DebugStory');
    expect(unreal.find((f) => f.path.endsWith('README.md'))!.content).toContain('AVcgsDebugHUD');
  });

  it('the handoff screen lists them as a row of their own, which changes when a take does', () => {
    const p = forEngine('godot');
    const row = planHandoff(p).rows.find((r) => r.id === 'takes')!;
    expect(row.label).toBe('Recorded takes (6)');
    expect(row.files).toHaveLength(6);
    const line = p.lines.find((l) => l.take)!;
    const changed = attachTake(p, line.id, { ...line.take!, id: 'take_new', bytes: 99 });
    expect(planHandoff(changed).rows.find((r) => r.id === 'takes')!.fingerprint).not.toBe(row.fingerprint);
  });

  it('gathers the audio; leaves out what isn’t here; WAV for the engines that want it', async () => {
    let p = forEngine('unreal');
    const [a, b] = p.lines.filter((l) => l.take);
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 8000);
    await putAudio('take_wav', new Blob([wav.slice()]));
    await putAudio('take_mp3', new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])]));
    p = attachTake(p, a!.id, { ...a!.take!, id: 'take_wav', name: 'a.wav' });
    p = attachTake(p, b!.id, { ...b!.take!, id: 'take_mp3', name: 'b.mp3' });
    p = { ...p, lines: p.lines.map((l) => (l.take && l.id !== a!.id && l.id !== b!.id ? { ...l, take: { ...l.take, id: 'take_gone' } } : l)) };
    const plan = takePlan(p, engineById('unreal'), 'Content/VCGS/Generated');
    const r = await gatherTakes(plan, true);
    // A WAV goes as it is; an MP3 this browser can't decode (no audio here) goes as MP3, and says so.
    expect(r.files.find((f) => f.path.endsWith('.wav'))!.content).toEqual(wav);
    expect(r.files.some((f) => f.path.endsWith('.mp3'))).toBe(true);
    expect(r.unconverted).toHaveLength(1);
    expect(r.missing).toHaveLength(4);
  });

  it('WAV: a valid 16-bit PCM file', () => {
    const w = encodeWav([new Float32Array([0, 1]), new Float32Array([0, -1])], 22050);
    const v = new DataView(w.buffer);
    expect(new TextDecoder().decode(w.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(40, true)).toBe(8);
    // Interleaved: left, right, left, right.
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 0, 32767, -32768]);
  });

  it('a Unity package carries an audio file as it is', async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
    const pkg = gunzipSync(await unityPackage([{ path: 'Assets/VCGS/Generated/Resources/VCGS/vo/x.mp3', content: bytes }]));
    const at = Buffer.from(pkg).indexOf(Buffer.from([0xff, 0xfb, 1, 2, 3]));
    expect(at).toBeGreaterThan(0);
  });
});
