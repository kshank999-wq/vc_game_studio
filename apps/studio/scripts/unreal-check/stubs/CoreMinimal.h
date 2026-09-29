// Just enough of Unreal's core for the VCGS plugin's source to compile
// (syntax and types) outside the engine. The reflection macros are empty:
// this is not Unreal Header Tool, only a check that the C++ is sound.
#pragma once
#include <cmath>
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
    bool operator==(const FString& o) const { return data == o.data; }
    friend FString operator/(const FString& a, const FString& b) { return FString((a.data + "/" + b.data).c_str()); }
private:
    std::string data;
};

template <typename T>
class TArray
{
public:
    int32 Add(const T& item) { items.push_back(item); return static_cast<int32>(items.size()) - 1; }
    void Reset() { items.clear(); }
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

#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(Name, T1, P1, T2, P2, T3, P3) VCGS_DECLARE_DELEGATE(Name)
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_EightParams(Name, T1, P1, T2, P2, T3, P3, T4, P4, T5, P5, T6, P6, T7, P7, T8, P8) VCGS_DECLARE_DELEGATE(Name)

template <typename K, typename V>
struct TPair
{
    K Key;
    V Value;
};

template <typename K, typename V>
class TMap
{
public:
    void Add(const K& key, const V& value)
    {
        for (auto& p : pairs) if (p.Key == key) { p.Value = value; return; }
        pairs.push_back(TPair<K, V>{key, value});
    }
    V* Find(const K& key) { for (auto& p : pairs) if (p.Key == key) return &p.Value; return nullptr; }
    const V* Find(const K& key) const { for (const auto& p : pairs) if (p.Key == key) return &p.Value; return nullptr; }
    typename std::vector<TPair<K, V>>::iterator begin() { return pairs.begin(); }
    typename std::vector<TPair<K, V>>::iterator end() { return pairs.end(); }
    typename std::vector<TPair<K, V>>::const_iterator begin() const { return pairs.begin(); }
    typename std::vector<TPair<K, V>>::const_iterator end() const { return pairs.end(); }
private:
    std::vector<TPair<K, V>> pairs;
};

struct FVector
{
    double X = 0, Y = 0, Z = 0;
    FVector() {}
    FVector(double x, double y, double z) : X(x), Y(y), Z(z) {}
    FVector operator-(const FVector& o) const { return FVector(X - o.X, Y - o.Y, Z - o.Z); }
    double Size() const { return X * X + Y * Y + Z * Z; }
    bool IsNearlyZero() const { return Size() < 1e-8; }
    FVector GetSafeNormal() const { return *this; }
    static double DotProduct(const FVector& a, const FVector& b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
};

struct FHitResult {};

struct FVector2D
{
    double X = 0, Y = 0;
    FVector2D() {}
    FVector2D(double x, double y) : X(x), Y(y) {}
};

struct FTransform {};

struct FMath
{
    static double Sqrt(double v) { return std::sqrt(v); }
    template <typename T> static T Max(T a, T b) { return a < b ? b : a; }
};
