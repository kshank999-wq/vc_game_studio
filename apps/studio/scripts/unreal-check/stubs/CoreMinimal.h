// Just enough of Unreal's core for the VCGS plugin's source to compile
// (syntax and types) outside the engine. The reflection macros are empty:
// this is not Unreal Header Tool, only a check that the C++ is sound.
#pragma once
#include <string>
#include <vector>

typedef char TCHAR;
typedef int int32;
#define TEXT(x) x
#define TCHAR_TO_UTF8(x) (x)
#define UTF8_TO_TCHAR(x) (x)
#define VCGS_API
#define UCLASS(...)
#define USTRUCT(...)
#define UPROPERTY(...)
#define UFUNCTION(...)
#define GENERATED_BODY()

class FString
{
public:
    FString() {}
    FString(const TCHAR* s) : data(s ? s : "") {}
    const TCHAR* operator*() const { return data.c_str(); }
    bool IsEmpty() const { return data.empty(); }
    friend FString operator/(const FString& a, const FString& b) { return FString((a.data + "/" + b.data).c_str()); }
private:
    std::string data;
};

template <typename T>
class TArray
{
public:
    int32 Add(const T& item) { items.push_back(item); return static_cast<int32>(items.size()) - 1; }
    int32 Num() const { return static_cast<int32>(items.size()); }
    T& operator[](int32 i) { return items[static_cast<size_t>(i)]; }
    typename std::vector<T>::iterator begin() { return items.begin(); }
    typename std::vector<T>::iterator end() { return items.end(); }
private:
    std::vector<T> items;
};

struct FLinearColor
{
    float R = 0, G = 0, B = 0, A = 1;
    FLinearColor() {}
    FLinearColor(float r, float g, float b, float a = 1) : R(r), G(g), B(b), A(a) {}
    static const FLinearColor White;
};
inline const FLinearColor FLinearColor::White = FLinearColor(1, 1, 1, 1);

class UObject
{
public:
    virtual ~UObject() {}
};

struct FLogCategory {};
static FLogCategory LogTemp;
#define UE_LOG(Category, Verbosity, Format, ...) ((void)(Category), (void)sizeof(Format))

#define VCGS_DECLARE_DELEGATE(Name) \
    struct Name \
    { \
        template <typename... Args> void Broadcast(const Args&...) const {} \
    };
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(Name, T1, P1) VCGS_DECLARE_DELEGATE(Name)
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(Name, T1, P1, T2, P2) VCGS_DECLARE_DELEGATE(Name)
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(Name, T1, P1, T2, P2, T3, P3, T4, P4) VCGS_DECLARE_DELEGATE(Name)
