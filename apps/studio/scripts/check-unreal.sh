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
cxx="${CXX:-g++}"
flags=(-std=c++17 -Wall -Wextra -Werror -fno-exceptions -fno-rtti)
public="$work/Plugins/VCGS/Source/VCGS/Public"

"$cxx" "${flags[@]}" -I "$here/unreal-check/core" -I "$public" -o "$work/check" "$here/unreal-check/check.cpp"
(cd "$work" && ./check)

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
