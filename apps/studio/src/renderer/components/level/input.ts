import type { PlayControlPrefs } from '../../preferences';

/**
 * Play Mode's input abstraction (spec §9.2): actions, not keys. Each action
 * has keyboard keys and gamepad buttons, both rebindable; movement and look
 * also read the gamepad's sticks. The defaults are the usual ones: WASD and
 * the mouse, a standard-layout controller.
 */

export type Action = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight' | 'jump' | 'run' | 'interact' | 'inspect' | 'debug' | 'note' | 'view';

export const ACTIONS: readonly { id: Action; label: string }[] = [
  { id: 'forward', label: 'Move forward' },
  { id: 'back', label: 'Move back' },
  { id: 'left', label: 'Step left' },
  { id: 'right', label: 'Step right' },
  { id: 'turnLeft', label: 'Turn left' },
  { id: 'turnRight', label: 'Turn right' },
  { id: 'jump', label: 'Jump' },
  { id: 'run', label: 'Run' },
  { id: 'interact', label: 'Interact' },
  { id: 'inspect', label: 'Pause and inspect' },
  { id: 'debug', label: 'Debug overlay' },
  { id: 'note', label: 'Note an issue' },
  { id: 'view', label: 'Change perspective' },
];

export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft', 'KeyQ'],
  turnRight: ['ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE', 'KeyF'],
  inspect: ['Tab', 'KeyP'],
  debug: ['F3', 'Backquote'],
  note: ['KeyN'],
  view: ['KeyV'],
};

/** Standard gamepad layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 10 L-stick. */
export const DEFAULT_PAD: Record<Action, number[]> = {
  forward: [12],
  back: [13],
  left: [14],
  right: [15],
  turnLeft: [],
  turnRight: [],
  jump: [0],
  run: [10, 4],
  interact: [2, 1],
  inspect: [9],
  debug: [8],
  note: [],
  view: [3],
};

export interface Controls {
  keys: Record<Action, string[]>;
  pad: Record<Action, number[]>;
  lookSpeed: number;
  invertY: boolean;
  deadzone: number;
}

/** The defaults with what this computer changed. */
export const controlsOf = (prefs: PlayControlPrefs): Controls => ({
  keys: { ...DEFAULT_KEYS, ...(prefs.keys as Partial<Record<Action, string[]>>) },
  pad: { ...DEFAULT_PAD, ...(prefs.pad as Partial<Record<Action, number[]>>) },
  lookSpeed: prefs.lookSpeed || 1,
  invertY: !!prefs.invertY,
  deadzone: prefs.deadzone ?? 0.18,
});

export const actionOfKey = (controls: Controls, code: string): Action | undefined =>
  (Object.keys(controls.keys) as Action[]).find((a) => controls.keys[a].includes(code));

/** "KeyW" → "W", "ArrowUp" → "↑". */
export const keyLabel = (code: string): string =>
  code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ShiftLeft', 'Shift')
    .replace('ShiftRight', 'Right Shift')
    .replace('Backquote', '`')
    .replace('Space', 'Space');

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L-stick', 'R-stick', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
export const padLabel = (button: number): string => PAD_NAMES[button] ?? `Button ${button}`;

export interface PadState {
  connected: boolean;
  /** Left stick: move. */
  moveX: number;
  moveY: number;
  /** Right stick: look. */
  lookX: number;
  lookY: number;
  pressed: Set<Action>;
  buttons: boolean[];
}

const dead = (v: number, zone: number) => (Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone));

/** Read the first connected gamepad, if any. */
export const readPad = (controls: Controls): PadState => {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...(pads ?? [])].find((p): p is Gamepad => !!p && p.connected);
  if (!pad) return { connected: false, moveX: 0, moveY: 0, lookX: 0, lookY: 0, pressed: new Set(), buttons: [] };
  const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
  const pressed = new Set<Action>();
  for (const a of Object.keys(controls.pad) as Action[]) if (controls.pad[a].some((i) => buttons[i])) pressed.add(a);
  const z = controls.deadzone;
  return {
    connected: true,
    moveX: dead(pad.axes[0] ?? 0, z),
    moveY: dead(pad.axes[1] ?? 0, z),
    lookX: dead(pad.axes[2] ?? 0, z),
    lookY: dead(pad.axes[3] ?? 0, z),
    pressed,
    buttons,
  };
};
