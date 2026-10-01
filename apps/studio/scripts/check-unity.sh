#!/usr/bin/env bash
# Generate the sample project's Unity handoff, compile the runtime and keys
# (C# 9, warnings as errors) against stubs of UnityEngine, and play the
# story with it. Needs the .NET SDK (8 or later).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/unity-check/"* "$work/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" unity > /dev/null)
# Custom code written in Unity survives exporting again: keys of its own in StoryKeys.cs's region.
python3 - "$work/Assets/VCGS/Generated/StoryKeys.cs" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("    // BEGIN CUSTOM: code\n", "    // BEGIN CUSTOM: code\n    public static partial class Scenes\n    {\n        public const string Custom = \"kept\";\n    }\n", 1)
open(path, "w").write(text)
PY
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" unity > /dev/null)
# The team's open comments and tasks (spec §16): TASKS.md, and a TODO line above the key's constant (compiled below).
gen="$work/Assets/VCGS/Generated"
grep -q "Task for Audio: The key needs a heavy bronze clink" "$gen/TASKS.md" || { echo "TASKS.md should list the key's task"; exit 1; }
grep -B1 'public const string VaultKey' "$gen/StoryKeys.cs" | grep -q "TODO(VCGS) Task for Audio" || { echo "StoryKeys.cs should carry the key's task above VaultKey"; exit 1; }
echo "tasks: $(grep -c '^- ' "$gen/TASKS.md") open"
cd "$work"
dotnet run --nologo -v q
# The puzzle runtime (puzzle spec §6–§10): the sample with the built-in puzzle templates.
puzzles="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles"' EXIT
cp "$here/unity-check/UnityStubs.cs" "$here/unity-puzzle-check/"* "$puzzles/"
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$puzzles" unity puzzles > /dev/null)
cd "$puzzles"
dotnet run --nologo -v q
