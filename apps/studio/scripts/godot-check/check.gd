extends SceneTree
# Loads every generated file, then plays the Vault Door scene and pulls the lever.

var failures := 0
var trace: Array = []

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func walk(dir: String, out: Array) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		out.append(dir.path_join(f))
	for sub in d.get_directories():
		walk(dir.path_join(sub), out)

func _initialize() -> void:
	var files: Array = []
	walk("res://vcgs/generated", files)
	walk("res://addons/vcgs_runtime", files)
	var scripts := 0
	var resources := 0
	for path in files:
		if path.ends_with(".gd"):
			var script: GDScript = load(path)
			if script == null or not script.can_instantiate() and not script.is_abstract():
				fail("script did not load: " + path)
			scripts += 1
		elif path.ends_with(".tres"):
			var res := load(path)
			if res == null or res.get("key") == "":
				fail("resource did not load: " + path)
			resources += 1
	print("loaded ", scripts, " scripts and ", resources, " resources")

	var mara: Resource = load("res://vcgs/generated/characters/mara.tres")
	if mara.display_name != "Mara" or mara.role != "Main":
		fail("Mara's resource is wrong: " + str(mara.display_name) + " / " + str(mara.role))

	# The GameState autoload, as a game would have it.
	var game: Node = root.get_node_or_null("GameState")
	if game == null:
		fail("the GameState autoload is missing")
		quit(1)
		return
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	if game.get_flag("door_solved") != "no":
		fail("door_solved should start at no")

	var lever: Node = load("res://vcgs/generated/objects/rusted_lever.gd").new()
	root.add_child(lever)
	if lever.available_verbs() != ["Pull"] or lever.state != "down":
		fail("lever should start down, is " + lever.state)
	if not lever.interact("Pull"):
		fail("Pull should work when the lever is down")
	if lever.state != "up" or game.get_flag("door_solved") != "yes":
		fail("Pull should leave the lever up and set door_solved = yes")
	if lever.interact("Pull"):
		fail("Pull should not work twice")

	var flow: Node = load("res://vcgs/generated/scenes/sc_03_the_vault_door.gd").new()
	root.add_child(flow)
	flow.event_started.connect(func(e: Dictionary) -> void: trace.append(e.get("kind", "") + ":" + e.get("label", "")))
	var choices: Array = []
	flow.choice_requested.connect(func(_key: String, options: Array) -> void: choices.append(options))
	var finished: Array = []
	flow.scene_finished.connect(func(next: String) -> void: finished.append(next))
	flow.start()
	for i in 5:
		flow.advance()
	# At the choice: take the second option, Force it, which rejoins the free play.
	flow.choose(1)
	flow.advance()
	flow.advance()
	# Back at free play; carry on to the choice and turn the key this time.
	flow.advance()
	flow.choose(0)
	print("trace: ", " > ".join(trace))
	print("options: ", choices)
	print("finished: ", finished)
	if choices.size() != 2 or choices[0] != ["Turn the key", "Force it"]:
		fail("the choice should offer Turn the key and Force it")
	if finished != ["cin_01_the_vault_opens"] and finished != ["the_vault_opens"]:
		fail("the scene should end into the cinematic, got " + str(finished))

	var choice: GDScript = load("res://vcgs/generated/choices/take_the_lantern.gd")
	print("C1 options: ", choice.OPTIONS)
	if choice.choose(1, game) != "sc_04_the_squeeze":
		fail("Crawl through should lead to the squeeze")

	print("OK" if failures == 0 else str(failures) + " FAILED")
	quit(0 if failures == 0 else 1)
