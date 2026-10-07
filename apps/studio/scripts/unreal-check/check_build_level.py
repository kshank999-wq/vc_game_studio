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
# Characters are stand-in figures, not their marker; the player start's marker is scaffolding, hidden in play.
mara = placed["NPC_CaveMouth_Mara_001"]
figure = [a for a in mara.get_attached_actors() if a.actor_has_tag("vcgs_figure")]
if len(figure) != 9 or any(a.actor_has_tag("vcgs_marker") for a in mara.get_attached_actors()):
    fail("Mara should be a stand-in figure of 9 pieces, without her marker, got %d" % len(figure))
# ...coloured like the studio's: an NPC's torso its pink, its legs darker, its head skin.
def color_of_piece(actor):
    material = actor.static_mesh_component.calls.get("set_material", (None, None))[1]
    return None if material is None else material.vectors.get("Color")
torso, leg, head = color_of_piece(figure[3]), color_of_piece(figure[0]), color_of_piece(figure[7])
if torso is None or leg is None or head is None or abs(torso.r - 0.85) > 1e-6 or abs(torso.g - 0.38) > 1e-6 or abs(leg.r - 0.85 * 0.55) > 1e-6 or abs(head.g - 0.71) > 1e-6:
    fail("Mara's figure should be coloured: torso (0.85, 0.38), legs a shade darker, head skin")
if figure[3].static_mesh_component.calls["set_material"][1].path != "/Game/VCGS/Generated/Materials/MI_VCGS_Figure_npc_body":
    fail("figure colours should be kept in the project's Materials folder, got " + figure[3].static_mesh_component.calls["set_material"][1].path)
start = placed["PLR_CaveMouth_ExplorerStart_001"]
if not any(a.actor_has_tag("vcgs_scaffold") for a in start.get_attached_actors()):
    fail("the player start's marker should be tagged as scaffolding")
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
# A freeform volume notices the player through its zone: the outline's prisms, not the box.
echo = placed["AUD_VaultChamber_DrippingEcho_001"]
echo_zones = echo.get_editor_property("zones")
if len(echo_zones) != 1 or len(echo_zones[0].get_editor_property("triangles")) != 18 or echo.get_editor_property("box").calls.get("set_collision_profile_name") != ("NoCollision",):
    fail("the outlined ambient zone should be a zone with its outline's triangles, its box out of it")
if placed["TRG_VaultChamber_DoorInTheDarkTrigger_002"].get_editor_property("zones"):
    fail("a box volume has no zones")
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

# A volume that collides is a blocking state gate: an unseen solid as well as its trigger.
for i in data["items"]:
    if i["export_name"] in ("TRG_VaultChamber_FloodedSeam_001", "AUD_VaultChamber_DrippingEcho_001"):
        for p in i["pieces"]:
            if p["part"] == "volume":
                p["collide"] = True
        i["revision"] = "gate"
with open(os.path.join(work, "Content/VCGS/Generated/Levels/sunken_vault.json"), "w", encoding="utf-8") as f:
    json.dump(data, f)
build_level.build()
now = items()
seam_solid = [a for a in now["TRG_VaultChamber_FloodedSeam_001"].get_attached_actors() if a.actor_has_tag("vcgs_volume")]
if len(seam_solid) != 1 or seam_solid[0].static_mesh_component.calls.get("set_collision_profile_name") != ("BlockAll",) or seam_solid[0].static_mesh_component.calls.get("set_visibility") != (False,):
    fail("a blocking box gate should get an unseen BlockAll piece")
gate_slabs = now["AUD_VaultChamber_DrippingEcho_001"].get_editor_property("slabs")
if len(gate_slabs) != 1 or not gate_slabs[0].get_editor_property("collide") or gate_slabs[0].get_editor_property("visible") or len(now["AUD_VaultChamber_DrippingEcho_001"].get_editor_property("zones")) != 1:
    fail("a blocking outlined gate should get an unseen colliding slab and keep its zone")

# The world (spec V2): the old quarter built into it at the harbour, its own director streaming it; the coast's travel links as splines.
build_level.LEVEL = "the_drowned_coast"
world_report = build_level.build()
build_level.LEVEL = "old_quarter"
quarter_report = build_level.build()
with open(os.path.join(work, "Content/VCGS/Generated/Levels/old_quarter.json"), encoding="utf-8") as f:
    quarter_data = json.load(f)
house = items()[quarter_data["items"][0]["export_name"]]
x, _, z = quarter_data["items"][0]["position"]
# Placed at the harbour (-2000, 1500 in the data): Unreal X north = -z, Y east = x, in cm.
if (house.get_actor_location() - fake_unreal.Vector(-(1500 + z) * 100, (-2000 + x) * 100, 0)).length() > 0.5 or not house.actor_has_tag("vcgs_map:old_quarter"):
    fail("the old quarter's house should be built at the harbour, got %r" % house.get_actor_location())
directors = {d.get_editor_property("map_key"): d for d in fake_unreal._actors if isinstance(d, fake_unreal.VcgsLevelDirector)}
quarter_director = directors.get("old_quarter")
if set(directors) != {"sunken_vault", "the_drowned_coast", "old_quarter"} or quarter_director.get_editor_property("boundary") != "streamed" or (quarter_director.get_editor_property("map_origin") - fake_unreal.Vector(-150000, -200000, 0)).length() > 0.5:
    fail("each map should have its own director, the quarter's streamed and placed at the harbour, got %r" % {k: d.get_editor_property("boundary") for k, d in directors.items()})
links = {a.get_editor_property("key"): a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsTravelLink)}
if set(links) != {"coast_road", "down_into_the_vault"} or len(links["coast_road"].get_editor_property("points")) != 3 or links["down_into_the_vault"].get_editor_property("to_map") != "sunken_vault":
    fail("the world's travel links should be splines, the way down leading to the vault")
# The world's items are its own: building it again reports nothing missing of the vault's or the quarter's.
again = build_level.build()
build_level.LEVEL = "the_drowned_coast"
again = build_level.build()
if any("no longer in the level" in line for line in again) or len([a for a in fake_unreal._actors if isinstance(a, fake_unreal.VcgsTravelLink)]) != 2:
    fail("building the world again should touch only its own items and links, got %s" % again)
print("world: %s / %s" % (world_report[-1], next((line for line in quarter_report if "inside" in line), "?")))

print("build_level.py OK" if not failures else "%d FAILED" % len(failures))
sys.exit(1 if failures else 0)
