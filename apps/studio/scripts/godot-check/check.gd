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
	var scenes := 0
	for path in files:
		if path.ends_with(".gd"):
			var script: GDScript = load(path)
			if script == null or not script.can_instantiate() and not script.is_abstract():
				fail("script did not load: " + path)
			scripts += 1
		elif path.ends_with(".tscn"):
			var packed: PackedScene = load(path)
			if packed == null or not packed.can_instantiate():
				fail("scene did not load: " + path)
			else:
				packed.instantiate().free()
			scenes += 1
		elif path.ends_with(".tres"):
			var res := load(path)
			if res == null or res.get("key") == "":
				fail("resource did not load: " + path)
			resources += 1
	print("loaded ", scripts, " scripts, ", resources, " resources and ", scenes, " scenes")
	if scenes < 5:
		fail("expected a placeholder scene per story scene and play_story.tscn, got " + str(scenes))

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
	# The quest starts only by an effect (finding the key): not yet.
	if game.quest_state("open_the_vault") != "":
		fail("Open the vault should wait for its effect after reset, is " + game.quest_state("open_the_vault"))
	if game.knows_lore("the_drowned_order") or game.has_mechanic("lantern_oil"):
		fail("the Order's lore and the lantern's oil should wait for their rules")
	var quest_done: Array = []
	game.quest_completed.connect(func(k: String) -> void: quest_done.append(k))

	var lever: Node = load("res://vcgs/generated/objects/rusted_lever.gd").new()
	root.add_child(lever)
	if lever.available_verbs() != ["Pull"] or lever.state != "down":
		fail("lever should start down, is " + lever.state)

	# The key was found earlier in the story.
	game.give_item("vault_key")

	var flow: Node = load("res://vcgs/generated/scenes/sc_03_the_vault_door.gd").new()
	root.add_child(flow)
	flow.event_started.connect(func(e: Dictionary) -> void: trace.append(e.get("kind", "") + ":" + e.get("label", "")))
	var choices: Array = []
	flow.choice_requested.connect(func(_key: String, options: Array) -> void: choices.append(options))
	var finished: Array = []
	flow.scene_finished.connect(func(next: String) -> void: finished.append(next))
	var duals: Array = []
	flow.dual_requested.connect(func(a: String, b: String) -> void: duals.append([a, b]))
	var singles: Array = []
	flow.dialogue_requested.connect(func(l: String) -> void: singles.append(l))
	flow.start()
	if not game.was_visited("sc_03_the_vault_door"):
		fail("starting the scene should mark it visited")
	# Reaching the vault door reveals the Order's story.
	if game.known_lore() != ["the_drowned_order"] or load("res://vcgs/generated/logic/rules.gd").LORE["the_drowned_order"]["name"] != "The Drowned Order":
		fail("the vault door should reveal The Drowned Order, got " + str(game.known_lore()))
	# The cinematic, then Mara and the Explorer at once (dual dialogue: one beat), then the echo cue.
	for i in 3:
		flow.advance()
	var dialogue: GDScript = load("res://vcgs/generated/dialogue/dialogue_table.gd")
	if duals.size() != 1 or not singles.is_empty():
		fail("Mara and the Explorer should speak at once, as one beat, got duals " + str(duals) + " and singles " + str(singles))
	else:
		var who: Array = [dialogue.line(duals[0][0]).get("speaker", ""), dialogue.line(duals[0][1]).get("speaker", "")]
		print("dual: ", who, " ", duals[0])
		if who != ["mara", "the_explorer"]:
			fail("the pair should be Mara (left) then the Explorer, got " + str(who))
	# Both have spoken, so the player has met both (the codex lists only Mara, who has an entry).
	if not game.has_met_character("mara") or not game.has_met_character("the_explorer"):
		fail("speaking should meet Mara and the Explorer, got " + str(game.met_characters()))
	if load("res://vcgs/generated/logic/rules.gd").CHARACTERS.keys() != ["mara"] or not str(mara.codex).begins_with("A guide who knows"):
		fail("only Mara should have a codex entry, got " + str(load("res://vcgs/generated/logic/rules.gd").CHARACTERS))
	# In free play now. It ends by itself when the door is solved.
	if not choices.is_empty():
		fail("the choice should wait for the free play to end")
	if not lever.interact("Pull"):
		fail("Pull should work when the lever is down")
	if lever.state != "up" or game.get_flag("door_solved") != "yes":
		fail("Pull should leave the lever up, and the seam draining should set door_solved = yes")
	if not game.fired.has("seam_drains") or not game.is_solved("the_vault_door"):
		fail("the lever should fire Seam drains and solve The Vault Door")
	if lever.interact("Pull"):
		fail("Pull should not work twice")
	if choices.size() != 1:
		fail("free play should end into the choice once the door is solved")
	# Take the second option, Force it, which rejoins the free play; that ends straight away.
	flow.choose(1)
	flow.advance()
	flow.advance()
	# Back at the choice; turn the key this time.
	flow.choose(0)
	print("trace: ", " > ".join(trace))
	print("options: ", choices)
	print("finished: ", finished)
	if choices.size() != 2 or choices[0] != ["Turn the key", "Force it"]:
		fail("the choice should offer Turn the key and Force it first, got " + str(choices))
	# Force it disappears once picked: the second time only the key is on offer.
	if choices.size() == 2 and choices[1] != ["Turn the key"]:
		fail("Force it should be gone the second time, got " + str(choices[1]))
	if flow.options_detail.size() != 1:
		fail("the options list should hold only Turn the key now, got " + str(flow.options_detail))

	# The entry cinematic carries its shot list.
	var door_cin: Resource = load("res://vcgs/generated/cinematics/door_in_the_dark.tres")
	if door_cin.shot_list.size() != 3 or door_cin.shot_list[1]["framing"] != "Close-up" or door_cin.seconds != 7.5:
		fail("Door in the dark should have 3 shots, 7.5s, got " + str(door_cin.shot_list.size()) + " / " + str(door_cin.seconds))
	if finished != ["cin_01_the_vault_opens"] and finished != ["the_vault_opens"]:
		fail("the scene should end into the cinematic, got " + str(finished))
	if game.has_item("vault_key") or int(game.arcs.get("mara", 0)) != 1:
		fail("turning the key should use it up and move Mara +1")
	if game.chosen.get("turn_the_key", "") != "Turn the key":
		fail("the pick should be remembered")
	# Solving the door completed the quest, once.
	if game.quest_state("open_the_vault") != "done" or quest_done != ["open_the_vault"]:
		fail("solving the door should complete Open the vault once, got " + game.quest_state("open_the_vault") + " " + str(quest_done))
	# Rules can ask about quests and lore.
	var asks := { "match": "all", "items": [{ "kind": "quest", "ref": "open_the_vault", "op": "done" }, { "kind": "lore", "ref": "the_drowned_order", "op": "known" }] }
	if not VCGSRuleEngine.check(asks, game) or VCGSRuleEngine.check({ "match": "all", "items": [{ "kind": "quest", "ref": "open_the_vault", "op": "notStarted" }] }, game):
		fail("a rule should see the quest done and the lore known")

	# Effects can start a quest and reveal lore.
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	game.quests.clear()
	VCGSRuleEngine.apply([{ "kind": "startQuest", "ref": "open_the_vault" }, { "kind": "revealLore", "ref": "the_drowned_order" }], game)
	if game.quest_state("open_the_vault") != "active" or not game.knows_lore("the_drowned_order"):
		fail("the effects should start the quest and reveal the lore")
	VCGSRuleEngine.apply([{ "kind": "completeQuest", "ref": "open_the_vault" }, { "kind": "enableMechanic", "ref": "lantern_oil" }], game)
	if game.quest_state("open_the_vault") != "done" or not game.has_mechanic("lantern_oil"):
		fail("the effects should complete the quest and make the mechanic available")

	# SC-02 opens on an encounter: lose it (try again), then win it, and the scene goes on.
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	var key_scene: Node = load("res://vcgs/generated/scenes/sc_02_the_key.gd").new()
	root.add_child(key_scene)
	var encounters: Array = []
	key_scene.encounter_requested.connect(func(k: String, can_win: bool) -> void: encounters.append([k, can_win]))
	var over: Array = []
	key_scene.game_over.connect(func(k: String) -> void: over.append(k))
	key_scene.start()
	key_scene.lose()
	# The eels can only be beaten once the lantern's oil is in play (a mechanic condition).
	if encounters != [["eel_swarm", false], ["eel_swarm", false]] or not over.is_empty():
		fail("losing the eels should play them again, not yet winnable, got " + str(encounters))
	if game.met_encounters() != ["eel_swarm"] or game.was_won("eel_swarm"):
		fail("the eels should be met once and not won, got " + str(game.met_encounters()))
	if key_scene.win():
		fail("a win should not count before the lantern's oil is in play")
	game.enable_mechanic("lantern_oil")
	if not key_scene.win():
		fail("with the lantern's oil, a win against the eels should count")
	if not game.was_won("eel_swarm") or not game.has_item("vault_key"):
		fail("winning should mark the eels won, and the scene go on to find the key")
	# Finding the key starts the quest and reveals the Order's story (effects).
	if game.quest_state("open_the_vault") != "active" or not game.knows_lore("the_drowned_order"):
		fail("finding the key should start the quest and reveal the lore")
	print("encounter: ", encounters, " won ", game.was_won("eel_swarm"), ", key ", game.has_item("vault_key"))
	key_scene.queue_free()

	# Without the key the choice is skipped.
	var rules: GDScript = load("res://vcgs/generated/logic/rules.gd")
	rules.reset(game)
	var turn: GDScript = load("res://vcgs/generated/choices/turn_the_key.gd")
	if turn.available(game):
		fail("Turn the key should not be available before the door is solved")
	game.set_flag("door_solved", "yes")
	game.give_item("vault_key")
	if not turn.available(game):
		fail("Turn the key should be available with the key and the door solved")

	var choice: GDScript = load("res://vcgs/generated/choices/take_the_lantern.gd")
	print("C1 options: ", choice.OPTIONS)
	if choice.choose(1, game) != "sc_04_the_squeeze":
		fail("Crawl through should lead to the squeeze")
	if not game.was_picked("take_the_lantern:crawl_through"):
		fail("the pick should be remembered by its option key")
	# SC-01 opens by lighting the lantern: its oil becomes a mechanic in play (an effect), with its tuning.
	rules.reset(game)
	var available: Array = []
	game.mechanic_available.connect(func(k: String) -> void: available.append(k))
	var cave: Node = load("res://vcgs/generated/scenes/sc_01_the_cave_mouth.gd").new()
	root.add_child(cave)
	cave.start()
	print("mechanics: ", available, " tuning: ", rules.mechanic_detail("lantern_oil", "tuning"))
	if available != ["lantern_oil"] or not game.has_mechanic("lantern_oil") or rules.mechanic_detail("lantern_oil", "tuning") != "About a minute of deep water on a full lantern":
		fail("lighting the lantern should make Lantern oil available, with its tuning")
	cave.queue_free()

	# The Vault Door's placeholder scene, played through its on-screen player.
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	game.give_item("vault_key")
	var vault: Node = load("res://vcgs/generated/scenes/sc_03_the_vault_door.tscn").instantiate()
	var player: Node = vault.get_node("DebugPlayer")
	player.autostart = false
	root.add_child(vault)
	if vault.get_node_or_null("Objects/RustedLever/Interactable") == null or vault.get_node_or_null("Characters/Mara") == null:
		fail("the scene should hold the lever (wired to its script) and Mara")
	player.start_now()
	if not player.text().begins_with("[Cinematic] Door in the dark · 7.5s") or player.labels() != ["Continue"]:
		fail("the scene should open on its cinematic, got " + player.text())
	player.press(0)
	# The player shows Mara and the Explorer together: one screen, one Continue.
	print("dual on screen: ", player.text().replace("\n", " | "))
	if not player.text().begins_with("MARA  (listening)") or not player.text().contains("at the same time") or not player.text().contains("THE EXPLORER  (wading forward)\nStand back."):
		fail("the player should show both voices at once, got " + player.text())
	for i in 2:
		player.press(0)
	var free_play: Array = player.labels()
	print("free play: ", free_play)
	if not free_play.has("Pull Rusted Lever"):
		fail("free play should offer to pull the lever, got " + str(free_play))
	player.press(free_play.find("Pull Rusted Lever"))
	print("choice: ", player.labels())
	if player.labels() != ["Turn the key", "Force it"]:
		fail("pulling the lever should end the free play into the choice, got " + str(player.labels()))
	player.press(0)
	print("after the scene: ", player.text().split("\n")[0], " ", player.labels())
	if not player.text().begins_with("[Cinematic] The Vault Opens"):
		fail("the scene should go on to the cinematic on the spine, got " + player.text())
	player.press(0)
	if player.labels() != ["Carry on", "Pocket it"]:
		fail("then the ring choice, got " + str(player.labels()))
	player.press(0)
	if player.mode != "end":
		fail("carrying on should reach the ending, got " + player.text())
	print("ending: ", player.text())
	# Turning the key completed the quest: the quest log says so.
	if not player.codex_text().contains("QUESTS · 0 under way, 1 done\n• Open the vault (done)"):
		fail("the quest log should show Open the vault done, got " + player.codex_text())

	# The whole story from its Beginning.
	var story: Node = load("res://vcgs/generated/play_story.tscn").instantiate()
	var story_player: Node = story.get_node("DebugPlayer")
	story_player.autostart = false
	root.add_child(story)
	story_player.start_now()
	if story_player.labels() != ["Play The Cave Mouth"]:
		fail("the story should start at SC-01, got " + str(story_player.labels()))

	# SC-02's placeholder scene stands in for the eels with Win and Lose.
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	game.enable_mechanic("lantern_oil")
	var silt: Node = load("res://vcgs/generated/scenes/sc_02_the_key.tscn").instantiate()
	var silt_player: Node = silt.get_node("DebugPlayer")
	silt_player.autostart = false
	root.add_child(silt)
	silt_player.start_now()
	print("encounter on screen: ", silt_player.text(), " ", silt_player.labels())
	if silt_player.text() != "[Encounter] Eel swarm" or silt_player.labels() != ["Win", "Lose"]:
		fail("SC-02 should open on the eels with Win and Lose, got " + silt_player.text() + " " + str(silt_player.labels()))
	# The codex, before anything is found but the eels, met and not yet beaten.
	if silt_player.codex_text() != "CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nITEMS · 0 of 1 found\nNone yet.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 0 won\n\nEEL SWARM\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 0 of 1 found\nNothing found yet." or silt_player.codex_button_text() != "Codex (C) · 1 new":
		fail("the codex should show only the eels, got " + silt_player.codex_text() + " / " + silt_player.codex_button_text())
	silt_player.press(0)
	if not game.was_won("eel_swarm") or silt_player.text() != "Find the key in the silt":
		fail("Win should beat the eels and go on, got " + silt_player.text())
	# Beating the eels, then finding the key (an item for the codex) starts the quest, and its seal reveals the Order's
	# story: the codex button counts them all, and the codex shows them.
	if silt_player.codex_button_text() != "Codex (C) · 5 new":
		fail("the codex button should mark the new entry, got " + silt_player.codex_button_text())
	silt_player.open_codex()
	print("codex: ", silt_player.codex_text().replace("\n", " | "))
	if not silt_player.codex_open() or not silt_player.codex_text().begins_with("CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nITEMS · 1 of 1 found\n\nVAULT KEY (carried)\nA heavy bronze key, green with age, stamped with the Order’s wave.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 1 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault") or silt_player.codex_button_text() != "Codex (C)":
		fail("the codex should show The Drowned Order, got " + silt_player.codex_text())
	silt_player.close_codex()
	if silt_player.codex_open():
		fail("the codex should close")
	silt.queue_free()

	check_level(game)

	print("OK" if failures == 0 else str(failures) + " FAILED")
	quit(0 if failures == 0 else 1)


# The level: its items as nodes with their GUIDs, and its rules running on GameState.
func check_level(game: Node) -> void:
	load("res://vcgs/generated/logic/rules.gd").reset(game)
	var packed: PackedScene = load("res://vcgs/generated/levels/sunken_vault.tscn")
	var level: Node = packed.instantiate()
	root.add_child(level)
	# In a game _ready does this with the GameState autoload; here the tree isn't running yet.
	level.setup(game)
	var items: Dictionary = level.level_data()
	print("level: ", level.name, " · ", level.nodes.size(), " of ", items.size(), " items as nodes")
	if level.name != "LVL_SunkenVault_01" or level.nodes.size() != items.size() or items.size() < 15:
		fail("every level item should be a node tagged with its GUID")
	var chamber: Node = level.get_node_or_null("RM_SunkenVault_VaultChamber_004")
	if chamber == null or chamber.get_node("Collision").get_child_count() < 4 or chamber.get_node("Proxy").get_child_count() < 5:
		fail("the vault chamber should have its floor and walls, as meshes and collision")
	# Its corners are cut: the floor is a CSG polygon laid flat, its top at the floor, inside the chamber's bounds.
	var slab: CSGPolygon3D = null
	for child in chamber.get_node("Proxy").get_children():
		if child is CSGPolygon3D and str(child.name).begins_with("floor"):
			slab = child
	if slab == null or slab.polygon.size() != 8:
		fail("the chamber's outlined floor should be a CSGPolygon3D with its 8 corners")
	else:
		var to_level: Transform3D = chamber.transform * chamber.get_node("Proxy").transform * slab.transform
		for p in slab.polygon:
			var top: Vector3 = to_level * Vector3(p.x, p.y, -slab.depth)
			if absf(top.y) > 0.001 or top.x < 4.79 or top.x > 15.21 or top.z < -20.21 or top.z > -11.79:
				fail("the chamber floor's corner " + str(p) + " should be at floor height inside the chamber, got " + str(top))
				break
	var shape: ConcavePolygonShape3D = null
	for child in chamber.get_node("Collision").get_children():
		if child is CollisionShape3D and child.shape is ConcavePolygonShape3D:
			shape = child.shape
	if shape == null or shape.get_faces().size() != ((8 - 2) * 2 + 8 * 2) * 3 or not shape.backface_collision:
		fail("the chamber's floor should collide by its outline")
	# The chamber's echo follows its cut corners: an Area3D of convex prisms, one per triangle.
	var echo: Node = level.get_node_or_null("AUD_VaultChamber_DrippingEcho_001")
	var prisms := 0
	if echo is Area3D:
		for child in echo.get_children():
			if child is CollisionShape3D and child.shape is ConvexPolygonShape3D and (child.shape as ConvexPolygonShape3D).points.size() == 6:
				prisms += 1
	if prisms != 6:
		fail("the outlined ambient zone should be an Area3D of 6 convex prisms, got " + str(prisms))
	var crane: Node3D = level.get_node_or_null("CAM_VaultChamber_ChamberCrane_001")
	if crane == null or not (crane is Camera3D) or absf(wrapf(crane.rotation.y, -PI, PI) - deg_to_rad(45.0)) > 0.01:
		fail("the camera marker should be a Camera3D turned to face north-west, got " + str(crane.rotation if crane else null))
	var camp: Node3D = level.get_node("RM_SunkenVault_SiltCamp_003")
	if camp.position.distance_to(Vector3(10, 0, -9)) > 0.001:
		fail("the silt camp should stand at (10, 0, -9), got " + str(camp.position))

	var door: String = level.guid_of("INT_VaultChamber_BronzeDoor_004")
	var key: String = level.guid_of("INV_SiltCamp_VaultKey_001")
	var lever: String = level.guid_of("INT_VaultChamber_RustedLever_005")
	var seam: String = level.guid_of("TRG_VaultChamber_FloodedSeam_001")
	var trigger: String = level.guid_of("TRG_VaultChamber_DoorInTheDarkTrigger_002")
	if level.offer(door).get("blocked", "") != "Locked. Needs Vault Key.":
		fail("the bronze door should be locked until the key is held, got " + str(level.offer(door)))
	level.interact(key)
	if not game.has_item("vault_key") or level.nodes[key].visible:
		fail("taking the key should give the story's key and take it out of the level")
	level.interact(door)
	if not level.is_open(door) or level.nodes[door].get_node("Proxy").visible:
		fail("with the key, the bronze door should open")
	var cinematics: Array = []
	level.cinematic_requested.connect(func(k: String) -> void: cinematics.append(k))
	level.enter(trigger)
	level.exit(trigger)
	level.enter(trigger)
	if cinematics != ["door_in_the_dark"]:
		fail("entering the chamber should play Door in the dark once, got " + str(cinematics))
	if not level.is_present(seam):
		fail("the seam should be flooded before the lever")
	level.interact(lever)
	print("after the lever: lever ", game.object_states.get("rusted_lever"), ", puzzle solved ", game.is_solved("the_vault_door"))
	if game.object_states.get("rusted_lever") != "up" or not game.is_solved("the_vault_door"):
		fail("pulling the lever should set it up and, through the story's trigger, solve the door")
	if level.is_present(seam) or level.nodes[seam].visible or level.nodes[door].visible:
		fail("once solved, the seam drains and the bronze door gives way")
	level.queue_free()

	var play: Node = load("res://vcgs/generated/levels/play_sunken_vault.tscn").instantiate()
	root.add_child(play)
	var player: Node = play.get_node("Player")
	if not (player.get_node(player.level_path) is VCGSLevel):
		fail("play_sunken_vault.tscn should have a player wired to the level")
	play.queue_free()
