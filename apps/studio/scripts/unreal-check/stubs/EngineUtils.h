#pragma once
#include "CoreMinimal.h"
class UWorld;
template <typename T>
class TActorIterator
{
public:
    explicit TActorIterator(UWorld*) {}
    explicit operator bool() const { return false; }
    T* operator*() const { return nullptr; }
    void operator++() {}
};
