/**
 * The puzzle runtime for Unity, as C# (puzzle spec §6, §8, §10): the same
 * rules as the studio's progress.ts and screens.ts, and as the Godot and
 * Unreal runtimes. Plain C#, so it runs (and is checked) outside Unity too.
 */
const HEAD = '// VCGS Runtime for Unity. The same for every project; safe to commit.';

export const UNITY_PUZZLES = String.raw`${HEAD}
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace VCGS
{
    /// <summary>
    /// How far the player is through a puzzle's steps: Done (step -> order done),
    /// Failed, Begun (timed sub-goal -> clock when its first step was done), Seq,
    /// Fails (wrong moves), Wrong (whether each step's wrong move holds now), and
    /// Stale (steps undone while their condition held: done again only once it
    /// stops holding and holds anew). Saved as the same JSON in every engine.
    /// </summary>
    public sealed class StepProgress
    {
        public readonly Dictionary<string, int> Done = new Dictionary<string, int>();
        public readonly Dictionary<string, int> Failed = new Dictionary<string, int>();
        public readonly Dictionary<string, double> Begun = new Dictionary<string, double>();
        public readonly Dictionary<string, bool> Wrong = new Dictionary<string, bool>();
        public readonly HashSet<string> Stale = new HashSet<string>();
        public int Seq;
        public int Fails;

        public StepProgress Copy()
        {
            var p = new StepProgress { Seq = Seq, Fails = Fails };
            foreach (var e in Done) p.Done[e.Key] = e.Value;
            foreach (var e in Failed) p.Failed[e.Key] = e.Value;
            foreach (var e in Begun) p.Begun[e.Key] = e.Value;
            foreach (var e in Wrong) p.Wrong[e.Key] = e.Value;
            foreach (var s in Stale) p.Stale.Add(s);
            return p;
        }

        public string ToJson()
        {
            static string Q(string s) => "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            static string Num(double n) => n.ToString("R", CultureInfo.InvariantCulture);
            string Map<T>(Dictionary<string, T> d, Func<T, string> v)
            {
                var parts = new List<string>();
                foreach (var e in d) parts.Add(Q(e.Key) + ": " + v(e.Value));
                return "{" + string.Join(", ", parts) + "}";
            }
            var stale = new List<string>();
            foreach (var s in Stale) stale.Add(Q(s) + ": true");
            return "{\"done\": " + Map(Done, n => n.ToString(CultureInfo.InvariantCulture)) + ", \"failed\": " + Map(Failed, n => n.ToString(CultureInfo.InvariantCulture)) +
                ", \"begun\": " + Map(Begun, Num) + ", \"seq\": " + Seq.ToString(CultureInfo.InvariantCulture) + ", \"fails\": " + Fails.ToString(CultureInfo.InvariantCulture) +
                ", \"wrong\": " + Map(Wrong, b => b ? "true" : "false") + ", \"stale\": {" + string.Join(", ", stale) + "}}";
        }

        public static StepProgress FromJson(Dictionary<string, object> d)
        {
            var p = new StepProgress { Seq = (int)D.Num(d, "seq"), Fails = (int)D.Num(d, "fails") };
            foreach (var e in D.Map(d, "done")) p.Done[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var e in D.Map(d, "failed")) p.Failed[e.Key] = (int)D.Num(e.Value, 0);
            foreach (var e in D.Map(d, "begun")) p.Begun[e.Key] = D.Num(e.Value, 0);
            foreach (var e in D.Map(d, "wrong")) p.Wrong[e.Key] = e.Value is bool b && b;
            foreach (var e in D.Map(d, "stale")) p.Stale.Add(e.Key);
            return p;
        }
    }

    /// <summary>A step done, failed (a wrong move), expired (out of time) or reset.</summary>
    public readonly struct StepEvent
    {
        public readonly string Step, Label, What;
        public StepEvent(string step, string label, string what) { Step = step; Label = label; What = what; }
    }

    /// <summary>
    /// Puzzle steps, hints and screen puzzles as VC Game Studio plays them
    /// (puzzle spec §6, §8, §10). Rules.Settle calls Advance for each puzzle
    /// whose design keeps progress.
    /// </summary>
    public static class PuzzleRuntime
    {
        static List<Dictionary<string, object>> Steps(Dictionary<string, object> design) => D.List(design, "steps").ConvertAll(D.Map);

        static string Parent(Dictionary<string, object> s) => D.Get(s, "parent") as string;

        static List<Dictionary<string, object>> Children(List<Dictionary<string, object>> steps, string parent) => steps.FindAll(s => Parent(s) == parent);

        static List<Dictionary<string, object>> Required(List<Dictionary<string, object>> steps, string parent) => steps.FindAll(s => Parent(s) == parent && !D.Bool(s, "optional"));

        static Dictionary<string, object> Find(List<Dictionary<string, object>> steps, string id) => steps.Find(s => D.Str(s, "id") == id);

        static List<Dictionary<string, object>> Descendants(List<Dictionary<string, object>> steps, string id)
        {
            var out_ = new List<Dictionary<string, object>>();
            foreach (var c in Children(steps, id))
            {
                out_.Add(c);
                out_.AddRange(Descendants(steps, D.Str(c, "id")));
            }
            return out_;
        }

        /// <summary>Whether a step may be done yet: what it needs first is done, the step before it in a sequence is, and the sub-goal it is under is open.</summary>
        public static bool Unlocked(List<Dictionary<string, object>> steps, Dictionary<string, object> step, Dictionary<string, int> done)
        {
            foreach (var r in D.List(step, "requires"))
                if (r is string need && Find(steps, need) != null && !done.ContainsKey(need)) return false;
            var parentId = Parent(step);
            if (parentId == null) return true;
            var parent = Find(steps, parentId);
            if (parent == null) return true;
            if (D.Str(parent, "gate") == "sequence" && !D.Bool(step, "optional"))
            {
                var order = Required(steps, parentId);
                var at = order.FindIndex(s => D.Str(s, "id") == D.Str(step, "id"));
                if (at > 0 && !done.ContainsKey(D.Str(order[at - 1], "id"))) return false;
            }
            return Unlocked(steps, parent, done);
        }

        static void MarkDone(StepProgress p, Dictionary<string, object> n, List<Dictionary<string, object>> steps, double now, List<StepEvent> events, List<object> effects)
        {
            p.Done[D.Str(n, "id")] = ++p.Seq;
            events.Add(new StepEvent(D.Str(n, "id"), D.Str(n, "label"), "done"));
            effects.AddRange(D.List(n, "effects"));
            // Its first step done starts a timed sub-goal's clock.
            for (var at = Parent(n) == null ? null : Find(steps, Parent(n)); at != null; at = Parent(at) == null ? null : Find(steps, Parent(at)))
                if (D.Num(at, "within") > 0 && !p.Begun.ContainsKey(D.Str(at, "id"))) p.Begun[D.Str(at, "id")] = now;
        }

        /// <summary>Move a puzzle on: its progress now, what happened, what that does, and whether it is solved.</summary>
        public static (StepProgress progress, List<StepEvent> events, List<object> effects, bool solved, bool changed) Advance(Dictionary<string, object> design, StepProgress before, GameState game, double now)
        {
            var steps = Steps(design);
            var p = before != null ? before.Copy() : new StepProgress();
            var events = new List<StepEvent>();
            var effects = new List<object>();
            var changed = false;
            bool Holds(object rule) => rule != null && Rules.Check(rule, game);
            // Time first: a timed sub-goal that ran out loses what was done under it.
            foreach (var g in steps)
            {
                var gid = D.Str(g, "id");
                if (D.Str(g, "kind") != "goal" || D.Num(g, "within") <= 0 || !p.Begun.TryGetValue(gid, out var start) || p.Done.ContainsKey(gid) || now - start <= D.Num(g, "within")) continue;
                foreach (var d in Descendants(steps, gid))
                {
                    var did = D.Str(d, "id");
                    if (p.Done.ContainsKey(did) && D.Str(d, "kind") != "goal") p.Stale.Add(did);
                    p.Done.Remove(did);
                    p.Failed.Remove(did);
                }
                p.Begun.Remove(gid);
                events.Add(new StepEvent(gid, D.Str(g, "label"), "expired"));
                changed = true;
            }
            // Then as many passes as there are steps: each can open the next.
            for (var pass = 0; pass <= steps.Count; pass++)
            {
                var moved = false;
                foreach (var n in steps)
                {
                    var nid = D.Str(n, "id");
                    if (p.Done.ContainsKey(nid)) continue;
                    if (D.Str(n, "kind") != "goal")
                    {
                        // A wrong move is noticed when it happens, open or not.
                        var fail = D.Map(n, "fail");
                        var wrongNow = fail.ContainsKey("when") && Holds(D.Get(fail, "when"));
                        var was = p.Wrong.TryGetValue(nid, out var w) && w;
                        if (was != wrongNow)
                        {
                            p.Wrong[nid] = wrongNow;
                            changed = true;
                        }
                        if (wrongNow && !was && !p.Failed.ContainsKey(nid))
                        {
                            p.Failed[nid] = ++p.Seq;
                            events.Add(new StepEvent(nid, D.Str(n, "label"), "failed"));
                            effects.AddRange(D.List(fail, "effects"));
                            changed = moved = true;
                            if (D.Bool(fail, "forward"))
                            {
                                MarkDone(p, n, steps, now, events, effects);
                                continue;
                            }
                            p.Fails++;
                            if (D.Str(design, "reset") == "onFail")
                            {
                                var fresh = new StepProgress { Seq = p.Seq, Fails = p.Fails };
                                foreach (var e in p.Wrong) fresh.Wrong[e.Key] = e.Value;
                                foreach (var x in steps)
                                    if (D.Str(x, "kind") != "goal" && (p.Done.ContainsKey(D.Str(x, "id")) || D.Str(x, "id") == nid)) fresh.Stale.Add(D.Str(x, "id"));
                                p = fresh;
                                events.Add(new StepEvent(nid, D.Str(n, "label"), "reset"));
                                break;
                            }
                            continue;
                        }
                        if (p.Stale.Contains(nid))
                        {
                            // Undone while it held: it must stop holding first.
                            if (Holds(D.Get(n, "when"))) continue;
                            p.Stale.Remove(nid);
                            changed = true;
                            continue;
                        }
                        if (Unlocked(steps, n, p.Done) && Holds(D.Get(n, "when")))
                        {
                            MarkDone(p, n, steps, now, events, effects);
                            changed = moved = true;
                        }
                        continue;
                    }
                    if (!Unlocked(steps, n, p.Done)) continue;
                    var kids = Required(steps, nid);
                    if (kids.Count == 0) continue;
                    var ok = D.Str(n, "gate") == "any" ? kids.Exists(c => p.Done.ContainsKey(D.Str(c, "id"))) : kids.TrueForAll(c => p.Done.ContainsKey(D.Str(c, "id")));
                    if (ok)
                    {
                        MarkDone(p, n, steps, now, events, effects);
                        changed = moved = true;
                    }
                }
                if (!moved) break;
            }
            var top = Required(steps, null);
            var solved = top.Count > 0 && top.TrueForAll(t => p.Done.ContainsKey(D.Str(t, "id")));
            return (p, events, effects, solved, changed);
        }

        /// <summary>Staged hints due now and not given: each needs its wrong moves made and its condition holding (and at least one of them).</summary>
        public static List<Dictionary<string, object>> DueHints(Dictionary<string, object> design, int fails, HashSet<string> given, GameState game)
        {
            var due = new List<Dictionary<string, object>>();
            foreach (var item in D.List(design, "hints"))
            {
                var h = D.Map(item);
                if (given.Contains(D.Str(h, "id")) || (!h.ContainsKey("afterFails") && !h.ContainsKey("when"))) continue;
                if (h.ContainsKey("afterFails") && fails < (int)D.Num(h, "afterFails")) continue;
                if (h.ContainsKey("when") && !Rules.Check(D.Get(h, "when"), game)) continue;
                due.Add(h);
            }
            return due;
        }

        // ------------------------------------------------------------ screen puzzles

        static int Sides(string piece) => piece switch { "end" => 1, "straight" => 5, "corner" => 3, "tee" => 7, "cross" => 15, _ => 0 };

        static int Turned(int sides, int rot)
        {
            for (var i = 0; i < ((rot % 4) + 4) % 4; i++) sides = ((sides << 1) | (sides >> 3)) & 15;
            return sides;
        }

        /// <summary>Whether a circuit's source reaches its sink with its pieces turned so (one turn a cell).</summary>
        public static bool CircuitJoined(Dictionary<string, object> screen, IList<int> rot)
        {
            var w = (int)D.Num(screen, "width");
            var h = (int)D.Num(screen, "height");
            var cells = D.List(screen, "cells");
            var src = (int)D.Num(screen, "source");
            var sink = (int)D.Num(screen, "sink", cells.Count - 1);
            int At(int i) => Turned(Sides(D.Str(D.Map(cells[i]), "piece")), i < rot.Count ? rot[i] : 0);
            var seen = new HashSet<int> { src };
            var queue = new Queue<int>();
            queue.Enqueue(src);
            while (queue.Count > 0)
            {
                var at = queue.Dequeue();
                if (at == sink) return true;
                var r = at / w;
                var c = at % w;
                var steps = new (int outBit, int backBit, int to)[] { (1, 4, r > 0 ? at - w : -1), (2, 8, c < w - 1 ? at + 1 : -1), (4, 1, r < h - 1 ? at + w : -1), (8, 2, c > 0 ? at - 1 : -1) };
                foreach (var (outBit, backBit, to) in steps)
                    if (to >= 0 && to < cells.Count && !seen.Contains(to) && (At(at) & outBit) != 0 && (At(to) & backBit) != 0)
                    {
                        seen.Add(to);
                        queue.Enqueue(to);
                    }
            }
            return false;
        }

        /// <summary>Flip a switch, and the switches it is linked to.</summary>
        public static List<bool> Flip(Dictionary<string, object> screen, IList<bool> on, int i)
        {
            var next = new List<bool>(on);
            var which = new List<int> { i };
            var links = D.List(screen, "links");
            if (i < links.Count) foreach (var j in D.List(links[i])) which.Add((int)D.Num(j, -1));
            foreach (var j in which) if (j >= 0 && j < next.Count) next[j] = !next[j];
            return next;
        }

        static List<string> Strs(object o) => D.List(o).ConvertAll(x => x is string s ? s : x is double n ? n.ToString(CultureInfo.InvariantCulture) : "");

        static List<int> Ints(object o) => D.List(o).ConvertAll(x => (int)D.Num(x, 0));

        static bool Same<T>(List<T> a, List<T> b) where T : IEquatable<T>
        {
            if (a.Count != b.Count) return false;
            for (var i = 0; i < a.Count; i++) if (!a[i].Equals(b[i])) return false;
            return true;
        }

        /// <summary>
        /// Whether an answer solves a screen. What the answer is, by kind: keypad
        /// and custom, the text entered (a string); dial, the numbers set in order;
        /// symbols, the symbols pressed; ordering, the items in the order given;
        /// matching, the right-hand items in the order of the left; assembly, slot
        /// id -> part id; levers, each switch on or off; rings, each ring's turn;
        /// tiles, the number on each square (0 the gap); circuit, each cell's turn.
        /// Lists as List&lt;object&gt; (of strings, doubles or bools), maps as
        /// Dictionary&lt;string, object&gt;: as Json.Parse gives them.
        /// </summary>
        public static bool CheckScreen(Dictionary<string, object> screen, object answer)
        {
            switch (D.Str(screen, "kind"))
            {
                case "keypad":
                    return D.Str(screen, "code") != "" && answer is string code && code == D.Str(screen, "code");
                case "custom":
                    return D.Str(screen, "text").Trim() != "" && answer is string text && text.Trim().ToLowerInvariant() == D.Str(screen, "text").Trim().ToLowerInvariant();
                case "dial":
                    return D.List(screen, "combination").Count > 0 && Same(Ints(answer), Ints(D.Get(screen, "combination")));
                case "symbols":
                    return D.List(screen, "answer").Count > 0 && Same(Strs(answer), Strs(D.Get(screen, "answer")));
                case "ordering":
                    return D.List(screen, "items").Count > 1 && Same(Strs(answer), Strs(D.Get(screen, "items")));
                case "matching":
                    var rights = D.List(screen, "pairs").ConvertAll(p => D.Str(D.Map(p), "right"));
                    return rights.Count > 0 && Same(Strs(answer), rights);
                case "assembly":
                    var slots = D.List(screen, "slots");
                    if (slots.Count == 0 || !(answer is Dictionary<string, object> placed)) return false;
                    return slots.TrueForAll(s => D.Str(placed, D.Str(D.Map(s), "id")) == D.Str(D.Map(s), "accepts"));
                case "levers":
                    var target = D.List(screen, "target");
                    var on = D.List(answer);
                    if (target.Count == 0 || on.Count != target.Count) return false;
                    for (var i = 0; i < target.Count; i++) if ((on[i] is bool a && a) != (target[i] is bool t && t)) return false;
                    return true;
                case "rings":
                    var turns = Ints(answer);
                    var segments = Math.Max(1, (int)D.Num(screen, "segments", 8));
                    return turns.Count > 0 && turns.Count == (int)D.Num(screen, "rings") && turns.TrueForAll(x => x % segments == 0);
                case "tiles":
                    var n = Math.Max(2, (int)D.Num(screen, "size", 3));
                    var solved = new List<int>();
                    for (var i = 1; i < n * n; i++) solved.Add(i);
                    solved.Add(0);
                    return Same(Ints(answer), solved);
                case "circuit":
                    return answer is List<object> && CircuitJoined(screen, Ints(answer));
            }
            return false;
        }
    }
}
`;
