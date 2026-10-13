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
    const std::string onward = vcgs::StoryWalker::Choose(game, where, 1);
    if (onward.empty() || onward == where || !story.Graph.count(onward)) Fail("Leave The Cave Mouth should go on along the story, got " + onward);
    else std::printf("rooms: %s · %s · then %s\n", Labels(game, where).c_str(), Labels(game, studyWhere).c_str(), (*story.Graph.at(onward))["name"].Str().c_str());
    if (failures) return 1;
    std::printf("rooms OK\n");
    return 0;
}
