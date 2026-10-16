// The Character Creator's cast in Unity (character spec §10, §14): the same
// walk as the Godot cast check. characters.json is the schema the studio
// writes; VcgsCast's AI machine plays the studio's own scenarios
// (cast_expect.json) transition for transition, reason for reason; inventory,
// abilities and the spawn group work; every component loads.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using VCGS;

static class CastCheck
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static List<double[]> Points(object o) => D.List(o).ConvertAll(p => new[] { D.Num(D.List(p)[0], 0), D.Num(D.List(p)[1], 0) });

    static int Main()
    {
        var cast = VcgsCast.Load(File.ReadAllText("Assets/VCGS/Generated/characters.json"));
        if (D.Num(cast, "version") != 1) Fail("characters.json should be vcgs-characters v1");
        var orc = VcgsCast.Character(cast, "orc_sentry");
        if (orc == null || !(D.Get(orc, "ai") is Dictionary<string, object>))
        {
            Fail("Orc Sentry should be in characters.json with an AI profile");
            return 1;
        }
        // The studio's scenarios, step for step.
        var expect = D.Map(Json.Parse(File.ReadAllText("cast_expect.json")));
        foreach (var o in D.List(expect, "scenarios"))
        {
            var sc = D.Map(o);
            var ai = D.Map(VcgsCast.Character(cast, D.Str(sc, "character")), "ai");
            var patrol = Points(D.Get(sc, "patrol"));
            var walls = D.List(sc, "walls").ConvertAll(w => Points(w).ToArray());
            var m = VcgsCast.StartMemory(ai, patrol, D.Num(sc, "health"));
            var t = D.Map(sc, "target");
            var trail = new List<string>();
            for (var i = 0; i < (int)D.Num(sc, "steps"); i++)
            {
                var target = new VcgsCast.Target { X = D.Num(t, "x") + D.Num(t, "vx") * i, Y = D.Num(t, "y") + D.Num(t, "vy") * i, Noisy = D.Bool(t, "noisy") };
                var r = VcgsCast.AiStep(ai, D.Num(sc, "speed"), m, target, patrol, walls, D.Num(sc, "dt"));
                m = r.Memory;
                if (r.Reason != "") trail.Add(r.Reason);
            }
            var want = D.List(sc, "trail").ConvertAll(x => (string)x);
            if (string.Join("\n", want) != string.Join("\n", trail))
                Fail(D.Str(sc, "name") + ": the trail differs.\n  studio: " + string.Join(" | ", want) + "\n  unity:  " + string.Join(" | ", trail));
            var fin = D.Map(sc, "final");
            if (m.State != D.Str(fin, "state") || m.Attacks != (int)D.Num(fin, "attacks") || Math.Abs(m.X - D.Num(fin, "x")) > 0.01 || Math.Abs(m.Y - D.Num(fin, "y")) > 0.01)
                Fail(D.Str(sc, "name") + ": ends " + m.State + "/" + m.Attacks + " at (" + m.X + ", " + m.Y + "), the studio " + D.Str(fin, "state") + "/" + D.Num(fin, "attacks") + " at (" + D.Num(fin, "x") + ", " + D.Num(fin, "y") + ")");
            Console.WriteLine("ai: " + D.Str(sc, "name") + " · " + trail.Count + " transitions · ends " + m.State);
        }
        // A variant is the whole character: its own name and stats where it differs.
        foreach (var vo in D.List(orc, "variants"))
        {
            var v = D.Map(vo);
            var whole = VcgsCast.Character(cast, "orc_sentry", D.Str(v, "key"));
            if (D.Str(whole, "name") != D.Str(v, "name") || D.Num(D.Map(whole, "stats"), "health") != D.Num(D.Map(v, "stats"), "health")) Fail("variant " + D.Str(v, "key") + " should be resolved as a whole");
        }
        if (D.List(orc, "variants").Count != 2) Fail("the Orc Sentry should have 2 variants");
        // Inventory capacity and overflow.
        var inv = new Dictionary<string, object> { ["mode"] = "stack", ["slots"] = 2.0, ["stack"] = 10.0, ["weight"] = 0.0 };
        var flares = new Dictionary<string, int> { ["flare"] = 15 };
        if (VcgsCast.Fits(inv, flares, "flare", 5) != "") Fail("20 flares in stacks of 10 should fit 2 slots");
        if (VcgsCast.Fits(inv, flares, "flare", 6) == "") Fail("21 flares should not fit 2 slots of 10");
        var bag = new Dictionary<string, object> { ["mode"] = "weight", ["slots"] = 0.0, ["stack"] = 1.0, ["weight"] = 5.0 };
        if (VcgsCast.Fits(bag, new Dictionary<string, int>(), "anvil", 1, new Dictionary<string, double> { ["anvil"] = 40 }) != "Too heavy: 40 of 5 kg.") Fail("an anvil should be too heavy");
        // Abilities: cost and cooldown.
        var fireball = new Dictionary<string, object> { ["key"] = "fireball", ["name"] = "Fireball", ["enabled"] = true, ["kind"] = "active", ["cost"] = new Dictionary<string, object> { ["resource"] = "mana", ["amount"] = 15.0 }, ["failure"] = "" };
        if (VcgsCast.CanUse(fireball, new Dictionary<string, double>(), new Dictionary<string, double> { ["mana"] = 10 }, 0) != "Not enough mana.") Fail("a fireball should need mana");
        if (VcgsCast.CanUse(fireball, new Dictionary<string, double> { ["fireball"] = 5 }, new Dictionary<string, double> { ["mana"] = 100 }, 1) != "Fireball is cooling down.") Fail("a fireball should cool down");
        // The way round walls (spec §19 navmesh): the machine heads for the corner steer gives it, and stands with no way.
        var walker = new VcgsCast.Memory();
        if (VcgsCast.Walk(walker, 3, 0, 1, 1, (ax, ay, tx, ty) => ay < 2.999 ? (0.0, 3.0, false) : (tx, ty, true)) || Math.Abs(walker.X) > 0.001 || Math.Abs(walker.Y - 1) > 0.001) Fail("an AI should walk to the corner of its way first, got " + walker.X + ", " + walker.Y);
        var stuck = new VcgsCast.Memory();
        if (VcgsCast.Walk(stuck, 3, 0, 1, 1, (ax, ay, tx, ty) => null) || stuck.X != 0) Fail("an AI with no way there should stand, got " + stuck.X + ", " + stuck.Y);
        // In a level with a graph, an actor steers round its wall: the data's south (z) is Unity's −Z.
        var yard = new GameObject("Yard").AddComponent<NavYard>();
        yard.Nav = Yard(true);
        var guard = new GameObject("Guard").AddComponent<VcgsActor>();
        guard.transform.SetParent(yard.transform, false);
        var corner = guard.Steer(0.5, -0.5, 4.5, -0.5);
        Console.WriteLine("steer: round the wall by " + (corner == null ? "nothing" : corner.Value.x + ", " + corner.Value.y));
        if (corner == null || corner.Value.last || corner.Value.x > 2.5 || corner.Value.y > -3.5) Fail("an actor should steer round the yard's wall through its gap (Unity −Z), got " + corner);
        if (guard.Steer(0.5, -4.5, 4.5, -4.5) != (4.5, -4.5, true)) Fail("on open ground an actor should steer straight there");
        yard.Nav = Yard(false);
        var shut = new GameObject("Shut").AddComponent<VcgsActor>();
        shut.transform.SetParent(yard.transform, false);
        if (shut.Steer(0.5, -0.5, 4.5, -0.5) != null) Fail("with no way through the wall, steer should say so");
        if (new GameObject("Loose").AddComponent<VcgsActor>().Steer(0, 0, 3, 4) != (3, 4, true)) Fail("with no level, an actor should steer straight there");
        // The spawn group: the Village Market's people where the studio put them, each with its components.
        Dictionary<string, object> market = null;
        foreach (var p in VcgsCast.Placements(cast)) if (D.Str(p, "kind") == "group") market = p;
        var spawner = new GameObject("Village Market").AddComponent<VcgsSpawnGroup>();
        spawner.itemGuid = D.Str(market, "item");
        var people = spawner.Spawn(cast);
        // Everyone the studio placed (the count is the group's seeded population for this area).
        var placed = D.List(market, "members").Count;
        if (placed < 1 || people.Count != placed) Fail("Village Market should spawn the " + placed + " placed, got " + people.Count);
        else
        {
            var first = people[0];
            var at = D.List(D.Map(D.List(market, "members")[0]), "position");
            var pos = first.transform.localPosition;
            // In Unity's space, as the level builder puts the level: the studio's z (south) is Unity's -z.
            if (Math.Abs(pos.x - D.Num(at[0], 0)) > 0.01 || Math.Abs(pos.z + D.Num(at[2], 0)) > 0.01) Fail("the first villager should stand where the studio put it, in the level's space (z flipped), got " + pos + " for " + D.Num(at[2], 0));
            var routed = people.Find(a => a.route.Count > 0);
            if (routed != null)
            {
                var plan = D.List(D.Map(D.List(market, "members")[people.IndexOf(routed)]), "route");
                if (Math.Abs(routed.route[0].z + D.Num(D.List(plan[0])[2], 0)) > 0.01) Fail("a patrolling villager's route should be in the level's space too (z flipped)");
            }
            Console.WriteLine("villagers in the level's space; " + (routed != null ? "a route flipped with them" : "none on a route"));
            if (first.Inventory == null || first.Behavior == null || first.Abilities == null || first.Dialogue == null || first.Equipment == null || first.Perception == null) Fail("a spawned character should have all its components");
            if (first.transform.Find("Placeholder") == null) Fail("a character with no final art should show its placeholder");
            foreach (var a in people) a.Behavior.Tick(0.1f);
        }
        // A placed Orc Sentry runs its machine and carries its sword.
        var sentry = new GameObject("Orc").AddComponent<VcgsActor>();
        sentry.characterKey = "orc_sentry";
        sentry.Setup(cast);
        sentry.Behavior.Tick(0.1f);
        if (sentry.Behavior.State != "idle" && sentry.Behavior.State != "patrol") Fail("a placed Orc Sentry should run its machine, got " + sentry.Behavior.State);
        var hand = sentry.transform.Find("HandSocket");
        if (hand == null || hand.Find("sword") == null && hand.Find("Sword") == null) Fail("the Orc Sentry should carry its sword at the hand socket");
        Console.WriteLine("spawned " + people.Count + " villagers; orc " + sentry.Behavior.State);
        if (failures > 0) return 1;
        Console.WriteLine("cast OK");
        return 0;
    }

    /// <summary>A level stand-in that only carries a graph.</summary>
    sealed class NavYard : MonoBehaviour, IVcgsNavHost
    {
        public VcgsNav Nav { get; set; }
    }

    /// <summary>A 5 × 5 m yard of 1 m cells with a wall down x = 2.5: a gap at its south end (data z 4–5) or none.</summary>
    static VcgsNav Yard(bool gap)
    {
        var nodes = new List<object>();
        var index = new Dictionary<int, int>();
        for (var r = 0; r < 5; r++)
            for (var c = 0; c < 5; c++)
            {
                if (c == 2 && (r < 4 || !gap)) continue;
                index[r * 5 + c] = nodes.Count / 3;
                nodes.AddRange(new object[] { c + 0.5, 0.0, r + 0.5 });
            }
        var links = new List<object>();
        for (var r = 0; r < 5; r++)
            for (var c = 0; c < 5; c++)
            {
                if (!index.ContainsKey(r * 5 + c)) continue;
                var reach = new List<object>();
                foreach (var (dr, dc) in new[] { (0, 1), (1, 0), (0, -1), (-1, 0) })
                    if (r + dr >= 0 && r + dr < 5 && c + dc >= 0 && c + dc < 5 && index.TryGetValue((r + dr) * 5 + c + dc, out var k)) reach.Add((double)k);
                links.Add(reach);
            }
        return VcgsNav.FromData(new Dictionary<string, object> { ["cell"] = 1.0, ["origin"] = new List<object> { 0.0, 0.0 }, ["cols"] = 5.0, ["rows"] = 5.0, ["step_up"] = 0.42, ["nodes"] = nodes, ["links"] = links });
    }
}
