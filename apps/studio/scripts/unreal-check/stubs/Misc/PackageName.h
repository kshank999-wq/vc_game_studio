#pragma once
#include "CoreMinimal.h"
class FPackageName
{
public:
    static bool DoesPackageExist(const FString&) { return false; }
};
