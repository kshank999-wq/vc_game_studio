import type { Footfall } from '../../model/level/footsteps';

/**
 * The player's footsteps in Play Mode, made on the spot with Web Audio (no
 * sound files): a short thud and a scuff of filtered noise, a run louder and
 * brighter than a walk, each step a little different, left and right feet a
 * touch apart. Silent where there is no Web Audio (tests, old browsers).
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let scuff: AudioBuffer | null = null;

const context = (): Ctx | null => {
  if (ctx) return ctx;
  const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    return null;
  }
  return ctx;
};

/** A tenth of a second of noise that dies away: the scuff of a sole on the floor. */
const scuffOf = (c: Ctx): AudioBuffer => {
  if (scuff) return scuff;
  const length = Math.floor(c.sampleRate * 0.12);
  scuff = c.createBuffer(1, length, c.sampleRate);
  const data = scuff.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  return scuff;
};

/** Sound one step at this volume (0 for off). */
export const playFootstep = (step: Footfall, volume: number): void => {
  if (volume <= 0) return;
  const c = context();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const now = c.currentTime;
  const level = volume * (0.25 + step.loud * 0.45);
  const out = c.createGain();
  out.gain.value = level;
  let tail: AudioNode = out;
  if (typeof c.createStereoPanner === 'function') {
    const pan = c.createStereoPanner();
    pan.pan.value = step.foot === 0 ? -0.12 : 0.12;
    out.connect(pan);
    tail = pan;
  }
  tail.connect(c.destination);

  // The scuff: noise through a low-pass, brighter for a run.
  const noise = c.createBufferSource();
  noise.buffer = scuffOf(c);
  noise.playbackRate.value = 0.85 + Math.random() * 0.3;
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 450 + step.loud * 1100 + Math.random() * 150;
  const scuffGain = c.createGain();
  scuffGain.gain.setValueAtTime(0.0001, now);
  scuffGain.gain.exponentialRampToValueAtTime(1, now + 0.006);
  scuffGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
  noise.connect(tone).connect(scuffGain).connect(out);
  noise.start(now);
  noise.stop(now + 0.15);

  // The thud: a low sine falling in pitch as the heel lands.
  const thud = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(95 + Math.random() * 15, now);
  thud.frequency.exponentialRampToValueAtTime(45, now + 0.08);
  const thudGain = c.createGain();
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.8, now + 0.004);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  thud.connect(thudGain).connect(out);
  thud.start(now);
  thud.stop(now + 0.1);
};
