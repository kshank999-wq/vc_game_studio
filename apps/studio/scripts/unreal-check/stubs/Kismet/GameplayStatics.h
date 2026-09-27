#pragma once
#include "GameFramework/Pawn.h"
class UGameplayStatics
{
public:
    static APawn* GetPlayerPawn(const UObject*, int32) { return nullptr; }
};
