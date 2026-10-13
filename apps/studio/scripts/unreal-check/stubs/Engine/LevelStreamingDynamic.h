#pragma once
#include "CoreMinimal.h"
class UWorld;
class ULevelStreamingDynamic : public UObject
{
public:
    static ULevelStreamingDynamic* LoadLevelInstance(UWorld*, const FString&, const FVector&, const FRotator&, bool& bOutSuccess)
    {
        bOutSuccess = false;
        return nullptr;
    }
    void SetShouldBeLoaded(bool) {}
    void SetShouldBeVisible(bool) {}
    void SetIsRequestingUnloadAndRemoval(bool) {}
};
