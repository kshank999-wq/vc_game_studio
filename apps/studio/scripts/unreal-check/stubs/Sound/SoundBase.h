#pragma once
#include "CoreMinimal.h"
class USoundBase : public UObject
{
public:
    virtual float GetDuration() const { return 0.f; }
};
