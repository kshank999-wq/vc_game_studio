#pragma once
#include "Components/SceneComponent.h"
class AActor;
struct FVcgsOverlapDelegate
{
    template <typename U, typename F> void AddDynamic(U*, F) {}
};
class UPrimitiveComponent : public USceneComponent
{
public:
    FVcgsOverlapDelegate OnComponentBeginOverlap;
    FVcgsOverlapDelegate OnComponentEndOverlap;
    void SetGenerateOverlapEvents(bool) {}
    void SetCollisionProfileName(const TCHAR*) {}
};
