// Plays the sample project's generated story with the VCGS Runtime for
// Unreal's core: the same walk as the Godot and Unity checks.
#include "VcgsCore.h"
#include "VcgsLevel.h"
#include "Generated/VcgsStoryKeys.h"
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

// The level: its rules on the story's state, the same walk as Godot and Unity.
static void CheckLevel(const vcgs::Story& story)
{
    std::ifstream in("Content/VCGS/Generated/Levels/sunken_vault.json");
    std::stringstream buffer;
    buffer << in.rdbuf();
    std::string error;
    vcgs::Value data = vcgs::JsonReader::Parse(buffer.str(), &error);
    if (!data.IsObject()) { Fail("sunken_vault.json did not parse: " + error); return; }
    vcgs::GameState game(story);
    vcgs::LevelLogic level(std::move(data), game);
    std::printf("level: %s · %zu items\n", level.ExportName.c_str(), level.Order.size());
    const std::string door = level.GuidOf("INT_VaultChamber_BronzeDoor_004");
    const std::string key = level.GuidOf("INV_SiltCamp_VaultKey_001");
    const std::string lever = level.GuidOf("INT_VaultChamber_RustedLever_005");
    const std::string seam = level.GuidOf("TRG_VaultChamber_FloodedSeam_001");
    const std::string trigger = level.GuidOf("TRG_VaultChamber_DoorInTheDarkTrigger_002");
    if (level.Offer(door).Blocked != "Locked. Needs Vault Key.") Fail("the bronze door should be locked until the key is held, got " + level.Offer(door).Blocked);
    level.Interact(key);
    if (!game.HasItem(VcgsKeys::Items::VaultKey) || level.IsPresent(key)) Fail("taking the key should give the story's key and take it out of the level");
    level.Interact(door);
    if (!level.IsOpen(door)) Fail("with the key, the bronze door should open");
    std::vector<std::string> cinematics;
    level.OnCinematic = [&](const std::string& c) { cinematics.push_back(c); };
    level.Enter(trigger);
    level.Exit(trigger);
    level.Enter(trigger);
    if (Join(cinematics, ",") != VcgsKeys::Cinematics::DoorInTheDark) Fail("the chamber should play Door in the dark once, got " + Join(cinematics, ","));
    if (!level.IsPresent(seam)) Fail("the seam should be flooded before the lever");
    level.Interact(lever);
    if (game.GetObjectState(VcgsKeys::Objects::RustedLever) != "up" || !game.Solved.count(VcgsKeys::Puzzles::TheVaultDoor)) Fail("the lever should go up and, through the story, solve the door");
    if (level.IsPresent(seam) || level.IsPresent(door)) Fail("once solved, the seam drains and the bronze door gives way");
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
    std::printf("story: %s · %zu scenes · starts at %s\n", story.Name.c_str(), story.Scenes.size(), story.Start.c_str());

    using namespace VcgsKeys;
    if (game.GetFlag(Flags::DoorSolved) != "no") Fail("door_solved should start at no");
    if (game.GetObjectState(Objects::RustedLever) != "down") Fail("the lever should start down");
    if (vcgs::StoryWalker::Onward(game, story.Start) != Scenes::Sc01TheCaveMouth) Fail("the story should start at SC-01");

    game.GiveItem(Items::VaultKey);
    std::vector<std::string> trace, finished;
    std::vector<std::vector<std::string>> choices;
    {
        vcgs::ScenePlayer player(game, Scenes::Sc03TheVaultDoor);
        player.OnEvent = [&](const vcgs::Value& e) { trace.push_back(e["kind"].Str() + ":" + e["label"].Str()); };
        player.OnChoice = [&](const std::string&, const std::vector<std::string>& options) { choices.push_back(options); };
        player.OnFinished = [&](const std::string& next) { finished.push_back(next); };
        std::vector<std::pair<std::string, std::string>> duals;
        std::vector<std::string> singles;
        player.OnDual = [&](const std::string& a, const std::string& b) { duals.emplace_back(a, b); };
        player.OnDialogue = [&](const std::string& l) { singles.push_back(l); };
        player.Start();
        if (!game.Visited.count(Scenes::Sc03TheVaultDoor)) Fail("starting the scene should mark it visited");
        // The cinematic, then Mara and the Explorer at once (dual dialogue: one beat), then the echo cue.
        for (int i = 0; i < 3; i++) player.Advance();
        if (duals.size() != 1 || !singles.empty()) Fail("Mara and the Explorer should speak at once, as one beat");
        else
        {
            const std::string first = vcgs::StoryWalker::GetLine(game, duals[0].first).Speaker;
            const std::string second = vcgs::StoryWalker::GetLine(game, duals[0].second).Speaker;
            std::printf("dual: %s + %s\n", first.c_str(), second.c_str());
            if (first != "Mara" || second != "The Explorer") Fail("the pair should be Mara (left) then the Explorer");
        }
        if (!choices.empty()) Fail("the choice should wait for the free play to end");
        if (Join(vcgs::Interactions::AvailableVerbs(game, Objects::RustedLever), ",") != "Pull") Fail("the lever should offer Pull");
        if (!vcgs::Interactions::Interact(game, Objects::RustedLever, "Pull")) Fail("Pull should work");
        if (game.GetObjectState(Objects::RustedLever) != "up" || game.GetFlag(Flags::DoorSolved) != "yes") Fail("Pull should leave the lever up and set door_solved");
        if (!game.Fired.count(Triggers::SeamDrains) || !game.Solved.count(Puzzles::TheVaultDoor)) Fail("the lever should fire Seam drains and solve the door");
        if (choices.size() != 1) Fail("free play should end into the choice");
        player.Choose(1);
        player.Advance();
        player.Advance();
        if (player.OptionsDetail.size() != 1) Fail("the options list should hold only Turn the key now");
        player.Choose(0);
    }
    std::printf("trace: %s\n", Join(trace, " > ").c_str());
    std::vector<std::string> shown;
    for (const auto& c : choices) shown.push_back(Join(c, ", "));
    std::printf("options: %s\nfinished: %s\n", Join(shown, " | ").c_str(), Join(finished, ", ").c_str());
    if (choices.size() != 2 || Join(choices[0], ",") != "Turn the key,Force it") Fail("the choice should offer Turn the key and Force it first");
    if (choices.size() == 2 && Join(choices[1], ",") != "Turn the key") Fail("Force it should be gone the second time");
    if (finished.size() != 1 || finished[0] != Cinematics::TheVaultOpens) Fail("the scene should end into the cinematic");
    if (game.HasItem(Items::VaultKey) || game.Arc(Characters::Mara) != 1) Fail("turning the key should use it up and move Mara +1");

    const std::string ring = vcgs::StoryWalker::Onward(game, finished.empty() ? "" : finished[0]);
    if (vcgs::StoryWalker::KindOf(game, ring) != "choice") Fail("after the cinematic comes the ring choice");
    std::vector<std::string> labels;
    std::vector<int> offered = vcgs::StoryWalker::Offered(game, ring);
    for (int i : offered) labels.push_back(vcgs::StoryWalker::OptionLabel(game, ring, i));
    if (Join(labels, ",") != "Carry on,Pocket it") Fail("the ring choice should offer Carry on and Pocket it");
    const std::string end = offered.empty() ? "" : vcgs::StoryWalker::Choose(game, ring, offered[0]);
    if (vcgs::StoryWalker::KindOf(game, end) != "end") Fail("carrying on should reach the end");
    if (vcgs::StoryWalker::GetLine(game, "sc_03_line_02").Speaker != "Mara") Fail("line 2 should be Mara's");

    CheckLevel(story);

    std::printf("%s\n", failures == 0 ? "OK" : (std::to_string(failures) + " FAILED").c_str());
    return failures == 0 ? 0 : 1;
}
