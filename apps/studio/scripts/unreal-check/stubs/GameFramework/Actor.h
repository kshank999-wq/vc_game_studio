#pragma once
#include "CoreMinimal.h"
class UWorld;
class USceneComponent;
class AActor : public UObject
{
public:
    using Super = AActor;
    USceneComponent* RootComponent = nullptr;
    struct { bool bCanEverTick = false; } PrimaryActorTick;
    virtual void BeginPlay() {}
    virtual void OnConstruction(const FTransform& Transform) { (void)Transform; }
    virtual void Tick(float DeltaSeconds) { (void)DeltaSeconds; }
    UWorld* GetWorld() const { return nullptr; }
    void SetActorHiddenInGame(bool) {}
    void SetActorEnableCollision(bool) {}
    void GetAttachedActors(TArray<AActor*>&) const {}
    FVector GetActorLocation() const { return FVector(); }
    template <typename T> T* CreateDefaultSubobject(const TCHAR*) { return new T(); }
};
