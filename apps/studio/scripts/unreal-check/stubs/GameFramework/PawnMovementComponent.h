#pragma once
#include "Components/ActorComponent.h"
class UPawnMovementComponent : public UActorComponent
{
public:
    bool IsFalling() const { return false; }
};
