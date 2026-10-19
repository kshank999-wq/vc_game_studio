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
	# Out of the cell: back to The Key.
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
	again.queue_free()
	quit(1 if failures else 0)
