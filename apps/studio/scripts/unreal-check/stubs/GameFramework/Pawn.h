#pragma once
#include "GameFramework/Actor.h"
class UPawnMovementComponent;
class APawn : public AActor
{
public:
    UPawnMovementComponent* GetMovementComponent() const { return nullptr; }
};
