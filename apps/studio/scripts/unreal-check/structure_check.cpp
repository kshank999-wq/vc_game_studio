// The Old Tomb with the VCGS Runtime for Unreal's core (structure spec §7,
// §10, §14): the same walk as the Godot and Unity structure checks. The
// studio's own walk through it (structure_expect.json), step for step: what
// Interact offers at each door, which doors are open, the objectives done,
// the completion and its effect on the story, and what the tomb remembers when
// the player leaves and comes back.
#include "VcgsCore.h"
#include "VcgsLevel.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <memory>
#include <sstream>

static int failures = 0;

static void Fail(const std::string& message)
{
    failures++;
    std::fprintf(stderr, "FAIL: %s\n", message.c_str());
}

static std::string Text(const char* path)
{
    std::ifstream in(path);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

static void Check(const vcgs::LevelLogic& level, const vcgs::GameState& game, const vcgs::Value& step, int n)
{
    const vcgs::Value& want = step["expect"];
    const std::string what = "step " + std::to_string(n) + " (" + step["do"].Str() + " " + step["guid"].Str() + ")";
    if (want.Has("verb"))
    {
        const vcgs::LevelOffer o = level.Offer(step["guid"].Str());
        const std::string verb = o.Any ? o.Verb : "";
        const std::string blocked = o.Any ? o.Blocked : "";
        if (verb != want["verb"].Str() || blocked != want["blocked"].Str()) Fail(what + ": offers " + verb + " / " + blocked + ", the studio " + want["verb"].Str() + " / " + want["blocked"].Str());
    }
    for (const auto& f : want["open"].fields)
        if (level.IsOpen(f.first) != f.second.boolean) Fail(what + ": " + level.Item(f.first)["name"].Str() + " should be " + (f.second.boolean ? "open" : "shut"));
    if (want.Has("objectives"))
    {
        std::vector<std::string> done(level.ObjectivesDone.begin(), level.ObjectivesDone.end());
        std::vector<std::string> expected;
        for (const auto& o : want["objectives"].items) expected.push_back(o.Str());
        if (done != expected) Fail(what + ": the objectives done differ from the studio's");
    }
    if (want.Has("complete") && level.Complete != want["complete"].boolean) Fail(what + ": complete differs from the studio's");
    for (const auto& f : want["present"].fields)
        if (level.IsPresent(f.first) != f.second.boolean) Fail(what + ": " + level.Item(f.first)["name"].Str() + " should " + (f.second.boolean ? "be there" : "be gone"));
    // Health within a tick of the studio's: a trap's cycle can fall either side of a tick.
    if (want.Has("health") && std::fabs(level.Health - want["health"].Num(0)) > 6) Fail(what + ": health differs from the studio's");
    for (const auto& f : want["items"].fields)
    {
        auto it = game.Items.find(f.first);
        const int has = it == game.Items.end() ? 0 : it->second;
        if (has != static_cast<int>(f.second.Num(0))) Fail(what + ": carries " + std::to_string(has) + " of " + f.first + ", the studio " + std::to_string(static_cast<int>(f.second.Num(0))));
    }
    for (const auto& f : want["flags"].fields)
        if (game.GetFlag(f.first) != f.second.Str()) Fail(what + ": " + f.first + " is " + game.GetFlag(f.first) + ", the studio " + f.second.Str());
}

int main()
{
    std::string error;
    vcgs::Value root = vcgs::JsonReader::Parse(Text("Content/VCGS/Generated/story.json"), &error);
    if (!root.IsObject()) { Fail("story.json did not parse: " + error); return 1; }
    vcgs::Story story(std::move(root));
    vcgs::GameState game(story);
    const vcgs::Value expect = vcgs::JsonReader::Parse(Text("structure_expect.json"), &error);
    const std::string path = "Content/VCGS/Generated/Levels/" + expect["level"].Str() + ".json";
    const std::string json = Text(path.c_str());
    auto level = std::make_unique<vcgs::LevelLogic>(vcgs::JsonReader::Parse(json, &error), game);
    const vcgs::Value& s = level->Structure();
    if (s["name"].Str() != "Old Tomb" || s["doors"].Size() != 6 || s["objectives"].Size() != 2) Fail("the level data should carry the Old Tomb's manifest");
    if (level->Objective != "Find the Tomb Key") Fail("the first objective should be shown, got " + level->Objective);
    int n = 0;
    for (const auto& step : expect["steps"].items)
    {
        n++;
        const vcgs::Value& at = step["at"];
        auto place = [&](vcgs::LevelLogic& l) { l.HasPlayer = true; l.PlayerX = at[0].Num(0); l.PlayerY = at[1].Num(0); l.PlayerZ = at[2].Num(0); };
        place(*level);
        // What the player came into and left: in a game the physics says so.
        for (const auto& g : step["exit"].items) level->Exit(g.Str());
        for (const auto& g : step["enter"].items) level->Enter(g.Str());
        const std::string act = step["do"].Str();
        if (act == "interact")
        {
            level->Interact(step["guid"].Str());
            level->Tick(0.05);
        }
        else if (act == "wait")
        {
            for (double left = step["seconds"].Num(0); left > 1e-6; left -= 0.25) level->Tick(std::min(0.25, left));
        }
        else if (act == "remember")
        {
            // Out of the tomb and back in: what the director does as the level ends and begins play again.
            vcgs::LevelLogic::Places()[level->Key] = level->Remember();
            level = std::make_unique<vcgs::LevelLogic>(vcgs::JsonReader::Parse(json, &error), game);
            place(*level);
        }
        Check(*level, game, step, n);
    }
    std::printf("structure: %d steps · %zu objectives done · complete %s\n", n, level->ObjectivesDone.size(), level->Complete ? "yes" : "no");
    if (failures) return 1;
    std::printf("structure OK\n");
    return 0;
}
