#pragma once
#include "Components/PrimitiveComponent.h"
struct FProcMeshTangent {};
class UProceduralMeshComponent : public UPrimitiveComponent
{
public:
    bool bUseComplexAsSimpleCollision = true;
    void ClearAllMeshSections() {}
    void CreateMeshSection_LinearColor(int32, const TArray<FVector>&, const TArray<int32>&, const TArray<FVector>&, const TArray<FVector2D>&, const TArray<FLinearColor>&, const TArray<FProcMeshTangent>&, bool) {}
    void SetMeshSectionVisible(int32, bool) {}
    void ClearCollisionConvexMeshes() {}
    void AddCollisionConvexMesh(TArray<FVector>) {}
};
