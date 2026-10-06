#pragma once
#include "CoreMinimal.h"
class UGameInstance;
class AActor;
enum ECollisionChannel { ECC_Visibility, ECC_Camera };
struct FName
{
    FName() {}
    FName(const TCHAR*) {}
};
struct FCollisionQueryParams
{
    FCollisionQueryParams() {}
    FCollisionQueryParams(FName, bool = false, const AActor* = nullptr) {}
    void AddIgnoredActor(const AActor*) {}
};
class UWorld : public UObject
{
public:
    UGameInstance* GetGameInstance() const { return nullptr; }
    float GetDeltaSeconds() const { return 0.f; }
    bool LineTraceSingleByChannel(FHitResult&, const FVector&, const FVector&, ECollisionChannel, const FCollisionQueryParams& = FCollisionQueryParams()) const { return false; }
};
