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
"${GODOT:?Set GODOT to a Godot 4 binary}" --headless --path "$work" --import > /dev/null 2>&1 || true
"$GODOT" --headless --path "$work" -s check.gd
