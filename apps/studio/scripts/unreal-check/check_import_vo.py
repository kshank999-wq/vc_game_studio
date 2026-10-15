"""Runs the generated import_vo.py against a stand-in for Unreal's Python API:
the takes it imports, and the subtitle each sound wave is given from
story.json. Usage: check_import_vo.py <exported project dir>."""
import os
import runpy
import shutil
import sys
import tempfile
import types

project = sys.argv[1]
script = os.path.join(project, "Content", "VCGS", "Generated", "import_vo.py")
vo = os.path.join(project, "VCGS", "SourceAudio", "vo")

# The takes themselves come from the person's computer, not the generated files: stand-ins, one per subtitle file.
work = tempfile.mkdtemp()
try:
    shutil.copytree(os.path.join(project, "Content"), os.path.join(work, "Content"))
    os.makedirs(os.path.join(work, "VCGS", "SourceAudio", "vo"))
    srts = sorted(f for f in os.listdir(vo) if f.endswith(".srt"))
    for f in srts:
        shutil.copy(os.path.join(vo, f), os.path.join(work, "VCGS", "SourceAudio", "vo", f))
        open(os.path.join(work, "VCGS", "SourceAudio", "vo", f[:-4] + ".wav"), "wb").close()

    imported, waves, saved, logs = [], {}, [], []

    class Wave:
        def __init__(self):
            self.props = {}

        def set_editor_property(self, k, v):
            self.props[k] = v

    class Cue:
        def __init__(self):
            self.props = {}

        def set_editor_property(self, k, v):
            self.props[k] = v

    class AssetImportTask:
        pass

    class Tools:
        def import_asset_tasks(self, tasks):
            for t in tasks:
                imported.append(t.destination_name)
                waves["%s/%s" % (t.destination_path, t.destination_name)] = Wave()

    fake = types.ModuleType("unreal")
    fake.Paths = types.SimpleNamespace(project_dir=lambda: work + os.sep)
    fake.AssetImportTask = AssetImportTask
    fake.AssetToolsHelpers = types.SimpleNamespace(get_asset_tools=lambda: Tools())
    fake.load_asset = lambda path: waves.get(path)
    fake.SubtitleCue = Cue
    fake.Text = str
    fake.EditorAssetLibrary = types.SimpleNamespace(save_loaded_asset=lambda a: saved.append(a))
    fake.log = logs.append
    fake.log_warning = lambda m: logs.append("WARNING " + m)
    sys.modules["unreal"] = fake
    runpy.run_path(script, run_name="__main__")

    mara = waves.get("/Game/VCGS/VO/sc_03_line_02")
    cues = mara.props.get("subtitles", []) if mara else []
    text = cues[0].props.get("text") if cues else None
    print("import_vo: %s · Mara's sound wave: %r at %s" % (" / ".join(logs), text, cues[0].props.get("time") if cues else None))
    if len(imported) != len(srts) or not srts:
        sys.exit("import_vo.py should import every take, got %d of %d" % (len(imported), len(srts)))
    if text != "Mara: Water’s holding it shut. There’s a lever somewhere." or cues[0].props.get("time") != 0.0:
        sys.exit("Mara's sound wave should carry her subtitle from its start, got %r" % text)
    if len(saved) != len(srts) or any("WARNING" in l for l in logs):
        sys.exit("every sound wave should get its subtitle and be saved")
finally:
    shutil.rmtree(work)
