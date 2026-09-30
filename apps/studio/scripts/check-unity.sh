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
cd "$work"
dotnet run --nologo -v q
