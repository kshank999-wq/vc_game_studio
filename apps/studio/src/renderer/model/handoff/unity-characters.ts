/**
 * The Character Creator's runtime for Unity (character spec §10): VcgsCast,
 * the engine-neutral core in plain C# (the AI state machine exactly as the
 * studio's aiStep plays it, senses, inventory capacity, ability cooldowns and
 * costs), and the starter components, one MonoBehaviour per file as Unity
 * needs: VcgsActor (ActorController), VcgsActorPerception, VcgsActorBehavior
 * (BehaviorController), VcgsActorAbilities, VcgsActorInventory,
 * VcgsActorEquipment, VcgsActorDialogue and VcgsSpawnGroup
 * (SpawnGroupController). Positions in the core are on the plan: a
 * transform's (x, z). Movement goes round walls on the level's navigation
 * graph (VcgsNav, from a VcgsLevel among the actor's parents), else in
 * straight lines; NavMesh, Animator and effects are the engine team's (see
 * CHARACTERS.md), the hooks are here.
 */

const HEAD = '// VCGS Runtime for Unity. The same for every project; safe to commit.';

const CORE = String.raw`${HEAD}
using System;
using System.Collections.Generic;
using System.Globalization;

namespace VCGS
{
    /// <summary>
    /// The Character Creator's core: characters.json (schema vcgs-characters v1),
    /// and the AI state machine, senses, inventory and abilities as VC Game
    /// Studio plays them. Plain C#: no UnityEngine, so it runs anywhere.
    /// </summary>
    public static class VcgsCast
    {
        static readonly Dictionary<string, string> Labels = new Dictionary<string, string>
        {
            ["idle"] = "Idle", ["patrol"] = "Patrol", ["alert"] = "Alert", ["investigate"] = "Investigate", ["chase"] = "Chase", ["attack"] = "Attack",
            ["search"] = "Search", ["return"] = "Return", ["stunned"] = "Stunned", ["flee"] = "Flee", ["dead"] = "Dead", ["disabled"] = "Disabled", ["any"] = "Any state",
        };

        static readonly Dictionary<string, string> Timers = new Dictionary<string, string>
        {
            ["investigate"] = "investigate_seconds", ["search"] = "search_seconds", ["stunned"] = "stun_seconds", ["alert"] = "reaction",
        };

        public static string Label(string state) => Labels.TryGetValue(state, out var l) ? l : state;

        /// <summary>A number as the studio writes it: 4, 0.6.</summary>
        public static string NumText(double n) => n == Math.Floor(n) && Math.Abs(n) < 1e15 ? ((long)n).ToString(CultureInfo.InvariantCulture) : n.ToString(CultureInfo.InvariantCulture);

        static string F1(double n) => n.ToString("0.0", CultureInfo.InvariantCulture);

        static int Round(double n) => (int)Math.Floor(n + 0.5);

        /// <summary>characters.json's text, read.</summary>
        public static Dictionary<string, object> Load(string json)
        {
            var root = D.Map(Json.Parse(json));
            if (D.Str(root, "schema") != "vcgs-characters") throw new FormatException("Not a VC Game Studio characters file");
            return root;
        }

        /// <summary>A character, or one of its variants as a whole (stats, abilities, inventory, hit, ai).</summary>
        public static Dictionary<string, object> Character(Dictionary<string, object> cast, string key, string variant = "")
        {
            foreach (var o in D.List(cast, "characters"))
            {
                var c = D.Map(o);
                if (D.Str(c, "key") != key) continue;
                if (string.IsNullOrEmpty(variant)) return c;
                foreach (var vo in D.List(c, "variants"))
                {
                    var v = D.Map(vo);
                    if (D.Str(v, "key") != variant) continue;
                    var whole = new Dictionary<string, object>(c);
                    foreach (var k in new[] { "stats", "abilities", "inventory", "hit", "ai", "name" }) whole[k] = D.Get(v, k);
                    return whole;
                }
                return c;
            }
            return null;
        }

        public static List<Dictionary<string, object>> Placements(Dictionary<string, object> cast, string levelGuid = "")
        {
            var outList = new List<Dictionary<string, object>>();
            foreach (var o in D.List(cast, "placements"))
            {
                var p = D.Map(o);
                if (string.IsNullOrEmpty(levelGuid) || D.Str(p, "level") == levelGuid) outList.Add(p);
            }
            return outList;
        }

        /// <summary>The target as the machine sees it.</summary>
        public sealed class Target
        {
            public double X, Y;
            public bool Noisy;
            public bool Alive = true;
        }

        /// <summary>What a machine remembers between steps.</summary>
        public sealed class Memory
        {
            public string State = "idle";
            public double X, Y, Facing, Timer, SinceSeen = double.PositiveInfinity, Health, MaxHealth, Cooldown;
            public bool HasLastKnown;
            public double LastX, LastY;
            public int PatrolIndex, Attacks;
            public bool Hit;
            public Memory Copy() => (Memory)MemberwiseClone();
        }

        public sealed class Senses
        {
            public bool Sees, Hears, Near;
            public double Distance;
            public string Why = "";
        }

        public sealed class Step
        {
            public Memory Memory;
            public string Reason = "";
            public Senses Senses;
            public bool Attacked;
        }

        /// <summary>Whether something blocks sight from (ax, ay) to (bx, by): the level's solids.</summary>
        public delegate bool Blocked(double ax, double ay, double bx, double by);

        /// <summary>The way round walls from (ax, ay) to (tx, ty) on the plan: the next point to head for, and whether it is the last leg; null when there is no way there.</summary>
        public delegate (double x, double y, bool last)? Steer(double ax, double ay, double tx, double ty);

        public static Memory StartMemory(Dictionary<string, object> ai, List<double[]> patrol, double health, double facing = 0)
        {
            var states = D.List(ai, "states");
            var start = D.Str(ai, "start");
            var state = states.Contains(start) ? start : states.Count > 0 ? (string)states[0] : "idle";
            var post = patrol.Count > 0 ? patrol[0] : new double[] { 0, 0 };
            return new Memory { State = state, X = post[0], Y = post[1], Facing = facing, Health = health, MaxHealth = health };
        }

        static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

        static double Wrap(double r) => Math.Atan2(Math.Sin(r), Math.Cos(r));

        static bool Crosses(double px, double py, double qx, double qy, double[] a, double[] b)
        {
            double d1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
            double d2 = (b[0] - a[0]) * (qy - a[1]) - (b[1] - a[1]) * (qx - a[0]);
            double d3 = (qx - px) * (a[1] - py) - (qy - py) * (a[0] - px);
            double d4 = (qx - px) * (b[1] - py) - (qy - py) * (b[0] - px);
            return d1 * d2 < 0 && d3 * d4 < 0;
        }

        /// <summary>What it senses of the target, and why.</summary>
        public static Senses Sense(Dictionary<string, object> ai, Memory m, Target t, List<double[][]> walls, Blocked blocked)
        {
            var distance = Dist(m.X, m.Y, t.X, t.Y);
            if (!t.Alive) return new Senses { Distance = distance, Why = "No target." };
            var off = Math.Abs(Wrap(Math.Atan2(t.Y - m.Y, t.X - m.X) - m.Facing)) * (180 / Math.PI);
            var cone = D.Num(ai, "vision_angle");
            var inCone = cone >= 360 || off <= cone / 2;
            var isBlocked = false;
            if (D.Bool(ai, "line_of_sight"))
            {
                if (walls != null) foreach (var w in walls) if (Crosses(m.X, m.Y, t.X, t.Y, w[0], w[1])) isBlocked = true;
                if (!isBlocked && blocked != null) isBlocked = blocked(m.X, m.Y, t.X, t.Y);
            }
            var view = D.Num(ai, "view_distance");
            var s = new Senses { Distance = distance, Sees = distance <= view && inCone && !isBlocked, Hears = t.Noisy && distance <= D.Num(ai, "hearing_radius"), Near = distance <= D.Num(ai, "proximity_radius") };
            s.Why = s.Sees ? "Sees it " + F1(distance) + " m away, " + Round(off) + "° off its facing (cone " + NumText(cone) + "°)."
                : distance > view ? "Out of sight range (" + F1(distance) + " m > " + NumText(view) + " m)."
                : !inCone ? "Outside its " + NumText(cone) + "° view (" + Round(off) + "° off its facing)."
                : "A wall blocks its line of sight.";
            if (s.Hears) s.Why += " Hears it.";
            if (s.Near) s.Why += " Close enough to sense.";
            return s;
        }

        /// <summary>Toward a plan point; with steer (the level's way round walls) by that way, standing when there is none. True when there.</summary>
        public static bool Walk(Memory m, double tx, double ty, double pace, double dt, Steer steer = null)
        {
            var d = Dist(m.X, m.Y, tx, ty);
            if (d < 0.01) return true;
            double vx = tx, vy = ty;
            var last = true;
            if (steer != null)
            {
                var via = steer(m.X, m.Y, tx, ty);
                if (via == null) return false;
                (vx, vy, last) = via.Value;
                d = Dist(m.X, m.Y, vx, vy);
                if (d < 1e-6) return false;
            }
            var turn = Math.Atan2(vy - m.Y, vx - m.X);
            m.Facing = turn;
            var step = Math.Min(d, pace * dt);
            m.X += Math.Cos(turn) * step;
            m.Y += Math.Sin(turn) * step;
            return last && step >= d;
        }

        /// <summary>
        /// One step of the machine: sense, take the first enabled transition from
        /// this state (or any) whose trigger holds, then move. Alert holds for its
        /// reaction time first. The same rules as the studio's aiStep; with steer, it walks
        /// the way round walls (the studio's world.steer).
        /// </summary>
        public static Step AiStep(Dictionary<string, object> ai, double speed, Memory m0, Target target, List<double[]> patrol, List<double[][]> walls, double dt, Blocked blocked = null, Steer steer = null)
        {
            var m = m0.Copy();
            m.Timer = m0.Timer + dt;
            m.Cooldown = Math.Max(0, m0.Cooldown - dt);
            m.Hit = false;
            var s = Sense(ai, m, target, walls, blocked);
            var noticed = s.Sees || s.Near;
            m.SinceSeen = noticed ? 0 : m0.SinceSeen + dt;
            if (noticed || s.Hears) { m.HasLastKnown = true; m.LastX = target.X; m.LastY = target.Y; }
            var post = patrol.Count > 0 ? patrol[0] : new double[] { 0, 0 };
            var fromPost = Dist(m.X, m.Y, post[0], post[1]);
            Timers.TryGetValue(m.State, out var timerKey);
            var timerDone = timerKey != null && m.Timer >= D.Num(ai, timerKey);
            var reason = "";
            var on = D.List(ai, "states");
            var held = m.State == "alert" && !timerDone;
            if (m.State != "dead" && m.State != "disabled")
            {
                foreach (var o in D.List(ai, "transitions"))
                {
                    var tr = D.Map(o);
                    var to = D.Str(tr, "to");
                    var from = D.Str(tr, "from");
                    if (!D.Bool(tr, "enabled") || !on.Contains(to) || to == m.State) continue;
                    if (from != m.State && from != "any") continue;
                    if (held && from != "any") continue;
                    var why = Holds(ai, tr, m, m0, s, noticed, fromPost, timerKey, timerDone);
                    if (why == "") continue;
                    reason = Label(m.State) + " → " + Label(to) + ": " + why;
                    m.State = to;
                    m.Timer = 0;
                    break;
                }
            }
            var chaseSpeed = speed * (0.7 + 0.6 * (D.Num(D.Map(ai, "skill"), "pursuit", 50) / 100));
            var attacked = false;
            switch (m.State)
            {
                case "patrol":
                {
                    var stops = patrol.Count > 0 ? patrol : new List<double[]> { post };
                    var goal = stops[m.PatrolIndex % stops.Count];
                    if (Walk(m, goal[0], goal[1], speed * 0.45, dt, steer)) m.PatrolIndex = (m.PatrolIndex + 1) % stops.Count;
                    break;
                }
                case "alert":
                    if (m.HasLastKnown) m.Facing = Math.Atan2(m.LastY - m.Y, m.LastX - m.X);
                    break;
                case "investigate":
                    if (m.HasLastKnown) Walk(m, m.LastX, m.LastY, speed * 0.6, dt, steer);
                    break;
                case "chase":
                    if (noticed || !m.HasLastKnown) Walk(m, target.X, target.Y, chaseSpeed, dt, steer);
                    else Walk(m, m.LastX, m.LastY, chaseSpeed, dt, steer);
                    break;
                case "attack":
                    m.Facing = Math.Atan2(target.Y - m.Y, target.X - m.X);
                    if (m.Cooldown <= 0 && s.Distance <= D.Num(ai, "attack_range"))
                    {
                        m.Cooldown = D.Num(ai, "attack_cooldown");
                        m.Attacks++;
                        attacked = true;
                    }
                    break;
                case "search":
                {
                    var cx = m.HasLastKnown ? m.LastX : m.X;
                    var cy = m.HasLastKnown ? m.LastY : m.Y;
                    var a = m.Timer * 1.2;
                    Walk(m, cx + Math.Cos(a) * 2, cy + Math.Sin(a) * 2, speed * 0.5, dt, steer);
                    break;
                }
                case "return":
                    if (D.Bool(ai, "reset_to_post")) Walk(m, post[0], post[1], speed * 0.6, dt, steer);
                    else m.State = "idle";
                    break;
                case "flee":
                {
                    var away = Math.Atan2(m.Y - target.Y, m.X - target.X);
                    Walk(m, m.X + Math.Cos(away) * 5, m.Y + Math.Sin(away) * 5, speed, dt, steer);
                    break;
                }
            }
            return new Step { Memory = m, Reason = reason, Senses = s, Attacked = attacked };
        }

        static string Holds(Dictionary<string, object> ai, Dictionary<string, object> tr, Memory m, Memory m0, Senses s, bool noticed, double fromPost, string timerKey, bool timerDone)
        {
            switch (D.Str(tr, "when"))
            {
                case "always": return "At once.";
                case "seesTarget": return s.Sees ? s.Why : "";
                case "hearsTarget": return s.Hears ? "Hears it " + F1(s.Distance) + " m away (hearing " + NumText(D.Num(ai, "hearing_radius")) + " m)." : "";
                case "inProximity": return s.Near ? "It is " + F1(s.Distance) + " m away, inside its " + NumText(D.Num(ai, "proximity_radius")) + " m proximity radius." : "";
                case "inAttackRange": return noticed && s.Distance <= D.Num(ai, "attack_range") ? "In attack range (" + F1(s.Distance) + " m ≤ " + NumText(D.Num(ai, "attack_range")) + " m)." : "";
                case "outOfAttackRange": return s.Distance > D.Num(ai, "attack_range") * 1.25 ? "Out of attack range (" + F1(s.Distance) + " m)." : "";
                case "lostTarget": return !noticed ? "Lost it: " + s.Why : "";
                case "chaseTimeout": return m.SinceSeen >= D.Num(ai, "chase_timeout") ? "Hasn’t seen it for " + NumText(D.Num(ai, "chase_timeout")) + " s (chase timeout)." : "";
                case "tooFarFromPost": return fromPost > D.Num(ai, "disengage_distance") ? F1(fromPost) + " m from its post, past its " + NumText(D.Num(ai, "disengage_distance")) + " m disengage distance." : "";
                case "timerDone": return timerDone ? "Its " + (timerKey == "reaction" ? "reaction" : timerKey.Replace("_seconds", "")) + " time (" + NumText(D.Num(ai, timerKey)) + " s) is up." : "";
                case "reachedPost": return fromPost < 0.5 ? "Back at its post." : "";
                case "healthBelow":
                {
                    var share = m.Health / Math.Max(0.0001, m.MaxHealth);
                    var value = D.Num(tr, "value");
                    return share < value / 100 && m.Health > 0 ? "Health " + Round(share * 100) + "%, below " + NumText(value) + "%." : "";
                }
                case "hit": return m0.Hit ? "It was hit." : "";
                case "killed": return m.Health <= 0 ? "Out of health." : "";
            }
            return "";
        }

        // ------------------------------------------------------------ inventory

        /// <summary>Whether qty more of an item fit: "" when they do, else why not.</summary>
        public static string Fits(Dictionary<string, object> inv, Dictionary<string, int> items, string item, int qty, Dictionary<string, double> weights = null, HashSet<string> single = null)
        {
            var mode = D.Str(inv, "mode");
            if (mode == "unlimited") return "";
            var after = new Dictionary<string, int>(items);
            after[item] = (after.TryGetValue(item, out var n) ? n : 0) + qty;
            var slots = 0;
            var weight = 0.0;
            foreach (var kv in after)
            {
                if (mode == "slots" || (single != null && single.Contains(kv.Key))) slots += kv.Value;
                else slots += (int)Math.Ceiling(kv.Value / Math.Max(1, D.Num(inv, "stack")));
                weight += (weights != null && weights.TryGetValue(kv.Key, out var w) ? w : 0) * kv.Value;
            }
            if ((mode == "slots" || mode == "stack" || mode == "hybrid") && slots > D.Num(inv, "slots")) return "No room: " + slots + " of " + NumText(D.Num(inv, "slots")) + " slots.";
            if ((mode == "weight" || mode == "hybrid") && weight > D.Num(inv, "weight")) return "Too heavy: " + NumText(weight) + " of " + NumText(D.Num(inv, "weight")) + " kg.";
            return "";
        }

        // ------------------------------------------------------------ abilities

        /// <summary>Whether an ability can be used now: "" when it can, else why not (its failure behaviour).</summary>
        public static string CanUse(Dictionary<string, object> ability, Dictionary<string, double> cooldowns, Dictionary<string, double> resource, double now)
        {
            var name = D.Str(ability, "name");
            if (D.Get(ability, "enabled") is bool e && !e) return name + " is off.";
            if (D.Str(ability, "kind") == "passive") return name + " is passive.";
            if (cooldowns.TryGetValue(D.Str(ability, "key"), out var until) && now < until) return name + " is cooling down.";
            var cost = D.Map(ability, "cost");
            var kind = D.Str(cost, "resource");
            if (kind != "none" && kind != "" && (resource.TryGetValue(kind, out var have) ? have : 0) < D.Num(cost, "amount"))
                return D.Str(ability, "failure") != "" ? D.Str(ability, "failure") : "Not enough " + kind + ".";
            return "";
        }
    }
}
`;

const actor = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// ActorController: a character from characters.json, as its placeholder (or
    /// its bound final model, which you parent under it), with its components.
    /// Give it characters.json and a character key; call Setup (Start does).
    /// </summary>
    public sealed class VcgsActor : MonoBehaviour
    {
        public TextAsset charactersJson;
        public string characterKey = "";
        public string variantKey = "";
        /// <summary>What it does when it has no AI: wander, idle, talk, work, patrol, guard.</summary>
        public string activity = "guard";
        public List<Vector3> route = new List<Vector3>();
        public float wanderRadius;

        public Dictionary<string, object> Data { get; private set; }
        public float Health { get; set; }
        public VcgsActorPerception Perception { get; private set; }
        public VcgsActorBehavior Behavior { get; private set; }
        public VcgsActorAbilities Abilities { get; private set; }
        public VcgsActorInventory Inventory { get; private set; }
        public VcgsActorEquipment Equipment { get; private set; }
        public VcgsActorDialogue Dialogue { get; private set; }

        /// <summary>Things that happen, by name (cues, attacks, state changes): hook animation, VFX and SFX here.</summary>
        public event System.Action<string, Dictionary<string, object>> Happened;

        void Start()
        {
            if (Data == null && charactersJson != null) Setup(VcgsCast.Load(charactersJson.text));
        }

        public void Setup(Dictionary<string, object> cast)
        {
            Data = VcgsCast.Character(cast, characterKey, variantKey);
            if (Data == null)
            {
                Debug.LogError("VCGS: no character " + characterKey + " in characters.json.");
                return;
            }
            Health = (float)D.Num(D.Map(Data, "stats"), "health", 100);
            if (D.Str(D.Map(Data, "binding"), "final_model") == "") BuildPlaceholder();
            Perception = gameObject.AddComponent<VcgsActorPerception>();
            Behavior = gameObject.AddComponent<VcgsActorBehavior>();
            Abilities = gameObject.AddComponent<VcgsActorAbilities>();
            Inventory = gameObject.AddComponent<VcgsActorInventory>();
            Equipment = gameObject.AddComponent<VcgsActorEquipment>();
            Dialogue = gameObject.AddComponent<VcgsActorDialogue>();
            Perception.Setup(this);
            Behavior.Setup(this);
            Abilities.Setup(this);
            Inventory.Setup(this);
            Equipment.Setup(this);
            Dialogue.Setup(this);
        }

        /// <summary>The placeholder: a capsule in its tint, with a hand socket for its prop.</summary>
        void BuildPlaceholder()
        {
            var stats = D.Map(Data, "stats");
            var ph = D.Map(Data, "placeholder");
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.name = "Placeholder";
            body.transform.SetParent(transform, false);
            var height = (float)D.Num(stats, "height", 1.75) * (float)D.Num(ph, "scale", 1);
            body.transform.localPosition = new Vector3(0, height / 2, 0);
            body.transform.localScale = new Vector3((float)D.Num(stats, "radius", 0.35) * 2, height / 2, (float)D.Num(stats, "radius", 0.35) * 2);
            if (D.Str(ph, "prop") != "none" && D.Str(ph, "prop") != "")
            {
                var socket = new GameObject("HandSocket");
                socket.transform.SetParent(transform, false);
                socket.transform.localPosition = new Vector3((float)D.Num(stats, "radius", 0.35) + 0.1f, height * 0.5f, 0);
                var prop = GameObject.CreatePrimitive(PrimitiveType.Cube);
                prop.name = D.Str(ph, "prop");
                prop.transform.SetParent(socket.transform, false);
            }
        }

        public void Send(string what, Dictionary<string, object> detail = null) => Happened?.Invoke(what, detail ?? new Dictionary<string, object>());

        public void Hurt(float amount)
        {
            Health = System.Math.Max(0, Health - amount);
            Behavior?.Hit(Health);
            Send("hurt", new Dictionary<string, object> { ["amount"] = (double)amount, ["health"] = (double)Health });
        }

        /// <summary>Where it is on the plan (x east, y south), as the core counts.</summary>
        public double[] PlanPosition() => new double[] { transform.localPosition.x, transform.localPosition.z };

        /// <summary>The level it is in (a parent with a navigation graph, VcgsLevel), found once.</summary>
        IVcgsNavHost level;
        bool levelFound;
        readonly VcgsNav.Way way = new VcgsNav.Way();

        IVcgsNavHost Level()
        {
            if (!levelFound)
            {
                levelFound = true;
                level = transform.parent != null ? transform.parent.GetComponentInParent<IVcgsNavHost>() : null;
            }
            return level;
        }

        /// <summary>
        /// The next plan point on the way round walls from (ax, ay) to (tx, ty), on the level's
        /// navigation graph (spec §19 navmesh); null when there is no way there. With no graph,
        /// straight there: (tx, ty, true). The graph has the data's z south, Unity's +Z north.
        /// </summary>
        public (double x, double y, bool last)? Steer(double ax, double ay, double tx, double ty)
        {
            var host = Level();
            if (host == null || host.Nav == null) return (tx, ty, true);
            var frame = ((Component)host).transform;
            var y = transform.position.y;
            double[] ToLevel(double x, double z)
            {
                var world = transform.parent.TransformPoint(new Vector3((float)x, 0, (float)z));
                var at = frame.InverseTransformPoint(new Vector3(world.x, y, world.z));
                return new double[] { at.x, at.y, -at.z };
            }
            var goal = ToLevel(tx, ty);
            var next = host.Nav.NextOnWay(way, ToLevel(ax, ay), goal);
            if (next == null) return null;
            if (next == goal) return (tx, ty, true);
            var there = transform.parent.InverseTransformPoint(frame.TransformPoint(new Vector3((float)next[0], (float)next[1], -(float)next[2])));
            return (there.x, there.z, false);
        }

        /// <summary>The point it is walking to: give it to a NavMeshAgent for pathfinding.</summary>
        public Vector3 MoveTarget { get; private set; }

        /// <summary>Straight to a plan point (the core has already stepped it there).</summary>
        public void MoveTo(double x, double y)
        {
            MoveTarget = new Vector3((float)x, transform.localPosition.y, (float)y);
            transform.localPosition = MoveTarget;
        }
    }
}
`;

const perception = String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>PerceptionComponent: what blocks the character's sight (a ray at eye height through the level's colliders).</summary>
    public sealed class VcgsActorPerception : MonoBehaviour
    {
        VcgsActor actor;

        public void Setup(VcgsActor owner) => actor = owner;

        public bool Blocked(double ax, double ay, double bx, double by)
        {
            if (actor == null) return false;
            var eye = transform.position.y + 1.6f;
            var from = new Vector3((float)ax, eye, (float)ay);
            var to = new Vector3((float)bx, eye, (float)by);
            foreach (var hit in Physics.RaycastAll(from, (to - from).normalized, Vector3.Distance(from, to)))
                if (hit.transform != null && !hit.transform.IsChildOf(transform)) return true;
            return false;
        }
    }
}
`;

const behavior = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// BehaviorController: the AI state machine (VcgsCast.AiStep) against the
    /// player (the GameObject tagged Player), or its activity for a character
    /// with no AI. Tick is called from Update; call it yourself to drive it.
    /// </summary>
    public sealed class VcgsActorBehavior : MonoBehaviour
    {
        VcgsActor actor;
        Dictionary<string, object> ai;
        readonly List<double[]> patrol = new List<double[]>();
        public VcgsCast.Memory Memory { get; private set; }
        public string State => Memory != null ? Memory.State : "";
        public event System.Action<string, string> StateChanged;
        int wanderStop = 1;
        float wanderUntil;
        float clock;
        double[] wanderTo;
        readonly System.Random random = new System.Random();

        public void Setup(VcgsActor owner)
        {
            actor = owner;
            patrol.Clear();
            patrol.Add(owner.PlanPosition());
            foreach (var p in owner.route) patrol.Add(new double[] { p.x, p.z });
            if (D.Get(owner.Data, "ai") is Dictionary<string, object> a)
            {
                ai = a;
                var start = new Dictionary<string, object>(a);
                if (patrol.Count < 2) start["start"] = "idle";
                Memory = VcgsCast.StartMemory(start, patrol, owner.Health, transform.localEulerAngles.y * System.Math.PI / 180 - System.Math.PI / 2);
            }
        }

        public void Hit(float health)
        {
            if (Memory == null) return;
            Memory.Health = health;
            Memory.Hit = true;
        }

        void Update() => Tick(Time.deltaTime);

        public void Tick(float dt)
        {
            clock += dt;
            if (actor == null || actor.Data == null) return;
            var speed = D.Num(D.Map(actor.Data, "stats"), "speed", 3);
            if (ai == null)
            {
                Activity(dt, speed);
                return;
            }
            var player = GameObject.FindWithTag("Player");
            var target = new VcgsCast.Target { Alive = player != null };
            if (player != null)
            {
                target.X = player.transform.position.x;
                target.Y = player.transform.position.z;
            }
            var here = actor.PlanPosition();
            Memory.X = here[0];
            Memory.Y = here[1];
            var before = Memory.State;
            var step = VcgsCast.AiStep(ai, speed, Memory, target, patrol, null, dt, actor.Perception != null ? actor.Perception.Blocked : (VcgsCast.Blocked)null, actor.Steer);
            Memory = step.Memory;
            if (step.Reason != "")
            {
                StateChanged?.Invoke(Memory.State, step.Reason);
                actor.Send("state", new Dictionary<string, object> { ["from"] = before, ["to"] = Memory.State, ["reason"] = step.Reason });
            }
            if (step.Attacked && player != null)
            {
                var damage = D.Num(actor.Data, "hit", 5) * (0.5 + D.Num(D.Map(ai, "skill"), "accuracy", 50) / 200);
                actor.Send("attack", new Dictionary<string, object> { ["damage"] = damage });
                // A captor catches the player (the story's capture) rather than hurting them.
                if (Catch()) actor.Send("caught", new Dictionary<string, object>());
                else
                {
                    var victim = player.GetComponent<VcgsActor>();
                    if (victim != null) victim.Hurt((float)damage);
                }
            }
            actor.MoveTo(Memory.X, Memory.Y);
        }

        /// <summary>A captor's blow: the story captures the player (Rules.CatchPlayer). False when this character is no captor, there is no story, the story has no capture, or the player is held already.</summary>
        public bool Catch()
        {
            var key = D.Str(actor.Data, "story_key");
            var game = VcgsGame.Instance != null ? VcgsGame.Instance.State : null;
            if (key == "" || game == null || !Rules.IsCaptor(key, game)) return false;
            return Rules.CatchPlayer(key, game) != "";
        }

        void Activity(float dt, double speed)
        {
            var home = patrol[0];
            var here = actor.PlanPosition();
            if (actor.activity == "wander" && actor.wanderRadius > 0)
            {
                if (clock < wanderUntil) return;
                if (wanderTo == null)
                {
                    var a = random.NextDouble() * System.Math.PI * 2;
                    var r = System.Math.Sqrt(random.NextDouble()) * actor.wanderRadius;
                    wanderTo = new[] { home[0] + System.Math.Cos(a) * r, home[1] + System.Math.Sin(a) * r };
                }
                var went = StepAlong(here, wanderTo, speed * 0.35 * dt);
                // Somewhere it can't get to: it picks another.
                if (went == null) wanderTo = null;
                else if (went.Value)
                {
                    wanderTo = null;
                    wanderUntil = clock + 1 + (float)random.NextDouble() * 3;
                }
            }
            else if (actor.activity == "patrol" && patrol.Count > 1)
            {
                if (StepAlong(here, patrol[wanderStop], speed * 0.45 * dt) == true) wanderStop = 1 + wanderStop % (patrol.Count - 1);
            }
        }

        /// <summary>Towards a plan point by the way round walls (the actor's Steer): whether it got there, or null (standing) when there is no way there.</summary>
        bool? StepAlong(double[] here, double[] to, double by)
        {
            var via = actor.Steer(here[0], here[1], to[0], to[1]);
            if (via == null) return null;
            var (x, y, last) = via.Value;
            return StepTowards(here, new[] { x, y }, by) && last;
        }

        bool StepTowards(double[] here, double[] to, double by)
        {
            var dx = to[0] - here[0];
            var dy = to[1] - here[1];
            var d = System.Math.Sqrt(dx * dx + dy * dy);
            if (d <= by) { actor.MoveTo(to[0], to[1]); return true; }
            actor.MoveTo(here[0] + dx / d * by, here[1] + dy / d * by);
            return false;
        }
    }
}
`;

const abilities = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// AbilityComponent: Use checks an ability's cost and cooldown, spends and
    /// starts them, runs a custom power's damage, heal, stun and set-flag
    /// actions, and sends everything else as events. Stubs say so.
    /// </summary>
    public sealed class VcgsActorAbilities : MonoBehaviour
    {
        VcgsActor actor;
        public readonly Dictionary<string, double> Cooldowns = new Dictionary<string, double>();
        public readonly Dictionary<string, double> Resource = new Dictionary<string, double>();
        public double Clock;

        public void Setup(VcgsActor owner)
        {
            actor = owner;
            var r = D.Map(D.Map(owner.Data, "stats"), "resource");
            if (D.Str(r, "kind") != "none") Resource[D.Str(r, "kind")] = D.Num(r, "max");
        }

        void Update() => Clock += Time.deltaTime;

        public Dictionary<string, object> Find(string key)
        {
            foreach (var o in D.List(actor.Data, "abilities")) if (D.Str(D.Map(o), "key") == key) return D.Map(o);
            return null;
        }

        /// <summary>Use an ability: "" when it went off, else why not.</summary>
        public string Use(string key, VcgsActor target = null)
        {
            var a = Find(key);
            if (a == null) return "No such ability.";
            var why = VcgsCast.CanUse(a, Cooldowns, Resource, Clock);
            if (why != "") return why;
            var cost = D.Map(a, "cost");
            if (D.Str(cost, "resource") != "none") Resource[D.Str(cost, "resource")] = (Resource.TryGetValue(D.Str(cost, "resource"), out var have) ? have : 0) - D.Num(cost, "amount");
            Cooldowns[key] = Clock + D.Num(a, "cooldown");
            // TODO(VCGS): a library ability marked "stub" only checks its cost and cooldown and sends its cue here; write what it does.
            if (D.Str(a, "graybox") == "stub" && D.Str(a, "source") == "library") Debug.Log("VCGS: " + D.Str(a, "name") + " is a stub; only its cost, cooldown and cue run.");
            foreach (var o in D.List(a, "actions"))
            {
                var action = D.Map(o);
                var amount = (float)D.Num(action, "amount");
                switch (D.Str(action, "effect"))
                {
                    case "damage": if (target != null) target.Hurt(amount); break;
                    case "heal":
                    {
                        var who = D.Str(action, "target") == "self" ? actor : target;
                        if (who != null) who.Health = System.Math.Min((float)D.Num(D.Map(who.Data, "stats"), "health", 100), who.Health + amount);
                        break;
                    }
                    case "stun": if (target != null && target.Behavior != null) target.Behavior.Hit(target.Health); break;
                    case "setFlag": actor.Send("set_flag", new Dictionary<string, object> { ["flag"] = D.Str(action, "value") }); break;
                    default: actor.Send(D.Str(action, "effect"), action); break;
                }
                if (D.Str(action, "event") != "") actor.Send(D.Str(action, "event"), action);
            }
            actor.Send("cue", new Dictionary<string, object> { ["cue"] = D.Str(a, "cue"), ["vfx"] = D.Str(a, "vfx"), ["sfx"] = D.Str(a, "sfx"), ["ability"] = key });
            return "";
        }
    }
}
`;

const inventory = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>InventoryComponent: the starting items and the capacity (unlimited, slots, stacks, weight or both).</summary>
    public sealed class VcgsActorInventory : MonoBehaviour
    {
        VcgsActor actor;
        Dictionary<string, object> profile;
        public readonly Dictionary<string, int> Items = new Dictionary<string, int>();
        /// <summary>Item weights and the items that don't stack, by item key: set them from the story's items.</summary>
        public readonly Dictionary<string, double> Weights = new Dictionary<string, double>();
        public readonly HashSet<string> Single = new HashSet<string>();

        public void Setup(VcgsActor owner)
        {
            actor = owner;
            profile = D.Map(owner.Data, "inventory");
            foreach (var o in D.List(profile, "items")) Items[D.Str(D.Map(o), "item")] = (int)D.Num(D.Map(o), "qty");
        }

        public int Count(string item) => Items.TryGetValue(item, out var n) ? n : 0;

        /// <summary>Take qty of an item: "" when it fit, else why not (the overflow is sent with the policy).</summary>
        public string Add(string item, int qty = 1)
        {
            var why = VcgsCast.Fits(profile, Items, item, qty, Weights, Single);
            if (why != "")
            {
                actor.Send("overflow", new Dictionary<string, object> { ["item"] = item, ["qty"] = (double)qty, ["why"] = why, ["policy"] = D.Str(profile, "overflow") });
                return why;
            }
            Items[item] = Count(item) + qty;
            return "";
        }

        public bool Remove(string item, int qty = 1)
        {
            if (Count(item) < qty) return false;
            Items[item] = Count(item) - qty;
            if (Items[item] == 0) Items.Remove(item);
            return true;
        }
    }
}
`;

const equipment = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>EquipmentComponent: slots and what is in them; only what is carried can be equipped.</summary>
    public sealed class VcgsActorEquipment : MonoBehaviour
    {
        VcgsActor actor;
        public readonly Dictionary<string, string> Slots = new Dictionary<string, string>();

        public void Setup(VcgsActor owner)
        {
            actor = owner;
            foreach (var o in D.List(D.Map(owner.Data, "inventory"), "equipment")) Slots[D.Str(D.Map(o), "slot")] = D.Str(D.Map(o), "item");
        }

        public string Equip(string slot, string item)
        {
            if (!Slots.ContainsKey(slot)) return "No " + slot + " slot.";
            if (item != "" && actor.Inventory != null && actor.Inventory.Count(item) <= 0) return "Not carried.";
            Slots[slot] = item;
            actor.Send("equip", new Dictionary<string, object> { ["slot"] = slot, ["item"] = item, ["socket"] = D.Str(D.Map(D.Map(actor.Data, "binding"), "sockets"), "hand") });
            return "";
        }
    }
}
`;

const dialogue = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// DialogueComponent: an interactive NPC's prompt, greeting, topics (with
    /// their script lines, by line id) and stock. Pass a rule check (the story
    /// runtime's Rules with the game state) to filter topics by their conditions.
    /// </summary>
    public sealed class VcgsActorDialogue : MonoBehaviour
    {
        Dictionary<string, object> npc;

        public void Setup(VcgsActor owner) => npc = D.Get(owner.Data, "npc") as Dictionary<string, object>;

        public bool IsInteractive => npc != null;
        public string Prompt => npc != null ? D.Str(npc, "prompt") : "";

        public List<Dictionary<string, object>> Topics(System.Func<Dictionary<string, object>, bool> holds = null)
        {
            var outList = new List<Dictionary<string, object>>();
            if (npc == null) return outList;
            foreach (var o in D.List(npc, "topics"))
            {
                var t = D.Map(o);
                if (holds != null && D.Get(t, "when") is Dictionary<string, object> when && !holds(when)) continue;
                outList.Add(t);
            }
            return outList;
        }
    }
}
`;

const spawnGroup = String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// SpawnGroupController: a Character group area's people, spawned where the
    /// studio spread them (characters.json placements), each a VcgsActor doing
    /// its activity. Set itemGuid to the area's guid, or levelGuid for every group
    /// and AI actor of a level. Show and Hide are for the game's own clock (schedules).
    /// </summary>
    public sealed class VcgsSpawnGroup : MonoBehaviour
    {
        public TextAsset charactersJson;
        public string itemGuid = "";
        public string levelGuid = "";
        public readonly List<VcgsActor> Spawned = new List<VcgsActor>();

        void Start()
        {
            if (Spawned.Count == 0 && charactersJson != null) Spawn(VcgsCast.Load(charactersJson.text));
        }

        public List<VcgsActor> Spawn(Dictionary<string, object> cast)
        {
            foreach (var p in VcgsCast.Placements(cast, levelGuid))
            {
                if (itemGuid != "" && D.Str(p, "item") != itemGuid) continue;
                foreach (var o in D.List(p, "members"))
                {
                    var m = D.Map(o);
                    var go = new GameObject(D.Str(m, "id").Replace("#", "_"));
                    go.transform.SetParent(transform, false);
                    // Into Unity's space as the level builder puts the level: the studio's z runs south, Unity's north.
                    go.transform.localPosition = ToUnity(D.List(m, "position"));
                    go.transform.localRotation = Quaternion.Euler(0, -(float)D.Num(m, "turn"), 0);
                    var actor = go.AddComponent<VcgsActor>();
                    actor.characterKey = D.Str(m, "character");
                    actor.variantKey = D.Str(m, "variant");
                    actor.activity = D.Str(m, "activity");
                    actor.wanderRadius = (float)D.Num(m, "wander_radius");
                    foreach (var r in D.List(m, "route"))
                    {
                        actor.route.Add(ToUnity(D.List(r)));
                    }
                    actor.Setup(cast);
                    Spawned.Add(actor);
                }
            }
            return Spawned;
        }

        static Vector3 ToUnity(List<object> v) => new Vector3((float)D.Num(v[0], 0), (float)D.Num(v[1], 0), -(float)D.Num(v[2], 0));

        public void Show() => gameObject.SetActive(true);
        public void Hide() => gameObject.SetActive(false);
    }
}
`;

export const CHARACTER_FILES: Record<string, string> = {
  'VcgsCast.cs': CORE,
  'VcgsActor.cs': actor,
  'VcgsActorPerception.cs': perception,
  'VcgsActorBehavior.cs': behavior,
  'VcgsActorAbilities.cs': abilities,
  'VcgsActorInventory.cs': inventory,
  'VcgsActorEquipment.cs': equipment,
  'VcgsActorDialogue.cs': dialogue,
  'VcgsSpawnGroup.cs': spawnGroup,
};
