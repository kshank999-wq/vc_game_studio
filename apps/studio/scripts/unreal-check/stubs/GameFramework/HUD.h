#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
class UCanvas;
class UFont;
class APlayerController;
class AHUD : public AActor
{
public:
    using Super = AHUD;
    UCanvas* Canvas = nullptr;
    APlayerController* PlayerOwner = nullptr;
    virtual void DrawHUD() {}
    void DrawRect(FLinearColor, float, float, float, float) {}
    void DrawText(const FString&, FLinearColor, float, float, UFont* = nullptr, float = 1.f, bool = false) {}
};
