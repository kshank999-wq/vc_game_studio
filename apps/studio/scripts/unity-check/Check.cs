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
        if (codex.Text() != "CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 0 of 3 found\nNone yet.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 0 of 1 available\nNone yet.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 0 met, 0 won\nNone yet.\n\nLORE · 0 of 2 found\nNothing found yet." || codex.New != 0) Fail("the codex should start empty, got " + codex.Text());
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
        if (codex.New != 7 || !codex.Text().StartsWith("CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 2 of 3 found\n\nFLARE PISTOL (carried)\nA brass signal pistol from the last expedition. Each flare lights a chamber for a few breaths.\n\nVAULT KEY (carried)\nA heavy bronze key, green with age, stamped with the Order’s wave.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault")) Fail("the codex should show the quest under way, the key, the lantern's oil, the eels won and The Drowned Order, 6 new, got " + codex.Text());
        // An item equipped is marked so, with its slot.
        fresh.Equip("flare_pistol");
        if (!codex.Text("", "items").Contains("FLARE PISTOL (carried, equipped · Hand)\n")) Fail("the codex should mark the flare pistol equipped, got " + codex.Text("", "items"));
        Console.WriteLine("equipped in the codex: " + codex.Text("", "items").Split('\n')[4]);
        fresh.Unequip("flare_pistol");
        // Search it: only the entries that match, ignoring case; headings are not searched.
        if (codex.Text("LANTERN") != "CODEX\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.") Fail("searching for lantern should show the oil and the eels, got " + codex.Text("LANTERN"));
        if (codex.Text("quests") != "CODEX\n\nNothing matches \"quests\".") Fail("a search with no match should say so, got " + codex.Text("quests"));
        if (codex.Text("  ") != codex.Text()) Fail("a blank search should show everything");
        // Filter by section: only that one, alone or with the search.
        if (string.Join(",", codex.SectionKeys()) != "quests,characters,locations,items,objects,mechanics,skills,encounters,lore") Fail("the codex should offer every section, got " + string.Join(",", codex.SectionKeys()));
        // The codex's skills: learning a rank is news, and the section says its rank, kind, tree and use.
        {
            var before = codex.New;
            Rules.Learn("deep_breath", fresh);
            Console.WriteLine("codex skills: " + codex.Text("", "skills").Replace("\n", " | ") + " · new " + codex.New);
            if (codex.Text("", "skills") != "CODEX\n\nSKILLS · 1 of 2 learned\n\nDEEP BREATH (rank 1 of 2)\nSkill · Diving\nWhat it does: Hold your breath a third longer\nLonger under water with each rank.") Fail("the codex should list Deep Breath, got " + codex.Text("", "skills"));
            if (codex.New != before + 1) Fail("learning a skill should be news for the codex");
            fresh.Skills.Clear();
        }
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
        // Email them: a mail link with the story in the subject and the notes as the body.
        if (book.NotesMailto() != ("mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0D%0A%0D%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0D%0APriests%2C%20not%20monks", true)) Fail("the mail link should carry the notes, got " + book.NotesMailto());
        if (Codex.MailtoOf("CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\n" + new string('x', 2000)) != ("mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.", false)) Fail("notes too long for a mail link should say they are on the clipboard");
        // Text them: a text-message link with the notes as the message.
        if (book.NotesSms() != ("sms:?&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0A%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0APriests%2C%20not%20monks", true)) Fail("the text link should carry the notes, got " + book.NotesSms());
        if (Codex.SmsOf("CODEX NOTES · X\n\nLORE · Y\n" + new string('x', 2000)) != ("sms:?&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.", false)) Fail("notes too long for a text link should say they are on the clipboard");
        // Print them: the same notes as a page, section by section.
        var page = book.NotesPage();
        if (!page.StartsWith("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>The Sunken Vault · codex notes</title><style>" + Codex.PrintStyle + "</style></head>") || !page.EndsWith("<h1>The Sunken Vault</h1><p class=\"sub\">Codex notes</p>\n<h2>Lore</h2>\n<div class=\"note\"><h3>THE DROWNED ORDER</h3><p>Priests, not monks</p></div>\n</body></html>\n")) Fail("the notes page should list each note under its section, got " + page);
        if (!Codex.PageOf("CODEX NOTES · A & B\n\nITEMS · <KEY>\none\ntwo").Contains("<title>A &amp; B · codex notes</title>") || !Codex.PageOf("CODEX NOTES · A & B\n\nITEMS · <KEY>\none\ntwo").Contains("<h2>Items</h2>\n<div class=\"note\"><h3>&lt;KEY&gt;</h3><p>one<br>two</p></div>")) Fail("the notes page should escape its text and keep a note's lines");
        sorting.SetNote("encounters:" + Encounters.EelSwarm, "");
        // Import them back: matched by section and name, whatever the entry's state.
        var read = book.ImportNotes("CODEX NOTES · The Sunken Vault\r\n\r\nLORE · THE LAST EXPEDITION (seen)\r\nPry marks,\r\nby the lock\r\n\r\nENCOUNTERS · EEL SWARM (won)\r\nNot met here");
        if (read.notes.Count != 1 || sorting.NoteFor("lore:" + Lore.TheLastExpedition) != "Pry marks,\nby the lock" || string.Join(",", read.skipped) != "ENCOUNTERS · EEL SWARM (won)") Fail("importing notes should match them by section and name, got " + read.notes.Count + " / " + string.Join(",", read.skipped));
        // Sync: the newer note of each wins, takings-off too, and it writes back what it merged.
        var device = new GameState(story);
        device.SetNote("lore:" + Lore.TheLastExpedition, "Mine, older");
        device.SetNote("items:" + Items.VaultKey, "Taken off later");
        var later = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 60000;
        var other = "{ \"format\": \"vcgs-codex-notes-sync\", \"version\": 1, \"story\": \"The Sunken Vault\", \"notes\": { \"lore:" + Lore.TheLastExpedition + "\": { \"text\": \"Theirs, \\\"newer\\\"\\nsecond line\", \"at\": " + later + " }, \"items:" + Items.VaultKey + "\": { \"text\": \"\", \"at\": " + later + " }, \"quests:" + Quests.OpenTheVault + "\": { \"text\": \"Theirs, old\", \"at\": 1 } } }";
        var synced = device.SyncNotes(other);
        if (synced != 3 || device.NoteFor("lore:" + Lore.TheLastExpedition) != "Theirs, \"newer\"\nsecond line" || device.NoteFor("items:" + Items.VaultKey) != "" || device.NoteFor("quests:" + Quests.OpenTheVault) != "Theirs, old") Fail("syncing should keep the newer note of each, got " + synced);
        var back = new GameState(story);
        if (back.SyncNotes(device.NotesSyncText("The Sunken Vault")) != 2 || back.NoteFor("lore:" + Lore.TheLastExpedition) != "Theirs, \"newer\"\nsecond line" || back.NotesSyncText("The Sunken Vault") != device.NotesSyncText("The Sunken Vault")) Fail("a sync file should read back what it wrote, got " + back.NotesSyncText("The Sunken Vault"));
        if (device.SyncNotes("CODEX NOTES · not a sync file") != -1) Fail("text that is not a sync file should not sync");
        if (Codex.NameOf("• Open the vault — Reach it") != "open the vault" || Codex.NameOf("VAULT KEY (carried ×2)") != "vault key") Fail("the name should drop the goal and the state");
        sorting.SetNote("lore:" + Lore.TheLastExpedition, "");
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
        if (screen.PrintNotes() != "" || screen.EmailNotes() != "" || screen.TextNotes() != "" || UnityEngine.Application.opened.Count != 0) Fail("with no game there are no notes to print");
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

        // Save and load: a save holds the game as the scene being played began, and loading puts it back.
        var saving = new GameState(story);
        var cave = new ScenePlayer(saving, Scenes.Sc01TheCaveMouth);
        cave.Start();
        var save = D.Map(Json.Parse(saving.SaveText("The Sunken Vault")));
        Console.WriteLine("save: at " + D.Str(save, "at") + " · visited " + D.List(save, "visited").Count + " · mechanics " + string.Join(",", D.List(save, "mechanics")));
        if (D.Str(save, "format") != "vcgs-save" || D.Num(save, "version") != 1 || D.Str(save, "story") != "The Sunken Vault" || D.Str(save, "at") != Scenes.Sc01TheCaveMouth || D.List(save, "visited").Count != 0 || D.List(save, "mechanics").Count != 0) Fail("the save should hold the game as SC-01 began");
        if (!saving.Visited.Contains(Scenes.Sc01TheCaveMouth) || saving.AvailableMechanics.Count != 1) Fail("SC-01 should have been visited and lit the lantern");
        var first = saving.SaveText("The Sunken Vault");
        if (saving.LoadSave(first) != Scenes.Sc01TheCaveMouth || saving.Visited.Count != 0 || saving.AvailableMechanics.Count != 0 || !saving.Loaded) Fail("loading should put the game back as SC-01 began");
        string NoTime(string t) => System.Text.RegularExpressions.Regex.Replace(t, "\"saved_at\": \\d+", "");
        if (NoTime(saving.SaveText("The Sunken Vault")) != NoTime(first)) Fail("a loaded save should save the same again, got " + saving.SaveText("The Sunken Vault"));
        // A save from another engine's runtime (the same format) loads here too.
        var otherAt = saving.LoadSave("{\"format\":\"vcgs-save\",\"version\":1,\"story\":\"The Sunken Vault\",\"at\":\"sc_03_the_vault_door\",\"saved_at\":1,\"flags\":{\"door_solved\":\"yes\"},\"objects\":{\"rusted_lever\":\"up\"},\"items\":{\"vault_key\":2},\"arcs\":{\"mara\":1},\"chosen\":{\"c1\":\"carry_on\"},\"quests\":[{\"key\":\"open_the_vault\",\"state\":\"active\"}],\"solved\":[\"vault_door\"],\"visited\":[\"sc_01_the_cave_mouth\",\"sc_02_the_key\"],\"fired\":[],\"picked\":[\"c1:carry_on\"],\"won\":[\"eel_swarm\"],\"met\":[\"eel_swarm\"],\"characters\":[\"mara\"],\"found\":[\"vault_key\"],\"locations\":[\"silt_camp\"],\"used\":[\"rusted_lever\"],\"lore\":[\"the_drowned_order\"],\"mechanics\":[\"lantern_oil\"]}");
        if (otherAt != "sc_03_the_vault_door" || saving.Flags["door_solved"] != "yes" || saving.ObjectStates["rusted_lever"] != "up" || saving.Items["vault_key"] != 2 || saving.Arcs["mara"] != 1 || saving.Quests["open_the_vault"] != "active" || !saving.Solved.Contains("vault_door") || !saving.Visited.Contains("sc_02_the_key") || !saving.Picked.Contains("c1:carry_on") || !saving.Won.Contains("eel_swarm") || string.Join(",", saving.MetCharacters) != "mara" || string.Join(",", saving.FoundItems) != "vault_key" || string.Join(",", saving.UsedObjects) != "rusted_lever" || string.Join(",", saving.KnownLore) != "the_drowned_order" || !saving.Mechanics.Contains("lantern_oil")) Fail("a save in the shared format should load");
        if (saving.LoadSave("not a save") != null || saving.LoadSave("{\"format\":\"vcgs-codex-notes-sync\"}") != null) Fail("text that is not a save should not load");
        new ScenePlayer(saving, Scenes.Sc03TheVaultDoor).Start();
        if (saving.Loaded) Fail("starting the scene should end the load");

        // Skills (spec §8): the Diving tree. Deep Breath first (two ranks, free), then the
        // lantern's hood, once the oil is in play, for the two salvage the eels leave.
        {
            var g = new GameState(story);
            if (Rules.Learn("lantern_hood", g) != "Learn Deep Breath first.") Fail("the hood should need Deep Breath first");
            if (Rules.Learn("deep_breath", g) != "" || g.SkillRank("deep_breath") != 1) Fail("Deep Breath should be learned, for free");
            if (Rules.LearnCheck("lantern_hood", g) != "Needs Lantern oil is available.") Fail("the hood should need the lantern's oil, got " + Rules.LearnCheck("lantern_hood", g));
            Rules.Learn("deep_breath", g);
            if (Rules.LearnCheck("deep_breath", g) != "All 2 ranks learned.") Fail("Deep Breath should stop at two ranks");
            g.EnableMechanic("lantern_oil");
            if (Rules.LearnCheck("lantern_hood", g) != "Costs 2 × Salvage (you have 0).") Fail("the hood should cost two salvage, got " + Rules.LearnCheck("lantern_hood", g));
            Rules.Apply(D.Get(story.Encounters["eel_swarm"], "onWin"), g);
            if (Rules.Learn("lantern_hood", g) != "" || g.Items["salvage"] != 0 || g.SkillRank("lantern_hood") != 1) Fail("the eels' salvage should buy the hood");
            Rules.Apply(Json.Parse("[{\"kind\": \"learnSkill\", \"ref\": \"deep_breath\"}]"), g);
            if (g.SkillRank("deep_breath") != 2 || !Rules.Check(Json.Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"skill\", \"ref\": \"lantern_hood\", \"op\": \"atLeast\", \"value\": 1}, {\"kind\": \"skill\", \"ref\": \"deep_breath\", \"op\": \"below\", \"value\": 3}]}"), g)) Fail("a given rank should stop at the skill's ranks, and conditions should see ranks");
            var skillSave = g.SaveText("The Sunken Vault");
            var h = new GameState(story);
            h.LoadSave(skillSave);
            Console.WriteLine("skills: deep_breath " + h.SkillRank("deep_breath") + ", lantern_hood " + h.SkillRank("lantern_hood"));
            if (h.SkillRank("deep_breath") != 2 || h.SkillRank("lantern_hood") != 1) Fail("skills should save and load");
        }
        // Weapons and equipment (spec §8): the knife wears out, the flare pistol burns flares.
        {
            var g = new GameState(story);
            if (g.Equip("diving_knife") != "You don't carry Diving Knife." || g.Equip("vault_key") != "Not equipment.") Fail("only equipment that is carried can be equipped");
            g.GiveItem("diving_knife"); g.GiveItem("flare_pistol"); g.GiveItem("flare");
            if (g.Equip("diving_knife") != "" || g.EquippedIn("Hand") != "diving_knife" || g.Stat("damage") != 2) Fail("the knife should go in the hand, with its damage");
            if (g.Equip("flare_pistol") != "" || g.EquippedIn("Hand") != "flare_pistol" || g.Stat("Light") != 3 || g.IsEquipped("diving_knife")) Fail("the pistol should take the hand, putting the knife back");
            if (g.UseItem("flare_pistol") != "" || g.Items["flare"] != 0 || g.UseCheck("flare_pistol") != "Out of Flare.") Fail("the pistol should burn its one flare");
            g.Equip("diving_knife");
            for (var i = 0; i < 3; i++) g.UseItem("diving_knife");
            if (g.HasItem("diving_knife") || g.IsEquipped("diving_knife") || g.UseCheck("diving_knife") != "Equip Diving Knife first.") Fail("the knife should break after three uses, and be gone");
            // Stat conditions read what the equipped items add up to, by name in any case.
            var strong = Json.Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"stat\", \"ref\": \"Damage\", \"op\": \"atLeast\", \"value\": 2}]}");
            var dim = Json.Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"stat\", \"ref\": \"light\", \"op\": \"below\", \"value\": 1}]}");
            if (Rules.Check(strong, g) || !Rules.Check(dim, g)) Fail("with nothing equipped, Damage should be below 2 and Light below 1");
            g.GiveItem("diving_knife");
            Rules.Apply(Json.Parse("[{\"kind\": \"equip\", \"ref\": \"diving_knife\"}]"), g);
            if (!Rules.Check(strong, g) || !Rules.Check(dim, g)) Fail("with the knife equipped, Damage should be at least 2");
            Console.WriteLine("stat conditions: Damage " + g.Stat("Damage") + " at least 2: " + Rules.Check(strong, g));
            if (!Rules.Check(Json.Parse("{\"match\": \"all\", \"items\": [{\"kind\": \"equipped\", \"ref\": \"diving_knife\", \"op\": \"equipped\"}]}"), g) || g.UsesLeft("diving_knife") != 3) Fail("an effect should equip a new knife, unworn, and conditions should see it");
            g.UseItem("diving_knife");
            var h = new GameState(story);
            h.LoadSave(g.SaveText("The Sunken Vault"));
            Console.WriteLine("gear: hand " + h.EquippedIn("Hand") + ", uses left " + h.UsesLeft("diving_knife"));
            if (h.EquippedIn("Hand") != "diving_knife" || h.UsesLeft("diving_knife") != 2) Fail("equipment and its wear should save and load");
            h.TakeItem("diving_knife");
            if (h.IsEquipped("diving_knife")) Fail("an item no longer carried should come out of its slot");
            // The sample's stat condition: in the vault chamber, the flare pistol's Light 3 shows the pry marks.
            var flareLit = new GameState(story);
            flareLit.Visit(Scenes.Sc03TheVaultDoor);
            flareLit.GiveItem("flare_pistol");
            if (flareLit.Fired.Contains(Triggers.FlareOnTheDoor) || flareLit.KnowsLore(Lore.TheLastExpedition)) Fail("the pry marks should wait for the flare pistol's light");
            flareLit.Equip("flare_pistol");
            if (!flareLit.Fired.Contains(Triggers.FlareOnTheDoor) || !flareLit.KnowsLore(Lore.TheLastExpedition)) Fail("equipping the flare pistol at the vault door should fire Flare on the door and reveal The Last Expedition");
            Console.WriteLine("flare on the door: fired " + flareLit.Fired.Contains(Triggers.FlareOnTheDoor) + ", the last expedition found " + flareLit.KnowsLore(Lore.TheLastExpedition));
        }
        // Crafting (spec §8): with the pistol, a scrap of salvage packs two flares.
        {
            var g = new GameState(story);
            if (g.Craft("vault_key") != "Not craftable." || g.Craft("flare") != "Needs Flare Pistol is carried.") Fail("the flare should need the pistol, got " + g.CraftCheck("flare"));
            g.GiveItem("flare_pistol");
            if (g.CraftCheck("flare") != "Needs 1 × Salvage (you have 0).") Fail("the flare should need salvage, got " + g.CraftCheck("flare"));
            g.GiveItem("salvage", 2);
            var made = "";
            g.ItemCrafted += (k, n) => made += k + " ×" + n;
            if (g.Craft("flare") != "" || g.Items["salvage"] != 1 || g.Items["flare"] != 2 || made != "flare ×2" || !g.FoundItems.Contains("flare")) Fail("crafting should take a salvage and give two flares");
            Console.WriteLine("crafted: " + made + ", salvage left " + g.Items["salvage"]);
        }

        // Custom code in StoryKeys.cs's region was kept when the story was exported again.
        if (!string.Equals(Scenes.Custom, "kept")) Fail("custom keys in StoryKeys.cs should survive exporting again");
        else Console.WriteLine("custom code: " + Scenes.Custom);

        CheckLevel(story);
        CheckWorld(story);

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

        // Mara paces the cave mouth: her first stop is where she stands (4 s there), then on to the second.
        var mara = level.Order.Find(g => D.Str(level.Item(g), "name") == "Mara");
        var moving = new LevelLogic(D.Map(Json.Parse(json)), new GameState(story));
        if (mara == null || !moving.Poses.ContainsKey(mara) || D.List(D.Map(moving.Item(mara), "motion"), "stops").Count != 2) Fail("Mara should walk the Cave watch patrol's two stops");
        else
        {
            for (var i = 0; i < 50; i++) moving.Tick(0.1);
            var mid = moving.Poses[mara];
            Console.WriteLine("Mara after 5 s: " + mid.X.ToString("0.00") + ", " + mid.Z.ToString("0.00"));
            if (!(mid.X > 1.6 && mid.X < 4.4 && mid.Z > 0.6 && mid.Z < 2.9 && mid.Moving)) Fail("after 5 s Mara should be on her way to the second stop");
            for (var i = 0; i < 50; i++) moving.Tick(0.1);
            var there = moving.Poses[mara];
            if (Math.Abs(there.X - 4.5) > 0.01 || Math.Abs(there.Z - 0.5) > 0.01 || there.Moving) Fail("after 10 s Mara should wait at the second stop, got " + there.X + ", " + there.Z);
        }
        // The dark and the lantern: no light until the lantern is taken; the Squeeze is dark; the oil burns, and Mara tops it up.
        {
            var cave = new LevelLogic(D.Map(Json.Parse(json)), new GameState(story));
            string Named(string n) => cave.Order.Find(g => D.Str(cave.Item(g), "name") == n) ?? "";
            if (cave.LightSource != "lantern_oil" || cave.LightFuelFull != 90) Fail("the player's light should come from Lantern oil, with 90 s of fuel, got " + cave.LightSource + " " + cave.LightFuelFull);
            if (cave.ToggleLight() != "You need Lantern oil for light." || cave.IsLit) Fail("without the lantern there should be no light");
            cave.Enter(Named("Squeeze dark"));
            Console.WriteLine("dark in the squeeze: " + cave.Darkness().ToString("0.00"));
            if (Math.Abs(cave.Darkness() - 0.96) > 0.001) Fail("the Squeeze should be 96% dark");
            cave.Exit(Named("Squeeze dark"));
            cave.Interact(Named("Lantern"));
            if (!cave.Game.HasMechanic("lantern_oil") || cave.IsPresent(Named("Lantern"))) Fail("taking the lantern should make Lantern oil available, and take it away");
            if (cave.ToggleLight() != "Light on." || !cave.IsLit) Fail("with the lantern the light should go on");
            cave.Tick(10);
            if (Math.Abs(cave.LightFuel - 80) > 0.001) Fail("ten seconds lit should burn ten seconds of oil, got " + cave.LightFuel);
            cave.Interact(Named("Mara"));
            if (cave.LightFuel != 90) Fail("Mara should top the lantern up, got " + cave.LightFuel);
        }
        // Gear, skills and crafting in the level (spec §8): the gear screen, numbered, and what is in hand.
        {
            var kit = new LevelLogic(D.Map(Json.Parse(json)), new GameState(story));
            kit.Game.EnableMechanic("lantern_oil");
            kit.Game.GiveItem("diving_knife"); kit.Game.GiveItem("flare_pistol"); kit.Game.GiveItem("salvage");
            var said = new List<string>();
            kit.Message += t => said.Add(t);
            Console.WriteLine("gear screen: " + kit.GearText().Replace("\n", " | "));
            if (kit.GearText() != "GEAR\n1. Equip Diving Knife\n2. Equip Flare Pistol\n3. Learn Deep Breath\n4. Learn Lantern Hood (Learn Deep Breath first.)\n5. Craft Flare") Fail("the gear screen should list the knife, the pistol, the skills and the flare recipe, got " + kit.GearText());
            if (kit.UseInHand() != "Nothing in hand.") Fail("with nothing equipped, R should say so");
            var first = kit.GearMenu()[0];
            if (kit.GearDo(first.Act, first.Key) != "Equipped Diving Knife" || kit.InHand() != "diving_knife" || !kit.GearText().StartsWith("GEAR\n1. Use Diving Knife\n2. Put away Diving Knife\n3. Equip Flare Pistol")) Fail("the first option should equip the knife, then offer to use it or put it away, got " + kit.GearText());
            if (kit.UseInHand() != "Used Diving Knife") Fail("R should use the knife in hand");
            if (kit.GearDo("learn", "deep_breath") != "Learned Deep Breath" || kit.Game.SkillRank("deep_breath") != 1) Fail("the gear screen should learn Deep Breath");
            if (kit.GearDo("craft", "flare") != "Crafted 2 × Flare" || kit.Game.Items["flare"] != 2) Fail("the gear screen should craft two flares");
            if (kit.GearDo("learn", "lantern_hood") != "Costs 2 × Salvage (you have 0).") Fail("the hood should say what it costs");
            if (string.Join(",", said) != "Nothing in hand.,Equipped Diving Knife,Used Diving Knife,Learned Deep Breath,Crafted 2 × Flare,Costs 2 × Salvage (you have 0).") Fail("each should be said to the player, got " + string.Join(",", said));
            Console.WriteLine("level gear: in hand " + kit.InHand() + ", Deep Breath rank " + kit.Game.SkillRank("deep_breath") + ", flares " + kit.Game.Items["flare"]);
        }
        // A companion keeps up: with the player 6 m on, it walks until 2 m away; 30 m on, it catches up at once.
        var follow = new Dictionary<string, object> { ["kind"] = "follow", ["speed"] = 3.5, ["distance"] = 2.0 };
        var pose = new ActorPose();
        for (var i = 0; i < 30; i++) LevelLogic.StepFollow(pose, follow, 0.1, 6, 0, 0);
        if (Math.Abs(pose.X - 4) > 0.001 || pose.Moving) Fail("a companion should stop 2 m from the player, got " + pose.X);
        LevelLogic.StepFollow(pose, follow, 0.1, 4, 0, 30);
        if (Math.Abs(pose.Z - 28) > 0.001) Fail("a companion left 30 m behind should catch up at once, got " + pose.Z);

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

    // The world (spec V2): the old quarter built inside it at the harbour, streamed with the player; the coast's travel links and their lock.
    static void CheckWorld(Story story)
    {
        var worldJson = File.ReadAllText("Assets/VCGS/Generated/Levels/the_drowned_coast.json");
        var quarterJson = File.ReadAllText("Assets/VCGS/Generated/Levels/old_quarter.json");
        // The child first, then its parent: the parent takes it in.
        VCGS.EditorTools.VcgsLevelBuilder.Build(quarterJson, "Assets/VCGS/Generated/Levels/old_quarter.json", false);
        var report = VCGS.EditorTools.VcgsLevelBuilder.Build(worldJson, "Assets/VCGS/Generated/Levels/the_drowned_coast.json", false);
        var world = UnityEngine.GameObject.Find("LVL_TheDrownedCoast_02");
        var quarter = world?.transform.Find("Maps")?.Find("LVL_OldQuarter_03");
        Console.WriteLine("world built: " + string.Join(" / ", report.FindAll(l => l.Contains("inside"))));
        if (quarter == null || quarter.localPosition != new UnityEngine.Vector3(-2000, 0, -1500) || quarter.gameObject.activeSelf)
            Fail("the old quarter should be inside the world at the harbour (north is +Z), switched off until streamed in");
        var worldItems = Array.FindAll(world.transform.GetComponentsInChildren<VcgsLevelItem>(true), i => VcgsLevel.OwnedBy(world.transform, i.transform));
        if (worldItems.Length != 2) Fail("the world should own its two items, not the quarter's, got " + worldItems.Length);
        var road = world.transform.Find("Travel")?.Find("coast_road")?.GetComponent<VcgsTravelLink>();
        if (road == null || road.points.Length != 3 || road.points[2] != new UnityEngine.Vector3(1800, 0, 1200)) Fail("the coast road should be a travel link of three points");
        // Building the quarter again finds it where it is, switched off, and adds nothing.
        var again = VCGS.EditorTools.VcgsLevelBuilder.Build(quarterJson, "Assets/VCGS/Generated/Levels/old_quarter.json", false);
        if (again.Exists(l => l.StartsWith("Created") || l.StartsWith("Added"))) Fail("building the quarter again should find it inside the world, got " + string.Join(" / ", again));

        var component = world.GetComponent<VcgsLevel>();
        component.level = new UnityEngine.TextAsset { text = worldJson };
        var game = new GameState(story);
        component.Setup(game);
        var logic = component.Logic;
        if (D.Str(logic.Map, "kind") != "world" || logic.ChildMaps().Count != 2) Fail("the world's data should say it is a world with two maps inside");
        // Streaming: far off, nothing; near the harbour, the quarter comes in; well away, it goes.
        logic.Player = new double[] { 3000, 0, -3000 };
        component.Stream();
        if (quarter.gameObject.activeSelf) Fail("the quarter should stay out 5 km away");
        logic.Player = new double[] { -2000 + 650, 0, 1500 };
        component.Stream();
        if (!quarter.gameObject.activeSelf) Fail("the quarter should stream in as the player nears the harbour");
        logic.Player = new double[] { -2000 + 1200, 0, 1500 };
        component.Stream();
        if (quarter.gameObject.activeSelf) Fail("the quarter should stream out once the player is well away");
        Console.WriteLine("streamed: in at 50 m from the harbour's edge, out at 600 m");
        // Travel: closed until the cave mouth is reached, then it leads into the vault.
        var asked = new List<string>();
        var went = new List<string>();
        logic.LevelRequested += k => asked.Add(k);
        logic.TravelRequested += (k, m, how, to) => went.Add(k + " → " + (m == "" ? "here" : m) + " (" + how + ") at " + to[0] + ", " + to[2]);
        if (component.Travel("down_into_the_vault") != "Down into the vault is closed." || logic.CanTravel("down_into_the_vault")) Fail("the way down should be closed until the cave mouth is reached");
        if (component.Travel("coast_road", true) != "" || went.Count != 1 || !went[0].EndsWith("at -2000, 1500")) Fail("the coast road should lead back to the harbour, got " + string.Join(" / ", went));
        game.Visit(Scenes.Sc01TheCaveMouth);
        if (component.Travel("down_into_the_vault", true) != "Down into the vault only goes one way.") Fail("the way down should go one way");
        if (component.Travel("down_into_the_vault") != "" || asked.Count != 1 || asked[0] != "sunken_vault") Fail("the way down should lead into the vault once open, got " + string.Join(" / ", asked));
        Console.WriteLine("travel: " + string.Join(" / ", went));
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
