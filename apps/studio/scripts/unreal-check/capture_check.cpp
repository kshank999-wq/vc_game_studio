// Plays capture with the VCGS Runtime for Unreal's core: the same walk as the
// Godot and Unity capture checks. Lose to the eels in SC-02 The Key: counted,
// health set, the knife taken, to the Holding cell; the Evidence locker gives
// it back; out of the cell, back in The Key past the fight.
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

static bool Has(const std::vector<std::string>& list, const std::string& s)
{
    for (const auto& x : list) if (x == s) return true;
    return false;
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
    const vcgs::Value& capture = story.Root["capture"];
    const std::string cell = capture["cell"].Str(), locker = capture["locker"].Str(), count = capture["count"].Str(), health = capture["health"].Str();
    if (cell.empty() || locker.empty() || count.empty() || health.empty()) Fail("capture should name its cell, locker, count and health");
    if (game.GetFlag(health) != "100") Fail("health should start at 100, got " + game.GetFlag(health));
    if (!vcgs::Rules::IsCaptor("orc_sentry", game) || vcgs::Rules::IsCaptor("mara", game)) Fail("the Orc Sentry should be a captor, and Mara not");
    game.GiveItem("diving_knife");

    // Lose to the eels: captured, to the holding cell.
    std::vector<std::string> finished, over;
    {
        vcgs::ScenePlayer key(game, "sc_02_the_key");
        key.OnFinished = [&](const std::string& next) { finished.push_back(next); };
        key.OnGameOver = [&](const std::string& k) { over.push_back(k); };
        key.Start();
        key.Lose();
        if (key.Capture()) Fail("a player held already should not be captured again");
    }
    if (finished.size() != 1 || finished[0] != cell || !over.empty()) Fail("losing the eels should go to the holding cell");
    if (game.GetFlag(count) != "1" || game.GetFlag(health) != "50") Fail("a capture should count 1 and set health to 50, got " + game.GetFlag(count) + " / " + game.GetFlag(health));
    if (game.HasItem("diving_knife") || game.Taken["diving_knife"] != 1) Fail("the knife should be taken");
    if (game.Held.Scene != "sc_02_the_key" || game.Held.Index != 1) Fail("where the player was caught should be kept, got " + game.Held.Scene + " " + std::to_string(game.Held.Index));

    // A save in the cell keeps what was taken and where they were caught; it loads back.
    game.Checkpoint(cell);
    const std::string saved = game.SaveText("The Sunken Vault");
    {
        vcgs::GameState reloaded(story);
        std::string at;
        if (!reloaded.LoadSave(saved, at) || reloaded.Held.Scene != "sc_02_the_key" || reloaded.Held.Index != 1 || reloaded.Taken.count("diving_knife") != 1) Fail("a loaded save should be held, with the knife taken");
    }

    // The holding cell: the locker gives the knife back.
    std::vector<std::string> out;
    int free = 0;
    {
        vcgs::ScenePlayer holding(game, cell);
        holding.OnFinished = [&](const std::string& next) { out.push_back(next); };
        holding.OnFreePlay = [&](const std::string&) { free++; };
        holding.Start();
        if (free != 1) Fail("the holding cell should open on its free play");
        if (!Has(vcgs::Interactions::AvailableVerbs(game, locker), vcgs::Rules::LockerVerb())) Fail("the locker should offer the knife back");
        if (!vcgs::Interactions::Interact(game, locker, vcgs::Rules::LockerVerb()) || !game.HasItem("diving_knife") || !game.Taken.empty()) Fail("taking things back should return the knife");
        if (Has(vcgs::Interactions::AvailableVerbs(game, locker), vcgs::Rules::LockerVerb())) Fail("the locker should be empty now");
        holding.Advance();
    }
    if (out.size() != 1 || out[0] != "sc_02_the_key" || !game.Held.IsNone()) Fail("out of the cell should go back to The Key");

    // The Key again picks up past the fight: the key in the silt.
    std::vector<std::string> kinds;
    {
        vcgs::ScenePlayer again(game, "sc_02_the_key");
        again.OnEvent = [&](const vcgs::Value& e) { kinds.push_back(e["kind"].Str()); };
        again.Start();
    }
    if (kinds.empty() || kinds[0] == "encounter" || !game.HasItem("vault_key")) Fail("The Key should pick up past the eels");
    if (!game.Resume.IsNone()) Fail("the resume point should be used up");
    std::printf("capture: to %s, back with the knife %s, on with %s · captures %s\n", cell.c_str(), game.HasItem("diving_knife") ? "true" : "false", kinds.empty() ? "-" : kinds[0].c_str(), game.GetFlag(count).c_str());
    // Caught in play while a scene plays: captured from where it is, past the event on now.
    std::vector<std::string> caught, toCell;
    game.OnCaptured = [&](const std::string& to, const std::string& by) { caught.push_back(to + "<" + by); };
    {
        vcgs::ScenePlayer playing(game, "sc_02_the_key");
        playing.OnFinished = [&](const std::string& next) { toCell.push_back(next); };
        playing.Start();
        game.Taken.clear();
        if (vcgs::Rules::CatchPlayer("orc_sentry", game) != cell || toCell.size() != 1 || toCell[0] != cell || caught.size() != 1 || caught[0] != cell + "<orc_sentry") Fail("a catch in play should capture from the scene playing");
        if (game.Held.Scene != "sc_02_the_key") Fail("a catch in play should keep the scene it was in, got " + game.Held.Scene);
        if (!vcgs::Rules::CatchPlayer("orc_sentry", game).empty()) Fail("a player held already should not be caught again");
    }
    if (game.FlowNow) Fail("a scene player gone should no longer be the one playing");
    // Caught with no scene playing: still captured; out of the cell, it goes on as the graph says.
    game.Reset();
    if (vcgs::Rules::CatchPlayer("", game) != cell || game.Held.IsNone() || !game.Held.Scene.empty()) Fail("a catch with no scene playing should still capture");
    std::vector<std::string> after;
    {
        vcgs::ScenePlayer outOf(game, cell);
        outOf.OnFinished = [&](const std::string& next) { after.push_back(next); };
        outOf.Start();
        outOf.Advance();
    }
    if (!game.Held.IsNone() || after.size() != 1) Fail("out of the cell should finish it");
    std::printf("caught in play: %s\n", caught.empty() ? "-" : caught[0].c_str());
    return failures == 0 ? 0 : 1;
}
