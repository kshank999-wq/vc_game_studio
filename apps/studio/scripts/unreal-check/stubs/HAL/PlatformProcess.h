#pragma once
#include "CoreMinimal.h"
struct FPlatformProcess
{
    static void LaunchFileInDefaultExternalApplication(const TCHAR* FileName, const TCHAR* Parms = nullptr) { (void)FileName; (void)Parms; }
};
