/**
 * The portable heart of the VCGS Runtime for Unreal: one C++17 header, the
 * standard library only, no exceptions and no RTTI (as Unreal builds). It
 * reads story.json and plays it the way the Godot and Unity runtimes do, so
 * it can be compiled and run outside Unreal, and is.
 */
export const VCGS_CORE_H = String.raw`// VCGS Runtime for Unreal: the story's logic in portable C++17.
// The same for every project; safe to commit. No exceptions, no RTTI.
#pragma once

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
            Index("cinematics", Cinematics);
            Index("quests", Quests);
            Index("encounters", Encounters);
            for (const auto& l : Root["lines"].items) Lines[l["id"].Str()] = &l;
        }
        Story(const Story&) = delete;
        Story& operator=(const Story&) = delete;

        static const Value& Find(const std::map<std::string, const Value*>& in, const std::string& key)
        {
            auto it = in.find(key);
            return it == in.end() ? Value::None() : *it->second;
        }

        const Value Root;
        std::string Name;
        std::string Start;
        std::map<std::string, const Value*> Graph, Scenes, Choices, Objects, Triggers, Flags, Characters, Cinematics, Lines, Quests, Encounters;

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
    }

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
        /** Encounters won. */
        std::set<std::string> Won;
        bool AutoRules = true;
        std::function<void(const std::string&)> OnTriggerFired;
        std::function<void(const std::string&)> OnQuestStarted;
        std::function<void(const std::string&)> OnQuestCompleted;

        void Reset()
        {
            Flags.clear(); ObjectStates.clear(); Chosen.clear(); Items.clear(); Arcs.clear();
            Solved.clear(); Visited.clear(); Fired.clear(); Picked.clear(); Quests.clear(); Won.clear();
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
        void GiveItem(const std::string& item, int count = 1) { Items[item] += count; Changed(); }
        void TakeItem(const std::string& item, int count = 1)
        {
            int& n = Items[item];
            n = n - count < 0 ? 0 : n - count;
            Changed();
        }

        int Arc(const std::string& character) const { auto it = Arcs.find(character); return it == Arcs.end() ? 0 : it->second; }
        void AddArc(const std::string& character, int amount) { Arcs[character] += amount; Changed(); }
        void RememberChoice(const std::string& choice, const std::string& option) { Chosen[choice] = option; Changed(); }
        void MarkSolved(const std::string& puzzle) { if (Solved.insert(puzzle).second) Changed(); }
        void Visit(const std::string& scene) { if (Visited.insert(scene).second) Changed(); }
        void MarkPicked(const std::string& option) { Picked.insert(option); }
        bool WasPicked(const std::string& option) const { return Picked.count(option) > 0; }

        /** "" (not started), "active" or "done". */
        std::string QuestState(const std::string& quest) const { auto it = Quests.find(quest); return it == Quests.end() ? "" : it->second; }
        void SetQuest(const std::string& quest, const std::string& state)
        {
            if (QuestState(quest) == state) return;
            Quests[quest] = state;
            if (state == "active" && OnQuestStarted) OnQuestStarted(quest);
            else if (state == "done" && OnQuestCompleted) OnQuestCompleted(quest);
            Changed();
        }

        bool WasWon(const std::string& encounter) const { return Won.count(encounter) > 0; }
        void MarkWon(const std::string& encounter) { if (Won.insert(encounter).second) Changed(); }

    private:
        std::vector<std::pair<int, std::function<void()>>> listeners;
        int lastId = 0;
        bool settling = false;

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
            Apply(Story::Find(game.StoryData.Objects, puzzle)["effects"], game);
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
                for (const auto& q : game.StoryData.Quests)
                {
                    const Value& quest = *q.second;
                    const std::string state = game.QuestState(q.first);
                    if (state.empty() && Check(quest["starts"], game))
                    {
                        game.SetQuest(q.first, "active");
                        moved = true;
                    }
                    else if (state == "active" && quest.Has("completes") && Check(quest["completes"], game))
                    {
                        game.SetQuest(q.first, "done");
                        Apply(quest["reward"], game);
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
                    if (puzzle["kind"].Str() != "puzzle" || !puzzle.Has("solvedWhen") || game.Solved.count(p.first) || !Check(puzzle["solvedWhen"], game)) continue;
                    Solve(p.first, game);
                    moved = true;
                }
                if (!moved) return;
            }
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

        inline bool Interact(GameState& game, const std::string& obj, const std::string& verb)
        {
            for (const auto& i : Story::Find(game.StoryData.Objects, obj)["interactions"].items)
            {
                if (i["verb"].Str() != verb || !Allowed(i, obj, game)) continue;
                if (!i["becomes"].Str().empty()) game.SetObjectState(obj, i["becomes"].Str());
                if (i["sets"].IsObject()) game.SetFlag(i["sets"]["flag"].Str(), i["sets"]["value"].Str());
                if (!i["fires"].Str().empty()) Rules::Fire(i["fires"].Str(), game);
                Rules::Apply(i["effects"], game);
                return true;
            }
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
            game.Visit(key);
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
                if (OnDual) OnDual(first, second);
                return;
            }
            if (OnEvent) OnEvent(ev);
            const std::string kind = ev["kind"].Str();
            if (kind != "choice") Rules::Apply(ev["effects"], game);
            if (kind == "dialogue") { if (OnDialogue) OnDialogue(ev["line"].Str()); }
            else if (kind == "cinematic") { if (OnCinematic) OnCinematic(ev["ref"].Str()); }
            else if (kind == "freePlay")
            {
                if (OnFreePlay) OnFreePlay(ev["endsWhen"].Str());
                if (ev.Has("ends")) AwaitEnd(ev["ends"]);
            }
            else if (kind == "choice") { std::vector<std::string> options = OptionsAt(index); if (OnChoice) OnChoice(ev["ref"].Str(), options); }
            else if (kind == "encounter") { if (OnEncounter) OnEncounter(ev["ref"].Str(), Rules::CanWin(ev["ref"].Str(), game)); }
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
