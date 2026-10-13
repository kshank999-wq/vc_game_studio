#!/usr/bin/env bash
# Generate the sample project's Unreal handoff, then:
#  1. build and run a C++ program that plays the story with the plugin's core
#     (C++17, warnings as errors, no exceptions or RTTI, as Unreal builds);
#  2. compile every source file of the plugin against stubs of Unreal's
#     headers (syntax and types; Unreal Header Tool does not run here);
#  3. byte-compile the DataTable import script, and run the level builder
#     against a stand-in for Unreal's Python API.
# Needs a C++17 compiler (CXX, default g++) and python3; with the .NET SDK
# it also compiles VCGS.Build.cs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" unreal > /dev/null)
# Custom code written in Unreal survives exporting again: a key of its own in VcgsStoryKeys.h's region.
python3 - "$work/Plugins/VCGS/Source/VCGS/Public/Generated/VcgsStoryKeys.h" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
text = text.replace("    // BEGIN CUSTOM: code\n", "    // BEGIN CUSTOM: code\n    inline constexpr const char* CustomCheck = \"kept\";\n", 1)
open(path, "w").write(text)
PY
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$work" unreal > /dev/null)
# The team's open comments and tasks (spec §16): TASKS.md, and a TODO line above the key's constant (compiled below).
grep -q "Task for Audio: The key needs a heavy bronze clink" "$work/Content/VCGS/Generated/TASKS.md" || { echo "TASKS.md should list the key's task"; exit 1; }
grep -B1 'constexpr const TCHAR\* VaultKey' "$work/Plugins/VCGS/Source/VCGS/Public/Generated/VcgsStoryKeys.h" | grep -q "TODO(VCGS) Task for Audio" || { echo "VcgsStoryKeys.h should carry the key's task above VaultKey"; exit 1; }
echo "tasks: $(grep -c '^- ' "$work/Content/VCGS/Generated/TASKS.md") open"
cxx="${CXX:-g++}"
flags=(-std=c++17 -Wall -Wextra -Werror -fno-exceptions -fno-rtti)
public="$work/Plugins/VCGS/Source/VCGS/Public"

"$cxx" "${flags[@]}" -I "$here/unreal-check/core" -I "$public" -o "$work/check" "$here/unreal-check/check.cpp"
(cd "$work" && ./check)

# The puzzle runtime (puzzle spec §6–§10): the sample with the built-in puzzle templates.
puzzles="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles"' EXIT
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$puzzles" unreal puzzles > /dev/null)
"$cxx" "${flags[@]}" -I "$here/unreal-check/core" -I "$puzzles/Plugins/VCGS/Source/VCGS/Public" -o "$puzzles/puzzle_check" "$here/unreal-check/puzzle_check.cpp"
(cd "$puzzles" && ./puzzle_check)

# Rooms (sub-scenes): the sample with rooms in The Cave Mouth.
rooms="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles" "$rooms"' EXIT
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$rooms" unreal rooms > /dev/null)
"$cxx" "${flags[@]}" -I "$here/unreal-check/core" -I "$rooms/Plugins/VCGS/Source/VCGS/Public" -o "$rooms/rooms_check" "$here/unreal-check/rooms_check.cpp"
(cd "$rooms" && ./rooms_check)

# The Character Creator's cast (character spec §10): the sample cast, a group area and a placed Orc Sentry.
cast="$(mktemp -d)"
trap 'rm -rf "$work" "$puzzles" "$rooms" "$cast"' EXIT
(cd "$here/.." && npx vite-node scripts/export-sample.ts "$cast" unreal cast > /dev/null)
castpublic="$cast/Plugins/VCGS/Source/VCGS/Public"
"$cxx" "${flags[@]}" -I "$here/unreal-check/core" -I "$castpublic" -o "$cast/cast_check" "$here/unreal-check/cast_check.cpp"
(cd "$cast" && ./cast_check)
# Its classes compile against the stubs too.
mkdir -p "$cast/generated"
for header in "$castpublic"/*.h; do : > "$cast/generated/$(basename "${header%.h}").generated.h"; done
for source in "$cast"/Plugins/VCGS/Source/VCGS/Private/VcgsActorComponents.cpp "$cast"/Plugins/VCGS/Source/VCGS/Private/VcgsCharacterActor.cpp "$cast"/Plugins/VCGS/Source/VCGS/Private/VcgsSpawnGroup.cpp; do
  "$cxx" "${flags[@]}" -Wno-unused-parameter -fsyntax-only -I "$here/unreal-check/stubs" -I "$cast/generated" -I "$castpublic" "$source"
done
echo "cast classes compile against the stubs"

# Unreal Header Tool writes the .generated.h files; for the check they are empty.
mkdir -p "$work/generated"
for header in "$public"/*.h; do : > "$work/generated/$(basename "${header%.h}").generated.h"; done
for source in "$work"/Plugins/VCGS/Source/VCGS/Private/*.cpp; do
  "$cxx" "${flags[@]}" -Wno-unused-parameter -fsyntax-only -I "$here/unreal-check/stubs" -I "$work/generated" -I "$public" "$source"
done
echo "plugin sources compile against the stubs"

python3 -m py_compile "$work/Content/VCGS/Generated/import_datatables.py"
echo "import_datatables.py compiles"
# The level builder runs against a stand-in for Unreal's Python API.
python3 "$here/unreal-check/check_build_level.py" "$work"

if command -v dotnet > /dev/null; then
  mkdir -p "$work/build-rules"
  cp "$here/unreal-check/BuildStubs.cs" "$work/Plugins/VCGS/Source/VCGS/VCGS.Build.cs" "$work/build-rules/"
  cat > "$work/build-rules/BuildRules.csproj" <<'PROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework><OutputType>Library</OutputType><TreatWarningsAsErrors>true</TreatWarningsAsErrors><Nullable>disable</Nullable></PropertyGroup>
</Project>
PROJ
  (cd "$work/build-rules" && dotnet build --nologo -v q > /dev/null && echo "VCGS.Build.cs compiles")
fi
echo OK
