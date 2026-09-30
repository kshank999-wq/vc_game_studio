/**
 * The VCGS Runtime for Unity, as C# source. The logic is plain C# (Story,
 * GameState, Rules, ScenePlayer, Interactions, StoryWalker) so it runs, and
 * is tested, outside Unity too; the MonoBehaviours and ScriptableObjects are
 * thin Unity wrappers around it. C# 9, for Unity 2021.2 and later.
 */

import { MAIL_ON_CLIPBOARD, MAILTO_LIMIT, NOTES_PRINT_STYLE } from '../play';

const HEAD = '// VCGS Runtime for Unity. The same for every project; safe to commit.';

export const RUNTIME_FILES: Record<string, string> = {
  'Json.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace VCGS
{
    /// <summary>
    /// A small JSON reader for the story file. Objects become
    /// Dictionary&lt;string, object&gt;, arrays List&lt;object&gt;, numbers double.
    /// </summary>
    public static class Json
    {
        public static object Parse(string text)
        {
            var parser = new Parser(text);
            var value = parser.Value();
            parser.SkipWhite();
            if (!parser.End) throw new FormatException("Unexpected text after the JSON value");
            return value;
        }

        sealed class Parser
        {
            readonly string s;
            int i;

            public Parser(string text) { s = text ?? ""; }

            public bool End => i >= s.Length;

            public void SkipWhite()
            {
                while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            }

            char Peek()
            {
                if (End) throw new FormatException("Unexpected end of JSON");
                return s[i];
            }

            public object Value()
            {
                SkipWhite();
                switch (Peek())
                {
                    case '{': return Object();
                    case '[': return Array();
                    case '"': return String();
                    case 't': Word("true"); return true;
                    case 'f': Word("false"); return false;
                    case 'n': Word("null"); return null;
                    default: return Number();
                }
            }

            void Word(string word)
            {
                if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw new FormatException("Bad JSON at " + i);
                i += word.Length;
            }

            Dictionary<string, object> Object()
            {
                var d = new Dictionary<string, object>();
                i++;
                SkipWhite();
                if (Peek() == '}') { i++; return d; }
                while (true)
                {
                    SkipWhite();
                    var key = String();
                    SkipWhite();
                    if (Peek() != ':') throw new FormatException("Expected : at " + i);
                    i++;
                    d[key] = Value();
                    SkipWhite();
                    var c = Peek();
                    i++;
                    if (c == ',') continue;
                    if (c == '}') return d;
                    throw new FormatException("Expected , or } at " + i);
                }
            }

            List<object> Array()
            {
                var list = new List<object>();
                i++;
                SkipWhite();
                if (Peek() == ']') { i++; return list; }
                while (true)
                {
                    list.Add(Value());
                    SkipWhite();
                    var c = Peek();
                    i++;
                    if (c == ',') continue;
                    if (c == ']') return list;
                    throw new FormatException("Expected , or ] at " + i);
                }
            }

            string String()
            {
                if (Peek() != '"') throw new FormatException("Expected a string at " + i);
                i++;
                var sb = new System.Text.StringBuilder();
                while (true)
                {
                    var c = Peek();
                    i++;
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    var e = Peek();
                    i++;
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                            i += 4;
                            break;
                        default: throw new FormatException("Bad escape at " + i);
                    }
                }
            }

            double Number()
            {
                var start = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                if (start == i) throw new FormatException("Bad JSON at " + i);
                return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }

    /// <summary>Reading the parsed story: dictionaries, lists and their values.</summary>
    public static class D
    {
        public static Dictionary<string, object> Map(object o) => o as Dictionary<string, object> ?? new Dictionary<string, object>();

        public static List<object> List(object o) => o as List<object> ?? new List<object>();

        public static object Get(Dictionary<string, object> d, string key) => d != null && d.TryGetValue(key, out var v) ? v : null;

        public static string Str(Dictionary<string, object> d, string key) => Get(d, key) is string s ? s : Get(d, key) is double n ? n.ToString(CultureInfo.InvariantCulture) : "";

        public static double Num(Dictionary<string, object> d, string key, double fallback = 0) => Get(d, key) is double n ? n : fallback;

        public static double Num(object o, double fallback) => o is double n ? n : fallback;

        public static bool Bool(Dictionary<string, object> d, string key) => Get(d, key) is bool b && b;

        public static Dictionary<string, object> Map(Dictionary<string, object> d, string key) => Map(Get(d, key));

        public static List<object> List(Dictionary<string, object> d, string key) => List(Get(d, key));
    }
}
`,

  'Story.cs': String.raw`${HEAD}
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>
    /// The story as VC Game Studio wrote it (story.json), indexed by key:
    /// graph nodes, scenes, choices, objects and puzzles, triggers, flags,
    /// characters, cinematics and dialogue lines.
    /// </summary>
    public sealed class Story
    {
        public readonly Dictionary<string, object> Root;
        public readonly string Name;
        public readonly string Start;
        public readonly Dictionary<string, Dictionary<string, object>> Graph = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Scenes = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Choices = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Objects = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Triggers = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Flags = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Characters = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Cinematics = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Lines = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Quests = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Encounters = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Lore = new Dictionary<string, Dictionary<string, object>>();
        public readonly Dictionary<string, Dictionary<string, object>> Mechanics = new Dictionary<string, Dictionary<string, object>>();
        /// <summary>Items that can be equipped, by item key: name, slot, stats, ammo, ammoPerUse, durability.</summary>
        public readonly Dictionary<string, Dictionary<string, object>> Equipment = new Dictionary<string, Dictionary<string, object>>();
        /// <summary>Skills, abilities and upgrades, by key: ranks, cost, requires, learnWhen (and learnWhenText), onLearn.</summary>
        public readonly Dictionary<string, Dictionary<string, object>> Skills = new Dictionary<string, Dictionary<string, object>>();
        /// <summary>Inventory items, by key: name, notes and fields (the codex entry is fields.codex).</summary>
        public readonly Dictionary<string, Dictionary<string, object>> ItemDefs = new Dictionary<string, Dictionary<string, object>>();
        /// <summary>Locations (environments), by key: name, notes and fields (the codex entry is fields.codex).</summary>
        public readonly Dictionary<string, Dictionary<string, object>> LocationDefs = new Dictionary<string, Dictionary<string, object>>();

        public static Story FromJson(string json) => new Story(D.Map(Json.Parse(json)));

        public Story(Dictionary<string, object> root)
        {
            Root = root;
            Name = D.Str(D.Map(root, "project"), "name");
            foreach (var n in D.List(root, "graph"))
            {
                var node = D.Map(n);
                Graph[D.Str(node, "key")] = node;
                if (D.Str(node, "kind") == "begin") Start = D.Str(node, "key");
            }
            Index(root, "scenes", Scenes);
            Index(root, "choices", Choices);
            Index(root, "objects", Objects);
            Index(root, "triggers", Triggers);
            Index(root, "flags", Flags);
            Index(root, "characters", Characters);
            Index(root, "cinematics", Cinematics);
            Index(root, "quests", Quests);
            Index(root, "encounters", Encounters);
            Index(root, "lore", Lore);
            Index(root, "mechanics", Mechanics);
            Index(root, "skills", Skills);
            foreach (var e in D.List(root, "equipment")) { var d = D.Map(e); Equipment[D.Str(d, "item")] = d; }
            Index(root, "items", ItemDefs);
            Index(root, "locations", LocationDefs);
            foreach (var l in D.List(root, "lines"))
            {
                var line = D.Map(l);
                Lines[D.Str(line, "id")] = line;
            }
        }

        static void Index(Dictionary<string, object> root, string list, Dictionary<string, Dictionary<string, object>> into)
        {
            foreach (var item in D.List(root, list))
            {
                var d = D.Map(item);
                into[D.Str(D.Map(d, "ident"), "key")] = d;
            }
        }

        /// <summary>A lore entry's name and text, for a codex.</summary>
        public (string name, string text) LoreEntry(string key) => Lore.TryGetValue(key ?? "", out var l) ? (D.Str(l, "name"), D.Str(l, "notes")) : ("", "");

        /// <summary>A mechanic's field as written in the studio, such as its tuning ("" when it has none).</summary>
        public string MechanicDetail(string key, string field) => Mechanics.TryGetValue(key ?? "", out var m) ? D.Str(D.Map(m, "fields"), field) : "";

        /// <summary>A character's name by key, for the speaker of a line.</summary>
        public string CharacterName(string key) => Characters.TryGetValue(key ?? "", out var c) ? D.Str(c, "name") : "";
        /// <summary>What the codex says about a character once met ("" keeps them out of it).</summary>
        public string CharacterCodex(string key) => Characters.TryGetValue(key ?? "", out var c) ? D.Str(c, "codex").Trim() : "";
        /// <summary>What the codex says about an object (not a puzzle) once used ("" keeps it out of it).</summary>
        public string ObjectCodex(string key) => Objects.TryGetValue(key ?? "", out var o) && D.Str(o, "kind") == "object" ? D.Str(D.Map(o, "fields"), "codex").Trim() : "";
        /// <summary>What the codex says about a location once visited ("" keeps it out of it).</summary>
        public string LocationCodex(string key) => LocationDefs.TryGetValue(key ?? "", out var l) ? D.Str(D.Map(l, "fields"), "codex").Trim() : "";
        public string LocationName(string key) => LocationDefs.TryGetValue(key ?? "", out var l) ? D.Str(l, "name") : "";
        /// <summary>What the codex says about an item once found ("" keeps it out of it).</summary>
        public string ItemCodex(string key) => ItemDefs.TryGetValue(key ?? "", out var i) ? D.Str(D.Map(i, "fields"), "codex").Trim() : "";
        public string ItemName(string key) => ItemDefs.TryGetValue(key ?? "", out var i) ? D.Str(i, "name") : "";
        /// <summary>A line's speaker key ("" for none).</summary>
        public string Speaker(string lineId) => Lines.TryGetValue(lineId ?? "", out var l) ? D.Str(l, "speaker") : "";
    }
}
`,

  'GameState.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>
    /// Everything a playthrough knows: flags, object states, items, arcs,
    /// choices made, puzzles solved, scenes visited, triggers fired and options
    /// picked. After every change, triggers fire and puzzles solve themselves
    /// when their rules hold (unless AutoRules is off).
    /// </summary>
    public sealed class GameState
    {
        public readonly Story Story;
        public readonly Dictionary<string, string> Flags = new Dictionary<string, string>();
        public readonly Dictionary<string, string> ObjectStates = new Dictionary<string, string>();
        public readonly Dictionary<string, int> Items = new Dictionary<string, int>();
        public readonly Dictionary<string, int> Arcs = new Dictionary<string, int>();
        public readonly Dictionary<string, string> Chosen = new Dictionary<string, string>();
        public readonly HashSet<string> Solved = new HashSet<string>();
        public readonly HashSet<string> Visited = new HashSet<string>();
        public readonly HashSet<string> Fired = new HashSet<string>();
        public readonly HashSet<string> Picked = new HashSet<string>();
        /// <summary>Quests under way ("active") or "done"; one not in here has not started.</summary>
        public readonly Dictionary<string, string> Quests = new Dictionary<string, string>();
        /// <summary>Encounters won.</summary>
        public readonly HashSet<string> Won = new HashSet<string>();
        /// <summary>Encounters the player has come to, in the order met (the codex).</summary>
        public readonly List<string> MetEncounters = new List<string>();
        /// <summary>Characters the player has met (heard speak), in the order met.</summary>
        public readonly List<string> MetCharacters = new List<string>();
        /// <summary>Items the player has ever held, in the order found (carried or not now).</summary>
        public readonly List<string> FoundItems = new List<string>();
        /// <summary>Locations the player has been to (a scene set there played), in the order visited.</summary>
        public readonly List<string> VisitedLocations = new List<string>();
        /// <summary>Objects the player has used, in the order first used.</summary>
        public readonly List<string> UsedObjects = new List<string>();
        /// <summary>Codex entries the player has bookmarked, by key ("lore:the_drowned_order"), in the order bookmarked.</summary>
        public readonly List<string> Bookmarks = new List<string>();
        /// <summary>The player's notes on codex entries, by key.</summary>
        public readonly Dictionary<string, string> Notes = new Dictionary<string, string>();
        /// <summary>When each note was last changed (milliseconds since 1970), kept for notes taken off too, so they sync.</summary>
        public readonly Dictionary<string, long> NoteTimes = new Dictionary<string, long>();
        /// <summary>Lore the player has come across, in the order they found it (the codex).</summary>
        public readonly List<string> KnownLore = new List<string>();
        /// <summary>Mechanics the player can use now.</summary>
        public readonly HashSet<string> Mechanics = new HashSet<string>();
        /// <summary>The same mechanics, in the order they became available.</summary>
        public readonly List<string> AvailableMechanics = new List<string>();
        /// <summary>Skills, abilities and upgrades learned, by rank (Rules.Learn).</summary>
        public readonly Dictionary<string, int> Skills = new Dictionary<string, int>();
        /// <summary>What is equipped, by slot (an item key each).</summary>
        public readonly Dictionary<string, string> Equipped = new Dictionary<string, string>();
        /// <summary>How many times each item of equipment has been used, toward its durability.</summary>
        public readonly Dictionary<string, int> Wear = new Dictionary<string, int>();

        /// <summary>Anything the story's conditions can see has changed.</summary>
        public event Action Changed;
        public event Action<string> TriggerFired;
        public event Action<string> QuestStarted;
        public event Action<string> QuestCompleted;
        public event Action<string> LoreDiscovered;
        public event Action<string> MechanicAvailable;
        /// <summary>A skill gained a rank: its key and new rank.</summary>
        public event Action<string, int> SkillLearned;
        /// <summary>An item went into a slot, or came out of it: its key and the slot.</summary>
        public event Action<string, string> ItemEquipped, ItemUnequipped;
        /// <summary>An item of equipment was used, or broke.</summary>
        public event Action<string> ItemUsed, ItemBroke;
        public event Action<string> EncounterMet;
        public event Action<string> EncounterWon;
        public event Action<string> CharacterMet;
        public event Action<string> ItemFound;
        public event Action<string> LocationVisited;
        public event Action<string> ObjectUsed;
        public bool AutoRules = true;
        bool settling;

        public GameState(Story story)
        {
            Story = story;
            Reset();
        }

        /// <summary>Put everything where it starts: a new game.</summary>
        public void Reset()
        {
            checkpointBody = null;
            checkpointAt = "";
            Loaded = false;
            Flags.Clear(); ObjectStates.Clear(); Items.Clear(); Arcs.Clear(); Chosen.Clear();
            Solved.Clear(); Visited.Clear(); Fired.Clear(); Picked.Clear(); Quests.Clear(); Won.Clear(); MetEncounters.Clear(); MetCharacters.Clear(); FoundItems.Clear(); VisitedLocations.Clear(); UsedObjects.Clear(); Bookmarks.Clear(); Notes.Clear(); NoteTimes.Clear(); KnownLore.Clear(); Mechanics.Clear(); AvailableMechanics.Clear(); Skills.Clear(); Equipped.Clear(); Wear.Clear();
            foreach (var f in Story.Flags) Flags[f.Key] = D.Str(f.Value, "initial");
            foreach (var o in Story.Objects)
            {
                var initial = D.Str(o.Value, "initial");
                if (D.Str(o.Value, "kind") == "object" && initial != "") ObjectStates[o.Key] = initial;
            }
            // Quests with nothing to wait for start now; anything already true settles.
            OnChanged();
        }

        public string GetFlag(string flag) => Flags.TryGetValue(flag, out var v) ? v : "";

        public void SetFlag(string flag, string value)
        {
            if (Flags.TryGetValue(flag, out var old) && old == value) return;
            Flags[flag] = value;
            OnChanged();
        }

        public string GetObjectState(string obj) => ObjectStates.TryGetValue(obj, out var v) ? v : "";

        public void SetObjectState(string obj, string state)
        {
            if (ObjectStates.TryGetValue(obj, out var old) && old == state) return;
            ObjectStates[obj] = state;
            OnChanged();
        }

        public bool HasItem(string item) => Items.TryGetValue(item, out var n) && n > 0;

        public void GiveItem(string item, int count = 1)
        {
            Items[item] = (Items.TryGetValue(item, out var n) ? n : 0) + count;
            if (Items[item] > 0 && !FoundItems.Contains(item))
            {
                FoundItems.Add(item);
                ItemFound?.Invoke(item);
            }
            OnChanged();
        }

        public void TakeItem(string item, int count = 1)
        {
            Items[item] = Math.Max(0, (Items.TryGetValue(item, out var n) ? n : 0) - count);
            if (Items[item] == 0) DropEquipped(item);
            OnChanged();
        }

        /// <summary>Nothing left of an item: it comes out of its slot, and a new one starts unworn.</summary>
        void DropEquipped(string item)
        {
            foreach (var slot in new List<string>(Equipped.Keys))
                if (Equipped[slot] == item) { Equipped.Remove(slot); ItemUnequipped?.Invoke(item, slot); }
            Wear.Remove(item);
        }

        public bool IsEquipped(string item) => Equipped.ContainsValue(item ?? "");
        /// <summary>The item in a slot ("" for none).</summary>
        public string EquippedIn(string slot) => Equipped.TryGetValue(slot ?? "", out var i) ? i : "";

        string GearName(string item) => Story.Equipment.TryGetValue(item ?? "", out var e) ? D.Str(e, "name") : item;

        /// <summary>Why an item can't be equipped now, or "" when it can.</summary>
        public string EquipCheck(string item)
        {
            if (!Story.Equipment.ContainsKey(item ?? "")) return "Not equipment.";
            if (!HasItem(item)) return "You don't carry " + GearName(item) + ".";
            if (IsEquipped(item)) return GearName(item) + " is already equipped.";
            return "";
        }

        /// <summary>Put an item in its slot, putting back what was there. Returns why not ("" when equipped).</summary>
        public string Equip(string item)
        {
            var why = EquipCheck(item);
            if (why != "") return why;
            var slot = D.Str(Story.Equipment[item], "slot");
            var before = EquippedIn(slot);
            if (before != "") { Equipped.Remove(slot); ItemUnequipped?.Invoke(before, slot); }
            Equipped[slot] = item;
            ItemEquipped?.Invoke(item, slot);
            OnChanged();
            return "";
        }

        /// <summary>Take an item out of its slot. Returns why not ("" when put away).</summary>
        public string Unequip(string item)
        {
            foreach (var slot in new List<string>(Equipped.Keys))
            {
                if (Equipped[slot] != item) continue;
                Equipped.Remove(slot);
                ItemUnequipped?.Invoke(item, slot);
                OnChanged();
                return "";
            }
            return GearName(item) + " is not equipped.";
        }

        /// <summary>Why an equipped item can't be used now, or "" when it can: not equipped, or out of its ammunition.</summary>
        public string UseCheck(string item)
        {
            if (!Story.Equipment.TryGetValue(item ?? "", out var e)) return "Not equipment.";
            if (!IsEquipped(item)) return "Equip " + GearName(item) + " first.";
            var ammo = D.Map(e, "ammo");
            if (ammo.Count > 0 && (Items.TryGetValue(D.Str(ammo, "item"), out var n) ? n : 0) < (int)D.Num(e, "ammoPerUse", 1)) return "Out of " + D.Str(ammo, "name") + ".";
            return "";
        }

        /// <summary>Use an equipped item: spend its ammunition and a use of wear; worn out, it breaks and one is gone. Returns why not ("" when used).</summary>
        public string UseItem(string item)
        {
            var why = UseCheck(item);
            if (why != "") return why;
            var e = Story.Equipment[item];
            var ammo = D.Map(e, "ammo");
            if (ammo.Count > 0) TakeItem(D.Str(ammo, "item"), (int)D.Num(e, "ammoPerUse", 1));
            Wear[item] = (Wear.TryGetValue(item, out var w) ? w : 0) + 1;
            ItemUsed?.Invoke(item);
            var durability = (int)D.Num(e, "durability", 0);
            if (durability > 0 && Wear[item] >= durability)
            {
                Wear[item] = 0;
                ItemBroke?.Invoke(item);
                TakeItem(item);
            }
            else OnChanged();
            return "";
        }

        /// <summary>Uses left before an item breaks (-1 when it never does).</summary>
        public int UsesLeft(string item)
        {
            var durability = Story.Equipment.TryGetValue(item ?? "", out var e) ? (int)D.Num(e, "durability", 0) : 0;
            return durability == 0 ? -1 : Math.Max(0, durability - (Wear.TryGetValue(item, out var w) ? w : 0));
        }

        /// <summary>What the equipped items add up to for a stat (by name, ignoring case).</summary>
        public double Stat(string name)
        {
            double total = 0;
            foreach (var item in Equipped.Values)
                if (Story.Equipment.TryGetValue(item, out var e))
                    foreach (var s in D.List(e, "stats"))
                        if (string.Equals(D.Str(D.Map(s), "name"), name, StringComparison.OrdinalIgnoreCase)) total += D.Num(D.Map(s), "value");
            return total;
        }

        public int Arc(string character) => Arcs.TryGetValue(character, out var n) ? n : 0;

        /// <summary>Move a character along their arc: +1 growth, -1 setback.</summary>
        public void AddArc(string character, int amount)
        {
            Arcs[character] = Arc(character) + amount;
            OnChanged();
        }

        public void RememberChoice(string choice, string option)
        {
            Chosen[choice] = option;
            OnChanged();
        }

        public void MarkSolved(string puzzle)
        {
            if (Solved.Add(puzzle)) OnChanged();
        }

        /// <summary>Bookmark a codex entry ("lore:the_drowned_order"), or take its bookmark off. Returns whether it is bookmarked now.</summary>
        public bool ToggleBookmark(string entry)
        {
            if (Bookmarks.Remove(entry)) return false;
            Bookmarks.Add(entry);
            return true;
        }

        public bool IsBookmarked(string entry) => Bookmarks.Contains(entry);

        /// <summary>Keep the player's note on a codex entry ("" takes it off).</summary>
        public void SetNote(string entry, string text)
        {
            NoteTimes[entry] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            text = (text ?? "").Trim();
            if (text == "") Notes.Remove(entry);
            else Notes[entry] = text;
        }

        public string NoteFor(string entry) => Notes.TryGetValue(entry, out var n) ? n : "";

        /// <summary>The notes as a sync file: each with when it was last changed (a note taken off, empty).</summary>
        public string NotesSyncText(string story)
        {
            string Q(string s)
            {
                var b = new System.Text.StringBuilder("\"");
                foreach (var c in s ?? "")
                {
                    if (c == '"' || c == '\\') b.Append('\\').Append(c);
                    else if (c == '\n') b.Append("\\n");
                    else if (c == '\r') b.Append("\\r");
                    else if (c == '\t') b.Append("\\t");
                    else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                    else b.Append(c);
                }
                return b.Append('"').ToString();
            }
            var keys = new List<string>(NoteTimes.Keys);
            keys.Sort(string.CompareOrdinal);
            var json = new System.Text.StringBuilder("{\n  \"format\": \"vcgs-codex-notes-sync\",\n  \"version\": 1,\n  \"story\": " + Q(story) + ",\n  \"notes\": {");
            for (var i = 0; i < keys.Count; i++)
                json.Append((i > 0 ? "," : "") + "\n    " + Q(keys[i]) + ": { \"text\": " + Q(NoteFor(keys[i])) + ", \"at\": " + NoteTimes[keys[i]] + " }");
            return json.Append(keys.Count > 0 ? "\n  }\n}" : "}\n}").ToString();
        }

        /// <summary>Merge a sync file into the notes: for each entry, the newer note wins (on a tie, ours). Returns how many notes it changed, or -1 when the text is not a sync file.</summary>
        public int SyncNotes(string text)
        {
            Dictionary<string, object> data;
            try { data = D.Map(Json.Parse(text ?? "")); }
            catch (Exception) { return -1; }
            if (D.Str(data, "format") != "vcgs-codex-notes-sync" || !(D.Get(data, "notes") is Dictionary<string, object> notes)) return -1;
            var changed = 0;
            foreach (var n in notes)
            {
                if (!(n.Value is Dictionary<string, object> note) || !(D.Get(note, "text") is string words) || !(D.Get(note, "at") is double atNumber)) continue;
                var at = (long)atNumber;
                if (NoteTimes.TryGetValue(n.Key, out var ours) && at <= ours) continue;
                words = words.Trim();
                if (NoteFor(n.Key) != words) changed++;
                NoteTimes[n.Key] = at;
                if (words == "") Notes.Remove(n.Key);
                else Notes[n.Key] = words;
            }
            return changed;
        }

        /// <summary>The player has used an object (Interactions.Interact says so).</summary>
        public void UseObject(string obj)
        {
            if (string.IsNullOrEmpty(obj) || UsedObjects.Contains(obj)) return;
            UsedObjects.Add(obj);
            ObjectUsed?.Invoke(obj);
        }

        /// <summary>The player is at a location (the scene player says so as a scene set there starts).</summary>
        public void VisitLocation(string location)
        {
            if (string.IsNullOrEmpty(location) || VisitedLocations.Contains(location)) return;
            VisitedLocations.Add(location);
            LocationVisited?.Invoke(location);
        }

        public void Visit(string scene)
        {
            if (Visited.Add(scene)) OnChanged();
        }

        /// <summary>"" (not started), "active" or "done".</summary>
        public string QuestState(string quest) => Quests.TryGetValue(quest, out var s) ? s : "";

        public void SetQuest(string quest, string state)
        {
            if (QuestState(quest) == state) return;
            Quests[quest] = state;
            if (state == "active") QuestStarted?.Invoke(quest);
            else if (state == "done") QuestCompleted?.Invoke(quest);
            OnChanged();
        }

        public bool KnowsLore(string lore) => KnownLore.Contains(lore);

        public void DiscoverLore(string lore)
        {
            if (KnowsLore(lore)) return;
            KnownLore.Add(lore);
            LoreDiscovered?.Invoke(lore);
            OnChanged();
        }

        public bool HasMechanic(string mechanic) => Mechanics.Contains(mechanic);

        /// <summary>A skill's rank: 0 until learned.</summary>
        public int SkillRank(string skill) => Skills.TryGetValue(skill ?? "", out var n) ? n : 0;

        /// <summary>One rank more of a skill (Rules.Learn pays for it and checks what it needs first).</summary>
        public void AddSkillRank(string skill)
        {
            Skills[skill] = SkillRank(skill) + 1;
            SkillLearned?.Invoke(skill, Skills[skill]);
            OnChanged();
        }

        public void EnableMechanic(string mechanic)
        {
            if (!Mechanics.Add(mechanic)) return;
            AvailableMechanics.Add(mechanic);
            MechanicAvailable?.Invoke(mechanic);
            OnChanged();
        }

        public bool WasWon(string encounter) => Won.Contains(encounter);

        public void MarkWon(string encounter)
        {
            if (!Won.Add(encounter)) return;
            MeetEncounter(encounter);
            EncounterWon?.Invoke(encounter);
            OnChanged();
        }

        public bool HasMet(string encounter) => MetEncounters.Contains(encounter);

        public bool HasMetCharacter(string character) => MetCharacters.Contains(character);

        /// <summary>The player has met a character (the scene flow says so when they speak a line).</summary>
        public void MeetCharacter(string character)
        {
            if (string.IsNullOrEmpty(character) || HasMetCharacter(character)) return;
            MetCharacters.Add(character);
            CharacterMet?.Invoke(character);
        }

        /// <summary>The player has come to an encounter (the scene flow says so as it starts).</summary>
        public void MeetEncounter(string encounter)
        {
            if (HasMet(encounter)) return;
            MetEncounters.Add(encounter);
            EncounterMet?.Invoke(encounter);
        }

        public void MarkPicked(string option) => Picked.Add(option);

        public bool WasPicked(string option) => Picked.Contains(option);

        internal void RaiseTriggerFired(string trigger) => TriggerFired?.Invoke(trigger);

        /// <summary>The game as the scene being played began (the fields of a save), and that scene: what a save keeps, so loading plays the scene again from its start.</summary>
        string checkpointAt = "", checkpointBody = null;
        /// <summary>True after a load, until the scene it resumes at starts.</summary>
        public bool Loaded;

        static string Q(string s)
        {
            var b = new System.Text.StringBuilder("\"");
            foreach (var c in s ?? "")
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c == '\n') b.Append("\\n");
                else if (c == '\r') b.Append("\\r");
                else if (c == '\t') b.Append("\\t");
                else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        static string Sorted(IEnumerable<string> keys)
        {
            var list = new List<string>(keys);
            list.Sort(string.CompareOrdinal);
            return InOrder(list);
        }

        static string InOrder(IEnumerable<string> keys) => "[" + string.Join(", ", new List<string>(keys).ConvertAll(Q)) + "]";

        static string Map<T>(Dictionary<string, T> d, Func<T, string> value)
        {
            var parts = new List<string>();
            foreach (var e in d) parts.Add(Q(e.Key) + ": " + value(e.Value));
            return "{" + string.Join(", ", parts) + "}";
        }

        /// <summary>Everything the story knows, as the fields of a save (without the codex notes and bookmarks, which are the player's own).</summary>
        string SaveBody()
        {
            var quests = new List<string>();
            foreach (var q in Quests) quests.Add("{\"key\": " + Q(q.Key) + ", \"state\": " + Q(q.Value) + "}");
            return "  \"flags\": " + Map(Flags, Q) + ",\n  \"objects\": " + Map(ObjectStates, Q) + ",\n  \"items\": " + Map(Items, n => n.ToString(System.Globalization.CultureInfo.InvariantCulture)) +
                ",\n  \"arcs\": " + Map(Arcs, n => n.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ",\n  \"chosen\": " + Map(Chosen, Q) + ",\n  \"quests\": [" + string.Join(", ", quests) + "]" +
                ",\n  \"solved\": " + Sorted(Solved) + ",\n  \"visited\": " + Sorted(Visited) + ",\n  \"fired\": " + Sorted(Fired) + ",\n  \"picked\": " + Sorted(Picked) + ",\n  \"won\": " + Sorted(Won) +
                ",\n  \"met\": " + InOrder(MetEncounters) + ",\n  \"characters\": " + InOrder(MetCharacters) + ",\n  \"found\": " + InOrder(FoundItems) + ",\n  \"locations\": " + InOrder(VisitedLocations) +
                ",\n  \"used\": " + InOrder(UsedObjects) + ",\n  \"lore\": " + InOrder(KnownLore) + ",\n  \"mechanics\": " + InOrder(AvailableMechanics) +
                ",\n  \"skills\": " + Map(Skills, n => n.ToString(System.Globalization.CultureInfo.InvariantCulture)) +
                ",\n  \"equipped\": " + Map(Equipped, Q) + ",\n  \"wear\": " + Map(Wear, n => n.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        /// <summary>Keep the game as it is now, as the scene starting (sceneKey) begins: what a save keeps. The scene player calls it.</summary>
        public void Checkpoint(string sceneKey)
        {
            checkpointAt = sceneKey ?? "";
            checkpointBody = SaveBody();
        }

        /// <summary>
        /// The save file's text: the game as the scene being played began (as it
        /// is now, before any scene). The same format in every VCGS runtime, so
        /// a save from one engine loads in another.
        /// </summary>
        public string SaveText(string story)
        {
            var at = checkpointBody != null ? checkpointAt : "";
            return "{\n  \"format\": \"vcgs-save\",\n  \"version\": 1,\n  \"story\": " + Q(story) + ",\n  \"at\": " + Q(at) + ",\n  \"saved_at\": " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ",\n" + (checkpointBody ?? SaveBody()) + "\n}";
        }

        /// <summary>
        /// Load a save (from this runtime or another engine's): everything the
        /// story knows is as it was saved (anything the story gained since starts
        /// where it starts). Returns the scene to play from ("" for the story's
        /// beginning), or null when the text is not a save.
        /// </summary>
        public string LoadSave(string text)
        {
            Dictionary<string, object> data;
            try { data = D.Map(Json.Parse(text ?? "")); }
            catch (Exception) { return null; }
            if (D.Str(data, "format") != "vcgs-save") return null;
            var keepRules = AutoRules;
            AutoRules = false;
            Flags.Clear(); ObjectStates.Clear(); Items.Clear(); Arcs.Clear(); Chosen.Clear();
            Solved.Clear(); Visited.Clear(); Fired.Clear(); Picked.Clear(); Quests.Clear(); Won.Clear(); MetEncounters.Clear(); MetCharacters.Clear(); FoundItems.Clear(); VisitedLocations.Clear(); UsedObjects.Clear(); KnownLore.Clear(); Mechanics.Clear(); AvailableMechanics.Clear(); Skills.Clear(); Equipped.Clear(); Wear.Clear();
            foreach (var f in Story.Flags) Flags[f.Key] = D.Str(f.Value, "initial");
            foreach (var o in Story.Objects)
            {
                var initial = D.Str(o.Value, "initial");
                if (D.Str(o.Value, "kind") == "object" && initial != "") ObjectStates[o.Key] = initial;
            }
            foreach (var e in D.Map(data, "flags")) Flags[e.Key] = D.Str(data["flags"] as Dictionary<string, object>, e.Key);
            foreach (var e in D.Map(data, "objects")) ObjectStates[e.Key] = D.Str(data["objects"] as Dictionary<string, object>, e.Key);
            foreach (var e in D.Map(data, "chosen")) Chosen[e.Key] = D.Str(data["chosen"] as Dictionary<string, object>, e.Key);
            foreach (var e in D.Map(data, "items")) Items[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var e in D.Map(data, "arcs")) Arcs[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var e in D.Map(data, "skills")) Skills[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var e in D.Map(data, "equipped")) Equipped[e.Key] = D.Str(data["equipped"] as Dictionary<string, object>, e.Key);
            foreach (var e in D.Map(data, "wear")) Wear[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var q in D.List(data, "quests"))
                if (q is Dictionary<string, object> quest && D.Str(quest, "key") != "") Quests[D.Str(quest, "key")] = D.Str(quest, "state");
            void Keys(string field, Action<string> add)
            {
                foreach (var k in D.List(data, field)) if (k is string key) add(key);
            }
            Keys("solved", k => Solved.Add(k)); Keys("visited", k => Visited.Add(k)); Keys("fired", k => Fired.Add(k)); Keys("picked", k => Picked.Add(k)); Keys("won", k => Won.Add(k));
            void Ordered(string field, List<string> list)
            {
                foreach (var k in D.List(data, field)) if (k is string key && !list.Contains(key)) list.Add(key);
            }
            Ordered("met", MetEncounters); Ordered("characters", MetCharacters); Ordered("found", FoundItems); Ordered("locations", VisitedLocations); Ordered("used", UsedObjects); Ordered("lore", KnownLore); Ordered("mechanics", AvailableMechanics);
            foreach (var m in AvailableMechanics) Mechanics.Add(m);
            AutoRules = keepRules;
            Checkpoint(D.Str(data, "at"));
            Loaded = true;
            Changed?.Invoke();
            return checkpointAt;
        }

        void OnChanged()
        {
            Changed?.Invoke();
            if (!AutoRules || settling) return;
            settling = true;
            try { Rules.Settle(this); }
            finally { settling = false; }
        }
    }
}
`,

  'Rules.cs': String.raw`${HEAD}
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>
    /// The conditions and effects VC Game Studio writes as data. A rule is
    /// { match: all|any, items: [conditions or rules] }; an empty rule holds.
    /// </summary>
    public static class Rules
    {
        public static bool Check(object rule, GameState game)
        {
            var r = rule as Dictionary<string, object>;
            if (r == null || r.Count == 0) return true;
            var items = D.List(r, "items");
            if (items.Count == 0) return true;
            var any = D.Str(r, "match") == "any";
            foreach (var item in items)
            {
                var d = D.Map(item);
                var ok = d.ContainsKey("match") ? Check(d, game) : Holds(d, game);
                if (any && ok) return true;
                if (!any && !ok) return false;
            }
            return !any;
        }

        public static bool Holds(Dictionary<string, object> c, GameState game)
        {
            var reference = D.Str(c, "ref");
            var op = D.Str(c, "op");
            switch (D.Str(c, "kind"))
            {
                case "flag": return (game.GetFlag(reference) == D.Str(c, "value")) == (op == "is");
                case "object": return (game.GetObjectState(reference) == D.Str(c, "value")) == (op == "is");
                case "item": return game.HasItem(reference) == (op == "has");
                case "choice":
                    var value = D.Str(c, "value");
                    var picked = game.Chosen.TryGetValue(reference, out var chosen) && (value == "" || chosen == value);
                    return picked == (op == "chose");
                case "arc":
                    var n = game.Arc(reference);
                    var v = (int)D.Num(c, "value");
                    return op == "atLeast" ? n >= v : n <= v;
                case "puzzle": return game.Solved.Contains(reference) == (op == "solved");
                case "visited": return game.Visited.Contains(reference) == (op == "visited");
                case "quest":
                    var state = game.QuestState(reference);
                    return op == "done" ? state == "done" : op == "notDone" ? state != "done" : op == "active" ? state == "active" : state == "";
                case "lore": return game.KnowsLore(reference) == (op == "known");
                case "mechanic": return game.HasMechanic(reference) == (op == "available");
                case "equipped": return game.IsEquipped(reference) == (op == "equipped");
                case "skill":
                    var rank = game.SkillRank(reference);
                    var at = (int)D.Num(c, "value", 1);
                    return op == "atLeast" ? rank >= at : rank < at;
                default: return false;
            }
        }

        public static void Apply(object effects, GameState game)
        {
            foreach (var item in D.List(effects))
            {
                var e = D.Map(item);
                var reference = D.Str(e, "ref");
                switch (D.Str(e, "kind"))
                {
                    case "setFlag": game.SetFlag(reference, D.Str(e, "value")); break;
                    case "setObject": game.SetObjectState(reference, D.Str(e, "value")); break;
                    case "give": game.GiveItem(reference); break;
                    case "take": game.TakeItem(reference); break;
                    case "arc": game.AddArc(reference, (int)D.Num(e, "amount")); break;
                    case "solve": Solve(reference, game); break;
                    case "fire": Fire(reference, game); break;
                    case "startQuest": if (game.QuestState(reference) == "") game.SetQuest(reference, "active"); break;
                    case "revealLore": game.DiscoverLore(reference); break;
                    case "completeQuest": CompleteQuest(reference, game); break;
                    case "enableMechanic": game.EnableMechanic(reference); break;
                    case "learnSkill": GainRank(reference, game); break;
                    case "equip": game.Equip(reference); break;
                    case "unequip": game.Unequip(reference); break;
                }
            }
        }

        public static void Fire(string trigger, GameState game)
        {
            game.Fired.Add(trigger);
            game.Story.Triggers.TryGetValue(trigger, out var t);
            var sets = D.Map(t, "sets");
            if (sets.Count > 0) game.SetFlag(D.Str(sets, "flag"), D.Str(sets, "value"));
            Apply(D.Get(t, "effects"), game);
            game.RaiseTriggerFired(trigger);
        }

        public static void Solve(string puzzle, GameState game)
        {
            if (game.Solved.Contains(puzzle)) return;
            game.MarkSolved(puzzle);
            game.Story.Objects.TryGetValue(puzzle, out var p);
            Apply(D.Get(p, "effects"), game);
        }

        /// <summary>
        /// Fire every trigger, and solve every puzzle, whose rule now holds. A quest
        /// starts when its start rule holds (at once without one) and is done when
        /// its completion rule holds, paying its reward.
        /// </summary>
        public static void Settle(GameState game)
        {
            for (var round = 0; round < 8; round++)
            {
                var moved = false;
                foreach (var l in game.Story.Lore)
                {
                    if (game.KnowsLore(l.Key) || D.Bool(l.Value, "byEffect") || !Check(D.Get(l.Value, "discoveredWhen"), game)) continue;
                    game.DiscoverLore(l.Key);
                    moved = true;
                }
                foreach (var m in game.Story.Mechanics)
                {
                    if (game.HasMechanic(m.Key) || D.Bool(m.Value, "byEffect") || !Check(D.Get(m.Value, "availableWhen"), game)) continue;
                    game.EnableMechanic(m.Key);
                    moved = true;
                }
                foreach (var q in game.Story.Quests)
                {
                    var state = game.QuestState(q.Key);
                    if (state == "" && !D.Bool(q.Value, "byEffect") && Check(D.Get(q.Value, "starts"), game))
                    {
                        game.SetQuest(q.Key, "active");
                        moved = true;
                    }
                    else if (state == "active" && q.Value.ContainsKey("completes") && Check(D.Get(q.Value, "completes"), game))
                    {
                        CompleteQuest(q.Key, game);
                        moved = true;
                    }
                }
                foreach (var t in game.Story.Triggers)
                {
                    if (D.Str(t.Value, "kind") != "trigger" || !t.Value.ContainsKey("rule") || game.Fired.Contains(t.Key) || !Check(D.Get(t.Value, "rule"), game)) continue;
                    Fire(t.Key, game);
                    moved = true;
                }
                foreach (var p in game.Story.Objects)
                {
                    if (D.Str(p.Value, "kind") != "puzzle" || !p.Value.ContainsKey("solvedWhen") || game.Solved.Contains(p.Key) || !Check(D.Get(p.Value, "solvedWhen"), game)) continue;
                    Solve(p.Key, game);
                    moved = true;
                }
                if (!moved) return;
            }
        }

        /// <summary>
        /// Why the next rank of a skill can't be learned now, or "" when it can:
        /// fully learned, a skill to learn first, its conditions, or its cost
        /// (the same words as the studio).
        /// </summary>
        public static string LearnCheck(string skill, GameState game)
        {
            if (!game.Story.Skills.TryGetValue(skill ?? "", out var s)) return "Not a skill.";
            var rank = game.SkillRank(skill);
            var ranks = (int)D.Num(s, "ranks", 1);
            if (rank >= ranks) return ranks > 1 ? "All " + ranks + " ranks learned." : "Learned.";
            var missing = new List<string>();
            foreach (var r in D.List(s, "requires"))
                if (r is string need && game.SkillRank(need) < 1) missing.Add(game.Story.Skills.TryGetValue(need, out var n) ? D.Str(n, "name") : need);
            if (missing.Count > 0) return "Learn " + string.Join(" and ", missing) + " first.";
            if (D.Get(s, "learnWhen") != null && !Check(D.Get(s, "learnWhen"), game)) return "Needs " + D.Str(s, "learnWhenText") + ".";
            var cost = D.Map(s, "cost");
            if (cost.Count > 0)
            {
                var have = game.Items.TryGetValue(D.Str(cost, "item"), out var h) ? h : 0;
                var amount = (int)D.Num(cost, "amount", 1);
                if (have < amount) return "Costs " + amount + " × " + D.Str(cost, "name") + " (you have " + have + ").";
            }
            return "";
        }

        /// <summary>Learn the next rank: pay its cost, gain the rank, do what it does. Returns why not ("" when learned).</summary>
        public static string Learn(string skill, GameState game)
        {
            var why = LearnCheck(skill, game);
            if (why != "") return why;
            var cost = D.Map(game.Story.Skills[skill], "cost");
            if (cost.Count > 0) game.TakeItem(D.Str(cost, "item"), (int)D.Num(cost, "amount", 1));
            GainRank(skill, game);
            return "";
        }

        /// <summary>A rank given (by learning, or an effect): up to its ranks, and what learning it does.</summary>
        public static void GainRank(string skill, GameState game)
        {
            if (!game.Story.Skills.TryGetValue(skill ?? "", out var s) || game.SkillRank(skill) >= (int)D.Num(s, "ranks", 1)) return;
            game.AddSkillRank(skill);
            Apply(D.Get(s, "onLearn"), game);
        }

        /// <summary>Complete a quest now, started or not, and pay its reward (once).</summary>
        public static void CompleteQuest(string quest, GameState game)
        {
            if (game.QuestState(quest) == "done") return;
            game.SetQuest(quest, "done");
            game.Story.Quests.TryGetValue(quest, out var q);
            Apply(D.Get(q, "reward"), game);
        }

        /// <summary>Whether a win against this encounter counts now (its win rule holds).</summary>
        public static bool CanWin(string encounter, GameState game) =>
            Check(D.Get(game.Story.Encounters.TryGetValue(encounter, out var e) ? e : null, "winWhen"), game);

        public static void Win(string encounter, GameState game)
        {
            game.MarkWon(encounter);
            game.Story.Encounters.TryGetValue(encounter, out var e);
            Apply(D.Get(e, "onWin"), game);
        }

        /// <summary>Do a loss's effects; returns what it leads to: "retry", "gameOver" or "carryOn".</summary>
        public static string Lose(string encounter, GameState game)
        {
            game.Story.Encounters.TryGetValue(encounter, out var e);
            Apply(D.Get(e, "onLose"), game);
            var loss = D.Str(e, "loss");
            return loss == "" ? "retry" : loss;
        }

        /// <summary>A gate is open when its rule holds (a gate with no rule is open).</summary>
        public static bool GateOpen(string gate, GameState game) => !game.Story.Triggers.TryGetValue(gate, out var g) || Check(D.Get(g, "rule"), game);

        /// <summary>
        /// Whether an option is in the list and can be picked: gone once picked
        /// (after: gone), locked (after: locked), or hidden until its conditions
        /// hold (hide). Listed is false when it is not in the list at all.
        /// </summary>
        public static void Offer(Dictionary<string, object> option, string key, GameState game, out bool listed, out bool available, out string why)
        {
            var was = game.WasPicked(key);
            var after = D.Str(option, "after");
            listed = true;
            available = true;
            why = "";
            if (was && after == "gone") { listed = false; available = false; return; }
            if (was && after == "locked") { available = false; why = "already chosen"; return; }
            available = Check(D.Get(option, "when"), game);
            if (!available && D.Bool(option, "hide")) { listed = false; return; }
            if (!available) why = "conditions not met";
        }
    }
}
`,

  'Interactions.cs': String.raw`${HEAD}
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>What the player can do with an object, and doing it.</summary>
    public static class Interactions
    {
        public static List<string> AvailableVerbs(GameState game, string obj)
        {
            var verbs = new List<string>();
            if (!game.Story.Objects.TryGetValue(obj, out var o)) return verbs;
            foreach (var item in D.List(o, "interactions"))
            {
                var i = D.Map(item);
                if (Allowed(i, obj, game)) verbs.Add(D.Str(i, "verb"));
            }
            return verbs;
        }

        public static bool Interact(GameState game, string obj, string verb)
        {
            if (!game.Story.Objects.TryGetValue(obj, out var o)) return false;
            foreach (var item in D.List(o, "interactions"))
            {
                var i = D.Map(item);
                if (D.Str(i, "verb") != verb || !Allowed(i, obj, game)) continue;
                game.UseObject(obj);
                var becomes = D.Str(i, "becomes");
                if (becomes != "") game.SetObjectState(obj, becomes);
                var sets = D.Map(i, "sets");
                if (sets.Count > 0) game.SetFlag(D.Str(sets, "flag"), D.Str(sets, "value"));
                var fires = D.Str(i, "fires");
                if (fires != "") Rules.Fire(fires, game);
                Rules.Apply(D.Get(i, "effects"), game);
                return true;
            }
            return false;
        }

        static bool Allowed(Dictionary<string, object> i, string obj, GameState game)
        {
            var when = D.Str(i, "when");
            if (when != "" && when != game.GetObjectState(obj)) return false;
            return Rules.Check(D.Get(i, "requires"), game);
        }
    }
}
`,

  'ScenePlayer.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>
    /// Plays one scene's timeline in order and says what each event needs.
    /// The game answers (shows the line, plays the cinematic, hands back
    /// control) and calls Advance() or Choose() when it is done.
    /// </summary>
    public sealed class ScenePlayer
    {
        public event Action<Dictionary<string, object>> EventStarted;
        public event Action<string> DialogueRequested;
        /// <summary>
        /// Dual dialogue: two lines spoken at the same time, as one beat. Start both
        /// voices together, then call Advance() once. The left-hand speech of the
        /// script comes first. A pair asks for this instead of DialogueRequested.
        /// </summary>
        public event Action<string, string> DualRequested;
        public event Action<string> CinematicRequested;
        public event Action<string> FreePlayStarted;
        public event Action<string, List<string>> ChoiceRequested;
        /// <summary>
        /// An encounter: play it (a fight, a chase), then call Win() or Lose().
        /// The bool says whether a win counts now (its win rule holds).
        /// </summary>
        public event Action<string, bool> EncounterRequested;
        /// <summary>An encounter was lost, and that loss ends the game.</summary>
        public event Action<string> GameOver;
        public event Action<string> SceneFinished;

        /// <summary>Every option in the list now: label, whether it can be picked, and why not.</summary>
        public readonly List<(string label, bool available, string why)> OptionsDetail = new List<(string, bool, string)>();

        public readonly string SceneKey;
        readonly GameState game;
        readonly Dictionary<string, object> scene;
        List<object> track;
        int index = -1;
        int branch = -1;
        readonly List<int> offered = new List<int>();
        object waiting;
        bool listening;

        public ScenePlayer(GameState game, string sceneKey)
        {
            this.game = game;
            SceneKey = sceneKey;
            if (!game.Story.Scenes.TryGetValue(sceneKey, out scene)) throw new ArgumentException("No scene " + sceneKey);
            track = Main;
        }

        List<object> Main => D.List(scene, "main");
        List<object> Branches => D.List(scene, "branches");

        public void Start()
        {
            // What a save keeps: the game as this scene begins.
            game.Checkpoint(SceneKey);
            game.Loaded = false;
            game.Visit(SceneKey);
            game.VisitLocation(D.Str(scene, "location"));
            track = Main;
            index = -1;
            branch = -1;
            Advance();
        }

        /// <summary>Call when the current event is done.</summary>
        public void Advance()
        {
            waiting = null;
            index++;
            if (index >= track.Count)
            {
                if (branch >= 0)
                {
                    var rejoin = D.Get(D.Map(Branches[branch]), "rejoin");
                    branch = -1;
                    track = Main;
                    if (rejoin is double at)
                    {
                        index = (int)at - 1;
                        Advance();
                        return;
                    }
                }
                SceneFinished?.Invoke(NextNode());
                return;
            }
            var ev = D.Map(track[index]);
            if (!Rules.Check(D.Get(ev, "when"), game))
            {
                Advance();
                return;
            }
            // Dual dialogue: this line and the next event's are spoken at once.
            var other = DualAt(index);
            if (other != null)
            {
                index++;
                var line = D.Str(ev, "line");
                var otherLine = D.Str(other, "line");
                var first = D.Str(ev, "dual") == otherLine ? otherLine : line;
                var second = first == line ? otherLine : line;
                var both = new Dictionary<string, object>(ev) { ["line"] = first, ["with"] = second };
                EventStarted?.Invoke(both);
                Rules.Apply(D.Get(ev, "effects"), game);
                Rules.Apply(D.Get(other, "effects"), game);
                game.MeetCharacter(game.Story.Speaker(first));
                game.MeetCharacter(game.Story.Speaker(second));
                DualRequested?.Invoke(first, second);
                return;
            }
            EventStarted?.Invoke(ev);
            var kind = D.Str(ev, "kind");
            if (kind != "choice") Rules.Apply(D.Get(ev, "effects"), game);
            switch (kind)
            {
                case "dialogue": game.MeetCharacter(game.Story.Speaker(D.Str(ev, "line"))); DialogueRequested?.Invoke(D.Str(ev, "line")); break;
                case "cinematic": CinematicRequested?.Invoke(D.Str(ev, "ref")); break;
                case "freePlay":
                    FreePlayStarted?.Invoke(D.Str(ev, "endsWhen"));
                    if (ev.ContainsKey("ends")) AwaitEnd(D.Get(ev, "ends"));
                    break;
                case "choice": ChoiceRequested?.Invoke(D.Str(ev, "ref"), OptionsAt(index)); break;
                case "encounter": if (D.Str(ev, "ref") != "") game.MeetEncounter(D.Str(ev, "ref")); EncounterRequested?.Invoke(D.Str(ev, "ref"), Rules.CanWin(D.Str(ev, "ref"), game)); break;
                case "trigger":
                    // A trigger on the timeline fires as it is reached, and the scene moves on.
                    var reference = D.Str(ev, "ref");
                    if (reference != "") Rules.Fire(reference, game);
                    Advance();
                    break;
            }
        }

        /// <summary>The event after this one, when the two are a dual pair (either way round) and it may be spoken now.</summary>
        Dictionary<string, object> DualAt(int at)
        {
            if (at + 1 >= track.Count) return null;
            var a = D.Map(track[at]);
            var b = D.Map(track[at + 1]);
            if (D.Str(a, "kind") != "dialogue" || D.Str(b, "kind") != "dialogue") return null;
            var paired = (D.Str(b, "dual") != "" && D.Str(b, "dual") == D.Str(a, "line")) || (D.Str(a, "dual") != "" && D.Str(a, "dual") == D.Str(b, "line"));
            return paired && Rules.Check(D.Get(b, "when"), game) ? b : null;
        }

        /// <summary>Call with the option the player picked, as offered: 0 is the first.</summary>
        public void Choose(int option)
        {
            var ev = index >= 0 && index < track.Count ? D.Map(track[index]) : new Dictionary<string, object>();
            var picked = option >= 0 && option < offered.Count ? offered[option] : -1;
            var choice = D.Str(ev, "ref");
            if (picked < 0)
            {
                game.MarkPicked(MainKey(index));
                if (choice != "") game.RememberChoice(choice, D.Str(ev, "mainLabel"));
                Rules.Apply(D.Get(ev, "effects"), game);
                Advance();
                return;
            }
            var b = D.Map(Branches[picked]);
            game.MarkPicked(BranchKey(picked));
            if (choice != "") game.RememberChoice(choice, D.Str(b, "label"));
            Rules.Apply(D.Get(b, "effects"), game);
            branch = picked;
            track = D.List(b, "events");
            index = -1;
            Advance();
        }

        /// <summary>The player won the encounter on now. False (and nothing happens) when a win doesn't count yet.</summary>
        public bool Win()
        {
            var encounter = EncounterNow();
            if (encounter == "" || !Rules.CanWin(encounter, game)) return false;
            Rules.Win(encounter, game);
            Advance();
            return true;
        }

        /// <summary>
        /// The player lost the encounter on now: its loss effects, then it is played
        /// again (EncounterRequested once more), the game is over, or the scene goes on.
        /// </summary>
        public void Lose()
        {
            var encounter = EncounterNow();
            if (encounter == "") return;
            switch (Rules.Lose(encounter, game))
            {
                case "gameOver": GameOver?.Invoke(encounter); break;
                case "carryOn": Advance(); break;
                default: EncounterRequested?.Invoke(encounter, Rules.CanWin(encounter, game)); break;
            }
        }

        string EncounterNow()
        {
            if (index < 0 || index >= track.Count) return "";
            var ev = D.Map(track[index]);
            return D.Str(ev, "kind") == "encounter" ? D.Str(ev, "ref") : "";
        }

        /// <summary>Where the story goes after this scene: the first exit whose conditions hold, else onward.</summary>
        public string NextNode()
        {
            foreach (var e in D.List(scene, "exits"))
            {
                var exit = D.Map(e);
                if (!Rules.Check(D.Get(exit, "when"), game)) continue;
                Rules.Apply(D.Get(exit, "effects"), game);
                return D.Str(exit, "to");
            }
            return D.Str(scene, "onward");
        }

        string MainKey(int at) => SceneKey + ":" + at;
        string BranchKey(int b) => SceneKey + ":b" + b;

        List<string> OptionsAt(int at)
        {
            var ev = D.Map(Main[at]);
            var options = new List<string>();
            offered.Clear();
            OptionsDetail.Clear();
            var main = new Dictionary<string, object> { ["after"] = D.Str(ev, "mainAfter") };
            Rules.Offer(main, MainKey(at), game, out var listed, out var available, out var why);
            if (listed)
            {
                OptionsDetail.Add((D.Str(ev, "mainLabel"), available, why));
                if (available) { options.Add(D.Str(ev, "mainLabel")); offered.Add(-1); }
            }
            var all = Branches;
            for (var i = 0; i < all.Count; i++)
            {
                var b = D.Map(all[i]);
                if ((int)D.Num(b, "from", -1) != at) continue;
                Rules.Offer(b, BranchKey(i), game, out listed, out available, out why);
                if (!listed) continue;
                OptionsDetail.Add((D.Str(b, "label"), available, why));
                if (available) { options.Add(D.Str(b, "label")); offered.Add(i); }
            }
            return options;
        }

        void AwaitEnd(object rule)
        {
            if (Rules.Check(rule, game))
            {
                Advance();
                return;
            }
            waiting = rule;
            if (listening) return;
            listening = true;
            game.Changed += () =>
            {
                if (waiting != null && Rules.Check(waiting, game)) Advance();
            };
        }
    }
}
`,

  'StoryWalker.cs': String.raw`${HEAD}
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>Following the story graph between scenes: routes, choices on the graph, endings.</summary>
    public static class StoryWalker
    {
        /// <summary>Where a node goes: its first route whose conditions hold, else on along the spine.</summary>
        public static string Onward(GameState game, string node)
        {
            if (!game.Story.Graph.TryGetValue(node, out var n)) return "";
            foreach (var r in D.List(n, "routes"))
            {
                var route = D.Map(r);
                if (!Rules.Check(D.Get(route, "when"), game)) continue;
                Rules.Apply(D.Get(route, "effects"), game);
                return D.Str(route, "to");
            }
            return D.Str(n, "onward");
        }

        public static string KindOf(GameState game, string node) => game.Story.Graph.TryGetValue(node, out var n) ? D.Str(n, "kind") : "";

        /// <summary>"ending", "gameOver", or "" when the node goes on.</summary>
        public static string OutcomeOf(GameState game, string node) => game.Story.Graph.TryGetValue(node, out var n) ? D.Str(n, "outcome") : "";

        public static bool ChoiceAvailable(GameState game, string choice) => !game.Story.Choices.TryGetValue(choice, out var c) || Rules.Check(D.Get(c, "available"), game);

        /// <summary>The options of a choice on the graph that can be picked now, as indexes into its options.</summary>
        public static List<int> Offered(GameState game, string choice)
        {
            var list = new List<int>();
            if (!game.Story.Choices.TryGetValue(choice, out var c)) return list;
            var options = D.List(c, "options");
            for (var i = 0; i < options.Count; i++)
            {
                var o = D.Map(options[i]);
                Rules.Offer(o, choice + ":" + D.Str(o, "key"), game, out var listed, out var available, out _);
                if (listed && available) list.Add(i);
            }
            return list;
        }

        public static string OptionLabel(GameState game, string choice, int option) =>
            game.Story.Choices.TryGetValue(choice, out var c) && option >= 0 && option < D.List(c, "options").Count ? D.Str(D.Map(D.List(c, "options")[option]), "label") : "";

        /// <summary>Pick an option: records it, does what it does, and returns where it leads ("" if it can't be picked).</summary>
        public static string Choose(GameState game, string choice, int option)
        {
            if (!Offered(game, choice).Contains(option)) return "";
            var o = D.Map(D.List(game.Story.Choices[choice], "options")[option]);
            game.RememberChoice(choice, D.Str(o, "label"));
            game.MarkPicked(choice + ":" + D.Str(o, "key"));
            Rules.Apply(D.Get(o, "effects"), game);
            return D.Str(o, "to");
        }

        /// <summary>The words of a line and who says them.</summary>
        public static (string speaker, string text, string direction) Line(GameState game, string lineId)
        {
            if (!game.Story.Lines.TryGetValue(lineId ?? "", out var l)) return ("", "", "");
            return (game.Story.CharacterName(D.Str(l, "speaker")), D.Str(l, "text"), D.Str(l, "direction"));
        }
    }
}
`,

  'Codex.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;
using System.Text;

namespace VCGS
{
    /// <summary>
    /// The codex as the player reads it: the quest log (quests under way with
    /// their goals, then those done, in the order they started), the characters
    /// met, locations visited, items found and objects used (those with a codex entry), the mechanics
    /// available, the encounters met (with their enemies and weakness, and
    /// whether they were won) and the lore found, in the order found. New counts
    /// what has happened since the codex was last read (quests starting or
    /// completing, characters met, locations visited, items found, objects used, mechanics, encounters met or won, lore found), for a
    /// "new" badge. Plain C#: VcgsCodex draws it, or use it in your own UI.
    /// </summary>
    public sealed class Codex
    {
        readonly GameState game;
        int seen;

        public Codex(GameState game)
        {
            this.game = game;
            seen = Progress();
        }

        /// <summary>Quest, mechanic, encounter and lore updates since MarkRead (a new game starts from nothing).</summary>
        public int New
        {
            get
            {
                var now = Progress();
                if (now < seen) seen = 0;
                return now - seen;
            }
        }

        public void MarkRead() => seen = Progress();

        int Progress()
        {
            var n = game.KnownLore.Count + game.AvailableMechanics.Count + game.MetEncounters.Count + game.Won.Count;
            foreach (var k in game.Skills) if (game.Story.Skills.ContainsKey(k.Key)) n += k.Value;
            foreach (var c in game.MetCharacters) if (game.Story.CharacterCodex(c) != "") n++;
            foreach (var i in game.FoundItems) if (game.Story.ItemCodex(i) != "") n++;
            foreach (var l in game.VisitedLocations) if (game.Story.LocationCodex(l) != "") n++;
            foreach (var o in game.UsedObjects) if (game.Story.ObjectCodex(o) != "") n++;
            foreach (var state in game.Quests.Values) n += state == "done" ? 2 : 1;
            return n;
        }

        /// <summary>Every section a codex can have, in the order it shows them.</summary>
        public static readonly string[] Sections = { "quests", "characters", "locations", "items", "objects", "mechanics", "skills", "encounters", "lore" };

        /// <summary>The sections this story's codex has (those with anything to find), in order: what a filter by section offers.</summary>
        public List<string> SectionKeys()
        {
            var s = game.Story;
            bool Any(Dictionary<string, Dictionary<string, object>> all, Func<string, string> entry) { foreach (var k in all.Keys) if (entry(k) != "") return true; return false; }
            var has = new[]
            {
                s.Quests.Count > 0, Any(s.Characters, s.CharacterCodex), Any(s.LocationDefs, s.LocationCodex), Any(s.ItemDefs, s.ItemCodex),
                Any(s.Objects, s.ObjectCodex), s.Mechanics.Count > 0, s.Skills.Count > 0, s.Encounters.Count > 0, s.Lore.Count > 0,
            };
            var keys = new List<string>();
            for (var i = 0; i < Sections.Length; i++) if (has[i]) keys.Add(Sections[i]);
            return keys;
        }

        /// <summary>Quests under way, each with its goal, in the order they started.</summary>
        public List<(string name, string goal)> UnderWay()
        {
            var list = new List<(string, string)>();
            foreach (var q in game.Quests)
                if (q.Value != "done") list.Add((QuestName(q.Key), QuestGoal(q.Key)));
            return list;
        }

        /// <summary>Quests done, in the order they started.</summary>
        public List<string> Done()
        {
            var list = new List<string>();
            foreach (var q in game.Quests)
                if (q.Value == "done") list.Add(QuestName(q.Key));
            return list;
        }

        string QuestName(string key) => game.Story.Quests.TryGetValue(key, out var q) ? D.Str(q, "name") : key;
        string QuestGoal(string key) => game.Story.Quests.TryGetValue(key, out var q) ? D.Str(D.Map(q, "fields"), "goal") : "";

        /// <summary>
        /// The whole codex in words, the same as Godot's placeholder scenes show it.
        /// With a search, only the entries it finds (ignoring case), in the sections
        /// that have any; the headings still count everything. With a section
        /// ("quests", "lore"…, as SectionKeys lists them), only that one. With a
        /// sort ("found", the default; "newest"; "name", A–Z ignoring case), each
        /// section in that order (quests under way still before those done).
        /// An entry the player has a note on ends with it ("Note: …"), and a
        /// search looks in the notes too. A bookmarked entry ends its first line with ★; the section
        /// "bookmarks" shows only them. The cursor entry (a key, "lore:…")
        /// starts with ▶.
        /// </summary>
        public string Text(string query = "", string section = "", string sort = "", string cursor = "")
        {
            var q = (query ?? "").Trim();
            var only = section ?? "";
            var parts = new List<string>();
            shownKeys.Clear();
            titles.Clear();
            List<(string key, string text)> Sorted(List<(string key, string text)> entries)
            {
                var list = new List<(string key, string text)>(entries);
                if (sort == "newest") list.Reverse();
                else if (sort == "name") list.Sort((a, b) => string.CompareOrdinal(a.text.ToLowerInvariant(), b.text.ToLowerInvariant()));
                return list;
            }
            void Section(string key, string heading, List<(string key, string text)> entries, string sep, string empty)
            {
                if (only == "bookmarks")
                {
                    entries = entries.FindAll(e => game.IsBookmarked(e.key));
                    if (entries.Count == 0) return;
                }
                else if (only != "" && only != key) return;
                if (key != "quests") entries = Sorted(entries);
                var shown = q == "" ? entries : entries.FindAll(e => e.text.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 || game.NoteFor(e.key).IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0);
                if (q != "" && shown.Count == 0) return;
                var text = new System.Text.StringBuilder(heading);
                if (shown.Count == 0) text.Append("\n" + empty);
                foreach (var e in shown)
                {
                    var words = e.text;
                    if (game.IsBookmarked(e.key))
                    {
                        var nl = words.IndexOf('\n');
                        words = nl >= 0 ? words.Insert(nl, " ★") : words + " ★";
                    }
                    if (e.key == cursor) words = "▶ " + words;
                    if (game.NoteFor(e.key) != "") words += "\nNote: " + game.NoteFor(e.key);
                    text.Append(sep + words);
                    shownKeys.Add(e.key);
                    var first = e.text.Split('\n')[0];
                    titles[e.key] = key.ToUpperInvariant() + " · " + (first.StartsWith("• ") ? first.Substring(2) : first);
                }
                parts.Add(text.ToString());
            }
            string Title(string name, string key) => (name == "" ? key : name).ToUpperInvariant();
            if (game.Story.Quests.Count > 0)
            {
                var underWay = new List<(string key, string text)>();
                var finished = new List<(string key, string text)>();
                foreach (var quest in game.Quests)
                {
                    var goal = QuestGoal(quest.Key);
                    if (quest.Value != "done") underWay.Add(("quests:" + quest.Key, "• " + QuestName(quest.Key) + (goal != "" ? " — " + goal : "")));
                    else finished.Add(("quests:" + quest.Key, "• " + QuestName(quest.Key) + " (done)"));
                }
                var lines = Sorted(underWay);
                lines.AddRange(Sorted(finished));
                Section("quests", "QUESTS · " + underWay.Count + " under way, " + finished.Count + " done", lines, "\n", "None yet.");
            }
            var withEntry = 0;
            foreach (var c in game.Story.Characters.Keys) if (game.Story.CharacterCodex(c) != "") withEntry++;
            if (withEntry > 0)
            {
                var cast = new List<(string key, string text)>();
                foreach (var key in game.MetCharacters)
                    if (game.Story.CharacterCodex(key) != "") cast.Add(("characters:" + key, Title(game.Story.CharacterName(key), key) + "\n" + game.Story.CharacterCodex(key)));
                Section("characters", "CHARACTERS · " + cast.Count + " of " + withEntry + " met", cast, "\n\n", "None yet.");
            }
            var locationsWithEntry = 0;
            foreach (var l in game.Story.LocationDefs.Keys) if (game.Story.LocationCodex(l) != "") locationsWithEntry++;
            if (locationsWithEntry > 0)
            {
                var places = new List<(string key, string text)>();
                foreach (var key in game.VisitedLocations)
                    if (game.Story.LocationCodex(key) != "") places.Add(("locations:" + key, Title(game.Story.LocationName(key), key) + "\n" + game.Story.LocationCodex(key)));
                Section("locations", "LOCATIONS · " + places.Count + " of " + locationsWithEntry + " visited", places, "\n\n", "None yet.");
            }
            var itemsWithEntry = 0;
            foreach (var i in game.Story.ItemDefs.Keys) if (game.Story.ItemCodex(i) != "") itemsWithEntry++;
            if (itemsWithEntry > 0)
            {
                var things = new List<(string key, string text)>();
                foreach (var key in game.FoundItems)
                {
                    if (game.Story.ItemCodex(key) == "") continue;
                    var count = game.Items.TryGetValue(key, out var n) ? n : 0;
                    things.Add(("items:" + key, Title(game.Story.ItemName(key), key) + (count > 1 ? " (carried ×" + count + ")" : count == 1 ? " (carried)" : "") + "\n" + game.Story.ItemCodex(key)));
                }
                Section("items", "ITEMS · " + things.Count + " of " + itemsWithEntry + " found", things, "\n\n", "None yet.");
            }
            var objectsWithEntry = 0;
            foreach (var o in game.Story.Objects.Keys) if (game.Story.ObjectCodex(o) != "") objectsWithEntry++;
            if (objectsWithEntry > 0)
            {
                var props = new List<(string key, string text)>();
                foreach (var key in game.UsedObjects)
                {
                    if (game.Story.ObjectCodex(key) == "") continue;
                    game.Story.Objects.TryGetValue(key, out var o);
                    var now = game.GetObjectState(key);
                    props.Add(("objects:" + key, Title(D.Str(o, "name"), key) + (now != "" ? " (" + now + ")" : "") + "\n" + game.Story.ObjectCodex(key)));
                }
                Section("objects", "OBJECTS · " + props.Count + " of " + objectsWithEntry + " used", props, "\n\n", "None yet.");
            }
            if (game.Story.Mechanics.Count > 0)
            {
                var usable = new List<(string key, string text)>();
                foreach (var key in game.AvailableMechanics)
                {
                    game.Story.Mechanics.TryGetValue(key, out var m);
                    var controls = game.Story.MechanicDetail(key, "controls");
                    usable.Add(("mechanics:" + key, Title(D.Str(m, "name"), key) + (controls != "" ? "\nControls: " + controls : "") + "\n" + D.Str(m, "notes")));
                }
                Section("mechanics", "MECHANICS · " + usable.Count + " of " + game.Story.Mechanics.Count + " available", usable, "\n\n", "None yet.");
            }
            if (game.Story.Skills.Count > 0)
            {
                // Each skill learned, in the order first learned: its rank (of more than one), kind and tree, and what it does.
                var learned = new List<(string key, string text)>();
                foreach (var pair in game.Skills)
                {
                    if (pair.Value < 1 || !game.Story.Skills.TryGetValue(pair.Key, out var k)) continue;
                    var fields = D.Map(k, "fields");
                    var ranks = (int)D.Num(k, "ranks", 1);
                    var kind = D.Str(fields, "kind");
                    if (kind != "Ability" && kind != "Upgrade") kind = "Skill";
                    var tree = D.Str(fields, "tree");
                    var does = D.Str(fields, "effect");
                    learned.Add(("skills:" + pair.Key, Title(D.Str(k, "name"), pair.Key) + (ranks > 1 ? " (rank " + pair.Value + " of " + ranks + ")" : "") + "\n" + kind + (tree != "" ? " · " + tree : "") + (does != "" ? "\nWhat it does: " + does : "") + "\n" + D.Str(k, "notes")));
                }
                Section("skills", "SKILLS · " + learned.Count + " of " + game.Story.Skills.Count + " learned", learned, "\n\n", "None yet.");
            }
            if (game.Story.Encounters.Count > 0)
            {
                var won = 0;
                var faced = new List<(string key, string text)>();
                foreach (var key in game.MetEncounters)
                {
                    game.Story.Encounters.TryGetValue(key, out var e);
                    var enemies = D.Str(D.Map(e, "fields"), "enemies");
                    var weakness = D.Str(D.Map(e, "fields"), "weakness");
                    if (game.WasWon(key)) won++;
                    faced.Add(("encounters:" + key, Title(D.Str(e, "name"), key) + (game.WasWon(key) ? " (won)" : "") + (enemies != "" ? "\nEnemies: " + enemies : "") + (weakness != "" ? "\nWeak to: " + weakness : "") + "\n" + D.Str(e, "notes")));
                }
                Section("encounters", "ENCOUNTERS · " + faced.Count + " met, " + won + " won", faced, "\n\n", "None yet.");
            }
            if (game.Story.Lore.Count > 0)
            {
                var found = new List<(string key, string text)>();
                foreach (var key in game.KnownLore)
                {
                    var (name, text) = game.Story.LoreEntry(key);
                    found.Add(("lore:" + key, Title(name, key) + "\n" + text));
                }
                Section("lore", "LORE · " + found.Count + " of " + game.Story.Lore.Count + " found", found, "\n\n", "Nothing found yet.");
            }
            if (q != "" && parts.Count == 0) return "CODEX\n\nNothing matches \"" + q + "\"" + (Array.IndexOf(Sections, only) >= 0 || only == "bookmarks" ? " in " + char.ToUpperInvariant(only[0]) + only.Substring(1) : "") + ".";
            if (only == "bookmarks" && parts.Count == 0) return "CODEX\n\nNo bookmarks yet.";
            return "CODEX\n\n" + string.Join("\n\n", parts);
        }

        readonly List<string> shownKeys = new List<string>();
        readonly Dictionary<string, string> titles = new Dictionary<string, string>();

        /// <summary>
        /// An entry's name as notes are matched by: its first line without the
        /// quest bullet, a quest's goal, or states in brackets ("(won)",
        /// "(carried ×2)"), ignoring case.
        /// </summary>
        public static string NameOf(string firstLine)
        {
            var name = (firstLine ?? "").Trim();
            if (name.StartsWith("• ")) name = name.Substring(2);
            var dash = name.IndexOf(" — ", StringComparison.Ordinal);
            if (dash >= 0) name = name.Substring(0, dash);
            while (name.EndsWith(")"))
            {
                var open = name.LastIndexOf(" (", StringComparison.Ordinal);
                if (open < 0 || name.IndexOf('(', open + 2) >= 0) break;
                name = name.Substring(0, open);
            }
            return name.Trim().ToLowerInvariant();
        }

        /// <summary>
        /// Read notes exported from a codex (this one's, the studio's or another
        /// engine's): each "SECTION · entry" block is matched to an entry here by
        /// section and name. Returns the notes matched, by key, and the headings
        /// that match nothing here (not in the codex yet, or another story's).
        /// </summary>
        public (Dictionary<string, string> notes, List<string> skipped) NotesFrom(string text)
        {
            Text();
            var byName = new Dictionary<string, string>();
            foreach (var t in titles)
            {
                var at = t.Value.IndexOf(" · ", StringComparison.Ordinal);
                byName[t.Value.Substring(0, at).ToLowerInvariant() + "|" + NameOf(t.Value.Substring(at + 3))] = t.Key;
            }
            var notes = new Dictionary<string, string>();
            var skipped = new List<string>();
            var blocks = new List<List<string>> { new List<string>() };
            foreach (var line in (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
                if (line.Trim() == "") blocks.Add(new List<string>());
                else blocks[blocks.Count - 1].Add(line);
            foreach (var lines in blocks)
            {
                if (lines.Count == 0) continue;
                var head = lines[0];
                var at = head.IndexOf(" · ", StringComparison.Ordinal);
                if (at < 0 || head.StartsWith("CODEX NOTES")) continue;
                var note = string.Join("\n", lines.GetRange(1, lines.Count - 1)).Trim();
                if (note == "") continue;
                if (byName.TryGetValue(head.Substring(0, at).Trim().ToLowerInvariant() + "|" + NameOf(head.Substring(at + 3)), out var key)) notes[key] = note;
                else skipped.Add(head.Trim());
            }
            return (notes, skipped);
        }

        /// <summary>Import exported notes: the notes matched are set (the others stay). Returns what NotesFrom does.</summary>
        public (Dictionary<string, string> notes, List<string> skipped) ImportNotes(string text)
        {
            var read = NotesFrom(text);
            foreach (var n in read.notes) game.SetNote(n.Key, n.Value);
            return read;
        }

        /// <summary>
        /// The player's notes in words, to export: each entry with a note, in
        /// the codex's order, under "SECTION · the entry's first line" (the
        /// same as the studio's play-through exports).
        /// </summary>
        public string NotesText()
        {
            Text();
            var parts = new List<string> { "CODEX NOTES · " + game.Story.Name };
            foreach (var key in shownKeys)
                if (game.NoteFor(key) != "") parts.Add(titles[key] + "\n" + game.NoteFor(key));
            if (parts.Count == 1) parts.Add("No notes yet.");
            return string.Join("\n\n", parts);
        }

        /// <summary>The style of the printable notes page (the same as the studio's).</summary>
        public const string PrintStyle = ${JSON.stringify(NOTES_PRINT_STYLE)};

        /// <summary>
        /// The notes as a page to print: the story's name, then each section's
        /// notes under its name, entry by entry (the same page as the studio's
        /// play-through prints).
        /// </summary>
        public string NotesPage() => PageOf(NotesText());

        /// <summary>Exported notes (NotesText) as a page to print.</summary>
        public static string PageOf(string notesText)
        {
            static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
            var blocks = notesText.Replace("\r\n", "\n").Replace("\r", "\n").Split(new[] { "\n\n" }, StringSplitOptions.None);
            var name = blocks[0].StartsWith("CODEX NOTES · ") ? blocks[0].Substring("CODEX NOTES · ".Length) : blocks[0];
            var body = new List<string>();
            var section = "";
            for (var i = 1; i < blocks.Length; i++)
            {
                var lines = blocks[i].Split('\n');
                var at = lines[0].IndexOf(" · ", StringComparison.Ordinal);
                if (at < 0)
                {
                    body.Add("<p>" + Esc(blocks[i]) + "</p>");
                    continue;
                }
                var s = lines[0].Substring(0, at);
                if (s != section) body.Add("<h2>" + Esc(s.Substring(0, Math.Min(1, s.Length)) + s.Substring(Math.Min(1, s.Length)).ToLowerInvariant()) + "</h2>");
                section = s;
                var rest = new List<string>();
                for (var j = 1; j < lines.Length; j++) rest.Add(Esc(lines[j]));
                body.Add("<div class=\"note\"><h3>" + Esc(lines[0].Substring(at + 3)) + "</h3><p>" + string.Join("<br>", rest) + "</p></div>");
            }
            return "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>" + Esc(name) + " · codex notes</title><style>" + PrintStyle + "</style></head>\n<body><h1>" + Esc(name) + "</h1><p class=\"sub\">Codex notes</p>\n" + string.Join("\n", body) + "\n</body></html>\n";
        }

        /// <summary>The longest mail link written; longer ones are cut short by some mail apps.</summary>
        public const int MailtoLimit = ${MAILTO_LIMIT};
        /// <summary>A mail's body when the notes are too long for its link (they go on the clipboard).</summary>
        public const string MailOnClipboard = ${JSON.stringify(MAIL_ON_CLIPBOARD)};

        /// <summary>
        /// The notes as a mail link, for the mail app: "&lt;story&gt; codex notes"
        /// and the notes (the same link as the studio's). Whole is false when
        /// they are too long for a link: then the mail says they are on the clipboard.
        /// </summary>
        public (string url, bool whole) NotesMailto() => MailtoOf(NotesText());

        /// <summary>Percent-encoded as a mail or text link wants (UTF-8; letters, digits and - _ . ~ as they are).</summary>
        static string UriEncode(string s)
        {
            var sb = new StringBuilder();
            foreach (var b in Encoding.UTF8.GetBytes(s))
            {
                var c = (char)b;
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') sb.Append(c);
                else sb.Append('%').Append(b.ToString("X2"));
            }
            return sb.ToString();
        }

        /// <summary>A link of head and body, or (not whole) of head and the clipboard note when that is too long.</summary>
        static (string url, bool whole) LinkOf(string head, string body)
        {
            var url = head + UriEncode(body);
            return url.Length <= MailtoLimit ? (url, true) : (head + UriEncode(MailOnClipboard), false);
        }

        /// <summary>Exported notes (NotesText) as a mail link.</summary>
        public static (string url, bool whole) MailtoOf(string notesText)
        {
            var text = notesText.Replace("\r\n", "\n").Replace("\r", "\n");
            var first = text.Split('\n')[0];
            return LinkOf("mailto:?subject=" + UriEncode((first.StartsWith("CODEX NOTES · ") ? first.Substring("CODEX NOTES · ".Length) : first) + " codex notes") + "&body=", text.Replace("\n", "\r\n"));
        }

        /// <summary>
        /// The notes as a text-message link (sms:), for the messages app: the
        /// notes as the message (the same link as the studio's). Too long for
        /// a link, as NotesMailto.
        /// </summary>
        public (string url, bool whole) NotesSms() => SmsOf(NotesText());

        /// <summary>Exported notes (NotesText) as a text-message link.</summary>
        public static (string url, bool whole) SmsOf(string notesText) => LinkOf("sms:?&body=", notesText.Replace("\r\n", "\n").Replace("\r", "\n"));

        /// <summary>The entries shown, in order, by key ("lore:…"): what a cursor moves through.</summary>
        public List<string> EntryKeys(string query = "", string section = "", string sort = "")
        {
            Text(query, section, sort);
            return new List<string>(shownKeys);
        }
    }
}
`,
  'VcgsCodex.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// A codex screen to try the story with before the game has its own: a
    /// Codex button in the top corner (it counts what is new) and a panel with
    /// everything found so far, and a search box over it. Put it next to
    /// VcgsGame; press C (or the button) to open it, C or Escape to close, and
    /// / to search (Escape clears the search, then leaves the box), Tab
    /// (or the row of buttons) to show one section, and S (or the sort buttons)
    /// to order each section; the arrows move a cursor (▶) and B bookmarks
    /// the entry it is on (★Bookmarks shows only those), N writes a note on it,
    /// E saves every note as a text file, I reads them back, Y copies them to
    /// share them, V takes in notes someone shared, M emails them, T texts
    /// them, and P opens them as a page to print. F5 saves the game and F9
    /// loads it (VcgsGame.SaveGame / LoadGame). Drawn with
    /// Unity's immediate-mode GUI, so it needs no canvas or prefab.
    /// </summary>
    public sealed class VcgsCodex : MonoBehaviour
    {
        [Tooltip("The key that opens and closes the codex.")]
        [SerializeField] KeyCode key = KeyCode.C;

        public bool IsOpen { get; private set; }
        /// <summary>The codex behind the screen, for your own UI (null until VcgsGame has a story).</summary>
        public Codex Book => book ?? (VcgsGame.Instance != null && VcgsGame.Instance.State != null ? book = new Codex(VcgsGame.Instance.State) : null);

        /// <summary>What the search box holds: the codex shows only the entries it finds ("" for everything).</summary>
        public string Search { get; set; } = "";
        /// <summary>The section the codex is filtered to ("" for all of them; Tab picks the next).</summary>
        public string Section { get; set; } = "";
        /// <summary>The entry the cursor (▶) is on, by key ("lore:…"): the arrows move it, B bookmarks it.</summary>
        public string Cursor { get; set; } = "";

        /// <summary>Move the cursor to the next entry shown (step 1) or the one before (-1).</summary>
        public void MoveCursor(int step)
        {
            if (Book == null) return;
            var keys = Book.EntryKeys(Search, Section, Sort);
            if (keys.Count == 0) { Cursor = ""; return; }
            var at = keys.IndexOf(Cursor);
            Cursor = keys[at < 0 ? 0 : Math.Max(0, Math.Min(keys.Count - 1, at + step))];
        }

        /// <summary>The note being written on the entry under the cursor (N opens it, Enter keeps it, Escape leaves it), or null.</summary>
        public string NoteDraft { get; private set; }

        /// <summary>Start a note on the entry under the cursor (the first shown, if none).</summary>
        public void EditNote()
        {
            if (Book == null || VcgsGame.Instance == null) return;
            if (!Book.EntryKeys(Search, Section, Sort).Contains(Cursor)) MoveCursor(0);
            if (Cursor != "") NoteDraft = VcgsGame.Instance.State.NoteFor(Cursor);
        }

        /// <summary>Keep the note on the entry under the cursor ("" takes it off).</summary>
        public void KeepNote(string text)
        {
            if (VcgsGame.Instance != null && Cursor != "") VcgsGame.Instance.State.SetNote(Cursor, text);
            NoteDraft = null;
            SyncNotes();
        }

        /// <summary>What just happened, shown under the codex (the notes saved, say).</summary>
        public string Status { get; private set; } = "";

        /// <summary>Save the game (F5; VcgsGame.SaveGame), and say so. Returns where, or "".</summary>
        public string SaveGame(string path = null)
        {
            if (VcgsGame.Instance == null) return "";
            var where = VcgsGame.Instance.SaveGame(path);
            Status = where != "" ? "Saved (F9 loads it): " + where : "Could not save the game.";
            return where;
        }

        /// <summary>Load the saved game (F9; VcgsGame.LoadGame), and say so. Returns the scene key it plays on from, or null.</summary>
        public string LoadGame(string path = null)
        {
            if (VcgsGame.Instance == null) return null;
            var at = VcgsGame.Instance.LoadGame(path);
            var name = at != null && VcgsGame.Instance.Story.Scenes.TryGetValue(at, out var scene) ? D.Str(scene, "name") : "";
            Status = at == null ? "No saved game at " + (path ?? VcgsGame.DefaultSavePath) : "Loaded: playing on from " + (at == "" ? "the beginning" : name != "" ? name : at) + ".";
            return at;
        }

        /// <summary>
        /// Email the notes (M): open the mail app with them; too long for a
        /// mail link, they go on the clipboard first. Returns the link ("" with no game).
        /// </summary>
        public string EmailNotes(bool open = true)
        {
            if (Book == null) return "";
            var (url, whole) = Book.NotesMailto();
            if (!whole) GUIUtility.systemCopyBuffer = Book.NotesText();
            if (open) Application.OpenURL(url);
            Status = whole ? "Opening your mail app with the notes." : "The notes are too long for a mail link: they are on the clipboard. Paste them into the mail.";
            return url;
        }

        /// <summary>
        /// Text the notes (T): open the messages app with them; too long for a
        /// text link, they go on the clipboard first. Returns the link ("" with no game).
        /// </summary>
        public string TextNotes(bool open = true)
        {
            if (Book == null) return "";
            var (url, whole) = Book.NotesSms();
            if (!whole) GUIUtility.systemCopyBuffer = Book.NotesText();
            if (open) Application.OpenURL(url);
            Status = whole ? "Opening your messages app with the notes." : "The notes are too long for a text link: they are on the clipboard. Paste them into the message.";
            return url;
        }

        /// <summary>
        /// Print the notes (P): save them as a page and open it, to print from
        /// the browser. Returns where, or "" if it could not.
        /// </summary>
        public string PrintNotes(string path = null, bool open = true)
        {
            if (Book == null) return "";
            path = path ?? System.IO.Path.Combine(Application.persistentDataPath, "codex_notes.html");
            try
            {
                System.IO.File.WriteAllText(path, Book.NotesPage());
                if (open) Application.OpenURL(new Uri(path).AbsoluteUri);
                Status = "Notes page opened to print: " + path;
                return path;
            }
            catch (Exception)
            {
                Status = "Could not save the notes page.";
                return "";
            }
        }

        /// <summary>Save every note as a text file (E); returns where, or "" if it could not.</summary>
        public string ExportNotes(string path = null)
        {
            if (Book == null) return "";
            path = path ?? System.IO.Path.Combine(Application.persistentDataPath, "codex_notes.txt");
            try
            {
                System.IO.File.WriteAllText(path, Book.NotesText());
                Status = "Notes saved to " + path;
                return path;
            }
            catch (Exception)
            {
                Status = "Could not save the notes.";
                return "";
            }
        }

        /// <summary>
        /// Where the codex notes sync: the notes are merged with this file (the newer note wins)
        /// when the codex opens, every few seconds while it is open, and after each note. Put it
        /// in a folder that syncs (a cloud drive, Steam Cloud) to share them across devices;
        /// empty turns syncing off. Null: codex_notes_sync.json in persistentDataPath.
        /// </summary>
        public string SyncPath { get; set; }

        DateTime lastSync = DateTime.MinValue;

        /// <summary>Sync the notes with the sync file: merge it in, and write the result back. Returns how many notes the file changed here, or -1 when it could not sync.</summary>
        public int SyncNotes()
        {
            lastSync = DateTime.UtcNow;
            if (Book == null || VcgsGame.Instance == null || SyncPath == "") return -1;
            var path = SyncPath ?? System.IO.Path.Combine(Application.persistentDataPath, "codex_notes_sync.json");
            try
            {
                var state = VcgsGame.Instance.State;
                var changed = System.IO.File.Exists(path) ? Math.Max(0, state.SyncNotes(System.IO.File.ReadAllText(path))) : 0;
                var text = state.NotesSyncText(state.Story.Name);
                if (!System.IO.File.Exists(path) || System.IO.File.ReadAllText(path) != text) System.IO.File.WriteAllText(path, text);
                if (changed > 0) Status = "Notes synced: " + changed + " changed elsewhere.";
                return changed;
            }
            catch (Exception)
            {
                return -1;
            }
        }

        /// <summary>Share the notes (Y): put them on the clipboard, as the text the export writes. Returns it.</summary>
        public string ShareNotes()
        {
            if (Book == null) return "";
            var text = Book.NotesText();
            GUIUtility.systemCopyBuffer = text;
            Status = "Notes copied: paste them to share them (V takes them in, in another codex).";
            return text;
        }

        /// <summary>Take in notes someone shared (V): read them from the clipboard.</summary>
        public void PasteNotes()
        {
            if (Book == null) return;
            var read = Book.ImportNotes(GUIUtility.systemCopyBuffer ?? "");
            Status = "Imported " + read.notes.Count + " notes" + (read.skipped.Count > 0 ? ". Not in the codex (yet): " + string.Join("; ", read.skipped) : "");
        }

        /// <summary>Import notes from a text file (I; the one E saves when no path); false if it could not be read.</summary>
        public bool ImportNotes(string path = null)
        {
            if (Book == null) return false;
            path = path ?? System.IO.Path.Combine(Application.persistentDataPath, "codex_notes.txt");
            try
            {
                var read = Book.ImportNotes(System.IO.File.ReadAllText(path));
                Status = "Imported " + read.notes.Count + " notes" + (read.skipped.Count > 0 ? ". Not in the codex (yet): " + string.Join("; ", read.skipped) : "");
                return true;
            }
            catch (Exception)
            {
                Status = "No notes file at " + path;
                return false;
            }
        }

        /// <summary>Bookmark the entry under the cursor (the first shown, if none), or take its bookmark off.</summary>
        public void ToggleBookmark()
        {
            if (Book == null || VcgsGame.Instance == null) return;
            if (!Book.EntryKeys(Search, Section, Sort).Contains(Cursor)) MoveCursor(0);
            if (Cursor != "") VcgsGame.Instance.State.ToggleBookmark(Cursor);
        }

        /// <summary>How each section is ordered: "found", "newest" or "name" (A–Z; S picks the next).</summary>
        public string Sort { get; set; } = "found";

        static readonly string[] Sorts = { "found", "newest", "name" };
        static readonly string[] SortNames = { "Order found", "Newest first", "A–Z" };

        const string SearchControl = "vcgs-codex-search";
        Codex book;
        Vector2 scroll;
        GUIStyle text;

        public void Open()
        {
            if (Book == null) return;
            IsOpen = true;
            Book.MarkRead();
            SyncNotes();
        }

        public void Close() => IsOpen = false;

        public void Toggle()
        {
            if (IsOpen) Close();
            else Open();
        }

        /// <summary>All, then each section this story's codex has.</summary>
        List<string> Options()
        {
            var options = new List<string> { "", "bookmarks" };
            options.AddRange(Book.SectionKeys());
            return options;
        }

        /// <summary>What the button says: "Codex (C)", or with how many are new.</summary>
        public string ButtonText() => Book == null ? "" : Book.New > 0 ? "Codex (" + key + ") · " + Book.New + " new" : "Codex (" + key + ")";

        void OnGUI()
        {
            if (Book == null) return;
            var e = Event.current;
            var typing = GUI.GetNameOfFocusedControl() == SearchControl;
            if (NoteDraft != null && e.type == EventType.KeyDown && (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.Escape))
            {
                if (e.keyCode == KeyCode.Return) KeepNote(NoteDraft);
                else NoteDraft = null;
                e.Use();
            }
            typing = typing || NoteDraft != null;
            if (e.type == EventType.KeyDown && typing && e.keyCode == KeyCode.Escape)
            {
                // Escape clears the search, then leaves the box.
                if (Search != "") Search = "";
                else GUI.FocusControl("");
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.Slash)
            {
                GUI.FocusControl(SearchControl);
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && (e.keyCode == KeyCode.UpArrow || e.keyCode == KeyCode.DownArrow))
            {
                MoveCursor(e.keyCode == KeyCode.DownArrow ? 1 : -1);
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && (e.keyCode == KeyCode.F5 || e.keyCode == KeyCode.F9))
            {
                if (e.keyCode == KeyCode.F5) SaveGame();
                else LoadGame();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.Y)
            {
                ShareNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.M)
            {
                EmailNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.T)
            {
                TextNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.P)
            {
                PrintNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.V)
            {
                PasteNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.I)
            {
                ImportNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.E)
            {
                ExportNotes();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.N)
            {
                EditNote();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.B)
            {
                ToggleBookmark();
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.S)
            {
                Sort = Sorts[(Math.Max(0, Array.IndexOf(Sorts, Sort)) + 1) % Sorts.Length];
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && IsOpen && e.keyCode == KeyCode.Tab)
            {
                var options = Options();
                Section = options[(options.IndexOf(Section ?? "") + (e.shift ? -1 : 1) + options.Count) % options.Count];
                e.Use();
            }
            else if (e.type == EventType.KeyDown && !typing && (e.keyCode == key || (IsOpen && e.keyCode == KeyCode.Escape)))
            {
                Toggle();
                e.Use();
            }
            if (GUI.Button(new Rect(Screen.width - 210, 10, 200, 30), ButtonText())) Toggle();
            if (!IsOpen) return;
            Book.MarkRead();
            if (e.type == EventType.Repaint && (DateTime.UtcNow - lastSync).TotalSeconds >= 3) SyncNotes();
            if (text == null) text = new GUIStyle(GUI.skin.label) { wordWrap = true, fontSize = 16 };
            var area = new Rect(60, 50, Screen.width - 120, Screen.height - 100);
            GUI.Box(area, "");
            GUILayout.BeginArea(new Rect(area.x + 18, area.y + 18, area.width - 36, area.height - 36));
            GUI.SetNextControlName(SearchControl);
            Search = GUILayout.TextField(Search ?? "");
            var sections = Options();
            if (sections.Count > 3)
            {
                var names = sections.ConvertAll(k => k == "" ? "All" : k == "bookmarks" ? "★ Bookmarks" : char.ToUpperInvariant(k[0]) + k.Substring(1)).ToArray();
                Section = sections[GUILayout.Toolbar(Math.Max(0, sections.IndexOf(Section ?? "")), names)];
            }
            Sort = Sorts[GUILayout.Toolbar(Math.Max(0, Array.IndexOf(Sorts, Sort)), SortNames)];
            if (NoteDraft != null)
            {
                GUILayout.Label("Your note (Enter to keep it, Esc to leave it):", text);
                NoteDraft = GUILayout.TextField(NoteDraft);
            }
            scroll = GUILayout.BeginScrollView(scroll);
            GUILayout.Label(Book.Text(Search, Section, Sort, Cursor), text);
            if (Status != "") GUILayout.Label(Status, text);
            GUILayout.EndScrollView();
            if (GUILayout.Button("Close")) Close();
            GUILayout.EndArea();
        }
    }
}
`,
  'VcgsGame.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// The one playthrough: put it on a GameObject in your first scene and give
    /// it the generated story.json. It stays loaded between scenes.
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public sealed class VcgsGame : MonoBehaviour
    {
        [Tooltip("The generated story.json (Assets/VCGS/Generated/story.json).")]
        [SerializeField] TextAsset story = null;

        public static VcgsGame Instance { get; private set; }
        public Story Story { get; private set; }
        public GameState State { get; private set; }

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
            Story = Story.FromJson(story != null ? story.text : "{}");
            State = new GameState(Story);
        }

        /// <summary>A saved game was loaded: open the Unity scene for this story scene key ("" for the story's beginning), whose VcgsSceneFlow plays it from its start.</summary>
        public event System.Action<string> GameLoaded;

        /// <summary>Where saves go when no path is given: savegame.json in persistentDataPath.</summary>
        public static string DefaultSavePath => System.IO.Path.Combine(Application.persistentDataPath, "savegame.json");

        /// <summary>Save the game (as the scene being played began, so loading plays it again from its start). Returns where, or "" if it could not.</summary>
        public string SaveGame(string path = null)
        {
            path = path ?? DefaultSavePath;
            try
            {
                System.IO.File.WriteAllText(path, State.SaveText(Story.Name));
                return path;
            }
            catch (System.Exception)
            {
                return "";
            }
        }

        /// <summary>Load a saved game (one from any engine's VCGS runtime). Returns the scene key to play on from ("" for the beginning), after GameLoaded; null when there is no save to load.</summary>
        public string LoadGame(string path = null)
        {
            path = path ?? DefaultSavePath;
            string text;
            try { text = System.IO.File.ReadAllText(path); }
            catch (System.Exception) { return null; }
            var at = State.LoadSave(text);
            if (at != null) GameLoaded?.Invoke(at);
            return at;
        }
    }
}
`,

  'VcgsSceneFlow.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// Plays a story scene in a Unity scene: set its key (StoryKeys.Scenes),
    /// connect to Player's events, and call Player.Advance() / Choose().
    /// </summary>
    public sealed class VcgsSceneFlow : MonoBehaviour
    {
        [Tooltip("The scene's key, as in StoryKeys.Scenes.")]
        [SerializeField] string sceneKey = "";
        [SerializeField] bool startOnPlay = true;

        public ScenePlayer Player { get; private set; }

        public string SceneKey
        {
            get => sceneKey;
            set => sceneKey = value;
        }

        void Awake()
        {
            if (VcgsGame.Instance == null)
            {
                Debug.LogError("VCGS: add a VcgsGame (with the generated story.json) to the first scene.");
                return;
            }
            Player = new ScenePlayer(VcgsGame.Instance.State, sceneKey);
        }

        void Start()
        {
            if (startOnPlay && Player != null) Player.Start();
        }
    }
}
`,

  'VcgsInteractable.cs': String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>An object the player can use: set its key (StoryKeys.Objects) and call Interact from your input code.</summary>
    public sealed class VcgsInteractable : MonoBehaviour
    {
        [Tooltip("The object's key, as in StoryKeys.Objects.")]
        [SerializeField] string objectKey = "";

        public string ObjectKey
        {
            get => objectKey;
            set => objectKey = value;
        }

        public string State => VcgsGame.Instance != null ? VcgsGame.Instance.State.GetObjectState(objectKey) : "";

        public List<string> AvailableVerbs() => VcgsGame.Instance != null ? Interactions.AvailableVerbs(VcgsGame.Instance.State, objectKey) : new List<string>();

        public bool Interact(string verb) => VcgsGame.Instance != null && Interactions.Interact(VcgsGame.Instance.State, objectKey, verb);
    }
}
`,

  'VcgsTypes.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    [Serializable]
    public sealed class VcgsDetail
    {
        public string name = "";
        [TextArea] public string value = "";
    }

    [Serializable]
    public sealed class VcgsShot
    {
        public string framing = "";
        public string move = "";
        public string lens = "";
        public List<string> characters = new List<string>();
        [TextArea] public string action = "";
        public string line = "";
        public string audio = "";
        public string vfx = "";
        public float seconds;
        public string transition = "";
        [TextArea] public string notes = "";
    }
}
`,
  'VcgsElement.cs': String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>What every generated element asset has: its key, code, name, description and other fields.</summary>
    public abstract class VcgsElement : ScriptableObject
    {
        public string key = "";
        public string code = "";
        public string displayName = "";
        [TextArea(2, 6)] public string description = "";
        public List<VcgsDetail> details = new List<VcgsDetail>();
    }
}
`,
  'VcgsCharacter.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    [CreateAssetMenu(menuName = "VCGS/Character")]
    public sealed class VcgsCharacter : VcgsElement
    {
        public string role = "";
        public string arc = "";
        public Color color = Color.white;
    }
}
`,
  'VcgsItem.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    [CreateAssetMenu(menuName = "VCGS/Item")]
    public sealed class VcgsItem : VcgsElement { }
}
`,
  'VcgsLocation.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    [CreateAssetMenu(menuName = "VCGS/Location")]
    public sealed class VcgsLocation : VcgsElement { }
}
`,
  'VcgsLore.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>A lore entry: history or a world fact, for codex or journal text.</summary>
    [CreateAssetMenu(menuName = "VCGS/Lore entry")]
    public sealed class VcgsLore : VcgsElement { }
}
`,
  'VcgsQuest.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>A quest or objective as designed; its logic lives in flags and triggers.</summary>
    [CreateAssetMenu(menuName = "VCGS/Quest")]
    public sealed class VcgsQuest : VcgsElement { }
}
`,
  'VcgsMechanic.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>A mechanic: how a system works, in the designer's words.</summary>
    [CreateAssetMenu(menuName = "VCGS/Mechanic")]
    public sealed class VcgsMechanic : VcgsElement { }
}
`,
  'VcgsSkill.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>A skill, ability or upgrade: its kind, tree and use in the designer's words (Rules.Learn plays it).</summary>
    [CreateAssetMenu(menuName = "VCGS/Skill")]
    public sealed class VcgsSkill : VcgsElement { }
}
`,
  'VcgsEncounter.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>An encounter or enemy.</summary>
    [CreateAssetMenu(menuName = "VCGS/Encounter")]
    public sealed class VcgsEncounter : VcgsElement { }
}
`,
  'VcgsCinematic.cs': String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    [CreateAssetMenu(menuName = "VCGS/Cinematic")]
    public sealed class VcgsCinematic : VcgsElement
    {
        public float seconds;
        public int shots = 1;
        public bool skippable = true;
        public List<VcgsShot> shotList = new List<VcgsShot>();
    }
}
`,
};

export const ASMDEF = `${JSON.stringify({ name: 'VCGS.Runtime', rootNamespace: 'VCGS', references: [], autoReferenced: true }, null, 2)}\n`;
