#pragma once
#include "CoreMinimal.h"
struct FColor
{
    unsigned char R = 255, G = 255, B = 255, A = 255;
    static const FColor White;
};
inline const FColor FColor::White = FColor();
class UEngine : public UObject
{
public:
    void AddOnScreenDebugMessage(int, float, const FColor&, const FString&) {}
};
inline UEngine* GEngine = nullptr;
