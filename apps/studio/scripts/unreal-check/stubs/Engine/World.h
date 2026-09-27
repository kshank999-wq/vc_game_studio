#pragma once
#include "CoreMinimal.h"
class UGameInstance;
class UWorld : public UObject
{
public:
    UGameInstance* GetGameInstance() const { return nullptr; }
};
