# Character Creator

One registry for every character in the game: the player character, enemy
NPCs, interactive NPCs, allies and ambient extras (spec:
[`specs/character-creator-spec.md`](specs/character-creator-spec.md)). Open it
with **CHARACTERS** in the top bar, **View › Character Creator**, or from a
character's detail in the Bible (**Art, abilities and inventory in the
Character Creator ↗**).

A character is the story's own character element, not a copy. That makes it,
at once, a dialogue speaker in every scene's script, a Bible entry and the
character a level actor (NPC, Companion, Enemy, Neutral) points at. Its id is
the stable id. Dialogue lines, placements and the engines point at the id, so
renaming a character never breaks a link (spec §1, §3, §6.3). Its profile
lives in the element under `data.profile`, and each change bumps the
profile's **revision**. The project's edit history records what changed, and
undo works as everywhere else.

Phases 1 and 2 are built (spec §15): the registry, art, abilities and
inventory, then role settings, dialogue and knowledge, the AI profile and
state machine, and enemy variants. Phases 3 and 4 come later; the screen says
where:

- **Phase 3:** groups and the population generator, and 2D and 3D behaviours.
- **Phase 4:** the engine handoff of characters.

## The screen (spec §2)

- **Toolbar:**
  - **+ New character** opens the wizard.
  - **Duplicate**, **Import**, **Export**.
  - The **role selector**: Player, Enemy NPC, Interactive NPC, Ally, Ambient extra. A character can have several roles.
  - **Find** searches by name, code, internal id, archetype, species, tag or role.
  - The **validation state**: Valid, *n* to check, or *n* to fix, with the revision. Click it for the diagnostics.
- **Left:**
  - The registry, filtered by role. Each entry shows its code, tint, role marks and archetype, and a red dot when something needs fixing.
  - Under it, the **art pane**. Add a portrait, concept art, a reference or a 3D model thumbnail, or drop images on the picture. Images are scaled to 512 px and kept in the project. Pick what stands for the character: one of those images, or the **placeholder** dummy (silhouette, tint, prop in hand, label).
  - The tint is the character's colour everywhere: script cues, the Bible and the map.
- **Centre**, in five views. Views that don't apply to the character's roles are faded, and each shows a count of its problems:
  - **Profile**, below.
  - **Role settings**, **Dialogue & knowledge**, **AI & detection** and **Variants**: see the sections below.
- **Profile:**
  - **Identity:** name, internal id, archetype, species, optional presentation, appearance, tags and enabled.
  - **Body and movement:** speed, jump height, turn rate, collision radius and height, health, interaction radius, movement and a resource pool. All in engine-independent units: metres, seconds, degrees.
  - **Skills & powers:** ability cards.
  - **Inventory.**
- **Right:** the selected ability or starting item. With nothing selected, a summary and what to fix.
- **Below:** tabs.
  - **Placements:** level actors that use the character. Click one to open the Level Designer on it.
  - **Relationships:** faction and relationships, the same fields as the Bible.
  - **2D/3D preview:** the dummy and its map marker with its interaction radius.
  - **Diagnostics.**

## The wizard (spec §2, §13)

The wizard has six steps:

1. **Role**
2. **Archetype**: Adventurer, Villager, Merchant, Guard, Orc, Mage, Companion, Creature or Blank.
3. **Abilities**: the archetype's are ticked.
4. **Inventory**: capacity and starting items.
5. **Settings**: health, interaction radius and, for an enemy, sight distance.
6. **Name**: then **Save to the registry**.

Archetypes are starting points, not restrictions: everything they set can be
changed afterwards. Sex, species and presentation never drive behaviour
(spec §3).

## Skills and powers (spec §4)

- **The library**, by category:
  - Movement: running, sprinting, jumping, flying, teleport.
  - Combat: melee, ranged, block.
  - Magic: fireball, healing, illusion, elemental bolt.
  - Utility: stealth, perception, lockpicking.
  - Social: persuasion, trade.
  - Status & defense: resistance, shield.
- **Every library ability says honestly whether it works:**
  - **plays**: the studio's graybox simulates it. Running and Jumping are the character controller; Perception is an NPC's sight distance.
  - **stub**: kept and exported but not simulated yet; the engine side implements it.

  Nothing implies a stub will work after export.
- **Your game's skills** (Bible skills, with their ranks, costs and effects) can be added as cards.
- **Custom power…** builds a power from typed actions, never code. Each action has:
  - an **effect**: damage, heal, push, stun, raise or lower a stat, teleport, spawn, or set a story flag;
  - an **amount** in the effect's unit;
  - a **target**;
  - a **condition**: always, target in range, own or target health below a percentage, carrying an item, or a story flag set;
  - a **timing**: at once, over time, or after a delay;
  - an optional **event** it sends, a lower-case key.

  Each action is checked as you build it. An engine-specific code hook belongs in the engine's own scripts, in the custom-code regions the handoff keeps.
- A card shows its name, category, rank, active or passive, plays or stub, and **tuned** when it overrides its defaults. You can reorder, enable or disable, duplicate and remove cards.
- In the right pane, edit:
  - description, cost (resource and amount), cooldown, range, target, magnitude, duration;
  - unlock;
  - animation cue, VFX and SFX placeholders;
  - what happens when it can't be used, and when an AI uses it.

  Only what differs from the library's defaults is stored. A tuned field is gold and has **reset**.

## Inventory (spec §5)

- **Capacity** has five modes:
  - **Unlimited**.
  - **Slot count**: every item takes a slot.
  - **Stacks**: items that stack share a slot, up to a stack size.
  - **Weight**: up to so many kg. Each item's **Weight** is set on the item, shared by everyone carrying it.
  - **Slots and weight**: both limits.
- Meters show what the starting items take up. **When full** can refuse the pickup, drop it, or (for the player) ask what to drop. **Carried between scenes** can be turned on.
- **Starting items** are references to the game's item library (Bible inventory items) with a quantity.
- **Equipment slots**: Hand, Off-hand, Armour, Accessory, plus your own. A slot offers only the equipment that fits it (the item's equipment slot). Equipping an item adds it to the starting items; removing a starting item unequips it.
- Unsupported combinations are reported clearly. For example:
  - starting items that don't fit the slots or the weight;
  - a stack size or capacity of 0;
  - an item equipped but not carried, or in the wrong slot;
  - something that isn't equipment, in a slot;
  - items with no weight under a weight limit;
  - "ask what to drop" on a non-player.

## Validation (spec §2, §12)

**Errors** (red):

- no name;
- a bad or duplicate internal id;
- roles that can't go together: the player as an extra or an enemy, an enemy that is also an ally;
- a library ability, skill or item no longer in the project;
- a custom action that is incomplete;
- art that has been removed.

**Warnings**:

- no role yet;
- more than one player;
- a character that moves but has a speed of 0, or is wider than it is tall;
- an ability that costs a resource the character doesn't have;
- combat or magic on an ambient extra.

**Notes**:

- each ability that is a graybox stub;
- placeholder art, which keeps its collider and props when final art is bound.

## Role settings (spec §6.1, §6.4, §6.5)

- **Player:**
  - how it improves: skill points, levelling up, or the story alone;
  - what happens after a failure: back at the last checkpoint, back at the scene's start, or game over;
  - lives, 0 for unlimited;
  - controls: third person, first person, top down or side on;
  - whether it keeps its inventory and skills between scenes and in saves.
- **Ally:**
  - faction;
  - the trust it starts with;
  - **Joins when**, a rule;
  - follow distance;
  - what it does in a fight;
  - whether it shares its inventory, talks while following, can be dismissed, and stays in the party.
- **Ambient extra:**
  - its loops: walk, idle, chat, work, flee;
  - how far it wanders;
  - what it flees from;
  - a bark as the player passes.

  **Promote to an interactive NPC** keeps the id, so every placement stays.

Settings are kept when a role is turned off, so turning it back on loses nothing.

## Dialogue & knowledge (spec §6.3, §9)

**In the script.** The view shows the character's lines and scenes. A
character is a speaker in every scene's script the moment it is made, and
lines point at its id, so a rename renames every cue.

**What it does:**

- its services: Talks, Vendor, Quest giver, Information;
- the interaction prompt;
- a greeting, and what it says when it can't talk;
- **It can be talked to when**, a rule.

**Links:**

- the quest flags (states and quests) it reads or sets;
- its dialogue entrances (scenes or dialogue nodes);
- for a vendor, what it sells: price and stock (0 is endless), and its currency or barter.

**Topics it knows.** Each topic has:

- what the character knows;
- **It talks about it when**, a rule;
- the script lines it says on the topic, linked by line id;
- what talking about it does: effects.

**Checks:**

- a vendor with nothing to sell, or without the Trade ability;
- information or quests with no topics;
- lines, flags or entrances no longer in the story;
- a missing prompt.

## AI & detection (spec §6.2, §12)

**Detection.** Each mode is independent:

- vision cone and sight distance, with or without line of sight;
- hearing;
- a proximity radius it senses whatever it can see;
- attack range and time between attacks;
- reaction time.

**Giving up:**

- the chase timeout: how long it chases without seeing the target;
- the disengage distance from its post;
- how long it investigates, searches and stays stunned;
- whether it goes back to its post.

**Skill profile.** The AI's skill is not one intelligence number. It has seven
sliders, each 0–100:

- perception, pursuit, navigation, coordination;
- tactics, accuracy, ability choice.

Its **tactics** are aggressive, defensive, keeps its distance, ambush or
support.

**States.** Idle, Patrol, Alert, Investigate, Chase, Attack, Search and Return
are on; Stunned, Flee, Dead and Disabled are optional. It starts in Patrol or
Idle.

**Transitions.** A table of *from → to, when*, in priority order: the first
that holds wins. The starter machine:

- Patrol → Alert on sight;
- Alert → Chase after its reaction time;
- Investigate on a noise;
- Chase on proximity;
- Chase → Attack in range;
- Chase → Search after the chase timeout;
- Chase → Return past the disengage distance;
- Search → Return when its time is up;
- Return → Patrol at its post;
- from any state: Dead, Flee below 20% health, Stunned when hit.

**When** is a typed trigger:

- sees, hears or senses the target;
- target in or out of attack range;
- lost the target;
- chase timeout;
- past the disengage distance;
- its time in this state is up;
- back at its post;
- health below a percentage;
- is hit, or killed.

Transitions can be added, turned off, reordered and removed. **Back to the
starter** restores the starter machine.

**Checks:**

- a start state that is off;
- states nothing leads to, and dead ends;
- transitions into a state that is off;
- an Attack state with nothing to attack with;
- senses that can't notice anything;
- an attack range or proximity radius past its sight;
- a disengage distance inside its sight.

**Preview.** It runs the machine on a 40 × 24 m floor with a patrol route.

- Click to place the target. Turn on **Target noisy** and a **Wall**; **Hit it** takes a quarter of its health.
- **Play**, **Pause** and **Step**, at 1×, 2× or 4×.
- It draws the vision cone, hearing and proximity circles, the disengage ring and the last known position.
- It shows the current state, what it senses and why, its health, attack cooldown, attacks and time in state, and a log of why each transition happened, for example *Chase → Return: 25.3 m from its post, past its 25 m disengage distance*.
- Pick a variant to preview it.

The same pure function (`aiStep`) is unit-tested. The 3D graybox (phase 3)
and the engines (phase 4) will run the same profile.

## Variants (spec §6.2)

Variants are escalating versions of one enemy, by level or encounter tier,
for example Orc → Orc Guard → Orc Elite.

**What a variant stores.** Only what differs from the base; everything else
is inherited, so a change to the base reaches every variant that doesn't
override it. A variant can change:

- stats and damage (a multiplier on combat and magic magnitudes);
- ability ranks, and abilities added or taken away;
- items and equipment;
- AI: sight, reaction, disengage distance, tactics and skill;
- how many come together.

**Generate a chain.** Choose the number of tiers and the growth per tier. Each tier adds:

- health, speed and damage;
- ranks;
- sharper sight, quicker reactions and better skill;
- bigger groups;
- defensive tactics from the second tier;
- the next better hand weapon from the item library;
- Block from the second tier, for a melee fighter without it.

Tune each variant by hand after. **+ Blank variant** starts one from nothing.

**Each variant lists:**

- its tier and levels;
- its difficulty in points, and what a group costs of the encounter budget, with a bar;
- what it changes beside the base's value, and that everything else is the base's.

**Guardrails:**

- how far stats may grow past the base (3× to start with);
- how many may attack at once;
- the patrol area;
- the encounter budget.

Breaking a guardrail is an error or a warning. So are overlapping level
ranges and references that no longer exist.

**Difficulty points** add up health, speed, damage (by rank), sight and the
average skill, so variants and encounters can be compared.

## Deleting a character (spec §12)

**Delete…** shows what refers to the character, then offers three choices:

- **Retire instead:** kept, every link intact, out of the game.
- **Replace with…:** another character takes over its lines, scenes, level actors and arc lanes, then it is deleted.
- **Delete:** the character goes. Its lines keep their words and lose their speaker.

## Import and export (spec §10)

**Export** saves `<internal id>.character.json`. The file holds:

- `format: "vcgs-character"` and `version: 1`;
- the character, with its id, name, code, notes and profile;
- the items and skills it refers to, by id and name.

**Import** brings the file in:

- It keeps the character's id when the id is free, so a character moved between projects keeps its links. Otherwise it gives the character a new id and says so.
- The internal id and the code are made unique.
- Items and skills are matched by id, then by name. Anything that can't be matched is left out and reported.

## In the code

- `apps/studio/src/renderer/model/character/abilities.ts` holds the library, the graybox states and the typed custom actions.
- `apps/studio/src/renderer/model/character/ai.ts` holds the AI profile, the state machine, its checks and the preview simulator `aiStep`.
- `apps/studio/src/renderer/model/character/roles.ts` holds the player, interactive NPC, ally and extra settings and their checks.
- `apps/studio/src/renderer/model/character/variants.ts` holds variants: resolving, differences, difficulty, the generator and the guardrails.
- `apps/studio/src/renderer/model/character/profile.ts` holds:
  - the profile and its defaults;
  - archetypes;
  - create, duplicate, abilities and inventory;
  - capacity;
  - validation;
  - import and export;
  - retire and replace.
- `apps/studio/src/renderer/components/character/` holds the workspace, the wizard, the art pane, the placeholder figure and the ability inspector.
- Tests:
  - `model/__tests__/character.test.ts`
  - `model/__tests__/character-phase2.test.ts`
  - `__tests__/character-creator.test.tsx`
