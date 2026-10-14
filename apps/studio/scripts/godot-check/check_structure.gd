extends SceneTree
# The Old Tomb in Godot (structure spec §7, §10, §14): the studio's own walk through
# it (structure_expect.json), step for step. What Interact offers at each door (a
# locked door, a secret one, a breakable one, a one-way one from each side), which
# doors are open after each step (the timed door shuts again), the objectives done,
# the completion and its effect on the story, and what the tomb remembers when the
# player leaves and comes back.

var failures := 0

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func check(level: Node, game: Node, step: Dictionary, n: int) -> void:
	var want: Dictionary = step["expect"]
	var what := "step %d (%s %s)" % [n, step["do"], str(step.get("guid", ""))]
	if want.has("verb"):
		var o: Dictionary = level.offer(str(step["guid"]))
		if str(o.get("verb", "")) != str(want["verb"]) or str(o.get("blocked", "")) != str(want.get("blocked", "")):
			fail("%s: offers %s, the studio %s" % [what, str(o), str(want)])
	if want.has("open"):
		for guid in want["open"]:
			if level.is_open(str(guid)) != bool(want["open"][guid]):
				fail("%s: %s should be %s" % [what, level.item(str(guid)).get("name", guid), "open" if want["open"][guid] else "shut"])
	if want.has("objectives"):
		var done: Array = level.objectives_done.keys()
		done.sort()
		if done != want["objectives"]:
			fail("%s: objectives done %s, the studio %s" % [what, str(done), str(want["objectives"])])
	if want.has("complete") and level.complete != bool(want["complete"]):
		fail("%s: complete is %s, the studio %s" % [what, level.complete, want["complete"]])
	if want.has("flags"):
		for key in want["flags"]:
			if game.get_flag(str(key)) != str(want["flags"][key]):
				fail("%s: %s is %s, the studio %s" % [what, key, game.get_flag(str(key)), want["flags"][key]])

func _initialize() -> void:
	var game: Node = root.get_node_or_null("GameState")
	# A new game: every story state at its start.
	VCGSRules.reset(game)
	var f := FileAccess.open("res://structure_expect.json", FileAccess.READ)
	var expect: Dictionary = JSON.parse_string(f.get_as_text())
	var packed: PackedScene = load("res://vcgs/generated/levels/" + str(expect["scene"]))
	var level: Node = packed.instantiate()
	root.add_child(level)
	level.setup(game)
	var data: Dictionary = level.structure_data()
	if str(data.get("name", "")) != "Old Tomb" or data.get("doors", []).size() != 5 or data.get("objectives", []).size() != 2:
		fail("the level script should carry the Old Tomb's manifest, got %s" % str(data.keys()))
	if level.objective != "Find the Tomb Key":
		fail("the first objective should be shown, got " + level.objective)
	var walker := Node3D.new()
	level.add_child(walker)
	level.player = walker
	var n := 0
	for step in expect["steps"]:
		n += 1
		var at: Array = step["at"]
		walker.position = Vector3(float(at[0]), float(at[1]), float(at[2]))
		match str(step["do"]):
			"interact":
				level.interact(str(step["guid"]))
				level._process(0.05)
			"wait":
				var left := float(step["seconds"])
				while left > 0.000001:
					var dt := minf(0.25, left)
					level._process(dt)
					left -= dt
			"remember":
				# Out of the tomb and back in: a new instance of its scene, as the game would load it.
				VCGSLevel.places[str(expect["level"])] = level.remember()
				level.free()
				level = packed.instantiate()
				root.add_child(level)
				level.setup(game)
				walker = Node3D.new()
				level.add_child(walker)
				level.player = walker
				walker.position = Vector3(float(at[0]), float(at[1]), float(at[2]))
		check(level, game, step, n)
	print("structure: %d steps · objectives %s · complete %s" % [n, str(level.objectives_done.keys()), level.complete])
	if failures > 0:
		quit(1)
		return
	print("structure OK")
	quit(0)
