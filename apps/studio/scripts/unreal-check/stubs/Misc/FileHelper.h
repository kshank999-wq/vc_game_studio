#pragma once
#include "CoreMinimal.h"
struct FFileHelper
{
    enum class EEncodingOptions { AutoDetect, ForceAnsi, ForceUnicode, ForceUTF8, ForceUTF8WithoutBOM };
    static bool LoadFileToString(FString& Result, const TCHAR* Filename) { (void)Result; (void)Filename; return false; }
    static bool SaveStringToFile(const FString& String, const TCHAR* Filename, EEncodingOptions Encoding = EEncodingOptions::AutoDetect) { (void)String; (void)Filename; (void)Encoding; return true; }
};
