#pragma once
#include "CoreMinimal.h"
struct FPlatformApplicationMisc
{
    static void ClipboardCopy(const TCHAR* Text) { (void)Text; }
    static void ClipboardPaste(FString& Result) { Result = FString(""); }
};
