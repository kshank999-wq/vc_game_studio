import { addInteraction, interactionsOf, setField, setNotes, setSceneUse, setStates, setValue, toggleTag, updateInteraction } from './details';
import { spineLane } from './layout';
import { addLane, connect, createProject, makeObject, nextCode, codeFormatFor, placeNew, relabelConnection, renameObject, setOutcome, setPolarity, setSpanEdge, updateLane } from './project';
import { sampleLevel } from './level/sample-level';
import { addElement, addLine, setSceneData, updateLine, useInScene } from './scene';
import { addBranch, addEvent, moveEvent, sceneTimeline, updateBranch, updateEvent } from './timeline';
import type { Condition } from './rules';
import { addShot, updateShot } from './shots';
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
  p = renameObject(p, byName('Beginning'), 'The flooded vault');
  p = renameObject(p, byName('Ending'), 'Shared Light');

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
  // The scenes still to write have at least what happens in them.
  for (const [scene, summary] of [
    [caveMouth, 'The explorer finds the way in; Mara will not go first.'],
    [theKey, 'The key, half-buried in silt where the last expedition camped.'],
    [squeeze, 'A crawl too tight for the lantern. Trust Mara, or force it.'],
    [lost, 'The rock shifts. The way back is gone.'],
    [heavy, 'The ring comes too, and the water rises with it.'],
  ] as const) {
    p = setSceneData(p, scene, { summary });
  }

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
  p = setField(p, mara, 'codex', 'A guide who knows the flooded caves better than anyone alive. She carries the lantern.');
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
  p = updateInteraction(p, lever, interactionsOf(p.objects[lever])[0]!.id, { verb: 'Pull' });
  p = setField(p, lever, 'assetNotes', 'Half-buried by the door. Needs pull anim + grind SFX.');
  p = toggleTag(toggleTag(p, lever, 'Animation'), lever, 'Audio');
  p = setField(p, drains, 'when', 'lever = up');
  p = setField(p, drains, 'does', 'Water drains from the seam');
  // The conditions, as rules: the lever up drains the seam, which solves the door.
  const is = (kind: 'flag' | 'object', ref: string, value: string): Condition => ({ kind, ref, op: 'is', value });
  p = setValue(p, drains, 'rule', { match: 'all', items: [is('object', lever, 'up')] });
  p = setValue(p, drains, 'effects', [{ kind: 'setFlag', ref: solved, value: 'yes' }]);
  p = setValue(p, puzzle, 'rule', { match: 'all', items: [is('flag', solved, 'yes')] });
  p = setValue(p, turn, 'rule', { match: 'all', items: [is('flag', solved, 'yes'), { kind: 'item', ref: key, op: 'has' }] });
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
    // He talks over her (dual dialogue); she leans on the word.
    ['dialogue', explorer, 'Stand back. I’ll find it.', 'wading forward'],
    ['dialogue', mara, '*Not* like that.', ''],
  ] as const) {
    const line = addLine(p, vaultDoor, kind, last, speaker);
    p = updateLine(line.project, line.id, { text, direction, ...(speaker === explorer ? { dual: true } : {}) });
    last = line.id;
  }

  // The timeline: entry cinematic, the exchange (spoken at once), an action, free play, the choice and its branch.
  const entry = addEvent(p, vaultDoor, 'cinematic', { refId: cinematic, index: 0 })!;
  p = updateEvent(entry.project, vaultDoor, entry.id, { seconds: 6, shots: 1 });
  const echo = addEvent(p, vaultDoor, 'action', { index: 3, label: 'Echo cue' })!;
  p = echo.project;
  const free = addEvent(p, vaultDoor, 'freePlay', { index: 4, label: 'Search the chamber' })!;
  p = updateEvent(free.project, vaultDoor, free.id, { endsWhen: 'the seam drains', ends: { match: 'all', items: [is('flag', solved, 'yes')] } });
  const choice = addEvent(p, vaultDoor, 'choice', { refId: turn, index: 5 })!;
  p = updateEvent(choice.project, vaultDoor, choice.id, { mainLabel: 'Turn the key', effects: [{ kind: 'take', ref: key }, { kind: 'arc', ref: mara, amount: 1 }] });
  const force = addBranch(p, vaultDoor, choice.id, 'Force it')!;
  // Forcing the door only happens once: after that, the key is the only way.
  p = updateBranch(force.project, force.id, { rejoinEventId: free.id, after: 'gone' });
  const lastLine = sceneTimeline(p, vaultDoor)[0]!.events.filter((e) => e.kind === 'dialogue').at(-1)!;
  p = moveEvent(p, vaultDoor, lastLine.id, force.id, 0);
  p = addEvent(p, vaultDoor, 'action', { track: force.id, label: 'Water rises' })!.project;

  // The entry cinematic, broken into shots over Mara's first line.
  const maraLine = p.lines.find((l) => l.sceneId === vaultDoor && l.speakerId === mara)!;
  for (const shot of [
    { framing: 'Extreme wide', move: 'Crane', lens: '18mm', action: 'The chamber from above: black water, one lantern, the bronze door.', audio: 'Dripping, a low echo', seconds: 3, transition: 'Dissolve' },
    { framing: 'Close-up', move: 'Push in', lens: '50mm', characters: [mara], action: 'Mara lifts the lantern; the seam weeps.', lineId: maraLine.id, seconds: 2.5 },
    { framing: 'Over the shoulder', move: 'Static', lens: '35mm', characters: [explorer, mara], action: 'Past the explorer to the door and the half-buried lever.', vfx: 'Lantern flicker', seconds: 2 },
  ] as const) {
    const added = addShot(p, cinematic);
    p = updateShot(added.project, cinematic, added.shotId, { ...shot, characters: 'characters' in shot && shot.characters ? [...shot.characters] : [] });
  }
  p = setField(p, cinematic, 'skippable', 'Skippable');

  // The key is found in the scene named for it, and carried on to the door.
  p = useInScene(p, theKey, key);
  const found = addEvent(p, theKey, 'action', { label: 'Find the key in the silt' })!;
  p = updateEvent(found.project, theKey, found.id, { effects: [{ kind: 'give', ref: key }] });

  // Design definitions in the Bible: the world's history, the goal, a system and a threat.
  const design: Partial<Record<ObjectType, string>> = {};
  for (const [type, name, notes, fields] of [
    ['lore', 'The Drowned Order', 'River priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.', { era: 'Three centuries before the game' }],
    ['quest', 'Open the vault', 'Find the Vault Key and drain the seam, then turn the key in the vault door.', { goal: 'Reach the vault chamber and open the door' }],
    ['mechanic', 'Lantern oil', 'The lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.', { controls: 'Hold to raise the lantern', tuning: 'About a minute of deep water on a full lantern' }],
    ['encounter', 'Eel swarm', 'Eels in the deep channels. They scatter from lantern light.', { enemies: 'Eels, a dozen or so', weakness: 'Lantern light', onLose: 'Try again' }],
  ] as const) {
    const object = makeObject(type, name, p.objects[mara]!.created, { code: nextCode(p, codeFormatFor(type)!), ...fields });
    p = setNotes({ ...p, objects: { ...p.objects, [object.id]: object } }, object.id, notes);
    design[type] = object.id;
  }
  // They play. The eels guard the silt where the key lies, and scatter from lantern light:
  // they can only be beaten once the lantern's oil is in play.
  p = addEvent(p, theKey, 'encounter', { refId: design.encounter!, index: 0 })!.project;
  p = setValue(p, design.encounter!, 'rule', { match: 'all', items: [{ kind: 'mechanic', ref: design.mechanic!, op: 'available' }] });
  // The lantern's oil matters once the lantern is lit, at the cave mouth.
  p = setValue(p, design.mechanic!, 'byEffect', true);
  const lit = addEvent(p, caveMouth, 'action', { label: 'Light the lantern' })!;
  p = updateEvent(lit.project, caveMouth, lit.id, { effects: [{ kind: 'enableMechanic', ref: design.mechanic! }] });
  // Finding the key starts the quest, and its seal tells the Order's story (else the vault door does).
  p = setValue(p, design.quest!, 'byEffect', true);
  p = setValue(p, design.lore!, 'rule', { match: 'all', items: [{ kind: 'visited', ref: vaultDoor, op: 'visited' }] });
  p = updateEvent(p, theKey, found.id, {
    effects: [{ kind: 'give', ref: key }, { kind: 'startQuest', ref: design.quest! }, { kind: 'revealLore', ref: design.lore! }],
  });
  // Turning the key opens the vault: the quest is done.
  p = updateEvent(p, vaultDoor, choice.id, { effects: [{ kind: 'take', ref: key }, { kind: 'arc', ref: mara, amount: 1 }, { kind: 'completeQuest', ref: design.quest! }] });

  // Where it all happens: one level, tied to the scenes and the Bible.
  p = sampleLevel(p, { caveMouth, squeeze, theKey, vaultDoor, chamber, mara, lever, key, puzzle, cinematic, descent });
  return p;
};
