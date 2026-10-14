// The Old Tomb in Unity (structure spec §7, §10, §14): the same walk as the
// Godot structure check. The studio's own walk through it
// (structure_expect.json), step for step: what Interact offers at each door,
// which doors are open, the objectives done, the completion and its effect on
// the story, and what the tomb remembers when the player leaves and comes back.
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;

static class StructureCheck
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static void Check(LevelLogic level, GameState game, Dictionary<string, object> step, int n)
    {
        var want = D.Map(step, "expect");
        var what = "step " + n + " (" + D.Str(step, "do") + " " + D.Str(step, "guid") + ")";
        if (want.ContainsKey("verb"))
        {
            var o = level.Offer(D.Str(step, "guid"));
            var verb = o?.Verb ?? "";
            var blocked = o?.Blocked ?? "";
            if (verb != D.Str(want, "verb") || blocked != D.Str(want, "blocked"))
                Fail(what + ": offers " + verb + " / " + blocked + ", the studio " + D.Str(want, "verb") + " / " + D.Str(want, "blocked"));
        }
        foreach (var pair in D.Map(want, "open"))
            if (level.IsOpen(pair.Key) != (pair.Value is bool b && b))
                Fail(what + ": " + D.Str(level.Item(pair.Key), "name") + " should be " + ((pair.Value is bool o2 && o2) ? "open" : "shut"));
        if (want.ContainsKey("objectives"))
        {
            var done = new List<string>(level.ObjectivesDone);
            done.Sort(StringComparer.Ordinal);
            var expected = D.List(want, "objectives").ConvertAll(x => (string)x);
            if (string.Join(",", done) != string.Join(",", expected)) Fail(what + ": objectives done " + string.Join(",", done) + ", the studio " + string.Join(",", expected));
        }
        if (want.ContainsKey("complete") && level.Complete != D.Bool(want, "complete")) Fail(what + ": complete is " + level.Complete + ", the studio " + D.Bool(want, "complete"));
        foreach (var pair in D.Map(want, "present"))
            if (level.IsPresent(pair.Key) != (pair.Value is bool p && p)) Fail(what + ": " + D.Str(level.Item(pair.Key), "name") + " should " + ((pair.Value is bool p2 && p2) ? "be there" : "be gone"));
        // Health within a tick of the studio's: a trap's cycle can fall either side of a tick.
        if (want.ContainsKey("health") && Math.Abs(level.Health - D.Num(want, "health")) > 6) Fail(what + ": health " + level.Health + ", the studio " + D.Num(want, "health"));
        foreach (var pair in D.Map(want, "items"))
        {
            var has = game.Items.TryGetValue(pair.Key, out var count) ? count : 0;
            if (has != (int)D.Num(pair.Value, 0)) Fail(what + ": carries " + has + " of " + pair.Key + ", the studio " + D.Num(pair.Value, 0));
        }
        foreach (var pair in D.Map(want, "flags"))
            if (game.GetFlag(pair.Key) != (string)pair.Value) Fail(what + ": " + pair.Key + " is " + game.GetFlag(pair.Key) + ", the studio " + pair.Value);
    }

    static int Main()
    {
        var story = Story.FromJson(File.ReadAllText("Assets/VCGS/Generated/story.json"));
        var game = new GameState(story);
        var expect = D.Map(Json.Parse(File.ReadAllText("structure_expect.json")));
        var json = File.ReadAllText("Assets/VCGS/Generated/Levels/" + D.Str(expect, "level") + ".json");
        var level = LevelLogic.FromJson(json, game);
        if (D.Str(level.Structure, "name") != "Old Tomb" || D.List(level.Structure, "doors").Count != 6 || D.List(level.Structure, "objectives").Count != 2)
            Fail("the level data should carry the Old Tomb's manifest");
        if (level.Objective != "Find the Tomb Key") Fail("the first objective should be shown, got " + level.Objective);
        var n = 0;
        foreach (var o in D.List(expect, "steps"))
        {
            n++;
            var step = D.Map(o);
            var at = D.List(step, "at");
            var where = new[] { D.Num(at[0], 0), D.Num(at[1], 0), D.Num(at[2], 0) };
            level.Player = where;
            // What the player came into and left: in a game the physics says so.
            foreach (var g in D.List(step, "exit")) level.Exit((string)g);
            foreach (var g in D.List(step, "enter")) level.Enter((string)g);
            switch (D.Str(step, "do"))
            {
                case "interact":
                    level.Interact(D.Str(step, "guid"));
                    level.Tick(0.05);
                    break;
                case "wait":
                    for (var left = D.Num(step, "seconds"); left > 1e-6; left -= 0.25) level.Tick(Math.Min(0.25, left));
                    break;
                case "remember":
                    // Out of the tomb and back in: what VcgsLevel does as the level unloads and loads again.
                    LevelLogic.Places[level.Key] = level.Remember();
                    level = LevelLogic.FromJson(json, game);
                    level.Player = where;
                    break;
            }
            Check(level, game, step, n);
        }
        Console.WriteLine("structure: " + n + " steps · objectives " + string.Join(",", level.ObjectivesDone) + " · complete " + level.Complete);
        if (failures > 0) return 1;
        Console.WriteLine("structure OK");
        return 0;
    }
}
