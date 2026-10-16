/**
 * VcgsNav for Unity (spec §19 navmesh): a level's navigation graph from the
 * handoff (IrNav, the level data's "nav") and the way across it, the same
 * rules as the studio's `findPath` and `nextOnWay` (and Godot's VCGSNav), so a
 * patrol walks the same way in both. Plain C#, in the level's space as the
 * data has it (x east, y up, z south): LevelLogic walks it as it is, and a
 * character turns Unity's +Z (north) round to the data's south first.
 */

const HEAD = '// VCGS Runtime for Unity. The same for every project; safe to commit.';

export const NAV_RUNTIME = String.raw`${HEAD}
using System;
using System.Collections.Generic;

namespace VCGS
{
    /// <summary>
    /// Something with a navigation graph that the people inside it walk (VcgsLevel): a
    /// character finds it among its parents and steers round walls on it.
    /// </summary>
    public interface IVcgsNavHost
    {
        /// <summary>The graph, in the host's level space (x east, y up, z south); null for none.</summary>
        VcgsNav Nav { get; }
    }

    /// <summary>
    /// A level's navigation graph (spec §19 navmesh): standable cells on a grid and which
    /// reach which, and the way across it: A* over the cells, pulled straight wherever the
    /// line between two points of it is clear. Points are {x, y, z} in the level's space
    /// (x east, y up, z south). The same rules as the studio's Play Mode, so people walk
    /// round walls the same way there and here. Doors count as open.
    /// </summary>
    public sealed class VcgsNav
    {
        /// <summary>A way is planned again once its target has moved this far from where it was planned to.</summary>
        public const double Replan = 1;

        /// <summary>A way being walked, kept by whoever walks it: the points left to go through, the target it was planned to, and whether there was no way there.</summary>
        public sealed class Way
        {
            public List<double[]> Route = new List<double[]>();
            public double[] Aim;
            public bool None;
        }

        public double Cell = 0.5;
        public double OriginX, OriginZ;
        public int Cols, Rows;
        public double StepUp = 0.42;
        public readonly List<double[]> Nodes = new List<double[]>();
        public readonly List<List<int>> Links = new List<List<int>>();
        /// <summary>Grid cell (row * Cols + col) to the nodes standing in it.</summary>
        readonly Dictionary<int, List<int>> at = new Dictionary<int, List<int>>();
        /// <summary>What a metre on each node counts for (Cost nav areas); empty when it is all ordinary ground (1).</summary>
        public readonly List<double> Costs = new List<double>();
        public double CostOf(int i) => i < Costs.Count ? Costs[i] : 1;
        static readonly List<int> NoNodes = new List<int>();

        /// <summary>The graph from a level's nav data (the level data's "nav"); null for none.</summary>
        public static VcgsNav FromData(Dictionary<string, object> data)
        {
            if (data == null || data.Count == 0) return null;
            var g = new VcgsNav
            {
                Cell = D.Num(data, "cell", 0.5),
                Cols = (int)D.Num(data, "cols", 0),
                Rows = (int)D.Num(data, "rows", 0),
                StepUp = D.Num(data, "step_up", 0.42),
            };
            var o = D.List(data, "origin");
            g.OriginX = D.Num(o.Count > 1 ? o[0] : null, 0);
            g.OriginZ = D.Num(o.Count > 1 ? o[1] : null, 0);
            var flat = D.List(data, "nodes");
            for (var i = 0; i < flat.Count - 2; i += 3)
            {
                var n = new[] { D.Num(flat[i], 0), D.Num(flat[i + 1], 0), D.Num(flat[i + 2], 0) };
                var k = g.CellOf(n[0], n[2]);
                if (!g.at.TryGetValue(k, out var here)) g.at[k] = here = new List<int>();
                here.Add(g.Nodes.Count);
                g.Nodes.Add(n);
            }
            foreach (var l in D.List(data, "links")) g.Links.Add(D.List(l).ConvertAll(m => (int)D.Num(m, 0)));
            foreach (var c in D.List(data, "costs")) g.Costs.Add(D.Num(c, 1));
            return g;
        }

        public int CellOf(double x, double z)
        {
            var c = (int)Math.Floor((x - OriginX) / Cell);
            var r = (int)Math.Floor((z - OriginZ) / Cell);
            return c < 0 || r < 0 || c >= Cols || r >= Rows ? -1 : r * Cols + c;
        }

        List<int> In(int cell) => at.TryGetValue(cell, out var here) ? here : NoNodes;

        /// <summary>How far apart two points are on the plan (x, z).</summary>
        public static double Flat(double[] a, double[] b) => Math.Sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[2] - a[2]) * (b[2] - a[2]));

        /// <summary>Whether a way was planned to somewhere else than to: its target moved more than Replan, or a floor.</summary>
        public static bool Moved(Way way, double[] to) => way.Aim == null || Flat(way.Aim, to) > Replan || Math.Abs(way.Aim[1] - to[1]) > 1;

        /// <summary>
        /// The node nearest a point: in its cell (the closest height), else the nearest in a few
        /// cells round it; -1 for none. Height counts three times the plan: the floor you are on.
        /// </summary>
        public int Nearest(double[] p, int reach = 4)
        {
            var c0 = (int)Math.Floor((p[0] - OriginX) / Cell);
            var r0 = (int)Math.Floor((p[2] - OriginZ) / Cell);
            var best = -1;
            var score = double.PositiveInfinity;
            for (var ring = 0; ring <= reach && best < 0; ring++)
                for (var r = r0 - ring; r <= r0 + ring; r++)
                    for (var c = c0 - ring; c <= c0 + ring; c++)
                    {
                        if (Math.Max(Math.Abs(r - r0), Math.Abs(c - c0)) != ring || r < 0 || c < 0 || r >= Rows || c >= Cols) continue;
                        foreach (var i in In(r * Cols + c))
                        {
                            var n = Nodes[i];
                            var s = Flat(n, p) + Math.Abs(n[1] - p[1]) * 3;
                            if (s < score) { score = s; best = i; }
                        }
                    }
            return best;
        }

        /// <summary>Whether someone can walk straight from node a to node b: every half cell along the line stands on a node near the height there, each leading to the next.</summary>
        public bool ClearLine(int a, int b)
        {
            var p = Nodes[a];
            var q = Nodes[b];
            var steps = Math.Max(1, (int)Math.Ceiling(Flat(p, q) / (Cell * 0.5)));
            var prev = a;
            // Not straight across ground dearer than either end (a Cost nav area): round it, or through it as A* chose.
            var cap = Math.Max(CostOf(a), CostOf(b)) + 1e-9;
            for (var s = 1; s <= steps; s++)
            {
                var t = (double)s / steps;
                var x = p[0] + (q[0] - p[0]) * t;
                var z = p[2] + (q[2] - p[2]) * t;
                var height = Nodes[prev][1];
                var next = -1;
                if (s == steps) next = b;
                else
                    foreach (var i in In(CellOf(x, z)))
                        if (Math.Abs(Nodes[i][1] - height) <= StepUp + 1e-6) { next = i; break; }
                if (next < 0 || CostOf(next) > cap) return false;
                if (next == prev) continue;
                // Straight on, or round a corner through a cell both sides of it reach.
                var from = Links[prev];
                if (!from.Contains(next) && !from.Exists(m => Links[m].Contains(next))) return false;
                prev = next;
            }
            return true;
        }

        static void Push(List<(double f, int n)> heap, double f, int n)
        {
            heap.Add((f, n));
            var i = heap.Count - 1;
            while (i > 0)
            {
                var up = (i - 1) >> 1;
                if (heap[up].f <= heap[i].f) break;
                (heap[up], heap[i]) = (heap[i], heap[up]);
                i = up;
            }
        }

        static int Pop(List<(double f, int n)> heap)
        {
            var top = heap[0];
            var last = heap[heap.Count - 1];
            heap.RemoveAt(heap.Count - 1);
            if (heap.Count > 0)
            {
                heap[0] = last;
                var i = 0;
                while (true)
                {
                    var l = i * 2 + 1;
                    var r = l + 1;
                    var m = i;
                    if (l < heap.Count && heap[l].f < heap[m].f) m = l;
                    if (r < heap.Count && heap[r].f < heap[m].f) m = r;
                    if (m == i) break;
                    (heap[m], heap[i]) = (heap[i], heap[m]);
                    i = m;
                }
            }
            return top.n;
        }

        /// <summary>The way from one place to another: the points to walk through, ending at the goal; empty when there is no way there.</summary>
        public List<double[]> FindPath(double[] from, double[] to)
        {
            var start = Nearest(from);
            var goal = Nearest(to);
            if (start < 0 || goal < 0) return new List<double[]>();
            if (start == goal) return new List<double[]> { to };
            var g = Nodes[goal];
            var cost = new Dictionary<int, double> { [start] = 0 };
            var came = new Dictionary<int, int>();
            var heap = new List<(double f, int n)>();
            Push(heap, Flat(Nodes[start], g) + Math.Abs(Nodes[start][1] - g[1]), start);
            var done = new HashSet<int>();
            while (heap.Count > 0)
            {
                var n = Pop(heap);
                if (n == goal) break;
                if (!done.Add(n)) continue;
                var here = Nodes[n];
                foreach (var m in Links[n])
                {
                    var there = Nodes[m];
                    // A step counts its length at the mean cost of the ground either side.
                    var c = cost[n] + (Flat(here, there) + Math.Abs(there[1] - here[1])) * (CostOf(n) + CostOf(m)) / 2;
                    if (c < (cost.TryGetValue(m, out var was) ? was : double.PositiveInfinity))
                    {
                        cost[m] = c;
                        came[m] = n;
                        Push(heap, c + Flat(there, g) + Math.Abs(there[1] - g[1]), m);
                    }
                }
            }
            if (!came.ContainsKey(goal)) return new List<double[]>();
            var chain = new List<int> { goal };
            while (chain[0] != start) chain.Insert(0, came[chain[0]]);
            // Pull it straight: from each point, on to the farthest point of the chain it can see.
            var way = new List<double[]>();
            for (var i = 0; i < chain.Count - 1;)
            {
                var j = chain.Count - 1;
                while (j > i + 1 && !ClearLine(chain[i], chain[j])) j--;
                way.Add(Nodes[chain[j]]);
                i = j;
            }
            // End at the goal itself when it is near its node (the node is the cell's middle).
            if (Flat(to, g) <= Cell && Math.Abs(to[1] - g[1]) <= StepUp + 0.1) way[way.Count - 1] = to;
            return way;
        }

        /// <summary>
        /// The next point to head for on the way from one place to another, keeping the way in
        /// way (the caller keeps it): planned when there is none or the target moved, its points
        /// dropped as they are reached. to itself on the last leg; null: there is no way there.
        /// </summary>
        public double[] NextOnWay(Way way, double[] from, double[] to)
        {
            if (Moved(way, to))
            {
                var path = FindPath(from, to);
                way.Route = path;
                way.Aim = to;
                way.None = path.Count == 0;
            }
            if (way.None) return null;
            var route = way.Route;
            while (route.Count > 1 && Flat(route[0], from) < 0.05) route.RemoveAt(0);
            return route.Count > 1 ? route[0] : to;
        }
    }
}
`;
