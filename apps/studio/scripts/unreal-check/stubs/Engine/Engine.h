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
    void AddOnScreenDebugMessage(unsigned long long, float, const FColor&, const FString&) {}
    void RemoveOnScreenDebugMessage(unsigned long long) {}
};
inline UEngine* GEngine = nullptr;
