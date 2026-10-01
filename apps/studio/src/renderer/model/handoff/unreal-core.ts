/**
 * The portable heart of the VCGS Runtime for Unreal: one C++17 header, the
 * standard library only, no exceptions and no RTTI (as Unreal builds). It
 * reads story.json and plays it the way the Godot and Unity runtimes do, so
 * it can be compiled and run outside Unreal, and is.
 */
import { MAIL_ON_CLIPBOARD, MAILTO_LIMIT, NOTES_PRINT_STYLE } from '../play';
import { UNREAL_PUZZLES, UNREAL_STEP_PROGRESS } from './unreal-puzzles';

export const VCGS_CORE_H = String.raw`// VCGS Runtime for Unreal: the story's logic in portable C++17.
// The same for every project; safe to commit. No exceptions, no RTTI.
#pragma once

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace vcgs
{
    // ------------------------------------------------------------ JSON

    /** A JSON value: null, bool, number, string, array or object (keys kept in order). */
    struct Value
    {
        enum class Type { Null, Bool, Number, String, Array, Object };
        Type type = Type::Null;
        bool boolean = false;
        double number = 0;
        std::string text;
        std::vector<Value> items;
        std::vector<std::pair<std::string, Value>> fields;

        static const Value& None()
        {
            static const Value none;
            return none;
        }

        bool IsNull() const { return type == Type::Null; }
        bool IsObject() const { return type == Type::Object; }
        bool IsArray() const { return type == Type::Array; }
        bool IsNumber() const { return type == Type::Number; }

        bool Has(const std::string& key) const
        {
            for (const auto& f : fields)
                if (f.first == key) return true;
            return false;
        }

        const Value& operator[](const std::string& key) const
        {
            for (const auto& f : fields)
                if (f.first == key) return f.second;
            return None();
        }

        const Value& operator[](size_t index) const { return index < items.size() ? items[index] : None(); }

        size_t Size() const { return type == Type::Array ? items.size() : fields.size(); }

        std::string Str() const
        {
            if (type == Type::String) return text;
            if (type == Type::Number)
            {
                std::string s = std::to_string(number);
                s.erase(s.find_last_not_of('0') + 1);
                if (!s.empty() && s.back() == '.') s.pop_back();
                return s;
            }
            return "";
        }

        double Num(double fallback = 0) const { return type == Type::Number ? number : fallback; }
        bool Bool() const { return type == Type::Bool && boolean; }
    };

    class JsonReader
    {
    public:
        /** Parse text; on a syntax error returns null and sets error. */
        static Value Parse(const std::string& source, std::string* error = nullptr)
        {
            JsonReader r(source);
            Value v = r.ReadValue();
            r.SkipWhite();
            if (!r.failed && r.i != r.s.size()) r.Fail("unexpected text after the value");
            if (r.failed)
            {
                if (error) *error = r.message;
                return Value();
            }
            return v;
        }

    private:
        explicit JsonReader(const std::string& source) : s(source) {}
        const std::string& s;
        size_t i = 0;
        bool failed = false;
        std::string message;

        void Fail(const char* why)
        {
            if (!failed) message = std::string(why) + " at " + std::to_string(i);
            failed = true;
        }

        void SkipWhite()
        {
            while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
        }

        bool Word(const char* w)
        {
            size_t n = 0;
            while (w[n]) n++;
            if (s.compare(i, n, w) != 0) { Fail("bad literal"); return false; }
            i += n;
            return true;
        }

        Value ReadValue()
        {
            SkipWhite();
            Value v;
            if (failed || i >= s.size()) { Fail("unexpected end"); return v; }
            char c = s[i];
            if (c == '{') return ReadObject();
            if (c == '[') return ReadArray();
            if (c == '"') { v.type = Value::Type::String; v.text = ReadString(); return v; }
            if (c == 't') { if (Word("true")) { v.type = Value::Type::Bool; v.boolean = true; } return v; }
            if (c == 'f') { if (Word("false")) { v.type = Value::Type::Bool; } return v; }
            if (c == 'n') { Word("null"); return v; }
            return ReadNumber();
        }

        Value ReadObject()
        {
            Value v;
            v.type = Value::Type::Object;
            i++;
            SkipWhite();
            if (i < s.size() && s[i] == '}') { i++; return v; }
            while (!failed)
            {
                SkipWhite();
                if (i >= s.size() || s[i] != '"') { Fail("expected a key"); break; }
                std::string key = ReadString();
                SkipWhite();
                if (i >= s.size() || s[i] != ':') { Fail("expected :"); break; }
                i++;
                Value item = ReadValue();
                v.fields.emplace_back(std::move(key), std::move(item));
                SkipWhite();
                if (i < s.size() && s[i] == ',') { i++; continue; }
                if (i < s.size() && s[i] == '}') { i++; break; }
                Fail("expected , or }");
            }
            return v;
        }

        Value ReadArray()
        {
            Value v;
            v.type = Value::Type::Array;
            i++;
            SkipWhite();
            if (i < s.size() && s[i] == ']') { i++; return v; }
            while (!failed)
            {
                v.items.push_back(ReadValue());
                SkipWhite();
                if (i < s.size() && s[i] == ',') { i++; continue; }
                if (i < s.size() && s[i] == ']') { i++; break; }
                Fail("expected , or ]");
            }
            return v;
        }

        static void Utf8(std::string& out, unsigned code)
        {
            if (code < 0x80) out += static_cast<char>(code);
            else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
            else { out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F)); }
        }

        std::string ReadString()
        {
            std::string out;
            i++;
            while (i < s.size())
            {
                char c = s[i++];
                if (c == '"') return out;
                if (c != '\\') { out += c; continue; }
                if (i >= s.size()) break;
                char e = s[i++];
                switch (e)
                {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u':
                    if (i + 4 > s.size()) { Fail("bad escape"); return out; }
                    Utf8(out, static_cast<unsigned>(std::strtoul(s.substr(i, 4).c_str(), nullptr, 16)));
                    i += 4;
                    break;
                default: Fail("bad escape"); return out;
                }
            }
            Fail("unterminated string");
            return out;
        }

        Value ReadNumber()
        {
            Value v;
            size_t start = i;
            while (i < s.size() && std::string("+-0123456789.eE").find(s[i]) != std::string::npos) i++;
            if (start == i) { Fail("bad value"); return v; }
            v.type = Value::Type::Number;
            v.number = std::strtod(s.substr(start, i - start).c_str(), nullptr);
            return v;
        }
    };

    // ------------------------------------------------------------ the story

    /** The story as VC Game Studio wrote it (story.json), indexed by key. */
    class Story
    {
    public:
        explicit Story(Value root) : Root(std::move(root))
        {
            Name = Root["project"]["name"].Str();
            for (const auto& n : Root["graph"].items)
            {
                Graph[n["key"].Str()] = &n;
                if (n["kind"].Str() == "begin") Start = n["key"].Str();
            }
            Index("scenes", Scenes);
            Index("choices", Choices);
            Index("objects", Objects);
            Index("triggers", Triggers);
            Index("flags", Flags);
            Index("characters", Characters);
            Index("items", ItemDefs);
            Index("locations", LocationDefs);
            Index("cinematics", Cinematics);
            Index("quests", Quests);
            Index("encounters", Encounters);
            Index("lore", Lore);
            Index("mechanics", Mechanics);
            Index("skills", Skills);
            for (const auto& item : Root["equipment"].items) Equipment[item["item"].Str()] = &item;
            for (const auto& item : Root["recipes"].items) Recipes[item["item"].Str()] = &item;
            for (const auto& l : Root["lines"].items) Lines[l["id"].Str()] = &l;
        }
        Story(const Story&) = delete;
        Story& operator=(const Story&) = delete;

        static const Value& Find(const std::map<std::string, const Value*>& in, const std::string& key)
        {
            auto it = in.find(key);
            return it == in.end() ? Value::None() : *it->second;
        }
        /** What the codex says about a character once met ("" keeps them out of it). */
        std::string CharacterCodex(const std::string& key) const { return Find(Characters, key)["codex"].Str(); }
        /** What the codex says about an object (not a puzzle) once used ("" keeps it out of it). */
        std::string ObjectCodex(const std::string& key) const
        {
            const Value& o = Find(Objects, key);
            return o["kind"].Str() == "object" ? o["fields"]["codex"].Str() : std::string();
        }
        /** How many objects have a codex entry. */
        size_t CodexObjects() const
        {
            size_t n = 0;
            for (const auto& o : Objects) if ((*o.second)["kind"].Str() == "object" && !(*o.second)["fields"]["codex"].Str().empty()) n++;
            return n;
        }
        /** What the codex says about a location once visited ("" keeps it out of it). */
        std::string LocationCodex(const std::string& key) const { return Find(LocationDefs, key)["fields"]["codex"].Str(); }
        /** How many locations have a codex entry. */
        size_t CodexLocations() const
        {
            size_t n = 0;
            for (const auto& l : LocationDefs) if (!(*l.second)["fields"]["codex"].Str().empty()) n++;
            return n;
        }
        /** What the codex says about an item once found ("" keeps it out of it). */
        std::string ItemCodex(const std::string& key) const { return Find(ItemDefs, key)["fields"]["codex"].Str(); }
        /** How many items have a codex entry. */
        size_t CodexItems() const
        {
            size_t n = 0;
            for (const auto& i : ItemDefs) if (!(*i.second)["fields"]["codex"].Str().empty()) n++;
            return n;
        }
        /** A line's speaker key ("" for none). */
        std::string Speaker(const std::string& lineId) const { return Find(Lines, lineId)["speaker"].Str(); }
        /** How many characters have a codex entry. */
        size_t CodexCharacters() const
        {
            size_t n = 0;
            for (const auto& c : Characters) if (!(*c.second)["codex"].Str().empty()) n++;
            return n;
        }

        const Value Root;
        std::string Name;
        std::string Start;
        std::map<std::string, const Value*> Graph, Scenes, Choices, Objects, Triggers, Flags, Characters, Cinematics, Lines, Quests, Encounters, Lore, Mechanics, Skills;
        /** Items that can be equipped, by item key: name, slot, stats, ammo, ammoPerUse, durability. */
        std::map<std::string, const Value*> Equipment;
        /** Items that can be crafted, by item key: name, makes, ingredients, when (and whenText). */
        std::map<std::string, const Value*> Recipes;
        /** Inventory items, by key: name, notes and fields (the codex entry is fields.codex). */
        std::map<std::string, const Value*> ItemDefs;
        /** Locations (environments), by key: name, notes and fields (the codex entry is fields.codex). */
        std::map<std::string, const Value*> LocationDefs;

    private:
        void Index(const char* list, std::map<std::string, const Value*>& into)
        {
            for (const auto& item : Root[list].items) into[item["ident"]["key"].Str()] = &item;
        }
    };

    // ------------------------------------------------------------ the playthrough

    class GameState;

    namespace Rules
    {
        bool Check(const Value& rule, const GameState& game);
        void Apply(const Value& effects, GameState& game);
        void Fire(const std::string& trigger, GameState& game);
        void Solve(const std::string& puzzle, GameState& game);
        void Settle(GameState& game);
        void CompleteQuest(const std::string& quest, GameState& game);
        void GainRank(const std::string& skill, GameState& game);
    }

${UNREAL_STEP_PROGRESS}
    /**
     * Everything a playthrough knows. After every change, triggers fire and
     * puzzles solve themselves when their rules hold (unless AutoRules is off).
     */
    class GameState
    {
    public:
        explicit GameState(const Story& story) : StoryData(story) { Reset(); }

        const Story& StoryData;
        std::map<std::string, std::string> Flags, ObjectStates, Chosen;
        std::map<std::string, int> Items, Arcs;
        std::set<std::string> Solved, Visited, Fired, Picked;
        /** Quests under way ("active") or "done"; one not in here has not started. */
        std::map<std::string, std::string> Quests;
        /** The quests in the order they started (or were completed without starting). */
        std::vector<std::string> QuestOrder;
        /** Encounters won. */
        std::set<std::string> Won;
        /** Encounters the player has come to, in the order met (the codex). */
        std::vector<std::string> MetEncounters;
        /** Characters the player has met (heard speak), in the order met. */
        std::vector<std::string> MetCharacters;
        /** Items the player has ever held, in the order found (carried or not now). */
        std::vector<std::string> FoundItems;
        /** Locations the player has been to (a scene set there played), in the order visited. */
        std::vector<std::string> VisitedLocations;
        /** Objects the player has used, in the order first used. */
        std::vector<std::string> UsedObjects;
        /** Codex entries the player has bookmarked, by key ("lore:the_drowned_order"), in the order bookmarked. */
        std::vector<std::string> Bookmarks;
        /** The player's notes on codex entries, by key. */
        std::map<std::string, std::string> Notes;
        /** When each note was last changed (milliseconds since 1970), kept for notes taken off too, so they sync. */
        std::map<std::string, long long> NoteTimes;
        /** Lore the player has come across, in the order they found it (the codex). */
        std::vector<std::string> KnownLore;
        /** Mechanics the player can use now. */
        std::set<std::string> Mechanics;
        /** The same mechanics, in the order they became available. */
        std::vector<std::string> MechanicOrder;
        /** Skills, abilities and upgrades learned, by rank (Rules::Learn). */
        std::map<std::string, int> Skills;
        /** The same skills, in the order first learned (the codex's order). */
        std::vector<std::string> SkillOrder;
        /** What is equipped, by slot (an item key each). */
        std::map<std::string, std::string> Equipped;
        /** How many times each item of equipment has been used, toward its durability. */
        std::map<std::string, int> Wear;
        /** An item went into a slot, or came out of it: its key and the slot. */
        std::function<void(const std::string&, const std::string&)> OnItemEquipped, OnItemUnequipped;
        /** An item of equipment was used, or broke. */
        std::function<void(const std::string&)> OnItemUsed, OnItemBroke;
        /** Something was crafted: its key and how many were made. */
        std::function<void(const std::string&, int)> OnItemCrafted;
        /** A skill gained a rank: its key and new rank. */
        std::function<void(const std::string&, int)> OnSkillLearned;
        bool AutoRules = true;
        std::function<void(const std::string&)> OnTriggerFired;
        std::function<void(const std::string&)> OnQuestStarted;
        std::function<void(const std::string&)> OnQuestCompleted;
        std::function<void(const std::string&)> OnLoreDiscovered;
        std::function<void(const std::string&)> OnMechanicAvailable;
        std::function<void(const std::string&)> OnEncounterMet;
        std::function<void(const std::string&)> OnEncounterWon;
        std::function<void(const std::string&)> OnCharacterMet;
        std::function<void(const std::string&)> OnItemFound;
        std::function<void(const std::string&)> OnLocationVisited;
        std::function<void(const std::string&)> OnObjectUsed;
        /** Each puzzle's step progress (PuzzleRuntime), staged hints given, wrong answers at each screen puzzle. */
        std::map<std::string, StepProgress> PuzzleSteps;
        std::set<std::string> Hinted;
        std::map<std::string, int> ScreenFails;
        /** Seconds of play: timed puzzle steps run on it (the level director advances it each frame). */
        double Clock = 0;
        /** A puzzle step done, failed (a wrong move), expired (out of time) or reset: the puzzle, the step, what (puzzle spec §6). */
        std::function<void(const std::string&, const std::string&, const std::string&)> OnPuzzleStep;
        /** A staged hint given: the puzzle, the hint (puzzle spec §10). */
        std::function<void(const std::string&, const std::string&)> OnHint;
        /** Something a puzzle plays when solved: the puzzle, its kind, its text, what it plays (puzzle spec §11). */
        std::function<void(const std::string&, const std::string&, const std::string&, const std::string&)> OnPuzzleCue;
        /** An interaction asks for its object's screen puzzle: show it, then call Interactions::AnswerScreen (puzzle spec §8). */
        std::function<void(const std::string&, const std::string&)> OnScreenRequested;
        std::function<void(const std::string&, bool)> OnScreenAnswered;

        /** Move the play clock on; a timed puzzle step that runs out is undone. */
        void AdvanceClock(double seconds)
        {
            Clock += seconds;
            for (const auto& p : PuzzleSteps)
                if (!p.second.Begun.empty())
                {
                    Changed();
                    return;
                }
        }

        /** Whether a puzzle's step is done. */
        bool StepDone(const std::string& puzzle, const std::string& step) const
        {
            const auto it = PuzzleSteps.find(puzzle);
            return it != PuzzleSteps.end() && it->second.Done.count(step) > 0;
        }

        /** Something the rules can see changed outside the setters (a wrong answer counted). */
        void Touch() { Changed(); }

        void Reset()
        {
            hasCheckpoint = false;
            checkpointAt.clear();
            checkpointBody.clear();
            Loaded = false;
            Flags.clear(); ObjectStates.clear(); Chosen.clear(); Items.clear(); Arcs.clear();
            Solved.clear(); Visited.clear(); Fired.clear(); Picked.clear(); Quests.clear(); QuestOrder.clear(); Won.clear(); MetEncounters.clear(); MetCharacters.clear(); FoundItems.clear(); VisitedLocations.clear(); UsedObjects.clear(); Bookmarks.clear(); Notes.clear(); NoteTimes.clear(); KnownLore.clear(); Mechanics.clear(); MechanicOrder.clear(); Skills.clear(); SkillOrder.clear(); Equipped.clear(); Wear.clear();
            PuzzleSteps.clear(); Hinted.clear(); ScreenFails.clear(); Clock = 0;
            for (const auto& f : StoryData.Flags) Flags[f.first] = (*f.second)["initial"].Str();
            for (const auto& o : StoryData.Objects)
            {
                std::string initial = (*o.second)["initial"].Str();
                if ((*o.second)["kind"].Str() == "object" && !initial.empty()) ObjectStates[o.first] = initial;
            }
            // Quests with nothing to wait for start now; anything already true settles.
            Changed();
        }

        /** Listen for changes; returns an id to stop listening with. */
        int Subscribe(std::function<void()> listener)
        {
            listeners.emplace_back(++lastId, std::move(listener));
            return lastId;
        }

        void Unsubscribe(int id)
        {
            for (auto it = listeners.begin(); it != listeners.end(); ++it)
                if (it->first == id) { listeners.erase(it); return; }
        }

        std::string GetFlag(const std::string& flag) const { auto it = Flags.find(flag); return it == Flags.end() ? "" : it->second; }
        void SetFlag(const std::string& flag, const std::string& value)
        {
            auto it = Flags.find(flag);
            if (it != Flags.end() && it->second == value) return;
            Flags[flag] = value;
            Changed();
        }

        std::string GetObjectState(const std::string& obj) const { auto it = ObjectStates.find(obj); return it == ObjectStates.end() ? "" : it->second; }
        void SetObjectState(const std::string& obj, const std::string& state)
        {
            auto it = ObjectStates.find(obj);
            if (it != ObjectStates.end() && it->second == state) return;
            ObjectStates[obj] = state;
            Changed();
        }

        bool HasItem(const std::string& item) const { auto it = Items.find(item); return it != Items.end() && it->second > 0; }
        void GiveItem(const std::string& item, int count = 1)
        {
            Items[item] += count;
            if (Items[item] > 0 && std::find(FoundItems.begin(), FoundItems.end(), item) == FoundItems.end())
            {
                FoundItems.push_back(item);
                if (OnItemFound) OnItemFound(item);
            }
            Changed();
        }
        void TakeItem(const std::string& item, int count = 1)
        {
            int& n = Items[item];
            n = n - count < 0 ? 0 : n - count;
            if (n == 0) DropEquipped(item);
            Changed();
        }

        /** Nothing left of an item: it comes out of its slot, and a new one starts unworn. */
        void DropEquipped(const std::string& item)
        {
            for (auto it = Equipped.begin(); it != Equipped.end();)
            {
                if (it->second != item) { ++it; continue; }
                const std::string slot = it->first;
                it = Equipped.erase(it);
                if (OnItemUnequipped) OnItemUnequipped(item, slot);
            }
            Wear.erase(item);
        }

        bool IsEquipped(const std::string& item) const
        {
            for (const auto& e : Equipped) if (e.second == item) return true;
            return false;
        }
        /** The item in a slot ("" for none). */
        std::string EquippedIn(const std::string& slot) const
        {
            auto it = Equipped.find(slot);
            return it == Equipped.end() ? "" : it->second;
        }
        /** The slot an item is equipped in ("" when it is not). */
        std::string SlotOf(const std::string& item) const
        {
            for (const auto& e : Equipped)
                if (e.second == item) return e.first;
            return "";
        }

        /** Why an item can't be equipped now, or "" when it can. */
        std::string EquipCheck(const std::string& item) const
        {
            if (!StoryData.Equipment.count(item)) return "Not equipment.";
            const std::string name = Story::Find(StoryData.Equipment, item)["name"].Str();
            if (!HasItem(item)) return "You don't carry " + name + ".";
            if (IsEquipped(item)) return name + " is already equipped.";
            return "";
        }

        /** Put an item in its slot, putting back what was there. Returns why not ("" when equipped). */
        std::string Equip(const std::string& item)
        {
            std::string why = EquipCheck(item);
            if (!why.empty()) return why;
            const std::string slot = Story::Find(StoryData.Equipment, item)["slot"].Str();
            const std::string before = EquippedIn(slot);
            if (!before.empty())
            {
                Equipped.erase(slot);
                if (OnItemUnequipped) OnItemUnequipped(before, slot);
            }
            Equipped[slot] = item;
            if (OnItemEquipped) OnItemEquipped(item, slot);
            Changed();
            return "";
        }

        /** Take an item out of its slot. Returns why not ("" when put away). */
        std::string Unequip(const std::string& item)
        {
            for (const auto& e : Equipped)
            {
                if (e.second != item) continue;
                const std::string slot = e.first;
                Equipped.erase(slot);
                if (OnItemUnequipped) OnItemUnequipped(item, slot);
                Changed();
                return "";
            }
            const std::string name = Story::Find(StoryData.Equipment, item)["name"].Str();
            return (name.empty() ? item : name) + " is not equipped.";
        }

        /** Why an equipped item can't be used now, or "" when it can: not equipped, or out of its ammunition. */
        std::string UseCheck(const std::string& item) const
        {
            if (!StoryData.Equipment.count(item)) return "Not equipment.";
            const Value& e = Story::Find(StoryData.Equipment, item);
            if (!IsEquipped(item)) return "Equip " + e["name"].Str() + " first.";
            const Value& ammo = e["ammo"];
            if (ammo.IsObject())
            {
                auto it = Items.find(ammo["item"].Str());
                if ((it == Items.end() ? 0 : it->second) < static_cast<int>(e["ammoPerUse"].Num(1))) return "Out of " + ammo["name"].Str() + ".";
            }
            return "";
        }

        /** Use an equipped item: spend its ammunition and a use of wear; worn out, it breaks and one is gone. Returns why not ("" when used). */
        std::string UseItem(const std::string& item)
        {
            std::string why = UseCheck(item);
            if (!why.empty()) return why;
            const Value& e = Story::Find(StoryData.Equipment, item);
            if (e["ammo"].IsObject()) TakeItem(e["ammo"]["item"].Str(), static_cast<int>(e["ammoPerUse"].Num(1)));
            int used = ++Wear[item];
            if (OnItemUsed) OnItemUsed(item);
            const int durability = static_cast<int>(e["durability"].Num(0));
            if (durability > 0 && used >= durability)
            {
                Wear[item] = 0;
                if (OnItemBroke) OnItemBroke(item);
                TakeItem(item);
            }
            else Changed();
            return "";
        }

        /** Why an item can't be crafted now, or "" when it can: no recipe, its conditions, or the first ingredient short. */
        std::string CraftCheck(const std::string& item) const
        {
            if (!StoryData.Recipes.count(item)) return "Not craftable.";
            const Value& r = Story::Find(StoryData.Recipes, item);
            if (r["when"].IsObject() && !Rules::Check(r["when"], *this)) return "Needs " + r["whenText"].Str() + ".";
            for (const Value& i : r["ingredients"].items)
            {
                auto it = Items.find(i["item"].Str());
                const int have = it == Items.end() ? 0 : it->second;
                const int amount = static_cast<int>(i["amount"].Num(1));
                if (have < amount) return "Needs " + std::to_string(amount) + " \u00d7 " + i["name"].Str() + " (you have " + std::to_string(have) + ").";
            }
            return "";
        }

        /** Craft an item: its ingredients used up, what it makes given. Returns why not ("" when crafted). */
        std::string Craft(const std::string& item)
        {
            std::string why = CraftCheck(item);
            if (!why.empty()) return why;
            const Value& r = Story::Find(StoryData.Recipes, item);
            for (const Value& i : r["ingredients"].items) TakeItem(i["item"].Str(), static_cast<int>(i["amount"].Num(1)));
            const int makes = static_cast<int>(r["makes"].Num(1));
            GiveItem(item, makes);
            if (OnItemCrafted) OnItemCrafted(item, makes);
            return "";
        }

        /** Uses left before an item breaks (-1 when it never does). */
        int UsesLeft(const std::string& item) const
        {
            const int durability = static_cast<int>(Story::Find(StoryData.Equipment, item)["durability"].Num(0));
            if (durability == 0) return -1;
            auto it = Wear.find(item);
            const int left = durability - (it == Wear.end() ? 0 : it->second);
            return left < 0 ? 0 : left;
        }

        /** What the equipped items add up to for a stat (by name, ignoring case). */
        double Stat(const std::string& name) const
        {
            auto lower = [](std::string t) { for (char& ch : t) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch))); return t; };
            double total = 0;
            for (const auto& e : Equipped)
                for (const Value& st : Story::Find(StoryData.Equipment, e.second)["stats"].items)
                    if (lower(st["name"].Str()) == lower(name)) total += st["value"].Num(0);
            return total;
        }

        int Arc(const std::string& character) const { auto it = Arcs.find(character); return it == Arcs.end() ? 0 : it->second; }
        void AddArc(const std::string& character, int amount) { Arcs[character] += amount; Changed(); }
        void RememberChoice(const std::string& choice, const std::string& option) { Chosen[choice] = option; Changed(); }
        void MarkSolved(const std::string& puzzle) { if (Solved.insert(puzzle).second) Changed(); }
        void Visit(const std::string& scene) { if (Visited.insert(scene).second) Changed(); }
        /** Bookmark a codex entry ("lore:the_drowned_order"), or take its bookmark off. Returns whether it is bookmarked now. */
        bool ToggleBookmark(const std::string& entry)
        {
            auto it = std::find(Bookmarks.begin(), Bookmarks.end(), entry);
            if (it != Bookmarks.end()) { Bookmarks.erase(it); return false; }
            Bookmarks.push_back(entry);
            return true;
        }
        bool IsBookmarked(const std::string& entry) const { return std::find(Bookmarks.begin(), Bookmarks.end(), entry) != Bookmarks.end(); }
        /** Keep the player's note on a codex entry ("" takes it off). */
        void SetNote(const std::string& entry, std::string text)
        {
            NoteTimes[entry] = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            const size_t start = text.find_first_not_of(" \t\n");
            text = start == std::string::npos ? std::string() : text.substr(start, text.find_last_not_of(" \t\n") - start + 1);
            if (text.empty()) Notes.erase(entry);
            else Notes[entry] = text;
        }
        std::string NoteFor(const std::string& entry) const
        {
            auto it = Notes.find(entry);
            return it == Notes.end() ? std::string() : it->second;
        }

        /** The notes as a sync file: each with when it was last changed (a note taken off, empty). */
        std::string NotesSyncText(const std::string& story) const
        {
            auto q = [](const std::string& s)
            {
                std::string out = "\"";
                for (const char c : s)
                {
                    if (c == '"' || c == '\\') { out += '\\'; out += c; }
                    else if (c == '\n') out += "\\n";
                    else if (c == '\r') out += "\\r";
                    else if (c == '\t') out += "\\t";
                    else if (static_cast<unsigned char>(c) < 0x20)
                    {
                        const char* hex = "0123456789abcdef";
                        out += "\\u00";
                        out += hex[(c >> 4) & 0xf];
                        out += hex[c & 0xf];
                    }
                    else out += c;
                }
                return out + "\"";
            };
            std::string json = "{\n  \"format\": \"vcgs-codex-notes-sync\",\n  \"version\": 1,\n  \"story\": " + q(story) + ",\n  \"notes\": {";
            bool first = true;
            for (const auto& t : NoteTimes)
            {
                json += std::string(first ? "" : ",") + "\n    " + q(t.first) + ": { \"text\": " + q(NoteFor(t.first)) + ", \"at\": " + std::to_string(t.second) + " }";
                first = false;
            }
            return json + (first ? "}\n}" : "\n  }\n}");
        }

        /** A string as JSON writes it. */
        /** A number as JSON writes it: as short as it can be and still read back the same. */
        static std::string Number(double n)
        {
            char buf[32];
            std::snprintf(buf, sizeof buf, "%.17g", n);
            for (int digits = 1; digits <= 17; ++digits)
            {
                std::snprintf(buf, sizeof buf, "%.*g", digits, n);
                if (std::strtod(buf, nullptr) == n) break;
            }
            return buf;
        }

        static std::string JsonQuote(const std::string& s)
        {
            std::string out = "\"";
            for (const char c : s)
            {
                if (c == '"' || c == '\\') { out += '\\'; out += c; }
                else if (c == '\n') out += "\\n";
                else if (c == '\r') out += "\\r";
                else if (c == '\t') out += "\\t";
                else if (static_cast<unsigned char>(c) < 0x20)
                {
                    const char* hex = "0123456789abcdef";
                    out += "\\u00";
                    out += hex[(c >> 4) & 0xf];
                    out += hex[c & 0xf];
                }
                else out += c;
            }
            return out + "\"";
        }

        /** Everything the story knows, as the fields of a save (without the codex notes and bookmarks, which are the player's own). */
        std::string SaveBody() const
        {
            auto list = [](const auto& keys)
            {
                std::string out = "[";
                bool first = true;
                for (const std::string& k : keys) { out += (first ? "" : ", ") + JsonQuote(k); first = false; }
                return out + "]";
            };
            auto strings = [](const std::map<std::string, std::string>& m)
            {
                std::string out = "{";
                bool first = true;
                for (const auto& e : m) { out += (first ? "" : ", ") + JsonQuote(e.first) + ": " + JsonQuote(e.second); first = false; }
                return out + "}";
            };
            auto numbers = [](const std::map<std::string, int>& m)
            {
                std::string out = "{";
                bool first = true;
                for (const auto& e : m) { out += (first ? "" : ", ") + JsonQuote(e.first) + ": " + std::to_string(e.second); first = false; }
                return out + "}";
            };
            auto puzzles = [this]()
            {
                auto ints = [](const std::map<std::string, int>& m)
                {
                    std::string out = "{";
                    bool first = true;
                    for (const auto& e : m) { out += (first ? "" : ", ") + JsonQuote(e.first) + ": " + std::to_string(e.second); first = false; }
                    return out + "}";
                };
                std::string out = "{";
                bool first = true;
                for (const auto& e : PuzzleSteps)
                {
                    const StepProgress& p = e.second;
                    std::string begun = "{", wrong = "{", stale = "{";
                    for (const auto& b : p.Begun) begun += (begun.size() > 1 ? ", " : "") + JsonQuote(b.first) + ": " + Number(b.second);
                    for (const auto& w : p.Wrong) wrong += (wrong.size() > 1 ? ", " : "") + JsonQuote(w.first) + ": " + (w.second ? "true" : "false");
                    for (const auto& st : p.Stale) stale += (stale.size() > 1 ? ", " : "") + JsonQuote(st) + ": true";
                    out += (first ? "" : ", ") + JsonQuote(e.first) + ": {\"done\": " + ints(p.Done) + ", \"failed\": " + ints(p.Failed) + ", \"begun\": " + begun + "}, \"seq\": " + std::to_string(p.Seq) +
                           ", \"fails\": " + std::to_string(p.Fails) + ", \"wrong\": " + wrong + "}, \"stale\": " + stale + "}}";
                    first = false;
                }
                return out + "}";
            };
            auto learned = [this]()
            {
                std::string out = "{";
                for (size_t i = 0; i < SkillOrder.size(); ++i) out += (i ? ", " : "") + JsonQuote(SkillOrder[i]) + ": " + std::to_string(SkillRank(SkillOrder[i]));
                return out + "}";
            };
            std::string quests = "[";
            for (size_t i = 0; i < QuestOrder.size(); ++i)
            {
                auto q = Quests.find(QuestOrder[i]);
                quests += (i ? ", " : "") + std::string("{\"key\": ") + JsonQuote(QuestOrder[i]) + ", \"state\": " + JsonQuote(q == Quests.end() ? "" : q->second) + "}";
            }
            quests += "]";
            return "  \"flags\": " + strings(Flags) + ",\n  \"objects\": " + strings(ObjectStates) + ",\n  \"items\": " + numbers(Items) + ",\n  \"arcs\": " + numbers(Arcs) +
                   ",\n  \"chosen\": " + strings(Chosen) + ",\n  \"quests\": " + quests + ",\n  \"solved\": " + list(Solved) + ",\n  \"visited\": " + list(Visited) +
                   ",\n  \"fired\": " + list(Fired) + ",\n  \"picked\": " + list(Picked) + ",\n  \"won\": " + list(Won) + ",\n  \"met\": " + list(MetEncounters) +
                   ",\n  \"characters\": " + list(MetCharacters) + ",\n  \"found\": " + list(FoundItems) + ",\n  \"locations\": " + list(VisitedLocations) +
                   ",\n  \"used\": " + list(UsedObjects) + ",\n  \"lore\": " + list(KnownLore) + ",\n  \"mechanics\": " + list(MechanicOrder) +
                   ",\n  \"skills\": " + learned() + ",\n  \"equipped\": " + strings(Equipped) + ",\n  \"wear\": " + numbers(Wear) +
                   ",\n  \"puzzles\": " + puzzles() + ",\n  \"hinted\": " + list(Hinted) + ",\n  \"screenFails\": " + numbers(ScreenFails) + ",\n  \"clock\": " + Number(Clock);
        }

        /** Keep the game as it is now, as the scene starting (sceneKey) begins: what a save keeps. The scene player calls it. */
        void Checkpoint(const std::string& sceneKey)
        {
            checkpointAt = sceneKey;
            checkpointBody = SaveBody();
            hasCheckpoint = true;
        }

        /**
         * The save file's text: the game as the scene being played began (as it
         * is now, before any scene). The same format in every VCGS runtime, so a
         * save from one engine loads in another.
         */
        std::string SaveText(const std::string& story) const
        {
            const long long now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            return "{\n  \"format\": \"vcgs-save\",\n  \"version\": 1,\n  \"story\": " + JsonQuote(story) + ",\n  \"at\": " + JsonQuote(hasCheckpoint ? checkpointAt : "") +
                   ",\n  \"saved_at\": " + std::to_string(now) + ",\n" + (hasCheckpoint ? checkpointBody : SaveBody()) + "\n}";
        }

        /** True after a load, until the scene it resumes at starts. */
        bool Loaded = false;

        /**
         * Load a save (from this runtime or another engine's): everything the
         * story knows is as it was saved (anything the story gained since starts
         * where it starts). Returns false when the text is not a save; At gets the
         * scene to play from ("" for the story's beginning).
         */
        bool LoadSave(const std::string& text, std::string& At)
        {
            std::string error;
            const Value data = JsonReader::Parse(text, &error);
            if (!error.empty() || data["format"].Str() != "vcgs-save") return false;
            const bool keepRules = AutoRules;
            AutoRules = false;
            Flags.clear(); ObjectStates.clear(); Chosen.clear(); Items.clear(); Arcs.clear();
            Solved.clear(); Visited.clear(); Fired.clear(); Picked.clear(); Quests.clear(); QuestOrder.clear(); Won.clear(); MetEncounters.clear(); MetCharacters.clear(); FoundItems.clear(); VisitedLocations.clear(); UsedObjects.clear(); KnownLore.clear(); Mechanics.clear(); MechanicOrder.clear(); Skills.clear(); SkillOrder.clear(); Equipped.clear(); Wear.clear();
            for (const auto& f : StoryData.Flags) Flags[f.first] = (*f.second)["initial"].Str();
            for (const auto& o : StoryData.Objects)
            {
                std::string initial = (*o.second)["initial"].Str();
                if ((*o.second)["kind"].Str() == "object" && !initial.empty()) ObjectStates[o.first] = initial;
            }
            for (const auto& e : data["flags"].fields) Flags[e.first] = e.second.Str();
            for (const auto& e : data["objects"].fields) ObjectStates[e.first] = e.second.Str();
            for (const auto& e : data["chosen"].fields) Chosen[e.first] = e.second.Str();
            for (const auto& e : data["items"].fields) Items[e.first] = static_cast<int>(e.second.number);
            for (const auto& e : data["arcs"].fields) Arcs[e.first] = static_cast<int>(e.second.number);
            for (const auto& e : data["equipped"].fields) Equipped[e.first] = e.second.Str();
            for (const auto& e : data["wear"].fields) Wear[e.first] = static_cast<int>(e.second.number);
            for (const auto& e : data["skills"].fields)
            {
                Skills[e.first] = static_cast<int>(e.second.number);
                if (Skills[e.first] > 0 && std::find(SkillOrder.begin(), SkillOrder.end(), e.first) == SkillOrder.end()) SkillOrder.push_back(e.first);
            }
            for (const Value& q : data["quests"].items)
            {
                const std::string key = q["key"].Str();
                if (key.empty() || Quests.count(key)) continue;
                Quests[key] = q["state"].Str();
                QuestOrder.push_back(key);
            }
            auto keys = [&](const char* field, std::set<std::string>& into)
            {
                for (const Value& k : data[field].items) if (k.type == Value::Type::String) into.insert(k.text);
            };
            keys("solved", Solved); keys("visited", Visited); keys("fired", Fired); keys("picked", Picked); keys("won", Won);
            auto ordered = [&](const char* field, std::vector<std::string>& into)
            {
                for (const Value& k : data[field].items)
                    if (k.type == Value::Type::String && std::find(into.begin(), into.end(), k.text) == into.end()) into.push_back(k.text);
            };
            ordered("met", MetEncounters); ordered("characters", MetCharacters); ordered("found", FoundItems); ordered("locations", VisitedLocations);
            ordered("used", UsedObjects); ordered("lore", KnownLore); ordered("mechanics", MechanicOrder);
            Mechanics.insert(MechanicOrder.begin(), MechanicOrder.end());
            PuzzleSteps.clear(); Hinted.clear(); ScreenFails.clear();
            for (const auto& e : data["puzzles"].fields)
            {
                StepProgress& p = PuzzleSteps[e.first];
                for (const auto& d : e.second["done"].fields) p.Done[d.first] = static_cast<int>(d.second.Num());
                for (const auto& d : e.second["failed"].fields) p.Failed[d.first] = static_cast<int>(d.second.Num());
                for (const auto& d : e.second["begun"].fields) p.Begun[d.first] = d.second.Num();
                for (const auto& d : e.second["wrong"].fields) p.Wrong[d.first] = d.second.Bool();
                for (const auto& d : e.second["stale"].fields) p.Stale.insert(d.first);
                p.Seq = static_cast<int>(e.second["seq"].Num());
                p.Fails = static_cast<int>(e.second["fails"].Num());
            }
            for (const Value& h : data["hinted"].items) if (h.type == Value::Type::String) Hinted.insert(h.text);
            for (const auto& e : data["screenFails"].fields) ScreenFails[e.first] = static_cast<int>(e.second.Num());
            Clock = data["clock"].Num();
            Checkpoint(data["at"].Str());
            Loaded = true;
            Changed();
            AutoRules = keepRules;
            At = checkpointAt;
            return true;
        }

        /** Merge a sync file into the notes: for each entry, the newer note wins (on a tie, ours). Returns how many notes it changed, or -1 when the text is not a sync file. */
        int SyncNotes(const std::string& text)
        {
            std::string error;
            const Value data = JsonReader::Parse(text, &error);
            if (!error.empty() || data["format"].Str() != "vcgs-codex-notes-sync" || !data["notes"].IsObject()) return -1;
            int changed = 0;
            for (const auto& n : data["notes"].fields)
            {
                if (n.second["text"].type != Value::Type::String || !n.second["at"].IsNumber()) continue;
                const long long at = static_cast<long long>(n.second["at"].number);
                auto ours = NoteTimes.find(n.first);
                if (ours != NoteTimes.end() && at <= ours->second) continue;
                const std::string before = NoteFor(n.first);
                SetNote(n.first, n.second["text"].Str());
                NoteTimes[n.first] = at;
                if (NoteFor(n.first) != before) changed++;
            }
            return changed;
        }
        /** The player has used an object (Interactions::Interact says so). */
        void UseObject(const std::string& obj)
        {
            if (obj.empty() || std::find(UsedObjects.begin(), UsedObjects.end(), obj) != UsedObjects.end()) return;
            UsedObjects.push_back(obj);
            if (OnObjectUsed) OnObjectUsed(obj);
        }
        /** The player is at a location (the scene player says so as a scene set there starts). */
        void VisitLocation(const std::string& location)
        {
            if (location.empty() || std::find(VisitedLocations.begin(), VisitedLocations.end(), location) != VisitedLocations.end()) return;
            VisitedLocations.push_back(location);
            if (OnLocationVisited) OnLocationVisited(location);
        }
        void MarkPicked(const std::string& option) { Picked.insert(option); }
        bool WasPicked(const std::string& option) const { return Picked.count(option) > 0; }

        /** "" (not started), "active" or "done". */
        std::string QuestState(const std::string& quest) const { auto it = Quests.find(quest); return it == Quests.end() ? "" : it->second; }
        void SetQuest(const std::string& quest, const std::string& state)
        {
            if (QuestState(quest) == state) return;
            if (QuestState(quest).empty()) QuestOrder.push_back(quest);
            Quests[quest] = state;
            if (state == "active" && OnQuestStarted) OnQuestStarted(quest);
            else if (state == "done" && OnQuestCompleted) OnQuestCompleted(quest);
            Changed();
        }

        bool KnowsLore(const std::string& lore) const
        {
            for (const auto& l : KnownLore) if (l == lore) return true;
            return false;
        }
        void DiscoverLore(const std::string& lore)
        {
            if (KnowsLore(lore)) return;
            KnownLore.push_back(lore);
            if (OnLoreDiscovered) OnLoreDiscovered(lore);
            Changed();
        }

        /** A skill's rank: 0 until learned. */
        int SkillRank(const std::string& skill) const
        {
            auto it = Skills.find(skill);
            return it == Skills.end() ? 0 : it->second;
        }
        /** One rank more of a skill (Rules::Learn pays for it and checks what it needs first). */
        void AddSkillRank(const std::string& skill)
        {
            int rank = ++Skills[skill];
            if (rank == 1) SkillOrder.push_back(skill);
            if (OnSkillLearned) OnSkillLearned(skill, rank);
            Changed();
        }

        bool HasMechanic(const std::string& mechanic) const { return Mechanics.count(mechanic) > 0; }
        void EnableMechanic(const std::string& mechanic)
        {
            if (!Mechanics.insert(mechanic).second) return;
            MechanicOrder.push_back(mechanic);
            if (OnMechanicAvailable) OnMechanicAvailable(mechanic);
            Changed();
        }

        bool WasWon(const std::string& encounter) const { return Won.count(encounter) > 0; }
        void MarkWon(const std::string& encounter)
        {
            if (!Won.insert(encounter).second) return;
            MeetEncounter(encounter);
            if (OnEncounterWon) OnEncounterWon(encounter);
            Changed();
        }
        bool HasMetCharacter(const std::string& character) const { return std::find(MetCharacters.begin(), MetCharacters.end(), character) != MetCharacters.end(); }
        /** The player has met a character (the scene flow says so when they speak a line). */
        void MeetCharacter(const std::string& character)
        {
            if (character.empty() || HasMetCharacter(character)) return;
            MetCharacters.push_back(character);
            if (OnCharacterMet) OnCharacterMet(character);
        }
        bool HasMet(const std::string& encounter) const { return std::find(MetEncounters.begin(), MetEncounters.end(), encounter) != MetEncounters.end(); }
        /** The player has come to an encounter (the scene flow says so as it starts). */
        void MeetEncounter(const std::string& encounter)
        {
            if (HasMet(encounter)) return;
            MetEncounters.push_back(encounter);
            if (OnEncounterMet) OnEncounterMet(encounter);
        }

    private:
        std::vector<std::pair<int, std::function<void()>>> listeners;
        int lastId = 0;
        bool settling = false;

        /** The game as the scene being played began (the fields of a save), and that scene. */
        std::string checkpointAt, checkpointBody;
        bool hasCheckpoint = false;

        void Changed()
        {
            // A listener may stop listening while we call it: call a copy.
            auto calling = listeners;
            for (auto& l : calling) l.second();
            if (!AutoRules || settling) return;
            settling = true;
            Rules::Settle(*this);
            settling = false;
        }
    };

${UNREAL_PUZZLES}
    // ------------------------------------------------------------ rules

    namespace Rules
    {
        inline bool Holds(const Value& c, const GameState& game)
        {
            const std::string ref = c["ref"].Str();
            const std::string op = c["op"].Str();
            const std::string kind = c["kind"].Str();
            if (kind == "flag") return (game.GetFlag(ref) == c["value"].Str()) == (op == "is");
            if (kind == "object") return (game.GetObjectState(ref) == c["value"].Str()) == (op == "is");
            if (kind == "item") return game.HasItem(ref) == (op == "has");
            if (kind == "choice")
            {
                auto it = game.Chosen.find(ref);
                const std::string value = c["value"].Str();
                bool picked = it != game.Chosen.end() && (value.empty() || it->second == value);
                return picked == (op == "chose");
            }
            if (kind == "arc")
            {
                int n = game.Arc(ref);
                int v = static_cast<int>(c["value"].Num());
                return op == "atLeast" ? n >= v : n <= v;
            }
            if (kind == "puzzle") return (game.Solved.count(ref) > 0) == (op == "solved");
            if (kind == "visited") return (game.Visited.count(ref) > 0) == (op == "visited");
            if (kind == "quest")
            {
                const std::string state = game.QuestState(ref);
                if (op == "done") return state == "done";
                if (op == "notDone") return state != "done";
                if (op == "active") return state == "active";
                return state.empty();
            }
            if (kind == "lore") return game.KnowsLore(ref) == (op == "known");
            if (kind == "mechanic") return game.HasMechanic(ref) == (op == "available");
            if (kind == "equipped") return game.IsEquipped(ref) == (op == "equipped");
            if (kind == "stat")
            {
                const double total = game.Stat(ref);
                const double bar = c["value"].Num(1);
                return op == "atLeast" ? total >= bar : total < bar;
            }
            if (kind == "skill")
            {
                int rank = game.SkillRank(ref);
                int at = static_cast<int>(c["value"].Num(1));
                return op == "atLeast" ? rank >= at : rank < at;
            }
            return false;
        }

        /** { match: all|any, items: [conditions or rules] }; an empty rule holds. */
        inline bool Check(const Value& rule, const GameState& game)
        {
            if (!rule.IsObject() || rule.Size() == 0) return true;
            const Value& items = rule["items"];
            if (items.items.empty()) return true;
            bool any = rule["match"].Str() == "any";
            for (const auto& item : items.items)
            {
                bool ok = item.Has("match") ? Check(item, game) : Holds(item, game);
                if (any && ok) return true;
                if (!any && !ok) return false;
            }
            return !any;
        }

        inline void Apply(const Value& effects, GameState& game)
        {
            for (const auto& e : effects.items)
            {
                const std::string kind = e["kind"].Str();
                const std::string ref = e["ref"].Str();
                if (kind == "setFlag") game.SetFlag(ref, e["value"].Str());
                else if (kind == "setObject") game.SetObjectState(ref, e["value"].Str());
                else if (kind == "give") game.GiveItem(ref);
                else if (kind == "take") game.TakeItem(ref);
                else if (kind == "arc") game.AddArc(ref, static_cast<int>(e["amount"].Num()));
                else if (kind == "solve") Solve(ref, game);
                else if (kind == "fire") Fire(ref, game);
                else if (kind == "startQuest") { if (game.QuestState(ref).empty()) game.SetQuest(ref, "active"); }
                else if (kind == "revealLore") game.DiscoverLore(ref);
                else if (kind == "completeQuest") CompleteQuest(ref, game);
                else if (kind == "enableMechanic") game.EnableMechanic(ref);
                else if (kind == "learnSkill") GainRank(ref, game);
                else if (kind == "equip") game.Equip(ref);
                else if (kind == "unequip") game.Unequip(ref);
            }
        }

        inline void Fire(const std::string& trigger, GameState& game)
        {
            game.Fired.insert(trigger);
            const Value& t = Story::Find(game.StoryData.Triggers, trigger);
            const Value& sets = t["sets"];
            if (sets.IsObject()) game.SetFlag(sets["flag"].Str(), sets["value"].Str());
            Apply(t["effects"], game);
            if (game.OnTriggerFired) game.OnTriggerFired(trigger);
        }

        inline void Solve(const std::string& puzzle, GameState& game)
        {
            if (game.Solved.count(puzzle)) return;
            game.MarkSolved(puzzle);
            const Value& p = Story::Find(game.StoryData.Objects, puzzle);
            if (game.OnPuzzleCue)
                for (const auto& cue : p["design"]["cues"].items) game.OnPuzzleCue(puzzle, cue["kind"].Str(), cue["text"].Str(), cue["ref"].Str());
            Apply(p["effects"], game);
        }

        /**
         * Staged hints (puzzle spec §10): for each puzzle under way, each hint once
         * its wrong moves are made (at its steps and its elements' screens) and its
         * condition holds.
         */
        inline void GiveHints(GameState& game)
        {
            for (const auto& o : game.StoryData.Objects)
            {
                const Value& design = (*o.second)["design"];
                if (design["hints"].items.empty() || game.Solved.count(o.first)) continue;
                if (design.Has("entry") && !Check(design["entry"], game)) continue;
                const auto progress = game.PuzzleSteps.find(o.first);
                int fails = progress == game.PuzzleSteps.end() ? 0 : progress->second.Fails;
                for (const auto& e : design["elements"].items)
                {
                    const auto f = game.ScreenFails.find(e.Str());
                    if (f != game.ScreenFails.end()) fails += f->second;
                }
                for (const Value* h : PuzzleRuntime::DueHints(design, fails, game.Hinted, game))
                {
                    game.Hinted.insert((*h)["id"].Str());
                    if (game.OnHint) game.OnHint(o.first, (*h)["text"].Str());
                }
            }
        }

        /**
         * Fire every trigger, and solve every puzzle, whose rule now holds. A quest
         * starts when its start rule holds (at once without one) and is done when its
         * completion rule holds, paying its reward.
         */
        inline void Settle(GameState& game)
        {
            for (int round = 0; round < 8; round++)
            {
                bool moved = false;
                for (const auto& l : game.StoryData.Lore)
                {
                    if (game.KnowsLore(l.first) || (*l.second)["byEffect"].Bool() || !Check((*l.second)["discoveredWhen"], game)) continue;
                    game.DiscoverLore(l.first);
                    moved = true;
                }
                for (const auto& m : game.StoryData.Mechanics)
                {
                    if (game.HasMechanic(m.first) || (*m.second)["byEffect"].Bool() || !Check((*m.second)["availableWhen"], game)) continue;
                    game.EnableMechanic(m.first);
                    moved = true;
                }
                for (const auto& q : game.StoryData.Quests)
                {
                    const Value& quest = *q.second;
                    const std::string state = game.QuestState(q.first);
                    if (state.empty() && !quest["byEffect"].Bool() && Check(quest["starts"], game))
                    {
                        game.SetQuest(q.first, "active");
                        moved = true;
                    }
                    else if (state == "active" && quest.Has("completes") && Check(quest["completes"], game))
                    {
                        CompleteQuest(q.first, game);
                        moved = true;
                    }
                }
                for (const auto& t : game.StoryData.Triggers)
                {
                    const Value& trig = *t.second;
                    if (trig["kind"].Str() != "trigger" || !trig.Has("rule") || game.Fired.count(t.first) || !Check(trig["rule"], game)) continue;
                    Fire(t.first, game);
                    moved = true;
                }
                for (const auto& p : game.StoryData.Objects)
                {
                    const Value& puzzle = *p.second;
                    if (puzzle["kind"].Str() != "puzzle" || game.Solved.count(p.first)) continue;
                    const Value& design = puzzle["design"];
                    if (design["progress"].Bool())
                    {
                        // Its steps are kept as they are done: in order, in time, with their rewards and wrong moves.
                        const auto before = game.PuzzleSteps.find(p.first);
                        PuzzleRuntime::Advanced r = PuzzleRuntime::Advance(design, before == game.PuzzleSteps.end() ? nullptr : &before->second, game, game.Clock);
                        if (r.Changed)
                        {
                            game.PuzzleSteps[p.first] = r.Progress;
                            if (game.OnPuzzleStep)
                                for (const auto& e : r.Events) game.OnPuzzleStep(p.first, e.Step, e.What);
                            Apply(r.Effects, game);
                            moved = true;
                        }
                        if (r.Solved)
                        {
                            Solve(p.first, game);
                            moved = true;
                        }
                        continue;
                    }
                    if (!puzzle.Has("solvedWhen") || !Check(puzzle["solvedWhen"], game)) continue;
                    Solve(p.first, game);
                    moved = true;
                }
                if (!moved) break;
            }
            GiveHints(game);
        }

        /** Complete a quest now, started or not, and pay its reward (once). */
        /**
         * Why the next rank of a skill can't be learned now, or "" when it can:
         * fully learned, a skill to learn first, its conditions, or its cost
         * (the same words as the studio).
         */
        inline std::string LearnCheck(const std::string& skill, const GameState& game)
        {
            if (!game.StoryData.Skills.count(skill)) return "Not a skill.";
            const Value& s = Story::Find(game.StoryData.Skills, skill);
            int rank = game.SkillRank(skill);
            int ranks = static_cast<int>(s["ranks"].Num(1));
            if (rank >= ranks) return ranks > 1 ? "All " + std::to_string(ranks) + " ranks learned." : std::string("Learned.");
            std::string missing;
            for (const Value& r : s["requires"].items)
            {
                const std::string key = r.Str();
                if (game.SkillRank(key) >= 1) continue;
                const Value& need = Story::Find(game.StoryData.Skills, key);
                missing += (missing.empty() ? "" : " and ") + (need["name"].Str().empty() ? key : need["name"].Str());
            }
            if (!missing.empty()) return "Learn " + missing + " first.";
            if (s["learnWhen"].IsObject() && !Check(s["learnWhen"], game)) return "Needs " + s["learnWhenText"].Str() + ".";
            const Value& cost = s["cost"];
            if (cost.IsObject())
            {
                auto it = game.Items.find(cost["item"].Str());
                int have = it == game.Items.end() ? 0 : it->second;
                int amount = static_cast<int>(cost["amount"].Num(1));
                if (have < amount) return "Costs " + std::to_string(amount) + " \u00d7 " + cost["name"].Str() + " (you have " + std::to_string(have) + ").";
            }
            return "";
        }

        /** Learn the next rank: pay its cost, gain the rank, do what it does. Returns why not ("" when learned). */
        inline std::string Learn(const std::string& skill, GameState& game)
        {
            std::string why = LearnCheck(skill, game);
            if (!why.empty()) return why;
            const Value& cost = Story::Find(game.StoryData.Skills, skill)["cost"];
            if (cost.IsObject()) game.TakeItem(cost["item"].Str(), static_cast<int>(cost["amount"].Num(1)));
            GainRank(skill, game);
            return "";
        }

        /** A rank given (by learning, or an effect): up to its ranks, and what learning it does. */
        inline void GainRank(const std::string& skill, GameState& game)
        {
            if (!game.StoryData.Skills.count(skill)) return;
            const Value& s = Story::Find(game.StoryData.Skills, skill);
            if (game.SkillRank(skill) >= static_cast<int>(s["ranks"].Num(1))) return;
            game.AddSkillRank(skill);
            Apply(s["onLearn"], game);
        }

        inline void CompleteQuest(const std::string& quest, GameState& game)
        {
            if (game.QuestState(quest) == "done") return;
            game.SetQuest(quest, "done");
            Apply(Story::Find(game.StoryData.Quests, quest)["reward"], game);
        }

        /** Whether a win against this encounter counts now (its win rule holds). */
        inline bool CanWin(const std::string& encounter, const GameState& game) { return Check(Story::Find(game.StoryData.Encounters, encounter)["winWhen"], game); }

        inline void Win(const std::string& encounter, GameState& game)
        {
            game.MarkWon(encounter);
            Apply(Story::Find(game.StoryData.Encounters, encounter)["onWin"], game);
        }

        /** Do a loss's effects; returns what it leads to: "retry", "gameOver" or "carryOn". */
        inline std::string Lose(const std::string& encounter, GameState& game)
        {
            const Value& e = Story::Find(game.StoryData.Encounters, encounter);
            Apply(e["onLose"], game);
            const std::string loss = e["loss"].Str();
            return loss.empty() ? "retry" : loss;
        }

        /** A gate is open when its rule holds (a gate with no rule is open). */
        inline bool GateOpen(const std::string& gate, const GameState& game) { return Check(Story::Find(game.StoryData.Triggers, gate)["rule"], game); }

        struct Offered
        {
            bool Listed = true;
            bool Available = true;
            std::string Why;
        };

        /** An option is gone once picked (after: gone), locked (after: locked), or hidden until its conditions hold (hide). */
        inline Offered Offer(const Value& option, const std::string& key, const GameState& game)
        {
            Offered o;
            bool was = game.WasPicked(key);
            const std::string after = option["after"].Str();
            if (was && after == "gone") { o.Listed = false; o.Available = false; return o; }
            if (was && after == "locked") { o.Available = false; o.Why = "already chosen"; return o; }
            o.Available = Check(option["when"], game);
            if (!o.Available && option["hide"].Bool()) { o.Listed = false; return o; }
            if (!o.Available) o.Why = "conditions not met";
            return o;
        }
    }

    // ------------------------------------------------------------ the codex

    /**
     * The codex as the player reads it: the quest log (quests under way with
     * their goals, then those done, in the order they started), the mechanics
     * available and the lore found, in the order found. New() counts what has happened since the codex
     * was last read, for a "new" badge. AVcgsCodexHUD draws it; or use it in
     * your own UI (UVcgsSubsystem::GetCodexText).
     */
    class Codex
    {
    public:
        explicit Codex(const GameState& state) : game(state), seen(Progress()) {}

        /** Quest updates and lore found since MarkRead (a new game starts from nothing). */
        int New()
        {
            const int now = Progress();
            if (now < seen) seen = 0;
            return now - seen;
        }

        void MarkRead() { seen = Progress(); }

        /** What a codex button says: "Codex (C)", or with how many are new. */
        std::string ButtonText(const std::string& key)
        {
            const int n = New();
            return "Codex (" + key + ")" + (n > 0 ? " · " + std::to_string(n) + " new" : "");
        }

        /** Every section a codex can have, in the order it shows them. */
        static const std::vector<std::string>& Sections()
        {
            static const std::vector<std::string> all = {"quests", "characters", "locations", "items", "objects", "mechanics", "skills", "encounters", "lore"};
            return all;
        }

        /** The sections this story's codex has (those with anything to find), in order: what a filter by section offers. */
        std::vector<std::string> SectionKeys() const
        {
            const Story& s = game.StoryData;
            const bool has[] = {!s.Quests.empty(), s.CodexCharacters() > 0, s.CodexLocations() > 0, s.CodexItems() > 0, s.CodexObjects() > 0, !s.Mechanics.empty(), !s.Skills.empty(), !s.Encounters.empty(), !s.Lore.empty()};
            std::vector<std::string> keys;
            for (size_t i = 0; i < Sections().size(); i++) if (has[i]) keys.push_back(Sections()[i]);
            return keys;
        }

        /** A section's name for the player: "lore" reads "Lore". */
        static std::string Title(std::string key)
        {
            if (!key.empty() && key[0] >= 'a' && key[0] <= 'z') key[0] = static_cast<char>(key[0] - 'a' + 'A');
            return key;
        }

        /**
         * The whole codex in words, the same as Godot's placeholder scenes show it.
         * With a search, only the entries it finds (ignoring case), in the sections
         * that have any; the headings still count everything. With a section
         * ("quests", "lore"…, as SectionKeys lists them), only that one. With a
         * sort ("found", the default; "newest"; "name", A–Z ignoring case), each
         * section in that order (quests under way still before those done).
         * An entry the player has a note on ends with it ("Note: …"), and a
         * search looks in the notes too. A bookmarked entry ends its first line with ★; the section "bookmarks"
         * shows only them. The cursor entry (a key, "lore:…") starts with ▶.
         */
        std::string Text(const std::string& query = "", const std::string& only = "", const std::string& sort = "", const std::string& cursor = "") const
        {
            const std::string q = Lower(Trim(query));
            std::vector<std::string> parts;
            ShownKeys.clear();
            Titles.clear();
            using Entries = std::vector<std::pair<std::string, std::string>>;
            auto sorted = [&](Entries entries)
            {
                if (sort == "newest") std::reverse(entries.begin(), entries.end());
                else if (sort == "name") std::stable_sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) { return Lower(a.second) < Lower(b.second); });
                return entries;
            };
            auto section = [&](const char* key, const std::string& heading, const Entries& all, const char* sep, const char* empty)
            {
                Entries entries;
                if (only == "bookmarks")
                {
                    for (const auto& e : all) if (game.IsBookmarked(e.first)) entries.push_back(e);
                    if (entries.empty()) return;
                }
                else if (!only.empty() && only != key) return;
                else entries = all;
                Entries shown;
                for (const auto& e : std::string(key) == "quests" ? entries : sorted(entries)) if (q.empty() || Lower(e.second).find(q) != std::string::npos || Lower(game.NoteFor(e.first)).find(q) != std::string::npos) shown.push_back(e);
                if (!q.empty() && shown.empty()) return;
                std::string text = heading;
                if (shown.empty()) text += std::string("\n") + empty;
                for (const auto& e : shown)
                {
                    std::string words = e.second;
                    if (game.IsBookmarked(e.first))
                    {
                        const size_t nl = words.find('\n');
                        words = nl == std::string::npos ? words + " ★" : words.substr(0, nl) + " ★" + words.substr(nl);
                    }
                    if (e.first == cursor) words = "▶ " + words;
                    if (!game.NoteFor(e.first).empty()) words += "\nNote: " + game.NoteFor(e.first);
                    text += sep + words;
                    ShownKeys.push_back(e.first);
                    std::string first = e.second.substr(0, e.second.find('\n'));
                    if (first.rfind("• ", 0) == 0) first = first.substr(std::string("• ").size());
                    Titles[e.first] = Upper(key) + " · " + first;
                }
                parts.push_back(text);
            };
            auto title = [](const std::string& name, const std::string& key) { return Upper(name.empty() ? key : name); };
            if (!game.StoryData.Quests.empty())
            {
                Entries active, done;
                for (const std::string& key : game.QuestOrder)
                {
                    const Value& quest = Story::Find(game.StoryData.Quests, key);
                    const std::string name = quest["name"].Str().empty() ? key : quest["name"].Str();
                    const std::string goal = quest["fields"]["goal"].Str();
                    if (game.QuestState(key) == "done") done.push_back({"quests:" + key, "• " + name + " (done)"});
                    else active.push_back({"quests:" + key, "• " + name + (goal.empty() ? "" : " — " + goal)});
                }
                const std::string heading = "QUESTS · " + std::to_string(active.size()) + " under way, " + std::to_string(done.size()) + " done";
                active = sorted(active);
                done = sorted(done);
                active.insert(active.end(), done.begin(), done.end());
                section("quests", heading, active, "\n", "None yet.");
            }
            if (const size_t withEntry = game.StoryData.CodexCharacters())
            {
                Entries cast;
                for (const std::string& key : game.MetCharacters)
                {
                    const std::string codex = game.StoryData.CharacterCodex(key);
                    if (!codex.empty()) cast.push_back({"characters:" + key, title(Story::Find(game.StoryData.Characters, key)["name"].Str(), key) + "\n" + codex});
                }
                section("characters", "CHARACTERS · " + std::to_string(cast.size()) + " of " + std::to_string(withEntry) + " met", cast, "\n\n", "None yet.");
            }
            if (const size_t withEntry = game.StoryData.CodexLocations())
            {
                Entries places;
                for (const std::string& key : game.VisitedLocations)
                {
                    const std::string codex = game.StoryData.LocationCodex(key);
                    if (!codex.empty()) places.push_back({"locations:" + key, title(Story::Find(game.StoryData.LocationDefs, key)["name"].Str(), key) + "\n" + codex});
                }
                section("locations", "LOCATIONS · " + std::to_string(places.size()) + " of " + std::to_string(withEntry) + " visited", places, "\n\n", "None yet.");
            }
            if (const size_t withEntry = game.StoryData.CodexItems())
            {
                Entries things;
                for (const std::string& key : game.FoundItems)
                {
                    const std::string codex = game.StoryData.ItemCodex(key);
                    if (codex.empty()) continue;
                    auto held = game.Items.find(key);
                    const int count = held == game.Items.end() ? 0 : held->second;
                    const std::string slot = game.SlotOf(key);
                    const std::string carried = count < 1 ? "" : " (carried" + (count > 1 ? " ×" + std::to_string(count) : std::string()) + (slot.empty() ? std::string() : ", equipped · " + slot) + ")";
                    things.push_back({"items:" + key, title(Story::Find(game.StoryData.ItemDefs, key)["name"].Str(), key) + carried + "\n" + codex});
                }
                section("items", "ITEMS · " + std::to_string(things.size()) + " of " + std::to_string(withEntry) + " found", things, "\n\n", "None yet.");
            }
            if (const size_t withEntry = game.StoryData.CodexObjects())
            {
                Entries props;
                for (const std::string& key : game.UsedObjects)
                {
                    const std::string codex = game.StoryData.ObjectCodex(key);
                    if (codex.empty()) continue;
                    const std::string now = game.GetObjectState(key);
                    props.push_back({"objects:" + key, title(Story::Find(game.StoryData.Objects, key)["name"].Str(), key) + (now.empty() ? "" : " (" + now + ")") + "\n" + codex});
                }
                section("objects", "OBJECTS · " + std::to_string(props.size()) + " of " + std::to_string(withEntry) + " used", props, "\n\n", "None yet.");
            }
            if (!game.StoryData.Mechanics.empty())
            {
                Entries usable;
                for (const std::string& key : game.MechanicOrder)
                {
                    const Value& m = Story::Find(game.StoryData.Mechanics, key);
                    const std::string controls = m["fields"]["controls"].Str();
                    usable.push_back({"mechanics:" + key, title(m["name"].Str(), key) + (controls.empty() ? "" : "\nControls: " + controls) + "\n" + m["notes"].Str()});
                }
                section("mechanics", "MECHANICS · " + std::to_string(usable.size()) + " of " + std::to_string(game.StoryData.Mechanics.size()) + " available", usable, "\n\n", "None yet.");
            }
            if (!game.StoryData.Skills.empty())
            {
                // Each skill learned, in the order first learned: its rank (of more than one), kind and tree, and what it does.
                Entries learned;
                for (const std::string& key : game.SkillOrder)
                {
                    const int rank = game.SkillRank(key);
                    if (rank < 1 || !game.StoryData.Skills.count(key)) continue;
                    const Value& k = Story::Find(game.StoryData.Skills, key);
                    const int ranks = static_cast<int>(k["ranks"].Num(1));
                    std::string kind = k["fields"]["kind"].Str();
                    if (kind != "Ability" && kind != "Upgrade") kind = "Skill";
                    const std::string tree = k["fields"]["tree"].Str();
                    const std::string does = k["fields"]["effect"].Str();
                    learned.push_back({"skills:" + key, title(k["name"].Str(), key) + (ranks > 1 ? " (rank " + std::to_string(rank) + " of " + std::to_string(ranks) + ")" : "") + "\n" + kind + (tree.empty() ? "" : " \u00b7 " + tree) + (does.empty() ? "" : "\nWhat it does: " + does) + "\n" + k["notes"].Str()});
                }
                section("skills", "SKILLS \u00b7 " + std::to_string(learned.size()) + " of " + std::to_string(game.StoryData.Skills.size()) + " learned", learned, "\n\n", "None yet.");
            }
            if (!game.StoryData.Encounters.empty())
            {
                Entries faced;
                size_t won = 0;
                for (const std::string& key : game.MetEncounters)
                {
                    const Value& e = Story::Find(game.StoryData.Encounters, key);
                    const std::string enemies = e["fields"]["enemies"].Str();
                    const std::string weakness = e["fields"]["weakness"].Str();
                    if (game.WasWon(key)) won++;
                    faced.push_back({"encounters:" + key, title(e["name"].Str(), key) + (game.WasWon(key) ? " (won)" : "") + (enemies.empty() ? "" : "\nEnemies: " + enemies) + (weakness.empty() ? "" : "\nWeak to: " + weakness) + "\n" + e["notes"].Str()});
                }
                section("encounters", "ENCOUNTERS · " + std::to_string(faced.size()) + " met, " + std::to_string(won) + " won", faced, "\n\n", "None yet.");
            }
            if (!game.StoryData.Lore.empty())
            {
                Entries found;
                for (const std::string& key : game.KnownLore)
                {
                    const Value& entry = Story::Find(game.StoryData.Lore, key);
                    found.push_back({"lore:" + key, title(entry["name"].Str(), key) + "\n" + entry["notes"].Str()});
                }
                section("lore", "LORE · " + std::to_string(found.size()) + " of " + std::to_string(game.StoryData.Lore.size()) + " found", found, "\n\n", "Nothing found yet.");
            }
            if (!q.empty() && parts.empty())
            {
                const auto& all = Sections();
                const bool known = std::find(all.begin(), all.end(), only) != all.end() || only == "bookmarks";
                return "CODEX\n\nNothing matches \"" + Trim(query) + "\"" + (known ? " in " + Title(only) : std::string()) + ".";
            }
            if (only == "bookmarks" && parts.empty()) return "CODEX\n\nNo bookmarks yet.";
            std::string out = "CODEX";
            for (size_t i = 0; i < parts.size(); i++) out += "\n\n" + parts[i];
            return out;
        }

        /**
         * An entry's name as notes are matched by: its first line without the
         * quest bullet, a quest's goal, or states in brackets ("(won)",
         * "(carried ×2)"), ignoring case.
         */
        static std::string NameOf(std::string name)
        {
            name = Trim(name);
            if (name.rfind("• ", 0) == 0) name = name.substr(std::string("• ").size());
            const size_t dash = name.find(" — ");
            if (dash != std::string::npos) name = name.substr(0, dash);
            while (!name.empty() && name.back() == ')')
            {
                const size_t open = name.rfind(" (");
                if (open == std::string::npos || name.find('(', open + 2) != std::string::npos) break;
                name = name.substr(0, open);
            }
            return Lower(Trim(name));
        }

        /** What reading exported notes found: the notes matched, by key, and the headings that match nothing here. */
        struct ReadNotes
        {
            std::vector<std::pair<std::string, std::string>> Notes;
            std::vector<std::string> Skipped;
        };

        /**
         * Read notes exported from a codex (this one's, the studio's or another
         * engine's): each "SECTION · entry" block is matched to an entry here by
         * section and name.
         */
        ReadNotes NotesFrom(const std::string& text) const
        {
            Text();
            std::map<std::string, std::string> byName;
            for (const auto& t : Titles)
            {
                const size_t at = t.second.find(" · ");
                byName[Lower(t.second.substr(0, at)) + "|" + NameOf(t.second.substr(at + std::string(" · ").size()))] = t.first;
            }
            std::vector<std::vector<std::string>> blocks(1);
            size_t start = 0;
            while (start <= text.size())
            {
                size_t end = text.find('\n', start);
                if (end == std::string::npos) end = text.size();
                std::string line = text.substr(start, end - start);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                if (Trim(line).empty()) blocks.emplace_back();
                else blocks.back().push_back(line);
                start = end + 1;
            }
            ReadNotes read;
            for (const auto& lines : blocks)
            {
                if (lines.empty()) continue;
                const std::string& head = lines[0];
                const size_t at = head.find(" · ");
                if (at == std::string::npos || head.rfind("CODEX NOTES", 0) == 0) continue;
                std::string note;
                for (size_t i = 1; i < lines.size(); i++) note += (i > 1 ? "\n" : "") + lines[i];
                note = Trim(note);
                if (note.empty()) continue;
                auto it = byName.find(Lower(Trim(head.substr(0, at))) + "|" + NameOf(head.substr(at + std::string(" · ").size())));
                if (it != byName.end()) read.Notes.push_back({it->second, note});
                else read.Skipped.push_back(Trim(head));
            }
            return read;
        }

        /**
         * The player's notes in words, to export: each entry with a note, in the
         * codex's order, under "SECTION · the entry's first line" (the same as
         * the studio's play-through exports).
         */
        std::string NotesText() const
        {
            Text();
            std::string out = "CODEX NOTES · " + game.StoryData.Name;
            bool any = false;
            for (const std::string& key : ShownKeys)
            {
                const std::string note = game.NoteFor(key);
                if (note.empty()) continue;
                out += "\n\n" + Titles.at(key) + "\n" + note;
                any = true;
            }
            return any ? out : out + "\n\nNo notes yet.";
        }

        /** The style of the printable notes page (the same as the studio's). */
        static constexpr const char* PrintStyle = ${JSON.stringify(NOTES_PRINT_STYLE)};

        /**
         * The notes as a page to print: the story's name, then each section's
         * notes under its name, entry by entry (the same page as the studio's
         * play-through prints).
         */
        std::string NotesPage() const { return PageOf(NotesText()); }

        /** Exported notes (NotesText) as a page to print. */
        static std::string PageOf(const std::string& notesText)
        {
            auto esc = [](const std::string& s)
            {
                std::string out;
                for (char c : s) out += c == '&' ? "&amp;" : c == '<' ? "&lt;" : c == '>' ? "&gt;" : std::string(1, c);
                return out;
            };
            std::string text;
            for (size_t i = 0; i < notesText.size(); ++i)
            {
                if (notesText[i] != '\r') text += notesText[i];
                else if (i + 1 >= notesText.size() || notesText[i + 1] != '\n') text += '\n';
            }
            std::vector<std::string> blocks;
            for (size_t from = 0;;)
            {
                const size_t at = text.find("\n\n", from);
                blocks.push_back(text.substr(from, at == std::string::npos ? std::string::npos : at - from));
                if (at == std::string::npos) break;
                from = at + 2;
            }
            const std::string head = "CODEX NOTES · ";
            const std::string name = blocks[0].rfind(head, 0) == 0 ? blocks[0].substr(head.size()) : blocks[0];
            std::string body, section;
            for (size_t i = 1; i < blocks.size(); ++i)
            {
                std::vector<std::string> lines;
                for (size_t from = 0;;)
                {
                    const size_t at = blocks[i].find('\n', from);
                    lines.push_back(blocks[i].substr(from, at == std::string::npos ? std::string::npos : at - from));
                    if (at == std::string::npos) break;
                    from = at + 1;
                }
                const size_t at = lines[0].find(" · ");
                if (at == std::string::npos)
                {
                    body += "\n<p>" + esc(blocks[i]) + "</p>";
                    continue;
                }
                const std::string s = lines[0].substr(0, at);
                if (s != section)
                {
                    std::string title = s;
                    for (size_t c = 1; c < title.size(); ++c) title[c] = static_cast<char>(std::tolower(static_cast<unsigned char>(title[c])));
                    body += "\n<h2>" + esc(title) + "</h2>";
                }
                section = s;
                std::string rest;
                for (size_t j = 1; j < lines.size(); ++j) rest += (j > 1 ? "<br>" : "") + esc(lines[j]);
                body += "\n<div class=\"note\"><h3>" + esc(lines[0].substr(at + std::string(" · ").size())) + "</h3><p>" + rest + "</p></div>";
            }
            return "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>" + esc(name) + " · codex notes</title><style>" + PrintStyle + "</style></head>\n<body><h1>" + esc(name) + "</h1><p class=\"sub\">Codex notes</p>" + body + "\n</body></html>\n";
        }

        /** The longest mail link written; longer ones are cut short by some mail apps. */
        static constexpr size_t MailtoLimit = ${MAILTO_LIMIT};
        /** A mail's body when the notes are too long for its link (they go on the clipboard). */
        static constexpr const char* MailOnClipboard = ${JSON.stringify(MAIL_ON_CLIPBOARD)};

        /**
         * The notes as a mail link, for the mail app: "<story> codex notes" and
         * the notes (the same link as the studio's). The second is false when
         * they are too long for a link: then the mail says they are on the clipboard.
         */
        std::pair<std::string, bool> NotesMailto() const { return MailtoOf(NotesText()); }

        /** Percent-encoded as a mail or text link wants (UTF-8; letters, digits and - _ . ~ as they are). */
        static std::string UriEncode(const std::string& s)
        {
            static const char* hex = "0123456789ABCDEF";
            std::string out;
            for (unsigned char c : s)
            {
                if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += static_cast<char>(c);
                else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
            }
            return out;
        }

        /** The text with its line breaks as "\n" alone. */
        static std::string Lf(const std::string& in)
        {
            std::string text;
            for (size_t i = 0; i < in.size(); ++i)
            {
                if (in[i] != '\r') text += in[i];
                else if (i + 1 >= in.size() || in[i + 1] != '\n') text += '\n';
            }
            return text;
        }

        /** A link of head and body, or (second false) of head and the clipboard note when that is too long. */
        static std::pair<std::string, bool> LinkOf(const std::string& head, const std::string& body)
        {
            const std::string url = head + UriEncode(body);
            if (url.size() <= MailtoLimit) return {url, true};
            return {head + UriEncode(MailOnClipboard), false};
        }

        /** Exported notes (NotesText) as a mail link. */
        static std::pair<std::string, bool> MailtoOf(const std::string& notesText)
        {
            const std::string text = Lf(notesText);
            std::string first = text.substr(0, text.find('\n'));
            const std::string prefix = "CODEX NOTES · ";
            if (first.rfind(prefix, 0) == 0) first = first.substr(prefix.size());
            std::string crlf;
            for (char c : text) crlf += c == '\n' ? std::string("\r\n") : std::string(1, c);
            return LinkOf("mailto:?subject=" + UriEncode(first + " codex notes") + "&body=", crlf);
        }

        /**
         * The notes as a text-message link (sms:), for the messages app: the
         * notes as the message (the same link as the studio's). Too long for a
         * link, as NotesMailto.
         */
        std::pair<std::string, bool> NotesSms() const { return SmsOf(NotesText()); }

        /** Exported notes (NotesText) as a text-message link. */
        static std::pair<std::string, bool> SmsOf(const std::string& notesText) { return LinkOf("sms:?&body=", Lf(notesText)); }

        /** The entries shown, in order, by key ("lore:…"): what a cursor moves through. */
        std::vector<std::string> EntryKeys(const std::string& query = "", const std::string& only = "", const std::string& sort = "") const
        {
            Text(query, only, sort);
            return ShownKeys;
        }

        /** The text broken into lines of at most width characters, for a screen that draws line by line. */
        static std::vector<std::string> Wrap(const std::string& text, size_t width)
        {
            std::vector<std::string> lines;
            size_t start = 0;
            while (start <= text.size())
            {
                size_t end = text.find('\n', start);
                if (end == std::string::npos) end = text.size();
                std::string para = text.substr(start, end - start);
                while (para.size() > width)
                {
                    size_t cut = para.rfind(' ', width);
                    if (cut == std::string::npos || cut == 0) cut = width;
                    lines.push_back(para.substr(0, cut));
                    para = para.substr(cut == width ? cut : cut + 1);
                }
                lines.push_back(para);
                start = end + 1;
            }
            return lines;
        }

    private:
        const GameState& game;
        int seen;
        mutable std::vector<std::string> ShownKeys;
        mutable std::map<std::string, std::string> Titles;

        int Progress() const
        {
            int n = static_cast<int>(game.KnownLore.size() + game.MechanicOrder.size() + game.MetEncounters.size() + game.Won.size());
            for (const std::string& k : game.SkillOrder) if (game.StoryData.Skills.count(k)) n += game.SkillRank(k);
            for (const std::string& c : game.MetCharacters) if (!game.StoryData.CharacterCodex(c).empty()) n++;
            for (const std::string& i : game.FoundItems) if (!game.StoryData.ItemCodex(i).empty()) n++;
            for (const std::string& l : game.VisitedLocations) if (!game.StoryData.LocationCodex(l).empty()) n++;
            for (const std::string& o : game.UsedObjects) if (!game.StoryData.ObjectCodex(o).empty()) n++;
            for (const auto& q : game.Quests) n += q.second == "done" ? 2 : 1;
            return n;
        }

        static std::string Upper(std::string s)
        {
            for (char& c : s) if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
            return s;
        }
        static std::string Lower(std::string s)
        {
            for (char& c : s) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
            return s;
        }
        static std::string Trim(const std::string& s)
        {
            const size_t start = s.find_first_not_of(" \t\n");
            return start == std::string::npos ? std::string() : s.substr(start, s.find_last_not_of(" \t\n") - start + 1);
        }
    };

    // ------------------------------------------------------------ objects

    namespace Interactions
    {
        inline bool Allowed(const Value& i, const std::string& obj, const GameState& game)
        {
            const std::string when = i["when"].Str();
            if (!when.empty() && when != game.GetObjectState(obj)) return false;
            return Rules::Check(i["requires"], game);
        }

        inline std::vector<std::string> AvailableVerbs(const GameState& game, const std::string& obj)
        {
            std::vector<std::string> verbs;
            for (const auto& i : Story::Find(game.StoryData.Objects, obj)["interactions"].items)
                if (Allowed(i, obj, game)) verbs.push_back(i["verb"].Str());
            return verbs;
        }

        /** Do what an interaction does. */
        inline void Use(GameState& game, const std::string& obj, const Value& i)
        {
            game.UseObject(obj);
            if (!i["becomes"].Str().empty()) game.SetObjectState(obj, i["becomes"].Str());
            if (i["sets"].IsObject()) game.SetFlag(i["sets"]["flag"].Str(), i["sets"]["value"].Str());
            if (!i["fires"].Str().empty()) Rules::Fire(i["fires"].Str(), game);
            Rules::Apply(i["effects"], game);
        }

        inline bool Interact(GameState& game, const std::string& obj, const std::string& verb)
        {
            for (const auto& i : Story::Find(game.StoryData.Objects, obj)["interactions"].items)
            {
                if (i["verb"].Str() != verb || !Allowed(i, obj, game)) continue;
                // It opens the screen puzzle: what it does waits for AnswerScreen.
                if (i["screen"].Bool())
                {
                    if (game.OnScreenRequested) game.OnScreenRequested(obj, verb);
                    return true;
                }
                Use(game, obj, i);
                return true;
            }
            return false;
        }

        /** An object's screen puzzle (null when it has none). */
        inline const Value& ScreenOf(const GameState& game, const std::string& obj) { return Story::Find(game.StoryData.Objects, obj)["screen"]; }

        /** Out of tries: it won't take another answer. */
        inline bool ScreenLocked(const GameState& game, const std::string& obj)
        {
            const int tries = static_cast<int>(ScreenOf(game, obj)["attempts"].Num());
            const auto f = game.ScreenFails.find(obj);
            return tries > 0 && f != game.ScreenFails.end() && f->second >= tries;
        }

        /**
         * Answer an object's screen puzzle (see PuzzleRuntime::CheckScreen for
         * what an answer is). Right: the interaction it opens on does what it
         * does. Wrong: a wrong move for the puzzle's staged hints, and its
         * wrong-answer effects. Returns whether it was right.
         */
        inline bool AnswerScreen(GameState& game, const std::string& obj, const Value& answer)
        {
            const Value& screen = ScreenOf(game, obj);
            if (!screen.IsObject() || ScreenLocked(game, obj)) return false;
            if (PuzzleRuntime::CheckScreen(screen, answer))
            {
                for (const auto& i : Story::Find(game.StoryData.Objects, obj)["interactions"].items)
                    if (i["screen"].Bool())
                    {
                        Use(game, obj, i);
                        break;
                    }
                if (game.OnScreenAnswered) game.OnScreenAnswered(obj, true);
                return true;
            }
            game.ScreenFails[obj] += 1;
            Rules::Apply(screen["onWrong"], game);
            if (game.OnScreenAnswered) game.OnScreenAnswered(obj, false);
            game.Touch();
            return false;
        }
    }

    // ------------------------------------------------------------ a scene

    /**
     * Plays one scene's timeline in order and says what each event needs; the
     * game answers and calls Advance() or Choose() when it is done.
     */
    class ScenePlayer
    {
    public:
        struct Option
        {
            std::string Label;
            bool Available = true;
            std::string Why;
        };

        std::function<void(const Value&)> OnEvent;
        std::function<void(const std::string&)> OnDialogue;
        /**
         * Dual dialogue: two lines spoken at the same time, as one beat. Start both
         * voices together, then call Advance() once. The left-hand speech of the
         * script comes first. A pair asks for this instead of OnDialogue.
         */
        std::function<void(const std::string&, const std::string&)> OnDual;
        std::function<void(const std::string&)> OnCinematic;
        std::function<void(const std::string&)> OnFreePlay;
        std::function<void(const std::string&, const std::vector<std::string>&)> OnChoice;
        /** An encounter: play it (a fight, a chase), then call Win() or Lose(); the bool says whether a win counts now. */
        std::function<void(const std::string&, bool)> OnEncounter;
        /** An encounter was lost, and that loss ends the game. */
        std::function<void(const std::string&)> OnGameOver;
        std::function<void(const std::string&)> OnFinished;

        /** Every option in the list now, for a UI that greys the ones that can't be picked. */
        std::vector<Option> OptionsDetail;

        ScenePlayer(GameState& state, std::string sceneKey)
            : game(state), key(std::move(sceneKey)), scene(Story::Find(state.StoryData.Scenes, key)), track(&scene["main"]) {}
        ~ScenePlayer() { if (subscription) game.Unsubscribe(subscription); }
        ScenePlayer(const ScenePlayer&) = delete;
        ScenePlayer& operator=(const ScenePlayer&) = delete;

        const std::string& SceneKey() const { return key; }
        bool Exists() const { return scene.IsObject(); }

        void Start()
        {
            // What a save keeps: the game as this scene begins.
            game.Checkpoint(key);
            game.Loaded = false;
            game.Visit(key);
            game.VisitLocation(scene["location"].Str());
            track = &scene["main"];
            index = -1;
            branch = -1;
            Advance();
        }

        /** Call when the current event is done. */
        void Advance()
        {
            waiting = nullptr;
            index++;
            if (index >= static_cast<int>(track->items.size()))
            {
                if (branch >= 0)
                {
                    const Value& rejoin = scene["branches"][static_cast<size_t>(branch)]["rejoin"];
                    branch = -1;
                    track = &scene["main"];
                    if (rejoin.IsNumber())
                    {
                        index = static_cast<int>(rejoin.number) - 1;
                        Advance();
                        return;
                    }
                }
                if (OnFinished) OnFinished(NextNode());
                return;
            }
            const Value& ev = (*track)[static_cast<size_t>(index)];
            if (!Rules::Check(ev["when"], game)) { Advance(); return; }
            // Dual dialogue: this line and the next event's are spoken at once.
            if (const Value* other = DualAt(index))
            {
                index++;
                const std::string line = ev["line"].Str();
                const std::string otherLine = (*other)["line"].Str();
                const std::string first = ev["dual"].Str() == otherLine ? otherLine : line;
                const std::string second = first == line ? otherLine : line;
                if (OnEvent) OnEvent(ev);
                Rules::Apply(ev["effects"], game);
                Rules::Apply((*other)["effects"], game);
                game.MeetCharacter(game.StoryData.Speaker(first));
                game.MeetCharacter(game.StoryData.Speaker(second));
                if (OnDual) OnDual(first, second);
                return;
            }
            if (OnEvent) OnEvent(ev);
            const std::string kind = ev["kind"].Str();
            if (kind != "choice") Rules::Apply(ev["effects"], game);
            if (kind == "dialogue") { game.MeetCharacter(game.StoryData.Speaker(ev["line"].Str())); if (OnDialogue) OnDialogue(ev["line"].Str()); }
            else if (kind == "cinematic") { if (OnCinematic) OnCinematic(ev["ref"].Str()); }
            else if (kind == "freePlay")
            {
                if (OnFreePlay) OnFreePlay(ev["endsWhen"].Str());
                if (ev.Has("ends")) AwaitEnd(ev["ends"]);
            }
            else if (kind == "choice") { std::vector<std::string> options = OptionsAt(index); if (OnChoice) OnChoice(ev["ref"].Str(), options); }
            else if (kind == "encounter") { if (!ev["ref"].Str().empty()) game.MeetEncounter(ev["ref"].Str()); if (OnEncounter) OnEncounter(ev["ref"].Str(), Rules::CanWin(ev["ref"].Str(), game)); }
            else if (kind == "trigger")
            {
                // A trigger on the timeline fires as it is reached, and the scene moves on.
                if (!ev["ref"].Str().empty()) Rules::Fire(ev["ref"].Str(), game);
                Advance();
            }
        }

        /** The event after this one, when the two are a dual pair (either way round) and it may be spoken now. */
        const Value* DualAt(int at)
        {
            if (at + 1 >= static_cast<int>(track->items.size())) return nullptr;
            const Value& a = (*track)[static_cast<size_t>(at)];
            const Value& b = (*track)[static_cast<size_t>(at + 1)];
            if (a["kind"].Str() != "dialogue" || b["kind"].Str() != "dialogue") return nullptr;
            const bool paired = (!b["dual"].Str().empty() && b["dual"].Str() == a["line"].Str()) || (!a["dual"].Str().empty() && a["dual"].Str() == b["line"].Str());
            return paired && Rules::Check(b["when"], game) ? &b : nullptr;
        }

        /** Call with the option the player picked, as offered: 0 is the first. */
        void Choose(int option)
        {
            const Value& ev = (*track)[static_cast<size_t>(index)];
            int picked = option >= 0 && option < static_cast<int>(offered.size()) ? offered[static_cast<size_t>(option)] : -1;
            const std::string choice = ev["ref"].Str();
            if (picked < 0)
            {
                game.MarkPicked(MainKey(index));
                if (!choice.empty()) game.RememberChoice(choice, ev["mainLabel"].Str());
                Rules::Apply(ev["effects"], game);
                Advance();
                return;
            }
            const Value& b = scene["branches"][static_cast<size_t>(picked)];
            game.MarkPicked(BranchKey(picked));
            if (!choice.empty()) game.RememberChoice(choice, b["label"].Str());
            Rules::Apply(b["effects"], game);
            branch = picked;
            track = &b["events"];
            index = -1;
            Advance();
        }

        /** The player won the encounter on now. False (and nothing happens) when a win doesn't count yet. */
        bool Win()
        {
            const std::string encounter = EncounterNow();
            if (encounter.empty() || !Rules::CanWin(encounter, game)) return false;
            Rules::Win(encounter, game);
            Advance();
            return true;
        }

        /** The player lost the encounter on now: its loss effects, then it plays again, the game is over, or the scene goes on. */
        void Lose()
        {
            const std::string encounter = EncounterNow();
            if (encounter.empty()) return;
            const std::string loss = Rules::Lose(encounter, game);
            if (loss == "gameOver") { if (OnGameOver) OnGameOver(encounter); }
            else if (loss == "carryOn") Advance();
            else if (OnEncounter) OnEncounter(encounter, Rules::CanWin(encounter, game));
        }

        /** Where the story goes after this scene: the first exit whose conditions hold, else onward. */
        std::string NextNode()
        {
            for (const auto& exit : scene["exits"].items)
            {
                if (!Rules::Check(exit["when"], game)) continue;
                Rules::Apply(exit["effects"], game);
                return exit["to"].Str();
            }
            return scene["onward"].Str();
        }

    private:
        GameState& game;
        std::string key;
        const Value& scene;
        const Value* track;
        int index = -1;
        int branch = -1;
        std::vector<int> offered;
        const Value* waiting = nullptr;
        int subscription = 0;

        std::string EncounterNow() const
        {
            if (index < 0 || index >= static_cast<int>(track->items.size())) return "";
            const Value& ev = (*track)[static_cast<size_t>(index)];
            return ev["kind"].Str() == "encounter" ? ev["ref"].Str() : "";
        }

        std::string MainKey(int at) const { return key + ":" + std::to_string(at); }
        std::string BranchKey(int b) const { return key + ":b" + std::to_string(b); }

        std::vector<std::string> OptionsAt(int at)
        {
            const Value& ev = scene["main"][static_cast<size_t>(at)];
            std::vector<std::string> options;
            offered.clear();
            OptionsDetail.clear();
            Value main;
            main.type = Value::Type::Object;
            Value after;
            after.type = Value::Type::String;
            after.text = ev["mainAfter"].Str();
            main.fields.emplace_back("after", after);
            Rules::Offered m = Rules::Offer(main, MainKey(at), game);
            if (m.Listed)
            {
                OptionsDetail.push_back({ev["mainLabel"].Str(), m.Available, m.Why});
                if (m.Available) { options.push_back(ev["mainLabel"].Str()); offered.push_back(-1); }
            }
            const Value& all = scene["branches"];
            for (size_t i = 0; i < all.items.size(); i++)
            {
                const Value& b = all.items[i];
                if (static_cast<int>(b["from"].Num(-1)) != at) continue;
                Rules::Offered o = Rules::Offer(b, BranchKey(static_cast<int>(i)), game);
                if (!o.Listed) continue;
                OptionsDetail.push_back({b["label"].Str(), o.Available, o.Why});
                if (o.Available) { options.push_back(b["label"].Str()); offered.push_back(static_cast<int>(i)); }
            }
            return options;
        }

        void AwaitEnd(const Value& rule)
        {
            if (Rules::Check(rule, game)) { Advance(); return; }
            waiting = &rule;
            if (subscription) return;
            subscription = game.Subscribe([this]() {
                if (waiting && Rules::Check(*waiting, game)) Advance();
            });
        }
    };

    // ------------------------------------------------------------ the graph

    /** Following the story graph between scenes: routes, choices on the graph, endings. */
    namespace StoryWalker
    {
        /** Where a node goes: its first route whose conditions hold, else on along the spine. */
        inline std::string Onward(GameState& game, const std::string& node)
        {
            const Value& n = Story::Find(game.StoryData.Graph, node);
            for (const auto& route : n["routes"].items)
            {
                if (!Rules::Check(route["when"], game)) continue;
                Rules::Apply(route["effects"], game);
                return route["to"].Str();
            }
            return n["onward"].Str();
        }

        inline std::string KindOf(const GameState& game, const std::string& node) { return Story::Find(game.StoryData.Graph, node)["kind"].Str(); }
        inline std::string OutcomeOf(const GameState& game, const std::string& node) { return Story::Find(game.StoryData.Graph, node)["outcome"].Str(); }
        inline bool ChoiceAvailable(const GameState& game, const std::string& choice) { return Rules::Check(Story::Find(game.StoryData.Choices, choice)["available"], game); }

        /** The options of a choice on the graph that can be picked now, as indexes into its options. */
        inline std::vector<int> Offered(const GameState& game, const std::string& choice)
        {
            std::vector<int> list;
            const Value& options = Story::Find(game.StoryData.Choices, choice)["options"];
            for (size_t i = 0; i < options.items.size(); i++)
            {
                Rules::Offered o = Rules::Offer(options.items[i], choice + ":" + options.items[i]["key"].Str(), game);
                if (o.Listed && o.Available) list.push_back(static_cast<int>(i));
            }
            return list;
        }

        inline std::string OptionLabel(const GameState& game, const std::string& choice, int option)
        {
            return Story::Find(game.StoryData.Choices, choice)["options"][static_cast<size_t>(option)]["label"].Str();
        }

        /** Pick an option: records it, does what it does, and returns where it leads ("" if it can't be picked). */
        inline std::string Choose(GameState& game, const std::string& choice, int option)
        {
            bool ok = false;
            for (int i : Offered(game, choice)) ok = ok || i == option;
            if (!ok) return "";
            const Value& o = Story::Find(game.StoryData.Choices, choice)["options"][static_cast<size_t>(option)];
            game.RememberChoice(choice, o["label"].Str());
            game.MarkPicked(choice + ":" + o["key"].Str());
            Rules::Apply(o["effects"], game);
            return o["to"].Str();
        }

        struct Line
        {
            std::string Speaker;
            std::string Text;
            std::string Direction;
        };

        /** The words of a line and who says them. */
        inline Line GetLine(const GameState& game, const std::string& lineId)
        {
            const Value& l = Story::Find(game.StoryData.Lines, lineId);
            return {Story::Find(game.StoryData.Characters, l["speaker"].Str())["name"].Str(), l["text"].Str(), l["direction"].Str()};
        }
    }
}
`;
