extends SceneTree
# Rooms (sub-scenes) in the story graph: SC-01 The Cave Mouth has The Study,
# and The Closet is inside it. Played through: Where now?, into a room and
# back, out a level, and on along the story. Then the levels it passes through.

var failures := 0

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func key_named(story: GDScript, name: String) -> String:
	for k in story.NODES:
		if str(story.NODES[k].get("name", "")) == name:
			return k
	fail("no node named " + name)
	return ""

func labels(choice: GDScript) -> Array:
	var out: Array = []
	for o in choice.OPTIONS:
		out.append(str(o["label"]))
	return out

func _initialize() -> void:
	var story: GDScript = load("res://vcgs/generated/story/story_graph.gd")
	var game: Node = root.get_node_or_null("GameState")
	if game == null:
		fail("the GameState autoload is missing")
		quit(1)
		return
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	var cave_key := key_named(story, "The Cave Mouth")
	var cave_where := key_named(story, "The Cave Mouth: where now?")
	var study := key_named(story, "The Study")
	var study_where := key_named(story, "The Study: where now?")
	var closet := key_named(story, "The Closet")

	# The scene, played through, goes to its Where now? (its scene script's exits say so too).
	var cave_flow: GDScript = load("res://vcgs/generated/scenes/%s.gd" % cave_key)
	if cave_flow.EXITS.size() != 1 or str(cave_flow.EXITS[0]["to"]) != cave_where:
		fail("The Cave Mouth should go on to its Where now?, got " + str(cave_flow.EXITS))
	var node: Dictionary = story.NODES[cave_where]
	if str(node["kind"]) != "choice":
		fail("Where now? should be a choice")
	var where: GDScript = load(str(node["script"]))
	if where.PROMPT != "Where now?" or labels(where) != ["Go into The Study", "Leave The Cave Mouth"]:
		fail("The Cave Mouth's Where now? is wrong: " + str(labels(where)))
	if where.choose(0, game) != study:
		fail("Go into The Study should lead to the study")
	# The study has a room of its own; the closet goes back to the study's question.
	if str(story.NODES[study]["routes"][0]["to"]) != study_where:
		fail("The Study should go on to its own Where now?")
	var study_choice: GDScript = load(str(story.NODES[study_where]["script"]))
	if labels(study_choice) != ["Go into The Closet", "Leave The Study"]:
		fail("The Study's Where now? is wrong: " + str(labels(study_choice)))
	if study_choice.choose(0, game) != closet or str(story.NODES[closet]["routes"][0]["to"]) != study_where:
		fail("The Closet should be reached and lead back to The Study's question")
	# Leaving the study goes back out to the cave's question; leaving the cave goes on along the story.
	if study_choice.choose(1, game) != cave_where:
		fail("Leave The Study should go back to The Cave Mouth's question")
	# Rooms the player has been in read "(been)" (a scene marks itself visited as it plays).
	if where.label(0, game) != "Go into The Study":
		fail("The Study should not read been before it is visited")
	game.visit(study)
	if where.label(0, game) != "Go into The Study (been)" or where.listed(game)[0]["label"] != "Go into The Study (been)":
		fail("The Study should read been once visited, got " + where.label(0, game))
	var onward: String = where.choose(1, game)
	if onward == "" or onward == cave_where or not story.NODES.has(onward):
		fail("Leave The Cave Mouth should go on along the story, got " + onward)
	print("rooms: ", where.label(0, game), " · ", labels(where), " · ", labels(study_choice), " · then ", story.NODES[onward]["name"])
	# Level transitions: each node on the graph says the level of the Level lane it is in.
	var key_node := key_named(story, "The Key")
	if str(story.NODES[cave_key].get("level", "")) != "The Flooded Cave" or str(story.NODES[key_node].get("level", "")) != "The Sunken Vault":
		fail("the graph should carry each node's level, got " + str(story.NODES[cave_key].get("level", "")) + " / " + str(story.NODES[key_node].get("level", "")))
	game.level = ""
	var first: String = game.enter_level("The Flooded Cave")
	var again: String = game.enter_level("The Flooded Cave")
	var none: String = game.enter_level("")
	var crossing: String = game.enter_level("The Sunken Vault")
	if first != "LEVEL · The Flooded Cave" or again != "" or none != "" or crossing != "End of The Flooded Cave → LEVEL · The Sunken Vault":
		fail("level transitions are wrong: [%s] [%s] [%s] [%s]" % [first, again, none, crossing])
	# The level the player is in is kept in a save.
	game.checkpoint(key_node)
	var saved: String = game.save_text("check")
	game.level = ""
	game.load_text(saved)
	if game.level != "The Sunken Vault":
		fail("a save should keep the level, got " + game.level)
	# The Sunken Vault has a map, The Flooded Cave none: the vault's map loads on the crossing.
	var vault_map := str(story.NODES[key_node].get("level_map", ""))
	if vault_map == "" or story.NODES[cave_key].has("level_map"):
		fail("only The Sunken Vault's nodes should carry its map, got [%s] [%s]" % [vault_map, str(story.NODES[cave_key].get("level_map", ""))])
	var heard: Array = []
	game.level_entered.connect(func(from: String, to: String, map_key: String) -> void: heard.append([from, to, map_key]))
	game.level = ""
	game.enter_level("The Flooded Cave", "")
	game.enter_level("The Sunken Vault", vault_map)
	if heard != [["", "The Flooded Cave", ""], ["The Flooded Cave", "The Sunken Vault", vault_map]] or game.level_map != vault_map:
		fail("level_entered should say each crossing and its map, got " + str(heard))
	var shown: Node = game.show_level_map("res://vcgs/generated/levels/%s.tscn" % vault_map)
	if shown == null or not (shown is VCGSLevel):
		fail("the vault's map should load as a VCGSLevel")
	elif game.show_level_map("res://vcgs/generated/levels/%s.tscn" % vault_map) != shown:
		fail("showing the same map again should keep it")
	if game.show_level_map("res://vcgs/generated/levels/no_such_map.tscn") != null:
		fail("a map that is not there should load nothing")
	print("levels: ", first, " · ", crossing, " · map ", vault_map)
	# The transition between the levels: a cinematic just after Descent, where they meet, played as the player crosses.
	var descent := key_named(story, "Descent")
	var transition := key_named(story, "The Flooded Cave → The Sunken Vault")
	if str(story.NODES[descent].get("onward", "")) != transition or story.NODES[transition].get("transition", {}) != {"from": "The Flooded Cave", "to": "The Sunken Vault"}:
		fail("the transition cinematic should follow Descent and name the levels it joins, got " + str(story.NODES[transition]))
	var scene: Node = (load(str(story.NODES[cave_key]["file"])) as PackedScene).instantiate()
	var player: Node = scene.get_node("DebugPlayer")
	player.autostart = false
	root.add_child(scene)
	game.level = "The Flooded Cave"
	game.level_map = ""
	player.go_to(descent)
	if not player.text().begins_with("End of The Flooded Cave → LEVEL · The Sunken Vault\n\n") or player.labels() != ["Continue"]:
		fail("Descent should cross into The Sunken Vault, got " + player.text())
	player.press(0)
	if not player.text().begins_with("[Transition] The Flooded Cave → The Sunken Vault\n[Cinematic] The Flooded Cave → The Sunken Vault"):
		fail("the transition cinematic should play next, got " + player.text())
	# It plays for its length (3 s: no shots yet) and goes on by itself; Skip goes on at once.
	if player.labels() != ["Skip"] or player.transition_playing != transition or player.transition_seconds(transition) != 3.0:
		fail("the transition should offer Skip and run 3 s, got " + str(player.labels()) + " " + str(player.transition_seconds(transition)))
	var skipped: Array = []
	player.transition_finished.connect(func(k: String) -> void: skipped.append(k))
	player.press(0)
	if player.transition_playing != "" or skipped != [transition] or player.text().begins_with("[Transition]"):
		fail("Skip should end the transition and go on with the story, got " + player.text())
	print("transition: ", transition, " skipped to ", player.text().split("\n")[0])
	if failures > 0:
		quit(1)
		return
	print("rooms OK")
	quit(0)
