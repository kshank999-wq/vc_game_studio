/**
 * The puzzle runtime for Unreal's portable core (VcgsCore.h), as C++17
 * (puzzle spec §6, §8, §10): the same rules as the studio's progress.ts and
 * screens.ts, and as the Godot and Unity runtimes. No exceptions or RTTI.
 */

/** How far the player is through a puzzle's steps: declared before GameState, which keeps one per puzzle. */
export const UNREAL_STEP_PROGRESS = String.raw`
    /**
     * How far the player is through a puzzle's steps (puzzle spec §6): Done (step
     * -> order done), Failed, Begun (timed sub-goal -> clock when its first step
     * was done), Seq, Fails (wrong moves), Wrong (whether each step's wrong move
     * holds now), Stale (steps undone while their condition held: done again only
     * once it stops holding and holds anew). Saved as the same JSON in every engine.
     */
    struct StepProgress
    {
        std::map<std::string, int> Done, Failed;
        std::map<std::string, double> Begun;
        std::map<std::string, bool> Wrong;
        std::set<std::string> Stale;
        int Seq = 0;
        int Fails = 0;
    };
`;

/** The puzzle runtime itself: after GameState (it reads the game), before Rules (Settle calls it). */
export const UNREAL_PUZZLES = String.raw`
    // ------------------------------------------------------------ puzzles

    /**
     * Puzzle steps, hints and screen puzzles as VC Game Studio plays them
     * (puzzle spec §6, §8, §10). Rules::Settle calls Advance for each puzzle
     * whose design keeps progress.
     */
    namespace PuzzleRuntime
    {
        struct StepEvent
        {
            std::string Step, Label, What;
        };

        struct Advanced
        {
            StepProgress Progress;
            std::vector<StepEvent> Events;
            /** What the steps done and the wrong moves made just now do (an array of effects). */
            Value Effects;
            bool Solved = false;
            bool Changed = false;
        };

        /** A step's parent ("" for the puzzle's own goal). */
        inline std::string ParentOf(const Value& s) { return s["parent"].type == Value::Type::String ? s["parent"].text : std::string(); }

        inline const Value* FindStep(const Value& steps, const std::string& id)
        {
            if (id.empty()) return nullptr;
            for (const auto& s : steps.items)
                if (s["id"].Str() == id) return &s;
            return nullptr;
        }

        inline std::vector<const Value*> Kids(const Value& steps, const std::string& parent, bool requiredOnly)
        {
            std::vector<const Value*> out;
            for (const auto& s : steps.items)
                if (ParentOf(s) == parent && !(requiredOnly && s["optional"].Bool())) out.push_back(&s);
            return out;
        }

        inline void Descendants(const Value& steps, const std::string& id, std::vector<const Value*>& out)
        {
            for (const Value* c : Kids(steps, id, false))
            {
                out.push_back(c);
                Descendants(steps, (*c)["id"].Str(), out);
            }
        }

        /** Whether a step may be done yet: what it needs first is done, the step before it in a sequence is, and the sub-goal it is under is open. */
        inline bool Unlocked(const Value& steps, const Value& step, const std::map<std::string, int>& done)
        {
            for (const auto& r : step["requires"].items)
                if (FindStep(steps, r.Str()) && !done.count(r.Str())) return false;
            const Value* parent = FindStep(steps, ParentOf(step));
            if (!parent) return true;
            if ((*parent)["gate"].Str() == "sequence" && !step["optional"].Bool())
            {
                const auto order = Kids(steps, (*parent)["id"].Str(), true);
                for (size_t i = 1; i < order.size(); ++i)
                    if ((*order[i])["id"].Str() == step["id"].Str() && !done.count((*order[i - 1])["id"].Str())) return false;
            }
            return Unlocked(steps, *parent, done);
        }

        inline void MarkDone(StepProgress& p, const Value& n, const Value& steps, double now, Advanced& r)
        {
            p.Done[n["id"].Str()] = ++p.Seq;
            r.Events.push_back({n["id"].Str(), n["label"].Str(), "done"});
            for (const auto& e : n["effects"].items) r.Effects.items.push_back(e);
            // Its first step done starts a timed sub-goal's clock.
            for (const Value* at = FindStep(steps, ParentOf(n)); at; at = FindStep(steps, ParentOf(*at)))
                if ((*at)["within"].Num() > 0 && !p.Begun.count((*at)["id"].Str())) p.Begun[(*at)["id"].Str()] = now;
        }

        /** Move a puzzle on: its progress now, what happened, what that does, and whether it is solved. */
        inline Advanced Advance(const Value& design, const StepProgress* before, const GameState& game, double now)
        {
            const Value& steps = design["steps"];
            Advanced r;
            r.Effects.type = Value::Type::Array;
            StepProgress p = before ? *before : StepProgress();
            auto holds = [&game](const Value& rule) { return !rule.IsNull() && Rules::Check(rule, game); };
            // Time first: a timed sub-goal that ran out loses what was done under it.
            for (const auto& g : steps.items)
            {
                const std::string gid = g["id"].Str();
                const auto start = p.Begun.find(gid);
                if (g["kind"].Str() != "goal" || g["within"].Num() <= 0 || start == p.Begun.end() || p.Done.count(gid) || now - start->second <= g["within"].Num()) continue;
                std::vector<const Value*> under;
                Descendants(steps, gid, under);
                for (const Value* d : under)
                {
                    const std::string did = (*d)["id"].Str();
                    if (p.Done.count(did) && (*d)["kind"].Str() != "goal") p.Stale.insert(did);
                    p.Done.erase(did);
                    p.Failed.erase(did);
                }
                p.Begun.erase(gid);
                r.Events.push_back({gid, g["label"].Str(), "expired"});
                r.Changed = true;
            }
            // Then as many passes as there are steps: each can open the next.
            for (size_t pass = 0; pass <= steps.items.size(); ++pass)
            {
                bool moved = false;
                for (const auto& n : steps.items)
                {
                    const std::string nid = n["id"].Str();
                    if (p.Done.count(nid)) continue;
                    if (n["kind"].Str() != "goal")
                    {
                        // A wrong move is noticed when it happens, open or not.
                        const Value& fail = n["fail"];
                        const bool wrongNow = fail.Has("when") && holds(fail["when"]);
                        const auto w = p.Wrong.find(nid);
                        const bool was = w != p.Wrong.end() && w->second;
                        if (was != wrongNow)
                        {
                            p.Wrong[nid] = wrongNow;
                            r.Changed = true;
                        }
                        if (wrongNow && !was && !p.Failed.count(nid))
                        {
                            p.Failed[nid] = ++p.Seq;
                            r.Events.push_back({nid, n["label"].Str(), "failed"});
                            for (const auto& e : fail["effects"].items) r.Effects.items.push_back(e);
                            r.Changed = moved = true;
                            if (fail["forward"].Bool())
                            {
                                MarkDone(p, n, steps, now, r);
                                continue;
                            }
                            p.Fails++;
                            if (design["reset"].Str() == "onFail")
                            {
                                StepProgress fresh;
                                fresh.Seq = p.Seq;
                                fresh.Fails = p.Fails;
                                fresh.Wrong = p.Wrong;
                                for (const auto& x : steps.items)
                                    if (x["kind"].Str() != "goal" && (p.Done.count(x["id"].Str()) || x["id"].Str() == nid)) fresh.Stale.insert(x["id"].Str());
                                p = fresh;
                                r.Events.push_back({nid, n["label"].Str(), "reset"});
                                break;
                            }
                            continue;
                        }
                        if (p.Stale.count(nid))
                        {
                            // Undone while it held: it must stop holding first.
                            if (holds(n["when"])) continue;
                            p.Stale.erase(nid);
                            r.Changed = true;
                            continue;
                        }
                        if (Unlocked(steps, n, p.Done) && holds(n["when"]))
                        {
                            MarkDone(p, n, steps, now, r);
                            r.Changed = moved = true;
                        }
                        continue;
                    }
                    if (!Unlocked(steps, n, p.Done)) continue;
                    const auto kids = Kids(steps, nid, true);
                    if (kids.empty()) continue;
                    bool any = false, all = true;
                    for (const Value* c : kids)
                    {
                        if (p.Done.count((*c)["id"].Str())) any = true;
                        else all = false;
                    }
                    if (n["gate"].Str() == "any" ? any : all)
                    {
                        MarkDone(p, n, steps, now, r);
                        r.Changed = moved = true;
                    }
                }
                if (!moved) break;
            }
            const auto top = Kids(steps, "", true);
            r.Solved = !top.empty();
            for (const Value* t : top)
                if (!p.Done.count((*t)["id"].Str())) r.Solved = false;
            r.Progress = p;
            return r;
        }

        /** Staged hints due now and not given: each needs its wrong moves made and its condition holding (and at least one of them). */
        inline std::vector<const Value*> DueHints(const Value& design, int fails, const std::set<std::string>& given, const GameState& game)
        {
            std::vector<const Value*> due;
            for (const auto& h : design["hints"].items)
            {
                if (given.count(h["id"].Str()) || (!h.Has("afterFails") && !h.Has("when"))) continue;
                if (h.Has("afterFails") && fails < static_cast<int>(h["afterFails"].Num())) continue;
                if (h.Has("when") && !Rules::Check(h["when"], game)) continue;
                due.push_back(&h);
            }
            return due;
        }

        // ------------------------------------------------------------ screen puzzles

        inline int Sides(const std::string& piece)
        {
            if (piece == "end") return 1;
            if (piece == "straight") return 5;
            if (piece == "corner") return 3;
            if (piece == "tee") return 7;
            if (piece == "cross") return 15;
            return 0;
        }

        inline int Turned(int sides, int rot)
        {
            for (int i = 0; i < ((rot % 4) + 4) % 4; ++i) sides = ((sides << 1) | (sides >> 3)) & 15;
            return sides;
        }

        /** Whether a circuit's source reaches its sink with its pieces turned so (one turn a cell). */
        inline bool CircuitJoined(const Value& screen, const std::vector<int>& rot)
        {
            const int w = static_cast<int>(screen["width"].Num());
            const int h = static_cast<int>(screen["height"].Num());
            const Value& cells = screen["cells"];
            const int count = static_cast<int>(cells.items.size());
            const int src = static_cast<int>(screen["source"].Num());
            const int sink = static_cast<int>(screen["sink"].Num(count - 1));
            if (w <= 0 || count == 0) return false;
            auto at = [&](int i) { return Turned(Sides(cells[static_cast<size_t>(i)]["piece"].Str()), i < static_cast<int>(rot.size()) ? rot[static_cast<size_t>(i)] : 0); };
            std::set<int> seen{src};
            std::vector<int> queue{src};
            for (size_t q = 0; q < queue.size(); ++q)
            {
                const int here = queue[q];
                if (here == sink) return true;
                const int r = here / w, c = here % w;
                const int steps[4][3] = {{1, 4, r > 0 ? here - w : -1}, {2, 8, c < w - 1 ? here + 1 : -1}, {4, 1, r < h - 1 ? here + w : -1}, {8, 2, c > 0 ? here - 1 : -1}};
                for (const auto& s : steps)
                    if (s[2] >= 0 && s[2] < count && !seen.count(s[2]) && (at(here) & s[0]) && (at(s[2]) & s[1]))
                    {
                        seen.insert(s[2]);
                        queue.push_back(s[2]);
                    }
            }
            return false;
        }

        /** Flip a switch, and the switches it is linked to. */
        inline std::vector<bool> Flip(const Value& screen, std::vector<bool> on, int i)
        {
            std::vector<int> which{i};
            for (const auto& j : screen["links"][static_cast<size_t>(i)].items) which.push_back(static_cast<int>(j.Num(-1)));
            for (int j : which)
                if (j >= 0 && j < static_cast<int>(on.size())) on[static_cast<size_t>(j)] = !on[static_cast<size_t>(j)];
            return on;
        }

        inline std::string Folded(const std::string& s)
        {
            size_t a = 0, b = s.size();
            while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\n')) a++;
            while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\n')) b--;
            std::string out = s.substr(a, b - a);
            for (auto& ch : out)
                if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
            return out;
        }

        inline std::vector<std::string> Strs(const Value& v)
        {
            std::vector<std::string> out;
            for (const auto& x : v.items) out.push_back(x.Str());
            return out;
        }

        inline std::vector<int> Ints(const Value& v)
        {
            std::vector<int> out;
            for (const auto& x : v.items) out.push_back(static_cast<int>(x.Num()));
            return out;
        }

        /**
         * Whether an answer solves a screen. What the answer is, by kind: keypad
         * and custom, the text entered; dial, the numbers set in order; symbols,
         * the symbols pressed; ordering, the items in the order given; matching,
         * the right-hand items in the order of the left; assembly, slot id -> part
         * id; levers, each switch on or off; rings, each ring's turn; tiles, the
         * number on each square (0 the gap); circuit, each cell's turn.
         */
        inline bool CheckScreen(const Value& screen, const Value& answer)
        {
            const std::string kind = screen["kind"].Str();
            if (kind == "keypad") return !screen["code"].Str().empty() && answer.type == Value::Type::String && answer.text == screen["code"].Str();
            if (kind == "custom") return !Folded(screen["text"].Str()).empty() && answer.type == Value::Type::String && Folded(answer.text) == Folded(screen["text"].Str());
            if (kind == "dial") return !screen["combination"].items.empty() && Ints(answer) == Ints(screen["combination"]);
            if (kind == "symbols") return !screen["answer"].items.empty() && Strs(answer) == Strs(screen["answer"]);
            if (kind == "ordering") return screen["items"].items.size() > 1 && Strs(answer) == Strs(screen["items"]);
            if (kind == "matching")
            {
                std::vector<std::string> rights;
                for (const auto& p : screen["pairs"].items) rights.push_back(p["right"].Str());
                return !rights.empty() && Strs(answer) == rights;
            }
            if (kind == "assembly")
            {
                if (screen["slots"].items.empty() || !answer.IsObject()) return false;
                for (const auto& s : screen["slots"].items)
                    if (answer[s["id"].Str()].Str() != s["accepts"].Str()) return false;
                return true;
            }
            if (kind == "levers")
            {
                const Value& target = screen["target"];
                if (target.items.empty() || answer.items.size() != target.items.size()) return false;
                for (size_t i = 0; i < target.items.size(); ++i)
                    if (answer[i].Bool() != target[i].Bool()) return false;
                return true;
            }
            if (kind == "rings")
            {
                const auto turns = Ints(answer);
                const int segments = std::max(1, static_cast<int>(screen["segments"].Num(8)));
                if (turns.empty() || static_cast<int>(turns.size()) != static_cast<int>(screen["rings"].Num())) return false;
                for (int t : turns)
                    if (t % segments != 0) return false;
                return true;
            }
            if (kind == "tiles")
            {
                const int n = std::max(2, static_cast<int>(screen["size"].Num(3)));
                std::vector<int> solved;
                for (int i = 1; i < n * n; ++i) solved.push_back(i);
                solved.push_back(0);
                return Ints(answer) == solved;
            }
            if (kind == "circuit") return answer.IsArray() && CircuitJoined(screen, Ints(answer));
            return false;
        }
    }
`;
