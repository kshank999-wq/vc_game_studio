import type { IrLevel } from './levels';

/**
 * Levels for Unreal Engine 5 (spec §11.2). The level's data goes over as
 * JSON beside story.json. build_level.py, run in the editor, places an
 * AVcgsLevelItem actor per item (found again by its GUID on the next run),
 * with its graybox pieces as attached StaticMeshActors from the engine's
 * basic shapes, its lights, and an AVcgsLevelDirector that runs the level on
 * the story's state. vcgs::LevelLogic is plain C++17, like the story core,
 * so it is tested outside the engine too.
 *
 * Unreal is Z-up and left-handed, in centimetres, X forward: north in VC Game
 * Studio (−z) is +X, east (+x) is +Y. A turn counter-clockwise from above is
 * a negative yaw.
 */

const RUNTIME_HEAD = '// VCGS Runtime for Unreal. The same for every project; safe to commit.';

export const LEVEL_PLUGIN_FILES: Record<string, string> = {
  'Source/VCGS/Public/VcgsLevel.h': String.raw`${RUNTIME_HEAD}
// A level from VC Game Studio in plain C++17: its items by GUID and their
// rules, run on the story's GameState. AVcgsLevelDirector runs it in a world;
// tests run it anywhere. Standard library only, no exceptions or RTTI.
#pragma once

#include "VcgsCore.h"
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace vcgs
{
    struct LevelOffer
    {
        bool Any = false;
        std::string Verb;
        std::string Label;
        /** Why it can't be done now, or empty when it can. */
        std::string Blocked;
    };

    /** Where an actor that moves is, in level space as the data has it (metres; x east, y up, z south), and what it is doing. */
    struct ActorPose
    {
        double X = 0, Y = 0, Z = 0;
        /** The way it faces (level space, flat), once it has moved or turned. */
        double FacingX = 0, FacingZ = 0;
        bool Faces = false, Moving = false;
        /** The patrol stop it walks to, and the level time it waits until. */
        int Stop = 0;
        double Until = 0;
    };

    class LevelLogic
    {
    public:
        Value Data;
        GameState& Game;
        std::string Key, Name, ExportName;
        std::vector<std::string> Order;
        std::map<std::string, const Value*> Items;
        std::map<std::string, bool> Open, Enabled;
        std::set<std::string> Unlocked, Gone, Done, Inside;
        std::map<std::string, double> Timers;
        std::string Objective;
        double Health = 100;
        double Time = 0;
        /** Actors that move (patrols, companions) by GUID: where each is now. AVcgsLevelDirector moves their actors to match. */
        std::map<std::string, ActorPose> Poses;
        /** Where the player is, in level space: companions follow it. The director sets it each frame. */
        /**
         * What the player is at (as the studio's Play Mode), in level space: a ladder within reach, and
         * how deep the water around their feet is (0 for none). Your character climbs while Ladder is
         * true (forward goes up) and swims once Depth is 1.1 m or more.
         */
        struct Traversal { bool Ladder = false; double Depth = 0; };
        Traversal TraversalAt(double x, double y, double z) const
        {
            Traversal out;
            for (const auto& guid : Order)
            {
                const std::string role = Role(guid);
                if ((role != "ladder" && role != "water") || !IsPresent(guid)) continue;
                const Value& it = Item(guid);
                const Value& at = it["position"];
                const Value& size = it["size"];
                // Into its frame: turned counter-clockwise from above by its turn.
                const double turn = it["turn"].Num(0) * 3.14159265358979323846 / 180;
                const double dx = x - at[0].Num(0), dz = z - at[2].Num(0);
                const double lx = dx * std::cos(turn) - dz * std::sin(turn);
                const double lz = dx * std::sin(turn) + dz * std::cos(turn);
                const double ly = y - at[1].Num(0);
                const double reach = role == "ladder" ? 0.2 : 0;
                if (std::fabs(lx) > size[0].Num(1) / 2 + reach || std::fabs(lz) > size[2].Num(1) / 2 + reach * 2.25) continue;
                if (ly < (role == "ladder" ? -0.2 : -0.25) || ly > size[1].Num(1)) continue;
                if (role == "ladder") out.Ladder = true;
                else out.Depth = std::max(out.Depth, size[1].Num(1) - ly);
            }
            return out;
        }

        /** The player's stamina, 0–100, when the level's player start tracks it. */
        double Stamina = 100;
        std::function<void()> OnExhausted;

        bool TracksStamina() const
        {
            for (const auto& guid : Order) if (Role(guid) == "playerStart") return ParamBool(guid, "stamina", false);
            return false;
        }

        /** Spend stamina for dt seconds of running, swimming or climbing, or win it back at rest. Out of it, the player can't run, and swimming hurts. */
        void SpendStamina(double dt, bool run, bool swim, bool climb)
        {
            if (!TracksStamina()) return;
            const double before = Stamina;
            const double cost = (run ? 15 : 0) + (swim ? 6 : 0) + (climb ? 8 : 0);
            Stamina = std::min(100.0, std::max(0.0, cost > 0 ? Stamina - cost * dt : Stamina + 12 * dt));
            if (before > 0 && Stamina == 0) { if (OnExhausted) OnExhausted(); if (OnMessage) OnMessage("You're exhausted."); }
            if (swim && Stamina == 0) Health -= 15 * dt;
        }

        /** Line of sight: true when something solid lies between two level-space points (x, y, z each); the director sets it (a line trace). Unset, nothing blocks. */
        std::function<bool(double, double, double, double, double, double)> Blocked;
        /** Actors that see the player now; OnActorSpotted / OnActorLostSight say when that changes. */
        std::set<std::string> Seen;
        std::function<void(const std::string&)> OnActorSpotted, OnActorLostSight;

        /**
         * Line of sight (the same rules as the studio's Play Mode): an actor whose sight is over 0
         * sees the player within that range and its field of view (fov, degrees, about the way it
         * faces), with nothing solid in the way. Its "spotted" rules run as the player comes into
         * view, its "lost" rules as they go.
         */
        void Watch()
        {
            if (!HasPlayer) return;
            for (const auto& guid : Order)
            {
                const double reach = Param(guid, "sight").Num(0);
                auto it = Poses.find(guid);
                const bool sees = reach > 0 && IsPresent(guid) && it != Poses.end() && Sees(it->second, reach, Param(guid, "fov").Num(90));
                if (sees && Seen.insert(guid).second) { if (OnActorSpotted) OnActorSpotted(guid); RunRules(guid, "spotted"); }
                else if (!sees && Seen.erase(guid)) { if (OnActorLostSight) OnActorLostSight(guid); RunRules(guid, "lost"); }
            }
        }

        bool Sees(const ActorPose& p, double reach, double fov) const
        {
            const double dx = PlayerX - p.X, dz = PlayerZ - p.Z;
            const double d = std::sqrt(dx * dx + dz * dz);
            if (d > reach || std::fabs(PlayerY - p.Y) > 3) return false;
            if (d > 1e-6 && fov < 360 && p.Faces)
            {
                const double f = std::sqrt(p.FacingX * p.FacingX + p.FacingZ * p.FacingZ);
                if (f > 1e-9 && (p.FacingX * dx + p.FacingZ * dz) / (f * d) < std::cos(fov / 2 * 3.14159265358979323846 / 180) - 1e-9) return false;
            }
            if (!Blocked) return true;
            const double eye = (p.Y + PlayerY) / 2 + 1.6;
            return !Blocked(p.X, eye, p.Z, PlayerX, eye, PlayerZ);
        }

        /** Doors the player is standing at now: each opens (or says why not) once as they come up. */
        std::set<std::string> AtDoors;

        /**
         * Walking up to a closed door opens it, as Interact would, or says what it needs: once each
         * approach (as the studio's Play Mode). A door whose autoOpen is off waits for Interact.
         */
        void ApproachDoors()
        {
            if (!HasPlayer) return;
            std::set<std::string> near;
            for (const auto& guid : Order)
            {
                if (Role(guid) != "door" || !IsPresent(guid)) continue;
                const Value& at = Item(guid)["position"];
                const Value& size = Item(guid)["size"];
                const double width = size[0].Num(1.2);
                const double dx = PlayerX - at[0].Num(0), dz = PlayerZ - at[2].Num(0);
                if (std::fabs(PlayerY - at[1].Num(0)) > 1 || std::sqrt(dx * dx + dz * dz) > std::max(1.1, width / 2 + 0.4)) continue;
                near.insert(guid);
                if (AtDoors.count(guid) || IsOpen(guid) || !ParamBool(guid, "autoOpen", true)) continue;
                Interact(guid);
            }
            AtDoors = near;
        }

        bool HasPlayer = false;
        double PlayerX = 0, PlayerY = 0, PlayerZ = 0;
        /** How far behind a companion may fall before it catches up at once. */
        static constexpr double CatchUp = 12;
        /** The player's light (spec §6), from the player start: what lights it (a story item or mechanic), its fuel (infinity for ever), its reach. */
        std::string LightSource;
        double LightFuelFull = std::numeric_limits<double>::infinity(), LightRange = 8;
        /** Whether the light is on, and the seconds of fuel left. */
        bool LightOn = false;
        double LightFuel = std::numeric_limits<double>::infinity();

        std::function<void(const std::string&)> OnCinematic, OnScene, OnLevel, OnObjective, OnMessage, OnCheckpoint, OnStoryObjectUsed;
        std::function<void(const std::string&, const std::string&, int)> OnSpawn;
        std::function<void(const std::string&, const std::string&)> OnAudio;
        std::function<void()> OnDied, OnRefresh;
        /** The light went on or off. */
        std::function<void(bool)> OnLightChanged;
        /** A travel link was taken (spec V2 §13): its key, the map it leads to ("" for this one), how, and where it ends (level space). */
        std::function<void(const std::string&, const std::string&, const std::string&, double, double, double)> OnTravel;

        LevelLogic(Value data, GameState& game) : Data(std::move(data)), Game(game)
        {
            Key = Data["key"].Str();
            Name = Data["name"].Str();
            ExportName = Data["export_name"].Str();
            const Value& light = Data["light"];
            LightSource = light["source"].Str();
            if (light["fuel"].Num(0) > 0) LightFuelFull = light["fuel"].Num(0);
            LightRange = light["range"].Num(8);
            LightFuel = LightFuelFull;
            const Value& list = Data["items"];
            for (size_t i = 0; i < list.Size(); i++)
            {
                std::string guid = list[i]["guid"].Str();
                Order.push_back(guid);
                Items[guid] = &list[i];
            }
            for (const auto& guid : Order)
            {
                // Actors that move, and those that watch (a pose says where they look).
                const bool watches = Param(guid, "sight").Num(0) > 0;
                if (!Item(guid)["motion"].IsObject() && !watches) continue;
                const Value& at = Item(guid)["position"];
                ActorPose pose;
                pose.X = at[0].Num(0);
                pose.Y = at[1].Num(0);
                pose.Z = at[2].Num(0);
                if (watches)
                {
                    // Turned counter-clockwise from north (−z) by its turn.
                    const double turn = Item(guid)["turn"].Num(0) * 3.14159265358979323846 / 180;
                    pose.FacingX = -std::sin(turn);
                    pose.FacingZ = -std::cos(turn);
                    pose.Faces = true;
                }
                Poses[guid] = pose;
            }
            subscription = Game.Subscribe([this]() { Changed(); });
            for (const auto& guid : Order)
                if (Role(guid) == "spawn" && Item(guid)["kind"].Str() == "marker" && Param(guid, "delay").Num(0) <= 0 && IsPresent(guid)) Spawn(guid);
        }

        ~LevelLogic() { Game.Unsubscribe(subscription); }
        LevelLogic(const LevelLogic&) = delete;
        LevelLogic& operator=(const LevelLogic&) = delete;

        const Value& Item(const std::string& guid) const { auto it = Items.find(guid); return it == Items.end() ? Value::None() : *it->second; }
        std::string Role(const std::string& guid) const { return Item(guid)["role"].Str(); }
        const Value& Param(const std::string& guid, const std::string& key) const { return Item(guid)["params"][key]; }
        bool ParamBool(const std::string& guid, const std::string& key, bool fallback) const
        {
            const Value& v = Param(guid, key);
            return v.type == Value::Type::Bool ? v.boolean : fallback;
        }
        std::string StoryName(const std::string& key) const { std::string n = Data["names"][key].Str(); return n.empty() ? key : n; }

        std::string GuidOf(const std::string& exportName) const
        {
            for (const auto& guid : Order) if (Item(guid)["export_name"].Str() == exportName) return guid;
            return "";
        }

        // ---------------------------------------------------------------- maps and travel (spec V2)

        /** Where this map is in the hierarchy (spec V2 §4): kind, parent, boundary, extent, placement and the maps inside it. */
        const Value& Map() const { return Data["map"]; }
        const Value& ChildMaps() const { return Data["map"]["children"]; }

        /** A travel link by key (None when there is none). */
        const Value& TravelLink(const std::string& key) const
        {
            const Value& list = Data["travel"];
            for (size_t i = 0; i < list.Size(); i++) if (list[i]["key"].Str() == key) return list[i];
            return Value::None();
        }

        /** How far a point (level space) is outside a streamed child's footprint around its anchor; 0 inside. */
        static double OutsideOf(const Value& child, double x, double z)
        {
            const Value& centre = child["centre"];
            const Value& size = child["size"];
            if (centre.Size() < 3 || size.Size() < 2) return std::numeric_limits<double>::infinity();
            const double turn = child["placement"]["turn"].Num(0) * 3.14159265358979323846 / 180;
            const double dx = x - centre[0].Num(0), dz = z - centre[2].Num(0);
            // Into the footprint's own frame: undo its turn (counter-clockwise from above).
            const double lx = dx * std::cos(turn) - dz * std::sin(turn);
            const double lz = dx * std::sin(turn) + dz * std::cos(turn);
            const double ox = std::max(0.0, std::fabs(lx) - size[0].Num(0) / 2);
            const double oz = std::max(0.0, std::fabs(lz) - size[1].Num(0) / 2);
            return std::sqrt(ox * ox + oz * oz);
        }

        /** Streamed children to load (the player within their margin) and to unload (beyond twice it), given those loaded now. */
        std::vector<std::string> StreamChanges(const std::set<std::string>& loaded, std::vector<std::string>& unload) const
        {
            std::vector<std::string> load;
            if (!HasPlayer) return load;
            const Value& children = ChildMaps();
            for (size_t i = 0; i < children.Size(); i++)
            {
                const Value& child = children[i];
                if (child["boundary"].Str() != "streamed" || !child["placement"].IsObject()) continue;
                const std::string key = child["key"].Str();
                const double away = OutsideOf(child, PlayerX, PlayerZ);
                const double margin = child["load_margin"].Num(25);
                if (away <= margin && !loaded.count(key)) load.push_back(key);
                else if (away > margin * 2 && loaded.count(key)) unload.push_back(key);
            }
            return load;
        }

        /** Whether a travel link can be taken now: unlocked, or locked and its rule holds (locked without one, never). */
        bool CanTravel(const std::string& key) const
        {
            const Value& link = TravelLink(key);
            if (!link.IsObject()) return false;
            if (!(link["locked"].type == Value::Type::Bool && link["locked"].boolean)) return true;
            const Value& when = link["unlock_when"];
            return when.IsObject() && when["items"].Size() > 0 && Rules::Check(when, Game);
        }

        /** Take a travel link (backwards with reverse): "" when the player goes (OnTravel says where), else why not. One that leads to another map asks for it too. */
        std::string Travel(const std::string& key, bool reverse = false)
        {
            const Value& link = TravelLink(key);
            if (!link.IsObject()) return "There is no such way.";
            const std::string name = link["name"].Str();
            if (reverse && link["one_way"].type == Value::Type::Bool && link["one_way"].boolean) return name + " only goes one way.";
            if (!CanTravel(key)) return name + " is closed.";
            const Value& points = link["points"];
            const Value& end = points[reverse ? 0 : points.Size() - 1];
            const std::string toMap = reverse ? "" : link["to_map"].Str();
            if (OnTravel) OnTravel(key, toMap, link["transition"].Str(), end[0].Num(0), end[1].Num(0), end[2].Num(0));
            if (!toMap.empty() && OnLevel) OnLevel(toMap);
            return "";
        }

        /** Not taken, not switched off, and its "present only when" holds. */
        bool IsPresent(const std::string& guid) const
        {
            if (!Items.count(guid) || Gone.count(guid)) return false;
            auto e = Enabled.find(guid);
            if (e != Enabled.end() && !e->second) return false;
            return Rules::Check(Item(guid)["active_when"], Game);
        }

        bool IsOpen(const std::string& guid) const
        {
            auto o = Open.find(guid);
            if (o != Open.end()) return o->second;
            return ParamBool(guid, "startsOpen", false) || Param(guid, "swing").Str() == "open archway";
        }

        /** What Interact would do now (Any is false for nothing). */
        LevelOffer Offer(const std::string& guid) const
        {
            LevelOffer out;
            if (!IsPresent(guid)) return out;
            bool rules = HasRule(guid, {"interact", "use", "pickup"});
            const Value& interactive = Param(guid, "interactive");
            bool no = interactive.type == Value::Type::Bool && !interactive.boolean;
            bool yes = interactive.type == Value::Type::Bool && interactive.boolean;
            static const std::set<std::string> kinds = {"door", "pickup", "inventory", "weapon", "ammo", "health", "npc", "companion", "neutral", "dialogue", "interaction", "puzzle", "elevator", "ladder"};
            if (no && !rules) return out;
            if (!yes && !rules && !kinds.count(Role(guid))) return out;
            out.Any = true;
            out.Verb = Param(guid, "prompt").Str();
            if (out.Verb.empty()) out.Verb = "Use";
            out.Label = Item(guid)["name"].Str();
            if (TooDark(guid))
            {
                out.Blocked = HasLightSource() ? "Too dark to see. Turn your light on (L)." : std::string("Too dark to see.") + (LightSource.empty() ? "" : " It needs " + StoryName(LightSource) + " for light.");
                return out;
            }
            if (Role(guid) == "door")
            {
                if (Param(guid, "swing").Str() == "open archway") return LevelOffer();
                std::string key = Param(guid, "keyItem").Str();
                bool locked = ParamBool(guid, "locked", false) && !Unlocked.count(guid);
                bool open = IsOpen(guid);
                if (!open && locked && !key.empty() && !Game.HasItem(key)) out.Blocked = "Locked. Needs " + StoryName(key) + ".";
                else if (!open && locked && key.empty()) out.Blocked = "Locked.";
                else if (open) out.Verb = "Close";
                else if (!locked) out.Verb = "Open";
            }
            return out;
        }

        /** The player uses an item. Returns what to tell them (empty for nothing). */
        std::string Interact(const std::string& guid)
        {
            LevelOffer offer = Offer(guid);
            if (!offer.Any) return "";
            if (!offer.Blocked.empty())
            {
                if (OnMessage) OnMessage(offer.Blocked);
                return offer.Blocked;
            }
            std::string said;
            std::string role = Role(guid);
            static const std::set<std::string> pickups = {"pickup", "inventory", "weapon", "ammo", "health"};
            if (role == "door")
            {
                bool wasOpen = IsOpen(guid);
                if (!wasOpen && ParamBool(guid, "locked", false)) Unlocked.insert(guid);
                Open[guid] = !wasOpen;
            }
            else if (pickups.count(role) && ParamBool(guid, "collectible", true))
            {
                Gone.insert(guid);
                std::string gives = Param(guid, "item").Str();
                if (role == "health") Health = std::min(100.0, Health + Param(guid, "value").Num(25));
                bool rulesGive = false;
                const Value& rules = Item(guid)["rules"];
                for (size_t i = 0; i < rules.Size(); i++)
                {
                    if (rules[i]["on"].Str() != "pickup") continue;
                    const Value& effects = rules[i]["effects"];
                    for (size_t j = 0; j < effects.Size(); j++)
                        if (effects[j]["kind"].Str() == "give" && effects[j]["ref"].Str() == gives) rulesGive = true;
                }
                if (!gives.empty() && !rulesGive) Game.GiveItem(gives, static_cast<int>(Param(guid, "quantity").Num(1)));
                said = "Took " + (gives.empty() ? Item(guid)["name"].Str() : StoryName(gives));
                RunRules(guid, "pickup");
            }
            else if (role == "npc" || role == "companion" || role == "neutral" || role == "dialogue")
            {
                const Value& scenes = Item(guid)["scenes"];
                if (scenes.Size() > 0)
                {
                    Game.Visit(scenes[0].Str());
                    if (OnScene) OnScene(scenes[0].Str());
                }
            }
            else if (!HasRule(guid, {"interact"}))
            {
                const Value& links = Item(guid)["links"];
                for (size_t i = 0; i < links.Size(); i++) if (OnStoryObjectUsed) OnStoryObjectUsed(links[i].Str());
            }
            RunRules(guid, "interact");
            RunRules(guid, "use");
            if (OnRefresh) OnRefresh();
            if (!said.empty() && OnMessage) OnMessage(said);
            return said;
        }

        /** The player comes into a volume. */
        void Enter(const std::string& guid)
        {
            if (Inside.count(guid) || !IsPresent(guid)) return;
            Inside.insert(guid);
            bool once = ParamBool(guid, "once", false);
            if (once && Done.count(guid)) return;
            if (once) Done.insert(guid);
            std::string role = Role(guid);
            std::string cinematic = Param(guid, "cinematic").Str();
            if (role == "cinematic" && !cinematic.empty() && !Plays(guid) && OnCinematic) OnCinematic(cinematic);
            if (role == "checkpoint" && OnCheckpoint) OnCheckpoint(guid);
            if (role == "portal" && !Param(guid, "to").Str().empty() && OnLevel) OnLevel(Param(guid, "to").Str());
            if (role == "spawn" && !Done.count(guid)) Spawn(guid);
            RunRules(guid, "enter");
        }

        void Exit(const std::string& guid)
        {
            if (!Inside.erase(guid)) return;
            RunRules(guid, "exit");
        }

        /** Time passes: hazards hurt, timers and delayed spawns go off. */
        void Tick(double dt)
        {
            Time += dt;
            // Timed puzzle steps run on the play clock.
            Game.AdvanceClock(dt);
            BurnLight(dt);
            // Patrols walk on, companions keep up (the same rules as the studio's Play Mode).
            for (auto& pair : Poses)
            {
                if (!IsPresent(pair.first)) continue;
                // While it sees the player, an actor does what its onSight says: chase, watch, or carry on.
                const std::string reaction = Seen.count(pair.first) ? Param(pair.first, "onSight").Str() : std::string();
                if (reaction == "chase" || reaction == "watch")
                {
                    if (HasPlayer) StepReaction(pair.second, reaction, Param(pair.first, "chaseSpeed").Num(3.5), dt, PlayerX, PlayerY, PlayerZ);
                    continue;
                }
                const Value& motion = Item(pair.first)["motion"];
                // An actor that only watches stands where it is.
                if (!motion.IsObject()) continue;
                if (motion["kind"].Str() == "patrol") StepPatrol(pair.second, motion, dt, Time);
                else if (HasPlayer) StepFollow(pair.second, motion, dt, PlayerX, PlayerY, PlayerZ);
            }
            Watch();
            ApproachDoors();
            for (const auto& guid : std::vector<std::string>(Inside.begin(), Inside.end()))
            {
                std::string role = Role(guid);
                if ((role == "hazard" || role == "damage") && IsPresent(guid))
                    Health = ParamBool(guid, "kills", false) ? 0 : Health - Param(guid, "damage").Num(0) * dt;
            }
            if (Health <= 0)
            {
                Health = 100;
                if (OnDied) OnDied();
            }
            for (const auto& guid : Order)
            {
                if (!IsPresent(guid)) continue;
                if (Role(guid) == "spawn" && Item(guid)["kind"].Str() == "marker" && !Done.count(guid) && Param(guid, "delay").Num(0) <= Time) Spawn(guid);
                const Value& rules = Item(guid)["rules"];
                for (size_t i = 0; i < rules.Size(); i++)
                {
                    if (rules[i]["on"].Str() != "timer") continue;
                    std::string id = guid + ":" + std::to_string(i);
                    double every = std::max(0.5, rules[i]["detail"].Str().empty() ? 5.0 : std::atof(rules[i]["detail"].Str().c_str()));
                    if (Time - Timers[id] < every) continue;
                    Timers[id] = Time;
                    Run(guid, rules[i]);
                }
            }
        }

        /** Whether the player has what lights their light: its story item carried, or its mechanic available. */
        bool HasLightSource() const { return !LightSource.empty() && (Game.HasItem(LightSource) || Game.HasMechanic(LightSource)); }

        bool IsLit() const { return LightOn && HasLightSource(); }

        /** Turn the player's light on or off (L): only with its source, and with fuel left. Returns what to tell them. */
        std::string ToggleLight()
        {
            std::string text;
            if (LightOn) { SetLight(false); text = "Light off."; }
            else if (LightSource.empty()) text = "You have no light here.";
            else if (!HasLightSource()) text = "You need " + StoryName(LightSource) + " for light.";
            else if (LightFuel <= 0) text = "Your light has no fuel left.";
            else { SetLight(true); text = "Light on."; }
            if (OnMessage) OnMessage(text);
            return text;
        }

        /** Something the player can do on the gear screen (spec §8): equip, unequip, use, learn or craft, and why not ("" when they can). */
        struct GearOption
        {
            std::string Act, Key, Label, Why;
        };

        /**
         * Gear, skills and crafting (spec §8): what the player can do now, in the order the
         * studio's Play Mode lists it: each item of equipment carried (Use and Put away when
         * equipped, else Equip), each skill (Learn), each recipe (Craft), with why not.
         */
        std::vector<GearOption> GearMenu() const
        {
            std::vector<GearOption> menu;
            for (const auto& e : Game.StoryData.Root["equipment"].items)
            {
                const std::string key = e["item"].Str();
                if (!Game.HasItem(key)) continue;
                const std::string name = e["name"].Str();
                if (Game.IsEquipped(key))
                {
                    menu.push_back({"use", key, "Use " + name, Game.UseCheck(key)});
                    menu.push_back({"unequip", key, "Put away " + name, ""});
                }
                else menu.push_back({"equip", key, "Equip " + name, Game.EquipCheck(key)});
            }
            for (const auto& k : Game.StoryData.Root["skills"].items)
            {
                const std::string key = k["ident"]["key"].Str();
                menu.push_back({"learn", key, "Learn " + k["name"].Str(), Rules::LearnCheck(key, Game)});
            }
            for (const auto& r : Game.StoryData.Root["recipes"].items)
            {
                const std::string key = r["item"].Str();
                menu.push_back({"craft", key, "Craft " + r["name"].Str(), Game.CraftCheck(key)});
            }
            return menu;
        }

        /** The gear screen as text: GEAR, then each option numbered, with why not in brackets. */
        std::string GearText() const
        {
            std::string text = "GEAR";
            const std::vector<GearOption> menu = GearMenu();
            if (menu.empty()) text += "\nNothing to equip, learn or craft.";
            for (size_t i = 0; i < menu.size(); i++) text += "\n" + std::to_string(i + 1) + ". " + menu[i].Label + (menu[i].Why.empty() ? std::string() : " (" + menu[i].Why + ")");
            return text;
        }

        /** Do one: equip, unequip, use, learn or craft, by the story's rules. Returns what to tell the player ("Equipped Diving Knife", "Crafted 2 × Flare", or why not), as the studio says it. */
        std::string GearDo(const std::string& act, const std::string& key)
        {
            std::string name = key;
            int makes = 1;
            for (const char* list : {"equipment", "recipes"})
                for (const auto& e : Game.StoryData.Root[list].items)
                    if (e["item"].Str() == key)
                    {
                        name = e["name"].Str();
                        if (std::string(list) == "recipes") makes = static_cast<int>(e["makes"].Num(1));
                    }
            for (const auto& k : Game.StoryData.Root["skills"].items)
                if (k["ident"]["key"].Str() == key) name = k["name"].Str();
            std::string why, done;
            if (act == "equip") { why = Game.Equip(key); done = "Equipped " + name; }
            else if (act == "unequip") { why = Game.Unequip(key); done = "Put away " + name; }
            else if (act == "use") { why = Game.UseItem(key); done = "Used " + name; }
            else if (act == "learn") { why = Rules::Learn(key, Game); done = "Learned " + name; }
            else if (act == "craft") { why = Game.Craft(key); done = "Crafted " + (makes > 1 ? std::to_string(makes) + " \u00d7 " : std::string()) + name; }
            else why = "Nothing to do.";
            const std::string text = why.empty() ? done : why;
            if (OnMessage) OnMessage(text);
            return text;
        }

        /** What is in the player's hand ("" for nothing). */
        std::string InHand() const { return Game.EquippedIn("Hand"); }

        /** Use what is in the hand (R), as Use on the gear screen. */
        std::string UseInHand()
        {
            const std::string key = InHand();
            if (key.empty())
            {
                if (OnMessage) OnMessage("Nothing in hand.");
                return "Nothing in hand.";
            }
            return GearDo("use", key);
        }

        /** How dark it is where the player is (0 to 1): the darkest darkness zone they are in. */
        double Darkness() const
        {
            double dark = 0;
            for (const auto& guid : Inside)
                if (Role(guid) == "darkness" && IsPresent(guid)) dark = std::max(dark, std::min(1.0, std::max(0.0, Param(guid, "dark").Num(92) / 100)));
            return dark;
        }

        /** Whether an item is lost in the dark: in a darkness zone that is here, with the light off. */
        bool TooDark(const std::string& guid) const
        {
            if (IsLit()) return false;
            const Value& zones = Item(guid)["in_dark"];
            for (size_t i = 0; i < zones.Size(); i++) if (IsPresent(zones[i].Str())) return true;
            return false;
        }

        /** Walk a pose toward (x, y, z) at most by metres; true when it gets there. */
        /** While an actor sees the player: face them, and for a chase close in to arm's reach (1 m) at its chase speed. */
        static void StepReaction(ActorPose& p, const std::string& reaction, double speed, double dt, double x, double y, double z)
        {
            const double dx = x - p.X, dz = z - p.Z;
            const double d = std::sqrt(dx * dx + dz * dz);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (reaction != "chase" || d <= 1) { p.Moving = false; return; }
            Walk(p, p.X + dx * (d - 1) / d, y, p.Z + dz * (d - 1) / d, std::max(0.1, speed) * dt);
        }

        static bool Walk(ActorPose& p, double x, double y, double z, double by)
        {
            const double dx = x - p.X, dz = z - p.Z;
            const double d = std::sqrt(dx * dx + dz * dz);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (d <= by || d < 1e-6)
            {
                p.X = x; p.Y = y; p.Z = z;
                p.Moving = d > 1e-6;
                return true;
            }
            const double k = by / d;
            p.X += dx * k; p.Y += (y - p.Y) * k; p.Z += dz * k;
            p.Moving = true;
            return false;
        }

        /** One patrol step: wait at a stop, else walk on to it; arriving starts the wait and aims at the next, round and round. now is the level time after the step. */
        static void StepPatrol(ActorPose& p, const Value& motion, double dt, double now)
        {
            if (now < p.Until) { p.Moving = false; return; }
            const Value& stops = motion["stops"];
            if (stops.Size() == 0) return;
            const Value& stop = stops[static_cast<size_t>(p.Stop) % stops.Size()];
            const Value& at = stop["at"];
            if (!Walk(p, at[0].Num(0), at[1].Num(0), at[2].Num(0), motion["speed"].Num(1.4) * dt)) return;
            p.Moving = false;
            p.Until = now + stop["wait"].Num(0);
            p.Stop = static_cast<int>((static_cast<size_t>(p.Stop) + 1) % stops.Size());
        }

        /** One follow step: keep within the follow distance of the player at (x, y, z), faster when far; more than CatchUp behind, or another floor, and it catches up at once. */
        static void StepFollow(ActorPose& p, const Value& motion, double dt, double x, double y, double z)
        {
            const double dx = x - p.X, dz = z - p.Z;
            const double d = std::sqrt(dx * dx + dz * dz);
            const double distance = motion["distance"].Num(2);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (d > CatchUp || std::fabs(y - p.Y) > 3)
            {
                const double k = d > 1e-6 ? distance / d : 0;
                p.X = x - dx * k; p.Y = y; p.Z = z - (d > 1e-6 ? dz * k : distance);
                p.Moving = false;
            }
            else if (d <= distance) p.Moving = false;
            else
            {
                const double speed = motion["speed"].Num(3.5) * (d > distance * 2.5 ? 1.6 : 1.0);
                const double k = (d - distance) / d;
                Walk(p, p.X + dx * k, y, p.Z + dz * k, speed * dt);
            }
        }

        /** Run an item's rules for an event: each checks its conditions, then changes the story and the level. */
        void RunRules(const std::string& guid, const std::string& on, const std::string& detail = "")
        {
            const Value& rules = Item(guid)["rules"];
            for (size_t i = 0; i < rules.Size(); i++)
            {
                if (rules[i]["on"].Str() != on) continue;
                if (on == "custom" && !detail.empty() && rules[i]["detail"].Str() != detail) continue;
                Run(guid, rules[i]);
            }
        }

    private:
        int subscription = 0;
        int depth = 0;

        bool HasRule(const std::string& guid, std::initializer_list<const char*> on) const
        {
            const Value& rules = Item(guid)["rules"];
            for (size_t i = 0; i < rules.Size(); i++)
                for (const char* o : on) if (rules[i]["on"].Str() == o) return true;
            return false;
        }

        bool Plays(const std::string& guid) const
        {
            const Value& rules = Item(guid)["rules"];
            for (size_t i = 0; i < rules.Size(); i++)
            {
                const Value& actions = rules[i]["actions"];
                for (size_t j = 0; j < actions.Size(); j++) if (actions[j]["kind"].Str() == "playCinematic") return true;
            }
            return false;
        }

        void Run(const std::string& guid, const Value& rule)
        {
            (void)guid;
            if (!Rules::Check(rule["when"], Game)) return;
            Rules::Apply(rule["effects"], Game);
            const Value& actions = rule["actions"];
            for (size_t i = 0; i < actions.Size(); i++) Act(actions[i]);
            if (OnRefresh) OnRefresh();
        }

        void Act(const Value& action)
        {
            std::string kind = action["kind"].Str();
            std::string target = action["target"].Str();
            if (kind == "open") Open[target] = true;
            else if (kind == "close") Open[target] = false;
            else if (kind == "enable") Enabled[target] = true;
            else if (kind == "disable") Enabled[target] = false;
            else if (kind == "spawn") Spawn(target);
            else if (kind == "despawn") Gone.insert(target);
            else if (kind == "startScene") { Game.Visit(target); if (OnScene) OnScene(target); }
            else if (kind == "playCinematic") { if (OnCinematic) OnCinematic(target); }
            else if (kind == "playAudio") { if (OnAudio) OnAudio(target, Param(target, "sound").Str()); }
            else if (kind == "objective")
            {
                Objective = Param(target, "objective").Str();
                if (Objective.empty()) Objective = Item(target)["name"].Str();
                if (OnObjective) OnObjective(Objective);
            }
            else if (kind == "goToLevel") { if (OnLevel) OnLevel(target); }
            else if (kind == "refuel") { LightFuel = LightFuelFull; if (OnMessage) OnMessage("Your light is full again."); }
        }

        void SetLight(bool on)
        {
            LightOn = on;
            if (OnLightChanged) OnLightChanged(on);
        }

        void BurnLight(double dt)
        {
            if (!LightOn) return;
            if (!HasLightSource())
            {
                SetLight(false);
                if (OnMessage) OnMessage("Your light goes out.");
            }
            else if (!std::isinf(LightFuel))
            {
                LightFuel = std::max(0.0, LightFuel - dt);
                if (LightFuel > 0) return;
                SetLight(false);
                if (OnMessage) OnMessage("Your light goes out: no fuel left.");
            }
        }

        void Spawn(const std::string& guid)
        {
            Done.insert(guid);
            if (OnSpawn) OnSpawn(guid, Param(guid, "actor").Str(), static_cast<int>(Param(guid, "count").Num(1)));
        }

        void Changed()
        {
            if (depth > 3) return;
            depth++;
            for (const auto& guid : Order) if (IsPresent(guid)) RunRules(guid, "stateChange");
            depth--;
            if (OnRefresh) OnRefresh();
        }
    };
}
`,

  'Source/VCGS/Public/VcgsLevelItem.h': `${RUNTIME_HEAD}
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "VcgsLevelItem.generated.h"

class UBoxComponent;
class UProceduralMeshComponent;

/**
 * A freeform floor or ceiling (an outline raised to its thickness), kept as
 * data on its item and built into a mesh whenever the item is constructed,
 * so it is there in the editor and in the game without a saved mesh asset.
 */
USTRUCT(BlueprintType)
struct VCGS_API FVcgsSlab
{
    GENERATED_BODY()

    /** Corners around Center in centimetres (X north, Y east), clockwise seen from above. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") TArray<FVector2D> Outline;
    /** Three corner indices per triangle, covering the outline. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") TArray<int32> Triangles;
    /** Its middle, relative to the item. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") FVector Center = FVector(0, 0, 0);
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") float Thickness = 10;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") bool bCollide = true;
    /** Off once there is final art: it still collides, unseen. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") bool bVisible = true;
};

/**
 * One level item from VC Game Studio, placed by build_level.py. Its GUID never
 * changes; its graybox pieces, lights and art are actors attached to it.
 * A volume's Box notices the player.
 */
UCLASS(ClassGroup = (VCGS))
class VCGS_API AVcgsLevelItem : public AActor
{
    GENERATED_BODY()

public:
    AVcgsLevelItem();

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Guid;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString ExportName;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Role;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") FString Revision;
    /** An artist's final art is in place: re-export updates layout and logic but never the art. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") bool bReplacementLocked = false;
    /** Where VC Game Studio last put it; a different place means it was moved in the editor. */
    UPROPERTY(VisibleAnywhere, Category = "VCGS") FVector ExportedLocation;
    UPROPERTY(VisibleAnywhere, Category = "VCGS") float ExportedYaw = 0;
    UPROPERTY(VisibleAnywhere, Category = "VCGS") bool bExported = false;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UBoxComponent* Box = nullptr;

    /** Its freeform floors and ceilings; build_level.py sets them. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") TArray<FVcgsSlab> Slabs;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UProceduralMeshComponent* SlabMesh = nullptr;

    /** A freeform volume's outline raised to its height (instead of Box); build_level.py sets it. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") TArray<FVcgsSlab> Zones;
    /** Zones as convex trigger pieces, one per triangle: it notices the player anywhere inside the outline. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UProceduralMeshComponent* ZoneMesh = nullptr;

    virtual void OnConstruction(const FTransform& Transform) override;
};
`,

  'Source/VCGS/Private/VcgsLevelItem.cpp': `${RUNTIME_HEAD}
#include "VcgsLevelItem.h"
#include "Components/BoxComponent.h"
#include "Components/SceneComponent.h"
#include "ProceduralMeshComponent.h"

AVcgsLevelItem::AVcgsLevelItem()
{
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    Box = CreateDefaultSubobject<UBoxComponent>(TEXT("Box"));
    Box->SetupAttachment(RootComponent);
    // build_level.py sizes it and turns on overlap events for volumes.
    Box->SetGenerateOverlapEvents(false);
    Box->SetCollisionProfileName(TEXT("NoCollision"));
    SlabMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Slabs"));
    SlabMesh->SetupAttachment(RootComponent);
    SlabMesh->bUseComplexAsSimpleCollision = true;
    SlabMesh->SetCollisionProfileName(TEXT("BlockAll"));
    ZoneMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Zone"));
    ZoneMesh->SetupAttachment(RootComponent);
    ZoneMesh->bUseComplexAsSimpleCollision = false;
    ZoneMesh->SetGenerateOverlapEvents(false);
    ZoneMesh->SetCollisionProfileName(TEXT("NoCollision"));
}

namespace
{
    /** One face, seen from both sides: each side has its own corners and normal, so either way up it shows and lights. */
    void AddFace(TArray<FVector>& Vertices, TArray<int32>& Triangles, TArray<FVector>& Normals, const FVector* Corners, int32 Count, const FVector& Normal)
    {
        for (int32 Side = 0; Side < 2; Side++)
        {
            const int32 Start = Vertices.Num();
            const FVector N = Side == 0 ? Normal : FVector(-Normal.X, -Normal.Y, -Normal.Z);
            for (int32 i = 0; i < Count; i++)
            {
                Vertices.Add(Corners[i]);
                Normals.Add(N);
            }
            for (int32 i = 1; i + 1 < Count; i++)
            {
                Triangles.Add(Start);
                Triangles.Add(Start + (Side == 0 ? i : i + 1));
                Triangles.Add(Start + (Side == 0 ? i + 1 : i));
            }
        }
    }
}

void AVcgsLevelItem::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    if (!SlabMesh) return;
    SlabMesh->ClearAllMeshSections();
    for (int32 Index = 0; Index < Slabs.Num(); Index++)
    {
        FVcgsSlab& Slab = Slabs[Index];
        const int32 Count = Slab.Outline.Num();
        if (Count < 3) continue;
        const double Half = Slab.Thickness / 2;
        TArray<FVector> Vertices;
        TArray<int32> Triangles;
        TArray<FVector> Normals;
        auto Corner = [&](int32 i, double Z) { return FVector(Slab.Center.X + Slab.Outline[i].X, Slab.Center.Y + Slab.Outline[i].Y, Slab.Center.Z + Z); };
        for (int32 k = 0; k + 2 < Slab.Triangles.Num(); k += 3)
        {
            const int32 A = Slab.Triangles[k], B = Slab.Triangles[k + 1], C = Slab.Triangles[k + 2];
            if (A < 0 || B < 0 || C < 0 || A >= Count || B >= Count || C >= Count) continue;
            const FVector Top[3] = {Corner(A, Half), Corner(B, Half), Corner(C, Half)};
            const FVector Bottom[3] = {Corner(A, -Half), Corner(C, -Half), Corner(B, -Half)};
            AddFace(Vertices, Triangles, Normals, Top, 3, FVector(0, 0, 1));
            AddFace(Vertices, Triangles, Normals, Bottom, 3, FVector(0, 0, -1));
        }
        for (int32 i = 0; i < Count; i++)
        {
            const int32 j = (i + 1) % Count;
            const FVector Quad[4] = {Corner(j, Half), Corner(i, Half), Corner(i, -Half), Corner(j, -Half)};
            const double DX = Slab.Outline[j].X - Slab.Outline[i].X;
            const double DY = Slab.Outline[j].Y - Slab.Outline[i].Y;
            const double Length = DX * DX + DY * DY > 0 ? FMath::Sqrt(DX * DX + DY * DY) : 1;
            AddFace(Vertices, Triangles, Normals, Quad, 4, FVector(DY / Length, -DX / Length, 0));
        }
        SlabMesh->CreateMeshSection_LinearColor(Index, Vertices, Triangles, Normals, TArray<FVector2D>(), TArray<FLinearColor>(), TArray<FProcMeshTangent>(), Slab.bCollide);
        SlabMesh->SetMeshSectionVisible(Index, Slab.bVisible);
    }

    // A freeform volume: a convex prism per triangle, as the zone's trigger collision.
    if (!ZoneMesh) return;
    ZoneMesh->ClearCollisionConvexMeshes();
    int32 Pieces = 0;
    for (int32 Index = 0; Index < Zones.Num(); Index++)
    {
        FVcgsSlab& Zone = Zones[Index];
        const int32 Count = Zone.Outline.Num();
        const double Half = Zone.Thickness / 2;
        for (int32 k = 0; k + 2 < Zone.Triangles.Num(); k += 3)
        {
            TArray<FVector> Prism;
            for (int32 c = 0; c < 3; c++)
            {
                const int32 i = Zone.Triangles[k + c];
                if (i < 0 || i >= Count) continue;
                Prism.Add(FVector(Zone.Center.X + Zone.Outline[i].X, Zone.Center.Y + Zone.Outline[i].Y, Zone.Center.Z + Half));
                Prism.Add(FVector(Zone.Center.X + Zone.Outline[i].X, Zone.Center.Y + Zone.Outline[i].Y, Zone.Center.Z - Half));
            }
            if (Prism.Num() != 6) continue;
            ZoneMesh->AddCollisionConvexMesh(Prism);
            Pieces++;
        }
    }
    ZoneMesh->SetGenerateOverlapEvents(Pieces > 0);
    ZoneMesh->SetCollisionProfileName(Pieces > 0 ? TEXT("Trigger") : TEXT("NoCollision"));
}
`,

  'Source/VCGS/Public/VcgsTravelLink.h': `${RUNTIME_HEAD}
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "VcgsTravelLink.generated.h"

class USplineComponent;

/**
 * A travel link from VC Game Studio (spec V2 §13): a road, trail, river,
 * route or transition, as a spline through its points. Take it with
 * AVcgsLevelDirector::Travel(Key); its lock and where it leads are in the level data.
 */
UCLASS(ClassGroup = (VCGS))
class VCGS_API AVcgsTravelLink : public AActor
{
    GENERATED_BODY()

public:
    AVcgsTravelLink();

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Key;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Kind;
    /** The map it takes the player to, if any. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString ToMap;
    /** Its points in the world, in centimetres; build_level.py sets them. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "VCGS") TArray<FVector> Points;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") USplineComponent* Spline = nullptr;

    virtual void OnConstruction(const FTransform& Transform) override;
};
`,

  'Source/VCGS/Private/VcgsTravelLink.cpp': `${RUNTIME_HEAD}
#include "VcgsTravelLink.h"
#include "Components/SplineComponent.h"

AVcgsTravelLink::AVcgsTravelLink()
{
    Spline = CreateDefaultSubobject<USplineComponent>(TEXT("Spline"));
    RootComponent = Spline;
}

void AVcgsTravelLink::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    Spline->ClearSplinePoints(false);
    for (const FVector& Point : Points) Spline->AddSplinePoint(Point, ESplineCoordinateSpace::World, false);
    Spline->UpdateSpline();
}
`,

  'Source/VCGS/Public/VcgsLevelDirector.h': `${RUNTIME_HEAD}
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "VcgsLevel.h"
#include <memory>
#include "VcgsLevelDirector.generated.h"

class AVcgsLevelItem;
class UPrimitiveComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FVcgsLevelKeyEvent, const FString&, Key);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FVcgsLightEvent, bool, bOn);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FVcgsLevelSpawnEvent, AVcgsLevelItem*, Spawner, const FString&, ActorKey, int32, Count);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FVcgsTravelEvent, const FString&, LinkKey, const FString&, ToMap, const FString&, Transition, FVector, To);

/**
 * Runs a level from VC Game Studio in the world: its items (AVcgsLevelItem,
 * found by GUID) come and go with their conditions, doors open and shut,
 * volumes notice the player, rules change the story. build_level.py places
 * one and sets LevelFile. Bind the events to play cinematics and scenes.
 */
UCLASS(ClassGroup = (VCGS))
class VCGS_API AVcgsLevelDirector : public AActor
{
    GENERATED_BODY()

public:
    AVcgsLevelDirector();

    /** Under Content/, e.g. VCGS/Generated/Levels/sunken_vault.json. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString LevelFile;
    /** The map's key (spec V2 §4): a parent's director finds its children's by it. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString MapKey;
    /** How the game reaches it (spec V2 §13): continuous, streamed, instanced, transition or mapOnly. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Boundary = TEXT("continuous");
    /** Where this map's 0, 0, 0 is in the world, and its turn: a child map built inside its parent. build_level.py sets them. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FVector MapOrigin = FVector(0, 0, 0);
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") float MapYaw = 0;
    /** A streamed map is shown only while loaded: its parent's director loads it as the player nears it. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") bool bMapLoaded = true;

    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnCinematicRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnSceneRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnLevelRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnObjectiveChanged;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnMessage;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelSpawnEvent OnSpawnRequested;
    /** The player's light went on or off: show or hide its lamp. */
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLightEvent OnLightChanged;
    /** A travel link was taken (spec V2 §13): where it ends (world, cm), how, and the map it leads to ("" for this one). Move the player there. */
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsTravelEvent OnTravelRequested;
    /** An actor with a sight saw the player, or lost sight of them (its GUID); its "spotted" / "lost" rules run too. */
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnActorSpotted;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnActorLostSight;

    /** Take a travel link by key (backwards with bReverse); returns why not, or "" when the player goes. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Travel(const FString& LinkKey, bool bReverse = false);
    UFUNCTION(BlueprintPure, Category = "VCGS") bool CanTravel(const FString& LinkKey) const;
    /** Show or hide a streamed map's items (its parent's director does this as the player comes and goes). */
    UFUNCTION(BlueprintCallable, Category = "VCGS") void SetMapLoaded(bool bLoaded);

    /** Use an item (by GUID); returns what to tell the player. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Interact(const FString& Guid);
    /** What Interact would say for an item now ("" for nothing to do). */
    UFUNCTION(BlueprintPure, Category = "VCGS") FString OfferText(const FString& Guid) const;
    /** The nearest item the player can use from here, facing this way, or "". */
    UFUNCTION(BlueprintPure, Category = "VCGS") FString NearestOffer(const FVector& From, const FVector& Facing) const;
    UFUNCTION(BlueprintPure, Category = "VCGS") bool IsPresent(const FString& Guid) const;
    /** Turn the player's light on or off (bind to L); returns what to tell the player. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString ToggleLight();
    /** Gear, skills and crafting (spec §8): bind your own keys (the studio uses R to use what is in hand, I for the gear screen). */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString UseInHand();
    UFUNCTION(BlueprintPure, Category = "VCGS") FString InHand() const;
    /** The gear screen as text, each option numbered; GearPick does the nth (from 0). */
    UFUNCTION(BlueprintPure, Category = "VCGS") FString GearText() const;
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString GearPick(int32 Index);
    /** Equip, unequip, use, learn or craft by story key ("equip", "diving_knife"). */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString GearDo(const FString& Act, const FString& Key);
    UFUNCTION(BlueprintPure, Category = "VCGS") bool IsLit() const;
    /** Seconds of fuel left (-1 for a light that never runs out). */
    UFUNCTION(BlueprintPure, Category = "VCGS") float LightFuel() const;
    /** How far the light reaches, in centimetres. */
    UFUNCTION(BlueprintPure, Category = "VCGS") float LightRange() const;
    /** How dark it is where the player is (0 to 1): darken the screen by this, less with the light on. */
    UFUNCTION(BlueprintPure, Category = "VCGS") float Darkness() const;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

private:
    std::unique_ptr<vcgs::LevelLogic> Logic;
    TMap<FString, AVcgsLevelItem*> ItemsByGuid;

    void Refresh();
    void MoveActors();
    void Stream();
    /** Level space (metres, x east, y up, z south) to the world (cm, X north, Y east, Z up) through MapOrigin and MapYaw, and back. */
    FVector ToWorld(double X, double Y, double Z) const;
    void FromWorld(const FVector& At, double& X, double& Y, double& Z) const;
    UFUNCTION() void OnBoxBegin(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp, int32 BodyIndex, bool bFromSweep, const FHitResult& Sweep);
    UFUNCTION() void OnBoxEnd(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp, int32 BodyIndex);
    bool IsPlayer(const AActor* Other) const;
    FString GuidOfBox(const UPrimitiveComponent* Box) const;
};
`,

  'Source/VCGS/Private/VcgsLevelDirector.cpp': `${RUNTIME_HEAD}
#include "VcgsLevelDirector.h"
#include "VcgsConvert.h"
#include "VcgsLevelItem.h"
#include "VcgsSubsystem.h"
#include "Components/BoxComponent.h"
#include "ProceduralMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include <cmath>
#include "Kismet/GameplayStatics.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

using VcgsConvert::ToF;
using VcgsConvert::ToStd;

AVcgsLevelDirector::AVcgsLevelDirector()
{
    PrimaryActorTick.bCanEverTick = true;
}

void AVcgsLevelDirector::BeginPlay()
{
    Super::BeginPlay();
    UGameInstance* GameInstance = GetWorld() ? GetWorld()->GetGameInstance() : nullptr;
    UVcgsSubsystem* Story = GameInstance ? GameInstance->GetSubsystem<UVcgsSubsystem>() : nullptr;
    FString Json;
    if (!Story || !Story->State() || !FFileHelper::LoadFileToString(Json, *(FPaths::ProjectContentDir() / LevelFile)))
    {
        UE_LOG(LogTemp, Error, TEXT("VCGS: the level director needs the VCGS subsystem and its LevelFile (%s)."), *LevelFile);
        return;
    }
    std::string Error;
    vcgs::Value Data = vcgs::JsonReader::Parse(ToStd(Json), &Error);
    Logic = std::make_unique<vcgs::LevelLogic>(std::move(Data), *Story->State());
    Logic->OnCinematic = [this](const std::string& Key) { OnCinematicRequested.Broadcast(ToF(Key)); };
    Logic->OnScene = [this](const std::string& Key) { OnSceneRequested.Broadcast(ToF(Key)); };
    Logic->OnLevel = [this](const std::string& Key) { OnLevelRequested.Broadcast(ToF(Key)); };
    Logic->OnObjective = [this](const std::string& Text) { OnObjectiveChanged.Broadcast(ToF(Text)); };
    Logic->OnMessage = [this](const std::string& Text) { OnMessage.Broadcast(ToF(Text)); };
    Logic->OnSpawn = [this](const std::string& Guid, const std::string& ActorKey, int Count) {
        AVcgsLevelItem* const* Spawner = ItemsByGuid.Find(ToF(Guid));
        OnSpawnRequested.Broadcast(Spawner ? *Spawner : nullptr, ToF(ActorKey), Count);
    };
    Logic->OnRefresh = [this]() { Refresh(); };
    Logic->OnLightChanged = [this](bool bOn) { OnLightChanged.Broadcast(bOn); };
    Logic->OnTravel = [this](const std::string& Key, const std::string& ToMap, const std::string& How, double X, double Y, double Z) {
        OnTravelRequested.Broadcast(ToF(Key), ToF(ToMap), ToF(How), ToWorld(X, Y, Z));
    };
    Logic->OnActorSpotted = [this](const std::string& Guid) { OnActorSpotted.Broadcast(ToF(Guid)); };
    Logic->OnActorLostSight = [this](const std::string& Guid) { OnActorLostSight.Broadcast(ToF(Guid)); };
    // Sight is blocked by anything solid but the player and the actors themselves (a visibility trace).
    Logic->Blocked = [this](double AX, double AY, double AZ, double BX, double BY, double BZ) {
        UWorld* World = GetWorld();
        if (!World) return false;
        FCollisionQueryParams Params(FName(TEXT("VcgsSight")), false);
        if (const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0)) Params.AddIgnoredActor(Pawn);
        for (const auto& Pose : Logic->Poses)
            if (AVcgsLevelItem* const* Item = ItemsByGuid.Find(ToF(Pose.first))) Params.AddIgnoredActor(*Item);
        FHitResult Hit;
        return World->LineTraceSingleByChannel(Hit, ToWorld(AX, AY, AZ), ToWorld(BX, BY, BZ), ECC_Visibility, Params);
    };
    // A streamed map starts unloaded: its parent's director brings it in.
    bMapLoaded = Boundary != TEXT("streamed");
    for (TActorIterator<AVcgsLevelItem> It(GetWorld()); It; ++It)
    {
        AVcgsLevelItem* Item = *It;
        // Other maps' items (a child built inside this one, a parent) are their directors'.
        if (!Logic->Items.count(ToStd(Item->Guid))) continue;
        ItemsByGuid.Add(Item->Guid, Item);
        if (Item->Box)
        {
            Item->Box->OnComponentBeginOverlap.AddDynamic(this, &AVcgsLevelDirector::OnBoxBegin);
            Item->Box->OnComponentEndOverlap.AddDynamic(this, &AVcgsLevelDirector::OnBoxEnd);
        }
        // A freeform volume notices the player through its zone instead.
        if (Item->ZoneMesh)
        {
            Item->ZoneMesh->OnComponentBeginOverlap.AddDynamic(this, &AVcgsLevelDirector::OnBoxBegin);
            Item->ZoneMesh->OnComponentEndOverlap.AddDynamic(this, &AVcgsLevelDirector::OnBoxEnd);
        }
    }
    Refresh();
}

void AVcgsLevelDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Logic) return;
    // The player in level space: Unreal's +X is the data's north (-z), +Y its east, Z up, in centimetres.
    if (const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
    {
        Logic->HasPlayer = true;
        FromWorld(Pawn->GetActorLocation(), Logic->PlayerX, Logic->PlayerY, Logic->PlayerZ);
    }
    Logic->Tick(DeltaSeconds);
    MoveActors();
    Stream();
}

FVector AVcgsLevelDirector::ToWorld(double X, double Y, double Z) const
{
    // Unreal's +X is the data's north (-z), +Y its east, Z up, in centimetres; then the map's turn and origin.
    const double LX = -Z * 100.0, LY = X * 100.0;
    const double Yaw = MapYaw * 3.14159265358979323846 / 180.0;
    return FVector(MapOrigin.X + LX * std::cos(Yaw) - LY * std::sin(Yaw), MapOrigin.Y + LX * std::sin(Yaw) + LY * std::cos(Yaw), MapOrigin.Z + Y * 100.0);
}

void AVcgsLevelDirector::FromWorld(const FVector& At, double& X, double& Y, double& Z) const
{
    const double Yaw = MapYaw * 3.14159265358979323846 / 180.0;
    const double DX = At.X - MapOrigin.X, DY = At.Y - MapOrigin.Y;
    const double LX = DX * std::cos(Yaw) + DY * std::sin(Yaw), LY = -DX * std::sin(Yaw) + DY * std::cos(Yaw);
    X = LY / 100.0;
    Y = (At.Z - MapOrigin.Z) / 100.0;
    Z = -LX / 100.0;
}

/** Streamed children (spec V2 §13): their directors show their items as the player nears them and hide them when well away. */
void AVcgsLevelDirector::Stream()
{
    if (!Logic || !Logic->HasPlayer || !Logic->ChildMaps().Size()) return;
    std::map<std::string, AVcgsLevelDirector*> Children;
    std::set<std::string> Loaded;
    for (TActorIterator<AVcgsLevelDirector> It(GetWorld()); It; ++It)
    {
        AVcgsLevelDirector* Other = *It;
        if (Other == this) continue;
        Children[ToStd(Other->MapKey)] = Other;
        if (Other->bMapLoaded) Loaded.insert(ToStd(Other->MapKey));
    }
    std::vector<std::string> Unload;
    for (const auto& Key : Logic->StreamChanges(Loaded, Unload))
        if (Children.count(Key)) Children[Key]->SetMapLoaded(true);
    for (const auto& Key : Unload)
        if (Children.count(Key)) Children[Key]->SetMapLoaded(false);
}

void AVcgsLevelDirector::SetMapLoaded(bool bLoaded)
{
    bMapLoaded = bLoaded;
    Refresh();
}

FString AVcgsLevelDirector::Travel(const FString& LinkKey, bool bReverse)
{
    return Logic ? ToF(Logic->Travel(ToStd(LinkKey), bReverse)) : FString();
}

bool AVcgsLevelDirector::CanTravel(const FString& LinkKey) const
{
    return Logic && Logic->CanTravel(ToStd(LinkKey));
}

/** Put each actor that moves (patrols, companions) where the level logic has it, facing the way it goes. */
void AVcgsLevelDirector::MoveActors()
{
    for (const auto& Pose : Logic->Poses)
    {
        AVcgsLevelItem* const* Item = ItemsByGuid.Find(ToF(Pose.first));
        if (!Item || !*Item) continue;
        const vcgs::ActorPose& P = Pose.second;
        (*Item)->SetActorLocation(ToWorld(P.X, P.Y, P.Z));
        if (P.Faces) (*Item)->SetActorRotation(FRotator(0.0, MapYaw + std::atan2(P.FacingX, -P.FacingZ) * 180.0 / 3.14159265358979323846, 0.0));
    }
}

/** Show what is there, hide what is not, open and shut doors. Pieces are the actors attached to an item. */
void AVcgsLevelDirector::Refresh()
{
    if (!Logic) return;
    for (auto& Pair : ItemsByGuid)
    {
        const std::string Guid = ToStd(Pair.Key);
        const bool Here = bMapLoaded && Logic->IsPresent(Guid);
        const bool Door = Logic->Role(Guid) == "door";
        const bool Shut = Here && !Logic->IsOpen(Guid);
        AVcgsLevelItem* Item = Pair.Value;
        Item->SetActorHiddenInGame(!Here);
        Item->SetActorEnableCollision(Here);
        TArray<AActor*> Pieces;
        Item->GetAttachedActors(Pieces);
        for (AActor* Piece : Pieces)
        {
            // The designer's markers (player start, patrol stops, spawns) are the editor's: never shown in play.
            const bool Show = Piece->ActorHasTag(FName(TEXT("vcgs_scaffold"))) ? false : Door ? Shut : Here;
            Piece->SetActorHiddenInGame(!Show);
            Piece->SetActorEnableCollision(Show);
        }
    }
}

bool AVcgsLevelDirector::IsPlayer(const AActor* Other) const
{
    return Other && Other == UGameplayStatics::GetPlayerPawn(this, 0);
}

FString AVcgsLevelDirector::GuidOfBox(const UPrimitiveComponent* Box) const
{
    for (const auto& Pair : ItemsByGuid)
        if (Pair.Value->Box == Box || Pair.Value->ZoneMesh == Box) return Pair.Key;
    return FString();
}

void AVcgsLevelDirector::OnBoxBegin(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp, int32 BodyIndex, bool bFromSweep, const FHitResult& Sweep)
{
    if (Logic && IsPlayer(Other)) Logic->Enter(ToStd(GuidOfBox(Overlapped)));
}

void AVcgsLevelDirector::OnBoxEnd(UPrimitiveComponent* Overlapped, AActor* Other, UPrimitiveComponent* OtherComp, int32 BodyIndex)
{
    if (Logic && IsPlayer(Other)) Logic->Exit(ToStd(GuidOfBox(Overlapped)));
}

FString AVcgsLevelDirector::Interact(const FString& Guid)
{
    return Logic ? ToF(Logic->Interact(ToStd(Guid))) : FString();
}

FString AVcgsLevelDirector::OfferText(const FString& Guid) const
{
    if (!Logic) return FString();
    vcgs::LevelOffer Offer = Logic->Offer(ToStd(Guid));
    if (!Offer.Any) return FString();
    return ToF(Offer.Blocked.empty() ? Offer.Verb + " · " + Offer.Label : Offer.Label + ": " + Offer.Blocked);
}

bool AVcgsLevelDirector::IsPresent(const FString& Guid) const
{
    return Logic && Logic->IsPresent(ToStd(Guid));
}

FString AVcgsLevelDirector::ToggleLight()
{
    return Logic ? ToF(Logic->ToggleLight()) : FString();
}

FString AVcgsLevelDirector::UseInHand()
{
    return Logic ? ToF(Logic->UseInHand()) : FString();
}

FString AVcgsLevelDirector::InHand() const
{
    return Logic ? ToF(Logic->InHand()) : FString();
}

FString AVcgsLevelDirector::GearText() const
{
    return Logic ? ToF(Logic->GearText()) : FString();
}

FString AVcgsLevelDirector::GearPick(int32 Index)
{
    if (!Logic) return FString();
    const auto menu = Logic->GearMenu();
    if (Index < 0 || Index >= static_cast<int32>(menu.size())) return FString();
    return ToF(Logic->GearDo(menu[Index].Act, menu[Index].Key));
}

FString AVcgsLevelDirector::GearDo(const FString& Act, const FString& Key)
{
    return Logic ? ToF(Logic->GearDo(ToStd(Act), ToStd(Key))) : FString();
}

bool AVcgsLevelDirector::IsLit() const
{
    return Logic && Logic->IsLit();
}

float AVcgsLevelDirector::LightFuel() const
{
    return !Logic || std::isinf(Logic->LightFuel) ? -1.f : static_cast<float>(Logic->LightFuel);
}

float AVcgsLevelDirector::LightRange() const
{
    return Logic ? static_cast<float>(Logic->LightRange * 100) : 0.f;
}

float AVcgsLevelDirector::Darkness() const
{
    return Logic ? static_cast<float>(Logic->Darkness()) : 0.f;
}

FString AVcgsLevelDirector::NearestOffer(const FVector& From, const FVector& Facing) const
{
    if (!Logic) return FString();
    FString Best;
    double BestD = 1e30;
    for (const auto& Pair : ItemsByGuid)
    {
        const std::string Guid = ToStd(Pair.Key);
        if (!Logic->Offer(Guid).Any) continue;
        FVector To = Pair.Value->GetActorLocation() - From;
        To.Z = 0;
        const vcgs::Value& Size = Logic->Item(Guid)["size"];
        const double Reach = (Logic->Param(Guid, "range").Num(1.5) + std::max(Size[0].Num(1), Size[2].Num(1)) / 2 + 0.3) * 100;
        const double D = To.Size();
        if (D > Reach || D >= BestD) continue;
        if (!Facing.IsNearlyZero() && D > 60 && FVector::DotProduct(To.GetSafeNormal(), Facing.GetSafeNormal()) < 0.3) continue;
        Best = Pair.Key;
        BestD = D;
    }
    return Best;
}
`,
};

/** The editor script that places and updates a level's actors (Tools > Execute Python Script). */
export const buildLevelScript = (root: string): string => String.raw`# Generated by VC Game Studio. Run it in the Unreal Editor (Tools > Execute
# Python Script, with the Python Editor Script Plugin on) with the level you
# want the items in open. It builds the level from its data, or updates what
# it built last time: items are found by their GUID.
#
# A map that is part of another (spec V2 §12): a continuous or streamed child is
# built into the same world at its place in its parent, and its director shows
# it while it is loaded; a level reached by a transition is built in its own
# Unreal level. Set LEVEL to each map in turn.
#
# Who owns what: VC Game Studio owns each item's place, name, graybox pieces,
# lights and data. Anything else attached to an item (its art, anything added
# by hand) is the team's and is never touched. An item moved in the editor
# keeps its place and is reported, unless VCGS_WINS is set to True. Items gone
# from the level are reported and left for you to delete.
import json
import math
import os

import unreal

LEVELS = os.path.join(unreal.Paths.project_content_dir(), "${root.replace(/^Content\/?/, '')}/Levels")
LEVEL = ""  # The level's key (its file name); empty builds the only one, or asks.
VCGS_WINS = False
SHAPES = {"box": "/Engine/BasicShapes/Cube.Cube", "cylinder": "/Engine/BasicShapes/Cylinder.Cylinder", "sphere": "/Engine/BasicShapes/Sphere.Sphere", "cone": "/Engine/BasicShapes/Cone.Cone", "wedge": "/Engine/BasicShapes/Cube.Cube"}


def to_unreal(v):
    """VC Game Studio (x east, y up, z south, metres) to Unreal (X north, Y east, Z up, cm)."""
    return unreal.Vector(-v[2] * 100.0, v[0] * 100.0, v[1] * 100.0)


def yaw_of(turn):
    return -turn


def level_file():
    files = sorted(f for f in os.listdir(LEVELS) if f.endswith(".json"))
    if LEVEL:
        return os.path.join(LEVELS, LEVEL + ".json")
    if len(files) != 1:
        raise RuntimeError("Set LEVEL at the top of build_level.py to one of: " + ", ".join(f[:-5] for f in files))
    return os.path.join(LEVELS, files[0])


def spawn(cls, location, rotation, label):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(cls, location, rotation)
    actor.set_actor_label(label)
    return actor


def clear_pieces(item):
    for child in item.get_attached_actors():
        if child.actor_has_tag("vcgs_piece"):
            child.destroy_actor()


def color_of(hex_color):
    n = int(hex_color.lstrip("#")[:6], 16)
    return unreal.LinearColor(((n >> 16) & 255) / 255.0, ((n >> 8) & 255) / 255.0, (n & 255) / 255.0, 1.0)


def slab_of(piece, with_mesh):
    """A freeform floor or ceiling, as data for the item to build (AVcgsLevelItem::OnConstruction)."""
    yaw = math.radians(yaw_of(piece["turn"]))
    outline = []
    for x, z in piece["outline"]:
        px, py = -z * 100.0, x * 100.0
        outline.append(unreal.Vector2D(px * math.cos(yaw) - py * math.sin(yaw), px * math.sin(yaw) + py * math.cos(yaw)))
    slab = unreal.VcgsSlab()
    slab.set_editor_property("outline", outline)
    slab.set_editor_property("triangles", list(piece["triangles"]))
    slab.set_editor_property("center", to_unreal(piece["at"]))
    slab.set_editor_property("thickness", piece["size"][1] * 100.0)
    slab.set_editor_property("collide", piece["collide"])
    slab.set_editor_property("visible", with_mesh)
    return slab


PEOPLE = ("npc", "enemy", "companion", "neutral")


def _figure_part(shape, at, size, tint):
    return {"part": "figure", "shape": shape, "at": at, "size": size, "turn": 0.0, "collide": False, "tint": tint}


# Each role's colour, as in the studio's Play Mode: legs and hips a shade darker, the head skin.
PEOPLE_COLORS = {"npc": (0.85, 0.38, 0.48), "enemy": (0.9, 0.28, 0.3), "companion": (0.37, 0.66, 0.83), "neutral": (0.6, 0.56, 0.48)}
SKIN = (0.85, 0.71, 0.56)
MATERIALS = "${'/' + ['Game', root.replace(/^Content\/?/, '')].filter(Boolean).join('/')}/Materials"
_materials = {}


def tint_of(role, tint):
    if tint == "skin":
        return SKIN
    r, g, b = PEOPLE_COLORS[role]
    return (r * 0.55, g * 0.55, b * 0.55) if tint == "dark" else (r, g, b)


def figure_material(role, tint):
    """A colour of Unreal's basic shape material, made once and kept in the project's Materials folder."""
    name = "MI_VCGS_Figure_" + (tint if tint == "skin" else role + "_" + tint)
    if name in _materials:
        return _materials[name]
    path = MATERIALS + "/" + name
    material = None
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.EditorAssetLibrary.load_asset(path)
    else:
        parent = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
        if parent is not None:
            material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, MATERIALS, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            if material is not None:
                r, g, b = tint_of(role, tint)
                unreal.MaterialEditingLibrary.set_material_instance_parent(material, parent)
                unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(material, "Color", unreal.LinearColor(r, g, b, 1.0))
                unreal.MaterialEditingLibrary.update_material_instance(material)
                unreal.EditorAssetLibrary.save_loaded_asset(material)
    _materials[name] = material
    return material


# A plain stand-in person (legs, hips, torso, arms, head, nose), feet at 0, facing north: the studio's Play Mode figure.
FIGURE = [
    _figure_part("cylinder", [-0.1, 0.44, 0.0], [0.15, 0.83, 0.15], "dark"),
    _figure_part("cylinder", [0.1, 0.44, 0.0], [0.15, 0.83, 0.15], "dark"),
    _figure_part("box", [0.0, 0.88, 0.0], [0.34, 0.16, 0.2], "dark"),
    _figure_part("box", [0.0, 1.2, 0.0], [0.38, 0.5, 0.22], "body"),
    _figure_part("cylinder", [-0.25, 1.12, 0.0], [0.12, 0.62, 0.12], "body"),
    _figure_part("cylinder", [0.25, 1.12, 0.0], [0.12, 0.62, 0.12], "body"),
    _figure_part("cylinder", [0.0, 1.49, 0.0], [0.1, 0.08, 0.1], "skin"),
    _figure_part("sphere", [0.0, 1.62, 0.0], [0.24, 0.24, 0.24], "skin"),
    _figure_part("box", [0.0, 1.61, -0.14], [0.04, 0.04, 0.07], "skin"),
]


def place_piece(item, piece, index, with_mesh, report, role=""):
    shape = piece["shape"]
    at = to_unreal(piece["at"])
    size = piece["size"]
    turn = yaw_of(piece["turn"])
    if shape == "wedge":
        # Unreal's basic shapes have no wedge: a slab tilted to the slope, rising to the north.
        length = math.hypot(size[2], size[1])
        scale = unreal.Vector(length, size[0], 0.1)
        rotation = unreal.Rotator(0.0, math.degrees(math.atan2(size[1], size[2])), turn)
    elif shape in ("cylinder", "sphere"):
        scale = unreal.Vector(size[2], size[0], size[1])
        rotation = unreal.Rotator(0.0, 0.0, turn)
    else:
        scale = unreal.Vector(size[2], size[0], max(0.01, size[1]))
        rotation = unreal.Rotator(0.0, 0.0, turn)
    actor = spawn(unreal.StaticMeshActor, item.get_actor_location(), unreal.Rotator(0.0, 0.0, 0.0), item.get_actor_label() + "_" + piece["part"] + "_" + str(index))
    actor.attach_to_actor(item, "", unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, False)
    actor.set_actor_relative_location(at, False, False)
    actor.set_actor_relative_rotation(rotation, False, False)
    actor.set_actor_relative_scale3d(scale)
    actor.tags = ["vcgs_piece", "vcgs_" + piece["part"]]
    component = actor.static_mesh_component
    component.set_static_mesh(unreal.EditorAssetLibrary.load_asset(SHAPES[shape]))
    component.set_visibility(with_mesh)
    component.set_collision_profile_name("BlockAll" if piece["collide"] else "NoCollision")
    if piece.get("tint") and role in PEOPLE_COLORS:
        material = figure_material(role, piece["tint"])
        if material is not None:
            component.set_material(0, material)
    return actor


def in_parent(v, placement):
    """A point of a child map in its parent's space (spec V2 §12): turned by the placement, then moved to it."""
    if not placement:
        return v
    t = math.radians(placement["turn"])
    p = placement["position"]
    return [p[0] + v[0] * math.cos(t) + v[2] * math.sin(t), p[1] + v[1], p[2] - v[0] * math.sin(t) + v[2] * math.cos(t)]


def build():
    path = level_file()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    report = []
    world = unreal.EditorLevelLibrary.get_editor_world()
    key = data["key"]
    map_tag = "vcgs_map:" + key
    # A continuous or streamed child map is built inside its parent, at its placement.
    placement = data.get("map", {}).get("placement")
    turn0 = placement["turn"] if placement else 0.0
    guids = {i["guid"] for i in data["items"]}
    existing = {a.get_editor_property("guid"): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.VcgsLevelItem) if a.get_editor_property("guid") in guids or a.actor_has_tag(map_tag)}
    seen = set()
    for item_data in data["items"]:
        guid = item_data["guid"]
        name = item_data["export_name"]
        seen.add(guid)
        item = existing.get(guid)
        location = to_unreal(in_parent(item_data["position"], placement))
        yaw = yaw_of(item_data["turn"] + turn0)
        if item is None:
            item = spawn(unreal.VcgsLevelItem, location, unreal.Rotator(0.0, 0.0, yaw), name)
            item.set_editor_property("guid", guid)
            report.append("Added " + name + ".")
        elif item.get_editor_property("revision") == item_data["revision"] and not VCGS_WINS:
            continue
        else:
            moved = item.get_editor_property("exported") and (
                (item.get_actor_location() - item.get_editor_property("exported_location")).length() > 0.1
                or abs(((item.get_actor_rotation().yaw - item.get_editor_property("exported_yaw")) + 180) % 360 - 180) > 0.01
            )
            if moved and not VCGS_WINS:
                report.append(name + " was moved in the editor: kept where it is. Run with VCGS_WINS = True to put it back.")
            else:
                item.set_actor_location(location, False, False)
                item.set_actor_rotation(unreal.Rotator(0.0, 0.0, yaw), False)
        if item.get_actor_label() != name:
            report.append("Renamed " + item.get_actor_label() + " to " + name + ".")
            item.set_actor_label(name)
        item.set_editor_property("export_name", name)
        item.set_editor_property("role", item_data["role"])
        item.set_editor_property("revision", item_data["revision"])
        item.set_editor_property("replacement_locked", item_data["replacement_locked"])
        item.set_editor_property("exported_location", location)
        item.set_editor_property("exported_yaw", yaw)
        item.set_editor_property("exported", True)
        item.tags = ["vcgs:" + guid, map_tag]

        # A volume's box notices the player; a freeform one's zone does, and its box stays out of it.
        box = item.get_editor_property("box")
        zones = [slab_of(p, False) for p in item_data["pieces"] if p["part"] == "volume" and p["shape"] == "slab"]
        item.set_editor_property("zones", zones)
        if zones:
            box.set_box_extent(unreal.Vector(1.0, 1.0, 1.0), False)
            box.set_collision_profile_name("NoCollision")
            box.set_generate_overlap_events(False)
        elif item_data["kind"] == "volume":
            w, h, d = item_data["size"]
            box.set_box_extent(unreal.Vector(d * 50.0, w * 50.0, h * 50.0), False)
            box.set_relative_location(unreal.Vector(0.0, 0.0, h * 50.0), False, False)
            box.set_collision_profile_name("Trigger")
            box.set_generate_overlap_events(True)

        # Pieces: VC Game Studio's, rebuilt each time. The proxy is hidden once there is art.
        clear_pieces(item)
        with_mesh = not item_data["final_asset"] and not item_data["replacement_locked"]
        index = 0
        slabs = []
        # Characters show as stand-in figures instead of their marker (as in the studio's Play Mode);
        # other markers are the designer's scaffolding, hidden in play.
        person = item_data["role"] in PEOPLE
        pieces = [p for p in item_data["pieces"] if not (person and p["part"] == "marker")] + (FIGURE if person and with_mesh else [])
        for piece in pieces:
            if piece["shape"] == "cone":
                continue
            if piece["part"] == "volume":
                # A volume that collides is a state gate blocking the way: an unseen solid as well as its trigger.
                if piece["collide"]:
                    if piece["shape"] == "slab":
                        slabs.append(slab_of(piece, False))
                    else:
                        place_piece(item, piece, index, False, report)
                        index += 1
                continue
            if not with_mesh and not piece["collide"]:
                continue
            if piece["shape"] == "slab":
                slabs.append(slab_of(piece, with_mesh))
                continue
            actor = place_piece(item, piece, index, with_mesh, report, item_data["role"])
            if piece["part"] == "marker" and not person:
                actor.tags = actor.tags + ["vcgs_scaffold"]
            index += 1
            if piece.get("light"):
                light = piece["light"]
                cls = unreal.SpotLight if light["kind"] == "spot" else unreal.PointLight
                lamp = spawn(cls, item.get_actor_location(), unreal.Rotator(0.0, 0.0, 0.0), name + "_Light")
                lamp.attach_to_actor(item, "", unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, unreal.AttachmentRule.KEEP_RELATIVE, False)
                lamp.set_actor_relative_location(to_unreal(piece["at"]), False, False)
                lamp.tags = ["vcgs_piece", "vcgs_light"]
                component = lamp.get_editor_property("light_component")
                component.set_light_color(color_of(light["color"]), True)
                component.set_intensity(light["intensity"] * 5000.0)
                component.set_attenuation_radius(light["range"] * 100.0)
        item.set_editor_property("slabs", slabs)
        item.rerun_construction_scripts()
        if item_data["final_asset"] and not any(c.actor_has_tag("vcgs_art") for c in item.get_attached_actors()):
            asset = unreal.EditorAssetLibrary.load_asset(item_data["final_asset"])
            if asset is None:
                report.append(name + ": its final asset " + item_data["final_asset"] + " isn't in this project.")
            else:
                art = unreal.EditorLevelLibrary.spawn_actor_from_object(asset, item.get_actor_location(), item.get_actor_rotation())
                art.attach_to_actor(item, "", unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, False)
                art.tags = ["vcgs_art"]
        if item_data["role"] == "playerStart" and not any(c.actor_has_tag("vcgs_start") for c in item.get_attached_actors()):
            start = spawn(unreal.PlayerStart, location + unreal.Vector(0.0, 0.0, 90.0), unreal.Rotator(0.0, 0.0, yaw), name + "_PlayerStart")
            start.attach_to_actor(item, "", unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, False)
            start.tags = ["vcgs_start"]

    for guid, item in existing.items():
        if guid not in seen:
            report.append(item.get_actor_label() + " is no longer in the level: left in place for you to delete.")

    # Travel links (spec V2 §13): a spline actor each, rebuilt every time.
    for old in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.VcgsTravelLink):
        if old.actor_has_tag(map_tag):
            old.destroy_actor()
    for link in data.get("travel", []):
        actor = spawn(unreal.VcgsTravelLink, to_unreal(in_parent(link["points"][0], placement)), unreal.Rotator(0.0, 0.0, 0.0), data["export_name"] + "_" + link["key"])
        actor.set_editor_property("key", link["key"])
        actor.set_editor_property("kind", link["kind"])
        actor.set_editor_property("to_map", link["to_map"] or "")
        actor.set_editor_property("points", [to_unreal(in_parent(p, placement)) for p in link["points"]])
        actor.tags = ["vcgs_travel:" + link["key"], map_tag]
        actor.rerun_construction_scripts()

    # This map's director: found by its map key (an older one without a key is taken over).
    directors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.VcgsLevelDirector)
    mine = [d for d in directors if d.get_editor_property("map_key") == key] or [d for d in directors if not d.get_editor_property("map_key")]
    director = mine[0] if mine else spawn(unreal.VcgsLevelDirector, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0), data["export_name"] + "_Director")
    director.set_editor_property("level_file", "${root.replace(/^Content\/?/, '')}/Levels/" + os.path.basename(path))
    director.set_editor_property("map_key", key)
    director.set_editor_property("boundary", data.get("map", {}).get("boundary", "continuous"))
    director.set_editor_property("map_origin", to_unreal(placement["position"]) if placement else unreal.Vector(0.0, 0.0, 0.0))
    director.set_editor_property("map_yaw", yaw_of(turn0))
    if placement:
        report.append(data["export_name"] + " is built inside " + str(data["map"]["parent"]) + (", streamed in as the player nears it." if data["map"]["boundary"] == "streamed" else "."))
    report.append(data["export_name"] + ": " + str(len(seen)) + " items up to date.")
    for line in report:
        unreal.log(line)
    return report


if __name__ == "__main__":
    build()
`;

/** The level's data for Unreal, with names for the story keys it mentions. */
export const levelJsonUnreal = (level: IrLevel, names: Record<string, string>): string => JSON.stringify({ generator: 'VC Game Studio', format: 'vcgs-level-1', ...level, names }, null, 2);
