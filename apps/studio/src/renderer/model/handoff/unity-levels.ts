import type { IrLevel } from './levels';

/**
 * Levels for Unity (spec §11.2). The level's data goes over as JSON; an
 * editor menu (VCGS › Update level from data…) builds or updates its
 * GameObjects in the open scene, matching each by its GUID so a re-export
 * updates what is there instead of replacing it. LevelLogic, plain C#, runs
 * the doors, pickups, volumes and rules on the story's GameState, in Unity
 * (through VcgsLevel) and in tests outside it.
 *
 * Unity is left-handed with +Z forward: north in VC Game Studio (−z) is +Z
 * here, and a turn counter-clockwise from above is a negative yaw.
 */

const HEAD = '// VCGS Runtime for Unity. The same for every project; safe to commit.';

export const LEVEL_RUNTIME_FILES: Record<string, string> = {
  'LevelLogic.cs': String.raw`${HEAD}
using System;
using System.Collections.Generic;
using System.Globalization;

namespace VCGS
{
    /// <summary>What Interact would do to an item now.</summary>
    public sealed class LevelOffer
    {
        public string Verb = "";
        public string Label = "";
        /// <summary>Why it can't be done now, or "" when it can.</summary>
        public string Blocked = "";
    }

    /// <summary>
    /// A level from VC Game Studio in plain C#: its items by GUID and their rules,
    /// run on the story's GameState, so the level and the story always agree.
    /// VcgsLevel runs it in a scene; tests run it anywhere.
    /// </summary>
    /// <summary>Where an actor that moves is, in level space as the data has it (x east, y up, z south), and what it is doing.</summary>
    public sealed class ActorPose
    {
        public double X, Y, Z;
        /// <summary>The way it faces (level space, flat), once it has moved or turned.</summary>
        public double FacingX, FacingZ;
        public bool Faces, Moving;
        /// <summary>The patrol stop it walks to, and the level time it waits until.</summary>
        public int Stop;
        public double Until;
    }

    /// <summary>Something the player can do on the gear screen (spec §8): equip, unequip, use, learn or craft, and why not ("" when they can).</summary>
    public sealed class GearOption
    {
        public string Act = "";
        public string Key = "";
        public string Label = "";
        public string Why = "";
    }

    public sealed class LevelLogic
    {
        static readonly HashSet<string> Interactive = new HashSet<string> { "door", "pickup", "inventory", "weapon", "ammo", "health", "npc", "companion", "neutral", "dialogue", "interaction", "puzzle", "elevator", "ladder" };
        static readonly HashSet<string> Pickups = new HashSet<string> { "pickup", "inventory", "weapon", "ammo", "health" };

        public readonly GameState Game;
        public readonly string Key;
        public readonly string Name;
        public readonly string ExportName;
        public readonly Dictionary<string, Dictionary<string, object>> Items = new Dictionary<string, Dictionary<string, object>>();
        public readonly List<string> Order = new List<string>();
        readonly Dictionary<string, object> names;

        public readonly Dictionary<string, bool> Open = new Dictionary<string, bool>();
        public readonly Dictionary<string, bool> Enabled = new Dictionary<string, bool>();
        public readonly HashSet<string> Unlocked = new HashSet<string>();
        public readonly HashSet<string> Gone = new HashSet<string>();
        public readonly HashSet<string> Done = new HashSet<string>();
        public readonly HashSet<string> Inside = new HashSet<string>();
        readonly Dictionary<string, double> timers = new Dictionary<string, double>();
        public string Objective = "";
        public double Health = 100;
        public double Time;
        int depth;

        /// <summary>Actors that move (patrols, companions) by GUID: where each is now. VcgsLevel moves their GameObjects to match.</summary>
        public readonly Dictionary<string, ActorPose> Poses = new Dictionary<string, ActorPose>();
        /// <summary>Where the player is, in level space ({x, y, z}; null for nowhere): companions follow it. VcgsLevel sets it each frame.</summary>
        public double[] Player;
        /// <summary>How far behind a companion may fall before it catches up at once.</summary>
        public const double CatchUp = 12;

        /// <summary>The player's light (spec §6), from the player start: what lights it (a story item or mechanic), its fuel (0 for ever), its reach.</summary>
        public readonly string LightSource;
        public readonly double LightFuelFull, LightRange;
        /// <summary>Whether the light is on, and the seconds of fuel left (infinity when it never runs out).</summary>
        public bool LightOn;
        public double LightFuel;
        /// <summary>The light went on or off.</summary>
        public event Action<bool> LightChanged;

        public event Action<string> CinematicRequested;
        public event Action<string> SceneRequested;
        public event Action<string> LevelRequested;
        public event Action<string, string, int> SpawnRequested;
        public event Action<string> ObjectiveChanged;
        public event Action<string, string> AudioRequested;
        public event Action<string> Message;
        public event Action<string> CheckpointReached;
        public event Action<string> StoryObjectUsed;
        public event Action PlayerDied;
        /// <summary>What is there, or which doors are open, may have changed.</summary>
        public event Action Refreshed;
        /// <summary>A travel link was taken (spec V2 §13): its key, the map it leads to ("" for this one), how, and where it ends ({x, y, z}, level space).</summary>
        public event Action<string, string, string, double[]> TravelRequested;

        /// <summary>Where this map is in the hierarchy (spec V2 §4): kind, parent, boundary, extent, placement and the maps inside it.</summary>
        public readonly Dictionary<string, object> Map;
        /// <summary>Its travel links (spec V2 §13), by key.</summary>
        public readonly Dictionary<string, Dictionary<string, object>> Travel = new Dictionary<string, Dictionary<string, object>>();

        public static LevelLogic FromJson(string json, GameState game) => new LevelLogic(D.Map(Json.Parse(json)), game);

        public LevelLogic(Dictionary<string, object> data, GameState game)
        {
            Game = game;
            Key = D.Str(data, "key");
            Name = D.Str(data, "name");
            ExportName = D.Str(data, "export_name");
            var light = D.Map(data, "light");
            LightSource = D.Str(light, "source");
            LightFuelFull = D.Num(light, "fuel", 0) > 0 ? D.Num(light, "fuel", 0) : double.PositiveInfinity;
            LightRange = D.Num(light, "range", 8);
            LightFuel = LightFuelFull;
            names = D.Map(data, "names");
            Map = D.Map(data, "map");
            foreach (var o in D.List(data, "travel")) Travel[D.Str(D.Map(o), "key")] = D.Map(o);
            foreach (var o in D.List(data, "items"))
            {
                var item = D.Map(o);
                var guid = D.Str(item, "guid");
                Items[guid] = item;
                Order.Add(guid);
            }
            game.Changed += OnChanged;
            foreach (var guid in Order)
            {
                // Actors that move, and those that watch (a pose says where they look).
                var watches = ParamNum(guid, "sight", 0) > 0;
                if (D.Map(Item(guid), "motion").Count == 0 && !watches) continue;
                var at = D.List(Item(guid), "position");
                var pose = new ActorPose { X = D.Num(at.Count > 2 ? at[0] : null, 0), Y = D.Num(at.Count > 2 ? at[1] : null, 0), Z = D.Num(at.Count > 2 ? at[2] : null, 0) };
                if (watches)
                {
                    // Turned counter-clockwise from north (−z) by its turn.
                    var turn = D.Num(Item(guid), "turn", 0) * Math.PI / 180;
                    pose.FacingX = -Math.Sin(turn); pose.FacingZ = -Math.Cos(turn); pose.Faces = true;
                }
                Poses[guid] = pose;
            }
            foreach (var guid in Order)
                if (Role(guid) == "spawn" && D.Str(Item(guid), "kind") == "marker" && ParamNum(guid, "delay", 0) <= 0 && IsPresent(guid)) Spawn(guid);
        }

        public Dictionary<string, object> Item(string guid) => Items.TryGetValue(guid, out var i) ? i : new Dictionary<string, object>();
        public string Role(string guid) => D.Str(Item(guid), "role");
        public object Param(string guid, string key) => D.Get(D.Map(Item(guid), "params"), key);
        public string ParamStr(string guid, string key) => D.Str(D.Map(Item(guid), "params"), key);
        public double ParamNum(string guid, string key, double fallback) => D.Num(D.Map(Item(guid), "params"), key, fallback);
        public bool ParamBool(string guid, string key, bool fallback) => Param(guid, key) is bool b ? b : fallback;
        public string StoryName(string key) => D.Str(names, key) is var n && n != "" ? n : key;

        // ---------------------------------------------------------------- maps and travel (spec V2)

        /// <summary>The maps inside this one: key, name, boundary, anchor, placement, size, centre, load_margin.</summary>
        public List<Dictionary<string, object>> ChildMaps() => D.List(Map, "children").ConvertAll(D.Map);

        /// <summary>How far a point (level space) is outside a streamed child's footprint around its anchor; 0 inside.</summary>
        public static double OutsideOf(Dictionary<string, object> child, double x, double z)
        {
            var centre = D.List(child, "centre");
            var size = D.List(child, "size");
            if (centre.Count < 3 || size.Count < 2) return double.PositiveInfinity;
            var turn = D.Num(D.Map(child, "placement"), "turn", 0) * Math.PI / 180;
            var dx = x - D.Num(centre[0], 0);
            var dz = z - D.Num(centre[2], 0);
            // Into the footprint's own frame: undo its turn (counter-clockwise from above).
            var lx = dx * Math.Cos(turn) - dz * Math.Sin(turn);
            var lz = dx * Math.Sin(turn) + dz * Math.Cos(turn);
            var ox = Math.Max(0, Math.Abs(lx) - D.Num(size[0], 0) / 2);
            var oz = Math.Max(0, Math.Abs(lz) - D.Num(size[1], 0) / 2);
            return Math.Sqrt(ox * ox + oz * oz);
        }

        /// <summary>
        /// Streamed children to load (the player within their margin) and to unload
        /// (beyond twice it), given those loaded now. Uses Player; nothing changes without one.
        /// </summary>
        public List<string> StreamChanges(ICollection<string> loaded, List<string> unload)
        {
            var load = new List<string>();
            if (Player == null) return load;
            foreach (var child in ChildMaps())
            {
                if (D.Str(child, "boundary") != "streamed" || D.Map(child, "placement").Count == 0) continue;
                var key = D.Str(child, "key");
                var away = OutsideOf(child, Player[0], Player[2]);
                var margin = D.Num(child, "load_margin", 25);
                if (away <= margin && !loaded.Contains(key)) load.Add(key);
                else if (away > margin * 2 && loaded.Contains(key)) unload?.Add(key);
            }
            return load;
        }

        /// <summary>Whether a travel link can be taken now: unlocked, or locked and its rule holds (locked without one, never).</summary>
        public bool CanTravel(string key)
        {
            if (!Travel.TryGetValue(key, out var link)) return false;
            if (!D.Bool(link, "locked")) return true;
            var when = D.Map(link, "unlock_when");
            return when.Count > 0 && Rules.Check(when, Game);
        }

        /// <summary>Take a travel link (backwards with reverse): "" when the player goes (TravelRequested says where), else why not. One that leads to another map asks for it too.</summary>
        public string TakeTravel(string key, bool reverse = false)
        {
            if (!Travel.TryGetValue(key, out var link)) return "There is no such way.";
            var name = D.Str(link, "name");
            if (reverse && D.Bool(link, "one_way")) return name + " only goes one way.";
            if (!CanTravel(key)) return name + " is closed.";
            var points = D.List(link, "points");
            var end = D.List(reverse ? points[0] : points[points.Count - 1]);
            var toMap = reverse ? "" : D.Str(link, "to_map");
            TravelRequested?.Invoke(key, toMap, D.Str(link, "transition"), new[] { D.Num(end[0], 0), D.Num(end[1], 0), D.Num(end[2], 0) });
            if (toMap != "") LevelRequested?.Invoke(toMap);
            return "";
        }

        /// <summary>The GUID of the item with this export name, or "".</summary>
        public string GuidOf(string exportName)
        {
            foreach (var guid in Order) if (D.Str(Item(guid), "export_name") == exportName) return guid;
            return "";
        }

        /// <summary>Not taken, not switched off, and its "present only when" holds.</summary>
        public bool IsPresent(string guid) =>
            Items.ContainsKey(guid) && !Gone.Contains(guid) && !(Enabled.TryGetValue(guid, out var on) && !on) && Rules.Check(D.Get(Item(guid), "active_when"), Game);

        public bool IsOpen(string guid) =>
            Open.TryGetValue(guid, out var open) ? open : ParamBool(guid, "startsOpen", false) || ParamStr(guid, "swing") == "open archway";

        bool HasRule(string guid, params string[] on)
        {
            foreach (var r in D.List(Item(guid), "rules")) if (Array.IndexOf(on, D.Str(D.Map(r), "on")) >= 0) return true;
            return false;
        }

        /// <summary>What Interact would do now, or null for nothing.</summary>
        public LevelOffer Offer(string guid)
        {
            if (!IsPresent(guid)) return null;
            var rules = HasRule(guid, "interact", "use", "pickup");
            var interactive = Param(guid, "interactive");
            if (interactive is bool no && !no && !rules) return null;
            if (!(interactive is bool yes && yes) && !rules && !Interactive.Contains(Role(guid))) return null;
            var prompt = ParamStr(guid, "prompt");
            if (prompt == "") prompt = "Use";
            var label = D.Str(Item(guid), "name");
            if (TooDark(guid)) return new LevelOffer { Verb = prompt, Label = label, Blocked = HasLightSource() ? "Too dark to see. Turn your light on (L)." : "Too dark to see." + (LightSource != "" ? " It needs " + StoryName(LightSource) + " for light." : "") };
            if (Role(guid) == "door")
            {
                if (ParamStr(guid, "swing") == "open archway") return null;
                var key = ParamStr(guid, "keyItem");
                var locked = ParamBool(guid, "locked", false) && !Unlocked.Contains(guid);
                var open = IsOpen(guid);
                if (!open && locked && key != "" && !Game.HasItem(key)) return new LevelOffer { Verb = prompt, Label = label, Blocked = "Locked. Needs " + StoryName(key) + "." };
                if (!open && locked && key == "") return new LevelOffer { Verb = prompt, Label = label, Blocked = "Locked." };
                return new LevelOffer { Verb = open ? "Close" : locked ? prompt : "Open", Label = label };
            }
            return new LevelOffer { Verb = prompt, Label = label };
        }

        /// <summary>The player uses an item. Returns what to tell them ("" for nothing).</summary>
        public string Interact(string guid)
        {
            var offer = Offer(guid);
            if (offer == null) return "";
            if (offer.Blocked != "")
            {
                Message?.Invoke(offer.Blocked);
                return offer.Blocked;
            }
            var said = "";
            var item = Item(guid);
            var role = Role(guid);
            if (role == "door")
            {
                var wasOpen = IsOpen(guid);
                if (!wasOpen && ParamBool(guid, "locked", false)) Unlocked.Add(guid);
                Open[guid] = !wasOpen;
            }
            else if (Pickups.Contains(role) && ParamBool(guid, "collectible", true))
            {
                Gone.Add(guid);
                var gives = ParamStr(guid, "item");
                if (role == "health") Health = Math.Min(100, Health + ParamNum(guid, "value", 25));
                var rulesGive = false;
                foreach (var r in D.List(item, "rules"))
                {
                    var rule = D.Map(r);
                    if (D.Str(rule, "on") != "pickup") continue;
                    foreach (var e in D.List(rule, "effects"))
                        if (D.Str(D.Map(e), "kind") == "give" && D.Str(D.Map(e), "ref") == gives) rulesGive = true;
                }
                if (gives != "" && !rulesGive) Game.GiveItem(gives, (int)ParamNum(guid, "quantity", 1));
                said = "Took " + (gives != "" ? StoryName(gives) : D.Str(item, "name"));
                RunRules(guid, "pickup");
            }
            else if (role == "npc" || role == "companion" || role == "neutral" || role == "dialogue")
            {
                var scenes = D.List(item, "scenes");
                if (scenes.Count > 0 && scenes[0] is string scene)
                {
                    Game.Visit(scene);
                    SceneRequested?.Invoke(scene);
                }
            }
            else if (!HasRule(guid, "interact"))
            {
                foreach (var link in D.List(item, "links")) if (link is string key) StoryObjectUsed?.Invoke(key);
            }
            RunRules(guid, "interact");
            RunRules(guid, "use");
            Refreshed?.Invoke();
            if (said != "") Message?.Invoke(said);
            return said;
        }

        /// <summary>The player comes into a volume.</summary>
        public void Enter(string guid)
        {
            if (Inside.Contains(guid) || !IsPresent(guid)) return;
            Inside.Add(guid);
            var once = ParamBool(guid, "once", false);
            if (once && Done.Contains(guid)) return;
            if (once) Done.Add(guid);
            var role = Role(guid);
            var cinematic = ParamStr(guid, "cinematic");
            if (role == "cinematic" && cinematic != "" && !Plays(guid)) CinematicRequested?.Invoke(cinematic);
            if (role == "checkpoint") CheckpointReached?.Invoke(guid);
            if (role == "portal" && ParamStr(guid, "to") != "") LevelRequested?.Invoke(ParamStr(guid, "to"));
            if (role == "spawn" && !Done.Contains(guid)) Spawn(guid);
            RunRules(guid, "enter");
        }

        public void Exit(string guid)
        {
            if (!Inside.Remove(guid)) return;
            RunRules(guid, "exit");
        }

        bool Plays(string guid)
        {
            foreach (var r in D.List(Item(guid), "rules"))
                foreach (var a in D.List(D.Map(r), "actions"))
                    if (D.Str(D.Map(a), "kind") == "playCinematic") return true;
            return false;
        }

        /// <summary>Time passes: hazards hurt, timers and delayed spawns go off.</summary>
        public void Tick(double dt)
        {
            Time += dt;
            MoveActors(dt);
            Watch();
            ApproachDoors();
            BurnLight(dt);
            foreach (var guid in new List<string>(Inside))
            {
                var role = Role(guid);
                if ((role == "hazard" || role == "damage") && IsPresent(guid))
                    Health = ParamBool(guid, "kills", false) ? 0 : Health - ParamNum(guid, "damage", 0) * dt;
            }
            if (Health <= 0)
            {
                Health = 100;
                PlayerDied?.Invoke();
            }
            foreach (var guid in Order)
            {
                if (!IsPresent(guid)) continue;
                if (Role(guid) == "spawn" && D.Str(Item(guid), "kind") == "marker" && !Done.Contains(guid) && ParamNum(guid, "delay", 0) <= Time) Spawn(guid);
                var n = 0;
                foreach (var r in D.List(Item(guid), "rules"))
                {
                    n++;
                    var rule = D.Map(r);
                    if (D.Str(rule, "on") != "timer") continue;
                    var id = guid + ":" + n.ToString(CultureInfo.InvariantCulture);
                    var every = Math.Max(0.5, double.TryParse(D.Str(rule, "detail"), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) ? s : 5);
                    if (Time - (timers.TryGetValue(id, out var last) ? last : 0) < every) continue;
                    timers[id] = Time;
                    Run(guid, rule);
                }
            }
        }

        /// <summary>Whether the player has what lights their light: its story item carried, or its mechanic available.</summary>
        public bool HasLightSource() => LightSource != "" && (Game.HasItem(LightSource) || Game.HasMechanic(LightSource));

        public bool IsLit => LightOn && HasLightSource();

        /// <summary>Turn the player's light on or off (L): only with its source, and with fuel left. Returns what to tell them.</summary>
        public string ToggleLight()
        {
            string text;
            if (LightOn) { LightOn = false; LightChanged?.Invoke(false); text = "Light off."; }
            else if (LightSource == "") text = "You have no light here.";
            else if (!HasLightSource()) text = "You need " + StoryName(LightSource) + " for light.";
            else if (LightFuel <= 0) text = "Your light has no fuel left.";
            else { LightOn = true; LightChanged?.Invoke(true); text = "Light on."; }
            Message?.Invoke(text);
            return text;
        }

        /// <summary>
        /// Gear, skills and crafting (spec §8): what the player can do now, in the order the
        /// studio's Play Mode lists it: each item of equipment carried (Use and Put away when
        /// equipped, else Equip), each skill (Learn), each recipe (Craft), with why not.
        /// </summary>
        public List<GearOption> GearMenu()
        {
            var menu = new List<GearOption>();
            foreach (var pair in Game.Story.Equipment)
            {
                if (!Game.HasItem(pair.Key)) continue;
                var name = D.Str(pair.Value, "name");
                if (Game.IsEquipped(pair.Key))
                {
                    menu.Add(new GearOption { Act = "use", Key = pair.Key, Label = "Use " + name, Why = Game.UseCheck(pair.Key) });
                    menu.Add(new GearOption { Act = "unequip", Key = pair.Key, Label = "Put away " + name });
                }
                else menu.Add(new GearOption { Act = "equip", Key = pair.Key, Label = "Equip " + name, Why = Game.EquipCheck(pair.Key) });
            }
            foreach (var pair in Game.Story.Skills) menu.Add(new GearOption { Act = "learn", Key = pair.Key, Label = "Learn " + D.Str(pair.Value, "name"), Why = Rules.LearnCheck(pair.Key, Game) });
            foreach (var pair in Game.Story.Recipes) menu.Add(new GearOption { Act = "craft", Key = pair.Key, Label = "Craft " + D.Str(pair.Value, "name"), Why = Game.CraftCheck(pair.Key) });
            return menu;
        }

        /// <summary>The gear screen as text: GEAR, then each option numbered, with why not in brackets.</summary>
        public string GearText()
        {
            var lines = new List<string> { "GEAR" };
            var menu = GearMenu();
            if (menu.Count == 0) lines.Add("Nothing to equip, learn or craft.");
            for (var i = 0; i < menu.Count; i++) lines.Add((i + 1) + ". " + menu[i].Label + (menu[i].Why != "" ? " (" + menu[i].Why + ")" : ""));
            return string.Join("\n", lines);
        }

        string GearName(string key)
        {
            foreach (var table in new[] { Game.Story.Equipment, Game.Story.Skills, Game.Story.Recipes })
                if (table.TryGetValue(key ?? "", out var entry)) return D.Str(entry, "name");
            return StoryName(key);
        }

        /// <summary>Do one: equip, unequip, use, learn or craft, by the story's rules. Returns what to tell the player ("Equipped Diving Knife", "Crafted 2 × Flare", or why not), as the studio says it.</summary>
        public string GearDo(string act, string key)
        {
            var name = GearName(key);
            string why, done;
            switch (act)
            {
                case "equip": why = Game.Equip(key); done = "Equipped " + name; break;
                case "unequip": why = Game.Unequip(key); done = "Put away " + name; break;
                case "use": why = Game.UseItem(key); done = "Used " + name; break;
                case "learn": why = Rules.Learn(key, Game); done = "Learned " + name; break;
                case "craft":
                    why = Game.Craft(key);
                    var makes = Game.Story.Recipes.TryGetValue(key ?? "", out var r) ? (int)D.Num(r, "makes", 1) : 1;
                    done = "Crafted " + (makes > 1 ? makes + " × " : "") + name;
                    break;
                default: why = "Nothing to do."; done = ""; break;
            }
            var text = why != "" ? why : done;
            Message?.Invoke(text);
            return text;
        }

        /// <summary>What is in the player's hand ("" for nothing).</summary>
        public string InHand() => Game.EquippedIn("Hand");

        /// <summary>Use what is in the hand (R), as Use on the gear screen.</summary>
        public string UseInHand()
        {
            var key = InHand();
            if (key == "") { Message?.Invoke("Nothing in hand."); return "Nothing in hand."; }
            return GearDo("use", key);
        }

        void BurnLight(double dt)
        {
            if (!LightOn) return;
            if (!HasLightSource())
            {
                LightOn = false;
                LightChanged?.Invoke(false);
                Message?.Invoke("Your light goes out.");
            }
            else if (!double.IsInfinity(LightFuel))
            {
                LightFuel = Math.Max(0, LightFuel - dt);
                if (LightFuel > 0) return;
                LightOn = false;
                LightChanged?.Invoke(false);
                Message?.Invoke("Your light goes out: no fuel left.");
            }
        }

        /// <summary>How dark it is where the player is (0 to 1): the darkest darkness zone they are in.</summary>
        public double Darkness()
        {
            double dark = 0;
            foreach (var guid in Inside)
                if (Role(guid) == "darkness" && IsPresent(guid)) dark = Math.Max(dark, Math.Min(1, Math.Max(0, ParamNum(guid, "dark", 92) / 100)));
            return dark;
        }

        /// <summary>Whether an item is lost in the dark: in a darkness zone that is here, with the light off.</summary>
        public bool TooDark(string guid)
        {
            if (IsLit) return false;
            foreach (var zone in D.List(Item(guid), "in_dark")) if (zone is string z && IsPresent(z)) return true;
            return false;
        }

        /// <summary>Walk the patrols on and bring the companions after the Player (the same rules as the studio's Play Mode).</summary>
        void MoveActors(double dt)
        {
            foreach (var pair in Poses)
            {
                if (!IsPresent(pair.Key)) continue;
                // While it sees the Player, an actor does what its onSight says: chase, watch, or carry on.
                var reaction = Seen.Contains(pair.Key) ? ParamStr(pair.Key, "onSight") : "";
                if (reaction == "chase" || reaction == "watch")
                {
                    if (Player != null && Player.Length > 2) StepReaction(pair.Value, reaction, ParamNum(pair.Key, "chaseSpeed", 3.5), dt, Player[0], Player[1], Player[2]);
                    continue;
                }
                var motion = D.Map(Item(pair.Key), "motion");
                // An actor that only watches stands where it is.
                if (motion.Count == 0) continue;
                if (D.Str(motion, "kind") == "patrol") StepPatrol(pair.Value, motion, dt, Time);
                else if (Player != null && Player.Length > 2) StepFollow(pair.Value, motion, dt, Player[0], Player[1], Player[2]);
            }
        }

        /// <summary>
        /// What the player is at (as the studio's Play Mode), in level space: a ladder within reach, and
        /// how deep the water around their feet is (0 for none). Your controller climbs while ladder is
        /// true (forward goes up) and swims once depth is 1.1 m or more.
        /// </summary>
        public (bool ladder, double depth) TraversalAt(double x, double y, double z)
        {
            var ladder = false;
            var depth = 0.0;
            foreach (var guid in Order)
            {
                var role = Role(guid);
                if ((role != "ladder" && role != "water") || !IsPresent(guid)) continue;
                var it = Item(guid);
                var at = D.List(it, "position");
                var size = D.List(it, "size");
                if (at.Count < 3 || size.Count < 3) continue;
                // Into its frame: turned counter-clockwise from above by its turn.
                var turn = D.Num(it, "turn", 0) * Math.PI / 180;
                double dx = x - D.Num(at[0], 0), dz = z - D.Num(at[2], 0);
                var lx = dx * Math.Cos(turn) - dz * Math.Sin(turn);
                var lz = dx * Math.Sin(turn) + dz * Math.Cos(turn);
                var ly = y - D.Num(at[1], 0);
                var reach = role == "ladder" ? 0.2 : 0;
                if (Math.Abs(lx) > D.Num(size[0], 1) / 2 + reach || Math.Abs(lz) > D.Num(size[2], 1) / 2 + reach * 2.25) continue;
                if (ly < (role == "ladder" ? -0.2 : -0.25) || ly > D.Num(size[1], 1)) continue;
                if (role == "ladder") ladder = true;
                else depth = Math.Max(depth, D.Num(size[1], 1) - ly);
            }
            return (ladder, depth);
        }

        /// <summary>The player's stamina, 0–100, when the level's player start tracks it.</summary>
        public double Stamina = 100;
        public event Action Exhausted;

        public bool TracksStamina()
        {
            foreach (var guid in Order) if (Role(guid) == "playerStart") return ParamBool(guid, "stamina", false);
            return false;
        }

        /// <summary>Spend stamina for dt seconds of running, swimming or climbing, or win it back at rest. Out of it, the player can't run, and swimming hurts.</summary>
        public void SpendStamina(double dt, bool run, bool swim, bool climb)
        {
            if (!TracksStamina()) return;
            var before = Stamina;
            var cost = (run ? 15 : 0) + (swim ? 6 : 0) + (climb ? 8 : 0);
            Stamina = Math.Min(100, Math.Max(0, cost > 0 ? Stamina - cost * dt : Stamina + 12 * dt));
            if (before > 0 && Stamina == 0) { Exhausted?.Invoke(); Message?.Invoke("You're exhausted."); }
            if (swim && Stamina == 0) Health -= 15 * dt;
        }

        /// <summary>Doors the Player is standing at now: each opens (or says why not) once as they come up.</summary>
        public readonly HashSet<string> AtDoors = new HashSet<string>();

        /// <summary>
        /// Walking up to a closed door opens it, as Interact would, or says what it needs: once each
        /// approach (as the studio's Play Mode). A door whose autoOpen is off waits for Interact.
        /// </summary>
        void ApproachDoors()
        {
            if (Player == null || Player.Length < 3) return;
            var near = new HashSet<string>();
            foreach (var guid in Order)
            {
                if (Role(guid) != "door" || !IsPresent(guid)) continue;
                var at = D.List(Item(guid), "position");
                if (at.Count < 3) continue;
                var size = D.List(Item(guid), "size");
                var width = size.Count > 0 ? D.Num(size[0], 1.2) : 1.2;
                double dx = Player[0] - D.Num(at[0], 0), dz = Player[2] - D.Num(at[2], 0);
                if (Math.Abs(Player[1] - D.Num(at[1], 0)) > 1 || Math.Sqrt(dx * dx + dz * dz) > Math.Max(1.1, width / 2 + 0.4)) continue;
                near.Add(guid);
                if (AtDoors.Contains(guid) || IsOpen(guid) || !ParamBool(guid, "autoOpen", true)) continue;
                Interact(guid);
            }
            AtDoors.Clear();
            AtDoors.UnionWith(near);
        }

        /// <summary>Line of sight: true when something solid lies between two level-space points. VcgsLevel sets it (a raycast); unset, nothing blocks.</summary>
        public Func<double[], double[], bool> Blocked;
        /// <summary>Actors that see the player now.</summary>
        public readonly HashSet<string> Seen = new HashSet<string>();
        public event Action<string> ActorSpotted;
        public event Action<string> ActorLostSight;

        /// <summary>
        /// Line of sight (the same rules as the studio's Play Mode): an actor whose sight is over 0
        /// sees the Player within that range and its field of view (fov, degrees, about the way it
        /// faces), with nothing solid in the way. Its "spotted" rules run as the Player comes into
        /// view, its "lost" rules as they go.
        /// </summary>
        void Watch()
        {
            if (Player == null || Player.Length < 3) return;
            foreach (var guid in Order)
            {
                var reach = ParamNum(guid, "sight", 0);
                var sees = reach > 0 && IsPresent(guid) && Poses.TryGetValue(guid, out var pose) && Sees(pose, reach, ParamNum(guid, "fov", 90));
                if (sees && Seen.Add(guid)) { ActorSpotted?.Invoke(guid); RunRules(guid, "spotted"); }
                else if (!sees && Seen.Remove(guid)) { ActorLostSight?.Invoke(guid); RunRules(guid, "lost"); }
            }
        }

        bool Sees(ActorPose p, double reach, double fov)
        {
            double dx = Player[0] - p.X, dz = Player[2] - p.Z;
            var d = Math.Sqrt(dx * dx + dz * dz);
            if (d > reach || Math.Abs(Player[1] - p.Y) > 3) return false;
            if (d > 1e-6 && fov < 360 && p.Faces)
            {
                var f = Math.Sqrt(p.FacingX * p.FacingX + p.FacingZ * p.FacingZ);
                if (f > 1e-9 && (p.FacingX * dx + p.FacingZ * dz) / (f * d) < Math.Cos(fov / 2 * Math.PI / 180) - 1e-9) return false;
            }
            if (Blocked == null) return true;
            var eye = (p.Y + Player[1]) / 2 + 1.6;
            return !Blocked(new[] { p.X, eye, p.Z }, new[] { Player[0], eye, Player[2] });
        }

        /// <summary>Walk a pose toward (x, y, z) at most by metres; true when it gets there.</summary>
        /// <summary>While an actor sees the Player: face them, and for a chase close in to arm's reach (1 m) at its chase speed.</summary>
        public static void StepReaction(ActorPose p, string reaction, double speed, double dt, double x, double y, double z)
        {
            double dx = x - p.X, dz = z - p.Z;
            var d = Math.Sqrt(dx * dx + dz * dz);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (reaction != "chase" || d <= 1) { p.Moving = false; return; }
            Walk(p, p.X + dx * (d - 1) / d, y, p.Z + dz * (d - 1) / d, Math.Max(0.1, speed) * dt);
        }

        static bool Walk(ActorPose p, double x, double y, double z, double by)
        {
            var dx = x - p.X;
            var dz = z - p.Z;
            var d = Math.Sqrt(dx * dx + dz * dz);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (d <= by || d < 1e-6)
            {
                p.X = x; p.Y = y; p.Z = z;
                p.Moving = d > 1e-6;
                return true;
            }
            var k = by / d;
            p.X += dx * k; p.Y += (y - p.Y) * k; p.Z += dz * k;
            p.Moving = true;
            return false;
        }

        /// <summary>One patrol step: wait at a stop, else walk on to it; arriving starts the wait and aims at the next, round and round. now is the level time after the step.</summary>
        public static void StepPatrol(ActorPose p, Dictionary<string, object> motion, double dt, double now)
        {
            if (now < p.Until) { p.Moving = false; return; }
            var stops = D.List(motion, "stops");
            if (stops.Count == 0) return;
            var stop = D.Map(stops[p.Stop % stops.Count]);
            var at = D.List(stop, "at");
            if (at.Count < 3) return;
            if (!Walk(p, D.Num(at[0], 0), D.Num(at[1], 0), D.Num(at[2], 0), D.Num(motion, "speed", 1.4) * dt)) return;
            p.Moving = false;
            p.Until = now + D.Num(stop, "wait", 0);
            p.Stop = (p.Stop + 1) % stops.Count;
        }

        /// <summary>One follow step: keep within the follow distance of the player at (x, y, z), faster when far; more than CatchUp behind, or another floor, and it catches up at once.</summary>
        public static void StepFollow(ActorPose p, Dictionary<string, object> motion, double dt, double x, double y, double z)
        {
            var dx = x - p.X;
            var dz = z - p.Z;
            var d = Math.Sqrt(dx * dx + dz * dz);
            var distance = D.Num(motion, "distance", 2);
            if (d > 1e-6) { p.FacingX = dx; p.FacingZ = dz; p.Faces = true; }
            if (d > CatchUp || Math.Abs(y - p.Y) > 3)
            {
                var k = d > 1e-6 ? distance / d : 0;
                p.X = x - dx * k; p.Y = y; p.Z = z - (d > 1e-6 ? dz * k : distance);
                p.Moving = false;
            }
            else if (d <= distance) p.Moving = false;
            else
            {
                var speed = D.Num(motion, "speed", 3.5) * (d > distance * 2.5 ? 1.6 : 1);
                var k = (d - distance) / d;
                Walk(p, p.X + dx * k, y, p.Z + dz * k, speed * dt);
            }
        }

        /// <summary>Run an item's rules for an event: each checks its conditions, then changes the story and the level.</summary>
        public void RunRules(string guid, string on, string detail = "")
        {
            foreach (var r in D.List(Item(guid), "rules"))
            {
                var rule = D.Map(r);
                if (D.Str(rule, "on") != on) continue;
                if (on == "custom" && detail != "" && D.Str(rule, "detail") != detail) continue;
                Run(guid, rule);
            }
        }

        void Run(string guid, Dictionary<string, object> rule)
        {
            if (!Rules.Check(D.Get(rule, "when"), Game)) return;
            Rules.Apply(D.Get(rule, "effects"), Game);
            foreach (var a in D.List(rule, "actions")) Act(D.Map(a));
            Refreshed?.Invoke();
        }

        void Act(Dictionary<string, object> action)
        {
            var target = D.Str(action, "target");
            switch (D.Str(action, "kind"))
            {
                case "open": Open[target] = true; break;
                case "close": Open[target] = false; break;
                case "enable": Enabled[target] = true; break;
                case "disable": Enabled[target] = false; break;
                case "spawn": Spawn(target); break;
                case "despawn": Gone.Add(target); break;
                case "startScene": Game.Visit(target); SceneRequested?.Invoke(target); break;
                case "playCinematic": CinematicRequested?.Invoke(target); break;
                case "playAudio": AudioRequested?.Invoke(target, ParamStr(target, "sound")); break;
                case "objective":
                    Objective = ParamStr(target, "objective") != "" ? ParamStr(target, "objective") : D.Str(Item(target), "name");
                    ObjectiveChanged?.Invoke(Objective);
                    break;
                case "goToLevel": LevelRequested?.Invoke(target); break;
                case "refuel": LightFuel = LightFuelFull; Message?.Invoke("Your light is full again."); break;
            }
        }

        void Spawn(string guid)
        {
            Done.Add(guid);
            SpawnRequested?.Invoke(guid, ParamStr(guid, "actor"), (int)ParamNum(guid, "count", 1));
        }

        void OnChanged()
        {
            if (depth > 3) return;
            depth++;
            foreach (var guid in Order) if (IsPresent(guid)) RunRules(guid, "stateChange");
            depth--;
            Refreshed?.Invoke();
        }
    }
}
`,

  'VcgsLevel.cs': String.raw`${HEAD}
using System.Collections.Generic;
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// A level in the scene: the root that VCGS › Update level from data… builds.
    /// Runs LevelLogic on the story's GameState and shows what is there: items
    /// come and go with their conditions, doors open and shut.
    /// </summary>
    /// <summary>A plain stand-in person (legs, hips, torso, arms, head, nose), feet at 0, facing +Z (the data's north): the same figure as the studio's Play Mode.</summary>
    public static class VcgsFigure
    {
        public static Transform Build(Transform parent, Color color, float height = 1.75f)
        {
            var k = height / 1.75f;
            var figure = new GameObject("Figure").transform;
            figure.SetParent(parent, false);
            var dark = new Color(color.r * 0.55f, color.g * 0.55f, color.b * 0.55f);
            var skin = new Color(0.85f, 0.71f, 0.56f);
            void Part(PrimitiveType type, Vector3 at, Vector3 size, Color tint)
            {
                var part = GameObject.CreatePrimitive(type);
                part.name = type.ToString();
                // Only something to see: the player and the walls do the colliding.
                var collider = part.GetComponent<Collider>();
                if (collider != null) Object.Destroy(collider);
                part.transform.SetParent(figure, false);
                part.transform.localPosition = at * k;
                part.transform.localScale = size * k;
                var renderer = part.GetComponent<Renderer>();
                if (renderer != null && renderer.sharedMaterial != null) renderer.sharedMaterial = new Material(renderer.sharedMaterial) { color = tint };
            }
            // A capsule is 2 tall and 1 across at scale 1.
            Part(PrimitiveType.Capsule, new Vector3(-0.1f, 0.44f, 0), new Vector3(0.15f, 0.42f, 0.15f), dark);
            Part(PrimitiveType.Capsule, new Vector3(0.1f, 0.44f, 0), new Vector3(0.15f, 0.42f, 0.15f), dark);
            Part(PrimitiveType.Cube, new Vector3(0, 0.88f, 0), new Vector3(0.34f, 0.16f, 0.2f), dark);
            Part(PrimitiveType.Cube, new Vector3(0, 1.2f, 0), new Vector3(0.38f, 0.5f, 0.22f), color);
            Part(PrimitiveType.Capsule, new Vector3(-0.25f, 1.12f, 0), new Vector3(0.12f, 0.31f, 0.12f), color);
            Part(PrimitiveType.Capsule, new Vector3(0.25f, 1.12f, 0), new Vector3(0.12f, 0.31f, 0.12f), color);
            Part(PrimitiveType.Cylinder, new Vector3(0, 1.49f, 0), new Vector3(0.1f, 0.04f, 0.1f), skin);
            Part(PrimitiveType.Sphere, new Vector3(0, 1.62f, 0), new Vector3(0.24f, 0.24f, 0.24f), skin);
            Part(PrimitiveType.Cube, new Vector3(0, 1.61f, 0.14f), new Vector3(0.04f, 0.04f, 0.07f), skin);
            return figure;
        }
    }

    public sealed class VcgsLevel : MonoBehaviour
    {
        [Tooltip("The generated level data (Assets/VCGS/Generated/Levels/<level>.json).")]
        public TextAsset level = null;
        [Tooltip("The map's key in VC Game Studio: its children find their parent by it.")]
        public string key = "";
        [Tooltip("How the game reaches it (spec V2 §13): continuous, streamed, instanced, transition or mapOnly.")]
        public string boundary = "continuous";

        public LevelLogic Logic { get; private set; }
        readonly Dictionary<string, VcgsLevelItem> items = new Dictionary<string, VcgsLevelItem>();

        void Start()
        {
            var game = VcgsGame.Instance;
            if (game == null || level == null)
            {
                Debug.LogError("VcgsLevel needs a VcgsGame in the scene and its level data.");
                return;
            }
            Setup(game.State);
        }

        /// <summary>Wire the level to a GameState (Start does this with VcgsGame's).</summary>
        public void Setup(GameState state)
        {
            Logic = LevelLogic.FromJson(level.text, state);
            items.Clear();
            foreach (var item in GetComponentsInChildren<VcgsLevelItem>(true))
            {
                // A child map built inside this one (under Maps) runs its own items.
                if (!OwnedBy(transform, item.transform)) continue;
                items[item.guid] = item;
                item.Level = this;
            }
            Logic.Refreshed += Refresh;
            Dress();
            // Sight is blocked by anything solid but the player and the actors themselves.
            Logic.Blocked = (a, b) =>
            {
                var from = transform.TransformPoint(new Vector3((float)a[0], (float)a[1], (float)-a[2]));
                var to = transform.TransformPoint(new Vector3((float)b[0], (float)b[1], (float)-b[2]));
                foreach (var hit in Physics.RaycastAll(from, to - from, Vector3.Distance(from, to)))
                {
                    if (player != null && hit.transform.IsChildOf(player)) continue;
                    var item = hit.transform.GetComponentInParent<VcgsLevelItem>();
                    if (item != null && Logic.Poses.ContainsKey(item.guid)) continue;
                    return true;
                }
                return false;
            };
            Refresh();
        }

        [Tooltip("Who companions follow; the GameObject tagged Player when empty.")]
        public Transform player = null;

        void Update()
        {
            if (Logic == null) return;
            // The player in level space: Unity's +Z is the data's north (−z).
            if (player == null) player = GameObject.FindWithTag("Player")?.transform;
            if (player != null)
            {
                var at = transform.InverseTransformPoint(player.position);
                Logic.Player = new double[] { at.x, at.y, -at.z };
            }
            Logic.Tick(Time.deltaTime);
            MoveActors();
            Stream();
        }

        /// <summary>The child maps built inside this one (under Maps), by key.</summary>
        public Dictionary<string, VcgsLevel> ChildLevels()
        {
            var found = new Dictionary<string, VcgsLevel>();
            var holder = transform.Find("Maps");
            if (holder == null) return found;
            for (var i = 0; i < holder.childCount; i++)
            {
                var child = holder.GetChild(i).GetComponent<VcgsLevel>();
                if (child != null) found[child.key] = child;
            }
            return found;
        }

        /// <summary>Streamed children (spec V2 §13): switched on as the player nears them, off again when well away.</summary>
        public void Stream()
        {
            var children = ChildLevels();
            var loaded = new List<string>();
            foreach (var pair in children) if (pair.Value.gameObject.activeSelf) loaded.Add(pair.Key);
            var unload = new List<string>();
            foreach (var k in Logic.StreamChanges(loaded, unload)) if (children.TryGetValue(k, out var c)) c.gameObject.SetActive(true);
            foreach (var k in unload) if (children.TryGetValue(k, out var c)) c.gameObject.SetActive(false);
        }

        /// <summary>Take a travel link (spec V2 §13); "" when the player goes, else why not. Answer Logic.TravelRequested to move them.</summary>
        public string Travel(string link, bool reverse = false) => Logic != null ? Logic.TakeTravel(link, reverse) : "";

        [Tooltip("Give the Player a stand-in figure when it has nothing of its own to show.")]
        public bool dressPlayer = true;

        static readonly Dictionary<string, Color> People = new Dictionary<string, Color>
        {
            ["npc"] = new Color(0.85f, 0.38f, 0.48f),
            ["enemy"] = new Color(0.9f, 0.28f, 0.3f),
            ["companion"] = new Color(0.37f, 0.66f, 0.83f),
            ["neutral"] = new Color(0.6f, 0.56f, 0.48f),
        };

        /// <summary>
        /// In play, as in the studio's Play Mode: characters show as stand-in figures, and the
        /// designer's markers (player start, patrol stops, spawns) and anything set not visible are
        /// hidden. They still show in the editor. Final art (an Art child) is left alone.
        /// </summary>
        void Dress()
        {
            foreach (var pair in items)
            {
                var item = pair.Value;
                if (item.transform.Find("Art") != null) continue;
                var role = Logic.Role(pair.Key);
                var kind = Logic.Item(pair.Key).TryGetValue("kind", out var k) ? k as string : "";
                var proxy = item.transform.Find("Proxy");
                var person = People.TryGetValue(role, out var color);
                var hidden = Logic.Param(pair.Key, "visible") is bool shown && !shown;
                if (proxy != null && (person || (kind == "marker") || (kind != "space" && hidden))) proxy.gameObject.SetActive(false);
                if (person && item.transform.Find("Figure") == null) VcgsFigure.Build(item.transform, color);
            }
            if (player == null) player = GameObject.FindWithTag("Player")?.transform;
            if (dressPlayer && player != null && player.GetComponentInChildren<Renderer>() == null && player.Find("Figure") == null)
                VcgsFigure.Build(player, new Color(0.79f, 0.64f, 0.29f));
        }

        /// <summary>Put each actor that moves (patrols, companions) where LevelLogic has it, facing the way it goes.</summary>
        public void MoveActors()
        {
            foreach (var pair in Logic.Poses)
            {
                if (!items.TryGetValue(pair.Key, out var item)) continue;
                var p = pair.Value;
                item.transform.localPosition = new Vector3((float)p.X, (float)p.Y, (float)-p.Z);
                if (p.Faces) item.transform.localEulerAngles = new Vector3(0, (float)(System.Math.Atan2(p.FacingX, -p.FacingZ) * 180 / System.Math.PI), 0);
            }
        }

        /// <summary>Show what is there and hide what is not; open and shut doors.</summary>
        public void Refresh()
        {
            if (Logic == null) return;
            foreach (var pair in items)
            {
                var here = Logic.IsPresent(pair.Key);
                pair.Value.gameObject.SetActive(here);
                if (Logic.Role(pair.Key) != "door") continue;
                var shut = here && !Logic.IsOpen(pair.Key);
                foreach (var part in new[] { "Proxy", "Art", "Collision" })
                {
                    var child = pair.Value.transform.Find(part);
                    if (child != null) child.gameObject.SetActive(shut);
                }
            }
        }

        /// <summary>Whether this item is the level's own, not a nested child map's.</summary>
        public static bool OwnedBy(Transform level, Transform t)
        {
            for (var at = t.parent; at != null && at != level; at = at.parent)
                if (at.GetComponent<VcgsLevel>() != null) return false;
            return true;
        }

        public VcgsLevelItem ItemFor(string guid) => items.TryGetValue(guid, out var item) ? item : null;

        /// <summary>The nearest item the player can use from where they stand, or "".</summary>
        public string NearestOffer(Vector3 from, Vector3 facing)
        {
            var best = "";
            var bestD = float.MaxValue;
            foreach (var pair in items)
            {
                if (Logic.Offer(pair.Key) == null) continue;
                var to = pair.Value.transform.position - from;
                to.y = 0;
                var size = D.List(Logic.Item(pair.Key), "size");
                var reach = (float)Logic.ParamNum(pair.Key, "range", 1.5) + System.Math.Max(D.Num(size.Count > 2 ? size[0] : null, 1), D.Num(size.Count > 2 ? size[2] : null, 1)) / 2f + 0.3f;
                var d = to.magnitude;
                if (d > reach || d >= bestD) continue;
                if (facing != Vector3.zero && d > 0.6f && Vector3.Dot(to.normalized, facing.normalized) < 0.3f) continue;
                best = pair.Key;
                bestD = d;
            }
            return best;
        }

        public string Interact(string guid) => Logic != null ? Logic.Interact(guid) : "";

        /// <summary>Gear, skills and crafting (spec §8): bind your own keys to these (the studio uses R to use what is in hand, I for the gear screen).</summary>
        public string UseInHand() => Logic != null ? Logic.UseInHand() : "";
        public List<GearOption> GearMenu() => Logic != null ? Logic.GearMenu() : new List<GearOption>();
        public string GearText() => Logic != null ? Logic.GearText() : "";
        public string GearDo(string act, string key) => Logic != null ? Logic.GearDo(act, key) : "";
    }
}
`,

  'VcgsTravelLink.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// A travel link from VC Game Studio (spec V2 §13): a road, trail, river,
    /// route or transition, drawn as a line in the Scene view. Take it with
    /// VcgsLevel.Travel(key); its lock and where it leads are in the level data.
    /// </summary>
    public sealed class VcgsTravelLink : MonoBehaviour
    {
        public string key = "";
        public string kind = "";
        [Tooltip("The map it takes the player to, if any.")]
        public string toMap = "";
        public Vector3[] points = new Vector3[0];

        void OnDrawGizmos()
        {
            Gizmos.color = toMap != "" ? new Color(0.6f, 0.5f, 0.75f) : new Color(0.79f, 0.64f, 0.36f);
            Gizmos.matrix = transform.localToWorldMatrix;
            for (var i = 1; i < points.Length; i++) Gizmos.DrawLine(points[i - 1], points[i]);
        }
    }
}
`,

  'VcgsLevelItem.cs': String.raw`${HEAD}
using UnityEngine;

namespace VCGS
{
    /// <summary>
    /// One level item: its GUID (which never changes) and what VC Game Studio
    /// last sent for it. A trigger volume tells the level when the player (the
    /// GameObject tagged Player) comes and goes.
    /// </summary>
    public sealed class VcgsLevelItem : MonoBehaviour
    {
        public string guid = "";
        public string exportName = "";
        public string role = "";
        public string revision = "";
        [Tooltip("An artist's final art is in place: re-export updates layout and logic but never the art.")]
        public bool replacementLocked = false;
        [Tooltip("Where VC Game Studio last put it. A different position here means it was moved in Unity.")]
        public Vector3 exportedPosition = Vector3.zero;
        public float exportedYaw = 0;
        public bool exported = false;

        public VcgsLevel Level { get; set; }

        // A freeform volume is several convex triggers: the player is in it from the first one entered until the last one left.
        int overlaps;

        void OnTriggerEnter(Collider other)
        {
            if (!other.CompareTag("Player")) return;
            if (overlaps++ == 0 && Level != null && Level.Logic != null) Level.Logic.Enter(guid);
        }

        void OnTriggerExit(Collider other)
        {
            if (!other.CompareTag("Player") || overlaps == 0) return;
            if (--overlaps == 0 && Level != null && Level.Logic != null) Level.Logic.Exit(guid);
        }
    }
}
`,
};

export const LEVEL_EDITOR_FILES: Record<string, string> = {
  'VcgsLevelBuilder.cs': String.raw`// VCGS Editor tools for Unity. The same for every project; safe to commit.
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace VCGS.EditorTools
{
    /// <summary>
    /// Builds a level in the open scene from VC Game Studio's level data, or
    /// updates the one already there. Items are matched by GUID, so a re-export
    /// changes what is there instead of replacing it. Who owns what:
    /// VC Game Studio owns each item's place, name, collision, proxy and data;
    /// everything else under an item (its Art, anything added in Unity) is the
    /// team's and is never touched. An item moved in Unity keeps its place and
    /// is reported, unless the update is told VC Game Studio wins. Items gone
    /// from the level are reported and left for you to delete.
    /// </summary>
    public static class VcgsLevelBuilder
    {
        const string Materials = "Assets/VCGS/Generated/Levels/Materials";
        const string Meshes = "Assets/VCGS/Generated/Levels/Meshes";

        [MenuItem("VCGS/Update level from data…")]
        static void UpdateKeepingEdits() => Pick(false);

        [MenuItem("VCGS/Update level from data (VC Game Studio wins)…")]
        static void UpdateOverwriting() => Pick(true);

        static void Pick(bool overwrite)
        {
            var path = EditorUtility.OpenFilePanel("Level data", "Assets/VCGS/Generated/Levels", "json");
            if (string.IsNullOrEmpty(path)) return;
            var report = Build(File.ReadAllText(path), AssetPathOf(path), overwrite);
            foreach (var line in report) Debug.Log(line);
        }

        static string AssetPathOf(string path)
        {
            var at = path.Replace('\\', '/').IndexOf("/Assets/");
            return at >= 0 ? path.Substring(at + 1) : path;
        }

        /// <summary>VC Game Studio (x east, y up, z south) to Unity (z north).</summary>
        public static Vector3 ToUnity(List<object> v) =>
            new Vector3((float)D.Num(v.Count > 0 ? v[0] : null, 0), (float)D.Num(v.Count > 1 ? v[1] : null, 0), -(float)D.Num(v.Count > 2 ? v[2] : null, 0));

        /// <summary>Build or update the level; returns what it did and what it left alone.</summary>
        public static List<string> Build(string json, string assetPath, bool overwrite)
        {
            var report = new List<string>();
            var data = D.Map(Json.Parse(json));
            var rootName = D.Str(data, "export_name");
            var key = D.Str(data, "key");
            var map = D.Map(data, "map");
            // The map already in the scene, found by its key (a streamed child may be switched off), or by its name.
            var root = FindLevel(key)?.gameObject ?? GameObject.Find(rootName);
            if (root == null)
            {
                root = new GameObject(rootName);
                Undo.RegisterCreatedObjectUndo(root, "Build level");
                report.Add("Created " + rootName + ".");
            }
            // Unity objects compare to null with ==, never ??: a missing component can be a stand-in object.
            var level = root.GetComponent<VcgsLevel>();
            if (level == null) level = root.AddComponent<VcgsLevel>();
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(assetPath);
            if (asset != null) level.level = asset;

            var existing = new Dictionary<string, VcgsLevelItem>();
            foreach (var item in root.GetComponentsInChildren<VcgsLevelItem>(true))
                if (VcgsLevel.OwnedBy(root.transform, item.transform)) existing[item.guid] = item;
            level.key = key;
            level.boundary = D.Str(map, "boundary") != "" ? D.Str(map, "boundary") : "continuous";
            var seen = new HashSet<string>();

            foreach (var o in D.List(data, "items"))
            {
                var data_ = D.Map(o);
                var guid = D.Str(data_, "guid");
                var exportName = D.Str(data_, "export_name");
                seen.Add(guid);
                if (!existing.TryGetValue(guid, out var item))
                {
                    var go = new GameObject(exportName);
                    go.transform.SetParent(root.transform, false);
                    item = go.AddComponent<VcgsLevelItem>();
                    item.guid = guid;
                    report.Add("Added " + exportName + ".");
                }
                else if (item.revision == D.Str(data_, "revision") && !overwrite)
                {
                    continue;
                }
                if (item.name != exportName) report.Add("Renamed " + item.name + " to " + exportName + ".");
                item.name = exportName;
                item.exportName = exportName;
                item.role = D.Str(data_, "role");
                item.replacementLocked = D.Bool(data_, "replacement_locked");

                // Its place: an edit made in Unity since the last export is kept (and said), unless VC Game Studio wins.
                var position = ToUnity(D.List(data_, "position"));
                var yaw = -(float)D.Num(data_, "turn");
                var moved = item.exported && ((item.transform.localPosition - item.exportedPosition).sqrMagnitude > 1e-6f || Mathf.Abs(Mathf.DeltaAngle(item.transform.localEulerAngles.y, item.exportedYaw)) > 0.01f);
                if (moved && !overwrite)
                {
                    report.Add(exportName + " was moved in Unity: kept where it is. Update with “VC Game Studio wins” to put it back.");
                }
                else
                {
                    item.transform.localPosition = position;
                    item.transform.localRotation = Quaternion.Euler(0, yaw, 0);
                }
                item.exportedPosition = position;
                item.exportedYaw = yaw;
                item.exported = true;
                item.revision = D.Str(data_, "revision");
                if (D.Str(data_, "role") == "playerStart") item.gameObject.tag = "Respawn";

                var pieces = D.List(data_, "pieces");
                // Collision is always VC Game Studio's.
                Clear(item.transform.Find("Collision"));
                var collision = Child(item.transform, "Collision");
                var n = 0;
                foreach (var p in pieces)
                {
                    var piece = D.Map(p);
                    // A volume that collides is a state gate blocking the way: solid as well as a trigger.
                    if (!D.Bool(piece, "collide")) continue;
                    var holder = Child(collision, D.Str(piece, "part") + "_" + (n++));
                    Place(holder, piece);
                    if (D.Str(piece, "shape") == "slab")
                    {
                        // A freeform floor or ceiling collides by its own shape.
                        holder.gameObject.AddComponent<MeshCollider>().sharedMesh = Slab(piece, exportName + "_" + holder.name);
                        continue;
                    }
                    var box = holder.gameObject.AddComponent<BoxCollider>();
                    box.size = Size(piece);
                }
                // A volume notices the player in its box.
                Dictionary<string, object> zone = null;
                foreach (var p in pieces)
                {
                    var piece = D.Map(p);
                    if (D.Str(piece, "part") == "volume" && D.Str(piece, "shape") == "slab") zone = piece;
                }
                foreach (var old in item.GetComponents<MeshCollider>()) Object.DestroyImmediate(old);
                if (zone != null)
                {
                    // A freeform volume: a convex trigger per triangle of its outline (Unity's triggers must be convex).
                    var box = item.GetComponent<BoxCollider>();
                    if (box != null) Object.DestroyImmediate(box);
                    var prisms = Prisms(zone, exportName);
                    foreach (var mesh in prisms)
                    {
                        var c = item.gameObject.AddComponent<MeshCollider>();
                        c.sharedMesh = mesh;
                        c.convex = true;
                        c.isTrigger = true;
                    }
                }
                else if (D.Str(data_, "kind") == "volume")
                {
                    var size = D.List(data_, "size");
                    var trigger = item.GetComponent<BoxCollider>();
                    if (trigger == null) trigger = item.gameObject.AddComponent<BoxCollider>();
                    trigger.isTrigger = true;
                    trigger.size = new Vector3((float)D.Num(size[0], 1), (float)D.Num(size[1], 1), (float)D.Num(size[2], 1));
                    trigger.center = new Vector3(0, trigger.size.y / 2, 0);
                }

                // What it looks like: the art when there is some, the proxy unless the art is locked.
                var finalAsset = D.Str(data_, "final_asset");
                if (finalAsset != "" && item.transform.Find("Art") == null)
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(finalAsset);
                    if (prefab != null)
                    {
                        var art = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                        art.name = "Art";
                        art.transform.SetParent(item.transform, false);
                    }
                    else report.Add(exportName + ": its final asset " + finalAsset + " isn’t in this project.");
                }
                Clear(item.transform.Find("Proxy"));
                if (finalAsset == "" && !item.replacementLocked && D.Str(data_, "kind") != "volume")
                {
                    var proxy = Child(item.transform, "Proxy");
                    var m = 0;
                    foreach (var p in pieces)
                    {
                        var piece = D.Map(p);
                        var shape = D.Str(piece, "shape");
                        if (D.Str(piece, "part") == "volume" || shape == "cone") continue;
                        if (shape == "slab")
                        {
                            var slab = Child(proxy, D.Str(piece, "part") + "_" + (m++)).gameObject;
                            Place(slab.transform, piece);
                            slab.AddComponent<MeshFilter>().sharedMesh = Slab(piece, exportName + "_" + slab.name);
                            slab.AddComponent<MeshRenderer>().sharedMaterial = MaterialFor(D.Str(piece, "color"), (float)D.Num(piece, "opacity", 1));
                            continue;
                        }
                        var go = shape == "sphere" ? GameObject.CreatePrimitive(PrimitiveType.Sphere)
                            : shape == "cylinder" ? GameObject.CreatePrimitive(PrimitiveType.Cylinder)
                            : GameObject.CreatePrimitive(PrimitiveType.Cube);
                        Object.DestroyImmediate(go.GetComponent<Collider>());
                        go.name = D.Str(piece, "part") + "_" + (m++);
                        go.transform.SetParent(proxy, false);
                        Place(go.transform, piece);
                        var s = Size(piece);
                        // Unity's cylinder is two units tall.
                        go.transform.localScale = shape == "cylinder" ? new Vector3(s.x, s.y / 2, s.z) : s;
                        if (shape == "wedge") go.GetComponent<MeshFilter>().sharedMesh = Wedge();
                        go.GetComponent<MeshRenderer>().sharedMaterial = MaterialFor(D.Str(piece, "color"), (float)D.Num(piece, "opacity", 1));
                    }
                }

                // Lights.
                foreach (var p in pieces)
                {
                    var light = D.Map(D.Get(D.Map(p), "light"));
                    if (light.Count == 0) continue;
                    var holder = item.transform.Find("Light");
                    if (holder == null) holder = Child(item.transform, "Light");
                    Place(holder, D.Map(p));
                    var l = holder.GetComponent<Light>();
                    if (l == null) l = holder.gameObject.AddComponent<Light>();
                    l.type = D.Str(light, "kind") == "spot" ? LightType.Spot : LightType.Point;
                    l.color = ColorOf(D.Str(light, "color"), 1);
                    l.intensity = (float)D.Num(light, "intensity", 1);
                    l.range = (float)D.Num(light, "range", 8);
                    if (l.type == LightType.Spot) l.spotAngle = (float)D.Num(light, "angle", 40);
                }
            }
            foreach (var pair in existing)
                if (!seen.Contains(pair.Key)) report.Add(pair.Value.name + " is no longer in the level: left in place for you to delete.");
            // Travel links (spec V2 §13): one GameObject each under Travel, its points for the gizmo.
            Clear(root.transform.Find("Travel"));
            var travel = D.List(data, "travel");
            if (travel.Count > 0)
            {
                var holder = Child(root.transform, "Travel");
                foreach (var o in travel)
                {
                    var t = D.Map(o);
                    var link = Child(holder, D.Str(t, "key")).gameObject.AddComponent<VcgsTravelLink>();
                    link.key = D.Str(t, "key");
                    link.kind = D.Str(t, "kind");
                    link.toMap = D.Str(t, "to_map");
                    link.points = D.List(t, "points").ConvertAll(p => ToUnity(D.List(p))).ToArray();
                }
            }
            // The hierarchy (spec V2 §12): a child goes inside its parent's Maps at its placement, whichever is built first.
            var parent = FindLevel(D.Str(map, "parent"));
            if (parent != null && parent != level) Nest(parent, level, D.Map(map, "placement"), report);
            foreach (var o in D.List(map, "children"))
            {
                var c = D.Map(o);
                var child = FindLevel(D.Str(c, "key"));
                if (child != null && child != level) Nest(level, child, D.Map(c, "placement"), report);
            }
            EditorSceneManager.MarkSceneDirty(root.scene);
            report.Add(rootName + ": " + seen.Count + " items up to date.");
            return report;
        }

        /// <summary>The map with this key in the open scene, switched on or not.</summary>
        static VcgsLevel FindLevel(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            foreach (var go in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
                foreach (var l in go.GetComponentsInChildren<VcgsLevel>(true))
                    if (l.key == key) return l;
            return null;
        }

        /// <summary>Put a child map inside its parent: under Maps at its placement (continuous and streamed children; a streamed one starts switched off). Others stay where they are.</summary>
        static void Nest(VcgsLevel parent, VcgsLevel child, Dictionary<string, object> placement, List<string> report)
        {
            if (placement.Count == 0) return;
            var maps = parent.transform.Find("Maps");
            if (maps == null) maps = Child(parent.transform, "Maps");
            child.transform.SetParent(maps, false);
            child.transform.localPosition = ToUnity(D.List(placement, "position"));
            child.transform.localRotation = Quaternion.Euler(0, -(float)D.Num(placement, "turn"), 0);
            child.gameObject.SetActive(child.boundary != "streamed");
            report.Add(child.gameObject.name + " is inside " + parent.gameObject.name + (child.boundary == "streamed" ? ", streamed in as the player nears it." : "."));
        }

        static void Place(Transform t, Dictionary<string, object> piece)
        {
            t.localPosition = ToUnity(D.List(piece, "at"));
            t.localRotation = Quaternion.Euler(0, -(float)D.Num(piece, "turn"), 0);
        }

        static Vector3 Size(Dictionary<string, object> piece)
        {
            var s = D.List(piece, "size");
            return new Vector3((float)D.Num(s[0], 1), (float)D.Num(s[1], 1), (float)D.Num(s[2], 1));
        }

        static Transform Child(Transform parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go.transform;
        }

        static void Clear(Transform t)
        {
            if (t != null) Object.DestroyImmediate(t.gameObject);
        }

        static Color ColorOf(string hex, float alpha)
        {
            var n = int.Parse(hex.TrimStart('#').Substring(0, 6), System.Globalization.NumberStyles.HexNumber);
            return new Color(((n >> 16) & 255) / 255f, ((n >> 8) & 255) / 255f, (n & 255) / 255f, alpha);
        }

        /// <summary>One material per colour, saved so the scene keeps it.</summary>
        static Material MaterialFor(string hex, float alpha)
        {
            var path = Materials + "/" + hex.TrimStart('#') + (alpha < 1 ? "_" + Mathf.RoundToInt(alpha * 100) : "") + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            Folder(Materials);
            material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            material.color = ColorOf(hex, alpha);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        /// <summary>
        /// A slab: its outline (x, z in VC Game Studio's frame, clockwise seen
        /// from above) raised to its thickness about its centre, saved as an
        /// asset so the scene keeps it. Unity's z is VC Game Studio's −z; seen
        /// from above both are the same map, so clockwise stays clockwise.
        /// </summary>
        static Mesh Slab(Dictionary<string, object> piece, string name)
        {
            var outline = D.List(piece, "outline");
            var triangles = D.List(piece, "triangles");
            var h = (float)D.Num(D.List(piece, "size")[1], 0.1) / 2;
            var n = outline.Count;
            var corner = new Vector3[n];
            for (var i = 0; i < n; i++)
            {
                var p = D.List(outline[i]);
                corner[i] = new Vector3((float)D.Num(p[0], 0), 0, -(float)D.Num(p[1], 0));
            }
            var vertices = new List<Vector3>();
            var tris = new List<int>();
            // Top and bottom: their own corners, so each face gets its own normals.
            for (var i = 0; i < n; i++) vertices.Add(corner[i] + new Vector3(0, h, 0));
            for (var i = 0; i < n; i++) vertices.Add(corner[i] - new Vector3(0, h, 0));
            for (var k = 0; k + 2 < triangles.Count; k += 3)
            {
                int a = (int)D.Num(triangles[k], 0), b = (int)D.Num(triangles[k + 1], 0), c = (int)D.Num(triangles[k + 2], 0);
                tris.AddRange(new[] { a, b, c });
                tris.AddRange(new[] { n + a, n + c, n + b });
            }
            // Sides: a quad per edge, facing out.
            for (var i = 0; i < n; i++)
            {
                var j = (i + 1) % n;
                var s = vertices.Count;
                vertices.Add(corner[j] + new Vector3(0, h, 0));
                vertices.Add(corner[i] + new Vector3(0, h, 0));
                vertices.Add(corner[i] - new Vector3(0, h, 0));
                vertices.Add(corner[j] - new Vector3(0, h, 0));
                tris.AddRange(new[] { s, s + 1, s + 2, s, s + 2, s + 3 });
            }
            var mesh = new Mesh { name = name };
            mesh.vertices = vertices.ToArray();
            mesh.triangles = tris.ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            Folder(Meshes);
            AssetDatabase.CreateAsset(mesh, Meshes + "/" + name + ".asset");
            return mesh;
        }

        /// <summary>A slab cut into upright prisms, one per triangle, relative to the item and saved as assets.</summary>
        static List<Mesh> Prisms(Dictionary<string, object> piece, string name)
        {
            var outline = D.List(piece, "outline");
            var triangles = D.List(piece, "triangles");
            var h = (float)D.Num(D.List(piece, "size")[1], 1) / 2;
            var centre = ToUnity(D.List(piece, "at"));
            var meshes = new List<Mesh>();
            Folder(Meshes);
            for (var k = 0; k + 2 < triangles.Count; k += 3)
            {
                var v = new Vector3[6];
                for (var c = 0; c < 3; c++)
                {
                    var p = D.List(outline[(int)D.Num(triangles[k + c], 0)]);
                    var at = centre + new Vector3((float)D.Num(p[0], 0), 0, -(float)D.Num(p[1], 0));
                    v[c] = at + new Vector3(0, h, 0);
                    v[c + 3] = at - new Vector3(0, h, 0);
                }
                var mesh = new Mesh { name = name + "_zone_" + meshes.Count };
                mesh.vertices = v;
                mesh.triangles = new[] { 0, 1, 2, 3, 5, 4, 1, 0, 3, 1, 3, 4, 2, 1, 4, 2, 4, 5, 0, 2, 5, 0, 5, 3 };
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                AssetDatabase.CreateAsset(mesh, Meshes + "/" + mesh.name + ".asset");
                meshes.Add(mesh);
            }
            return meshes;
        }

        /// <summary>A unit wedge rising to the north, saved as an asset.</summary>
        static Mesh Wedge()
        {
            var path = Materials + "/Wedge.asset";
            var mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (mesh != null) return mesh;
            Folder(Materials);
            mesh = new Mesh { name = "VCGS Wedge" };
            mesh.vertices = new[]
            {
                new Vector3(-0.5f, -0.5f, -0.5f), new Vector3(0.5f, -0.5f, -0.5f), new Vector3(0.5f, -0.5f, 0.5f), new Vector3(-0.5f, -0.5f, 0.5f),
                new Vector3(-0.5f, 0.5f, 0.5f), new Vector3(0.5f, 0.5f, 0.5f),
            };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 4, 5, 0, 5, 1, 0, 3, 4, 1, 5, 2 };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            AssetDatabase.CreateAsset(mesh, path);
            return mesh;
        }

        static void Folder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path).Replace('\\', '/');
            Folder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }
}
`,
};

export const EDITOR_ASMDEF = `${JSON.stringify({ name: 'VCGS.Editor', rootNamespace: 'VCGS.EditorTools', references: ['VCGS.Runtime'], includePlatforms: ['Editor'], autoReferenced: true }, null, 2)}\n`;

/** The level's data for Unity: the level, and names for the story keys it mentions. */
export const levelJson = (level: IrLevel, names: Record<string, string>): string => JSON.stringify({ generator: 'VC Game Studio', format: 'vcgs-level-1', ...level, names }, null, 2);
