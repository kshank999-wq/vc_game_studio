#pragma once
#include "CoreMinimal.h"
struct FPaths
{
    static FString ProjectContentDir() { return FString(""); }
    static FString ProjectSavedDir() { return FString(""); }
    static FString ConvertRelativePathToFull(const FString& Path) { return Path; }
};
