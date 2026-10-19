extends SceneTree
# Captured (adventure games): the sample with capture set up, and the Eel swarm
# capturing the player who loses to it. Lose in SC-02 The Key: counted, health
# set, the knife taken, and on to the Holding cell. The Evidence locker there
# gives the knife back; out of the cell, back in The Key past the fight.

var failures := 0

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func _initialize() -> void:
	var rules: GDScript = load("res://vcgs/generated/logic/rules.gd")
	var game: Node = root.get_node_or_null("GameState")
	if game == null:
		fail("the GameState autoload is missing")
		quit(1)
		return
	rules.reset(game)
	var cell := str(rules.CAPTURE.get("cell", ""))
	var locker := str(rules.CAPTURE.get("locker", ""))
	var count := str(rules.CAPTURE.get("count", ""))
	var health := str(rules.CAPTURE.get("health", ""))
	if cell == "" or locker == "" or count == "" or health == "":
		fail("capture should name its cell, locker, count and health, got " + str(rules.CAPTURE))
	if game.get_flag(health) != "100":
		fail("health should start at 100, got " + game.get_flag(health))
	if not rules.is_captor("orc_sentry") or rules.is_captor("mara"):
		fail("the Orc Sentry should be a captor, and Mara not")
	game.give_item("diving_knife")

	# Lose to the eels: captured, to the holding cell.
	var key_scene: Node = load("res://vcgs/generated/scenes/sc_02_the_key.gd").new()
	root.add_child(key_scene)
	var finished: Array = []
	var over: Array = []
	key_scene.scene_finished.connect(func(next: String) -> void: finished.append(next))
	key_scene.game_over.connect(func(k: String) -> void: over.append(k))
	key_scene.start()
	key_scene.lose()
	if finished != [cell] or not over.is_empty():
		fail("losing the eels should go to the holding cell, got " + str(finished) + " / over " + str(over))
	if game.get_flag(count) != "1" or game.get_flag(health) != "50":
		fail("a capture should count 1 and set health to 50, got " + game.get_flag(count) + " / " + game.get_flag(health))
	if game.has_item("diving_knife") or int(game.taken.get("diving_knife", 0)) != 1:
		fail("the knife should be taken, got items " + str(game.items) + " taken " + str(game.taken))
	if str(game.held.get("scene", "")) != "sc_02_the_key" or int(game.held.get("index", -1)) != 1:
		fail("where the player was caught should be kept, got " + str(game.held))
	# Held already, another capture doesn't happen.
	if key_scene.capture():
		fail("a player held already should not be captured again")
	key_scene.queue_free()

	# A save in the cell keeps what was taken and where they were caught.
	var saved: Dictionary = game.save_data(cell)
	if saved.get("taken", {}) != { "diving_knife": 1 } or str(saved.get("held", {}).get("scene", "")) != "sc_02_the_key":
		fail("a save should keep what was taken and where, got " + str(saved.get("taken")) + " / " + str(saved.get("held")))

	# The holding cell: the locker gives the knife back.
	var cell_scene: Node = load("res://vcgs/generated/scenes/%s.gd" % cell).new()
	root.add_child(cell_scene)
	var out: Array = []
	var free: Array = []
	cell_scene.scene_finished.connect(func(next: String) -> void: out.append(next))
	cell_scene.free_play_started.connect(func(ends: String) -> void: free.append(ends))
	cell_scene.start()
	if free.size() != 1:
		fail("the holding cell should open on its free play, got " + str(free))
	var box: Node = load("res://vcgs/generated/objects/%s.gd" % locker).new()
	root.add_child(box)
	if not box.available_verbs().has(rules.LOCKER_VERB):
		fail("the locker should offer the knife back, got " + str(box.available_verbs()))
	if not box.interact(rules.LOCKER_VERB) or not game.has_item("diving_knife") or not game.taken.is_empty():
		fail("taking things back should return the knife")
	if box.available_verbs().has(rules.LOCKER_VERB):
		fail("the locker should be empty now")
	# The escape puzzle: no lock picked without the nail; the brick gives it; picked and opened, the way out ends.
	var relock: Array = rules.CAPTURE.get("relock", [])
	if relock.is_empty():
		fail("the holding cell should have an escape puzzle to relock")
	var door: Node = load("res://vcgs/generated/objects/cell_door.gd").new()
	var brick: Node = load("res://vcgs/generated/objects/loose_brick.gd").new()
	root.add_child(door)
	root.add_child(brick)
	if door.interact("Pick the lock"):
		fail("the cell door should not open without the nail")
	if not brick.interact("Pull out") or not game.has_item("bent_nail"):
		fail("the loose brick should give the bent nail")
	if not door.interact("Pick the lock") or not door.interact("Open"):
		fail("with the nail, the cell door should be picked and opened")
	if not game.solved.has(relock[0]):
		fail("the door open should solve " + str(relock[0]) + ", solved " + str(game.solved))
	print("escaped the cell: ", relock[0], " solved, door ", game.object_states.get("cell_door", "?"))
	# Out of the cell: back to The Key (the free play ended by the puzzle, or moved on from).
	if out.is_empty():
		cell_scene.advance()
	if out != ["sc_02_the_key"] or not game.held.is_empty():
		fail("out of the cell should go back to The Key, got " + str(out) + " held " + str(game.held))
	cell_scene.queue_free()

	# The Key again picks up past the fight: the key in the silt.
	var again: Node = load("res://vcgs/generated/scenes/sc_02_the_key.gd").new()
	root.add_child(again)
	var kinds: Array = []
	again.event_started.connect(func(e: Dictionary) -> void: kinds.append(str(e.get("kind", ""))))
	again.start()
	if kinds.is_empty() or kinds[0] == "encounter" or not game.has_item("vault_key"):
		fail("The Key should pick up past the eels, got " + str(kinds) + " key " + str(game.has_item("vault_key")))
	if not game.resume.is_empty():
		fail("the resume point should be used up")
	print("capture: to ", cell, ", taken ", saved.get("taken"), ", back with the knife ", game.has_item("diving_knife"), ", on with ", kinds, " · captures ", game.get_flag(count))

	# Caught in play while a scene plays: captured from where it is, past the event on now.
	var caught: Array = []
	game.captured.connect(func(to: String, by: String) -> void: caught.append([to, by]))
	var to_cell: Array = []
	again.scene_finished.connect(func(next: String) -> void: to_cell.append(next))
	if VCGSRules.catch_player("orc_sentry", game) != cell or to_cell != [cell] or caught != [[cell, "orc_sentry"]]:
		fail("a catch in play should capture from the scene playing, got " + str(to_cell) + " / " + str(caught))
	if game.solved.has(relock[0]) or str(game.object_states.get("cell_door", "")) != "Locked" or str(game.object_states.get("loose_brick", "")) != "In the wall":
		fail("caught again, the cell should be locked again, got " + str(game.object_states))
	if str(game.held.get("scene", "")) != "sc_02_the_key":
		fail("a catch in play should keep the scene it was in, got " + str(game.held))
	if VCGSRules.catch_player("orc_sentry", game) != "":
		fail("a player held already should not be caught again")
	again.queue_free()

	# The rest needs the tree running: a level, and the Orc Sentry (once its data is in).
	rules.reset(game)
	game.flow_now = null

var orc: VCGSActor
var hero: Node3D
var level: Node
var frames := 0

## Caught with no scene playing, in the level: taken to the room linked to the holding cell.
func caught_in_level(game: Node, cell: String) -> void:
	var dir := DirAccess.open("res://vcgs/generated/levels")
	for f in dir.get_files():
		if not f.ends_with(".tscn") or f.begins_with("play_") or level != null:
			continue
		var made: Node = (load("res://vcgs/generated/levels/" + f) as PackedScene).instantiate()
		if not made.has_method("setup"):
			made.free()
			continue
		root.add_child(made)
		made.setup(game)
		for guid in made._data:
			if made._data[guid].get("links", []).has(cell):
				level = made
		if level == null:
			made.queue_free()
	if level == null:
		fail("a level should have a room linked to the holding cell")
		return
	hero = Node3D.new()
	hero.add_to_group("player")
	root.add_child(hero)
	hero.global_position = Vector3(40, 0, 40)
	level.player = hero
	var room: Node3D = null
	for guid in level._data:
		if level._data[guid].get("links", []).has(cell):
			room = level.nodes[guid]
	if VCGSRules.catch_player("", game) != cell or str(game.held.get("scene", "-")) != "":
		fail("a catch with no scene playing should still capture, got " + str(game.held))
	if hero.global_position.distance_to(room.global_position) > 0.01:
		fail("the level should take the player to the room linked to the cell, got " + str(hero.global_position) + " vs " + str(room.global_position))
	# Out of the cell with nowhere to go back to: the cell goes on as the graph says.
	var out_of: Node = load("res://vcgs/generated/scenes/%s.gd" % cell).new()
	root.add_child(out_of)
	var next: Array = []
	out_of.scene_finished.connect(func(n: String) -> void: next.append(n))
	out_of.start()
	out_of.advance()
	if not game.held.is_empty() or next.size() != 1:
		fail("out of the cell should finish it, got " + str(next))
	print("caught in the level: to ", room.name, " at ", hero.global_position)
	out_of.queue_free()
	# No player in the way of the Orc Sentry's own physics.
	hero.remove_from_group("player")
	VCGSRules.reset(game)
	game.flow_now = null

func _process(_delta: float) -> bool:
	frames += 1
	var game: Node = root.get_node_or_null("GameState")
	var cell := str(VCGSRules.CAPTURE.get("cell", ""))
	if frames == 1:
		caught_in_level(game, cell)
		orc = VCGSActor.new()
		orc.character_key = "orc_sentry"
		root.add_child(orc)
		return false
	if frames < 3:
		return false
	# The Orc Sentry is a captor: its blow catches the player.
	var count := str(VCGSRules.CAPTURE.get("count", ""))
	if orc.behavior == null:
		fail("the Orc Sentry should be set up with its behaviour")
	elif not orc.behavior._catch() or game.get_flag(count) != "1":
		fail("the Orc Sentry's blow should capture the player, got " + game.get_flag(count) + " / " + str(game.held))
	else:
		print("caught by the Orc Sentry: captures ", game.get_flag(count))
	quit(1 if failures else 0)
	return true
