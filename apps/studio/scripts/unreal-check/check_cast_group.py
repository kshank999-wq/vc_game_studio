"""Runs the generated build_level.py against fake_unreal on the capture sample: the
vault, with the cell's guard placed (an enemy with AI), gets its own Cast spawn
group for its placed actors, once however often it is built, placed in the
world where its map is (the director's origin and turn)."""
import importlib.util
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
work = sys.argv[1]
sys.path.insert(0, here)
import fake_unreal  # noqa: E402

sys.modules["unreal"] = fake_unreal
fake_unreal._content = os.path.join(work, "Content")
spec = importlib.util.spec_from_file_location("build_level", os.path.join(work, "Content/VCGS/Generated/Levels/build_level.py"))
build_level = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_level)
build_level.LEVEL = "sunken_vault"

with open(os.path.join(work, "Content/VCGS/Generated/Levels/sunken_vault.json"), encoding="utf-8") as f:
    vault = json.load(f)
cast_items = [i for i in vault["items"] if i.get("cast")]
build_level.build()
build_level.build()
groups = [a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsSpawnGroup)]
directors = [a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsLevelDirector) and a.get_editor_property("map_key") == vault["key"]] if "key" in vault else [a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsLevelDirector)]
placed = bool(groups and directors) and all(groups[0].get_editor_property(n) is directors[0].get_editor_property(n) or groups[0].get_editor_property(n) == directors[0].get_editor_property(n) for n in ("map_origin", "map_yaw"))
print("cast group placed as its map's director: %s" % placed)
ok = placed and len(cast_items) == 1 and len(groups) == 1 and groups[0].get_editor_property("level_guid") == vault["guid"] and groups[0].get_editor_property("actors_only") is True
print("cast group: %d placed actor(s), %d spawn group(s) %s" % (len(cast_items), len(groups), [g.get_actor_label() for g in groups]))
if not ok:
    print("FAIL: the vault should get one Cast spawn group (its level's GUID, placed actors only, its map's origin and turn) for the cell's guard", file=sys.stderr)
    sys.exit(1)
print("cast group OK")
