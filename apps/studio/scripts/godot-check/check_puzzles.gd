extends SceneTree
# Plays the sample's built-in puzzle templates with the generated runtime
# (puzzle spec §6–§10): the Safe code's clues, keypad, tries and hints; the
# plates in order against the clock; the lever the door needs first.

var failures := 0

func fail(message: String) -> void:
	failures += 1
	printerr("FAIL: ", message)

func step_id(rules: GDScript, puzzle: String, label: String) -> String:
	for s in rules.PUZZLES[puzzle]["design"]["steps"]:
		if s["label"] == label:
			return s["id"]
	fail(puzzle + " has no step " + label)
	return ""

func _initialize() -> void:
	var game: Node = root.get_node_or_null("GameState")
	var rules: GDScript = load("res://vcgs/generated/logic/rules.gd")
	rules.reset(game)
	var steps: Array = []
	var hints: Array = []
	var cues: Array = []
	var asked: Array = []
	var answers: Array = []
	game.puzzle_step.connect(func(p: String, s: String, what: String) -> void: steps.append([p, s, what]))
	game.hint_given.connect(func(p: String, text: String) -> void: hints.append(text))
	game.puzzle_cue.connect(func(p: String, kind: String, text: String, ref: String) -> void: cues.append(kind + ": " + text))
	game.screen_requested.connect(func(o: String, verb: String) -> void: asked.append(o + ":" + verb))
	game.screen_answered.connect(func(o: String, right: bool) -> void: answers.append(right))

	# The Safe code: its keypad comes up when the code is entered; a wrong code counts and gives the first hint.
	var safe: Node = load("res://vcgs/generated/objects/safe.gd").new()
	root.add_child(safe)
	if not safe.interact("Enter code") or asked != ["safe:Enter code"] or game.object_states["safe"] != "Locked":
		fail("Enter code should ask for the safe's screen and change nothing, got " + str(asked) + " " + str(game.object_states["safe"]))
	if rules.answer_screen("safe", "1111", game) or game.screen_fails.get("safe", 0) != 1:
		fail("a wrong code should be wrong, and counted")
	if hints != ["The painting hangs a little crooked."]:
		fail("the first wrong code should give the first hint, got " + str(hints))
	# The clues: the painting and the drawer reveal them, and the work is done.
	var painting: Node = load("res://vcgs/generated/objects/painting.gd").new()
	var drawer: Node = load("res://vcgs/generated/objects/desk_drawer.gd").new()
	root.add_child(painting)
	root.add_child(drawer)
	painting.interact("Inspect")
	drawer.interact("Open")
	var work := step_id(rules, "safe_code", "Work out the code")
	var enter := step_id(rules, "safe_code", "Enter the code")
	if not game.step_done("safe_code", work) or game.step_done("safe_code", enter) or game.is_solved("safe_code"):
		fail("the clues should work out the code, and the code not be entered yet")
	# The right code: the safe opens, its step is done, it is solved, and its cues play.
	if not rules.answer_screen("safe", "4271", game) or game.object_states["safe"] != "Open" or safe.available_verbs() != ["Inspect", "Take"]:
		fail("the right code should open the safe, got " + str(game.object_states["safe"]))
	if not game.step_done("safe_code", enter) or not game.is_solved("safe_code"):
		fail("entering the code should solve the Safe code")
	if cues != ["audio: A heavy click", "animation: The safe door swings open"]:
		fail("solving it should play its cues, got " + str(cues))
	print("safe: ", answers, " · hints ", hints, " · cues ", cues)

	# Out of tries, a screen takes no more answers.
	rules.reset(game)
	for i in 3:
		rules.answer_screen("safe", "0000", game)
	if not rules.screen_locked("safe", game) or rules.answer_screen("safe", "4271", game) or game.object_states["safe"] != "Locked":
		fail("three wrong codes should jam the keypad")
	if game.hinted.size() != 2:
		fail("two wrong codes and more should give both hints, got " + str(game.hinted))

	# Plates in order, within 10 seconds: out of order does nothing; out of time undoes them.
	rules.reset(game)
	steps.clear()
	var sun := step_id(rules, "plates_in_order", "The sun plate")
	var moon := step_id(rules, "plates_in_order", "The moon plate")
	game.set_object_state("moon_plate", "Down")
	if game.step_done("plates_in_order", moon):
		fail("the moon plate before the sun should wait")
	game.set_object_state("moon_plate", "Up")
	game.set_object_state("sun_plate", "Down")
	if not game.step_done("plates_in_order", sun):
		fail("the sun plate should be done")
	game.advance_clock(11.0)
	if game.step_done("plates_in_order", sun) or not steps.any(func(e: Array) -> bool: return e[2] == "expired"):
		fail("ten seconds on, the sequence should run out, got " + str(steps))
	# Still down, it doesn't count again until stepped on anew.
	game.set_object_state("moon_plate", "Down")
	if game.step_done("plates_in_order", sun):
		fail("a plate left down should need stepping on again")
	game.set_object_state("sun_plate", "Up")
	game.set_object_state("moon_plate", "Up")
	for plate in ["sun_plate", "moon_plate", "star_plate"]:
		game.set_object_state(plate, "Down")
		game.advance_clock(1.0)
	if not game.is_solved("plates_in_order"):
		fail("the plates in order, in time, should solve it, got " + str(game.puzzle_steps.get("plates_in_order")))
	print("plates: ", steps.map(func(e: Array) -> String: return e[2]))

	# Lever and door: the door can't be done before the lever. A save keeps the progress.
	rules.reset(game)
	var lever: Node = load("res://vcgs/generated/objects/lever.gd").new()
	var door: Node = load("res://vcgs/generated/objects/door.gd").new()
	root.add_child(lever)
	root.add_child(door)
	var pull := step_id(rules, "lever_and_door", "Pull the lever")
	game.set_object_state("door", "Open")
	if game.step_done("lever_and_door", step_id(rules, "lever_and_door", "Open the door")):
		fail("the door should need the lever first")
	game.set_object_state("door", "Locked")
	lever.interact("Pull")
	if not game.step_done("lever_and_door", pull) or game.object_states["door"] != "Closed":
		fail("pulling the lever should unlock the door and do its step")
	var saved: String = game.save_text("lever_and_door")
	rules.reset(game)
	game.load_text(saved)
	if not game.step_done("lever_and_door", pull):
		fail("a save should keep the puzzle's progress")
	door.interact("Open")
	if not game.is_solved("lever_and_door"):
		fail("opening the door after the lever should solve it")

	# Every screen kind's answer, checked.
	var cases := [
		[{ "kind": "dial", "combination": [12, 30, 7] }, [12, 30, 7], [12, 7, 30]],
		[{ "kind": "symbols", "answer": ["a", "b"] }, ["a", "b"], ["b", "a"]],
		[{ "kind": "custom", "text": "Answer" }, " answer ", "nope"],
		[{ "kind": "ordering", "items": ["Dawn", "Dusk"] }, ["Dawn", "Dusk"], ["Dusk", "Dawn"]],
		[{ "kind": "matching", "pairs": [{ "left": "Lion", "right": "Sun" }, { "left": "Hare", "right": "Moon" }] }, ["Sun", "Moon"], ["Moon", "Sun"]],
		[{ "kind": "assembly", "slots": [{ "id": "s1", "accepts": "p1" }] }, { "s1": "p1" }, { "s1": "p2" }],
		[{ "kind": "levers", "target": [true, false] }, [true, false], [true, true]],
		[{ "kind": "rings", "rings": 2, "segments": 8 }, [0, 8], [0, 1]],
		[{ "kind": "tiles", "size": 2 }, [1, 2, 3, 0], [1, 3, 2, 0]],
		[{ "kind": "circuit", "width": 3, "height": 1, "source": 0, "sink": 2, "cells": [{ "piece": "end", "rot": 1 }, { "piece": "straight", "rot": 1 }, { "piece": "end", "rot": 3 }] }, [1, 1, 3], [1, 0, 3]],
	]
	for c in cases:
		if not VCGSPuzzleRuntime.check_screen(c[0], c[1]) or VCGSPuzzleRuntime.check_screen(c[0], c[2]):
			fail("the " + str(c[0]["kind"]) + " screen should take the right answer only")
	var circuit: Dictionary = cases[9][0]
	if VCGSPuzzleRuntime.circuit_joined(circuit, VCGSPuzzleRuntime.start_state(circuit)):
		fail("a circuit should start out of true")
	var tiles := { "kind": "tiles", "size": 3, "shuffle": 30 }
	if VCGSPuzzleRuntime.check_screen(tiles, VCGSPuzzleRuntime.start_state(tiles)):
		fail("tiles should start shuffled")
	if VCGSPuzzleRuntime.flip({ "links": [[1], [0]] }, [false, false], 0) != [true, true]:
		fail("a switch should flip the ones it is linked to")
	print("screens: ", cases.size(), " kinds checked")

	for n in [safe, painting, drawer, lever, door]:
		n.free()
	if failures:
		printerr(failures, " puzzle check(s) failed")
		quit(1)
	else:
		print("puzzles OK")
		quit(0)
