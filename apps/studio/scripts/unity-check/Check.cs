// Plays the sample project's generated story with the VCGS Runtime for Unity:
// the same walk as the Godot check (lever, trigger, puzzle, free play, the
// choice and its once-only option, the ending).
using System;
using System.Collections.Generic;
using System.IO;
using VCGS;
using VCGS.Keys;

static class Check
{
    static int failures;

    static void Fail(string message)
    {
        failures++;
        Console.Error.WriteLine("FAIL: " + message);
    }

    static int Main()
    {
        var story = Story.FromJson(File.ReadAllText("Assets/VCGS/Generated/story.json"));
        var game = new GameState(story);
        Console.WriteLine("story: " + story.Name + " · " + story.Scenes.Count + " scenes · starts at " + story.Start);
        if (game.GetFlag(Flags.DoorSolved) != "no") Fail("door_solved should start at no");
        if (game.GetObjectState(Objects.RustedLever) != "down") Fail("the lever should start down");
        // The quest starts only by an effect (finding the key): not yet.
        if (game.QuestState(Quests.OpenTheVault) != "") Fail("Open the vault should wait for its effect, is " + game.QuestState(Quests.OpenTheVault));
        if (game.KnowsLore(Lore.TheDrownedOrder) || game.HasMechanic(Mechanics.LanternOil)) Fail("the Order's lore and the lantern's oil should wait for their rules");
        var questsDone = new List<string>();
        game.QuestCompleted += q => questsDone.Add(q);

        // The whole story from the Beginning to the vault door.
        var node = StoryWalker.Onward(game, story.Start);
        if (node != Scenes.Sc01TheCaveMouth) Fail("the story should start at SC-01, got " + node);

        game.GiveItem(Items.VaultKey);
        var player = new ScenePlayer(game, Scenes.Sc03TheVaultDoor);
        var trace = new List<string>();
        var choices = new List<List<string>>();
        var finished = new List<string>();
        player.EventStarted += e => trace.Add(D.Str(e, "kind") + ":" + D.Str(e, "label"));
        player.ChoiceRequested += (key, options) => choices.Add(options);
        player.SceneFinished += next => finished.Add(next);
        var duals = new List<(string, string)>();
        var singles = new List<string>();
        player.DualRequested += (a, b) => duals.Add((a, b));
        player.DialogueRequested += l => singles.Add(l);
        player.Start();
        if (!game.Visited.Contains(Scenes.Sc03TheVaultDoor)) Fail("starting the scene should mark it visited");
        // Reaching the vault door reveals the Order's story.
        if (string.Join(",", game.KnownLore) != Lore.TheDrownedOrder || story.LoreEntry(Lore.TheDrownedOrder).name != "The Drowned Order") Fail("the vault door should reveal The Drowned Order, got " + string.Join(",", game.KnownLore));
        // The cinematic, then Mara and the Explorer at once (dual dialogue: one beat), then the echo cue.
        for (var i = 0; i < 3; i++) player.Advance();
        if (duals.Count != 1 || singles.Count != 0) Fail("Mara and the Explorer should speak at once, as one beat");
        else
        {
            string Speaker(string id) => story.Lines.TryGetValue(id, out var l) ? D.Str(l, "speaker") : "";
            Console.WriteLine("dual: " + Speaker(duals[0].Item1) + " + " + Speaker(duals[0].Item2));
            if (Speaker(duals[0].Item1) != "mara" || Speaker(duals[0].Item2) != "the_explorer") Fail("the pair should be Mara (left) then the Explorer");
        }
        // Both have spoken, so both are met; the codex lists only Mara, who has an entry.
        if (string.Join(",", game.MetCharacters) != "mara,the_explorer") Fail("speaking should meet Mara and the Explorer, got " + string.Join(",", game.MetCharacters));
        if (!new Codex(game).Text().Contains("\n\nCHARACTERS · 1 of 1 met\n\nMARA\nA guide who knows the flooded caves better than anyone alive. She carries the lantern.\n\nLOCATIONS · 1 of 1 visited\n\nVAULT CHAMBER\nA drowned hall under the old city, its bronze door sealed by the Order.\n\nITEMS")) Fail("the codex should list Mara, got " + new Codex(game).Text());
        if (choices.Count != 0) Fail("the choice should wait for the free play to end");
        if (string.Join(",", Interactions.AvailableVerbs(game, Objects.RustedLever)) != "Pull") Fail("the lever should offer Pull");
        if (!Interactions.Interact(game, Objects.RustedLever, "Pull")) Fail("Pull should work");
        // Pulling it puts the lever in the codex, with how it stands now.
        if (string.Join(",", game.UsedObjects) != Objects.RustedLever || !new Codex(game).Text().Contains("OBJECTS · 1 of 1 used\n\nRUSTED LEVER (up)\nAn iron lever half-buried by the door, stiff with rust. It works the old sluice.")) Fail("the codex should list the lever, got " + new Codex(game).Text());
        if (game.GetObjectState(Objects.RustedLever) != "up" || game.GetFlag(Flags.DoorSolved) != "yes") Fail("Pull should leave the lever up, and draining should set door_solved");
        if (!game.Fired.Contains(Triggers.SeamDrains) || !game.Solved.Contains(Puzzles.TheVaultDoor)) Fail("the lever should fire Seam drains and solve the door");
        if (choices.Count != 1) Fail("free play should end into the choice");
        player.Choose(1);
        player.Advance();
        player.Advance();
        player.Choose(0);
        Console.WriteLine("trace: " + string.Join(" > ", trace));
        Console.WriteLine("options: " + string.Join(" | ", choices.ConvertAll(c => string.Join(", ", c))));
        Console.WriteLine("finished: " + string.Join(", ", finished));
        if (choices.Count != 2 || string.Join(",", choices[0]) != "Turn the key,Force it") Fail("the choice should offer Turn the key and Force it first");
        if (choices.Count == 2 && string.Join(",", choices[1]) != "Turn the key") Fail("Force it should be gone the second time");
        if (finished.Count != 1 || finished[0] != Cinematics.TheVaultOpens) Fail("the scene should end into the cinematic");
        if (game.HasItem(Items.VaultKey) || game.Arc(Characters.Mara) != 1) Fail("turning the key should use it up and move Mara +1");
        if (game.QuestState(Quests.OpenTheVault) != "done" || string.Join(",", questsDone) != Quests.OpenTheVault) Fail("solving the door should complete Open the vault once, got " + game.QuestState(Quests.OpenTheVault) + " " + string.Join(",", questsDone));

        // Rules can ask about quests and lore.
        var asks = new Dictionary<string, object> { ["match"] = "all", ["items"] = new List<object> {
            new Dictionary<string, object> { ["kind"] = "quest", ["ref"] = Quests.OpenTheVault, ["op"] = "done" },
            new Dictionary<string, object> { ["kind"] = "lore", ["ref"] = Lore.TheDrownedOrder, ["op"] = "known" } } };
        if (!Rules.Check(asks, game)) Fail("a rule should see the quest done and the lore known");

        // Effects can start a quest and reveal lore.
        var told = new GameState(story);
        told.Quests.Clear();
        Rules.Apply(new List<object> {
            new Dictionary<string, object> { ["kind"] = "startQuest", ["ref"] = Quests.OpenTheVault },
            new Dictionary<string, object> { ["kind"] = "revealLore", ["ref"] = Lore.TheDrownedOrder } }, told);
        if (told.QuestState(Quests.OpenTheVault) != "active" || !told.KnowsLore(Lore.TheDrownedOrder)) Fail("the effects should start the quest and reveal the lore");
        Rules.Apply(new List<object> {
            new Dictionary<string, object> { ["kind"] = "completeQuest", ["ref"] = Quests.OpenTheVault },
            new Dictionary<string, object> { ["kind"] = "enableMechanic", ["ref"] = Mechanics.LanternOil } }, told);
        if (told.QuestState(Quests.OpenTheVault) != "done" || !told.HasMechanic(Mechanics.LanternOil)) Fail("the effects should complete the quest and make the mechanic available");

        // SC-02 opens on an encounter: lose it (try again), then win it, and the scene goes on.
        var fresh = new GameState(story);
        var silt = new ScenePlayer(fresh, Scenes.Sc02TheKey);
        var encounters = new List<string>();
        var over = new List<string>();
        silt.EncounterRequested += (e, canWin) => encounters.Add(e + (canWin ? "" : " (can't win)"));
        silt.GameOver += e => over.Add(e);
        var codex = new Codex(fresh);
        if (codex.Text() != "CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 0 of 1 found\nNone yet.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 0 of 1 available\nNone yet.\n\nENCOUNTERS · 0 met, 0 won\nNone yet.\n\nLORE · 0 of 2 found\nNothing found yet." || codex.New != 0) Fail("the codex should start empty, got " + codex.Text());
        silt.Start();
        silt.Lose();
        Console.WriteLine("encounter: " + string.Join(", ", encounters));
        // Met once, however often it is played again; not won yet.
        if (fresh.MetEncounters.Count != 1 || fresh.WasWon(Encounters.EelSwarm) || codex.New != 1 || !codex.Text().Contains("ENCOUNTERS · 1 met, 0 won\n\nEEL SWARM\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\n")) Fail("the codex should show the eels met, not won, 1 new, got " + codex.Text() + " · new " + codex.New);
        // The eels can only be beaten once the lantern's oil is in play (a mechanic condition).
        var notYet = Encounters.EelSwarm + " (can't win)";
        if (string.Join(",", encounters) != notYet + "," + notYet || over.Count != 0) Fail("losing the eels should play them again, not yet winnable, got " + string.Join(",", encounters));
        if (silt.Win()) Fail("a win should not count before the lantern's oil is in play");
        fresh.EnableMechanic(Mechanics.LanternOil);
        if (!silt.Win()) Fail("with the lantern's oil, a win against the eels should count");
        if (!fresh.WasWon(Encounters.EelSwarm) || !fresh.HasItem(Items.VaultKey)) Fail("winning should mark the eels won, and the scene go on to find the key");
        if (fresh.QuestState(Quests.OpenTheVault) != "active" || !fresh.KnowsLore(Lore.TheDrownedOrder)) Fail("finding the key should start the quest and reveal the lore");
        // The codex: the quest log, the mechanics, the encounters and the lore, and what is new since it was read.
        Console.WriteLine("codex: " + codex.Text().Replace("\n", " | ") + " · new " + codex.New);
        if (codex.New != 6 || !codex.Text().StartsWith("CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 1 of 1 found\n\nVAULT KEY (carried)\nA heavy bronze key, green with age, stamped with the Order’s wave.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault")) Fail("the codex should show the quest under way, the key, the lantern's oil, the eels won and The Drowned Order, 6 new, got " + codex.Text());
        // Search it: only the entries that match, ignoring case; headings are not searched.
        if (codex.Text("LANTERN") != "CODEX\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.") Fail("searching for lantern should show the oil and the eels, got " + codex.Text("LANTERN"));
        if (codex.Text("quests") != "CODEX\n\nNothing matches \"quests\".") Fail("a search with no match should say so, got " + codex.Text("quests"));
        if (codex.Text("  ") != codex.Text()) Fail("a blank search should show everything");
        // Filter by section: only that one, alone or with the search.
        if (string.Join(",", codex.SectionKeys()) != "quests,characters,locations,items,objects,mechanics,encounters,lore") Fail("the codex should offer every section, got " + string.Join(",", codex.SectionKeys()));
        if (codex.Text("", "lore") != "CODEX\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.") Fail("filtering to lore should show only the lore, got " + codex.Text("", "lore"));
        if (codex.Text("lantern", "lore") != "CODEX\n\nNothing matches \"lantern\" in Lore.") Fail("a search with no match in a section should say so, got " + codex.Text("lantern", "lore"));
        if (codex.Text("", "objects") != "CODEX\n\nOBJECTS · 0 of 1 used\nNone yet.") Fail("an empty section should say so, got " + codex.Text("", "objects"));
        // Sort: found the expedition's marks first, then the Order's story.
        var sorting = new GameState(story);
        sorting.DiscoverLore(Lore.TheLastExpedition);
        sorting.DiscoverLore(Lore.TheDrownedOrder);
        // Bookmarks: a star on the entry, a filter for them alone, and a cursor to pick one.
        var book = new Codex(sorting);
        if (!sorting.ToggleBookmark("lore:" + Lore.TheDrownedOrder) || !book.Text().Contains("\n\nTHE DROWNED ORDER ★\nRiver priests")) Fail("a bookmark should star the entry, got " + book.Text());
        if (book.Text("", "bookmarks") != "CODEX\n\nLORE · 2 of 2 found\n\nTHE DROWNED ORDER ★\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.") Fail("the bookmarks should show alone, got " + book.Text("", "bookmarks"));
        if (book.Text("eels", "bookmarks") != "CODEX\n\nNothing matches \"eels\" in Bookmarks.") Fail("a search with no match in the bookmarks should say so, got " + book.Text("eels", "bookmarks"));
        if (string.Join(",", book.EntryKeys("", "lore")) != "lore:" + Lore.TheLastExpedition + ",lore:" + Lore.TheDrownedOrder) Fail("the cursor should move through the lore shown, got " + string.Join(",", book.EntryKeys("", "lore")));
        if (!book.Text("", "lore", "", "lore:" + Lore.TheLastExpedition).Contains("\n\n▶ THE LAST EXPEDITION\n")) Fail("the cursor entry should start with ▶, got " + book.Text("", "lore", "", "lore:" + Lore.TheLastExpedition));
        // A note: it ends the entry, and a search finds it.
        sorting.SetNote("lore:" + Lore.TheDrownedOrder, "  Priests, not monks  ");
        if (sorting.NoteFor("lore:" + Lore.TheDrownedOrder) != "Priests, not monks" || !book.Text().Contains("They believed the water kept their secrets.\nNote: Priests, not monks")) Fail("the note should end the entry, got " + book.Text());
        if (!book.Text("not monks").Contains("THE DROWNED ORDER")) Fail("a search should find the note, got " + book.Text("not monks"));
        // Export them: each entry with a note, in the codex's order.
        sorting.SetNote("encounters:" + Encounters.EelSwarm, "Bring the lantern");
        if (book.NotesText() != "CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\nPriests, not monks") Fail("the notes export should list each noted entry (the eels are not met here), got " + book.NotesText());
        sorting.SetNote("encounters:" + Encounters.EelSwarm, "");
        sorting.SetNote("lore:" + Lore.TheDrownedOrder, "");
        if (book.NotesText() != "CODEX NOTES · The Sunken Vault\n\nNo notes yet.") Fail("with no notes, the export should say so, got " + book.NotesText());
        if (book.Text().Contains("Note:")) Fail("an empty note should take the note off");
        if (sorting.ToggleBookmark("lore:" + Lore.TheDrownedOrder) || book.Text("", "bookmarks") != "CODEX\n\nNo bookmarks yet.") Fail("taking the bookmark off should leave none, got " + book.Text("", "bookmarks"));
        string Heads(string sort) => string.Join(",", Array.FindAll(new Codex(sorting).Text("", "lore", sort).Split('\n'), l => l.StartsWith("THE ")));
        if (Heads("") != "THE LAST EXPEDITION,THE DROWNED ORDER" || Heads("newest") != "THE DROWNED ORDER,THE LAST EXPEDITION" || Heads("name") != "THE DROWNED ORDER,THE LAST EXPEDITION") Fail("sorting the lore should order it as found, newest first and A–Z, got " + Heads("") + " / " + Heads("newest") + " / " + Heads("name"));
        codex.MarkRead();
        Rules.CompleteQuest(Quests.OpenTheVault, fresh);
        if (codex.New != 1 || !codex.Text().Contains("QUESTS · 0 under way, 1 done\n• Open the vault (done)")) Fail("the quest log should show the quest done, 1 new, got " + codex.Text());
        // The screen compiles with Unity's GUI; its button reads the same codex.
        var screen = new UnityEngine.GameObject("Codex").AddComponent<VcgsCodex>();
        if (screen.ButtonText() != "") Fail("the codex screen should wait for VcgsGame");
        if (silt.Win()) Fail("there is no encounter to win now");

        // SC-01 opens by lighting the lantern: its oil becomes a mechanic in play (an effect), with its tuning.
        var lit = new GameState(story);
        var available = new List<string>();
        lit.MechanicAvailable += m => available.Add(m);
        new ScenePlayer(lit, Scenes.Sc01TheCaveMouth).Start();
        Console.WriteLine("mechanics: " + string.Join(",", available) + " · tuning: " + story.MechanicDetail(Mechanics.LanternOil, "tuning"));
        if (string.Join(",", available) != Mechanics.LanternOil || story.MechanicDetail(Mechanics.LanternOil, "tuning") != "About a minute of deep water on a full lantern") Fail("lighting the lantern should make Lantern oil available, with its tuning");

        // On along the graph: the cinematic, then the ring choice, to the ending.
        var ring = StoryWalker.Onward(game, finished[0]);
        if (StoryWalker.KindOf(game, ring) != "choice") Fail("after the cinematic comes the ring choice, got " + ring);
        var offered = StoryWalker.Offered(game, ring);
        var labels = offered.ConvertAll(i => StoryWalker.OptionLabel(game, ring, i));
        if (string.Join(",", labels) != "Carry on,Pocket it") Fail("the ring choice should offer Carry on and Pocket it, got " + string.Join(",", labels));
        var end = StoryWalker.Choose(game, ring, offered[0]);
        if (StoryWalker.KindOf(game, end) != "end") Fail("carrying on should reach the end, got " + end);

        var line = StoryWalker.Line(game, "sc_03_line_02");
        if (line.speaker != "Mara") Fail("line 2 should be Mara's, got " + line.speaker);

        CheckLevel(story);

        Console.WriteLine(failures == 0 ? "OK" : failures + " FAILED");
        return failures == 0 ? 0 : 1;
    }

    // The level: its rules on the story's state, then the editor builder, twice.
    static void CheckLevel(Story story)
    {
        var json = File.ReadAllText("Assets/VCGS/Generated/Levels/sunken_vault.json");
        var game = new GameState(story);
        var level = LevelLogic.FromJson(json, game);
        Console.WriteLine("level: " + level.ExportName + " · " + level.Items.Count + " items");
        var door = level.GuidOf("INT_VaultChamber_BronzeDoor_004");
        var key = level.GuidOf("INV_SiltCamp_VaultKey_001");
        var lever = level.GuidOf("INT_VaultChamber_RustedLever_005");
        var seam = level.GuidOf("TRG_VaultChamber_FloodedSeam_001");
        var trigger = level.GuidOf("TRG_VaultChamber_DoorInTheDarkTrigger_002");
        if (level.Offer(door)?.Blocked != "Locked. Needs Vault Key.") Fail("the bronze door should be locked until the key is held, got " + level.Offer(door)?.Blocked);
        level.Interact(key);
        if (!game.HasItem(Items.VaultKey) || level.IsPresent(key)) Fail("taking the key should give the story's key and take it out of the level");
        level.Interact(door);
        if (!level.IsOpen(door)) Fail("with the key, the bronze door should open");
        var cinematics = new List<string>();
        level.CinematicRequested += c => cinematics.Add(c);
        level.Enter(trigger);
        level.Exit(trigger);
        level.Enter(trigger);
        if (string.Join(",", cinematics) != Cinematics.DoorInTheDark) Fail("the chamber should play Door in the dark once, got " + string.Join(",", cinematics));
        if (!level.IsPresent(seam)) Fail("the seam should be flooded before the lever");
        level.Interact(lever);
        if (game.GetObjectState(Objects.RustedLever) != "up" || !game.Solved.Contains(Puzzles.TheVaultDoor)) Fail("the lever should go up and, through the story, solve the door");
        if (level.IsPresent(seam) || level.IsPresent(door)) Fail("once solved, the seam drains and the bronze door gives way");

        // The editor builder, in the stubs' little scene.
        var path = "Assets/VCGS/Generated/Levels/sunken_vault.json";
        var report = VCGS.EditorTools.VcgsLevelBuilder.Build(json, path, false);
        var root = UnityEngine.GameObject.Find("LVL_SunkenVault_01");
        var items = root == null ? new VcgsLevelItem[0] : root.transform.GetComponentsInChildren<VcgsLevelItem>(true);
        Console.WriteLine("built: " + items.Length + " items · " + report[report.Count - 1]);
        if (items.Length != level.Items.Count) Fail("the builder should make a GameObject per item");
        var camp = root.transform.Find("RM_SunkenVault_SiltCamp_003");
        if (camp == null || camp.localPosition != new UnityEngine.Vector3(10, 0, 9)) Fail("the silt camp should be at (10, 0, 9) in Unity (north is +Z)");
        var chamber = root.transform.Find("RM_SunkenVault_VaultChamber_004");
        if (chamber == null || chamber.Find("Proxy").childCount < 5 || chamber.Find("Collision").childCount < 4) Fail("the chamber should have its proxy and collision");
        // The chamber's outlined floor is a mesh of its own, faces up, and collides by its shape.
        UnityEngine.Mesh floor = null;
        foreach (var f in chamber.Find("Proxy").GetComponentsInChildren<UnityEngine.MeshFilter>(true))
            if (f.gameObject.name.StartsWith("floor") && f.sharedMesh != null && f.sharedMesh.name.Contains("floor")) floor = f.sharedMesh;
        var floorCollider = chamber.Find("Collision").GetComponentsInChildren<UnityEngine.MeshCollider>(true);
        if (floor == null || floorCollider.Length == 0) Fail("the chamber's outlined floor should be a mesh with a mesh collider");
        else
        {
            var v = floor.vertices;
            var t = floor.triangles;
            var n = v.Length / 6;
            if (n < 5 || t.Length != (n - 2) * 6 + n * 6) Fail("the floor mesh should have a top, a bottom and a side per wall, got " + v.Length + " corners, " + t.Length / 3 + " triangles");
            var up = UnityEngine.Vector3.Cross(v[t[1]] - v[t[0]], v[t[2]] - v[t[0]]);
            if (up.y <= 0) Fail("the floor's top should face up");
        }
        // The chamber's ambient zone follows its cut corners: a convex trigger per triangle, and no box.
        var echo = root.transform.Find("AUD_VaultChamber_DrippingEcho_001");
        var zones = echo == null ? new UnityEngine.MeshCollider[0] : echo.GetComponents<UnityEngine.MeshCollider>();
        if (echo == null || zones.Length != 6 || echo.GetComponent<UnityEngine.BoxCollider>() != null || !Array.TrueForAll(zones, z => z.convex && z.isTrigger && z.sharedMesh.vertices.Length == 6))
            Fail("the outlined ambient zone should be six convex trigger prisms, got " + zones.Length);
        var crane = root.transform.Find("CAM_VaultChamber_ChamberCrane_001");
        if (crane == null || Math.Abs(crane.localEulerAngles.y - 315) > 0.01) Fail("the camera marker should turn 315° in Unity, got " + crane?.localEulerAngles.y);
        var trig = root.transform.Find("TRG_VaultChamber_DoorInTheDarkTrigger_002").GetComponent<UnityEngine.BoxCollider>();
        if (trig == null || !trig.isTrigger) Fail("a volume should be a trigger collider");

        // Moved in Unity, then changed in VC Game Studio: the move is kept and said, unless VC Game Studio wins.
        camp.localPosition = new UnityEngine.Vector3(11, 0, 9);
        var changed = json.Replace(camp.GetComponent<VcgsLevelItem>().revision, "changed");
        var again = VCGS.EditorTools.VcgsLevelBuilder.Build(changed, path, false);
        if (!again.Exists(l => l.Contains("RM_SunkenVault_SiltCamp_003 was moved in Unity")) || camp.localPosition.x != 11) Fail("a move made in Unity should be kept and reported, got " + string.Join(" / ", again));
        if (again.Exists(l => l.StartsWith("Added"))) Fail("a second build should add nothing");
        VCGS.EditorTools.VcgsLevelBuilder.Build(changed, path, true);
        if (camp.localPosition.x != 10) Fail("with VC Game Studio winning, the camp goes back");
        // An item gone from the level is reported, not deleted.
        var data = (Dictionary<string, object>)Json.Parse(json);
        var list = (List<object>)data["items"];
        list.RemoveAll(o => D.Str(D.Map(o), "export_name") == "PRP_SiltCamp_Crate_001" || D.Str(D.Map(o), "export_name") == "LGT_SiltCamp_CampEmbers_002");
        var fewer = VCGS.EditorTools.VcgsLevelBuilder.Build(Serialize(data), path, false);
        if (!fewer.Exists(l => l.Contains("LGT_SiltCamp_CampEmbers_002 is no longer in the level")) || root.transform.Find("LGT_SiltCamp_CampEmbers_002") == null) Fail("a removed item should be reported and left in place");

        // A volume that collides is a blocking state gate: solid as well as a trigger, for a box and for an outline.
        foreach (var o in list)
        {
            var m = D.Map(o);
            var n = D.Str(m, "export_name");
            if (n != "TRG_VaultChamber_FloodedSeam_001" && n != "AUD_VaultChamber_DrippingEcho_001") continue;
            foreach (var p in D.List(m, "pieces")) if (D.Str(D.Map(p), "part") == "volume") D.Map(p)["collide"] = true;
            m["revision"] = "gate";
        }
        VCGS.EditorTools.VcgsLevelBuilder.Build(Serialize(data), path, false);
        var seamSolid = root.transform.Find("TRG_VaultChamber_FloodedSeam_001").Find("Collision").GetComponentsInChildren<UnityEngine.BoxCollider>(true);
        if (seamSolid.Length != 1 || seamSolid[0].isTrigger) Fail("a blocking box gate should get a solid box under Collision");
        var echoGate = root.transform.Find("AUD_VaultChamber_DrippingEcho_001");
        var echoSolid = echoGate.Find("Collision")?.GetComponentsInChildren<UnityEngine.MeshCollider>(true) ?? new UnityEngine.MeshCollider[0];
        if (echoSolid.Length != 1 || echoSolid[0].isTrigger || echoGate.GetComponents<UnityEngine.MeshCollider>().Length != 6) Fail("a blocking outlined gate should get a solid mesh and keep its six trigger prisms");

        // VcgsLevel in the scene: items come and go with the story.
        var levelComponent = root.GetComponent<VcgsLevel>();
        levelComponent.level = new UnityEngine.TextAsset { text = json };
        var fresh = new GameState(story);
        levelComponent.Setup(fresh);
        levelComponent.Interact(levelComponent.Logic.GuidOf("INT_VaultChamber_RustedLever_005"));
        if (root.transform.Find("TRG_VaultChamber_FloodedSeam_001").gameObject.activeSelf) Fail("VcgsLevel should switch the drained seam off");
    }

    static string Serialize(object o)
    {
        switch (o)
        {
            case null: return "null";
            case string s: return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            case bool b: return b ? "true" : "false";
            case double d: return d.ToString(System.Globalization.CultureInfo.InvariantCulture);
            case Dictionary<string, object> m:
                var parts = new List<string>();
                foreach (var kv in m) parts.Add(Serialize(kv.Key) + ":" + Serialize(kv.Value));
                return "{" + string.Join(",", parts) + "}";
            case List<object> l: return "[" + string.Join(",", l.ConvertAll(Serialize)) + "]";
        }
        return "null";
    }
}
