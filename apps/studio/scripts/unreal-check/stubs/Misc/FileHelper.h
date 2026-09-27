#pragma once
#include "CoreMinimal.h"
struct FFileHelper
{
    static bool LoadFileToString(FString& Result, const TCHAR* Filename) { (void)Result; (void)Filename; return false; }
};
