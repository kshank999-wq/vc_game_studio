// The Character Creator's cast with the VCGS Runtime for Unreal's core: the
// same walk as the Godot and Unity cast checks. characters.json is the schema
// the studio writes; vcgs::Cast's AI machine plays the studio's own scenarios
// (cast_expect.json) transition for transition, reason for reason; inventory,
// abilities and the group's placements are there.
#include "VcgsCast.h"
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>

static int failures = 0;

static void Fail(const std::string& message)
{
    failures++;
    std::fprintf(stderr, "FAIL: %s\n", message.c_str());
}

static vcgs::Value Read(const char* path)
{
    std::ifstream in(path);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return vcgs::JsonReader::Parse(buffer.str());
}

static std::vector<vcgs::Cast::Point> Points(const vcgs::Value& list)
{
    std::vector<vcgs::Cast::Point> out;
    for (const auto& p : list.items) out.push_back(vcgs::Cast::Point{p[0].Num(), p[1].Num(), p.Size() > 2 ? p[2].Num() : 0.0});
    return out;
}

static std::string Join(const std::vector<std::string>& lines)
{
    std::string out;
    for (const auto& l : lines) out += (out.empty() ? "" : " | ") + l;
    return out;
}

int main()
{
    std::ifstream in("Content/VCGS/Generated/characters.json");
    std::stringstream buffer;
    buffer << in.rdbuf();
    std::string error;
    const vcgs::Value cast = vcgs::Cast::Load(buffer.str(), &error);
    if (!cast.IsObject() || cast["version"].Num() != 1) { Fail("characters.json should be vcgs-characters v1: " + error); return 1; }
    const vcgs::Value orc = vcgs::Cast::Character(cast, "orc_sentry");
    if (!orc["ai"].IsObject()) { Fail("Orc Sentry should be in characters.json with an AI profile"); return 1; }
    // The studio's scenarios, step for step.
    const vcgs::Value expect = Read("cast_expect.json");
    for (const auto& sc : expect["scenarios"].items)
    {
        const vcgs::Value c = vcgs::Cast::Character(cast, sc["character"].Str());
        const vcgs::Value& ai = c["ai"];
        const auto patrol = Points(sc["patrol"]);
        std::vector<vcgs::Cast::Wall> walls;
        for (const auto& w : sc["walls"].items) walls.push_back(vcgs::Cast::Wall{{w[0][0].Num(), w[0][1].Num()}, {w[1][0].Num(), w[1][1].Num()}});
        vcgs::Cast::Memory m = vcgs::Cast::StartMemory(ai, patrol, sc["health"].Num());
        const vcgs::Value& t = sc["target"];
        std::vector<std::string> trail;
        for (int i = 0; i < static_cast<int>(sc["steps"].Num()); i++)
        {
            vcgs::Cast::Target target;
            target.X = t["x"].Num() + t["vx"].Num() * i;
            target.Y = t["y"].Num() + t["vy"].Num() * i;
            target.bNoisy = t["noisy"].Bool();
            target.Dz = t["dz"].Num();
            const vcgs::Cast::Step r = vcgs::Cast::AiStep(ai, sc["speed"].Num(), m, target, patrol, walls, sc["dt"].Num());
            m = r.Mem;
            if (!r.Reason.empty()) trail.push_back(r.Reason);
        }
        std::vector<std::string> want;
        for (const auto& w : sc["trail"].items) want.push_back(w.Str());
        if (want != trail) Fail(sc["name"].Str() + ": the trail differs.\n  studio: " + Join(want) + "\n  unreal: " + Join(trail));
        const vcgs::Value& fin = sc["final"];
        if (m.State != fin["state"].Str() || m.Attacks != static_cast<int>(fin["attacks"].Num()) || std::fabs(m.X - fin["x"].Num()) > 0.01 || std::fabs(m.Y - fin["y"].Num()) > 0.01)
            Fail(sc["name"].Str() + ": ends " + m.State + "/" + std::to_string(m.Attacks) + " at (" + std::to_string(m.X) + ", " + std::to_string(m.Y) + "), the studio " + fin["state"].Str() + "/" + fin["attacks"].Str());
        std::printf("ai: %s · %d transitions · ends %s\n", sc["name"].Str().c_str(), static_cast<int>(trail.size()), m.State.c_str());
    }
    // Footsteps: a walk (0.5 m in 0.1 s) is heard, a crouched creep (0.1 m) is not, nor a step in the air, nor being put somewhere (5 m).
    const bool bWalk = vcgs::Cast::Footstep(0.5, 0, 0.1, true), bCreep = vcgs::Cast::Footstep(0.1, 0, 0.1, true), bAir = vcgs::Cast::Footstep(0.5, 0, 0.1, false), bJump = vcgs::Cast::Footstep(5, 0, 0.1, true);
    if (!bWalk || bCreep || bAir || bJump) Fail("footsteps: a walk should be heard, a creep, a step in the air and being put somewhere not");
    std::printf("footsteps: walk %s, creep %s, in the air %s\n", bWalk ? "heard" : "silent", bCreep ? "heard" : "silent", bAir ? "heard" : "silent");
    // Inventory capacity and overflow.
    const vcgs::Value inv = vcgs::JsonReader::Parse(R"({"mode": "stack", "slots": 2, "stack": 10, "weight": 0})");
    const std::map<std::string, int> flares = {{"flare", 15}};
    if (!vcgs::Cast::Fits(inv, flares, "flare", 5).empty()) Fail("20 flares in stacks of 10 should fit 2 slots");
    if (vcgs::Cast::Fits(inv, flares, "flare", 6).empty()) Fail("21 flares should not fit 2 slots of 10");
    const vcgs::Value bag = vcgs::JsonReader::Parse(R"({"mode": "weight", "slots": 0, "stack": 1, "weight": 5})");
    if (vcgs::Cast::Fits(bag, {}, "anvil", 1, {{"anvil", 40.0}}) != "Too heavy: 40 of 5 kg.") Fail("an anvil should be too heavy");
    // Abilities: cost and cooldown.
    const vcgs::Value fireball = vcgs::JsonReader::Parse(R"({"key": "fireball", "name": "Fireball", "enabled": true, "kind": "active", "cost": {"resource": "mana", "amount": 15}, "failure": ""})");
    if (vcgs::Cast::CanUse(fireball, {}, {{"mana", 10.0}}, 0) != "Not enough mana.") Fail("a fireball should need mana");
    if (vcgs::Cast::CanUse(fireball, {{"fireball", 5.0}}, {{"mana", 100.0}}, 1) != "Fireball is cooling down.") Fail("a fireball should cool down");
    // The way round walls (spec §19 navmesh): the machine heads for the corner its way gives it, and stands with no way.
    const vcgs::Cast::Steer corner = [](double, double AY, double TX, double TY, double& VX, double& VY, bool& bLast) {
        if (AY < 2.999) { VX = 0; VY = 3; bLast = false; }
        else { VX = TX; VY = TY; bLast = true; }
        return true;
    };
    vcgs::Cast::Memory walker;
    if (vcgs::Cast::Walk(walker, 3, 0, 1, 1, corner) || std::fabs(walker.X) > 0.001 || std::fabs(walker.Y - 1) > 0.001) Fail("an AI should walk to the corner of its way first, got " + std::to_string(walker.X) + ", " + std::to_string(walker.Y));
    vcgs::Cast::Memory stuck;
    if (vcgs::Cast::Walk(stuck, 3, 0, 1, 1, [](double, double, double, double, double&, double&, bool&) { return false; }) || stuck.X != 0) Fail("an AI with no way there should stand, got " + std::to_string(stuck.X));
    // The Village Market's people, where the studio put them, each a character of the cast.
    int people = 0;
    for (const vcgs::Value* p : vcgs::Cast::Placements(cast))
    {
        if ((*p)["kind"].Str() != "group") continue;
        for (const auto& member : (*p)["members"].items)
        {
            people++;
            if (!vcgs::Cast::Character(cast, member["character"].Str(), member["variant"].Str()).IsObject()) Fail("a villager's character should be in the cast: " + member["character"].Str());
            if (member["position"].Size() != 3) Fail("a villager should have a position");
        }
    }
    // The count is the group's seeded population for this area: 8 to 30 of its kinds.
    if (people < 8 || people > 30) Fail("Village Market should place 8 to 30, got " + std::to_string(people));
    // A variant is the whole character: the Orc Sentry's own name, stats and AI where it differs.
    for (const auto& v : orc["variants"].items)
    {
        const vcgs::Value whole = vcgs::Cast::Character(cast, "orc_sentry", v["key"].Str());
        if (whole["name"].Str() != v["name"].Str() || whole["stats"]["health"].Num() != v["stats"]["health"].Num()) Fail("variant " + v["key"].Str() + " should be resolved as a whole");
    }
    if (orc["variants"].Size() != 2) Fail("the Orc Sentry should have 2 variants");
    std::printf("placed %d villagers; %d Orc Sentry variants\n", people, static_cast<int>(orc["variants"].Size()));
    if (failures > 0) return 1;
    std::printf("cast OK\n");
    return 0;
}
