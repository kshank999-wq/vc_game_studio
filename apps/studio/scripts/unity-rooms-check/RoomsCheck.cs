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
        game.LevelEntered += (from, to, map) => entered.Add(from + ">" + to + (map != "" ? "@" + map : ""));
        game.Level = "";
        var first = StoryWalker.Arrive(game, cave);
        var again = StoryWalker.Arrive(game, cave);
        var crossing = StoryWalker.Arrive(game, key);
        if (first != "LEVEL · The Flooded Cave" || again != "" || crossing != "End of The Flooded Cave → LEVEL · The Sunken Vault")
            Fail("level transitions are wrong: [" + first + "] [" + again + "] [" + crossing + "]");
        var vaultMap = StoryWalker.LevelMapOf(game, key);
        if (vaultMap == "" || StoryWalker.LevelMapOf(game, cave) != "") Fail("only The Sunken Vault's nodes should carry its map, got [" + vaultMap + "]");
        if (string.Join(",", entered) != ">The Flooded Cave,The Flooded Cave>The Sunken Vault@" + vaultMap || game.LevelMap != vaultMap)
            Fail("LevelEntered should fire on each crossing with the level's map, got " + string.Join(",", entered));
        // Each level map becomes a scene in Build Settings; a transition loads it in place of the last one.
        var made = VCGS.EditorTools.VcgsLevelBuilder.BuildLevelScenes();
        var scenePath = "Assets/VCGS/Levels/" + vaultMap + ".unity";
        if (!UnityEditor.SceneManagement.EditorSceneManager.saved.Contains(scenePath) || !System.Array.Exists(UnityEditor.EditorBuildSettings.scenes, x => x.path == scenePath))
            Fail("Build each level as a scene should save " + scenePath + " and put it in Build Settings; it did: " + string.Join(" | ", made));
        if (VcgsLevelScenes.Show(vaultMap)) Fail("a level scene not in Build Settings should not load");
        UnityEngine.Application.scenesInBuild.Add(vaultMap);
        UnityEngine.Application.scenesInBuild.Add("other_map");
        if (!VcgsLevelScenes.Show(vaultMap) || !VcgsLevelScenes.Show("other_map")) Fail("level scenes in Build Settings should load");
        var sm = UnityEngine.SceneManagement.SceneManager.loaded;
        if (string.Join(",", sm) != vaultMap + ",other_map" || string.Join(",", UnityEngine.SceneManagement.SceneManager.unloaded) != vaultMap)
            Fail("the next level's scene should load in place of the last, got loaded " + string.Join(",", sm) + " unloaded " + string.Join(",", UnityEngine.SceneManagement.SceneManager.unloaded));
        // The level the player is in is kept in a save.
        game.Checkpoint(key);
        var saved = game.SaveText("check");
        game.Level = "";
        game.LoadSave(saved);
        if (game.Level != "The Sunken Vault") Fail("a save should keep the level, got " + game.Level);
        // The transition between the levels: a cinematic just after Descent, played as the player crosses.
        var descent = Named(story, "Descent");
        var transition = Named(story, "The Flooded Cave → The Sunken Vault");
        if (StoryWalker.Onward(game, descent) != transition || StoryWalker.KindOf(game, transition) != "cinematic" || StoryWalker.TransitionOf(game, transition) != "The Flooded Cave → The Sunken Vault" || StoryWalker.TransitionOf(game, key) != "")
            Fail("the transition cinematic should follow Descent and name the levels it joins, got [" + StoryWalker.TransitionOf(game, transition) + "]");
        game.Level = "The Flooded Cave";
        if (StoryWalker.Arrive(game, descent) != "End of The Flooded Cave → LEVEL · The Sunken Vault" || StoryWalker.Arrive(game, transition) != "")
            Fail("crossing at Descent should change the level once, before its transition plays");
        // Played on its own as the player crosses: the crossing finds it, and it runs its length (3 s with no shots), then finishes.
        if (StoryWalker.TransitionFor(game, "The Flooded Cave", "The Sunken Vault") != transition || StoryWalker.TransitionFor(game, "The Sunken Vault", "The Flooded Cave") != "")
            Fail("the crossing should find its transition cinematic");
        var playback = new TransitionPlayback();
        var finished = "";
        playback.Finished += k => finished = k;
        playback.Start(story, transition, "The Flooded Cave", "The Sunken Vault");
        playback.Advance(1);
        if (!playback.Playing || playback.Title != "[Transition] The Flooded Cave → The Sunken Vault" || playback.Seconds != 3) Fail("the transition should be playing, got " + playback.Title + " " + playback.Seconds);
        playback.Advance(2.5);
        if (playback.Playing || finished != transition) Fail("the transition should finish once its time is up");
        Console.WriteLine("levels: " + first + " · " + crossing + " · scene " + scenePath + " · transition " + StoryWalker.TransitionOf(game, transition));
        if (failures > 0) return 1;
        Console.WriteLine("rooms OK");
        return 0;
    }
}
