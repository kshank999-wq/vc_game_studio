#!/usr/bin/env bash
# Generate the sample project's Godot handoff and run it in a real Godot 4:
# every script and resource must load, the lever must work, the Vault Door
# scene must play through its branch. Needs GODOT=/path/to/godot (4.x).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/godot-check/project.godot" "$here/godot-check/check.gd" "$work/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" > /dev/null)
# Custom code written in the engine survives exporting again: a function in the story graph's region.
python3 - "$work/vcgs/generated/story/story_graph.gd" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("# BEGIN CUSTOM: code\n", "# BEGIN CUSTOM: code\nstatic func custom_check() -> String:\n\treturn \"kept\"\n", 1)
open(path, "w").write(text)
PY
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" > /dev/null)
# The team's open comments and tasks (spec §16): TASKS.md, and TODO lines beside the level items they are about.
gen="$work/vcgs/generated"
grep -q "Task for Audio: The key needs a heavy bronze clink" "$gen/TASKS.md" || { echo "TASKS.md should list the key's task"; exit 1; }
grep -q "_Mara_[0-9]*: TODO(VCGS) Task for Gameplay programmer" "$gen/levels/sunken_vault.gd" || { echo "the level script should carry Mara's task"; exit 1; }
echo "tasks: $(grep -c '^- ' "$gen/TASKS.md") open"
# Recorded takes: the handoff puts each beside the generated folder, as vo/<line>.mp3 (here, the sample's own).
mkdir -p "$gen/vo"
cp "$here/../src/renderer/assets/sample-takes/"*.mp3 "$gen/vo/"
"${GODOT:?Set GODOT to a Godot 4 binary}" --headless --path "$work" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$work" -s check.gd
# Bring back changes (spec §19): the studio reads what Godot's VCGSChanges wrote, and finds the four changes made there.
(cd "$here/.." && npx vite-node scripts/read-changes.ts "$work/vcgs-changes.json" "$work/project.json")
# The puzzle runtime (puzzle spec §6–§10): the sample with the built-in puzzle templates.
puzzles="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles"' EXIT
cp "$here/godot-check/project.godot" "$here/godot-check/check_puzzles.gd" "$puzzles/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$puzzles" godot puzzles > /dev/null)
"$GODOT" --headless --path "$puzzles" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$puzzles" -s check_puzzles.gd
# Rooms (sub-scenes): the sample with rooms in The Cave Mouth.
rooms="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles" "$rooms"' EXIT
cp "$here/godot-check/project.godot" "$here/godot-check/check_rooms.gd" "$rooms/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$rooms" godot rooms > /dev/null)
"$GODOT" --headless --path "$rooms" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$rooms" -s check_rooms.gd
# The Character Creator's cast (character spec §10): the sample cast, a group area and a placed Orc Sentry.
cast="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles" "$rooms" "$cast"' EXIT
cp "$here/godot-check/project.godot" "$here/godot-check/check_cast.gd" "$cast/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$cast" godot cast > /dev/null)
"$GODOT" --headless --path "$cast" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$cast" -s check_cast.gd
# The Structure Creator's Old Tomb (structure spec §7, §10, §14): door rules, objectives, completion and memory, as the studio plays them.
tomb="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles" "$rooms" "$cast" "$tomb"' EXIT
cp "$here/godot-check/project.godot" "$here/godot-check/check_structure.gd" "$tomb/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$tomb" godot structure > /dev/null)
"$GODOT" --headless --path "$tomb" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$tomb" -s check_structure.gd
