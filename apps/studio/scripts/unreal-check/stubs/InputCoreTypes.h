#pragma once
#include "CoreMinimal.h"
struct FKey
{
    std::string Name;
    FKey() {}
    FKey(const char* InName) : Name(InName) {}
    FString ToString() const { return FString(Name.c_str()); }
};
struct EKeys
{
    static const FKey C;
    static const FKey Escape;
};
inline const FKey EKeys::C = FKey("C");
inline const FKey EKeys::Escape = FKey("Escape");
