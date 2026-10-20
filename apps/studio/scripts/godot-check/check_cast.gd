extends SceneTree
# The Character Creator's cast in Godot (character spec §10, §14): characters.json
# is the schema the studio writes; VCGSCast's AI machine plays the studio's own
# scenarios (cast_expect.json) transition for transition, reason for reason;
# inventory, abilities and the spawn group work; every component loads.

var failures := 0

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func _initialize() -> void:
	var cast: Dictionary = VCGSCast.load_cast("res://vcgs/generated/characters.json")
	if cast.get("schema", "") != "vcgs-characters" or int(cast.get("version", 0)) != 1:
		fail("characters.json should be vcgs-characters v1")
	var orc: Dictionary = VCGSCast.character(cast, "orc_sentry")
	if orc.is_empty() or typeof(orc.get("ai")) != TYPE_DICTIONARY:
		fail("Orc Sentry should be in characters.json with an AI profile")
		quit(1)
		return
	# The studio's scenarios, step for step.
	var f := FileAccess.open("res://cast_expect.json", FileAccess.READ)
	var expect = JSON.parse_string(f.get_as_text())
	for sc in expect["scenarios"]:
		var c: Dictionary = VCGSCast.character(cast, sc["character"])
		var ai: Dictionary = c["ai"]
		var patrol: Array = sc["patrol"]
		var m: Dictionary = VCGSCast.start_memory(ai, patrol, float(sc["health"]))
		var trail: Array = []
		for i in int(sc["steps"]):
			var t: Dictionary = sc["target"]
			var world := { "target": { "x": float(t["x"]) + float(t["vx"]) * i, "y": float(t["y"]) + float(t["vy"]) * i, "noisy": t["noisy"], "alive": true, "dz": float(t.get("dz", 0.0)) }, "patrol": patrol, "walls": sc["walls"] }
			var r: Dictionary = VCGSCast.ai_step(ai, float(sc["speed"]), m, world, float(sc["dt"]))
			m = r["memory"]
			if r["reason"] != "":
				trail.append(r["reason"])
		var want: Array = sc["trail"]
		if trail != want:
			fail("%s: the trail differs.\n  studio: %s\n  godot:  %s" % [sc["name"], str(want), str(trail)])
		var fin: Dictionary = sc["final"]
		if m["state"] != fin["state"] or int(m["attacks"]) != int(fin["attacks"]) or abs(float(m["x"]) - float(fin["x"])) > 0.01 or abs(float(m["y"]) - float(fin["y"])) > 0.01:
			fail("%s: ends %s/%d at (%.3f, %.3f), the studio %s/%d at (%.3f, %.3f)" % [sc["name"], m["state"], m["attacks"], m["x"], m["y"], fin["state"], fin["attacks"], fin["x"], fin["y"]])
		print("ai: %s · %d transitions · ends %s" % [sc["name"], trail.size(), m["state"]])
	# A variant is the whole character: its own name and stats where it differs.
	for v in orc["variants"]:
		var whole: Dictionary = VCGSCast.character(cast, "orc_sentry", v["key"])
		if whole["name"] != v["name"] or float(whole["stats"]["health"]) != float(v["stats"]["health"]):
			fail("variant %s should be resolved as a whole" % v["key"])
	if orc["variants"].size() != 2:
		fail("the Orc Sentry should have 2 variants, got %d" % orc["variants"].size())
	# Inventory capacity and overflow.
	var inv := { "mode": "stack", "slots": 2, "stack": 10, "weight": 0.0 }
	if VCGSCast.fits(inv, [{ "item": "flare", "qty": 15 }], "flare", 5) != "":
		fail("20 flares in stacks of 10 should fit 2 slots")
	if VCGSCast.fits(inv, [{ "item": "flare", "qty": 15 }], "flare", 6) == "":
		fail("21 flares should not fit 2 slots of 10")
	if VCGSCast.fits({ "mode": "weight", "slots": 0, "stack": 1, "weight": 5.0 }, [], "anvil", 1, { "anvil": 40.0 }) != "Too heavy: 40 of 5 kg.":
		fail("an anvil should be too heavy")
	# Abilities: cost and cooldown.
	var fireball := { "key": "fireball", "name": "Fireball", "enabled": true, "kind": "active", "cost": { "resource": "mana", "amount": 15 }, "failure": "" }
	if VCGSCast.can_use(fireball, {}, { "mana": 10.0 }, 0.0) != "Not enough mana.":
		fail("a fireball should need mana")
	if VCGSCast.can_use(fireball, { "fireball": 5.0 }, { "mana": 100.0 }, 1.0) != "Fireball is cooling down.":
		fail("a fireball should cool down")
	# The way round walls (spec §19 navmesh): the machine heads for the corner steer gives it, and stands with no way.
	var corner := func(_ax: float, ay: float, tx: float, ty: float) -> Variant: return [0.0, 3.0, false] if ay < 2.999 else [tx, ty, true]
	var walker := { "x": 0.0, "y": 0.0, "facing": 0.0 }
	if VCGSCast._walk(walker, 3.0, 0.0, 1.0, 1.0, corner) or absf(walker["x"]) > 0.001 or absf(walker["y"] - 1.0) > 0.001:
		fail("an AI should walk to the corner of its way first, got " + str(walker))
	var stuck := { "x": 0.0, "y": 0.0, "facing": 0.0 }
	if VCGSCast._walk(stuck, 3.0, 0.0, 1.0, 1.0, func(_a, _b, _c, _d): return null) or stuck["x"] != 0.0:
		fail("an AI with no way there should stand, got " + str(stuck))
	# The spawn group and a placed orc: added now, checked once they are ready (a frame on).
	spawner = VCGSSpawnGroup.new()
	for p in cast["placements"]:
		if p["kind"] == "group":
			market = p
	spawner.item_guid = market["item"]
	root.add_child(spawner)
	orc_actor = VCGSActor.new()
	orc_actor.character_key = "orc_sentry"
	root.add_child(orc_actor)
	# Sight by the hero's height: a guard at x 0, a wall 1 m high at x 3.5, and past it at x 4
	# a hero standing (1.8 m) and one crouched (0.8 m), side by side (well away from the rest).
	lookout = VCGSActor.new()
	lookout.character_key = "orc_sentry"
	lookout.position = Vector3(0, 0, 50)
	root.add_child(lookout)
	var wall := StaticBody3D.new()
	var wall_shape := CollisionShape3D.new()
	var slab := BoxShape3D.new()
	slab.size = Vector3(0.2, 1.0, 4.0)
	wall_shape.shape = slab
	wall.position = Vector3(3.5, 0.5, 50)
	wall.add_child(wall_shape)
	root.add_child(wall)
	standing = _hero(1.8, 49.0)
	crouched = _hero(0.8, 51.0)

func _hero(tall: float, z: float) -> CharacterBody3D:
	var hero := CharacterBody3D.new()
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.3
	capsule.height = tall
	shape.shape = capsule
	shape.position.y = tall / 2.0
	hero.add_child(shape)
	hero.position = Vector3(4, 0, z)
	root.add_child(hero)
	return hero

var lookout: VCGSActor
var standing: CharacterBody3D
var crouched: CharacterBody3D

var spawner: VCGSSpawnGroup
var orc_actor: VCGSActor
var market: Dictionary = {}
var frames := 0

func _process(_delta: float) -> bool:
	frames += 1
	if frames < 3:
		return false
	var people: Array = spawner.spawned
	# Everyone the studio placed (the count is the group's seeded population for this area).
	var placed: int = market["members"].size()
	if placed < 1 or people.size() != placed:
		fail("Village Market should spawn the %d placed, got %d" % [placed, people.size()])
	else:
		var first: VCGSActor = people[0]
		var at: Array = market["members"][0]["position"]
		# Where the studio put it: its home, where it stood when it was spawned (a wanderer may have walked off since, as far as the frames allow).
		var home: Array = first.behavior.patrol[0] if first.behavior and not first.behavior.patrol.is_empty() else [first.position.x, first.position.z]
		if Vector2(float(home[0]), float(home[1])).distance_to(Vector2(at[0], at[2])) > 0.01:
			fail("the first villager should stand where the studio put it, got %s for %s" % [str(home), str(at)])
		if first.inventory == null or first.behavior == null or first.abilities == null or first.dialogue == null or first.equipment == null or first.perception == null:
			fail("a spawned character should have all its components")
		if first.get_node_or_null("Placeholder") == null:
			fail("a character with no final art should show its placeholder")
	var o := orc_actor
	# With no route it goes from Idle to Patrol (on the spot) at once, as in the studio.
	if o.behavior == null or not ["idle", "patrol"].has(o.behavior.memory.get("state", "")):
		fail("a placed Orc Sentry should run its machine, got %s" % str(o.behavior.memory if o.behavior else {}))
	if o.get_node_or_null("HandSocket") == null or o.get_node_or_null("HandSocket/Sword") == null:
		fail("the Orc Sentry should carry its sword at the hand socket")
	print("spawned %d villagers; orc %s" % [people.size(), o.behavior.memory.get("state", "?") if o.behavior else "?"])
	# Seen by what shows over the wall: the standing hero's head; nothing of the crouched one.
	var eyes: VCGSActorPerception = lookout.perception
	if eyes == null:
		fail("the lookout should have its perception")
	else:
		eyes.watch(standing)
		var tall_hidden := eyes.blocked(0.0, 49.0, 4.0, 49.0)
		eyes.watch(crouched)
		var low_hidden := eyes.blocked(0.0, 51.0, 4.0, 51.0)
		eyes.watch(null)
		var level_hidden := eyes.blocked(0.0, 51.0, 4.0, 51.0)
		if tall_hidden:
			fail("a guard should see a standing hero's head over a 1 m wall (and not count the hero's own body as in the way)")
		if not low_hidden:
			fail("a guard should not see a hero crouched behind a 1 m wall")
		if level_hidden:
			fail("with nothing to look at, a guard should look level, over the wall")
		print("sight by height: standing %s, crouched %s, level %s" % ["seen" if not tall_hidden else "hidden", "hidden" if low_hidden else "seen", "seen" if not level_hidden else "hidden"])
	# Footsteps: a walk (5 m/s) is heard, a crouched creep (1 m/s) is not, nor a body in the air; a "noisy" meta decides instead.
	var ears: VCGSActorBehavior = lookout.behavior
	var walker := Node3D.new()
	root.add_child(walker)
	walker.global_position = Vector3(0, 0, 60)
	ears._stride = Vector2.INF
	ears._footsteps(walker, 0.1)
	walker.global_position.x += 0.5
	var walk_heard := ears._footsteps(walker, 0.1)
	walker.global_position.x += 0.1
	var creep_heard := ears._footsteps(walker, 0.1)
	walker.set_meta("noisy", true)
	var meta_heard := ears._footsteps(walker, 0.1)
	var flier := CharacterBody3D.new()
	root.add_child(flier)
	ears._stride = Vector2.INF
	ears._footsteps(flier, 0.1)
	flier.global_position.x += 0.5
	var air_heard := ears._footsteps(flier, 0.1)
	if not walk_heard or creep_heard or not meta_heard or air_heard:
		fail("footsteps: a walk should be heard (%s), a creep not (%s), a noisy meta yes (%s), a body in the air not (%s)" % [walk_heard, creep_heard, meta_heard, air_heard])
	print("footsteps: walk %s, creep %s, in the air %s" % ["heard" if walk_heard else "silent", "heard" if creep_heard else "silent", "heard" if air_heard else "silent"])
	if failures > 0:
		quit(1)
		return true
	print("cast OK")
	quit(0)
	return true
