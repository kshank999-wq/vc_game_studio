/**
 * VcgsNav.h for Unreal Engine 5 (spec §19 navmesh): a level's navigation
 * graph from the handoff (IrNav, the level JSON's "nav") and the way across
 * it, the same rules as the studio's `findPath` and `nextOnWay` and Godot's
 * VCGSNav, so a patrol walks the same way in all three. Plain C++17 on the
 * plugin's vcgs::Value, in the level's space (metres; x east, y up, z south),
 * as vcgs::LevelLogic keeps its poses: tests run it anywhere.
 */

const RUNTIME_HEAD = '// VCGS Runtime for Unreal. The same for every project; safe to commit.';

const NAV_H = String.raw`${RUNTIME_HEAD}
// A level's navigation graph (spec §19 navmesh) in plain C++17: standable
// cells on a grid and which reach which, and the way across it: A* over the
// cells, pulled straight wherever the line between two points of it is
// clear. The same rules as the studio's Play Mode, so people walk round walls
// the same way there and here. Doors count as open. Standard library only, no
// exceptions or RTTI.
#pragma once

#include "VcgsCore.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <memory>
#include <utility>
#include <vector>

namespace vcgs
{
    /** A point in a level's space, as the data has it (metres; x east, y up, z south). */
    struct NavPoint
    {
        double X = 0, Y = 0, Z = 0;
        bool operator==(const NavPoint& o) const { return X == o.X && Y == o.Y && Z == o.Z; }
    };

    /** A way being walked: the points still ahead, where it was planned to, and whether there is no way there at all. Not planned yet until Planned. */
    struct NavWay
    {
        std::vector<NavPoint> Route;
        NavPoint Aim;
        bool Planned = false, None = false;
    };

    class NavGraph
    {
    public:
        /** A way is planned again once its target has moved this far from where it was planned to. */
        static constexpr double Replan = 1;

        double Cell = 0.5, OriginX = 0, OriginZ = 0, StepUp = 0.42;
        int Cols = 0, Rows = 0;
        std::vector<NavPoint> Nodes;
        std::vector<std::vector<int>> Links;
        /** Grid cell (row * Cols + col) to the nodes standing in it. */
        std::vector<std::vector<int>> At;

        /** The graph from a level's nav data (the level JSON's "nav"); null for none. */
        static std::shared_ptr<const NavGraph> FromData(const Value& data)
        {
            if (!data.IsObject()) return nullptr;
            auto g = std::make_shared<NavGraph>();
            g->Cell = data["cell"].Num(0.5);
            g->OriginX = data["origin"][0].Num(0);
            g->OriginZ = data["origin"][1].Num(0);
            g->Cols = static_cast<int>(data["cols"].Num(0));
            g->Rows = static_cast<int>(data["rows"].Num(0));
            g->StepUp = data["step_up"].Num(0.42);
            g->At.assign(static_cast<size_t>(std::max(0, g->Cols * g->Rows)), std::vector<int>());
            const Value& flat = data["nodes"];
            for (size_t i = 0; i + 2 < flat.Size(); i += 3)
            {
                const NavPoint n{flat[i].Num(0), flat[i + 1].Num(0), flat[i + 2].Num(0)};
                const int k = g->CellOf(n.X, n.Z);
                if (k >= 0) g->At[static_cast<size_t>(k)].push_back(static_cast<int>(g->Nodes.size()));
                g->Nodes.push_back(n);
            }
            const Value& links = data["links"];
            for (size_t i = 0; i < links.Size(); i++)
            {
                std::vector<int> out;
                for (size_t j = 0; j < links[i].Size(); j++) out.push_back(static_cast<int>(links[i][j].Num(0)));
                g->Links.push_back(std::move(out));
            }
            // Every node has its links, if only none.
            g->Links.resize(g->Nodes.size());
            return g;
        }

        int CellOf(double x, double z) const
        {
            const int c = static_cast<int>(std::floor((x - OriginX) / Cell));
            const int r = static_cast<int>(std::floor((z - OriginZ) / Cell));
            return c < 0 || r < 0 || c >= Cols || r >= Rows ? -1 : r * Cols + c;
        }

        /** How far apart two points are on the plan (height aside). */
        static double Flat(const NavPoint& a, const NavPoint& b) { return std::sqrt((b.X - a.X) * (b.X - a.X) + (b.Z - a.Z) * (b.Z - a.Z)); }

        /**
         * The node nearest a point: in its cell (the closest height), else the nearest in a few
         * cells round it; -1 for none. Height counts three times the plan: the floor you are on.
         */
        int Nearest(const NavPoint& p, int reach = 4) const
        {
            const int c0 = static_cast<int>(std::floor((p.X - OriginX) / Cell));
            const int r0 = static_cast<int>(std::floor((p.Z - OriginZ) / Cell));
            int best = -1;
            double score = std::numeric_limits<double>::infinity();
            for (int ring = 0; ring <= reach && best < 0; ring++)
                for (int r = r0 - ring; r <= r0 + ring; r++)
                    for (int c = c0 - ring; c <= c0 + ring; c++)
                    {
                        if (std::max(std::abs(r - r0), std::abs(c - c0)) != ring || r < 0 || c < 0 || r >= Rows || c >= Cols) continue;
                        for (int i : At[static_cast<size_t>(r * Cols + c)])
                        {
                            const NavPoint& n = Nodes[static_cast<size_t>(i)];
                            const double s = Flat(n, p) + std::fabs(n.Y - p.Y) * 3;
                            if (s < score) { score = s; best = i; }
                        }
                    }
            return best;
        }

        /**
         * Whether someone can walk straight from node a to node b: every half cell along the line
         * stands on a node near the height there, each leading to the next.
         */
        bool ClearLine(int a, int b) const
        {
            const NavPoint& p = Nodes[static_cast<size_t>(a)];
            const NavPoint& q = Nodes[static_cast<size_t>(b)];
            const int steps = std::max(1, static_cast<int>(std::ceil(Flat(p, q) / (Cell * 0.5))));
            int prev = a;
            for (int s = 1; s <= steps; s++)
            {
                const double t = static_cast<double>(s) / steps;
                const double x = p.X + (q.X - p.X) * t, z = p.Z + (q.Z - p.Z) * t;
                const double height = Nodes[static_cast<size_t>(prev)].Y;
                int next = -1;
                if (s == steps) next = b;
                else
                {
                    const int k = CellOf(x, z);
                    if (k >= 0)
                        for (int i : At[static_cast<size_t>(k)])
                            if (std::fabs(Nodes[static_cast<size_t>(i)].Y - height) <= StepUp + 1e-6) { next = i; break; }
                }
                if (next < 0) return false;
                if (next == prev) continue;
                // Straight on, or round a corner through a cell both sides of it reach.
                const std::vector<int>& from = Links[static_cast<size_t>(prev)];
                if (!Has(from, next))
                {
                    bool round = false;
                    for (int m : from)
                        if (Has(Links[static_cast<size_t>(m)], next)) { round = true; break; }
                    if (!round) return false;
                }
                prev = next;
            }
            return true;
        }

        /** The way from one place to another: the points to walk through, ending at the goal; empty when there is no way there. */
        std::vector<NavPoint> FindPath(const NavPoint& from, const NavPoint& to) const
        {
            const int start = Nearest(from), goal = Nearest(to);
            if (start < 0 || goal < 0) return {};
            if (start == goal) return {to};
            const NavPoint& g = Nodes[static_cast<size_t>(goal)];
            auto h = [this, &g](int i) { const NavPoint& n = Nodes[static_cast<size_t>(i)]; return Flat(n, g) + std::fabs(n.Y - g.Y); };
            std::vector<double> cost(Nodes.size(), std::numeric_limits<double>::infinity());
            std::vector<int> came(Nodes.size(), -1);
            std::vector<char> done(Nodes.size(), 0);
            cost[static_cast<size_t>(start)] = 0;
            // A small binary heap of (f, node), as the studio's.
            std::vector<std::pair<double, int>> heap;
            Push(heap, h(start), start);
            while (!heap.empty())
            {
                const int n = Pop(heap).second;
                if (n == goal) break;
                if (done[static_cast<size_t>(n)]) continue;
                done[static_cast<size_t>(n)] = 1;
                const NavPoint& here = Nodes[static_cast<size_t>(n)];
                for (int m : Links[static_cast<size_t>(n)])
                {
                    const NavPoint& there = Nodes[static_cast<size_t>(m)];
                    const double c = cost[static_cast<size_t>(n)] + Flat(here, there) + std::fabs(there.Y - here.Y);
                    if (c < cost[static_cast<size_t>(m)])
                    {
                        cost[static_cast<size_t>(m)] = c;
                        came[static_cast<size_t>(m)] = n;
                        Push(heap, c + h(m), m);
                    }
                }
            }
            if (came[static_cast<size_t>(goal)] < 0) return {};
            std::vector<int> chain{goal};
            while (chain.back() != start) chain.push_back(came[static_cast<size_t>(chain.back())]);
            std::reverse(chain.begin(), chain.end());
            // Pull it straight: from each point, on to the farthest point of the chain it can see.
            std::vector<NavPoint> out;
            size_t i = 0;
            while (i + 1 < chain.size())
            {
                size_t j = chain.size() - 1;
                while (j > i + 1 && !ClearLine(chain[i], chain[j])) j--;
                out.push_back(Nodes[static_cast<size_t>(chain[j])]);
                i = j;
            }
            // End at the goal itself when it is near its node (the node is the cell's middle).
            if (Flat(to, g) <= Cell && std::fabs(to.Y - g.Y) <= StepUp + 0.1) out.back() = to;
            return out;
        }

        /**
         * The next point to head for on the way from one place to another, keeping the way in
         * way (the caller keeps it): planned when there is none or the target moved, its points
         * dropped as they are reached. False: there is no way there. On the last leg, next is
         * to itself.
         */
        bool NextOnWay(NavWay& way, const NavPoint& from, const NavPoint& to, NavPoint& next) const
        {
            if (!way.Planned || Flat(way.Aim, to) > Replan || std::fabs(way.Aim.Y - to.Y) > 1)
            {
                way.Route = FindPath(from, to);
                way.Aim = to;
                way.None = way.Route.empty();
                way.Planned = true;
            }
            if (way.None) return false;
            while (way.Route.size() > 1 && Flat(way.Route.front(), from) < 0.05) way.Route.erase(way.Route.begin());
            next = way.Route.size() > 1 ? way.Route.front() : to;
            return true;
        }

    private:
        static bool Has(const std::vector<int>& list, int n) { return std::find(list.begin(), list.end(), n) != list.end(); }

        static void Push(std::vector<std::pair<double, int>>& heap, double f, int n)
        {
            heap.emplace_back(f, n);
            size_t i = heap.size() - 1;
            while (i > 0)
            {
                const size_t up = (i - 1) >> 1;
                if (heap[up].first <= heap[i].first) break;
                std::swap(heap[up], heap[i]);
                i = up;
            }
        }

        static std::pair<double, int> Pop(std::vector<std::pair<double, int>>& heap)
        {
            const std::pair<double, int> top = heap.front();
            const std::pair<double, int> last = heap.back();
            heap.pop_back();
            if (!heap.empty())
            {
                heap[0] = last;
                size_t i = 0;
                for (;;)
                {
                    const size_t l = i * 2 + 1, r = l + 1;
                    size_t m = i;
                    if (l < heap.size() && heap[l].first < heap[m].first) m = l;
                    if (r < heap.size() && heap[r].first < heap[m].first) m = r;
                    if (m == i) break;
                    std::swap(heap[m], heap[i]);
                    i = m;
                }
            }
            return top;
        }
    };

    /**
     * A level's graph where it lies in the world (Unreal's centimetres, X north, Y east, Z up,
     * through its map's origin and turn, as AVcgsLevelDirector places it): the director puts
     * its level's here while it plays, and a character finds the one it stands on. World is
     * the UWorld it plays in, so a play-in-editor world finds only its own.
     */
    struct NavPlace
    {
        const void* World = nullptr;
        std::shared_ptr<const NavGraph> Graph;
        double OriginX = 0, OriginY = 0, OriginZ = 0, Yaw = 0;

        /** A point of the world (cm) in the level's space (metres), as the director's FromWorld. */
        NavPoint ToLevel(double wx, double wy, double wz) const
        {
            const double yaw = Yaw * 3.14159265358979323846 / 180.0;
            const double dx = wx - OriginX, dy = wy - OriginY;
            const double lx = dx * std::cos(yaw) + dy * std::sin(yaw), ly = -dx * std::sin(yaw) + dy * std::cos(yaw);
            return NavPoint{ly / 100.0, (wz - OriginZ) / 100.0, -lx / 100.0};
        }

        /** And back, as the director's ToWorld. */
        void ToWorld(const NavPoint& p, double& wx, double& wy, double& wz) const
        {
            const double yaw = Yaw * 3.14159265358979323846 / 180.0;
            const double lx = -p.Z * 100.0, ly = p.X * 100.0;
            wx = OriginX + lx * std::cos(yaw) - ly * std::sin(yaw);
            wy = OriginY + lx * std::sin(yaw) + ly * std::cos(yaw);
            wz = OriginZ + p.Y * 100.0;
        }
    };

    /** The levels playing now, with their graphs. */
    inline std::vector<NavPlace>& NavPlaces()
    {
        static std::vector<NavPlace> places;
        return places;
    }

    /** The playing level whose ground is nearest a point of the world (cm), within two cells; null for none. */
    inline const NavPlace* NavPlaceAt(const void* world, double wx, double wy, double wz)
    {
        const NavPlace* best = nullptr;
        double score = std::numeric_limits<double>::infinity();
        for (const NavPlace& place : NavPlaces())
        {
            if (place.World != world || !place.Graph) continue;
            const NavPoint p = place.ToLevel(wx, wy, wz);
            const int n = place.Graph->Nearest(p, 2);
            if (n < 0) continue;
            const NavPoint& at = place.Graph->Nodes[static_cast<size_t>(n)];
            const double s = NavGraph::Flat(at, p) + std::fabs(at.Y - p.Y) * 3;
            if (s < score) { score = s; best = &place; }
        }
        return best;
    }
}
`;

/** The plugin's navigation header: with the level runtime, and with the cast's when there are no levels. */
export const NAV_PLUGIN_FILES: Record<string, string> = {
  'Source/VCGS/Public/VcgsNav.h': NAV_H,
};
