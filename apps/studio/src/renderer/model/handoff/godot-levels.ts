import type { GeneratedFile } from './engines';
import { slabFaces, type IrLevel, type IrLevelItem, type IrPiece } from './levels';

/**
 * Levels for Godot 4 (spec §11.2): a scene per level whose nodes are the
 * items, named by their export names and tagged with their GUIDs, holding
 * graybox meshes and collision; a generated script with the items' data;
 * and the VCGSLevel runtime that runs doors, pickups, volumes and rules on
 * GameState. play_<level>.tscn drops a first-person player in to walk it.
 */

export const RUNTIME = 'addons/vcgs_runtime';

const f = (n: number) => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

type M3 = [number, number, number, number, number, number, number, number, number];
const rotY = (deg: number): M3 => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const rotX = (deg: number): M3 => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const mul = (a: M3, b: M3): M3 => {
  const out = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] = out[i * 3 + j]! + a[i * 3 + k]! * b[k * 3 + j]!;
  return out;
};
/** Godot writes a Transform3D as its basis, row by row, then the origin. */
const transform = (m: M3, at: [number, number, number]) => `Transform3D(${[...m, ...at].map(f).join(', ')})`;
const color = (hex: string, alpha = 1): string => {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16);
  return `Color(${f(((n >> 16) & 255) / 255)}, ${f(((n >> 8) & 255) / 255)}, ${f((n & 255) / 255)}, ${f(alpha)})`;
};
const str = (v: string) => JSON.stringify(v);

/** Node names: letters, digits and underscores (Godot refuses . : @ / " %). */
const nodeName = (name: string) => name.replace(/[.:@/"%]/g, '_') || 'Item';

// ---------------------------------------------------------------- the runtime

export const levelRuntime = (): GeneratedFile[] => [
  {
    path: `${RUNTIME}/level.gd`,
    kind: 'runtime',
    content: `${[
      '# VCGS Runtime for Godot 4.',
      'class_name VCGSLevel',
      'extends Node3D',
      '## A level from VC Game Studio. Its items are the nodes under it that carry',
      '## the metadata vcgs_guid; the generated script for the level holds their',
      '## data. Doors, pickups, volumes and rules run on GameState, the story\'s own',
      '## state, so the level and the story always agree. Your game answers the',
      '## signals (plays the cinematic, starts the scene, loads the next level).',
      '',
      'signal cinematic_requested(cinematic_key: String)',
      'signal scene_requested(scene_key: String)',
      'signal level_requested(level_key: String)',
      'signal spawn_requested(spawner: Node3D, actor_key: String, count: int)',
      'signal objective_changed(text: String)',
      'signal audio_requested(emitter: Node3D, sound: String)',
      'signal message_shown(text: String)',
      'signal checkpoint_reached(where: Vector3)',
      'signal story_object_used(object_key: String)',
      'signal player_died',
      '',
      'const INTERACTIVE := ["door", "pickup", "inventory", "weapon", "ammo", "health", "npc", "companion", "neutral", "dialogue", "interaction", "puzzle", "elevator", "ladder"]',
      'const PICKUPS := ["pickup", "inventory", "weapon", "ammo", "health"]',
      '',
      'var game: VCGSGameState',
      '## Item GUID → its node.',
      'var nodes: Dictionary = {}',
      'var open: Dictionary = {}',
      'var unlocked: Dictionary = {}',
      'var gone: Dictionary = {}',
      'var enabled: Dictionary = {}',
      'var done: Dictionary = {}',
      'var inside: Dictionary = {}',
      'var timers: Dictionary = {}',
      'var objective := ""',
      'var health := 100.0',
      'var checkpoint := Vector3.ZERO',
      'var time := 0.0',
      'var _data: Dictionary = {}',
      'var _depth := 0',
      '',
      '## Every item\'s data by GUID. The generated level script returns it.',
      'func level_data() -> Dictionary:',
      '\treturn {}',
      '',
      '## Story keys → names, for messages.',
      'func story_names() -> Dictionary:',
      '\treturn {}',
      '',
      'func _ready() -> void:',
      '\tif game == null:',
      '\t\tvar autoload := get_node_or_null("/root/GameState")',
      '\t\tif autoload is VCGSGameState:',
      '\t\t\tsetup(autoload)',
      '',
      '## Wire the level to the story\'s state (the GameState autoload unless given another).',
      'func setup(state: VCGSGameState) -> void:',
      '\tgame = state',
      '\t_data = level_data()',
      '\tnodes.clear()',
      '\t_index(self)',
      '\tfor guid in nodes:',
      '\t\tvar node: Node = nodes[guid]',
      '\t\tif node is Area3D:',
      '\t\t\tvar area := node as Area3D',
      '\t\t\tif not area.body_entered.is_connected(_on_body_entered):',
      '\t\t\t\tarea.body_entered.connect(_on_body_entered.bind(guid))',
      '\t\t\t\tarea.body_exited.connect(_on_body_exited.bind(guid))',
      '\tif not game.changed.is_connected(_on_changed):',
      '\t\tgame.changed.connect(_on_changed)',
      '\tfor guid in _data:',
      '\t\tif role(guid) == "spawn" and str(item(guid).get("kind", "")) == "marker" and float(param(guid, "delay", 0.0)) <= 0.0 and is_present(guid):',
      '\t\t\t_spawn(guid)',
      '\trefresh()',
      '',
      'func _index(node: Node) -> void:',
      '\tfor child in node.get_children():',
      '\t\tif child.has_meta("vcgs_guid"):',
      '\t\t\tnodes[str(child.get_meta("vcgs_guid"))] = child',
      '\t\t_index(child)',
      '',
      'func item(guid: String) -> Dictionary:',
      '\treturn _data.get(guid, {})',
      '',
      'func role(guid: String) -> String:',
      '\treturn str(item(guid).get("role", ""))',
      '',
      'func param(guid: String, key: String, fallback: Variant = null) -> Variant:',
      '\treturn item(guid).get("params", {}).get(key, fallback)',
      '',
      'func story_name(key: String) -> String:',
      '\treturn str(story_names().get(key, key))',
      '',
      '## The GUID of the item with this export name (the node\'s name), or "".',
      'func guid_of(export_name: String) -> String:',
      '\tfor guid in _data:',
      '\t\tif str(_data[guid].get("export_name", "")) == export_name:',
      '\t\t\treturn guid',
      '\treturn ""',
      '',
      '## Not taken, not switched off, and its "present only when" holds.',
      'func is_present(guid: String) -> bool:',
      '\tif gone.has(guid) or enabled.get(guid, true) == false:',
      '\t\treturn false',
      '\treturn VCGSRuleEngine.check(item(guid).get("active_when", {}), game)',
      '',
      'func is_open(guid: String) -> bool:',
      '\tif open.has(guid):',
      '\t\treturn bool(open[guid])',
      '\treturn bool(param(guid, "startsOpen", false)) or str(param(guid, "swing", "")) == "open archway"',
      '',
      '## Show what is there, hide what is not, open and shut doors. Runs after every change.',
      'func refresh() -> void:',
      '\tfor guid in nodes:',
      '\t\tvar node := nodes[guid] as Node3D',
      '\t\tif node == null:',
      '\t\t\tcontinue',
      '\t\tvar here := is_present(guid)',
      '\t\tnode.visible = here',
      '\t\t_switch(node, here)',
      '\t\tif role(guid) == "door":',
      '\t\t\tvar shut := here and not is_open(guid)',
      '\t\t\tfor part in ["Proxy", "Art", "Collision"]:',
      '\t\t\t\tvar child := node.get_node_or_null(part)',
      '\t\t\t\tif child is Node3D:',
      '\t\t\t\t\t(child as Node3D).visible = shut',
      '\t\t\t\t\t_switch(child, shut)',
      '',
      'func _switch(node: Node, on: bool) -> void:',
      '\tif node is CollisionShape3D:',
      '\t\t(node as CollisionShape3D).set_deferred("disabled", not on)',
      '\tif node is Area3D:',
      '\t\t(node as Area3D).set_deferred("monitoring", on)',
      '\tfor child in node.get_children():',
      '\t\tif not child.has_meta("vcgs_guid"):',
      '\t\t\t_switch(child, on)',
      '',
      '## What Interact would do to an item now: { verb, label } and "blocked" when it can\'t; {} for nothing.',
      'func offer(guid: String) -> Dictionary:',
      '\tif not is_present(guid):',
      '\t\treturn {}',
      '\tvar it := item(guid)',
      '\tvar has_rules := false',
      '\tfor rule in it.get("rules", []):',
      '\t\tif str(rule.get("on", "")) in ["interact", "use", "pickup"]:',
      '\t\t\thas_rules = true',
      '\tvar interactive: Variant = param(guid, "interactive", null)',
      '\tif interactive == false and not has_rules:',
      '\t\treturn {}',
      '\tif not (interactive == true or has_rules or role(guid) in INTERACTIVE):',
      '\t\treturn {}',
      '\tvar prompt := str(param(guid, "prompt", ""))',
      '\tif prompt == "":',
      '\t\tprompt = "Use"',
      '\tvar label := str(it.get("name", ""))',
      '\tif role(guid) == "door":',
      '\t\tif str(param(guid, "swing", "")) == "open archway":',
      '\t\t\treturn {}',
      '\t\tvar key := str(param(guid, "keyItem", ""))',
      '\t\tvar locked := bool(param(guid, "locked", false)) and not unlocked.has(guid)',
      '\t\tvar is_now_open := is_open(guid)',
      '\t\tif not is_now_open and locked and key != "" and not game.has_item(key):',
      '\t\t\treturn { "verb": prompt, "label": label, "blocked": "Locked. Needs " + story_name(key) + "." }',
      '\t\tif not is_now_open and locked and key == "":',
      '\t\t\treturn { "verb": prompt, "label": label, "blocked": "Locked." }',
      '\t\treturn { "verb": "Close" if is_now_open else (prompt if locked else "Open"), "label": label }',
      '\treturn { "verb": prompt, "label": label }',
      '',
      '## The player uses an item. Returns what to tell them ("" for nothing to say).',
      'func interact(guid: String) -> String:',
      '\tvar o := offer(guid)',
      '\tif o.is_empty():',
      '\t\treturn ""',
      '\tif o.has("blocked"):',
      '\t\tmessage_shown.emit(o["blocked"])',
      '\t\treturn str(o["blocked"])',
      '\tvar said := ""',
      '\tvar it := item(guid)',
      '\tif role(guid) == "door":',
      '\t\tvar was_open := is_open(guid)',
      '\t\tif not was_open and bool(param(guid, "locked", false)):',
      '\t\t\tunlocked[guid] = true',
      '\t\topen[guid] = not was_open',
      '\t\trefresh()',
      '\telif role(guid) in PICKUPS and param(guid, "collectible", true) != false:',
      '\t\tgone[guid] = true',
      '\t\tvar gives := str(param(guid, "item", ""))',
      '\t\tif role(guid) == "health":',
      '\t\t\thealth = min(100.0, health + float(param(guid, "value", 25)))',
      '\t\tvar rules_give := false',
      '\t\tfor rule in it.get("rules", []):',
      '\t\t\tif str(rule.get("on", "")) == "pickup":',
      '\t\t\t\tfor e in rule.get("effects", []):',
      '\t\t\t\t\tif str(e.get("kind", "")) == "give" and str(e.get("ref", "")) == gives:',
      '\t\t\t\t\t\trules_give = true',
      '\t\tif gives != "" and not rules_give:',
      '\t\t\tgame.give_item(gives, int(param(guid, "quantity", 1)))',
      '\t\tsaid = "Took " + (story_name(gives) if gives != "" else str(it.get("name", "")))',
      '\t\trun_rules(guid, "pickup")',
      '\t\trefresh()',
      '\telif role(guid) in ["npc", "companion", "neutral", "dialogue"]:',
      '\t\tvar scenes: Array = it.get("scenes", [])',
      '\t\tvar scene := str(scenes[0]) if not scenes.is_empty() else ""',
      '\t\tif scene != "":',
      '\t\t\tgame.visit(scene)',
      '\t\t\tscene_requested.emit(scene)',
      '\telse:',
      '\t\tvar own := false',
      '\t\tfor rule in it.get("rules", []):',
      '\t\t\tif str(rule.get("on", "")) == "interact":',
      '\t\t\t\town = true',
      '\t\tif not own:',
      '\t\t\tfor link in it.get("links", []):',
      '\t\t\t\tstory_object_used.emit(str(link))',
      '\trun_rules(guid, "interact")',
      '\trun_rules(guid, "use")',
      '\tif said != "":',
      '\t\tmessage_shown.emit(said)',
      '\treturn said',
      '',
      '## The player comes into a volume.',
      'func enter(guid: String) -> void:',
      '\tif inside.has(guid) or not is_present(guid):',
      '\t\treturn',
      '\tinside[guid] = true',
      '\tvar once := bool(param(guid, "once", false))',
      '\tif once and done.has(guid):',
      '\t\treturn',
      '\tif once:',
      '\t\tdone[guid] = true',
      '\tvar plays := false',
      '\tfor rule in item(guid).get("rules", []):',
      '\t\tfor a in rule.get("actions", []):',
      '\t\t\tif str(a.get("kind", "")) == "playCinematic":',
      '\t\t\t\tplays = true',
      '\tvar cinematic := str(param(guid, "cinematic", ""))',
      '\tif role(guid) == "cinematic" and cinematic != "" and not plays:',
      '\t\tcinematic_requested.emit(cinematic)',
      '\tif role(guid) == "checkpoint":',
      '\t\tcheckpoint = (nodes[guid] as Node3D).global_position',
      '\t\tcheckpoint_reached.emit(checkpoint)',
      '\tif role(guid) == "portal" and str(param(guid, "to", "")) != "":',
      '\t\tlevel_requested.emit(str(param(guid, "to", "")))',
      '\tif role(guid) == "spawn" and not done.has(guid):',
      '\t\t_spawn(guid)',
      '\trun_rules(guid, "enter")',
      '',
      'func exit(guid: String) -> void:',
      '\tif not inside.has(guid):',
      '\t\treturn',
      '\tinside.erase(guid)',
      '\trun_rules(guid, "exit")',
      '',
      'func _process(delta: float) -> void:',
      '\tif game == null:',
      '\t\treturn',
      '\ttime += delta',
      '\tfor guid in inside:',
      '\t\tif role(guid) in ["hazard", "damage"] and is_present(guid):',
      '\t\t\tif bool(param(guid, "kills", false)):',
      '\t\t\t\thealth = 0.0',
      '\t\t\telse:',
      '\t\t\t\thealth -= float(param(guid, "damage", 0)) * delta',
      '\tif health <= 0.0 and time > 0.0:',
      '\t\thealth = 100.0',
      '\t\tplayer_died.emit()',
      '\tfor guid in _data:',
      '\t\tif not is_present(guid):',
      '\t\t\tcontinue',
      '\t\tif role(guid) == "spawn" and str(item(guid).get("kind", "")) == "marker" and not done.has(guid) and float(param(guid, "delay", 0.0)) <= time:',
      '\t\t\t_spawn(guid)',
      '\t\tvar n := 0',
      '\t\tfor rule in item(guid).get("rules", []):',
      '\t\t\tn += 1',
      '\t\t\tif str(rule.get("on", "")) != "timer":',
      '\t\t\t\tcontinue',
      '\t\t\tvar id: String = str(guid) + ":" + str(n)',
      '\t\t\tvar every: float = max(0.5, float(str(rule.get("detail", "5"))))',
      '\t\t\tif time - float(timers.get(id, 0.0)) >= every:',
      '\t\t\t\ttimers[id] = time',
      '\t\t\t\t_run(guid, rule)',
      '',
      '## Run an item\'s rules for an event: each checks its conditions, then changes the story and the level.',
      'func run_rules(guid: String, on: String, detail: String = "") -> void:',
      '\tfor rule in item(guid).get("rules", []):',
      '\t\tif str(rule.get("on", "")) != on:',
      '\t\t\tcontinue',
      '\t\tif on == "custom" and detail != "" and str(rule.get("detail", "")) != detail:',
      '\t\t\tcontinue',
      '\t\t_run(guid, rule)',
      '',
      'func _run(guid: String, rule: Dictionary) -> void:',
      '\tif not VCGSRuleEngine.check(rule.get("when", {}), game):',
      '\t\treturn',
      '\tVCGSRuleEngine.apply(rule.get("effects", []), game)',
      '\tfor action in rule.get("actions", []):',
      '\t\t_act(action, guid)',
      '\trefresh()',
      '',
      'func _act(action: Dictionary, from: String) -> void:',
      '\tvar target := str(action.get("target", ""))',
      '\tmatch str(action.get("kind", "")):',
      '\t\t"open":',
      '\t\t\topen[target] = true',
      '\t\t"close":',
      '\t\t\topen[target] = false',
      '\t\t"enable":',
      '\t\t\tenabled[target] = true',
      '\t\t"disable":',
      '\t\t\tenabled[target] = false',
      '\t\t"spawn":',
      '\t\t\t_spawn(target)',
      '\t\t"despawn":',
      '\t\t\tgone[target] = true',
      '\t\t"startScene":',
      '\t\t\tgame.visit(target)',
      '\t\t\tscene_requested.emit(target)',
      '\t\t"playCinematic":',
      '\t\t\tcinematic_requested.emit(target)',
      '\t\t"playAudio":',
      '\t\t\taudio_requested.emit(nodes.get(target) as Node3D, str(param(target, "sound", "")))',
      '\t\t"objective":',
      '\t\t\tvar text := str(param(target, "objective", ""))',
      '\t\t\tobjective = text if text != "" else str(item(target).get("name", ""))',
      '\t\t\tobjective_changed.emit(objective)',
      '\t\t"goToLevel":',
      '\t\t\tlevel_requested.emit(target)',
      '',
      'func _spawn(guid: String) -> void:',
      '\tdone[guid] = true',
      '\tspawn_requested.emit(nodes.get(guid) as Node3D, str(param(guid, "actor", "")), int(param(guid, "count", 1)))',
      '',
      'func _on_body_entered(body: Node3D, guid: String) -> void:',
      '\tif body.is_in_group("player"):',
      '\t\tenter(guid)',
      '',
      'func _on_body_exited(body: Node3D, guid: String) -> void:',
      '\tif body.is_in_group("player"):',
      '\t\texit(guid)',
      '',
      'func _on_changed() -> void:',
      '\tif _depth > 3:',
      '\t\treturn',
      '\t_depth += 1',
      '\tfor guid in _data:',
      '\t\tif is_present(guid):',
      '\t\t\trun_rules(guid, "stateChange")',
      '\trefresh()',
      '\t_depth -= 1',
      '',
      '## The nearest item the player can use from where they stand, or "".',
      'func nearest_offer(from: Vector3, facing: Vector3 = Vector3.ZERO) -> String:',
      '\tvar best := ""',
      '\tvar best_d := INF',
      '\tfor guid in nodes:',
      '\t\tif offer(guid).is_empty():',
      '\t\t\tcontinue',
      '\t\tvar node := nodes[guid] as Node3D',
      '\t\tvar size: Array = item(guid).get("size", [1, 1, 1])',
      '\t\tvar to := node.global_position - from',
      '\t\tto.y = 0.0',
      '\t\tvar reach: float = float(param(guid, "range", 1.5)) + max(float(size[0]), float(size[2])) / 2.0 + 0.3',
      '\t\tvar d := to.length()',
      '\t\tif d > reach or d >= best_d:',
      '\t\t\tcontinue',
      '\t\tif facing != Vector3.ZERO and d > 0.6 and to.normalized().dot(facing.normalized()) < 0.3:',
      '\t\t\tcontinue',
      '\t\tbest = guid',
      '\t\tbest_d = d',
      '\treturn best',
    ].join('\n')}\n`,
  },
  {
    path: `${RUNTIME}/level_player.gd`,
    kind: 'runtime',
    content: `${[
      '# VCGS Runtime for Godot 4.',
      'class_name VCGSLevelPlayer',
      'extends CharacterBody3D',
      '## A plain first-person player to walk a generated level straight away:',
      '## WASD or the arrows to move, the mouse to look (click to capture it,',
      '## Esc to let go), Space to jump, Shift to run, E to use what is in reach.',
      '## Replace it with your own player; the level only needs the "player" group.',
      '',
      '@export var level_path: NodePath',
      '@export var speed := 3.6',
      '@export var run_speed := 6.4',
      '@export var jump_speed := 5.2',
      '@export var look_speed := 0.0025',
      '',
      'var level: VCGSLevel',
      'var camera: Camera3D',
      'var prompt: Label',
      'var said: Label',
      'var _said_until := 0.0',
      'var _clock := 0.0',
      'var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)',
      '',
      'func _ready() -> void:',
      '\tadd_to_group("player")',
      '\tif get_node_or_null("Shape") == null:',
      '\t\tvar shape := CollisionShape3D.new()',
      '\t\tshape.name = "Shape"',
      '\t\tvar capsule := CapsuleShape3D.new()',
      '\t\tcapsule.radius = 0.32',
      '\t\tcapsule.height = 1.75',
      '\t\tshape.shape = capsule',
      '\t\tshape.position.y = 0.875',
      '\t\tadd_child(shape)',
      '\tcamera = Camera3D.new()',
      '\tcamera.position.y = 1.62',
      '\tadd_child(camera)',
      '\tvar hud := CanvasLayer.new()',
      '\tadd_child(hud)',
      '\tprompt = Label.new()',
      '\tprompt.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)',
      '\tprompt.position = Vector2(-160, -80)',
      '\thud.add_child(prompt)',
      '\tsaid = Label.new()',
      '\tsaid.position = Vector2(24, 24)',
      '\thud.add_child(said)',
      '\tlevel = get_node_or_null(level_path) as VCGSLevel',
      '\tif level != null:',
      '\t\tlevel.message_shown.connect(_say)',
      '\t\tlevel.cinematic_requested.connect(func(key: String) -> void: _say("[Cinematic] " + level.story_name(key)))',
      '\t\tlevel.scene_requested.connect(func(key: String) -> void: _say("[Scene] " + level.story_name(key)))',
      '\t\tlevel.objective_changed.connect(func(text: String) -> void: _say("Objective: " + text))',
      '',
      'func _say(text: String) -> void:',
      '\tsaid.text = text',
      '\t_said_until = _clock + 3.0',
      '',
      'func _unhandled_input(event: InputEvent) -> void:',
      '\tif event is InputEventMouseButton and event.pressed:',
      '\t\tInput.mouse_mode = Input.MOUSE_MODE_CAPTURED',
      '\telif event is InputEventKey and event.pressed and (event as InputEventKey).physical_keycode == KEY_ESCAPE:',
      '\t\tInput.mouse_mode = Input.MOUSE_MODE_VISIBLE',
      '\telif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:',
      '\t\tvar motion := event as InputEventMouseMotion',
      '\t\trotate_y(-motion.relative.x * look_speed)',
      '\t\tcamera.rotation.x = clamp(camera.rotation.x - motion.relative.y * look_speed, -1.45, 1.45)',
      '\telif event is InputEventKey and event.pressed and not event.echo and (event as InputEventKey).physical_keycode in [KEY_E, KEY_F] and level != null:',
      '\t\tvar target := level.nearest_offer(global_position, -global_transform.basis.z)',
      '\t\tif target != "":',
      '\t\t\tlevel.interact(target)',
      '',
      'func _physics_process(delta: float) -> void:',
      '\t_clock += delta',
      '\tif _clock > _said_until:',
      '\t\tsaid.text = ""',
      '\tvar input := Vector2(',
      '\t\tfloat(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)),',
      '\t\tfloat(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) - float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)))',
      '\tvar direction := (transform.basis * Vector3(input.x, 0, input.y)).normalized()',
      '\tvar pace := run_speed if Input.is_physical_key_pressed(KEY_SHIFT) else speed',
      '\tvelocity.x = direction.x * pace',
      '\tvelocity.z = direction.z * pace',
      '\tif is_on_floor():',
      '\t\tif Input.is_physical_key_pressed(KEY_SPACE):',
      '\t\t\tvelocity.y = jump_speed',
      '\telse:',
      '\t\tvelocity.y -= _gravity * delta',
      '\tmove_and_slide()',
      '\tif level != null:',
      '\t\tvar target := level.nearest_offer(global_position, -global_transform.basis.z)',
      '\t\tvar o := level.offer(target) if target != "" else {}',
      '\t\tprompt.text = "" if o.is_empty() else ("[E] " + str(o.get("blocked", str(o["verb"]) + " · " + str(o["label"]))))',
    ].join('\n')}\n`,
  },
];

// ---------------------------------------------------------------- scenes

class Tscn {
  private subs: string[] = [];
  private exts: string[] = [];
  private nodes: string[] = [];
  private cache = new Map<string, string>();
  private n = 0;

  ext(type: string, path: string): string {
    const k = `ext:${path}`;
    if (!this.cache.has(k)) {
      const id = `${this.exts.length + 1}_${type.toLowerCase()}`;
      this.exts.push(`[ext_resource type="${type}" path="${path}" id="${id}"]`);
      this.cache.set(k, id);
    }
    return `ExtResource("${this.cache.get(k)}")`;
  }

  sub(type: string, props: Record<string, string>): string {
    const body = Object.entries(props).map(([k, v]) => `${k} = ${v}`).join('\n');
    const k = `${type}:${body}`;
    if (!this.cache.has(k)) {
      const id = `${type}_${++this.n}`;
      this.subs.push(`[sub_resource type="${type}" id="${id}"]\n${body}`);
      this.cache.set(k, id);
    }
    return `SubResource("${this.cache.get(k)}")`;
  }

  node(name: string, type: string | null, parent: string | null, props: Record<string, string> = {}, extra = '') {
    const head = [`name=${str(name)}`, ...(type ? [`type="${type}"`] : []), ...(parent !== null ? [`parent=${str(parent)}`] : []), ...(extra ? [extra] : [])].join(' ');
    this.nodes.push([`[node ${head}]`, ...Object.entries(props).map(([k, v]) => `${k} = ${v}`)].join('\n'));
  }

  toString(): string {
    return [`[gd_scene load_steps=${this.exts.length + this.subs.length + 1} format=3]`, ...this.exts, ...this.subs, ...this.nodes].join('\n\n') + '\n';
  }
}

const slabMaterial = (t: Tscn, p: IrPiece): string => t.sub('StandardMaterial3D', { albedo_color: color(p.color, p.opacity), ...(p.opacity < 1 ? { transparency: '1' } : {}) });

/** A piece's mesh (sized, not scaled) and its turn about the item's up axis. */
const pieceMesh = (t: Tscn, p: IrPiece): { mesh: string; basis: M3 } => {
  const [sx, sy, sz] = p.size;
  const material = t.sub('StandardMaterial3D', {
    albedo_color: color(p.light ? p.light.color : p.color, p.opacity),
    ...(p.opacity < 1 ? { transparency: '1' } : {}),
    ...(p.light ? { emission_enabled: 'true', emission: color(p.light.color) } : {}),
  });
  const turn = rotY(p.turn);
  switch (p.shape) {
    case 'cylinder':
      return { mesh: t.sub('CylinderMesh', { top_radius: f(sx / 2), bottom_radius: f(sx / 2), height: f(sy), material }), basis: turn };
    case 'sphere':
      return { mesh: t.sub('SphereMesh', { radius: f(sx / 2), height: f(sy), material }), basis: turn };
    case 'cone':
      // Tip toward north (−z): a cylinder with no top, laid along z.
      return { mesh: t.sub('CylinderMesh', { top_radius: '0.0', bottom_radius: f(sx / 2), height: f(sz), material }), basis: mul(turn, rotX(-90)) };
    case 'wedge':
      // A right-angled prism, high side to the north: its triangle turned into the y–z plane.
      return { mesh: t.sub('PrismMesh', { left_to_right: '1.0', size: `Vector3(${f(sz)}, ${f(sy)}, ${f(sx)})`, material }), basis: mul(turn, rotY(90)) };
    default:
      return { mesh: t.sub('BoxMesh', { size: `Vector3(${f(sx)}, ${f(Math.max(0.01, sy))}, ${f(sz)})`, material }), basis: turn };
  }
};

const NODE_TYPE = (item: IrLevelItem): string => {
  if (item.kind === 'volume') return 'Area3D';
  if (item.kind === 'marker') return item.role === 'camera' ? 'Camera3D' : 'Marker3D';
  return 'Node3D';
};

export const levelTscn = (level: IrLevel, root: string): string => {
  const t = new Tscn();
  const script = t.ext('Script', `res://${root}/levels/${level.key}.gd`);
  t.node(nodeName(level.export_name), 'Node3D', null, { script, 'metadata/vcgs_guid_level': str(level.guid), 'metadata/vcgs_revision': str(level.revision) });
  const names = new Set<string>();
  for (const item of level.items) {
    let name = nodeName(item.export_name);
    for (let n = 2; names.has(name); n++) name = `${nodeName(item.export_name)}_${n}`;
    names.add(name);
    const type = NODE_TYPE(item);
    const groups = [item.role === 'playerStart' ? 'vcgs_player_start' : '', 'vcgs_item'].filter(Boolean);
    t.node(
      name,
      type,
      '.',
      {
        transform: transform(rotY(item.turn), item.position),
        ...(item.role === 'camera' ? { fov: f(Number(item.params.fov ?? 60)) } : {}),
        'metadata/vcgs_guid': str(item.guid),
        'metadata/vcgs_role': str(item.role),
        'metadata/vcgs_asset': str(item.asset),
        'metadata/vcgs_revision': str(item.revision),
        ...(item.links.length ? { 'metadata/vcgs_links': `PackedStringArray(${item.links.map(str).join(', ')})` } : {}),
        ...(item.replacement_locked ? { 'metadata/vcgs_replacement_locked': 'true' } : {}),
      },
      `groups=[${groups.map(str).join(', ')}]`,
    );
    const at = name;
    // What it looks like: the final art when there is some, else the graybox proxy (none when the art is locked).
    const visuals = item.pieces.filter((p) => p.part !== 'volume');
    if (item.final_asset) {
      t.node('Art', null, at, {}, `instance=${t.ext('PackedScene', item.final_asset.startsWith('res://') ? item.final_asset : `res://${item.final_asset}`)}`);
    } else if (!item.replacement_locked && visuals.length && item.kind !== 'volume') {
      t.node('Proxy', 'Node3D', at);
      visuals.forEach((p, n) => {
        if (p.shape === 'slab' && p.outline) {
          // A freeform floor or ceiling: its outline (drawn in x–y) turned flat and raised by its thickness from its underside.
          t.node(`${p.part}_${n}`, 'CSGPolygon3D', `${at}/Proxy`, {
            transform: transform(mul(rotY(p.turn), rotX(90)), [p.at[0], p.at[1] - p.size[1] / 2, p.at[2]]),
            polygon: `PackedVector2Array(${p.outline.flat().map(f).join(', ')})`,
            depth: f(p.size[1]),
            material: slabMaterial(t, p),
          });
          return;
        }
        const { mesh, basis } = pieceMesh(t, p);
        t.node(`${p.part}_${n}`, 'MeshInstance3D', `${at}/Proxy`, { transform: transform(basis, p.at), mesh });
      });
    }
    // What is in the way.
    const solid = item.pieces.filter((p) => p.collide && p.part !== 'volume');
    if (solid.length) {
      t.node('Collision', 'StaticBody3D', at);
      solid.forEach((p, n) => {
        const size = p.size;
        t.node(`${p.part}_${n}`, 'CollisionShape3D', `${at}/Collision`, {
          transform: transform(rotY(p.turn), p.at),
          // A slab collides by its own faces (both sides, so nothing falls through from below).
          shape:
            p.shape === 'slab' && p.outline
              ? t.sub('ConcavePolygonShape3D', { data: `PackedVector3Array(${slabFaces(p).flat(2).map(f).join(', ')})`, backface_collision: 'true' })
              : t.sub('BoxShape3D', { size: `Vector3(${f(size[0])}, ${f(Math.max(0.01, size[1]))}, ${f(size[2])})` }),
        });
      });
    }
    // A volume notices the player in its box.
    if (item.kind === 'volume') {
      const [w, h, d] = item.size;
      const blocks = item.pieces.some((p) => p.part === 'volume' && p.collide);
      t.node('Shape', 'CollisionShape3D', at, { transform: transform(rotY(0), [0, h / 2, 0]), shape: t.sub('BoxShape3D', { size: `Vector3(${f(w)}, ${f(h)}, ${f(d)})` }) });
      if (blocks) {
        t.node('Collision', 'StaticBody3D', at);
        t.node('Shape', 'CollisionShape3D', `${at}/Collision`, { transform: transform(rotY(0), [0, h / 2, 0]), shape: t.sub('BoxShape3D', { size: `Vector3(${f(w)}, ${f(h)}, ${f(d)})` }) });
      }
    }
    // Lights.
    for (const p of item.pieces) {
      if (!p.light) continue;
      const common = { light_color: color(p.light.color), light_energy: f(p.light.intensity), shadow_enabled: String(item.params.shadows !== false) };
      if (p.light.kind === 'spot') {
        t.node('Light', 'SpotLight3D', at, { transform: transform(rotY(0), p.at), ...common, spot_range: f(p.light.range), spot_angle: f((p.light.angle ?? 40) / 2) });
      } else {
        t.node('Light', 'OmniLight3D', at, { transform: transform(rotY(0), p.at), ...common, omni_range: f(p.light.range * (p.light.kind === 'area' ? 1.5 : 1)) });
      }
    }
  }
  return t.toString();
};

/** The level's data, for VCGSLevel. */
export const levelScript = (level: IrLevel, names: Record<string, string>, gd: (v: unknown) => string, header: string): string =>
  [
    header,
    `class_name Level${level.key.split('_').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : '')).join('')}`,
    'extends VCGSLevel',
    `## ${level.name} · ${level.export_name} · ${level.items.length} items`,
    '',
    `const KEY := ${gd(level.key)}`,
    `const GUID := ${gd(level.guid)}`,
    `const FLOORS := ${gd(level.floors)}`,
    '',
    '## Every item by GUID: what it is, its settings, its story links, when it is there and its rules.',
    `const ITEMS := ${gd(
      Object.fromEntries(
        level.items.map((i) => [
          i.guid,
          {
            export_name: i.export_name,
            name: i.name,
            role: i.role,
            kind: i.kind,
            size: i.size,
            params: Object.fromEntries(Object.entries(i.params).filter(([k]) => !['material', 'finalAsset', 'template', 'export', 'replacementLocked', 'visible'].includes(k))),
            links: i.links,
            ...(i.scenes.length ? { scenes: i.scenes } : {}),
            ...(i.active_when ? { active_when: i.active_when } : {}),
            ...(i.rules.length ? { rules: i.rules } : {}),
          },
        ]),
      ),
    )}`,
    '',
    `const NAMES := ${gd(names)}`,
    '',
    'func level_data() -> Dictionary:',
    '\treturn ITEMS',
    '',
    'func story_names() -> Dictionary:',
    '\treturn NAMES',
  ].join('\n');

/** A scene to walk the level at once: the level, a first-person player at its start, light. */
export const playTscn = (level: IrLevel, root: string): string => {
  const t = new Tscn();
  const scene = t.ext('PackedScene', `res://${root}/levels/${level.key}.tscn`);
  const player = t.ext('Script', `res://${RUNTIME}/level_player.gd`);
  const env = t.sub('Environment', { background_mode: '1', background_color: 'Color(0.03, 0.03, 0.04, 1)', ambient_light_source: '2', ambient_light_color: 'Color(0.95, 0.9, 0.8, 1)', ambient_light_energy: '0.6' });
  t.node(`Play${level.key.split('_').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : '')).join('')}`, 'Node3D', null);
  t.node('Level', null, '.', {}, `instance=${scene}`);
  const start = level.start ?? { position: [0, 0, 0] as [number, number, number], turn: 0 };
  t.node('Player', 'CharacterBody3D', '.', { transform: transform(rotY(start.turn), [start.position[0], start.position[1] + 0.05, start.position[2]]), script: player, level_path: 'NodePath("../Level")' });
  t.node('Sun', 'DirectionalLight3D', '.', { transform: transform(mul(rotY(35), rotX(-55)), [0, 20, 0]), shadow_enabled: 'true' });
  t.node('World', 'WorldEnvironment', '.', { environment: env });
  return t.toString();
};
