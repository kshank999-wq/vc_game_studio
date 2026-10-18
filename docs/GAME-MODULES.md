# Game modules

A project says what kind of game it is. Each kind, a *module*, uses the parts
of the studio it needs and gives the designer a set path to make one, rough
to fine:

1. Say what the game is.
2. Rough in its main parts.
3. Play it.
4. Refine.
5. Hand it off to the engine.

Story games stay the studio's main work. The other modules are for
smaller games that don't need a plot, characters and levels.

## Choosing one

**File → New project** opens the New Game wizard. Its first question is
*What are you making?*

- **Story game** goes on to the usual four setup steps.
- **Castle defense** (and the modules to come) needs only a name and a
  premise. The game it makes can be played straight away.

A project made before modules existed is a story game.

## The path

The path bar sits under the workspace buttons. It shows each step with a ✓
when it's done, picks out the next one, and says in a line what to do there.
Click a step to go where its work is done.

- Most steps tick themselves when the project shows they're done (for
  example, three plot points and an ending).
- Steps the studio can't judge, such as *Play it* or *Refine*, have a
  **Mark done** link. The × beside them unticks them.
- Click the module name to fold the bar to one line.

### Story game

| Step | Done when |
| --- | --- |
| Concept | The setup has a premise |
| Plot and endings | 3 plot points and an ending |
| Main characters | 2 characters |
| Scenes and choices | 3 scenes |
| Levels | A level exists |
| Play it | You tick it |
| Refine | You tick it |
| Hand off | It has been sent to an engine |

### Castle defense

Enemies come down a path in waves. The player builds and upgrades towers
beside the path. It suits phone, tablet, PC or console.

The **Castle defense** workspace replaces the story graph. It keeps the
Game Bible, Note Sorter and Engine Handoff.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| Map and path | Grid size. Lay the path cell by cell from **IN** to the castle, then mark build spots | 2 path cells and 3 spots |
| Towers | Cost, damage, range, rate, splash, slow, hits flying, upgrade levels | 2 towers |
| Enemies | Health, speed, armor, reward, lives lost on a leak, flying | 2 enemies |
| Waves | Groups of one enemy: count, gap, delay. Bonus gold per wave | 3 waves |
| Gold and lives | Starting gold and lives, sell-back share, breather between waves | No errors left |
| Play and balance | Build towers, run the waves at 1×, 2× or 4×, read each wave's numbers | The test layout wins |
| Hand off | Engine Handoff | Sent |

**Play and balance**

- Pick a tower, then click a build spot. Click a tower again to upgrade it.
  Right-click a tower to remove it.
- Towers are built in order as the gold comes in.
- The towers you place are the *test layout*. It's saved with the game.
- The balance panel runs the whole game at once, then gives a verdict and a
  table of each wave (enemies, total health, gold, leaks, lives).
- The game runs the same way every time, so a change to a number shows its
  effect right away.

**What the engine gets**

The handoff writes two files beside the engine's other output (in
`VCGS/Data` for Unreal):

- `defense.json`: the whole game as data.
- `DEFENSE.md`: what each field means, how to load it in that engine, and
  the rules the studio plays by, so the engine plays the same:
  - Targets are the enemy furthest along the path.
  - Damage is `max(1, damage − armor)`.
  - Splash, slow and leaks work as in the studio.

## Coming next

- Arcade shooter
- Head-to-head on a field

Other kinds of game (card games, for example) will follow the same pattern.
