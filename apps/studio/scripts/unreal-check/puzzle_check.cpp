// Plays the sample's built-in puzzle templates with the VCGS Runtime for
// Unreal's core (puzzle spec §6–§10): the same walk as the Godot and Unity
// puzzle checks.
#include "VcgsCore.h"
#include <cstdio>
#include <fstream>
#include <sstream>

static int failures = 0;

static void Fail(const std::string& message)
{
    failures++;
    std::fprintf(stderr, "FAIL: %s\n", message.c_str());
}

static std::string Join(const std::vector<std::string>& list, const char* sep)
{
    std::string out;
    for (size_t i = 0; i < list.size(); i++) out += (i ? sep : "") + list[i];
    return out;
}

static vcgs::Value J(const std::string& text) { return vcgs::JsonReader::Parse(text); }

static std::string Step(const vcgs::Story& story, const std::string& puzzle, const std::string& label)
{
    for (const auto& s : vcgs::Story::Find(story.Objects, puzzle)["design"]["steps"].items)
        if (s["label"].Str() == label) return s["id"].Str();
    Fail(puzzle + " has no step " + label);
    return "";
}

int main()
{
    std::ifstream in("Content/VCGS/Generated/story.json");
    std::stringstream buffer;
    buffer << in.rdbuf();
    std::string error;
    vcgs::Value root = vcgs::JsonReader::Parse(buffer.str(), &error);
    if (!root.IsObject()) { Fail("story.json did not parse: " + error); return 1; }
    vcgs::Story story(std::move(root));
    vcgs::GameState game(story);
    std::vector<std::string> steps, hints, cues, asked;
    game.OnPuzzleStep = [&](const std::string&, const std::string&, const std::string& what) { steps.push_back(what); };
    game.OnHint = [&](const std::string&, const std::string& text) { hints.push_back(text); };
    game.OnPuzzleCue = [&](const std::string&, const std::string& kind, const std::string& text, const std::string&) { cues.push_back(kind + ": " + text); };
    game.OnScreenRequested = [&](const std::string& obj, const std::string& verb) { asked.push_back(obj + ":" + verb); };
    using vcgs::Interactions::AnswerScreen;
    using vcgs::Interactions::Interact;

    // The Safe code: its keypad comes up; a wrong code counts and gives the first hint.
    if (!Interact(game, "safe", "Enter code") || Join(asked, ",") != "safe:Enter code" || game.GetObjectState("safe") != "Locked") Fail("Enter code should ask for the safe's screen and change nothing");
    if (AnswerScreen(game, "safe", J("\"1111\"")) || game.ScreenFails["safe"] != 1) Fail("a wrong code should be wrong, and counted");
    if (Join(hints, "|") != "The painting hangs a little crooked.") Fail("the first wrong code should give the first hint, got " + Join(hints, "|"));
    Interact(game, "painting", "Inspect");
    Interact(game, "desk_drawer", "Open");
    const std::string work = Step(story, "safe_code", "Work out the code"), enter = Step(story, "safe_code", "Enter the code");
    if (!game.StepDone("safe_code", work) || game.StepDone("safe_code", enter) || game.Solved.count("safe_code")) Fail("the clues should work out the code, and the code not be entered yet");
    if (!AnswerScreen(game, "safe", J("\"4271\"")) || game.GetObjectState("safe") != "Open" || Join(vcgs::Interactions::AvailableVerbs(game, "safe"), ",") != "Inspect,Take") Fail("the right code should open the safe, got " + game.GetObjectState("safe"));
    if (!game.StepDone("safe_code", enter) || !game.Solved.count("safe_code")) Fail("entering the code should solve the Safe code");
    if (Join(cues, "|") != "audio: A heavy click|animation: The safe door swings open") Fail("solving it should play its cues, got " + Join(cues, "|"));
    std::printf("safe: hints %s · cues %s\n", Join(hints, "|").c_str(), Join(cues, "|").c_str());

    // Out of tries, a screen takes no more answers.
    game.Reset();
    for (int i = 0; i < 3; i++) AnswerScreen(game, "safe", J("\"0000\""));
    if (!vcgs::Interactions::ScreenLocked(game, "safe") || AnswerScreen(game, "safe", J("\"4271\"")) || game.GetObjectState("safe") != "Locked") Fail("three wrong codes should jam the keypad");
    if (game.Hinted.size() != 2) Fail("two wrong codes and more should give both hints");

    // Plates in order, within 10 seconds.
    game.Reset();
    steps.clear();
    const std::string sun = Step(story, "plates_in_order", "The sun plate"), moon = Step(story, "plates_in_order", "The moon plate");
    game.SetObjectState("moon_plate", "Down");
    if (game.StepDone("plates_in_order", moon)) Fail("the moon plate before the sun should wait");
    game.SetObjectState("moon_plate", "Up");
    game.SetObjectState("sun_plate", "Down");
    if (!game.StepDone("plates_in_order", sun)) Fail("the sun plate should be done");
    game.AdvanceClock(11);
    if (game.StepDone("plates_in_order", sun) || std::find(steps.begin(), steps.end(), "expired") == steps.end()) Fail("ten seconds on, the sequence should run out");
    game.SetObjectState("moon_plate", "Down");
    if (game.StepDone("plates_in_order", sun)) Fail("a plate left down should need stepping on again");
    game.SetObjectState("sun_plate", "Up");
    game.SetObjectState("moon_plate", "Up");
    for (const char* plate : {"sun_plate", "moon_plate", "star_plate"})
    {
        game.SetObjectState(plate, "Down");
        game.AdvanceClock(1);
    }
    if (!game.Solved.count("plates_in_order")) Fail("the plates in order, in time, should solve it");
    std::printf("plates: %s\n", Join(steps, ", ").c_str());

    // Lever and door, and a save that keeps the progress.
    game.Reset();
    const std::string pull = Step(story, "lever_and_door", "Pull the lever");
    game.SetObjectState("door", "Open");
    if (game.StepDone("lever_and_door", Step(story, "lever_and_door", "Open the door"))) Fail("the door should need the lever first");
    game.SetObjectState("door", "Locked");
    Interact(game, "lever", "Pull");
    if (!game.StepDone("lever_and_door", pull) || game.GetObjectState("door") != "Closed") Fail("pulling the lever should unlock the door and do its step");
    const std::string saved = game.SaveText(story.Name);
    game.Reset();
    std::string at;
    game.LoadSave(saved, at);
    if (!game.StepDone("lever_and_door", pull)) Fail("a save should keep the puzzle's progress");
    Interact(game, "door", "Open");
    if (!game.Solved.count("lever_and_door")) Fail("opening the door after the lever should solve it");

    // Every screen kind's answer, checked.
    const char* cases[][3] = {
        {R"({"kind": "dial", "combination": [12, 30, 7]})", "[12, 30, 7]", "[12, 7, 30]"},
        {R"({"kind": "symbols", "answer": ["a", "b"]})", R"(["a", "b"])", R"(["b", "a"])"},
        {R"({"kind": "custom", "text": "Answer"})", R"(" answer ")", R"("nope")"},
        {R"({"kind": "ordering", "items": ["Dawn", "Dusk"]})", R"(["Dawn", "Dusk"])", R"(["Dusk", "Dawn"])"},
        {R"({"kind": "matching", "pairs": [{"left": "Lion", "right": "Sun"}, {"left": "Hare", "right": "Moon"}]})", R"(["Sun", "Moon"])", R"(["Moon", "Sun"])"},
        {R"({"kind": "assembly", "slots": [{"id": "s1", "accepts": "p1"}]})", R"({"s1": "p1"})", R"({"s1": "p2"})"},
        {R"({"kind": "levers", "target": [true, false]})", "[true, false]", "[true, true]"},
        {R"({"kind": "rings", "rings": 2, "segments": 8})", "[0, 8]", "[0, 1]"},
        {R"({"kind": "tiles", "size": 2})", "[1, 2, 3, 0]", "[1, 3, 2, 0]"},
        {R"({"kind": "circuit", "width": 3, "height": 1, "source": 0, "sink": 2, "cells": [{"piece": "end", "rot": 1}, {"piece": "straight", "rot": 1}, {"piece": "end", "rot": 3}]})", "[1, 1, 3]", "[1, 0, 3]"},
    };
    for (const auto& c : cases)
    {
        const vcgs::Value screen = J(c[0]);
        if (!vcgs::PuzzleRuntime::CheckScreen(screen, J(c[1])) || vcgs::PuzzleRuntime::CheckScreen(screen, J(c[2]))) Fail("the " + screen["kind"].Str() + " screen should take the right answer only");
    }
    const auto flipped = vcgs::PuzzleRuntime::Flip(J(R"({"links": [[1], [0]]})"), {false, false}, 0);
    if (!(flipped[0] && flipped[1])) Fail("a switch should flip the ones it is linked to");
    std::printf("screens: %zu kinds checked\n", sizeof cases / sizeof cases[0]);

    if (failures)
    {
        std::fprintf(stderr, "%d puzzle check(s) failed\n", failures);
        return 1;
    }
    std::printf("puzzles OK\n");
    return 0;
}
