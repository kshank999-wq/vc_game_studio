#pragma once
#include "CoreMinimal.h"
struct FPlatformProcess
{
    static void LaunchURL(const TCHAR* URL, const TCHAR* Parms, FString* Error) { (void)URL; (void)Parms; (void)Error; }
    static void LaunchFileInDefaultExternalApplication(const TCHAR* FileName, const TCHAR* Parms = nullptr) { (void)FileName; (void)Parms; }
};
