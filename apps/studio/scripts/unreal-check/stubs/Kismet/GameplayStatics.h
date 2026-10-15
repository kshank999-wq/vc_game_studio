#pragma once
#include "GameFramework/Pawn.h"
#include "Sound/SoundBase.h"
#include "Components/AudioComponent.h"
class UGameplayStatics
{
public:
    static APawn* GetPlayerPawn(const UObject*, int32) { return nullptr; }
    static void PlaySound2D(const UObject*, USoundBase*) {}
    static UAudioComponent* SpawnSound2D(const UObject*, USoundBase*, float = 1.f) { return nullptr; }
};
