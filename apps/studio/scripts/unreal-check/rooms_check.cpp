// Plays rooms (sub-scenes) with the VCGS Runtime for Unreal's core: the same
// walk as the Godot and Unity rooms checks. SC-01 The Cave Mouth has The
// Study, and The Closet is inside it.
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

static std::string Named(const vcgs::Story& story, const std::string& name)
{
    for (const auto& entry : story.Graph)
        if ((*entry.second)["name"].Str() == name) return entry.first;
    Fail("no node named " + name);
    return "";
}

static std::string Labels(vcgs::GameState& game, const std::string& choice)
{
    std::string out;
    for (int i : vcgs::StoryWalker::Offered(game, choice)) out += (out.empty() ? "" : ",") + vcgs::StoryWalker::OptionLabel(game, choice, i);
    return out;
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

    const std::string where = vcgs::StoryWalker::Onward(game, Named(story, "The Cave Mouth"));
    if (vcgs::StoryWalker::KindOf(game, where) != "choice") Fail("after The Cave Mouth comes its Where now?, got " + where);
    if (Labels(game, where) != "Go into The Study,Leave The Cave Mouth") Fail("The Cave Mouth's Where now? is wrong: " + Labels(game, where));
    const std::string study = vcgs::StoryWalker::Choose(game, where, 0);
    if (study != Named(story, "The Study")) Fail("Go into The Study should lead to the study, got " + study);
    const std::string studyWhere = vcgs::StoryWalker::Onward(game, study);
    if (Labels(game, studyWhere) != "Go into The Closet,Leave The Study") Fail("The Study's Where now? is wrong: " + Labels(game, studyWhere));
    const std::string closet = vcgs::StoryWalker::Choose(game, studyWhere, 0);
    if (vcgs::StoryWalker::Onward(game, closet) != studyWhere) Fail("The Closet should lead back to The Study's question");
    if (vcgs::StoryWalker::Choose(game, studyWhere, 1) != where) Fail("Leave The Study should go back to The Cave Mouth's question");
    // Rooms the player has been in read "(been)" (a scene marks itself visited as it plays).
    if (vcgs::StoryWalker::OptionLabel(game, where, 0) != "Go into The Study") Fail("The Study should not read been before it is visited");
    game.Visit(study);
    if (Labels(game, where) != "Go into The Study (been),Leave The Cave Mouth") Fail("The Study should read been once visited, got " + Labels(game, where));
    const std::string onward = vcgs::StoryWalker::Choose(game, where, 1);
    if (onward.empty() || onward == where || !story.Graph.count(onward)) Fail("Leave The Cave Mouth should go on along the story, got " + onward);
    else std::printf("rooms: %s · %s · then %s\n", Labels(game, where).c_str(), Labels(game, studyWhere).c_str(), (*story.Graph.at(onward))["name"].Str().c_str());
    // Level transitions: each node on the graph says the level of the Level lane it is in.
    const std::string cave = Named(story, "The Cave Mouth"), key = Named(story, "The Key");
    if (vcgs::StoryWalker::LevelOf(game, cave) != "The Flooded Cave" || vcgs::StoryWalker::LevelOf(game, key) != "The Sunken Vault")
        Fail("the graph should carry each node's level, got " + vcgs::StoryWalker::LevelOf(game, cave) + " / " + vcgs::StoryWalker::LevelOf(game, key));
    std::string entered;
    game.OnLevelEntered = [&](const std::string& from, const std::string& to, const std::string& map) { entered += (entered.empty() ? "" : ",") + from + ">" + to + (map.empty() ? "" : "@" + map); };
    game.Level.clear();
    const std::string first = vcgs::StoryWalker::Arrive(game, cave);
    const std::string again = vcgs::StoryWalker::Arrive(game, cave);
    const std::string crossing = vcgs::StoryWalker::Arrive(game, key);
    if (first != "LEVEL · The Flooded Cave" || !again.empty() || crossing != "End of The Flooded Cave → LEVEL · The Sunken Vault")
        Fail("level transitions are wrong: [" + first + "] [" + again + "] [" + crossing + "]");
    const std::string vaultMap = vcgs::StoryWalker::LevelMapOf(game, key);
    if (vaultMap.empty() || !vcgs::StoryWalker::LevelMapOf(game, cave).empty()) Fail("only The Sunken Vault's nodes should carry its map, got [" + vaultMap + "]");
    if (entered != ">The Flooded Cave,The Flooded Cave>The Sunken Vault@" + vaultMap || game.LevelMap != vaultMap) Fail("OnLevelEntered should fire on each crossing with its map, got " + entered);
    // The level the player is in is kept in a save.
    game.Checkpoint(key);
    const std::string saved = game.SaveText("check");
    game.Level.clear();
    std::string at;
    game.LoadSave(saved, at);
    if (game.Level != "The Sunken Vault") Fail("a save should keep the level, got " + game.Level);
    std::printf("levels: %s · %s\n", first.c_str(), crossing.c_str());
    if (failures) return 1;
    std::printf("rooms OK\n");
    return 0;
}
