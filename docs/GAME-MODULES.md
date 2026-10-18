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
- **Castle defense**, **Arcade shooter**, **Head-to-head arena**, **Card
  game**, **Puzzle game**, **Match-3** and **Runner** need only a name and a
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

### Arcade shooter

The classic arcade invader game. Rows of invaders sweep side to side and step
down at each side. The player's ship slides along the bottom and fires up.
The **Arcade shooter** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| The ship | Speed, fire rate, shot speed, lives | All set |
| Invaders | Health (hits), points, shots a minute | 2 invaders |
| Waves | A formation each: which invader fills each row, how many a row, speed, step down, fire, bonus points. A small picture shows the formation | 3 waves |
| Shields and scoring | Shields and their hits, an extra life every so many points, the speed-up as the formation thins, how fast their shots fall | No errors left |
| Play and tune | Play it with ← → (or A D) and Space, or tick **Autopilot plays** and watch | You tick it |
| Hand off | Engine Handoff | Sent |

**The autopilot**

- The autopilot is a steady player. It lines up under the nearest invader,
  leads the formation's sweep, sidesteps shots, and holds fire under a
  shield.
- Its three runs give a verdict and a table of each wave: time, shots,
  share of shots that hit, lives lost.
- If it struggles, most players will. Use it as a guide to difficulty, not
  a stand-in for playing.

**What the engine gets**

The handoff writes `shooter.json` (the whole game as data) and `SHOOTER.md`
(what each field means, how to load it in that engine, and the rules the
studio plays by).

The rules:

- Only the lowest invader in a column fires.
- The formation's speed is `speed × (1 + speed-up × share destroyed)`.
- Shields stop shots from both sides.
- A hit on the ship clears the falling shots.

### Head-to-head arena

Two sides face each other on one field. Each side has a keep and a guard
tower in every lane. Players spend energy, which builds up over time, to
send units down the lanes and knock the other side's towers down. The
studio plays the opponent.

- Knocking down the keep wins at once.
- At time, the side that has knocked down more towers wins.

The **Head-to-head arena** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| Field and towers | 1, 2 or 3 lanes; the keep's and guards' health, damage, rate, range | Set |
| Units | Cost, count, health, damage, rate, range, speed, splash, goes only for towers, flying, hits flying | 3 units |
| Energy and time | Starting energy, the most a player can hold, how fast it builds, match length | Set |
| Decks | The player's cards and the opponent's | No errors left |
| Play and balance | Play against the studio's opponent, watch two decks play each other, read the matchups | You tick it |
| Hand off | Engine Handoff | Sent |

**Play and balance**

- Pick a card, then click your half of the field to play it there.
- **The studio plays your deck too** lets you watch the two decks play each
  other.
- The studio's opponent plays its deck in order as the energy comes:
  - With your units on its half, it plays in their lane, between them and
    its towers.
  - Otherwise it plays at its back, in the lane whose guard tower of yours is
    weakest.
- The **matchup table** puts every unit against every other, the same energy
  spent on each (6), played from both ends of the field.
  - ✓ wins, with the share of health it has left.
  - ✗ loses.
  - = too close to call.
  - It warns when one unit beats everything, and when one beats nothing.
- **Deck against deck** says how the two decks do when the studio plays
  both.

**What the engine gets**

The handoff writes `arena.json` (the whole game as data) and `ARENA.md`
(what each field means, how to load it in that engine, the rules the studio
plays by, and how its opponent chooses where to play).

### Card game

A one-on-one card duel. Each side has a hero and a deck, and mana that grows
each turn. Minions fight on the board; spells do one thing well. The studio
plays the opponent.

The **Card game** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| Rules | Hero health, mana on turn 1, how much more each turn, the most mana, opening hand, hand and board size, copies a deck | Set |
| Cards | Each card beside how it looks: kind, cost, attack, health, guard, charge, and what it does (damage an enemy, damage every enemy minion, heal, draw, buff) | 8 cards |
| Decks | Count up and down per card, for the player and the opponent, with a mana curve | No errors left |
| Play and balance | Play against the studio's opponent; read a hundred games of the studio playing both decks | You tick it |
| Hand off | Engine Handoff | Sent |

**Cards**

- Rules text is written from the numbers.
- Each card shows where it sits against the curve. A card is worth about
  twice its cost plus one: attack and health together, a point for each
  keyword, and its effect.
  - **+** means more than its cost buys.
  - **−** means less.

**Play and balance**

- Click a card in your hand to play it. If it needs a target, click the
  target next.
- Click one of your minions, then what it should attack. Guards must be
  attacked first.
- **They go first** swaps who starts.
- The report plays a hundred games, each side going first in turn. It shows:
  - each deck's win rate;
  - what going first is worth;
  - how long games last;
  - for every card, how often it was played and how often the side that
    played it won.
- A card won with far more or less than half the time is the one to look
  at.

**What the engine gets**

The handoff writes `cards.json` (the rules, every card with its rules text,
both decks) and `CARDS.md`. `CARDS.md` covers the turn, mana and fatigue,
effects, attacks and guards, and how the studio's opponent plays.

### Puzzle game

A push-block puzzle, level after level. The player walks a grid and pushes
crates onto targets: one at a time, never pulled. The studio solves every
level itself, so you know each one can be done, in how few moves, and how
hard it is.

The **Puzzle game** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| Rules | What a crate and a target are called, whether the player can undo, how stars are earned | Set |
| Levels | Paint each level: wall, floor, target, crate, player. Name, par, size. Paste or copy it as text | 5 levels, each ready to play |
| Order and difficulty | The levels in order, each with its fewest moves, pushes and difficulty, and a chart of the climb | The studio has solved every level |
| Play and test | Play each level with the arrow keys or WASD; undo, restart, hint, stars against par | You tick it |
| Hand off | Engine Handoff | Sent |

**Levels**

- Pick a piece, then click or drag across cells. With **Crate** picked,
  clicking a crate takes it off.
- Under the level, the studio says whether it solves:
  - **Solves in N moves** gives the pushes and a difficulty from 1 to 5.
    **Show the solution** plays it out on the board.
  - **Can't be solved** means a crate always gets stuck.
  - **Too big** means there are too many positions for the studio to check
    here. Play it to be sure, or make it smaller.
- **As text** shows the level in the standard text format: `#` wall, space
  floor, `.` target, `$` crate, `*` crate on a target, `@` player, `+` player
  on a target. Paste a level in there to bring it in.

**Order and difficulty**

- It flags a level that jumps two or more steps harder than the one before,
  or one that's much easier than the one before.
- Difficulty comes from how much the solver had to search and how many
  pushes the level takes. Use it as a guide to the order, not a measure of
  fun.

**Play and test**

- **Hint** gives the studio's next move from where you are, or says when
  you're stuck.
- Stars:
  - three at par;
  - two within the slack set in Rules;
  - one for finishing.
- Par is the studio's fewest moves unless you set one on the level.

**What the engine gets**

The handoff writes `puzzles.json` and `PUZZLES.md`:

- `puzzles.json` has every level as text rows, with its solution, par and
  difficulty. The solutions can drive a hint button, and let the engine team
  check the levels still solve.
- `PUZZLES.md` covers the rules and how to load the levels in that engine.

### Match-3

Swap two gems side by side to line up three or more of a colour. They clear,
the gems above fall, new ones drop in, and chains score more. Each level has
a board shape, how many colours fall, a move limit and a goal. The goal is a
score, gems of one colour to collect, or jelly to clear.

The **Match-3** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| Rules | The gems' names (up to 7), points a gem, the chain bonus, star steps, specials on or off | Set |
| Levels | Name, colours, moves, goal; paint the board: cell, no cell, jelly; **Show it filled** to see gems on it | 5 levels, each ready |
| Balance | How often the studio's player beats each level at its limit, the moves it needed, and the limit for the win rate you aim for | You tick it |
| Play and test | Play each level; ask for the studio's move, or let it play | You tick it |
| Hand off | Engine Handoff | Sent |

**Specials**

- Four in a line leaves a line gem. It clears its row (for an across line)
  or its column (for a down line).
- Five in a line, or a gem in two lines at once (an L or T), leaves a bomb.
  It clears the 3×3 round it.
- Specials go off when they're cleared, and can set each other off.

**Balance**

- The studio's player is a steady one, not a clever one. It takes the
  biggest match it sees, counting specials it would make and the goal's gems
  and jelly double.
- It plays each level 40 times on different boards, with no move limit, and
  notes how many moves it needed. From that the table shows:
  - how often it wins within the level's limit;
  - the moves it needed on its middle run, and on 4 runs in 5;
  - the move limit at which it would win the share you aim for. **Use N**
    sets that limit.
- A gentle climb is 90% for the first levels, settling to 50–70%.

**What the engine gets**

The handoff writes `match3.json` and `MATCH3.md`:

- `match3.json` has the rules and every level: shape, colours, moves, goal.
- `MATCH3.md` covers the exact rules (scoring, specials, gravity, shuffling
  when no move is left) and how to load the levels in that engine.

### Runner

An endless side-scrolling runner. The player runs on their own, faster the
further they get, and jumps and slides past blocks, bars and pits, picking
up coins. The track is built from chunks you draw: short stretches strung
together at random, with harder tiers joining further in.

The **Runner** workspace replaces the story graph.

| Step | Where | Done when |
| --- | --- | --- |
| Concept | Premise, theme, platform, notes | A premise |
| The runner | Start speed, how much faster each 100 units, top speed, jump speed, gravity, slide time, a player's timing error | Set |
| Chunks | Paint blocks and coins at four heights, pits in the ground; name, tier, length | 6 chunks, each passable at the speeds it comes at |
| Mix and pace | When tiers 2 and 3 join, how often each chunk comes up, coin value; how far the studio's runs get and where they end | You tick it |
| Play and test | Run it: Space, ↑ or W to jump, ↓ or S to slide; or let the studio run | You tick it |
| Hand off | Engine Handoff | Sent |

**The runner**

The studio works out what the numbers mean:

- how high a jump rises (and so whether it clears a wall one or two cells
  high);
- how far a jump carries at the start and at top speed;
- how far a slide covers;
- when top speed is reached.

**Chunks**

- Under each chunk the studio says whether it can be got through at the
  slowest and fastest speeds it will come at. It searches every jump and
  slide to find out.
- **Show a way through** draws the path it found.
- The studio's runner plays each chunk 24 times at each speed. It plans like
  the search, but makes each move up to the timing error early or late (±70
  ms to start). How often it gets through shows how tight the chunk is.

**Mix and pace**

- The studio's runner runs 12 endless runs to 1,500 units. You get its
  middle, shortest and longest run, the coins it picks up, and how many runs
  ended in each chunk.
- Runs should end in the late, fast tiers, spread over a few chunks.
- A chunk every player gets through on its own can still end runs where it
  meets the next one. Keep the first and last few units of a chunk clear.

**What the engine gets**

The handoff writes `runner.json` and `RUNNER.md`:

- `runner.json` has the physics, the player's box, the pacing, and every
  chunk, with the speeds the studio checked it at.
- `RUNNER.md` covers the frame-by-frame rules (movement, gravity, landing,
  jump, slide, what ends a run, how chunks are picked) and how to load them
  in that engine.

## Coming next

Other kinds of game, such as a sports match or a platformer, will follow the
same pattern.
