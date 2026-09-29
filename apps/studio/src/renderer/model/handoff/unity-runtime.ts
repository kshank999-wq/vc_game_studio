/**
 * The VCGS Runtime for Unity, as C# source. The logic is plain C# (Story,
 * GameState, Rules, ScenePlayer, Interactions, StoryWalker) so it runs, and
 * is tested, outside Unity too; the MonoBehaviours and ScriptableObjects are
 * thin Unity wrappers around it. C# 9, for Unity 2021.2 and later.
 */

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
                var sb = new StringBuilder();
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
        /// <summary>Lore the player has come across, in the order they found it (the codex).</summary>
        public readonly List<string> KnownLore = new List<string>();
        /// <summary>Mechanics the player can use now.</summary>
        public readonly HashSet<string> Mechanics = new HashSet<string>();

        /// <summary>Anything the story's conditions can see has changed.</summary>
        public event Action Changed;
        public event Action<string> TriggerFired;
        public event Action<string> QuestStarted;
        public event Action<string> QuestCompleted;
        public event Action<string> LoreDiscovered;
        public event Action<string> MechanicAvailable;
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
            Flags.Clear(); ObjectStates.Clear(); Items.Clear(); Arcs.Clear(); Chosen.Clear();
            Solved.Clear(); Visited.Clear(); Fired.Clear(); Picked.Clear(); Quests.Clear(); Won.Clear(); KnownLore.Clear(); Mechanics.Clear();
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
            OnChanged();
        }

        public void TakeItem(string item, int count = 1)
        {
            Items[item] = Math.Max(0, (Items.TryGetValue(item, out var n) ? n : 0) - count);
            OnChanged();
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

        public void EnableMechanic(string mechanic)
        {
            if (!Mechanics.Add(mechanic)) return;
            MechanicAvailable?.Invoke(mechanic);
            OnChanged();
        }

        public bool WasWon(string encounter) => Won.Contains(encounter);

        public void MarkWon(string encounter)
        {
            if (Won.Add(encounter)) OnChanged();
        }

        public void MarkPicked(string option) => Picked.Add(option);

        public bool WasPicked(string option) => Picked.Contains(option);

        internal void RaiseTriggerFired(string trigger) => TriggerFired?.Invoke(trigger);

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
                    if (game.KnowsLore(l.Key) || !Check(D.Get(l.Value, "discoveredWhen"), game)) continue;
                    game.DiscoverLore(l.Key);
                    moved = true;
                }
                foreach (var m in game.Story.Mechanics)
                {
                    if (game.HasMechanic(m.Key) || !Check(D.Get(m.Value, "availableWhen"), game)) continue;
                    game.EnableMechanic(m.Key);
                    moved = true;
                }
                foreach (var q in game.Story.Quests)
                {
                    var state = game.QuestState(q.Key);
                    if (state == "" && Check(D.Get(q.Value, "starts"), game))
                    {
                        game.SetQuest(q.Key, "active");
                        moved = true;
                    }
                    else if (state == "active" && q.Value.ContainsKey("completes") && Check(D.Get(q.Value, "completes"), game))
                    {
                        game.SetQuest(q.Key, "done");
                        Apply(D.Get(q.Value, "reward"), game);
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
            game.Visit(SceneKey);
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
                DualRequested?.Invoke(first, second);
                return;
            }
            EventStarted?.Invoke(ev);
            var kind = D.Str(ev, "kind");
            if (kind != "choice") Rules.Apply(D.Get(ev, "effects"), game);
            switch (kind)
            {
                case "dialogue": DialogueRequested?.Invoke(D.Str(ev, "line")); break;
                case "cinematic": CinematicRequested?.Invoke(D.Str(ev, "ref")); break;
                case "freePlay":
                    FreePlayStarted?.Invoke(D.Str(ev, "endsWhen"));
                    if (ev.ContainsKey("ends")) AwaitEnd(D.Get(ev, "ends"));
                    break;
                case "choice": ChoiceRequested?.Invoke(D.Str(ev, "ref"), OptionsAt(index)); break;
                case "encounter": EncounterRequested?.Invoke(D.Str(ev, "ref"), Rules.CanWin(D.Str(ev, "ref"), game)); break;
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
