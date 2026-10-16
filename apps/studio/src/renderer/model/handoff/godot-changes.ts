import type { GeneratedFile } from './engines';

/**
 * Round-trip import for Godot (spec §19): VCGSChanges reads the level scenes
 * as the engine team left them and writes vcgs-changes.json for the studio's
 * Bring back changes: each studio item by its vcgs_guid with its node name,
 * position and turn in the level's space, and what was added under a level.
 */
export const changesRuntime = (runtime: string): GeneratedFile => ({
  path: `${runtime}/changes.gd`,
  kind: 'runtime',
  content: `${[
    '# VCGS Runtime for Godot 4.',
    'class_name VCGSChanges',
    'extends RefCounted',
    '## Bring back changes (spec §19 round-trip import): what the engine team changed in the',
    '## generated level scenes, for VC Game Studio to take back. Run vcgs/export_changes.gd',
    '## (File ▸ Run in the Script editor) and give the studio the vcgs-changes.json it writes.',
    '## Only what the studio owns goes back: where things are, what they are called, and',
    '## whether they are there. Code, art and engine settings stay here.',
    '',
    '## One level scene as it stands: its studio items, and what was added without a GUID.',
    'static func collect_level(level: Node) -> Dictionary:',
    '\tvar items: Array = []',
    '\tvar added: Array = []',
    '\tfor child in level.get_children():',
    '\t\tif not (child is Node3D):',
    '\t\t\tcontinue',
    '\t\tvar node := child as Node3D',
    '\t\tvar entry := { "name": str(node.name), "position": [snappedf(node.position.x, 0.001), snappedf(node.position.y, 0.001), snappedf(node.position.z, 0.001)], "turn": snappedf(rad_to_deg(node.rotation.y), 0.01) }',
    '\t\tif node.has_meta("vcgs_guid"):',
    '\t\t\tentry["guid"] = str(node.get_meta("vcgs_guid"))',
    '\t\t\titems.append(entry)',
    '\t\telif not str(node.name).begins_with("_"):',
    '\t\t\tadded.append(entry)',
    '\treturn { "guid": str(level.get_meta("vcgs_guid_level", "")), "items": items, "added": added }',
    '',
    '## Every generated level scene in a folder (not the play_ scenes that drop a player in).',
    'static func collect(levels_dir: String, engine: String = "godot") -> Dictionary:',
    '\tvar levels: Array = []',
    '\tfor file in DirAccess.get_files_at(levels_dir):',
    '\t\tif not file.ends_with(".tscn") or file.begins_with("play_"):',
    '\t\t\tcontinue',
    '\t\tvar packed := load(levels_dir.path_join(file)) as PackedScene',
    '\t\tif packed == null:',
    '\t\t\tcontinue',
    '\t\tvar level := packed.instantiate()',
    '\t\tif level.has_meta("vcgs_guid_level"):',
    '\t\t\tlevels.append(collect_level(level))',
    '\t\tlevel.free()',
    '\treturn { "format": "vcgs-changes", "version": 1, "engine": engine, "levels": levels }',
    '',
    '## Write vcgs-changes.json; returns where it went.',
    'static func write(levels_dir: String, path: String) -> String:',
    '\tvar file := FileAccess.open(path, FileAccess.WRITE)',
    '\tif file == null:',
    '\t\tpush_error("VCGS: can\'t write %s" % path)',
    '\t\treturn ""',
    '\tfile.store_string(JSON.stringify(collect(levels_dir), "  "))',
    '\tfile.close()',
    '\treturn path',
  ].join('\n')}\n`,
});

/** The editor script the engine team runs: File ▸ Run in the Script editor. */
export const exportChangesScript = (root: string): string =>
  [
    '@tool',
    'extends EditorScript',
    '## Bring back changes to VC Game Studio (spec §19): open this in the Script editor and',
    '## choose File ▸ Run. It writes vcgs-changes.json beside it: in the studio, Engine Handoff ▸',
    '## Bring back changes from Godot, and pick it.',
    '',
    'func _run() -> void:',
    `\tvar path := VCGSChanges.write("res://${root}/levels", "res://${root}/vcgs-changes.json")`,
    '\tif path != "":',
    '\t\tprint("VCGS: wrote ", ProjectSettings.globalize_path(path))',
  ].join('\n');
