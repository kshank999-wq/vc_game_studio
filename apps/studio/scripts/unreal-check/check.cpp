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
    // The quest starts only by an effect (finding the key): not yet.
    if (!game.QuestState(Quests::OpenTheVault).empty()) Fail("Open the vault should wait for its effect, is " + game.QuestState(Quests::OpenTheVault));
    if (game.KnowsLore(Lore::TheDrownedOrder) || game.HasMechanic(Mechanics::LanternOil)) Fail("the Order's lore and the lantern's oil should wait for their rules");
    std::vector<std::string> questsDone;
    game.OnQuestCompleted = [&](const std::string& q) { questsDone.push_back(q); };

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
        // Reaching the vault door reveals the Order's story.
        if (Join(game.KnownLore, ",") != Lore::TheDrownedOrder || vcgs::Story::Find(story.Lore, Lore::TheDrownedOrder)["name"].Str() != "The Drowned Order") Fail("the vault door should reveal The Drowned Order, got " + Join(game.KnownLore, ","));
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
    if (game.QuestState(Quests::OpenTheVault) != "done" || Join(questsDone, ",") != Quests::OpenTheVault) Fail("solving the door should complete Open the vault once, got " + game.QuestState(Quests::OpenTheVault) + " " + Join(questsDone, ","));

    // Rules can ask about quests and lore.
    {
        vcgs::Value asks = vcgs::JsonReader::Parse(R"({"match":"all","items":[{"kind":"quest","ref":"open_the_vault","op":"done"},{"kind":"lore","ref":"the_drowned_order","op":"known"}]})", nullptr);
        if (!vcgs::Rules::Check(asks, game)) Fail("a rule should see the quest done and the lore known");
    }

    // Effects can start a quest and reveal lore.
    {
        vcgs::GameState told(story);
        told.Quests.clear();
        vcgs::Value effects = vcgs::JsonReader::Parse(R"([{"kind":"startQuest","ref":"open_the_vault"},{"kind":"revealLore","ref":"the_drowned_order"}])", nullptr);
        vcgs::Rules::Apply(effects, told);
        if (told.QuestState(Quests::OpenTheVault) != "active" || !told.KnowsLore(Lore::TheDrownedOrder)) Fail("the effects should start the quest and reveal the lore");
        vcgs::Value more = vcgs::JsonReader::Parse(R"([{"kind":"completeQuest","ref":"open_the_vault"},{"kind":"enableMechanic","ref":"lantern_oil"}])", nullptr);
        vcgs::Rules::Apply(more, told);
        if (told.QuestState(Quests::OpenTheVault) != "done" || !told.HasMechanic(Mechanics::LanternOil)) Fail("the effects should complete the quest and make the mechanic available");
    }

    // SC-02 opens on an encounter: lose it (try again), then win it, and the scene goes on.
    {
        vcgs::GameState fresh(story);
        vcgs::ScenePlayer silt(fresh, Scenes::Sc02TheKey);
        std::vector<std::string> encounters, over;
        silt.OnEncounter = [&](const std::string& e, bool canWin) { encounters.push_back(e + (canWin ? "" : " (can't win)")); };
        silt.OnGameOver = [&](const std::string& e) { over.push_back(e); };
        vcgs::Codex codex(fresh);
        if (codex.Text() != "CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nMECHANICS · 0 of 1 available\nNone yet.\n\nENCOUNTERS · 0 met, 0 won\nNone yet.\n\nLORE · 0 of 1 found\nNothing found yet." || codex.New() != 0) Fail("the codex should start empty, got " + codex.Text());
        silt.Start();
        silt.Lose();
        std::printf("encounter: %s\n", Join(encounters, ", ").c_str());
        // Met once, however often it is played again; not won yet.
        if (fresh.MetEncounters.size() != 1 || fresh.WasWon(Encounters::EelSwarm) || codex.New() != 1 || codex.Text().find("ENCOUNTERS · 1 met, 0 won\n\nEEL SWARM\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\n") == std::string::npos) Fail("the codex should show the eels met, not won, 1 new, got " + codex.Text());
        // The eels can only be beaten once the lantern's oil is in play (a mechanic condition).
        const std::string notYet = std::string(Encounters::EelSwarm) + " (can't win)";
        if (Join(encounters, ",") != notYet + "," + notYet || !over.empty()) Fail("losing the eels should play them again, not yet winnable, got " + Join(encounters, ","));
        if (silt.Win()) Fail("a win should not count before the lantern's oil is in play");
        fresh.EnableMechanic(Mechanics::LanternOil);
        if (!silt.Win()) Fail("with the lantern's oil, a win against the eels should count");
        if (!fresh.WasWon(Encounters::EelSwarm) || !fresh.HasItem(Items::VaultKey)) Fail("winning should mark the eels won, and the scene go on to find the key");
        if (fresh.QuestState(Quests::OpenTheVault) != "active" || !fresh.KnowsLore(Lore::TheDrownedOrder)) Fail("finding the key should start the quest and reveal the lore");
        // The codex: the quest log, the mechanics, the encounters and the lore, and what is new since it was read.
        const std::string text = codex.Text();
        std::printf("codex: %s · new %d\n", text.substr(0, 80).c_str(), codex.New());
        if (codex.ButtonText("C") != "Codex (C) · 5 new" || text.rfind("CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 1 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault", 0) != 0) Fail("the codex should show the quest under way, the lantern's oil, the eels won and The Drowned Order, 5 new, got " + text);
        codex.MarkRead();
        vcgs::Rules::CompleteQuest(Quests::OpenTheVault, fresh);
        if (codex.ButtonText("C") != "Codex (C) · 1 new" || codex.Text().find("QUESTS · 0 under way, 1 done\n• Open the vault (done)") == std::string::npos) Fail("the quest log should show the quest done, 1 new, got " + codex.Text());
        // The HUD draws it line by line: nothing wider than it asks for.
        for (const std::string& line : vcgs::Codex::Wrap(codex.Text(), 40)) if (line.size() > 40) Fail("a wrapped line is too long: " + line);
        if (silt.Win()) Fail("there is no encounter to win now");
    }

    // SC-01 opens by lighting the lantern: its oil becomes a mechanic in play (an effect), with its tuning.
    {
        vcgs::GameState lit(story);
        std::vector<std::string> available;
        lit.OnMechanicAvailable = [&](const std::string& m) { available.push_back(m); };
        vcgs::ScenePlayer cave(lit, Scenes::Sc01TheCaveMouth);
        cave.Start();
        const std::string tuning = vcgs::Story::Find(story.Mechanics, Mechanics::LanternOil)["fields"]["tuning"].Str();
        std::printf("mechanics: %s · tuning: %s\n", Join(available, ",").c_str(), tuning.c_str());
        if (Join(available, ",") != Mechanics::LanternOil || tuning != "About a minute of deep water on a full lantern") Fail("lighting the lantern should make Lantern oil available, with its tuning");
    }

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
