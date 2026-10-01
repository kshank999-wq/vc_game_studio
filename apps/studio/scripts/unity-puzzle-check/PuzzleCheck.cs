// Plays the sample's built-in puzzle templates with the VCGS Runtime for Unity
// (puzzle spec §6–§10): the same walk as the Godot puzzle check.
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;

static class PuzzleCheck
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static string Step(Story story, string puzzle, string label)
    {
        foreach (var s in D.List(D.Map(story.Objects[puzzle], "design"), "steps"))
            if (D.Str(D.Map(s), "label") == label) return D.Str(D.Map(s), "id");
        Fail(puzzle + " has no step " + label);
        return "";
    }

    static List<object> L(params object[] items) => new List<object>(items);

    static int Main()
    {
        var story = Story.FromJson(File.ReadAllText("Assets/VCGS/Generated/story.json"));
        var game = new GameState(story);
        var steps = new List<string>();
        var hints = new List<string>();
        var cues = new List<string>();
        var asked = new List<string>();
        game.PuzzleStep += (p, s, what) => steps.Add(what);
        game.HintGiven += (p, text) => hints.Add(text);
        game.PuzzleCue += (p, kind, text, what) => cues.Add(kind + ": " + text);
        game.ScreenRequested += (o, verb) => asked.Add(o + ":" + verb);

        // The Safe code: its keypad comes up; a wrong code counts and gives the first hint.
        if (!Interactions.Interact(game, "safe", "Enter code") || string.Join(",", asked) != "safe:Enter code" || game.GetObjectState("safe") != "Locked")
            Fail("Enter code should ask for the safe's screen and change nothing");
        if (Interactions.AnswerScreen(game, "safe", "1111") || !game.ScreenFails.TryGetValue("safe", out var f) || f != 1) Fail("a wrong code should be wrong, and counted");
        if (string.Join("|", hints) != "The painting hangs a little crooked.") Fail("the first wrong code should give the first hint, got " + string.Join("|", hints));
        Interactions.Interact(game, "painting", "Inspect");
        Interactions.Interact(game, "desk_drawer", "Open");
        var work = Step(story, "safe_code", "Work out the code");
        var enter = Step(story, "safe_code", "Enter the code");
        if (!game.StepDone("safe_code", work) || game.StepDone("safe_code", enter) || game.Solved.Contains("safe_code")) Fail("the clues should work out the code, and the code not be entered yet");
        if (!Interactions.AnswerScreen(game, "safe", "4271") || game.GetObjectState("safe") != "Open" || string.Join(",", Interactions.AvailableVerbs(game, "safe")) != "Inspect,Take")
            Fail("the right code should open the safe, got " + game.GetObjectState("safe"));
        if (!game.StepDone("safe_code", enter) || !game.Solved.Contains("safe_code")) Fail("entering the code should solve the Safe code");
        if (string.Join("|", cues) != "audio: A heavy click|animation: The safe door swings open") Fail("solving it should play its cues, got " + string.Join("|", cues));
        Console.WriteLine("safe: hints " + string.Join("|", hints) + " · cues " + string.Join("|", cues));

        // Out of tries, a screen takes no more answers.
        game.Reset();
        for (var i = 0; i < 3; i++) Interactions.AnswerScreen(game, "safe", "0000");
        if (!Interactions.ScreenLocked(game, "safe") || Interactions.AnswerScreen(game, "safe", "4271") || game.GetObjectState("safe") != "Locked") Fail("three wrong codes should jam the keypad");
        if (game.Hinted.Count != 2) Fail("two wrong codes and more should give both hints, got " + game.Hinted.Count);

        // Plates in order, within 10 seconds.
        game.Reset();
        steps.Clear();
        var sun = Step(story, "plates_in_order", "The sun plate");
        var moon = Step(story, "plates_in_order", "The moon plate");
        game.SetObjectState("moon_plate", "Down");
        if (game.StepDone("plates_in_order", moon)) Fail("the moon plate before the sun should wait");
        game.SetObjectState("moon_plate", "Up");
        game.SetObjectState("sun_plate", "Down");
        if (!game.StepDone("plates_in_order", sun)) Fail("the sun plate should be done");
        game.AdvanceClock(11);
        if (game.StepDone("plates_in_order", sun) || !steps.Contains("expired")) Fail("ten seconds on, the sequence should run out");
        game.SetObjectState("moon_plate", "Down");
        if (game.StepDone("plates_in_order", sun)) Fail("a plate left down should need stepping on again");
        game.SetObjectState("sun_plate", "Up");
        game.SetObjectState("moon_plate", "Up");
        foreach (var plate in new[] { "sun_plate", "moon_plate", "star_plate" })
        {
            game.SetObjectState(plate, "Down");
            game.AdvanceClock(1);
        }
        if (!game.Solved.Contains("plates_in_order")) Fail("the plates in order, in time, should solve it");
        Console.WriteLine("plates: " + string.Join(", ", steps));

        // Lever and door, and a save that keeps the progress (in the format every engine reads).
        game.Reset();
        var pull = Step(story, "lever_and_door", "Pull the lever");
        game.SetObjectState("door", "Open");
        if (game.StepDone("lever_and_door", Step(story, "lever_and_door", "Open the door"))) Fail("the door should need the lever first");
        game.SetObjectState("door", "Locked");
        Interactions.Interact(game, "lever", "Pull");
        if (!game.StepDone("lever_and_door", pull) || game.GetObjectState("door") != "Closed") Fail("pulling the lever should unlock the door and do its step");
        var saved = game.SaveText(story.Name);
        game.Reset();
        game.LoadSave(saved);
        if (!game.StepDone("lever_and_door", pull)) Fail("a save should keep the puzzle's progress");
        Interactions.Interact(game, "door", "Open");
        if (!game.Solved.Contains("lever_and_door")) Fail("opening the door after the lever should solve it");

        // Every screen kind's answer, checked.
        Dictionary<string, object> M(params (string k, object v)[] e)
        {
            var d = new Dictionary<string, object>();
            foreach (var (k, v) in e) d[k] = v;
            return d;
        }
        var cases = new (Dictionary<string, object> screen, object right, object wrong)[]
        {
            (M(("kind", "dial"), ("combination", L(12.0, 30.0, 7.0))), L(12.0, 30.0, 7.0), L(12.0, 7.0, 30.0)),
            (M(("kind", "symbols"), ("answer", L("a", "b"))), L("a", "b"), L("b", "a")),
            (M(("kind", "custom"), ("text", "Answer")), " answer ", "nope"),
            (M(("kind", "ordering"), ("items", L("Dawn", "Dusk"))), L("Dawn", "Dusk"), L("Dusk", "Dawn")),
            (M(("kind", "matching"), ("pairs", L(M(("left", "Lion"), ("right", "Sun")), M(("left", "Hare"), ("right", "Moon"))))), L("Sun", "Moon"), L("Moon", "Sun")),
            (M(("kind", "assembly"), ("slots", L(M(("id", "s1"), ("accepts", "p1"))))), M(("s1", "p1")), M(("s1", "p2"))),
            (M(("kind", "levers"), ("target", L(true, false))), L(true, false), L(true, true)),
            (M(("kind", "rings"), ("rings", 2.0), ("segments", 8.0)), L(0.0, 8.0), L(0.0, 1.0)),
            (M(("kind", "tiles"), ("size", 2.0)), L(1.0, 2.0, 3.0, 0.0), L(1.0, 3.0, 2.0, 0.0)),
            (M(("kind", "circuit"), ("width", 3.0), ("height", 1.0), ("source", 0.0), ("sink", 2.0), ("cells", L(M(("piece", "end"), ("rot", 1.0)), M(("piece", "straight"), ("rot", 1.0)), M(("piece", "end"), ("rot", 3.0))))), L(1.0, 1.0, 3.0), L(1.0, 0.0, 3.0)),
        };
        foreach (var (screen, right, wrong) in cases)
            if (!PuzzleRuntime.CheckScreen(screen, right) || PuzzleRuntime.CheckScreen(screen, wrong)) Fail("the " + D.Str(screen, "kind") + " screen should take the right answer only");
        if (!PuzzleRuntime.Flip(M(("links", L(L(1.0), L(0.0)))), new List<bool> { false, false }, 0).TrueForAll(x => x)) Fail("a switch should flip the ones it is linked to");
        Console.WriteLine("screens: " + cases.Length + " kinds checked");

        if (failures > 0)
        {
            Console.Error.WriteLine(failures + " puzzle check(s) failed");
            return 1;
        }
        Console.WriteLine("puzzles OK");
        return 0;
    }
}
