import { addInteraction, interactionsOf, setField, setNotes, setSceneUse, setStates, toggleTag, updateInteraction } from './details';
import { spineLane } from './layout';
import { addLane, connect, createProject, placeNew, relabelConnection, renameObject, setOutcome, setPolarity, setSpanEdge, updateLane } from './project';
import { addElement, addLine, setSceneData, updateLine, useInScene } from './scene';
import { addBranch, addEvent, moveEvent, sceneTimeline, updateBranch, updateEvent } from './timeline';
import type { ObjectType, Project } from './types';

/**
 * "The Sunken Vault", the sample from the mockups, built with the same
 * operations the app uses. It opens as a sample project and it is what the
 * engine handoff is checked against.
 */
export const sunkenVault = (): Project => {
  let p = createProject('The Sunken Vault');
  const spine = spineLane(p).id;
  const byName = (name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;
  const rename = (id: string, name: string) => {
    p = renameObject(p, id, name);
    return id;
  };
  const onSpine = (type: ObjectType, name: string, x: number) => {
    const placed = placeNew(p, type, spine, x)!;
    p = placed.project;
    return rename(placed.id, name);
  };
  const branch = (type: ObjectType, name: string, x: number, y: number) => {
    const placed = placeNew(p, type, null, x, y)!;
    p = placed.project;
    return rename(placed.id, name);
  };
  const link = (from: string, to: string, label?: string) => {
    const made = connect(p, from, to);
    if ('error' in made) throw new Error(made.error);
    p = made.project;
    if (label) p = relabelConnection(p, made.id, label);
  };

  // The spine.
  const descent = rename(byName('Plot Point 1'), 'Descent');
  const caveMouth = onSpine('scene', 'The Cave Mouth', 110);
  const c1 = onSpine('choice', 'Take the lantern', 250);
  const theKey = onSpine('scene', 'The Key', 460);
  const vaultDoor = onSpine('scene', 'The Vault Door', 600);
  const vaultOpens = onSpine('cinematic', 'The Vault Opens', 740);
  const c2 = onSpine('choice', 'Pocket the ring', 880);
  p = renameObject(p, byName('Ending'), 'Shared Light');
  void descent;

  // Branches above it.
  const squeeze = branch('scene', 'The Squeeze', 300, -220);
  const guides = branch('dialogue', 'Mara guides you', 480, -220);
  const lost = branch('scene', 'Lost Below', 480, -330);
  const heavy = branch('scene', 'Heavy Pockets', 1000, -220);
  link(c1, squeeze, 'Crawl through');
  link(squeeze, guides, 'Trust Mara');
  link(squeeze, lost, 'Force it');
  link(guides, theKey, 'Out the far side');
  link(c2, heavy, 'Pocket it');
  p = setOutcome(p, lost, 'gameOver');
  p = setOutcome(p, heavy, 'ending');

  // A subplot from The Key to the cinematic, and two character arcs.
  const sub = addLane(p, 'subplot');
  p = updateLane(sub.project, sub.laneId, { name: 'The Lost Expedition' });
  p = setSpanEdge(p, sub.laneId, 'start', theKey);
  p = setSpanEdge(p, sub.laneId, 'end', vaultOpens);
  for (const beat of ['Brother’s journal', 'Camp found']) {
    const placed = placeNew(p, 'plotPoint', sub.laneId, 99999)!;
    p = renameObject(placed.project, placed.id, beat);
  }
  const maraLane = addLane(p, 'character');
  p = updateLane(maraLane.project, maraLane.laneId, { name: 'Mara', subtitle: 'Guarded → trusting' });
  const mara = p.lanes.find((l) => l.id === maraLane.laneId)!.characterId!;
  const explorerLane = addLane(p, 'character');
  p = updateLane(explorerLane.project, explorerLane.laneId, { name: 'The Explorer', subtitle: 'Alone → shared' });
  const explorer = p.lanes.find((l) => l.id === explorerLane.laneId)!.characterId!;
  const arc = (laneId: string, name: string, near: string, polarity: 'up' | 'down' | 'turn') => {
    const placed = placeNew(p, 'arcEvent', laneId, p.placements[near]!.x)!;
    p = setPolarity(renameObject(placed.project, placed.id, name), placed.id, polarity);
    p = renameObject(p, placed.id, name);
  };
  arc(maraLane.laneId, 'Wary', caveMouth, 'down');
  arc(maraLane.laneId, 'Lantern', c1, 'up');
  arc(maraLane.laneId, 'Opens up', vaultDoor, 'up');
  arc(explorerLane.laneId, 'Takes the lead', vaultDoor, 'up');

  // Characters in the Bible.
  p = setField(p, mara, 'role', 'Main');
  p = setField(p, mara, 'arc', 'Guarded → trusting');
  p = setNotes(p, mara, 'Knows the cave system from childhood. Lost her brother Tomas with the last expedition and won’t say so.');
  p = setField(p, explorer, 'role', 'Player character');

  // Inside SC-05 The Vault Door.
  const add = (type: ObjectType, name: string) => {
    const made = addElement(p, vaultDoor, type, name)!;
    p = made.project;
    return made.id;
  };
  const chamber = add('environment', 'Vault Chamber');
  p = setSceneData(p, vaultDoor, { intExt: 'INT.', time: 'NIGHT', locationId: chamber, summary: 'Drain the seam, turn the key.', purpose: 'Open the vault', status: 'inProgress' });
  p = setField(p, chamber, 'lighting', 'Lantern only');
  p = setField(p, chamber, 'ambience', 'Dripping, a low echo');
  p = useInScene(useInScene(p, vaultDoor, mara), vaultDoor, explorer);
  p = setSceneUse(p, vaultDoor, mara, 'behaviour', 'Leads if trust ≥ 1');
  const lever = add('object', 'Rusted Lever');
  const key = add('inventory', 'Vault Key');
  const puzzle = add('puzzle', 'The Vault Door');
  const drains = add('trigger', 'Seam drains');
  const solved = add('state', 'door_solved');
  const turn = add('choice', 'Turn the key');
  const cinematic = add('cinematic', 'Door in the dark');
  p = setStates(p, lever, ['down', 'up']);
  p = addInteraction(p, lever);
  p = updateInteraction(p, lever, interactionsOf(p.objects[lever])[0]!.id, { verb: 'Pull', setsFlag: solved, flagValue: 'yes', fires: drains });
  p = setField(p, lever, 'assetNotes', 'Half-buried by the door. Needs pull anim + grind SFX.');
  p = toggleTag(toggleTag(p, lever, 'Animation'), lever, 'Audio');
  p = setField(p, drains, 'when', 'lever = up');
  p = setField(p, drains, 'does', 'Water drains from the seam');
  p = setField(p, key, 'persists', 'Between scenes');
  p = setField(p, puzzle, 'solution', 'Drain the seam, then turn the key');
  p = setField(p, puzzle, 'failState', 'The chamber floods');
  p = setField(p, turn, 'prompt', 'Turn the key?');
  p = setField(p, cinematic, 'camera', 'Slow push in on the seam');

  // The script.
  let last: string | undefined;
  for (const [kind, speaker, text, direction] of [
    ['action', null, 'Ankle-deep water. The vault door is a slab of green bronze, its seam weeping.', ''],
    ['dialogue', mara, 'Water’s holding it shut. There’s a lever somewhere.', 'listening'],
    ['dialogue', explorer, 'Stand back. I’ll find it.', 'wading forward'],
    ['dialogue', mara, 'Not like that.', ''],
  ] as const) {
    const line = addLine(p, vaultDoor, kind, last, speaker);
    p = updateLine(line.project, line.id, { text, direction });
    last = line.id;
  }

  // The timeline: entry cinematic, the exchange, an action, free play, the choice and its branch.
  const entry = addEvent(p, vaultDoor, 'cinematic', { refId: cinematic, index: 0 })!;
  p = updateEvent(entry.project, vaultDoor, entry.id, { seconds: 6, shots: 1 });
  const echo = addEvent(p, vaultDoor, 'action', { index: 2, label: 'Echo cue' })!;
  p = echo.project;
  const free = addEvent(p, vaultDoor, 'freePlay', { index: 4, label: 'Search the chamber' })!;
  p = updateEvent(free.project, vaultDoor, free.id, { endsWhen: 'lever = up' });
  const choice = addEvent(p, vaultDoor, 'choice', { refId: turn, index: 5 })!;
  p = updateEvent(choice.project, vaultDoor, choice.id, { mainLabel: 'Turn the key' });
  const force = addBranch(p, vaultDoor, choice.id, 'Force it')!;
  p = updateBranch(force.project, force.id, { rejoinEventId: free.id });
  const lastLine = sceneTimeline(p, vaultDoor)[0]!.events.filter((e) => e.kind === 'dialogue').at(-1)!;
  p = moveEvent(p, vaultDoor, lastLine.id, force.id, 0);
  p = addEvent(p, vaultDoor, 'action', { track: force.id, label: 'Water rises' })!.project;
  return p;
};
