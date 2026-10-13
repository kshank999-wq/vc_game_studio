// Plays rooms (sub-scenes) with the VCGS Runtime for Unity: the same walk as
// the Godot rooms check. SC-01 The Cave Mouth has The Study, and The Closet
// is inside it.
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;

static class RoomsCheck
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static string Named(Story story, string name)
    {
        foreach (var k in story.Graph.Keys)
            if (D.Str(story.Graph[k], "name") == name) return k;
        Fail("no node named " + name);
        return "";
    }

    static string Labels(GameState game, string choice) =>
        string.Join(",", StoryWalker.Offered(game, choice).ConvertAll(i => StoryWalker.OptionLabel(game, choice, i)));

    static int Main()
    {
        var story = Story.FromJson(File.ReadAllText("Assets/VCGS/Generated/story.json"));
        var game = new GameState(story);
        var cave = Named(story, "The Cave Mouth");
        var where = StoryWalker.Onward(game, cave);
        if (StoryWalker.KindOf(game, where) != "choice") Fail("after The Cave Mouth comes its Where now?, got " + where);
        if (Labels(game, where) != "Go into The Study,Leave The Cave Mouth") Fail("The Cave Mouth's Where now? is wrong: " + Labels(game, where));
        var study = StoryWalker.Choose(game, where, 0);
        if (study != Named(story, "The Study")) Fail("Go into The Study should lead to the study, got " + study);
        var studyWhere = StoryWalker.Onward(game, study);
        if (Labels(game, studyWhere) != "Go into The Closet,Leave The Study") Fail("The Study's Where now? is wrong: " + Labels(game, studyWhere));
        var closet = StoryWalker.Choose(game, studyWhere, 0);
        if (StoryWalker.Onward(game, closet) != studyWhere) Fail("The Closet should lead back to The Study's question");
        if (StoryWalker.Choose(game, studyWhere, 1) != where) Fail("Leave The Study should go back to The Cave Mouth's question");
        // Rooms the player has been in read "(been)" (a scene marks itself visited as it plays).
        if (StoryWalker.OptionLabel(game, where, 0) != "Go into The Study") Fail("The Study should not read been before it is visited");
        game.Visit(study);
        if (Labels(game, where) != "Go into The Study (been),Leave The Cave Mouth") Fail("The Study should read been once visited, got " + Labels(game, where));
        var onward = StoryWalker.Choose(game, where, 1);
        if (onward == "" || onward == where || !story.Graph.ContainsKey(onward)) Fail("Leave The Cave Mouth should go on along the story, got " + onward);
        Console.WriteLine("rooms: " + Labels(game, where) + " · " + Labels(game, studyWhere) + " · then " + D.Str(story.Graph[onward], "name"));
        // Level transitions: each node on the graph says the level of the Level lane it is in.
        var key = Named(story, "The Key");
        if (StoryWalker.LevelOf(game, cave) != "The Flooded Cave" || StoryWalker.LevelOf(game, key) != "The Sunken Vault")
            Fail("the graph should carry each node's level, got " + StoryWalker.LevelOf(game, cave) + " / " + StoryWalker.LevelOf(game, key));
        var entered = new System.Collections.Generic.List<string>();
        game.LevelEntered += (from, to) => entered.Add(from + ">" + to);
        game.Level = "";
        var first = StoryWalker.Arrive(game, cave);
        var again = StoryWalker.Arrive(game, cave);
        var crossing = StoryWalker.Arrive(game, key);
        if (first != "LEVEL · The Flooded Cave" || again != "" || crossing != "End of The Flooded Cave → LEVEL · The Sunken Vault")
            Fail("level transitions are wrong: [" + first + "] [" + again + "] [" + crossing + "]");
        if (string.Join(",", entered) != ">The Flooded Cave,The Flooded Cave>The Sunken Vault") Fail("LevelEntered should fire on each crossing, got " + string.Join(",", entered));
        // The level the player is in is kept in a save.
        game.Checkpoint(key);
        var saved = game.SaveText("check");
        game.Level = "";
        game.LoadSave(saved);
        if (game.Level != "The Sunken Vault") Fail("a save should keep the level, got " + game.Level);
        Console.WriteLine("levels: " + first + " · " + crossing);
        if (failures > 0) return 1;
        Console.WriteLine("rooms OK");
        return 0;
    }
}
