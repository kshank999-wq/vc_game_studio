// Plays the sample project's generated story with the VCGS Runtime for Unity:
// the same walk as the Godot check (lever, trigger, puzzle, free play, the
// choice and its once-only option, the ending).
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;
using VCGS.Keys;

static class Check
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
        Console.WriteLine("story: " + story.Name + " · " + story.Scenes.Count + " scenes · starts at " + story.Start);
        if (game.GetFlag(Flags.DoorSolved) != "no") Fail("door_solved should start at no");
        if (game.GetObjectState(Objects.RustedLever) != "down") Fail("the lever should start down");

        // The whole story from the Beginning to the vault door.
        var node = StoryWalker.Onward(game, story.Start);
        if (node != Scenes.Sc01TheCaveMouth) Fail("the story should start at SC-01, got " + node);

        game.GiveItem(Items.VaultKey);
        var player = new ScenePlayer(game, Scenes.Sc03TheVaultDoor);
        var trace = new List<string>();
        var choices = new List<List<string>>();
        var finished = new List<string>();
        player.EventStarted += e => trace.Add(D.Str(e, "kind") + ":" + D.Str(e, "label"));
        player.ChoiceRequested += (key, options) => choices.Add(options);
        player.SceneFinished += next => finished.Add(next);
        player.Start();
        if (!game.Visited.Contains(Scenes.Sc03TheVaultDoor)) Fail("starting the scene should mark it visited");
        for (var i = 0; i < 4; i++) player.Advance();
        if (choices.Count != 0) Fail("the choice should wait for the free play to end");
        if (string.Join(",", Interactions.AvailableVerbs(game, Objects.RustedLever)) != "Pull") Fail("the lever should offer Pull");
        if (!Interactions.Interact(game, Objects.RustedLever, "Pull")) Fail("Pull should work");
        if (game.GetObjectState(Objects.RustedLever) != "up" || game.GetFlag(Flags.DoorSolved) != "yes") Fail("Pull should leave the lever up, and draining should set door_solved");
        if (!game.Fired.Contains(Triggers.SeamDrains) || !game.Solved.Contains(Puzzles.TheVaultDoor)) Fail("the lever should fire Seam drains and solve the door");
        if (choices.Count != 1) Fail("free play should end into the choice");
        player.Choose(1);
        player.Advance();
        player.Advance();
        player.Choose(0);
        Console.WriteLine("trace: " + string.Join(" > ", trace));
        Console.WriteLine("options: " + string.Join(" | ", choices.ConvertAll(c => string.Join(", ", c))));
        Console.WriteLine("finished: " + string.Join(", ", finished));
        if (choices.Count != 2 || string.Join(",", choices[0]) != "Turn the key,Force it") Fail("the choice should offer Turn the key and Force it first");
        if (choices.Count == 2 && string.Join(",", choices[1]) != "Turn the key") Fail("Force it should be gone the second time");
        if (finished.Count != 1 || finished[0] != Cinematics.TheVaultOpens) Fail("the scene should end into the cinematic");
        if (game.HasItem(Items.VaultKey) || game.Arc(Characters.Mara) != 1) Fail("turning the key should use it up and move Mara +1");

        // On along the graph: the cinematic, then the ring choice, to the ending.
        var ring = StoryWalker.Onward(game, finished[0]);
        if (StoryWalker.KindOf(game, ring) != "choice") Fail("after the cinematic comes the ring choice, got " + ring);
        var offered = StoryWalker.Offered(game, ring);
        var labels = offered.ConvertAll(i => StoryWalker.OptionLabel(game, ring, i));
        if (string.Join(",", labels) != "Carry on,Pocket it") Fail("the ring choice should offer Carry on and Pocket it, got " + string.Join(",", labels));
        var end = StoryWalker.Choose(game, ring, offered[0]);
        if (StoryWalker.KindOf(game, end) != "end") Fail("carrying on should reach the end, got " + end);

        var line = StoryWalker.Line(game, "sc_03_line_02");
        if (line.speaker != "Mara") Fail("line 2 should be Mara's, got " + line.speaker);

        Console.WriteLine(failures == 0 ? "OK" : failures + " FAILED");
        return failures == 0 ? 0 : 1;
    }
}
