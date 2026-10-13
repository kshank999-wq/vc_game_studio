#pragma once
#include "CoreMinimal.h"
struct FTickerDelegate
{
    template <typename U, typename F> static FTickerDelegate CreateUObject(U*, F) { return FTickerDelegate(); }
};
class FTSTicker
{
public:
    struct FDelegateHandle
    {
        bool IsValid() const { return false; }
        void Reset() {}
    };
    static FTSTicker& GetCoreTicker()
    {
        static FTSTicker Ticker;
        return Ticker;
    }
    FDelegateHandle AddTicker(const FTickerDelegate&, float = 0.f) { return FDelegateHandle(); }
    static void RemoveTicker(FDelegateHandle) {}
};
