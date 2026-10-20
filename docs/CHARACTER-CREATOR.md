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

All four phases are built (spec §15):

- **Phase 1:** the registry, art, abilities and inventory.
- **Phase 2:** role settings, dialogue and knowledge, the AI profile and state machine, and enemy variants.
- **Phase 3:** groups and the population generator, placing characters and groups in levels, 2D overlays, and placeholder characters that behave in the 3D graybox and Play Mode.
- **Phase 4:** the engine handoff of characters, variants, groups, abilities, inventory and AI, with final-art bindings (see [In the engines](#in-the-engines-spec-10-11-14)).

## The screen (spec §2)

- **Toolbar:**
  - **Characters | Groups** switches between the registry and the group library.
  - **+ Sample cast** adds the packaged working samples (below).
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

The same pure function (`aiStep`) is unit-tested. It runs in Play Mode for
every placed Enemy and group member with an enemy character (see below). The
engines get it in phase 4.

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

## Groups (spec §7)

A group is a reusable recipe for a crowd, such as Village Market, Orc Patrol
or Temple Priests. Open **Groups** on the toolbar.

**Who is in it.** A list of entries. Each entry is:

- a character, or one of its enemy variants;
- a count range, from and to;
- a weight: when a density cap cuts people, lighter entries give up theirs first;
- what it does: Wanders, Idles, Chats, Works, Patrols or Guards.

**How they spread out:**

- a formation: scattered, in clusters, in a line, in a column, in a ring, in rows;
- spacing, the least distance between people;
- a wander radius;
- a density cap, people per 100 m²;
- a route: the name of a patrol in the level, which patrolling entries walk;
- when they are there: always, by day, by night;
- a faction;
- whether they stay as left when the player comes back;
- a **seed**.

**Preview.** The group is spread over a sample area of any size, exactly as a
level will spread it. The same seed in the same place always gives the same
people; **Reshuffle** picks another seed. It says what the density cap cut
and who couldn't be fitted.

**Also on the Groups view:** where the group is in the levels (click to open
the Level Designer on it), and its problems:

- characters gone or retired;
- a variant gone;
- a count from more to fewer;
- patrolling with no route;
- guarding with no AI.

## In the levels (spec §7, §8, §9)

- **Character group** (Actors in the Level Designer's library) is an area you drop on a square, street or room, or draw freeform. Pick its group in the inspector under Spawn. **Reshuffle** gives another spread of the same people.
  - On the 2D map, its people show as dots in their tint, facing their way, with *Village Market · 20* under the area.
  - In the 3D graybox, they stand as placeholder figures.
  - In Play Mode, they behave:
    - wanderers stroll within their wander radius and inside the area;
    - idlers look about;
    - chatters face each other;
    - workers keep their spot;
    - patrols walk the group's route in formation;
    - everyone walks round walls on the level's navigation graph, and a wanderer picks another spot when there's no way to the one it chose;
    - extras flee from fights or the player, as their character says.
  - People are never put inside walls or solids, and never closer than the spacing.
- **Placed characters.** An NPC, Companion, Enemy or Neutral actor whose character is in the registry stands in as that character's placeholder: its tint, silhouette and height, with its sword, shield, bow or staff in hand. The inspector has **Open … in the Character Creator**. An Enemy can pick one of its character's **variants**.
- **AI enemies in Play Mode.** A placed Enemy, or a group member, whose character is an enemy runs its AI profile:
  - it patrols its patrol, or holds its post, finding its way round walls on the level's navigation graph (as every move it makes does: investigating, chasing, searching, going back);
  - it sees the player in its cone (walls and closed doors block sight), hears them, or senses them within its proximity radius;
  - it reacts after its reaction time, chases and attacks;
  - its blows hurt the player: the damage of its first combat ability, by rank and variant, scaled by its accuracy;
  - no more of a kind attack at once than its variants' guardrail allows;
  - it gives up past its disengage distance or after its chase timeout, searches, and goes back to its post.

  Every transition is in the play log with its reason, for example *Orc Sentry: Chase → Return: 25.3 m from its post, past its 25 m disengage distance*.
- **Senses** on the 2D map's toolbar draws each AI character's vision cone, proximity ring and hearing ring. They are always drawn for what is selected.

**Load.** A hundred ambient placeholders step in well under a millisecond
each frame. The load test (`character-phase3.test.ts`) runs 100 villagers at
60 fps.

## The sample cast (spec §8)

**+ Sample cast** adds six characters, set up to work in the graybox:

- **Strolling Villager:** an ambient extra that wanders and flees fights.
- **Market Gossip:** an interactive NPC with a topic, who chats.
- **Patrol Guard:** an enemy with a long, wide view.
- **Lurking Orc:** an enemy that aggroes on proximity. It is half blind, but anything within 5 m sets it off.
- **Orc Sentry:** an enemy that aggroes on sight, with an 18 m, 140° view and a sword.
- **Loyal Hound:** a companion that follows and defends.

It also adds two groups:

- **Village Market:** 14 strollers and 6 gossips, in clusters.
- **Orc Patrol:** 6 Orc Sentries in a column on a route named *Orc Route*.

Adding the sample cast twice adds nothing.

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

## Final art (spec §10, §11)

Under the placeholder settings, **Final art in the engine** binds the
finished model:

- **Model:** the engine path (`res://art/orc.glb`, `Assets/Art/Orc.fbx`, `/Game/Art/SK_Orc`). Empty means the placeholder figure stands in.
- **Rig:** none (static), humanoid, generic or four-legged.
- **Animations:** the clips the model has, comma-separated.
- **Sockets:** hand, off-hand and head. Props attach at the hand socket.
- **Sounds:** `key = file`, one a line.

The binding is the only thing that changes when the art does. The id, the
key, the inventory, the dialogue and the logic stay as they are, and the
export says so.

With a model set, the pane lists what doesn't fit instead of failing quietly:

- a humanoid rig on a four-legged character, or the other way round;
- no rig on a character that moves;
- a prop with no hand socket;
- an ability cue with no animation of that name;
- no idle, or no walk (fly, swim) animation;
- a sound with no key or no file.

## In the engines (spec §10, §11, §14)

Every export with Character Creator profiles writes, next to the story:

- `characters.json` (schema `vcgs-characters` v1), and `characters.schema.json` (JSON Schema 2020-12) to check it against. It holds:
  - every character, with its stats, placeholder, art binding, abilities, inventory, hit points and AI;
  - its role settings (player, NPC topics with their story line ids, ally, extra);
  - its variants, each with its differences and the whole resolved character;
  - the groups;
  - the placements: each group area's people, and each placed AI actor, where the studio put them in the level;
  - `ids`: studio id → engine key.
- `characters/<key>.json` and `groups/<key>.json`: one manifest per character and group.
- `CHARACTERS.md`, the export report. It says what the starter runtime does, and lists as TODOs what is the engine team's: navigation, animation, effects, stub abilities, scheduled groups, shops.

**In the engine** (a tab under the character) shows it before you export,
for the engine chosen in Engine Handoff: the character's engine key, its
final art or placeholder, and the report's lines for it and for every
character.

**Stable ids.** A character's key is its internal id (the slug), which is
kept on rename, so the engine's id doesn't move when the name does.
`story_key` is its key in the story's own files, which follows the name.
A placed actor's id is its level item's GUID. A group member's id is
`<area GUID>#<n>`, the same for the same group, seed and area.

**The starter runtime**, the same in each engine:

| Spec component | Godot | Unity | Unreal |
|---|---|---|---|
| ActorController | `VCGSActor` | `VcgsActor` | `AVcgsCharacterActor` |
| PerceptionComponent | `VCGSActorPerception` | `VcgsActorPerception` | `UVcgsActorPerception` |
| BehaviorController | `VCGSActorBehavior` | `VcgsActorBehavior` | `UVcgsActorBehavior` |
| AbilityComponent | `VCGSActorAbilities` | `VcgsActorAbilities` | `UVcgsActorAbilities` |
| InventoryComponent | `VCGSActorInventory` | `VcgsActorInventory` | `UVcgsActorInventory` |
| EquipmentComponent | `VCGSActorEquipment` | `VcgsActorEquipment` | `UVcgsActorEquipment` |
| DialogueComponent | `VCGSActorDialogue` | `VcgsActorDialogue` | `UVcgsActorDialogue` |
| SpawnGroupController | `VCGSSpawnGroup` | `VcgsSpawnGroup` | `AVcgsSpawnGroup` |
| The core | `VCGSCast` | `VcgsCast` | `vcgs::Cast` (`VcgsCast.h`) |

Each engine does the following:

- **The core** plays the AI state machine exactly as the studio's preview does. The engine checks replay the studio's own scenarios step for step, reasons included: seeing, reacting, chasing, attacking, disengaging, hearing, a wall in the way, proximity, and standing at patrol stops. A patrol stop's **Wait** holds a patrolling AI there that long before it walks on (in Play Mode and every engine; characters.json gives each placed actor's `route_wait`).
- **A level brings on its own placed actors** (an enemy placed by hand whose character has AI, such as the cell's guard): in the level data their items are marked `cast`, and they are hidden and left still there, since the character actor plays them. Godot's VCGSLevel and Unity's VcgsLevel make a spawn group named Cast as they are set up (only that level's placed actors, `actors_only`), when the project has characters; Unity's level builder gives the level its characters.json. Unreal's build_level.py places a `<level>_Cast` AVcgsSpawnGroup (`bActorsOnly`) for each map that has any, with the map's `MapOrigin` and `MapYaw` copied from its director, so a child map's actors spawn and walk their patrol where the map sits in the world, turned with it. An Unreal character actor looks and finds its way from its feet, the bottom of what it collides with, so its eyes sit at 0.9 of its height on any map's floor whether its origin is at its feet (the generated actor) or at its capsule's centre (a Character of your own). It looks at the hero's body, not level: a trace each to their head, chest and knees (0.9, 0.5 and 0.2 of the height between the bottom and top of what they collide with), and it sees them when any shows, so a hero crouched behind a low wall is still seen by the head, and one on a floor above or below is looked up or down at. With no colliding body to go by it looks level, at its own eye height. Godot's VCGSActorPerception and Unity's VcgsActorPerception do the same: rays from 0.9 of the character's height to the player's head, chest and knees, from the bottom to the top of the player's collision shapes (Godot) or colliders (Unity), ignoring the player's own body. Turn it off with `spawn_cast` / `spawnCast` (Godot, Unity) or delete the Cast actor (Unreal) to place your own. Character group areas still need a spawn group of your own.
- **Spawn groups** put their people (and their patrol routes) where the studio spread them, in the level's own space: under the level in Unity they stand on the same floors as the level builder's items (Unity's z runs the other way to the studio's, so both flip it).
- **Inventory** works out capacity and overflow.
- **Abilities** check cost and cooldown. Damage, heal, stun and set-flag actions run. Other effects, and each ability's cue, VFX and SFX, are sent as events.
- **The actor** builds the placeholder (its height, radius and a hand socket with its prop) until a final model is bound.
- **Movement** is in straight lines. Pathfinding, animation and effects are the engine's, and `CHARACTERS.md` names where to hook them.

The JSON adapter writes the data and the report, with no runtime. Its report
says so.

## In the code

- `apps/studio/src/renderer/model/character/abilities.ts` holds the library, the graybox states and the typed custom actions.
- `apps/studio/src/renderer/model/character/ai.ts` holds the AI profile, the state machine, its checks and the preview simulator `aiStep`.
- `apps/studio/src/renderer/model/character/roles.ts` holds the player, interactive NPC, ally and extra settings and their checks.
- `apps/studio/src/renderer/model/character/variants.ts` holds variants: resolving, differences, difficulty, the generator and the guardrails.
- `apps/studio/src/renderer/model/character/groups.ts` holds groups and the seeded population generator.
- `apps/studio/src/renderer/model/character/crowd.ts` holds a level's characters and how they move and fight in play.
- `apps/studio/src/renderer/model/character/samples.ts` holds the sample cast.
- `apps/studio/src/renderer/model/handoff/cast.ts` builds the cast for the engines (`buildCast`), the export report (`castReport`) and the AI scenarios the engine checks replay (`runScenario`).
- `apps/studio/src/renderer/model/handoff/cast-files.ts` writes `characters.json`, its schema, the manifests and the rows.
- The runtimes are in `godot-characters.ts`, `unity-characters.ts` and `unreal-characters.ts`, in the same folder.
- `apps/studio/src/renderer/components/level/figure3d.ts` builds the 3D placeholder.
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
  - `model/__tests__/character-phase3.test.ts`
  - `model/__tests__/character-phase4.test.ts`
  - `__tests__/character-creator.test.tsx`
