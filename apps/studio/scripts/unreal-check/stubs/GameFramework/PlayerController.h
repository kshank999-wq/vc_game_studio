#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "InputCoreTypes.h"
class APlayerController : public AActor
{
public:
    bool WasInputKeyJustPressed(const FKey&) const { return false; }
};
