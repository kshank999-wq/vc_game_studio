/**
 * The Character Creator's runtime for Unreal (character spec §10): VcgsCast.h,
 * the engine-neutral core in portable C++17 on the plugin's vcgs::Value (the
 * AI state machine exactly as the studio's aiStep plays it, senses, inventory
 * capacity, ability cooldowns and costs), and the starter classes:
 * AVcgsCharacterActor (ActorController) with its components
 * (UVcgsActorPerception, UVcgsActorBehavior — BehaviorController —,
 * UVcgsActorAbilities, UVcgsActorInventory, UVcgsActorEquipment,
 * UVcgsActorDialogue) and AVcgsSpawnGroup (SpawnGroupController). The core
 * works on the plan (metres, x east, y south); the actor turns that into
 * Unreal's centimetres (X north, Y east, Z up). Movement goes round walls on
 * the level's navigation graph (VcgsNav.h, spec §19 navmesh), straight with
 * none; the AI controller, animation and effects are the engine team's (see
 * CHARACTERS.md), the hooks are here.
 */

const HEAD = '// VCGS Runtime for Unreal. The same for every project; safe to commit.';

const CORE = String.raw`${HEAD}
// The Character Creator's cast in plain C++17: characters.json (schema
// vcgs-characters v1), and the AI state machine, senses, inventory and
// abilities as VC Game Studio plays them. Standard library only, no
// exceptions or RTTI; tests run it anywhere.
#pragma once

#include "VcgsCore.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace vcgs
{
namespace Cast
{
    inline std::string Label(const std::string& State)
    {
        static const std::map<std::string, std::string> Labels = {
            {"idle", "Idle"}, {"patrol", "Patrol"}, {"alert", "Alert"}, {"investigate", "Investigate"}, {"chase", "Chase"}, {"attack", "Attack"},
            {"search", "Search"}, {"return", "Return"}, {"stunned", "Stunned"}, {"flee", "Flee"}, {"dead", "Dead"}, {"disabled", "Disabled"}, {"any", "Any state"},
        };
        auto It = Labels.find(State);
        return It != Labels.end() ? It->second : State;
    }

    /** A number as the studio writes it: 4, 0.6 (the shortest text that reads back the same). */
    inline std::string NumText(double N)
    {
        if (N == std::floor(N) && std::fabs(N) < 1e15) return std::to_string(static_cast<long long>(N));
        char Buffer[32];
        for (int Precision = 1; Precision <= 17; Precision++)
        {
            std::snprintf(Buffer, sizeof Buffer, "%.*g", Precision, N);
            if (std::strtod(Buffer, nullptr) == N) break;
        }
        return Buffer;
    }

    inline std::string F1(double N)
    {
        char Buffer[32];
        std::snprintf(Buffer, sizeof Buffer, "%.1f", N);
        return Buffer;
    }

    inline int Round(double N) { return static_cast<int>(std::floor(N + 0.5)); }

    inline bool Contains(const Value& List, const std::string& Text)
    {
        for (const auto& Item : List.items)
            if (Item.Str() == Text) return true;
        return false;
    }

    inline void Set(Value& Object, const std::string& Key, const Value& To)
    {
        for (auto& Field : Object.fields)
            if (Field.first == Key) { Field.second = To; return; }
        Object.fields.emplace_back(Key, To);
    }

    /** characters.json's text, read; null when it is not a VC Game Studio characters file. */
    inline Value Load(const std::string& Json, std::string* Error = nullptr)
    {
        Value Root = JsonReader::Parse(Json, Error);
        if (Root["schema"].Str() != "vcgs-characters")
        {
            if (Error && Error->empty()) *Error = "not a VC Game Studio characters file";
            return Value();
        }
        return Root;
    }

    /** A character, or one of its variants as a whole (stats, abilities, inventory, hit, ai); null when there is none. */
    inline Value Character(const Value& Cast, const std::string& Key, const std::string& Variant = "")
    {
        for (const auto& C : Cast["characters"].items)
        {
            if (C["key"].Str() != Key) continue;
            if (Variant.empty()) return C;
            for (const auto& V : C["variants"].items)
            {
                if (V["key"].Str() != Variant) continue;
                Value Whole = C;
                for (const char* Field : {"stats", "abilities", "inventory", "hit", "ai", "name"}) Set(Whole, Field, V[Field]);
                return Whole;
            }
            return C;
        }
        return Value();
    }

    /** Where the studio placed people: every placement, or a level's (by GUID). */
    inline std::vector<const Value*> Placements(const Value& Cast, const std::string& LevelGuid = "")
    {
        std::vector<const Value*> Out;
        for (const auto& P : Cast["placements"].items)
            if (LevelGuid.empty() || P["level"].Str() == LevelGuid) Out.push_back(&P);
        return Out;
    }

    struct Point
    {
        double X = 0, Y = 0;
        /** Seconds to stand there, as a patrol stop. */
        double Wait = 0;
    };

    struct Wall
    {
        Point A, B;
    };

    /** The target as the machine sees it. */
    struct Target
    {
        double X = 0, Y = 0;
        bool bNoisy = false;
        bool bAlive = true;
    };

    /** What the machine remembers between steps. */
    struct Memory
    {
        std::string State = "idle";
        double X = 0, Y = 0, Facing = 0, Timer = 0, SinceSeen = std::numeric_limits<double>::infinity(), Health = 0, MaxHealth = 0, Cooldown = 0;
        bool bHasLastKnown = false;
        double LastX = 0, LastY = 0;
        int PatrolIndex = 0, Attacks = 0;
        /** Seconds left standing at the patrol stop it reached. */
        double Pause = 0;
        bool bHit = false;
    };

    struct Senses
    {
        bool bSees = false, bHears = false, bNear = false;
        double Distance = 0;
        std::string Why;
    };

    struct Step
    {
        Memory Mem;
        std::string Reason;
        Senses Sensed;
        bool bAttacked = false;
    };

    /** Whether something blocks sight from (AX, AY) to (BX, BY): the level's solids. */
    using Blocked = std::function<bool(double, double, double, double)>;

    /**
     * The way round walls from (AX, AY) to (TX, TY): the next plan point to head for in
     * (VX, VY), and whether it is the last leg; false when there is no way there (the
     * level's navigation graph).
     */
    using Steer = std::function<bool(double AX, double AY, double TX, double TY, double& VX, double& VY, bool& bLast)>;

    inline Memory StartMemory(const Value& Ai, const std::vector<Point>& Patrol, double Health, double Facing = 0)
    {
        const Value& States = Ai["states"];
        const std::string Start = Ai["start"].Str();
        Memory M;
        M.State = Contains(States, Start) ? Start : States.Size() > 0 ? States[0].Str() : "idle";
        const Point Post = Patrol.empty() ? Point() : Patrol[0];
        M.X = Post.X;
        M.Y = Post.Y;
        M.Facing = Facing;
        M.Health = M.MaxHealth = Health;
        return M;
    }

    inline double Dist(double AX, double AY, double BX, double BY) { return std::sqrt((AX - BX) * (AX - BX) + (AY - BY) * (AY - BY)); }

    inline double Wrap(double R) { return std::atan2(std::sin(R), std::cos(R)); }

    inline bool Crosses(double PX, double PY, double QX, double QY, const Point& A, const Point& B)
    {
        const double D1 = (B.X - A.X) * (PY - A.Y) - (B.Y - A.Y) * (PX - A.X);
        const double D2 = (B.X - A.X) * (QY - A.Y) - (B.Y - A.Y) * (QX - A.X);
        const double D3 = (QX - PX) * (A.Y - PY) - (QY - PY) * (A.X - PX);
        const double D4 = (QX - PX) * (B.Y - PY) - (QY - PY) * (B.X - PX);
        return D1 * D2 < 0 && D3 * D4 < 0;
    }

    /** What it senses of the target, and why. */
    inline Senses Sense(const Value& Ai, const Memory& M, const Target& T, const std::vector<Wall>& Walls, const Blocked& IsBlocked)
    {
        Senses S;
        S.Distance = Dist(M.X, M.Y, T.X, T.Y);
        if (!T.bAlive) { S.Why = "No target."; return S; }
        const double Pi = 3.14159265358979323846;
        const double Off = std::fabs(Wrap(std::atan2(T.Y - M.Y, T.X - M.X) - M.Facing)) * (180 / Pi);
        const double Cone = Ai["vision_angle"].Num();
        const bool bInCone = Cone >= 360 || Off <= Cone / 2;
        bool bBlocked = false;
        if (Ai["line_of_sight"].Bool())
        {
            for (const auto& W : Walls)
                if (Crosses(M.X, M.Y, T.X, T.Y, W.A, W.B)) bBlocked = true;
            if (!bBlocked && IsBlocked) bBlocked = IsBlocked(M.X, M.Y, T.X, T.Y);
        }
        const double View = Ai["view_distance"].Num();
        S.bSees = S.Distance <= View && bInCone && !bBlocked;
        S.bHears = T.bNoisy && S.Distance <= Ai["hearing_radius"].Num();
        S.bNear = S.Distance <= Ai["proximity_radius"].Num();
        S.Why = S.bSees ? "Sees it " + F1(S.Distance) + " m away, " + std::to_string(Round(Off)) + "° off its facing (cone " + NumText(Cone) + "°)."
            : S.Distance > View ? "Out of sight range (" + F1(S.Distance) + " m > " + NumText(View) + " m)."
            : !bInCone ? "Outside its " + NumText(Cone) + "° view (" + std::to_string(Round(Off)) + "° off its facing)."
            : std::string("A wall blocks its line of sight.");
        if (S.bHears) S.Why += " Hears it.";
        if (S.bNear) S.Why += " Close enough to sense.";
        return S;
    }

    /** Toward a plan point; with a way (the level's round walls) by that way, standing when there is none. True when there. */
    inline bool Walk(Memory& M, double TX, double TY, double Pace, double Dt, const Steer& Way = nullptr)
    {
        double D = Dist(M.X, M.Y, TX, TY);
        if (D < 0.01) return true;
        double VX = TX, VY = TY;
        bool bLast = true;
        if (Way)
        {
            if (!Way(M.X, M.Y, TX, TY, VX, VY, bLast)) return false;
            D = Dist(M.X, M.Y, VX, VY);
            if (D < 1e-6) return false;
        }
        const double Turn = std::atan2(VY - M.Y, VX - M.X);
        M.Facing = Turn;
        const double Stride = std::fmin(D, Pace * Dt);
        M.X += std::cos(Turn) * Stride;
        M.Y += std::sin(Turn) * Stride;
        // There only on the last leg of the way.
        return bLast && Stride >= D;
    }

    inline std::string TimerKey(const std::string& State)
    {
        if (State == "investigate") return "investigate_seconds";
        if (State == "search") return "search_seconds";
        if (State == "stunned") return "stun_seconds";
        if (State == "alert") return "reaction";
        return "";
    }

    inline std::string Holds(const Value& Ai, const Value& Tr, const Memory& M, const Memory& M0, const Senses& S, bool bNoticed, double FromPost, const std::string& Timer, bool bTimerDone)
    {
        const std::string When = Tr["when"].Str();
        if (When == "always") return "At once.";
        if (When == "seesTarget") return S.bSees ? S.Why : "";
        if (When == "hearsTarget") return S.bHears ? "Hears it " + F1(S.Distance) + " m away (hearing " + NumText(Ai["hearing_radius"].Num()) + " m)." : "";
        if (When == "inProximity") return S.bNear ? "It is " + F1(S.Distance) + " m away, inside its " + NumText(Ai["proximity_radius"].Num()) + " m proximity radius." : "";
        if (When == "inAttackRange") return bNoticed && S.Distance <= Ai["attack_range"].Num() ? "In attack range (" + F1(S.Distance) + " m ≤ " + NumText(Ai["attack_range"].Num()) + " m)." : "";
        if (When == "outOfAttackRange") return S.Distance > Ai["attack_range"].Num() * 1.25 ? "Out of attack range (" + F1(S.Distance) + " m)." : "";
        if (When == "lostTarget") return !bNoticed ? "Lost it: " + S.Why : "";
        if (When == "chaseTimeout") return M.SinceSeen >= Ai["chase_timeout"].Num() ? "Hasn’t seen it for " + NumText(Ai["chase_timeout"].Num()) + " s (chase timeout)." : "";
        if (When == "tooFarFromPost") return FromPost > Ai["disengage_distance"].Num() ? F1(FromPost) + " m from its post, past its " + NumText(Ai["disengage_distance"].Num()) + " m disengage distance." : "";
        if (When == "timerDone")
        {
            if (!bTimerDone) return "";
            const std::string Name = Timer == "reaction" ? "reaction" : Timer.substr(0, Timer.size() - std::string("_seconds").size());
            return "Its " + Name + " time (" + NumText(Ai[Timer].Num()) + " s) is up.";
        }
        if (When == "reachedPost") return FromPost < 0.5 ? "Back at its post." : "";
        if (When == "healthBelow")
        {
            const double Share = M.Health / std::fmax(0.0001, M.MaxHealth);
            const double Below = Tr["value"].Num();
            return Share < Below / 100 && M.Health > 0 ? "Health " + std::to_string(Round(Share * 100)) + "%, below " + NumText(Below) + "%." : "";
        }
        if (When == "hit") return M0.bHit ? "It was hit." : "";
        if (When == "killed") return M.Health <= 0 ? "Out of health." : "";
        return "";
    }

    /**
     * One step of the machine: sense, take the first enabled transition from
     * this state (or any) whose trigger holds, then move. Alert holds for its
     * reaction time first. The same rules as the studio's aiStep. With a way
     * (the level's round walls), it walks by that.
     */
    inline Step AiStep(const Value& Ai, double Speed, const Memory& M0, const Target& T, const std::vector<Point>& Patrol, const std::vector<Wall>& Walls, double Dt, const Blocked& IsBlocked = nullptr, const Steer& Way = nullptr)
    {
        Memory M = M0;
        M.Timer = M0.Timer + Dt;
        M.Cooldown = std::fmax(0, M0.Cooldown - Dt);
        M.bHit = false;
        const Senses S = Sense(Ai, M, T, Walls, IsBlocked);
        const bool bNoticed = S.bSees || S.bNear;
        M.SinceSeen = bNoticed ? 0 : M0.SinceSeen + Dt;
        if (bNoticed || S.bHears) { M.bHasLastKnown = true; M.LastX = T.X; M.LastY = T.Y; }
        const Point Post = Patrol.empty() ? Point() : Patrol[0];
        const double FromPost = Dist(M.X, M.Y, Post.X, Post.Y);
        const std::string Timer = TimerKey(M.State);
        const bool bTimerDone = !Timer.empty() && M.Timer >= Ai[Timer].Num();
        std::string Reason;
        const Value& On = Ai["states"];
        const bool bHeld = M.State == "alert" && !bTimerDone;
        if (M.State != "dead" && M.State != "disabled")
        {
            for (const auto& Tr : Ai["transitions"].items)
            {
                const std::string To = Tr["to"].Str(), From = Tr["from"].Str();
                if (!Tr["enabled"].Bool() || !Contains(On, To) || To == M.State) continue;
                if (From != M.State && From != "any") continue;
                if (bHeld && From != "any") continue;
                const std::string Why = Holds(Ai, Tr, M, M0, S, bNoticed, FromPost, Timer, bTimerDone);
                if (Why.empty()) continue;
                Reason = Label(M.State) + " → " + Label(To) + ": " + Why;
                M.State = To;
                M.Timer = 0;
                M.Pause = 0;
                break;
            }
        }
        const double ChaseSpeed = Speed * (0.7 + 0.6 * (Ai["skill"]["pursuit"].Num(50) / 100));
        bool bAttacked = false;
        if (M.State == "patrol")
        {
            // Standing at the stop it reached, for as long as the stop says.
            if (M.Pause > 0) M.Pause = std::fmax(0, M.Pause - Dt);
            else
            {
                const std::vector<Point> Stops = Patrol.empty() ? std::vector<Point>{Post} : Patrol;
                const Point Goal = Stops[static_cast<size_t>(M.PatrolIndex) % Stops.size()];
                if (Walk(M, Goal.X, Goal.Y, Speed * 0.45, Dt, Way))
                {
                    M.PatrolIndex = (M.PatrolIndex + 1) % static_cast<int>(Stops.size());
                    if (Goal.Wait > 0) M.Pause = Goal.Wait;
                }
            }
        }
        else if (M.State == "alert")
        {
            if (M.bHasLastKnown) M.Facing = std::atan2(M.LastY - M.Y, M.LastX - M.X);
        }
        else if (M.State == "investigate")
        {
            if (M.bHasLastKnown) Walk(M, M.LastX, M.LastY, Speed * 0.6, Dt, Way);
        }
        else if (M.State == "chase")
        {
            if (bNoticed || !M.bHasLastKnown) Walk(M, T.X, T.Y, ChaseSpeed, Dt, Way);
            else Walk(M, M.LastX, M.LastY, ChaseSpeed, Dt, Way);
        }
        else if (M.State == "attack")
        {
            M.Facing = std::atan2(T.Y - M.Y, T.X - M.X);
            if (M.Cooldown <= 0 && S.Distance <= Ai["attack_range"].Num())
            {
                M.Cooldown = Ai["attack_cooldown"].Num();
                M.Attacks++;
                bAttacked = true;
            }
        }
        else if (M.State == "search")
        {
            const double CX = M.bHasLastKnown ? M.LastX : M.X, CY = M.bHasLastKnown ? M.LastY : M.Y;
            const double A = M.Timer * 1.2;
            Walk(M, CX + std::cos(A) * 2, CY + std::sin(A) * 2, Speed * 0.5, Dt, Way);
        }
        else if (M.State == "return")
        {
            if (Ai["reset_to_post"].Bool()) Walk(M, Post.X, Post.Y, Speed * 0.6, Dt, Way);
            else M.State = "idle";
        }
        else if (M.State == "flee")
        {
            const double Away = std::atan2(M.Y - T.Y, M.X - T.X);
            Walk(M, M.X + std::cos(Away) * 5, M.Y + std::sin(Away) * 5, Speed, Dt, Way);
        }
        Step Out;
        Out.Mem = M;
        Out.Reason = Reason;
        Out.Sensed = S;
        Out.bAttacked = bAttacked;
        return Out;
    }

    // ------------------------------------------------------------ inventory

    /** Whether Qty more of an item fit: "" when they do, else why not. */
    inline std::string Fits(const Value& Inv, const std::map<std::string, int>& Items, const std::string& Item, int Qty, const std::map<std::string, double>& Weights = {}, const std::set<std::string>& Single = {})
    {
        const std::string Mode = Inv["mode"].Str();
        if (Mode == "unlimited") return "";
        std::map<std::string, int> After = Items;
        After[Item] += Qty;
        int Slots = 0;
        double Weight = 0;
        for (const auto& Entry : After)
        {
            if (Mode == "slots" || Single.count(Entry.first)) Slots += Entry.second;
            else Slots += static_cast<int>(std::ceil(Entry.second / std::fmax(1, Inv["stack"].Num())));
            auto W = Weights.find(Entry.first);
            Weight += (W != Weights.end() ? W->second : 0) * Entry.second;
        }
        if ((Mode == "slots" || Mode == "stack" || Mode == "hybrid") && Slots > Inv["slots"].Num()) return "No room: " + std::to_string(Slots) + " of " + NumText(Inv["slots"].Num()) + " slots.";
        if ((Mode == "weight" || Mode == "hybrid") && Weight > Inv["weight"].Num()) return "Too heavy: " + NumText(Weight) + " of " + NumText(Inv["weight"].Num()) + " kg.";
        return "";
    }

    // ------------------------------------------------------------ abilities

    /** Whether an ability can be used now: "" when it can, else why not (its failure behaviour). */
    inline std::string CanUse(const Value& Ability, const std::map<std::string, double>& Cooldowns, const std::map<std::string, double>& Resource, double Now)
    {
        const std::string Name = Ability["name"].Str();
        if (Ability["enabled"].type == Value::Type::Bool && !Ability["enabled"].Bool()) return Name + " is off.";
        if (Ability["kind"].Str() == "passive") return Name + " is passive.";
        auto Until = Cooldowns.find(Ability["key"].Str());
        if (Until != Cooldowns.end() && Now < Until->second) return Name + " is cooling down.";
        const std::string Kind = Ability["cost"]["resource"].Str();
        auto Have = Resource.find(Kind);
        if (Kind != "none" && !Kind.empty() && (Have != Resource.end() ? Have->second : 0) < Ability["cost"]["amount"].Num())
            return !Ability["failure"].Str().empty() ? Ability["failure"].Str() : "Not enough " + Kind + ".";
        return "";
    }
}
}
`;

const COMPONENTS_H = String.raw`${HEAD}
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "VcgsCast.h"
#include <map>
#include <set>
#include <string>
#include "VcgsActorComponents.generated.h"

class AVcgsCharacterActor;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FVcgsStateEvent, const FString&, From, const FString&, To);

/** PerceptionComponent: sight blocked by the world (a visibility trace between plan points). */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorPerception : public UActorComponent
{
    GENERATED_BODY()

public:
    void Setup(AVcgsCharacterActor* Owner) { Actor = Owner; }
    bool Blocked(double AX, double AY, double BX, double BY) const;

private:
    AVcgsCharacterActor* Actor = nullptr;
};

/**
 * BehaviorController: the character's AI profile run on the core's machine
 * against the player pawn, or its activity (wander, patrol, guard...) when it
 * has none. Hook OnStateChanged to the AI controller, animation and barks.
 */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorBehavior : public UActorComponent
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsStateEvent OnStateChanged;
    UFUNCTION(BlueprintPure, Category = "VCGS") FString State() const;

    void Setup(AVcgsCharacterActor* Owner);
    /** One step: where the player is on the plan (metres), whether they make noise. */
    void Tick(float DeltaSeconds, bool bHasTarget, double TargetX, double TargetY, bool bNoisy);
    void Hit(float Health);
    /** A captor's blow: the story captures the player (vcgs::Rules::CatchPlayer). False when this character is no captor, there is no story, the story has no capture, or the player is held already. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") bool Catch();

    vcgs::Cast::Memory Memory;
    std::string LastReason;

private:
    AVcgsCharacterActor* Actor = nullptr;
    vcgs::Value Ai;
    std::vector<vcgs::Cast::Point> Patrol;
    double Clock = 0;
    /** How far round its circle a wanderer has skipped, past spots it could not get to. */
    double WanderTurn = 0;
};

/** AbilityComponent: cooldowns, the resource, and what an ability does (as events). */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorAbilities : public UActorComponent
{
    GENERATED_BODY()

public:
    void Setup(AVcgsCharacterActor* Owner);
    /** Use an ability by key on a target (or none); returns why not, or "" when it goes off. Damage, heal, stun and set-flag run; other effects, the cue, VFX and SFX are sent as events. */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Use(const FString& Key, AVcgsCharacterActor* Target = nullptr);
    void Advance(double DeltaSeconds) { Clock += DeltaSeconds; }

    std::map<std::string, double> Cooldowns;
    std::map<std::string, double> Resource;
    double Clock = 0;

private:
    AVcgsCharacterActor* Actor = nullptr;
};

/** InventoryComponent: what it carries, within its capacity. */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorInventory : public UActorComponent
{
    GENERATED_BODY()

public:
    void Setup(AVcgsCharacterActor* Owner);
    /** Add some of an item; returns why not, or "". */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Add(const FString& Item, int32 Qty = 1);
    UFUNCTION(BlueprintCallable, Category = "VCGS") bool Remove(const FString& Item, int32 Qty = 1);
    UFUNCTION(BlueprintPure, Category = "VCGS") int32 Count(const FString& Item) const;

    std::map<std::string, int> Items;
    std::map<std::string, double> Weights;
    std::set<std::string> Single;

private:
    vcgs::Value Rules;
};

/** EquipmentComponent: the item in each slot. */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorEquipment : public UActorComponent
{
    GENERATED_BODY()

public:
    void Setup(AVcgsCharacterActor* Owner);
    /** Put a carried item in a slot ("" to empty it); returns why not, or "". */
    UFUNCTION(BlueprintCallable, Category = "VCGS") FString Equip(const FString& Slot, const FString& Item);
    UFUNCTION(BlueprintPure, Category = "VCGS") FString InSlot(const FString& Slot) const;

    std::map<std::string, std::string> Slots;

private:
    AVcgsCharacterActor* Actor = nullptr;
};

/** DialogueComponent: an NPC's prompt and topics; each topic's lines are story line ids for UVcgsSubsystem. */
UCLASS(ClassGroup = (VCGS), meta = (BlueprintSpawnableComponent))
class VCGS_API UVcgsActorDialogue : public UActorComponent
{
    GENERATED_BODY()

public:
    void Setup(AVcgsCharacterActor* Owner);
    UFUNCTION(BlueprintPure, Category = "VCGS") bool IsInteractive() const { return bInteractive; }
    UFUNCTION(BlueprintPure, Category = "VCGS") FString Prompt() const;
    /** Topic keys, in order (filter them with the story's rules: each topic's "when"). */
    UFUNCTION(BlueprintPure, Category = "VCGS") TArray<FString> TopicKeys() const;
    /** A topic's line ids. */
    UFUNCTION(BlueprintPure, Category = "VCGS") TArray<FString> TopicLines(const FString& Topic) const;

private:
    vcgs::Value Npc;
    bool bInteractive = false;
};
`;

const ACTOR_H = String.raw`${HEAD}
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "VcgsCast.h"
#include "VcgsNav.h"
#include "VcgsCharacterActor.generated.h"

class USceneComponent;
class UCapsuleComponent;
class UVcgsActorPerception;
class UVcgsActorBehavior;
class UVcgsActorAbilities;
class UVcgsActorInventory;
class UVcgsActorEquipment;
class UVcgsActorDialogue;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FVcgsHappenedEvent, const FString&, What, const FString&, Detail);

/**
 * ActorController: a character from characters.json as a placeholder capsule
 * (in its height and radius, with a HandSocket for its prop) until its final
 * model is bound, with its components. Give it CharactersFile (under
 * Content/) and CharacterKey; BeginPlay sets it up, or AVcgsSpawnGroup does.
 */
UCLASS(ClassGroup = (VCGS))
class VCGS_API AVcgsCharacterActor : public AActor
{
    GENERATED_BODY()

public:
    AVcgsCharacterActor();

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString CharactersFile = TEXT("VCGS/Generated/characters.json");
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString CharacterKey;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString VariantKey;
    /** What it does when it has no AI: wander, idle, talk, work, patrol, guard. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString Activity = TEXT("guard");
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") float WanderRadius = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") float Health = 100;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") USceneComponent* Root = nullptr;
    /** The placeholder body; hide it when the final model is in. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UCapsuleComponent* Placeholder = nullptr;
    /** Where its prop or weapon goes (the binding's hand socket on the final skeleton). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") USceneComponent* HandSocket = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorPerception* Perception = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorBehavior* Behavior = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorAbilities* Abilities = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorInventory* Inventory = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorEquipment* Equipment = nullptr;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") UVcgsActorDialogue* Dialogue = nullptr;

    /** Things that happen, by name (cues, attacks, state changes): hook animation, VFX and SFX here. */
    UPROPERTY(BlueprintAssignable, Category = "VCGS") FVcgsHappenedEvent OnHappened;

    /** Set it up from characters.json (already read); false when the character is not there. */
    bool Setup(const vcgs::Value& Cast);
    UFUNCTION(BlueprintCallable, Category = "VCGS") void Hurt(float Amount);
    void Send(const FString& What, const FString& Detail = FString()) { OnHappened.Broadcast(What, Detail); }
    /** Where it is on the plan (metres, x east, y south). */
    void PlanPosition(double& X, double& Y) const;
    /** Straight to a plan point (the core has already stepped it there); give an AI controller the same point for pathfinding. */
    void MoveTo(double X, double Y);
    /**
     * The next plan point on the way round walls from (AX, AY) to (TX, TY), on its level's
     * navigation graph (spec §19 navmesh), in (VX, VY), and whether it is the last leg;
     * false when there is no way there. With no graph, straight there.
     */
    bool Steer(double AX, double AY, double TX, double TY, double& VX, double& VY, bool& bLast);

    vcgs::Value Data;
    std::vector<vcgs::Cast::Point> Route;

private:
    /** The level it stands in (one with a navigation graph), found once, and the way it is walking. */
    vcgs::NavPlace Place;
    bool bPlaceFound = false;
    vcgs::NavWay Way;

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
};
`;

const SPAWN_H = String.raw`${HEAD}
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "VcgsCast.h"
#include "VcgsSpawnGroup.generated.h"

class AVcgsCharacterActor;

/**
 * SpawnGroupController: a Character group area's people, spawned where the
 * studio spread them (characters.json placements), each an
 * AVcgsCharacterActor doing its activity. Set ItemGuid to the area's GUID, or
 * LevelGuid for every group and AI actor of a level. ShowGroup and HideGroup
 * are for the game's own clock (schedules).
 */
UCLASS(ClassGroup = (VCGS))
class VCGS_API AVcgsSpawnGroup : public AActor
{
    GENERATED_BODY()

public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString CharactersFile = TEXT("VCGS/Generated/characters.json");
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString ItemGuid;
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FString LevelGuid;
    /** Only placed actors (an enemy with AI), not Character group areas: what a map's own Cast spawn group brings on. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") bool bActorsOnly = false;
    /** Where its map sits in the world and how it is turned (degrees), as the map's level director: a child map's placements land in it. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") FVector MapOrigin = FVector(0, 0, 0);
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "VCGS") float MapYaw = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "VCGS") TArray<AVcgsCharacterActor*> Spawned;

    /** Spawn the placed people (once). */
    void Spawn(const vcgs::Value& Cast);
    /** Level space (metres, x east, y up, z south) to the world (cm, X north, Y east, Z up) through MapOrigin and MapYaw, as the director's ToWorld. */
    FVector ToWorld(double X, double Y, double Z) const;
    UFUNCTION(BlueprintCallable, Category = "VCGS") void ShowGroup();
    UFUNCTION(BlueprintCallable, Category = "VCGS") void HideGroup();

protected:
    virtual void BeginPlay() override;
};
`;

const LOAD = String.raw`static bool LoadCast(const FString& File, vcgs::Value& Out)
{
    FString Json;
    if (!FFileHelper::LoadFileToString(Json, *(FPaths::ProjectContentDir() / File))) return false;
    std::string Error;
    Out = vcgs::Cast::Load(VcgsConvert::ToStd(Json), &Error);
    return Out.IsObject();
}`;

const ACTOR_CPP = String.raw`${HEAD}
#include "VcgsCharacterActor.h"
#include "VcgsActorComponents.h"
#include "VcgsConvert.h"
#include "Components/CapsuleComponent.h"
#include "Components/SceneComponent.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

using VcgsConvert::ToF;
using VcgsConvert::ToStd;

${LOAD}

AVcgsCharacterActor::AVcgsCharacterActor()
{
    PrimaryActorTick.bCanEverTick = true;
    Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    RootComponent = Root;
    Placeholder = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Placeholder"));
    Placeholder->SetupAttachment(Root);
    Placeholder->SetHiddenInGame(false);
    HandSocket = CreateDefaultSubobject<USceneComponent>(TEXT("HandSocket"));
    HandSocket->SetupAttachment(Root);
    Perception = CreateDefaultSubobject<UVcgsActorPerception>(TEXT("Perception"));
    Behavior = CreateDefaultSubobject<UVcgsActorBehavior>(TEXT("Behavior"));
    Abilities = CreateDefaultSubobject<UVcgsActorAbilities>(TEXT("Abilities"));
    Inventory = CreateDefaultSubobject<UVcgsActorInventory>(TEXT("Inventory"));
    Equipment = CreateDefaultSubobject<UVcgsActorEquipment>(TEXT("Equipment"));
    Dialogue = CreateDefaultSubobject<UVcgsActorDialogue>(TEXT("Dialogue"));
}

void AVcgsCharacterActor::BeginPlay()
{
    Super::BeginPlay();
    if (Data.IsObject()) return;
    vcgs::Value Cast;
    if (!LoadCast(CharactersFile, Cast) || !Setup(Cast))
        UE_LOG(LogTemp, Error, TEXT("VCGS: no character %s in %s."), *CharacterKey, *CharactersFile);
}

bool AVcgsCharacterActor::Setup(const vcgs::Value& Cast)
{
    Data = vcgs::Cast::Character(Cast, ToStd(CharacterKey), ToStd(VariantKey));
    if (!Data.IsObject()) return false;
    const vcgs::Value& Stats = Data["stats"];
    const vcgs::Value& Look = Data["placeholder"];
    Health = static_cast<float>(Stats["health"].Num(100));
    // The placeholder: its height and radius in centimetres, standing on the ground; the hand socket beside it.
    const double Height = Stats["height"].Num(1.75) * Look["scale"].Num(1) * 100.0, Radius = Stats["radius"].Num(0.35) * 100.0;
    Placeholder->SetCapsuleSize(static_cast<float>(Radius), static_cast<float>(Height / 2));
    Placeholder->SetRelativeLocation(FVector(0, 0, Height / 2));
    HandSocket->SetRelativeLocation(FVector(0, Radius + 10, Height / 2));
    // With a final model bound, the placeholder steps aside: attach the mesh under Root and its prop to the binding's hand socket.
    if (!Data["binding"]["final_model"].Str().empty()) Placeholder->SetHiddenInGame(true);
    Perception->Setup(this);
    Behavior->Setup(this);
    Abilities->Setup(this);
    Inventory->Setup(this);
    Equipment->Setup(this);
    Dialogue->Setup(this);
    return true;
}

void AVcgsCharacterActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Data.IsObject()) return;
    Abilities->Advance(DeltaSeconds);
    double TX = 0, TY = 0;
    const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0);
    if (Pawn)
    {
        const FVector At = Pawn->GetActorLocation();
        TX = At.Y / 100.0;
        TY = -At.X / 100.0;
    }
    Behavior->Tick(DeltaSeconds, Pawn != nullptr, TX, TY, false);
}

void AVcgsCharacterActor::Hurt(float Amount)
{
    Health = Health > Amount ? Health - Amount : 0;
    Behavior->Hit(Health);
    Send(TEXT("hurt"), ToF(vcgs::Cast::NumText(Health)));
}

void AVcgsCharacterActor::PlanPosition(double& X, double& Y) const
{
    // Unreal's +X is the plan's north (-y), +Y its east (x), in centimetres.
    const FVector At = GetActorLocation();
    X = At.Y / 100.0;
    Y = -At.X / 100.0;
}

void AVcgsCharacterActor::MoveTo(double X, double Y)
{
    const FVector At = GetActorLocation();
    SetActorLocation(FVector(-Y * 100.0, X * 100.0, At.Z));
}

bool AVcgsCharacterActor::Steer(double AX, double AY, double TX, double TY, double& VX, double& VY, bool& bLast)
{
    const FVector At = GetActorLocation();
    if (!bPlaceFound)
    {
        bPlaceFound = true;
        if (const vcgs::NavPlace* Found = vcgs::NavPlaceAt(GetWorld(), At.X, At.Y, At.Z)) Place = *Found;
    }
    VX = TX;
    VY = TY;
    bLast = true;
    if (!Place.Graph) return true;
    // Plan to world (X = -y, Y = x, in centimetres, at its feet), then into the level's space.
    const vcgs::NavPoint Goal = Place.ToLevel(-TY * 100.0, TX * 100.0, At.Z);
    vcgs::NavPoint Next;
    if (!Place.Graph->NextOnWay(Way, Place.ToLevel(-AY * 100.0, AX * 100.0, At.Z), Goal, Next)) return false;
    if (Next == Goal) return true;
    double WX = 0, WY = 0, WZ = 0;
    Place.ToWorld(Next, WX, WY, WZ);
    VX = WY / 100.0;
    VY = -WX / 100.0;
    bLast = false;
    return true;
}
`;

const COMPONENTS_CPP = String.raw`${HEAD}
#include "VcgsActorComponents.h"
#include "VcgsCharacterActor.h"
#include "VcgsConvert.h"
#include "VcgsSubsystem.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include <cmath>

using VcgsConvert::ToF;
using VcgsConvert::ToStd;

bool UVcgsActorPerception::Blocked(double AX, double AY, double BX, double BY) const
{
    UWorld* World = Actor ? Actor->GetWorld() : nullptr;
    if (!World) return false;
    // At eye height (0.9 of its height) above where it stands (its root is at its feet, so a child map's floor counts), plan to world: X = -y, Y = x, in centimetres.
    const double Eye = Actor->GetActorLocation().Z + Actor->Data["stats"]["height"].Num(1.75) * 90.0;
    FCollisionQueryParams Params(FName(TEXT("VcgsSight")), false, Actor);
    FHitResult Hit;
    return World->LineTraceSingleByChannel(Hit, FVector(-AY * 100.0, AX * 100.0, Eye), FVector(-BY * 100.0, BX * 100.0, Eye), ECC_Visibility, Params);
}

void UVcgsActorBehavior::Setup(AVcgsCharacterActor* Owner)
{
    Actor = Owner;
    Ai = Owner->Data["ai"];
    Patrol = Owner->Route;
    double X = 0, Y = 0;
    Owner->PlanPosition(X, Y);
    if (Patrol.empty()) Patrol.push_back(vcgs::Cast::Point{X, Y, 0});
    if (Ai.IsObject()) Memory = vcgs::Cast::StartMemory(Ai, Patrol, Owner->Health);
    Memory.X = X;
    Memory.Y = Y;
}

FString UVcgsActorBehavior::State() const { return ToF(Ai.IsObject() ? Memory.State : ToStd(Actor ? Actor->Activity : FString())); }

void UVcgsActorBehavior::Tick(float DeltaSeconds, bool bHasTarget, double TargetX, double TargetY, bool bNoisy)
{
    if (!Actor) return;
    Clock += DeltaSeconds;
    // The way round walls, on its level's navigation graph; bNoWay says when there is none.
    AVcgsCharacterActor* Owner = Actor;
    bool bNoWay = false;
    const vcgs::Cast::Steer Way = [Owner, &bNoWay](double AX, double AY, double TX, double TY, double& VX, double& VY, bool& bLast) {
        if (Owner->Steer(AX, AY, TX, TY, VX, VY, bLast)) return true;
        bNoWay = true;
        return false;
    };
    if (!Ai.IsObject())
    {
        // No AI: its activity. Wander about its spot, walk its route, or stand.
        const std::string What = ToStd(Actor->Activity);
        if (What == "wander" && Actor->WanderRadius > 0)
        {
            const vcgs::Cast::Point Home = Patrol[0];
            const double A = Clock * 0.4 + Home.X + WanderTurn;
            vcgs::Cast::Walk(Memory, Home.X + std::cos(A) * Actor->WanderRadius * 0.5, Home.Y + std::sin(A) * Actor->WanderRadius * 0.5, 1.2, DeltaSeconds, Way);
            // Somewhere it can't get to: it picks another, a third of the way round.
            if (bNoWay) WanderTurn += 2.0943951023931953;
            Actor->MoveTo(Memory.X, Memory.Y);
        }
        else if (What == "patrol" && Patrol.size() > 1)
        {
            const vcgs::Cast::Point Goal = Patrol[static_cast<size_t>(Memory.PatrolIndex) % Patrol.size()];
            if (vcgs::Cast::Walk(Memory, Goal.X, Goal.Y, 1.4, DeltaSeconds, Way)) Memory.PatrolIndex = (Memory.PatrolIndex + 1) % static_cast<int>(Patrol.size());
            Actor->MoveTo(Memory.X, Memory.Y);
        }
        return;
    }
    vcgs::Cast::Target Target;
    Target.X = TargetX;
    Target.Y = TargetY;
    Target.bNoisy = bNoisy;
    Target.bAlive = bHasTarget;
    UVcgsActorPerception* Eyes = Actor->Perception;
    const vcgs::Cast::Step Step = vcgs::Cast::AiStep(Ai, Actor->Data["stats"]["speed"].Num(3), Memory, Target, Patrol, {}, DeltaSeconds,
        [Eyes](double AX, double AY, double BX, double BY) { return Eyes && Eyes->Blocked(AX, AY, BX, BY); }, Way);
    const std::string From = Memory.State;
    Memory = Step.Mem;
    Actor->MoveTo(Memory.X, Memory.Y);
    Actor->SetActorRotation(FRotator(0, Memory.Facing * 180.0 / 3.14159265358979323846 - 90.0, 0));
    if (!Step.Reason.empty())
    {
        LastReason = Step.Reason;
        OnStateChanged.Broadcast(ToF(From), ToF(Memory.State));
        Actor->Send(TEXT("state"), ToF(Step.Reason));
    }
    if (Step.bAttacked) Actor->Send(TEXT("attack"), ToF(vcgs::Cast::NumText(Memory.Attacks)));
    // A captor catches the player (the story's capture) rather than fighting them.
    if (Step.bAttacked && Catch()) Actor->Send(TEXT("caught"), TEXT(""));
}

bool UVcgsActorBehavior::Catch()
{
    const std::string Key = Actor ? Actor->Data["story_key"].Str() : std::string();
    UWorld* World = GetWorld();
    UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
    UVcgsSubsystem* Story = GameInstance ? GameInstance->GetSubsystem<UVcgsSubsystem>() : nullptr;
    vcgs::GameState* Game = Story ? Story->State() : nullptr;
    if (Key.empty() || !Game || !vcgs::Rules::IsCaptor(Key, *Game)) return false;
    return !vcgs::Rules::CatchPlayer(Key, *Game).empty();
}

void UVcgsActorBehavior::Hit(float Health)
{
    Memory.Health = Health;
    Memory.bHit = true;
}

void UVcgsActorAbilities::Setup(AVcgsCharacterActor* Owner)
{
    Actor = Owner;
    const vcgs::Value& Pool = Owner->Data["stats"]["resource"];
    if (Pool["kind"].Str() != "none") Resource[Pool["kind"].Str()] = Pool["max"].Num();
}

FString UVcgsActorAbilities::Use(const FString& Key, AVcgsCharacterActor* Target)
{
    if (!Actor) return TEXT("No character.");
    for (const auto& A : Actor->Data["abilities"].items)
    {
        if (A["key"].Str() != ToStd(Key)) continue;
        const std::string Why = vcgs::Cast::CanUse(A, Cooldowns, Resource, Clock);
        if (!Why.empty()) return ToF(Why);
        const std::string Kind = A["cost"]["resource"].Str();
        if (Kind != "none" && !Kind.empty()) Resource[Kind] -= A["cost"]["amount"].Num();
        Cooldowns[A["key"].Str()] = Clock + A["cooldown"].Num();
        // TODO(VCGS): a library ability marked "stub" only checks its cost and cooldown and sends its cue here; write what it does.
        if (A["graybox"].Str() == "stub" && A["source"].Str() == "library") UE_LOG(LogTemp, Log, TEXT("VCGS: %s is a stub; only its cost, cooldown and cue run."), *Key);
        for (const auto& Action : A["actions"].items)
        {
            const std::string Effect = Action["effect"].Str();
            const float Amount = static_cast<float>(Action["amount"].Num());
            if (Effect == "damage") { if (Target) Target->Hurt(Amount); }
            else if (Effect == "heal")
            {
                AVcgsCharacterActor* Who = Action["target"].Str() == "self" ? Actor : Target;
                if (Who)
                {
                    const float Most = static_cast<float>(Who->Data["stats"]["health"].Num(100));
                    Who->Health = Who->Health + Amount < Most ? Who->Health + Amount : Most;
                }
            }
            else if (Effect == "stun") { if (Target && Target->Behavior) Target->Behavior->Hit(Target->Health); }
            else if (Effect == "setFlag") Actor->Send(TEXT("set_flag"), ToF(Action["value"].Str()));
            else Actor->Send(ToF(Effect), ToF(Action["value"].Str()));
            if (!Action["event"].Str().empty()) Actor->Send(ToF(Action["event"].Str()), ToF(Effect));
        }
        Actor->Send(TEXT("ability"), Key);
        if (!A["cue"].Str().empty()) Actor->Send(TEXT("cue"), ToF(A["cue"].Str()));
        if (!A["vfx"].Str().empty()) Actor->Send(TEXT("vfx"), ToF(A["vfx"].Str()));
        if (!A["sfx"].Str().empty()) Actor->Send(TEXT("sfx"), ToF(A["sfx"].Str()));
        return FString();
    }
    return ToF("No ability " + ToStd(Key) + ".");
}

void UVcgsActorInventory::Setup(AVcgsCharacterActor* Owner)
{
    Rules = Owner->Data["inventory"];
    for (const auto& Entry : Rules["items"].items) Items[Entry["item"].Str()] += static_cast<int>(Entry["qty"].Num(1));
}

FString UVcgsActorInventory::Add(const FString& Item, int32 Qty)
{
    const std::string Why = vcgs::Cast::Fits(Rules, Items, ToStd(Item), Qty, Weights, Single);
    if (!Why.empty()) return ToF(Why);
    Items[ToStd(Item)] += Qty;
    return FString();
}

bool UVcgsActorInventory::Remove(const FString& Item, int32 Qty)
{
    auto It = Items.find(ToStd(Item));
    if (It == Items.end() || It->second < Qty) return false;
    It->second -= Qty;
    if (It->second == 0) Items.erase(It);
    return true;
}

int32 UVcgsActorInventory::Count(const FString& Item) const
{
    auto It = Items.find(ToStd(Item));
    return It != Items.end() ? It->second : 0;
}

void UVcgsActorEquipment::Setup(AVcgsCharacterActor* Owner)
{
    Actor = Owner;
    for (const auto& Slot : Owner->Data["inventory"]["equipment"].items) Slots[Slot["slot"].Str()] = Slot["item"].Str();
}

FString UVcgsActorEquipment::Equip(const FString& Slot, const FString& Item)
{
    if (!Slots.count(ToStd(Slot))) return ToF("No " + ToStd(Slot) + " slot.");
    if (!Item.IsEmpty() && Actor && Actor->Inventory && Actor->Inventory->Count(Item) <= 0) return ToF("Not carrying " + ToStd(Item) + ".");
    Slots[ToStd(Slot)] = ToStd(Item);
    if (Actor) Actor->Send(TEXT("equip"), Item);
    return FString();
}

FString UVcgsActorEquipment::InSlot(const FString& Slot) const
{
    auto It = Slots.find(ToStd(Slot));
    return ToF(It != Slots.end() ? It->second : std::string());
}

void UVcgsActorDialogue::Setup(AVcgsCharacterActor* Owner)
{
    Npc = Owner->Data["npc"];
    bInteractive = Npc.IsObject();
}

FString UVcgsActorDialogue::Prompt() const { return ToF(Npc["prompt"].Str()); }

TArray<FString> UVcgsActorDialogue::TopicKeys() const
{
    TArray<FString> Keys;
    for (const auto& T : Npc["topics"].items) Keys.Add(ToF(T["key"].Str()));
    return Keys;
}

TArray<FString> UVcgsActorDialogue::TopicLines(const FString& Topic) const
{
    TArray<FString> Lines;
    for (const auto& T : Npc["topics"].items)
        if (T["key"].Str() == ToStd(Topic))
            for (const auto& L : T["lines"].items) Lines.Add(ToF(L.Str()));
    return Lines;
}
`;

const SPAWN_CPP = String.raw`${HEAD}
#include "VcgsSpawnGroup.h"
#include "VcgsCharacterActor.h"
#include "VcgsConvert.h"
#include "Engine/World.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include <cmath>

using VcgsConvert::ToF;
using VcgsConvert::ToStd;

${LOAD}

void AVcgsSpawnGroup::BeginPlay()
{
    Super::BeginPlay();
    vcgs::Value Cast;
    if (!LoadCast(CharactersFile, Cast))
    {
        UE_LOG(LogTemp, Error, TEXT("VCGS: the spawn group needs its CharactersFile (%s)."), *CharactersFile);
        return;
    }
    Spawn(Cast);
}

void AVcgsSpawnGroup::Spawn(const vcgs::Value& Cast)
{
    UWorld* World = GetWorld();
    if (!World || Spawned.Num() > 0) return;
    for (const vcgs::Value* P : vcgs::Cast::Placements(Cast, ToStd(LevelGuid)))
    {
        if (!ItemGuid.IsEmpty() && (*P)["item"].Str() != ToStd(ItemGuid)) continue;
        if (bActorsOnly && (*P)["kind"].Str() != "actor") continue;
        for (const auto& M : (*P)["members"].items)
        {
            // Into the world through the map's origin and turn.
            const vcgs::Value& At = M["position"];
            const FVector Where = ToWorld(At[0].Num(), At[1].Num(), At[2].Num());
            AVcgsCharacterActor* Actor = World->SpawnActor<AVcgsCharacterActor>(AVcgsCharacterActor::StaticClass(), Where, FRotator(0, MapYaw - M["turn"].Num(), 0));
            if (!Actor) continue;
            Actor->CharacterKey = ToF(M["character"].Str());
            Actor->VariantKey = ToF(M["variant"].Str());
            Actor->Activity = ToF(M["activity"].Str());
            Actor->WanderRadius = static_cast<float>(M["wander_radius"].Num());
            // Each stop, and how long it stands there (route_wait), on the world's plan (x = Y, y = -X, in metres), where the actor walks.
            const vcgs::Value& Waits = M["route_wait"];
            for (size_t N = 0; N < M["route"].items.size(); N++)
            {
                const vcgs::Value& R = M["route"].items[N];
                const FVector Stop = ToWorld(R[0].Num(), 0.0, R[2].Num());
                Actor->Route.push_back(vcgs::Cast::Point{Stop.Y / 100.0, -Stop.X / 100.0, N < Waits.Size() ? Waits[N].Num() : 0.0});
            }
            if (Actor->Setup(Cast)) Spawned.Add(Actor);
        }
    }
}

FVector AVcgsSpawnGroup::ToWorld(double X, double Y, double Z) const
{
    const double LX = -Z * 100.0, LY = X * 100.0;
    const double Yaw = MapYaw * 3.14159265358979323846 / 180.0;
    return FVector(MapOrigin.X + LX * std::cos(Yaw) - LY * std::sin(Yaw), MapOrigin.Y + LX * std::sin(Yaw) + LY * std::cos(Yaw), MapOrigin.Z + Y * 100.0);
}

void AVcgsSpawnGroup::ShowGroup()
{
    for (AVcgsCharacterActor* Actor : Spawned) { Actor->SetActorHiddenInGame(false); Actor->SetActorEnableCollision(true); }
}

void AVcgsSpawnGroup::HideGroup()
{
    for (AVcgsCharacterActor* Actor : Spawned) { Actor->SetActorHiddenInGame(true); Actor->SetActorEnableCollision(false); }
}
`;

/** The cast's plugin files; VcgsNav.h comes with the levels' (NAV_PLUGIN_FILES), or on its own with no levels. */
export const CHARACTER_PLUGIN_FILES: Record<string, string> = {
  'Source/VCGS/Public/VcgsCast.h': CORE,
  'Source/VCGS/Public/VcgsActorComponents.h': COMPONENTS_H,
  'Source/VCGS/Public/VcgsCharacterActor.h': ACTOR_H,
  'Source/VCGS/Public/VcgsSpawnGroup.h': SPAWN_H,
  'Source/VCGS/Private/VcgsActorComponents.cpp': COMPONENTS_CPP,
  'Source/VCGS/Private/VcgsCharacterActor.cpp': ACTOR_CPP,
  'Source/VCGS/Private/VcgsSpawnGroup.cpp': SPAWN_CPP,
};
