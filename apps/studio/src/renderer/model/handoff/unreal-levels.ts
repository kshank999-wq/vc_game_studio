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
#include <functional>
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

        std::function<void(const std::string&)> OnCinematic, OnScene, OnLevel, OnObjective, OnMessage, OnCheckpoint, OnStoryObjectUsed;
        std::function<void(const std::string&, const std::string&, int)> OnSpawn;
        std::function<void(const std::string&, const std::string&)> OnAudio;
        std::function<void()> OnDied, OnRefresh;

        LevelLogic(Value data, GameState& game) : Data(std::move(data)), Game(game)
        {
            Key = Data["key"].Str();
            Name = Data["name"].Str();
            ExportName = Data["export_name"].Str();
            const Value& list = Data["items"];
            for (size_t i = 0; i < list.Size(); i++)
            {
                std::string guid = list[i]["guid"].Str();
                Order.push_back(guid);
                Items[guid] = &list[i];
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
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FVcgsLevelSpawnEvent, AVcgsLevelItem*, Spawner, const FString&, ActorKey, int32, Count);

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

    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnCinematicRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnSceneRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnLevelRequested;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnObjectiveChanged;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelKeyEvent OnMessage;
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsLevelSpawnEvent OnSpawnRequested;

    /** Use an item (by GUID); returns what to tell the player. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Interact(const FString& Guid);
    /** What Interact would say for an item now ("" for nothing to do). */
    UFUNCTION(BlueprintPure, Category = "VCGS") FString OfferText(const FString& Guid) const;
    /** The nearest item the player can use from here, facing this way, or "". */
    UFUNCTION(BlueprintPure, Category = "VCGS") FString NearestOffer(const FVector& From, const FVector& Facing) const;
    UFUNCTION(BlueprintPure, Category = "VCGS") bool IsPresent(const FString& Guid) const;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

private:
    std::unique_ptr<vcgs::LevelLogic> Logic;
    TMap<FString, AVcgsLevelItem*> ItemsByGuid;

    void Refresh();
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
    for (TActorIterator<AVcgsLevelItem> It(GetWorld()); It; ++It)
    {
        AVcgsLevelItem* Item = *It;
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
    if (Logic) Logic->Tick(DeltaSeconds);
}

/** Show what is there, hide what is not, open and shut doors. Pieces are the actors attached to an item. */
void AVcgsLevelDirector::Refresh()
{
    if (!Logic) return;
    for (auto& Pair : ItemsByGuid)
    {
        const std::string Guid = ToStd(Pair.Key);
        const bool Here = Logic->IsPresent(Guid);
        const bool Door = Logic->Role(Guid) == "door";
        const bool Shut = Here && !Logic->IsOpen(Guid);
        AVcgsLevelItem* Item = Pair.Value;
        Item->SetActorHiddenInGame(!Here);
        Item->SetActorEnableCollision(Here);
        TArray<AActor*> Pieces;
        Item->GetAttachedActors(Pieces);
        for (AActor* Piece : Pieces)
        {
            const bool Show = Door ? Shut : Here;
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


def place_piece(item, piece, index, with_mesh, report):
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
    return actor


def build():
    path = level_file()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    report = []
    world = unreal.EditorLevelLibrary.get_editor_world()
    existing = {a.get_editor_property("guid"): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.VcgsLevelItem)}
    seen = set()
    for item_data in data["items"]:
        guid = item_data["guid"]
        name = item_data["export_name"]
        seen.add(guid)
        item = existing.get(guid)
        location = to_unreal(item_data["position"])
        yaw = yaw_of(item_data["turn"])
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
        item.tags = ["vcgs:" + guid]

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
        for piece in item_data["pieces"]:
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
            place_piece(item, piece, index, with_mesh, report)
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

    directors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.VcgsLevelDirector)
    director = directors[0] if directors else spawn(unreal.VcgsLevelDirector, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0), data["export_name"] + "_Director")
    director.set_editor_property("level_file", "${root.replace(/^Content\/?/, '')}/Levels/" + os.path.basename(path))
    report.append(data["export_name"] + ": " + str(len(seen)) + " items up to date.")
    for line in report:
        unreal.log(line)
    return report


if __name__ == "__main__":
    build()
`;

/** The level's data for Unreal, with names for the story keys it mentions. */
export const levelJsonUnreal = (level: IrLevel, names: Record<string, string>): string => JSON.stringify({ generator: 'VC Game Studio', format: 'vcgs-level-1', ...level, names }, null, 2);
