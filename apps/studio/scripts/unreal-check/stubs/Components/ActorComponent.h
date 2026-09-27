#pragma once
#include "CoreMinimal.h"
namespace EEndPlayReason
{
    enum Type { Destroyed, LevelTransition, EndPlayInEditor, RemovedFromWorld, Quit };
}
class UWorld;
class UActorComponent : public UObject
{
public:
    using Super = UActorComponent;
    virtual void BeginPlay() {}
    virtual void EndPlay(const EEndPlayReason::Type) {}
    UWorld* GetWorld() const { return nullptr; }
};
