#include <cmath>
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
    // The dark and the lantern: no light until the lantern is taken; the Squeeze is dark; the oil burns, and Mara tops it up.
    {
        vcgs::GameState caveGame(story);
        vcgs::LevelLogic cave(vcgs::JsonReader::Parse(buffer.str(), &error), caveGame);
        auto named = [&cave](const std::string& n) { for (const auto& g : cave.Order) if (cave.Item(g)["name"].Str() == n) return g; return std::string(); };
        if (cave.LightSource != "lantern_oil" || cave.LightFuelFull != 90) Fail("the player's light should come from Lantern oil, with 90 s of fuel");
        if (cave.ToggleLight() != "You need Lantern oil for light." || cave.IsLit()) Fail("without the lantern there should be no light");
        cave.Enter(named("Squeeze dark"));
        std::printf("dark in the squeeze: %.2f\n", cave.Darkness());
        if (std::fabs(cave.Darkness() - 0.96) > 0.001) Fail("the Squeeze should be 96% dark");
        cave.Exit(named("Squeeze dark"));
        cave.Interact(named("Lantern"));
        if (!caveGame.HasMechanic("lantern_oil") || cave.IsPresent(named("Lantern"))) Fail("taking the lantern should make Lantern oil available, and take it away");
        if (cave.ToggleLight() != "Light on." || !cave.IsLit()) Fail("with the lantern the light should go on");
        cave.Tick(10);
        if (std::fabs(cave.LightFuel - 80) > 0.001) Fail("ten seconds lit should burn ten seconds of oil");
        cave.Interact(named("Mara"));
        if (cave.LightFuel != 90) Fail("Mara should top the lantern up");
    }
    // Mara paces the cave mouth: her first stop is where she stands (4 s there), then on to the second.
    {
        vcgs::GameState walking(story);
        vcgs::LevelLogic moving(vcgs::JsonReader::Parse(buffer.str(), &error), walking);
        std::string mara;
        for (const auto& guid : moving.Order) if (moving.Item(guid)["name"].Str() == "Mara") mara = guid;
        if (mara.empty() || !moving.Poses.count(mara) || moving.Item(mara)["motion"]["stops"].Size() != 2) Fail("Mara should walk the Cave watch patrol's two stops");
        else
        {
            for (int i = 0; i < 50; i++) moving.Tick(0.1);
            const vcgs::ActorPose mid = moving.Poses[mara];
            std::printf("Mara after 5 s: %.2f, %.2f\n", mid.X, mid.Z);
            if (!(mid.X > 1.6 && mid.X < 4.4 && mid.Z > 0.6 && mid.Z < 2.9 && mid.Moving)) Fail("after 5 s Mara should be on her way to the second stop");
            for (int i = 0; i < 50; i++) moving.Tick(0.1);
            const vcgs::ActorPose there = moving.Poses[mara];
            if (std::fabs(there.X - 4.5) > 0.01 || std::fabs(there.Z - 0.5) > 0.01 || there.Moving) Fail("after 10 s Mara should wait at the second stop");
        }
        // A companion keeps up: with the player 6 m on, it walks until 2 m away; 30 m on, it catches up at once.
        const vcgs::Value follow = vcgs::JsonReader::Parse("{\"kind\": \"follow\", \"speed\": 3.5, \"distance\": 2}", &error);
        vcgs::ActorPose pose;
        for (int i = 0; i < 30; i++) vcgs::LevelLogic::StepFollow(pose, follow, 0.1, 6, 0, 0);
        if (std::fabs(pose.X - 4) > 0.001 || pose.Moving) Fail("a companion should stop 2 m from the player");
        vcgs::LevelLogic::StepFollow(pose, follow, 0.1, 4, 0, 30);
        if (std::fabs(pose.Z - 28) > 0.001) Fail("a companion left 30 m behind should catch up at once");
    }
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
        // Both have spoken, so both are met; the codex lists only Mara, who has an entry.
        if (Join(game.MetCharacters, ",") != "mara,the_explorer") Fail("speaking should meet Mara and the Explorer, got " + Join(game.MetCharacters, ","));
        if (vcgs::Codex(game).Text().find("\n\nCHARACTERS · 1 of 1 met\n\nMARA\nA guide who knows the flooded caves better than anyone alive. She carries the lantern.\n\nLOCATIONS · 1 of 1 visited\n\nVAULT CHAMBER\nA drowned hall under the old city, its bronze door sealed by the Order.\n\nITEMS") == std::string::npos) Fail("the codex should list Mara, got " + vcgs::Codex(game).Text());
        if (!choices.empty()) Fail("the choice should wait for the free play to end");
        if (Join(vcgs::Interactions::AvailableVerbs(game, Objects::RustedLever), ",") != "Pull") Fail("the lever should offer Pull");
        if (!vcgs::Interactions::Interact(game, Objects::RustedLever, "Pull")) Fail("Pull should work");
        // Pulling it puts the lever in the codex, with how it stands now.
        if (Join(game.UsedObjects, ",") != Objects::RustedLever || vcgs::Codex(game).Text().find("OBJECTS · 1 of 1 used\n\nRUSTED LEVER (up)\nAn iron lever half-buried by the door, stiff with rust. It works the old sluice.") == std::string::npos) Fail("the codex should list the lever, got " + vcgs::Codex(game).Text());
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
        if (codex.Text() != "CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 0 of 1 found\nNone yet.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 0 of 1 available\nNone yet.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 0 met, 0 won\nNone yet.\n\nLORE · 0 of 2 found\nNothing found yet." || codex.New() != 0) Fail("the codex should start empty, got " + codex.Text());
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
        if (codex.ButtonText("C") != "Codex (C) · 6 new" || text.rfind("CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 1 of 1 found\n\nVAULT KEY (carried)\nA heavy bronze key, green with age, stamped with the Order’s wave.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault", 0) != 0) Fail("the codex should show the quest under way, the key, the lantern's oil, the eels won and The Drowned Order, 6 new, got " + text);
        // Search it: only the entries that match, ignoring case; headings are not searched.
        if (codex.Text("LANTERN") != "CODEX\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.") Fail("searching for lantern should show the oil and the eels, got " + codex.Text("LANTERN"));
        if (codex.Text(" quests ") != "CODEX\n\nNothing matches \"quests\".") Fail("a search with no match should say so, got " + codex.Text(" quests "));
        if (codex.Text("  ") != codex.Text()) Fail("a blank search should show everything");
        // Filter by section: only that one, alone or with the search.
        if (Join(codex.SectionKeys(), ",") != "quests,characters,locations,items,objects,mechanics,skills,encounters,lore") Fail("the codex should offer every section, got " + Join(codex.SectionKeys(), ","));
        // The codex's skills: learning a rank is news, and the section says its rank, kind, tree and use.
        {
            const int before = codex.New();
            vcgs::Rules::Learn("deep_breath", fresh);
            std::printf("codex skills: new %d\n", codex.New());
            if (codex.Text("", "skills") != "CODEX\n\nSKILLS · 1 of 2 learned\n\nDEEP BREATH (rank 1 of 2)\nSkill · Diving\nWhat it does: Hold your breath a third longer\nLonger under water with each rank.") Fail("the codex should list Deep Breath, got " + codex.Text("", "skills"));
            if (codex.New() != before + 1) Fail("learning a skill should be news for the codex");
            fresh.Skills.clear();
            fresh.SkillOrder.clear();
        }
        if (codex.Text("", "lore") != "CODEX\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.") Fail("filtering to lore should show only the lore, got " + codex.Text("", "lore"));
        if (codex.Text("lantern", "lore") != "CODEX\n\nNothing matches \"lantern\" in Lore.") Fail("a search with no match in a section should say so, got " + codex.Text("lantern", "lore"));
        if (codex.Text("", "objects") != "CODEX\n\nOBJECTS · 0 of 1 used\nNone yet.") Fail("an empty section should say so, got " + codex.Text("", "objects"));
        // Sort: found the expedition's marks first, then the Order's story.
        {
            vcgs::GameState sorting(story);
            sorting.DiscoverLore(Lore::TheLastExpedition);
            sorting.DiscoverLore(Lore::TheDrownedOrder);
            // Bookmarks: a star on the entry, a filter for them alone, and a cursor to pick one.
            vcgs::Codex book(sorting);
            if (!sorting.ToggleBookmark(std::string("lore:") + Lore::TheDrownedOrder) || book.Text().find("\n\nTHE DROWNED ORDER ★\nRiver priests") == std::string::npos) Fail("a bookmark should star the entry, got " + book.Text());
            if (book.Text("", "bookmarks") != "CODEX\n\nLORE · 2 of 2 found\n\nTHE DROWNED ORDER ★\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.") Fail("the bookmarks should show alone, got " + book.Text("", "bookmarks"));
            if (book.Text("eels", "bookmarks") != "CODEX\n\nNothing matches \"eels\" in Bookmarks.") Fail("a search with no match in the bookmarks should say so, got " + book.Text("eels", "bookmarks"));
            if (Join(book.EntryKeys("", "lore"), ",") != std::string("lore:") + Lore::TheLastExpedition + ",lore:" + Lore::TheDrownedOrder) Fail("the cursor should move through the lore shown, got " + Join(book.EntryKeys("", "lore"), ","));
            if (book.Text("", "lore", "", std::string("lore:") + Lore::TheLastExpedition).find("\n\n▶ THE LAST EXPEDITION\n") == std::string::npos) Fail("the cursor entry should start with ▶, got " + book.Text("", "lore", "", std::string("lore:") + Lore::TheLastExpedition));
            // A note: it ends the entry, and a search finds it.
            sorting.SetNote(std::string("lore:") + Lore::TheDrownedOrder, "  Priests, not monks  ");
            if (sorting.NoteFor(std::string("lore:") + Lore::TheDrownedOrder) != "Priests, not monks" || book.Text().find("They believed the water kept their secrets.\nNote: Priests, not monks") == std::string::npos) Fail("the note should end the entry, got " + book.Text());
            if (book.Text("not monks").find("THE DROWNED ORDER") == std::string::npos) Fail("a search should find the note, got " + book.Text("not monks"));
            // Export them: each entry with a note, in the codex's order.
            if (book.NotesText() != "CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\nPriests, not monks") Fail("the notes export should list each noted entry, got " + book.NotesText());
            // Email them: a mail link with the story in the subject and the notes as the body.
            const std::pair<std::string, bool> mail = book.NotesMailto();
            if (mail.first != "mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0D%0A%0D%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0D%0APriests%2C%20not%20monks" || !mail.second) Fail("the mail link should carry the notes, got " + mail.first);
            const std::pair<std::string, bool> tooLong = vcgs::Codex::MailtoOf("CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\n" + std::string(2000, 'x'));
            if (tooLong.second || tooLong.first != "mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.") Fail("notes too long for a mail link should say they are on the clipboard, got " + tooLong.first);
            // Text them: a text-message link with the notes as the message.
            const std::pair<std::string, bool> sms = book.NotesSms();
            if (sms.first != "sms:?&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0A%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0APriests%2C%20not%20monks" || !sms.second) Fail("the text link should carry the notes, got " + sms.first);
            const std::pair<std::string, bool> longSms = vcgs::Codex::SmsOf("CODEX NOTES · X\r\n\r\nLORE · Y\r\n" + std::string(2000, 'x'));
            if (longSms.second || longSms.first != "sms:?&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.") Fail("notes too long for a text link should say they are on the clipboard, got " + longSms.first);
            // Print them: the same notes as a page, section by section.
            const std::string page = book.NotesPage();
            const std::string pageEnd = "<h1>The Sunken Vault</h1><p class=\"sub\">Codex notes</p>\n<h2>Lore</h2>\n<div class=\"note\"><h3>THE DROWNED ORDER</h3><p>Priests, not monks</p></div>\n</body></html>\n";
            if (page.rfind("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>The Sunken Vault · codex notes</title><style>" + std::string(vcgs::Codex::PrintStyle) + "</style></head>", 0) != 0 || page.size() < pageEnd.size() || page.compare(page.size() - pageEnd.size(), pageEnd.size(), pageEnd) != 0) Fail("the notes page should list each note under its section, got " + page);
            const std::string other = vcgs::Codex::PageOf("CODEX NOTES · A & B\r\n\r\nITEMS · <KEY>\r\none\r\ntwo");
            if (other.find("<title>A &amp; B · codex notes</title>") == std::string::npos || other.find("<h2>Items</h2>\n<div class=\"note\"><h3>&lt;KEY&gt;</h3><p>one<br>two</p></div>") == std::string::npos) Fail("the notes page should escape its text and keep a note's lines, got " + other);
            // Import them back: matched by section and name, whatever the entry's state.
            const vcgs::Codex::ReadNotes read = book.NotesFrom("CODEX NOTES · The Sunken Vault\r\n\r\nLORE · THE LAST EXPEDITION (seen)\r\nPry marks,\r\nby the lock\r\n\r\nENCOUNTERS · EEL SWARM (won)\r\nNot met here");
            if (read.Notes.size() != 1 || read.Notes[0].first != std::string("lore:") + Lore::TheLastExpedition || read.Notes[0].second != "Pry marks,\nby the lock" || Join(read.Skipped, ",") != "ENCOUNTERS · EEL SWARM (won)") Fail("importing notes should match them by section and name");
            // Sync: the newer note of each wins, takings-off too, and it writes back what it merged.
            {
                vcgs::GameState device(story);
                device.SetNote(std::string("lore:") + Lore::TheLastExpedition, "Mine, older");
                device.SetNote(std::string("items:") + Items::VaultKey, "Taken off later");
                const std::string later = std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() + 60000);
                const std::string other = std::string("{ \"format\": \"vcgs-codex-notes-sync\", \"version\": 1, \"story\": \"The Sunken Vault\", \"notes\": { \"lore:") + Lore::TheLastExpedition + "\": { \"text\": \"Theirs, \\\"newer\\\"\\nsecond line\", \"at\": " + later + " }, \"items:" + Items::VaultKey + "\": { \"text\": \"\", \"at\": " + later + " }, \"quests:" + Quests::OpenTheVault + "\": { \"text\": \"Theirs, old\", \"at\": 1 } } }";
                const int synced = device.SyncNotes(other);
                if (synced != 3 || device.NoteFor(std::string("lore:") + Lore::TheLastExpedition) != "Theirs, \"newer\"\nsecond line" || !device.NoteFor(std::string("items:") + Items::VaultKey).empty() || device.NoteFor(std::string("quests:") + Quests::OpenTheVault) != "Theirs, old") Fail("syncing should keep the newer note of each, got " + std::to_string(synced));
                vcgs::GameState back(story);
                if (back.SyncNotes(device.NotesSyncText("The Sunken Vault")) != 2 || back.NotesSyncText("The Sunken Vault") != device.NotesSyncText("The Sunken Vault")) Fail("a sync file should read back what it wrote, got " + back.NotesSyncText("The Sunken Vault"));
                if (device.SyncNotes("CODEX NOTES · not a sync file") != -1) Fail("text that is not a sync file should not sync");
            }
            if (vcgs::Codex::NameOf("• Open the vault — Reach it") != "open the vault" || vcgs::Codex::NameOf("VAULT KEY (carried ×2)") != "vault key") Fail("the name should drop the goal and the state");
            sorting.SetNote(std::string("lore:") + Lore::TheDrownedOrder, "");
            if (book.NotesText() != "CODEX NOTES · The Sunken Vault\n\nNo notes yet.") Fail("with no notes, the export should say so, got " + book.NotesText());
            if (book.Text().find("Note:") != std::string::npos) Fail("an empty note should take the note off");
            if (sorting.ToggleBookmark(std::string("lore:") + Lore::TheDrownedOrder) || book.Text("", "bookmarks") != "CODEX\n\nNo bookmarks yet.") Fail("taking the bookmark off should leave none, got " + book.Text("", "bookmarks"));
            auto heads = [&](const char* sort)
            {
                std::vector<std::string> out;
                for (const std::string& line : vcgs::Codex::Wrap(vcgs::Codex(sorting).Text("", "lore", sort), 1000)) if (line.rfind("THE ", 0) == 0) out.push_back(line);
                return Join(out, ",");
            };
            if (heads("") != "THE LAST EXPEDITION,THE DROWNED ORDER" || heads("newest") != "THE DROWNED ORDER,THE LAST EXPEDITION" || heads("name") != "THE DROWNED ORDER,THE LAST EXPEDITION") Fail("sorting the lore should order it as found, newest first and A-Z, got " + heads("") + " / " + heads("newest") + " / " + heads("name"));
        }
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

    // Save and load: a save holds the game as the scene being played began, and loading puts it back.
    {
        vcgs::GameState saving(story);
        vcgs::ScenePlayer cave(saving, Scenes::Sc01TheCaveMouth);
        cave.Start();
        const std::string first = saving.SaveText("The Sunken Vault");
        std::string error;
        const vcgs::Value save = vcgs::JsonReader::Parse(first, &error);
        std::printf("save: at %s · visited %zu · mechanics %zu\n", save["at"].Str().c_str(), save["visited"].items.size(), save["mechanics"].items.size());
        if (!error.empty() || save["format"].Str() != "vcgs-save" || save["version"].number != 1 || save["story"].Str() != "The Sunken Vault" || save["at"].Str() != Scenes::Sc01TheCaveMouth || !save["visited"].items.empty() || !save["mechanics"].items.empty()) Fail("the save should hold the game as SC-01 began, got " + first);
        if (!saving.Visited.count(Scenes::Sc01TheCaveMouth) || saving.MechanicOrder.size() != 1) Fail("SC-01 should have been visited and lit the lantern");
        std::string at;
        if (!saving.LoadSave(first, at) || at != Scenes::Sc01TheCaveMouth || !saving.Visited.empty() || !saving.MechanicOrder.empty() || !saving.Loaded) Fail("loading should put the game back as SC-01 began");
        auto noTime = [](std::string t)
        {
            const size_t from = t.find("\"saved_at\": ");
            return from == std::string::npos ? t : t.erase(from, t.find(',', from) - from);
        };
        if (noTime(saving.SaveText("The Sunken Vault")) != noTime(first)) Fail("a loaded save should save the same again, got " + saving.SaveText("The Sunken Vault"));
        // A save from another engine's runtime (the same format) loads here too.
        if (!saving.LoadSave("{\"format\":\"vcgs-save\",\"version\":1,\"story\":\"The Sunken Vault\",\"at\":\"sc_03_the_vault_door\",\"saved_at\":1,\"flags\":{\"door_solved\":\"yes\"},\"objects\":{\"rusted_lever\":\"up\"},\"items\":{\"vault_key\":2},\"arcs\":{\"mara\":1},\"chosen\":{\"c1\":\"carry_on\"},\"quests\":[{\"key\":\"open_the_vault\",\"state\":\"active\"}],\"solved\":[\"vault_door\"],\"visited\":[\"sc_01_the_cave_mouth\",\"sc_02_the_key\"],\"fired\":[],\"picked\":[\"c1:carry_on\"],\"won\":[\"eel_swarm\"],\"met\":[\"eel_swarm\"],\"characters\":[\"mara\"],\"found\":[\"vault_key\"],\"locations\":[\"silt_camp\"],\"used\":[\"rusted_lever\"],\"lore\":[\"the_drowned_order\"],\"mechanics\":[\"lantern_oil\"]}", at)
            || at != "sc_03_the_vault_door" || saving.GetFlag("door_solved") != "yes" || saving.GetObjectState("rusted_lever") != "up" || saving.Items["vault_key"] != 2 || saving.Arcs["mara"] != 1 || saving.Quests["open_the_vault"] != "active" || Join(saving.QuestOrder, ",") != "open_the_vault"
            || !saving.Solved.count("vault_door") || !saving.Visited.count("sc_02_the_key") || !saving.Picked.count("c1:carry_on") || !saving.Won.count("eel_swarm") || Join(saving.MetCharacters, ",") != "mara" || Join(saving.FoundItems, ",") != "vault_key"
            || Join(saving.UsedObjects, ",") != "rusted_lever" || Join(saving.KnownLore, ",") != "the_drowned_order" || !saving.Mechanics.count("lantern_oil")) Fail("a save in the shared format should load");
        if (saving.LoadSave("not a save", at) || saving.LoadSave("{\"format\":\"vcgs-codex-notes-sync\"}", at)) Fail("text that is not a save should not load");
        vcgs::ScenePlayer door(saving, Scenes::Sc03TheVaultDoor);
        door.Start();
        if (saving.Loaded) Fail("starting the scene should end the load");
    }

    // Skills (spec §8): the Diving tree. Deep Breath first (two ranks, free), then the
    // lantern's hood, once the oil is in play, for the two salvage the eels leave.
    {
        vcgs::GameState g(story);
        if (vcgs::Rules::Learn("lantern_hood", g) != "Learn Deep Breath first.") Fail("the hood should need Deep Breath first");
        if (vcgs::Rules::Learn("deep_breath", g) != "" || g.SkillRank("deep_breath") != 1) Fail("Deep Breath should be learned, for free");
        if (vcgs::Rules::LearnCheck("lantern_hood", g) != "Needs Lantern oil is available.") Fail("the hood should need the lantern's oil, got " + vcgs::Rules::LearnCheck("lantern_hood", g));
        vcgs::Rules::Learn("deep_breath", g);
        if (vcgs::Rules::LearnCheck("deep_breath", g) != "All 2 ranks learned.") Fail("Deep Breath should stop at two ranks");
        g.EnableMechanic("lantern_oil");
        if (vcgs::Rules::LearnCheck("lantern_hood", g) != "Costs 2 \u00d7 Salvage (you have 0).") Fail("the hood should cost two salvage, got " + vcgs::Rules::LearnCheck("lantern_hood", g));
        vcgs::Rules::Apply(vcgs::Story::Find(story.Encounters, "eel_swarm")["onWin"], g);
        if (vcgs::Rules::Learn("lantern_hood", g) != "" || g.Items["salvage"] != 0 || g.SkillRank("lantern_hood") != 1) Fail("the eels' salvage should buy the hood");
        std::string err;
        vcgs::Rules::Apply(vcgs::JsonReader::Parse("[{\"kind\": \"learnSkill\", \"ref\": \"deep_breath\"}]", &err), g);
        const vcgs::Value ranks = vcgs::JsonReader::Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"skill\", \"ref\": \"lantern_hood\", \"op\": \"atLeast\", \"value\": 1}, {\"kind\": \"skill\", \"ref\": \"deep_breath\", \"op\": \"below\", \"value\": 3}]}", &err);
        if (g.SkillRank("deep_breath") != 2 || !vcgs::Rules::Check(ranks, g)) Fail("a given rank should stop at the skill's ranks, and conditions should see ranks");
        vcgs::GameState h(story);
        std::string at;
        h.LoadSave(g.SaveText("The Sunken Vault"), at);
        std::printf("skills: deep_breath %d, lantern_hood %d\n", h.SkillRank("deep_breath"), h.SkillRank("lantern_hood"));
        if (h.SkillRank("deep_breath") != 2 || h.SkillRank("lantern_hood") != 1) Fail("skills should save and load");
    }

    // Weapons and equipment (spec §8): the knife wears out, the flare pistol burns flares.
    {
        vcgs::GameState g(story);
        if (g.Equip("diving_knife") != "You don't carry Diving Knife." || g.Equip("vault_key") != "Not equipment.") Fail("only equipment that is carried can be equipped");
        g.GiveItem("diving_knife"); g.GiveItem("flare_pistol"); g.GiveItem("flare");
        if (g.Equip("diving_knife") != "" || g.EquippedIn("Hand") != "diving_knife" || g.Stat("damage") != 2) Fail("the knife should go in the hand, with its damage");
        if (g.Equip("flare_pistol") != "" || g.EquippedIn("Hand") != "flare_pistol" || g.Stat("Light") != 3 || g.IsEquipped("diving_knife")) Fail("the pistol should take the hand, putting the knife back");
        if (g.UseItem("flare_pistol") != "" || g.Items["flare"] != 0 || g.UseCheck("flare_pistol") != "Out of Flare.") Fail("the pistol should burn its one flare");
        g.Equip("diving_knife");
        for (int i = 0; i < 3; i++) g.UseItem("diving_knife");
        if (g.HasItem("diving_knife") || g.IsEquipped("diving_knife") || g.UseCheck("diving_knife") != "Equip Diving Knife first.") Fail("the knife should break after three uses, and be gone");
        g.GiveItem("diving_knife");
        std::string err;
        vcgs::Rules::Apply(vcgs::JsonReader::Parse("[{\"kind\": \"equip\", \"ref\": \"diving_knife\"}]", &err), g);
        const vcgs::Value armed = vcgs::JsonReader::Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"equipped\", \"ref\": \"diving_knife\", \"op\": \"equipped\"}]}", &err);
        if (!vcgs::Rules::Check(armed, g) || g.UsesLeft("diving_knife") != 3) Fail("an effect should equip a new knife, unworn, and conditions should see it");
        g.UseItem("diving_knife");
        vcgs::GameState h(story);
        std::string at;
        h.LoadSave(g.SaveText("The Sunken Vault"), at);
        std::printf("gear: hand %s, uses left %d\n", h.EquippedIn("Hand").c_str(), h.UsesLeft("diving_knife"));
        if (h.EquippedIn("Hand") != "diving_knife" || h.UsesLeft("diving_knife") != 2) Fail("equipment and its wear should save and load");
        h.TakeItem("diving_knife");
        if (h.IsEquipped("diving_knife")) Fail("an item no longer carried should come out of its slot");
    }

    // Crafting (spec §8): with the pistol, a scrap of salvage packs two flares.
    {
        vcgs::GameState g(story);
        if (g.Craft("vault_key") != "Not craftable." || g.Craft("flare") != "Needs Flare Pistol is carried.") Fail("the flare should need the pistol, got " + g.CraftCheck("flare"));
        g.GiveItem("flare_pistol");
        if (g.CraftCheck("flare") != "Needs 1 \u00d7 Salvage (you have 0).") Fail("the flare should need salvage, got " + g.CraftCheck("flare"));
        g.GiveItem("salvage", 2);
        std::string made;
        g.OnItemCrafted = [&made](const std::string& k, int n) { made += k + " x" + std::to_string(n); };
        if (g.Craft("flare") != "" || g.Items["salvage"] != 1 || g.Items["flare"] != 2 || made != "flare x2" || std::find(g.FoundItems.begin(), g.FoundItems.end(), "flare") == g.FoundItems.end()) Fail("crafting should take a salvage and give two flares");
        std::printf("crafted: %s, salvage left %d\n", made.c_str(), g.Items["salvage"]);
    }

    // Custom code in VcgsStoryKeys.h's region was kept when the story was exported again.
    if (std::string(VcgsKeys::CustomCheck) != "kept") Fail("custom code in VcgsStoryKeys.h should survive exporting again");
    else std::printf("custom code: %s\n", VcgsKeys::CustomCheck);

    CheckLevel(story);

    std::printf("%s\n", failures == 0 ? "OK" : (std::to_string(failures) + " FAILED").c_str());
    return failures == 0 ? 0 : 1;
}
