#pragma once
#include "Components/SceneComponent.h"
namespace ESplineCoordinateSpace
{
    enum Type { Local, World };
}
class USplineComponent : public USceneComponent
{
public:
    void ClearSplinePoints(bool = true) {}
    void AddSplinePoint(const FVector&, ESplineCoordinateSpace::Type, bool = true) {}
    void UpdateSpline() {}
};
