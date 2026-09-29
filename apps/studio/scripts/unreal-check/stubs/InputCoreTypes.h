#pragma once
#include "CoreMinimal.h"
struct FKey
{
    std::string Name;
    FKey() {}
    FKey(const char* InName) : Name(InName) {}
    FString ToString() const { return FString(Name.c_str()); }
};
struct EKeys
{
    static const FKey A;
    static const FKey B;
    static const FKey C;
    static const FKey D;
    static const FKey E;
    static const FKey F;
    static const FKey G;
    static const FKey H;
    static const FKey I;
    static const FKey J;
    static const FKey K;
    static const FKey L;
    static const FKey M;
    static const FKey N;
    static const FKey O;
    static const FKey P;
    static const FKey Q;
    static const FKey R;
    static const FKey S;
    static const FKey T;
    static const FKey U;
    static const FKey V;
    static const FKey W;
    static const FKey X;
    static const FKey Y;
    static const FKey Z;
    static const FKey Zero;
    static const FKey One;
    static const FKey Two;
    static const FKey Three;
    static const FKey Four;
    static const FKey Five;
    static const FKey Six;
    static const FKey Seven;
    static const FKey Eight;
    static const FKey Nine;
    static const FKey SpaceBar;
    static const FKey BackSpace;
    static const FKey Enter;
    static const FKey Escape;
    static const FKey Slash;
    static const FKey Tab;
};
inline const FKey EKeys::A = FKey("A");
inline const FKey EKeys::B = FKey("B");
inline const FKey EKeys::C = FKey("C");
inline const FKey EKeys::D = FKey("D");
inline const FKey EKeys::E = FKey("E");
inline const FKey EKeys::F = FKey("F");
inline const FKey EKeys::G = FKey("G");
inline const FKey EKeys::H = FKey("H");
inline const FKey EKeys::I = FKey("I");
inline const FKey EKeys::J = FKey("J");
inline const FKey EKeys::K = FKey("K");
inline const FKey EKeys::L = FKey("L");
inline const FKey EKeys::M = FKey("M");
inline const FKey EKeys::N = FKey("N");
inline const FKey EKeys::O = FKey("O");
inline const FKey EKeys::P = FKey("P");
inline const FKey EKeys::Q = FKey("Q");
inline const FKey EKeys::R = FKey("R");
inline const FKey EKeys::S = FKey("S");
inline const FKey EKeys::T = FKey("T");
inline const FKey EKeys::U = FKey("U");
inline const FKey EKeys::V = FKey("V");
inline const FKey EKeys::W = FKey("W");
inline const FKey EKeys::X = FKey("X");
inline const FKey EKeys::Y = FKey("Y");
inline const FKey EKeys::Z = FKey("Z");
inline const FKey EKeys::Zero = FKey("Zero");
inline const FKey EKeys::One = FKey("One");
inline const FKey EKeys::Two = FKey("Two");
inline const FKey EKeys::Three = FKey("Three");
inline const FKey EKeys::Four = FKey("Four");
inline const FKey EKeys::Five = FKey("Five");
inline const FKey EKeys::Six = FKey("Six");
inline const FKey EKeys::Seven = FKey("Seven");
inline const FKey EKeys::Eight = FKey("Eight");
inline const FKey EKeys::Nine = FKey("Nine");
inline const FKey EKeys::SpaceBar = FKey("SpaceBar");
inline const FKey EKeys::BackSpace = FKey("BackSpace");
inline const FKey EKeys::Enter = FKey("Enter");
inline const FKey EKeys::Escape = FKey("Escape");
inline const FKey EKeys::Slash = FKey("Slash");
inline const FKey EKeys::Tab = FKey("Tab");
