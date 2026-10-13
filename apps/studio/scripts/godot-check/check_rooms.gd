extends SceneTree
# Rooms (sub-scenes) in the story graph: SC-01 The Cave Mouth has The Study,
# and The Closet is inside it. Played through: Where now?, into a room and
# back, out a level, and on along the story.

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
	if failures > 0:
		quit(1)
		return
	print("rooms OK")
	quit(0)
