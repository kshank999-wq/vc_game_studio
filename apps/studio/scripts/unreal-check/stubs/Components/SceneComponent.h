#pragma once
#include "Components/ActorComponent.h"
class USceneComponent : public UActorComponent
{
public:
    void SetupAttachment(USceneComponent*) {}
    void SetRelativeLocation(const FVector&) {}
    void SetHiddenInGame(bool) {}
};
