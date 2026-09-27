"""Runs the generated build_level.py against fake_unreal: places the sample's
level, then builds it again after a change, a move made in the editor and an
item taken out of the level."""
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

failures = []


def fail(message):
    failures.append(message)
    print("FAIL: " + message, file=sys.stderr)


def items():
    return {a.get_actor_label(): a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsLevelItem)}


report = build_level.build()
placed = items()
with open(os.path.join(work, "Content/VCGS/Generated/Levels/sunken_vault.json"), encoding="utf-8") as f:
    data = json.load(f)
print("placed: %d items · %s" % (len(placed), report[-1]))
if len(placed) != len(data["items"]):
    fail("an AVcgsLevelItem per item")
camp = placed["RM_SunkenVault_SiltCamp_003"]
if (camp.get_actor_location() - fake_unreal.Vector(900, 1000, 0)).length() > 0.01:
    fail("the silt camp should be at X 900, Y 1000 (north is +X, in cm), got %r" % camp.get_actor_location())
crane = placed["CAM_VaultChamber_ChamberCrane_001"]
if abs(crane.get_actor_rotation().yaw - 315) > 0.01:
    fail("the camera marker should turn to yaw 315, got %g" % crane.get_actor_rotation().yaw)
chamber = placed["RM_SunkenVault_VaultChamber_004"]
if len(chamber.get_attached_actors()) < 5:
    fail("the chamber should have its floor and walls attached")
# A freeform space's floor and ceiling go to the item as slabs, built on construction.
cave = placed["RM_SunkenVault_CaveMouth_001"]
cave_data = next(i for i in data["items"] if i["export_name"] == "RM_SunkenVault_CaveMouth_001")
slabs = chamber.get_editor_property("slabs")
chamber_data = next(i for i in data["items"] if i["export_name"] == "RM_SunkenVault_VaultChamber_004")
chamber_slabs = [p for p in chamber_data["pieces"] if p["shape"] == "slab"]
if not chamber_slabs or len(slabs) != len(chamber_slabs) or not chamber.get_editor_property("constructed"):
    fail("the chamber's outlined floor should be set as slabs and built, got %r" % slabs)
else:
    s0 = slabs[0]
    outline = s0.get_editor_property("outline")
    x, z = chamber_slabs[0]["outline"][0]
    if len(outline) != len(chamber_slabs[0]["outline"]) or abs(outline[0].x - -z * 100) > 0.01 or abs(outline[0].y - x * 100) > 0.01:
        fail("a slab's corners should be in Unreal's axes, in cm")
    if s0.get_editor_property("triangles") != chamber_slabs[0]["triangles"] or not s0.get_editor_property("collide"):
        fail("a slab keeps its triangles and collides")
if not any(p["shape"] == "slab" for p in cave_data["pieces"]) or not cave.get_editor_property("slabs"):
    fail("the cave mouth's outlined ground should be a slab")
trigger = placed["TRG_VaultChamber_DoorInTheDarkTrigger_002"]
if trigger.get_editor_property("box").calls.get("set_collision_profile_name") != ("Trigger",):
    fail("a volume's box should be a trigger")
directors = [a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsLevelDirector)]
if len(directors) != 1 or directors[0].get_editor_property("level_file") != "VCGS/Generated/Levels/sunken_vault.json":
    fail("a director should be placed with its level file")
if not any(a.actor_has_tag("vcgs_start") for a in placed["PLR_CaveMouth_ExplorerStart_001"].get_attached_actors()):
    fail("the player start should get a PlayerStart")

# A change from VC Game Studio after the camp was moved in the editor: the move is kept and said.
camp.set_actor_location(fake_unreal.Vector(900, 1100, 0), False, False)
camp.set_editor_property("revision", "old")
again = build_level.build()
if not any("RM_SunkenVault_SiltCamp_003 was moved in the editor" in line for line in again) or abs(camp.get_actor_location().y - 1100) > 0.01:
    fail("a move made in the editor should be kept and reported, got %s" % again)
if any(line.startswith("Added") for line in again) or len(items()) != len(data["items"]):
    fail("a second build should add nothing")
build_level.VCGS_WINS = True
build_level.build()
build_level.VCGS_WINS = False
if abs(camp.get_actor_location().y - 1000) > 0.01:
    fail("with VCGS_WINS the camp goes back")

# An item taken out of the level is reported and left in place.
data["items"] = [i for i in data["items"] if i["export_name"] != "LGT_SiltCamp_CampEmbers_002"]
with open(os.path.join(work, "Content/VCGS/Generated/Levels/sunken_vault.json"), "w", encoding="utf-8") as f:
    json.dump(data, f)
fewer = build_level.build()
if not any("LGT_SiltCamp_CampEmbers_002 is no longer in the level" in line for line in fewer) or "LGT_SiltCamp_CampEmbers_002" not in items():
    fail("a removed item should be reported and left in place")

print("build_level.py OK" if not failures else "%d FAILED" % len(failures))
sys.exit(1 if failures else 0)
