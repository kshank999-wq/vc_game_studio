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
    void GetTextSize(const FString&, float& OutWidth, float& OutHeight, UFont* = nullptr, float = 1.f) const { OutWidth = 0.f; OutHeight = 0.f; }
    void DrawText(const FString&, FLinearColor, float, float, UFont* = nullptr, float = 1.f, bool = false) {}
};
