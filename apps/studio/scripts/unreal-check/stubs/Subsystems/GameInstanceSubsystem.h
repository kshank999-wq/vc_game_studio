#pragma once
#include "CoreMinimal.h"
class FSubsystemCollectionBase {};
class USubsystem : public UObject
{
public:
    virtual void Initialize(FSubsystemCollectionBase&) {}
    virtual void Deinitialize() {}
};
class UGameInstance;
class UGameInstanceSubsystem : public USubsystem
{
public:
    UGameInstance* GetGameInstance() const { return nullptr; }
    // Unreal Header Tool gives every class its Super; here the base provides it.
    using Super = UGameInstanceSubsystem;
};
