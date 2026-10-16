/**
 * Round-trip import for Unity (spec §19): VcgsChanges reads the level roots
 * (VcgsLevel) as the engine team left them in the open scenes, and VCGS ›
 * Export changes for the studio writes vcgs-changes.json for the studio's
 * Bring back changes: each studio item by its VcgsLevelItem GUID with its
 * GameObject's name, position and turn turned back into the level's space
 * (z south, turns counter-clockwise), and what was added under a level.
 */

/** Where the exporter writes, beside the generated folder (Unity's working folder is the project's). */
export const CHANGES_PATH = 'Assets/VCGS/vcgs-changes.json';

export const CHANGES_RUNTIME = String.raw`// VCGS Runtime for Unity. The same for every project; safe to commit.
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// Bring back changes (spec §19 round-trip import): what the engine team changed in the
    /// generated levels, for VC Game Studio to take back. VCGS › Export changes for the studio
    /// writes it as vcgs-changes.json; give the studio that file. Only what the studio owns goes
    /// back: where things are, what they are called, and whether they are there. Code, art and
    /// engine settings stay here. Plain C# over the scene, so tests can run it too.
    /// </summary>
    public static class VcgsChanges
    {
        /// <summary>One level as it stands: its studio items (with a VcgsLevelItem), and what was added directly under it without one.</summary>
        public static Dictionary<string, object> CollectLevel(VcgsLevel level)
        {
            var items = new List<object>();
            var added = new List<object>();
            var root = level.transform;
            foreach (var item in level.GetComponentsInChildren<VcgsLevelItem>(true))
            {
                // A child map built inside this one (under Maps) sends its own.
                if (!VcgsLevel.OwnedBy(root, item.transform)) continue;
                var entry = Entry(root, item.transform);
                entry["guid"] = item.guid;
                items.Add(entry);
            }
            for (var i = 0; i < root.childCount; i++)
            {
                var child = root.GetChild(i);
                if (child.GetComponent<VcgsLevelItem>() != null || child.GetComponent<VcgsLevel>() != null) continue;
                // The builder's own holders (travel links, the maps inside), and anything the team keeps out with a leading _.
                if (child.gameObject.name == "Travel" || child.gameObject.name == "Maps" || child.gameObject.name.StartsWith("_")) continue;
                added.Add(Entry(root, child));
            }
            return new Dictionary<string, object> { ["guid"] = GuidOf(level), ["items"] = items, ["added"] = added };
        }

        /// <summary>Every level given (each VcgsLevel in the open scenes, for the menu), as vcgs-changes.json has it.</summary>
        public static Dictionary<string, object> Collect(IEnumerable<VcgsLevel> levels, string engine = "unity")
        {
            var list = new List<object>();
            foreach (var level in levels)
                if (level != null && GuidOf(level) != "") list.Add(CollectLevel(level));
            return new Dictionary<string, object> { ["format"] = "vcgs-changes", ["version"] = 1.0, ["engine"] = engine, ["levels"] = list };
        }

        /// <summary>Write vcgs-changes.json; returns how many levels went in.</summary>
        public static int Write(IEnumerable<VcgsLevel> levels, string path)
        {
            var data = Collect(levels);
            var folder = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
            File.WriteAllText(path, Text(data, "") + "\n");
            return D.List(data, "levels").Count;
        }

        /// <summary>The level's GUID: the one the builder kept on it, or its level data's.</summary>
        public static string GuidOf(VcgsLevel level)
        {
            if (!string.IsNullOrEmpty(level.guid)) return level.guid;
            if (level.level == null) return "";
            try { return D.Str(D.Map(Json.Parse(level.level.text)), "guid"); }
            catch (System.FormatException) { return ""; }
        }

        /// <summary>Its name, and where it is in the level's space: Unity's +Z (north) back to the data's z south, a yaw back to a turn counter-clockwise.</summary>
        static Dictionary<string, object> Entry(Transform level, Transform t)
        {
            Vector3 at;
            float yaw;
            if (t.parent == level)
            {
                at = t.localPosition;
                yaw = t.localEulerAngles.y;
            }
            else
            {
                // Moved into a group of the team's: through the group, which only turns about up.
                at = level.InverseTransformPoint(t.position);
                yaw = 0;
                for (var p = t; p != null && p != level; p = p.parent) yaw += p.localEulerAngles.y;
            }
            var turn = ((-yaw % 360) + 540) % 360 - 180;
            return new Dictionary<string, object>
            {
                ["name"] = t.gameObject.name,
                ["position"] = new List<object> { Round(at.x, 3), Round(at.y, 3), Round(-at.z, 3) },
                ["turn"] = Round(turn, 2),
            };
        }

        static double Round(float v, int places)
        {
            var r = System.Math.Round((double)v, places);
            return r == 0 ? 0 : r;
        }

        /// <summary>JSON, two spaces a level.</summary>
        static string Text(object o, string indent)
        {
            switch (o)
            {
                case string s:
                    var b = new StringBuilder("\"");
                    foreach (var c in s)
                    {
                        if (c == '"' || c == '\\') b.Append('\\').Append(c);
                        else if (c == '\n') b.Append("\\n");
                        else if (c == '\r') b.Append("\\r");
                        else if (c == '\t') b.Append("\\t");
                        else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                        else b.Append(c);
                    }
                    return b.Append('"').ToString();
                case double d:
                    return d.ToString("R", CultureInfo.InvariantCulture);
                case Dictionary<string, object> m:
                    if (m.Count == 0) return "{}";
                    var fields = new List<string>();
                    foreach (var kv in m) fields.Add(indent + "  " + Text(kv.Key, "") + ": " + Text(kv.Value, indent + "  "));
                    return "{\n" + string.Join(",\n", fields) + "\n" + indent + "}";
                case List<object> l:
                    if (l.Count == 0) return "[]";
                    // A position on one line.
                    if (l.TrueForAll(x => x is double)) return "[" + string.Join(", ", l.ConvertAll(x => Text(x, ""))) + "]";
                    return "[\n" + string.Join(",\n", l.ConvertAll(x => indent + "  " + Text(x, indent + "  "))) + "\n" + indent + "]";
            }
            return "null";
        }
    }
}
`;

export const CHANGES_EDITOR = String.raw`// VCGS Editor tools for Unity. The same for every project; safe to commit.
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace VCGS.EditorTools
{
    /// <summary>
    /// Bring back changes to VC Game Studio (spec §19): open the level scenes you changed and
    /// choose VCGS › Export changes for the studio. It writes ${CHANGES_PATH}, beside the
    /// generated folder: in the studio, Engine Handoff › Bring back changes from Unity, and pick it.
    /// </summary>
    public static class VcgsChangesExporter
    {
        public const string Path = "${CHANGES_PATH}";

        [MenuItem("VCGS/Export changes for the studio")]
        public static string Export()
        {
            var levels = new List<VcgsLevel>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (var go in scene.GetRootGameObjects()) levels.AddRange(go.GetComponentsInChildren<VcgsLevel>(true));
            }
            if (levels.Count == 0)
            {
                Debug.LogWarning("VCGS: no level in the open scenes. Open the level scenes you changed (VcgsLevel on their root) and export again.");
                return "";
            }
            var count = VcgsChanges.Write(levels, Path);
            AssetDatabase.Refresh();
            Debug.Log("VCGS: wrote " + Path + " (" + count + (count == 1 ? " level" : " levels") + "). In VC Game Studio: Engine Handoff › Bring back changes.");
            return Path;
        }
    }
}
`;
