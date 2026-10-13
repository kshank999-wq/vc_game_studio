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

This is **phase 1**: foundations (spec §15). Phases 2 to 4 come later; the
screen says where:

- **Phase 2:** NPC dialogue profiles, the enemy AI profile and state machine, and variants.
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
- **Centre:**
  - **Identity:** name, internal id, archetype, species, optional presentation, appearance, tags and enabled.
  - **Body and movement:** speed, jump height, turn rate, collision radius and height, health, interaction radius, movement and a resource pool. All in engine-independent units: metres, seconds, degrees.
  - **Skills & powers:** ability cards.
  - **Inventory.**
- **Right:** the selected ability or starting item. With nothing selected, a summary and what to fix.
- **Below:** tabs.
  - **Dialogue & knowledge:** lines spoken and scenes.
  - **AI & detection:** phase 2.
  - **Variants:** phase 2.
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
- `apps/studio/src/renderer/model/character/profile.ts` holds:
  - the profile and its defaults;
  - archetypes;
  - create, duplicate, abilities and inventory;
  - capacity;
  - validation;
  - import and export.
- `apps/studio/src/renderer/components/character/` holds the workspace, the wizard, the art pane, the placeholder figure and the ability inspector.
- Tests:
  - `model/__tests__/character.test.ts`
  - `__tests__/character-creator.test.tsx`
