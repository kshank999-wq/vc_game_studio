// Plays capture with the VCGS Runtime for Unity: the same walk as the Godot
// capture check. Lose to the eels in SC-02 The Key: counted, health set, the
// knife taken, to the Holding cell; the Evidence locker gives it back; out of
// the cell, back in The Key past the fight.
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;

static class CaptureCheck
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static int Main()
    {
        var story = Story.FromJson(File.ReadAllText("Assets/VCGS/Generated/story.json"));
        var game = new GameState(story);
        var cell = D.Str(story.Capture, "cell");
        var locker = D.Str(story.Capture, "locker");
        var count = D.Str(story.Capture, "count");
        var health = D.Str(story.Capture, "health");
        if (cell == "" || locker == "" || count == "" || health == "") Fail("capture should name its cell, locker, count and health");
        if (game.GetFlag(health) != "100") Fail("health should start at 100, got " + game.GetFlag(health));
        if (!Rules.IsCaptor("orc_sentry", game) || Rules.IsCaptor("mara", game)) Fail("the Orc Sentry should be a captor, and Mara not");
        game.GiveItem("diving_knife");

        // Lose to the eels: captured, to the holding cell.
        var key = new ScenePlayer(game, "sc_02_the_key");
        var finished = new List<string>();
        var over = new List<string>();
        key.SceneFinished += next => finished.Add(next);
        key.GameOver += k => over.Add(k);
        key.Start();
        key.Lose();
        if (finished.Count != 1 || finished[0] != cell || over.Count != 0) Fail("losing the eels should go to the holding cell, got " + string.Join(",", finished));
        if (game.GetFlag(count) != "1" || game.GetFlag(health) != "50") Fail("a capture should count 1 and set health to 50, got " + game.GetFlag(count) + " / " + game.GetFlag(health));
        if (game.HasItem("diving_knife") || !game.Taken.TryGetValue("diving_knife", out var n) || n != 1) Fail("the knife should be taken");
        if (game.Held.Scene != "sc_02_the_key" || game.Held.Index != 1) Fail("where the player was caught should be kept, got " + game.Held.Scene + " " + game.Held.Index);
        if (key.Capture()) Fail("a player held already should not be captured again");

        // A save in the cell keeps what was taken and where they were caught; it loads back.
        game.Checkpoint(cell);
        var saved = game.SaveText("The Sunken Vault");
        var data = D.Map(Json.Parse(saved));
        if ((int)D.Num(D.Map(data, "taken"), "diving_knife") != 1 || D.Str(D.Map(data, "held"), "scene") != "sc_02_the_key") Fail("a save should keep what was taken and where");
        var reloaded = new GameState(story);
        reloaded.LoadSave(saved);
        if (reloaded.Held.Scene != "sc_02_the_key" || reloaded.Held.Index != 1 || !reloaded.Taken.ContainsKey("diving_knife")) Fail("a loaded save should be held, with the knife taken");

        // The holding cell: the locker gives the knife back.
        var holding = new ScenePlayer(game, cell);
        var outOf = new List<string>();
        var free = 0;
        holding.SceneFinished += next => outOf.Add(next);
        holding.FreePlayStarted += _ => free++;
        holding.Start();
        if (free != 1) Fail("the holding cell should open on its free play");
        if (!Interactions.AvailableVerbs(game, locker).Contains(Rules.LockerVerb)) Fail("the locker should offer the knife back");
        if (!Interactions.Interact(game, locker, Rules.LockerVerb) || !game.HasItem("diving_knife") || game.Taken.Count != 0) Fail("taking things back should return the knife");
        if (Interactions.AvailableVerbs(game, locker).Contains(Rules.LockerVerb)) Fail("the locker should be empty now");
        holding.Advance();
        if (outOf.Count != 1 || outOf[0] != "sc_02_the_key" || !game.Held.IsNone) Fail("out of the cell should go back to The Key, got " + string.Join(",", outOf));

        // The Key again picks up past the fight: the key in the silt.
        var again = new ScenePlayer(game, "sc_02_the_key");
        var kinds = new List<string>();
        again.EventStarted += e => kinds.Add(D.Str(e, "kind"));
        again.Start();
        if (kinds.Count == 0 || kinds[0] == "encounter" || !game.HasItem("vault_key")) Fail("The Key should pick up past the eels, got " + string.Join(",", kinds));
        if (!game.Resume.IsNone) Fail("the resume point should be used up");
        Console.WriteLine("capture: to " + cell + ", back with the knife " + game.HasItem("diving_knife") + ", on with " + string.Join(",", kinds) + " · captures " + game.GetFlag(count));
        // Caught in play while a scene plays: captured from where it is, past the event on now.
        var caught = new List<string>();
        game.Captured += (to, by) => caught.Add(to + "<" + by);
        var toCell = new List<string>();
        again.SceneFinished += next => toCell.Add(next);
        // The cell as an escape left it: solved, the door open. Caught again, it is locked again.
        game.Solved.Add("escape_the_cell");
        game.ObjectStates["cell_door"] = "Open";
        game.ObjectStates["loose_brick"] = "Pulled out";
        if (Rules.CatchPlayer("orc_sentry", game) != cell || toCell.Count != 1 || toCell[0] != cell || caught.Count != 1 || caught[0] != cell + "<orc_sentry") Fail("a catch in play should capture from the scene playing");
        if (game.Held.Scene != "sc_02_the_key") Fail("a catch in play should keep the scene it was in, got " + game.Held.Scene);
        if (Rules.CatchPlayer("orc_sentry", game) != "") Fail("a player held already should not be caught again");
        if (game.Solved.Contains("escape_the_cell") || game.GetObjectState("cell_door") != "Locked" || game.GetObjectState("loose_brick") != "In the wall") Fail("caught again, the cell should be locked again, got door " + game.GetObjectState("cell_door"));
        // Caught with no scene playing: still captured; out of the cell, it goes on as the graph says.
        game.Reset();
        game.FlowNow = null;
        if (Rules.CatchPlayer("", game) != cell || !game.Held.IsNone && game.Held.Scene != "") Fail("a catch with no scene playing should still capture");
        var leaving = new ScenePlayer(game, cell);
        var after = new List<string>();
        leaving.SceneFinished += next => after.Add(next);
        leaving.Start();
        leaving.Advance();
        if (!game.Held.IsNone || after.Count != 1) Fail("out of the cell should finish it");
        Console.WriteLine("caught in play: " + string.Join(",", caught));
        // The cell built in the level: its door plays the puzzle's Cell door, shut until the lock is picked with the nail.
        game.Reset();
        var level = LevelLogic.FromJson(File.ReadAllText("Assets/VCGS/Generated/Levels/sunken_vault.json"), game);
        var door = "";
        foreach (var g in level.Items.Keys) if (D.Map(level.Item(g), "door_object").Count > 0) door = g;
        if (door == "") Fail("the built cell's door should play the cell door");
        else
        {
            if (level.IsOpen(door) || level.Offer(door)?.Blocked == "") Fail("the cell door should be shut and locked, got " + level.Offer(door)?.Verb);
            Console.WriteLine("cell door: " + level.Offer(door)?.Blocked);
            game.GiveItem("bent_nail", 1);
            if (level.Offer(door)?.Verb != "Pick the lock") Fail("with the nail the door should offer to pick the lock, got " + level.Offer(door)?.Verb);
            level.Interact(door);
            if (level.IsOpen(door) || level.Offer(door)?.Verb != "Open") Fail("picked, the door should be closed and ready to open, got " + level.Offer(door)?.Verb);
            level.Interact(door);
            if (!level.IsOpen(door) || level.Offer(door) != null) Fail("opened, the door should be open and out of the way");
            Console.WriteLine("cell door opened: " + game.GetObjectState("cell_door"));
        }
        // The cell's guard, spawned as the studio placed it: it walks the Cell watch, standing at each stop as long as it says.
        var cast = VcgsCast.Load(File.ReadAllText("Assets/VCGS/Generated/characters.json"));
        Dictionary<string, object> post = null;
        foreach (var p in VcgsCast.Placements(cast))
            foreach (var m in D.List(p, "members"))
                if (D.Str(D.Map(m), "character") == "orc_sentry" && D.List(D.Map(m), "route").Count > 0) post = p;
        if (post == null) Fail("the cell's guard should be placed on its round");
        else
        {
            var spawner = new UnityEngine.GameObject("Cell watch").AddComponent<VcgsSpawnGroup>();
            spawner.itemGuid = D.Str(post, "item");
            var guard = spawner.Spawn(cast)[0];
            var reached = new HashSet<int>();
            double still = 0, longest = 0;
            var last = guard.PlanPosition();
            for (var tick = 0; tick < 600; tick++)
            {
                guard.Behavior.Tick(0.1f);
                var at = guard.PlanPosition();
                for (var k = 0; k < guard.route.Count; k++)
                    if (Math.Abs(at[0] - guard.route[k].x) < 0.3 && Math.Abs(at[1] - guard.route[k].z) < 0.3) reached.Add(k);
                still = Math.Abs(at[0] - last[0]) < 1e-6 && Math.Abs(at[1] - last[1]) < 1e-6 ? still + 0.1 : 0;
                longest = Math.Max(longest, still);
                last = at;
            }
            Console.WriteLine("guard round: " + guard.Behavior.State + " · stops reached " + reached.Count + " of " + guard.route.Count + " · waits " + string.Join(",", guard.routeWait) + " · longest stand " + longest.ToString("0.0") + " s");
            if (reached.Count != guard.route.Count || guard.routeWait.Count != guard.route.Count || longest < 4 || longest > 5.5) Fail("the guard should walk every stop of the Cell watch, standing at them as long as they say");
        }
        return failures == 0 ? 0 : 1;
    }
}
