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
cd "$work"
dotnet run --nologo -v q
