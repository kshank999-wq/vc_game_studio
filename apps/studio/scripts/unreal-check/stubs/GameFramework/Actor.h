#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
class UWorld;
class USceneComponent;
class UClass {};
class AActor : public UObject
{
public:
    static UClass* StaticClass() { static UClass c; return &c; }
    using Super = AActor;
    USceneComponent* RootComponent = nullptr;
    struct { bool bCanEverTick = false; } PrimaryActorTick;
    virtual void BeginPlay() {}
    virtual void EndPlay(const EEndPlayReason::Type) {}
    virtual void OnConstruction(const FTransform& Transform) { (void)Transform; }
    virtual void Tick(float DeltaSeconds) { (void)DeltaSeconds; }
    UWorld* GetWorld() const { return nullptr; }
    void SetActorHiddenInGame(bool) {}
    bool ActorHasTag(FName) const { return false; }
    void SetActorEnableCollision(bool) {}
    void GetAttachedActors(TArray<AActor*>&) const {}
    FVector GetActorLocation() const { return FVector(); }
    void GetActorBounds(bool, FVector& Origin, FVector& Extent, bool = false) const { Origin = FVector(); Extent = FVector(); }
    bool SetActorLocation(const FVector&) { return true; }
    bool SetActorRotation(const FRotator&) { return true; }
    template <typename T> T* CreateDefaultSubobject(const TCHAR*) { return new T(); }
};
