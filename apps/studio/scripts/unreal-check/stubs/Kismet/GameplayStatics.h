#pragma once
#include "GameFramework/Pawn.h"
#include "Sound/SoundBase.h"
class UGameplayStatics
{
public:
    static APawn* GetPlayerPawn(const UObject*, int32) { return nullptr; }
    static void PlaySound2D(const UObject*, USoundBase*) {}
};
