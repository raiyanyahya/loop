# Loop engineering: what the evidence says, and where loop stands

Research date: 2026-09-07. Three research passes (practitioner discourse, vendor and lab direction, technical literature), roughly 150 searches and page fetches. Every major claim below carries its source.

## 1. Why the loop is becoming the unit of AI engineering

**The people who build the agents say so.** Boris Cherny (Claude Code): "Going from agents to loops is as big a jump as going from code to agents" and "I don't prompt Claude anymore. I have loops running that prompt Claude" ([aiweekly](https://aiweekly.co/alerts/boris-cherny-ai-loops-match-the-shift-from-code-to-agents)). OpenAI's Codex guidance: "Long-running work is less about one giant prompt and more about the agent loop the model operates inside" ([developers.openai.com](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)). Anthropic staff at Code with Claude: "infrastructure, rather than intelligence, is now the bottleneck for production agents" ([InfoQ](https://www.infoq.com/news/2026/05/code-with-claude/)). Addy Osmani's definition: "Loop engineering is replacing yourself as the person who prompts the agent" ([Osmani](https://addyo.substack.com/p/practical-loop-engineering)).

**Agents can now work for hours, and the horizon keeps doubling.** METR's 50% time horizon: Opus 4.5 at 320 minutes, doubling roughly every 89 days since 2024 ([METR](https://metr.org/blog/2026-1-29-time-horizon-1-1/)). Anthropic's own trajectory for continuous runs: about 20 minutes with Sonnet 3.5, 1 to 2 hours with Opus 4.5, about 12 hours with Opus 4.6 ([workshop summary](https://www.sean-weldon.com/blog/2026-05-23-build-agents-that-run-for-hours-without-losing-the-plot-ash-prabaker-andrew-wilson-anthropic)). GPT-5.1-Codex-Max ran over 24 hours in internal evals ([OpenAI](https://openai.com/index/gpt-5-1-codex-max/)). A single session cannot hold a day of work in context, so the work gets chunked into iterations with state handed off through files. That is a loop.

**Iteration plus a verifier beats a bigger single shot.** Karpathy's autoresearch: one file, one metric, a five-minute budget, keep or revert, "approx 100 experiments while you sleep", 700 experiments and 20 stacked wins in two days ([autoresearch](https://github.com/karpathy/autoresearch)). AlphaEvolve recovered 0.7% of Google's fleet compute and sped up Gemini kernels 23% with a generate, evaluate, select loop ([DeepMind](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)). Test-time compute research finds verifier-guided iteration more than 4x more efficient than best-of-N, and a small model with search matching one "14x larger" on medium problems ([Snell et al.](https://arxiv.org/abs/2408.03314)). Reflexion, the ancestor of the letter, took HumanEval from 80.1% to 91.0% by carrying a reflection between attempts ([Shinn et al.](https://arxiv.org/html/2303.11366)).

**Production adoption.** Over 30% of Cursor's merged PRs come from cloud agents ([Cursor](https://cursor.com/blog/agent-computer-use)). OpenAI built a roughly 1M-line codebase with zero hand-written lines in five months using a harness around Codex ([OpenAI](https://openai.com/index/harness-engineering/)). Shopify's autoresearch variant made a build 65% faster and unit tests 300x faster ([Shopify](https://shopify.engineering/autoresearch)). Every vendor shipped unattended cloud runs with cron and event triggers in the same six-month window: Claude Routines, Codex cloud and automations, Copilot coding agent, Jules, Devin.

**The cautions are real.** Ralph loops cost $50 to $100 per 50 iterations, and Uber exhausted its 2026 AI budget in four months after rolling out Claude Code ([futureagi](https://futureagi.com/blog/loop-engineering/ralph-loop/), [Fortune](https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/)). METR measured o3 reward-hacking on 100% of one optimisation task's runs ([METR](https://metr.org/blog/2025-06-05-recent-reward-hacking/)). About 30% of "plausible" SWE-bench patches behave differently from the real fix ([PatchDiff](https://arxiv.org/abs/2503.15223)). Intrinsic self-correction without external feedback makes reasoning worse, not better ([Huang et al.](https://arxiv.org/pdf/2310.01798)). AI Scientist-v2 produced a workshop-accepted paper while 42% of its experiments had failed on coding errors ([audit](https://arxiv.org/pdf/2502.14297)). The lesson across all of these: the loop is only as good as its verifier and its brakes.

## 2. What a well-engineered loop must do, ranked by evidence

1. **Verify with something executable, outside the model.** Tests, a metric, a checklist the loop can read. Never the model's own opinion of its work ([Huang et al.](https://arxiv.org/pdf/2310.01798), [CRITIC](https://arxiv.org/abs/2305.11738), [Agentless](https://arxiv.org/abs/2407.01489)). Pardel: "A loop whose exit depends on the model's self-assessment is a loop that exits early or never" ([pardel.dev](https://www.pardel.dev/2026/07/11/claude-loops.html)).
2. **Keep or revert every iteration against a fixed measure.** Autoresearch and AlphaEvolve accept a change only if the number improves; acceptance gates that "prevent regressions" are the formal version ([arXiv](https://arxiv.org/pdf/2607.00871)).
3. **Assume visible tests will be gamed.** Hold out checks, forbid editing tests, watch for hard-coded answers ([SpecBench](https://arxiv.org/html/2605.21384v1), [METR](https://metr.org/blog/2025-06-05-recent-reward-hacking/)). Anthropic's harness instruction: "It is unacceptable to remove or edit tests" ([Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).
4. **Fresh context every iteration, compact handoff through files.** Context rot is measured across 18 models ([Chroma](https://www.trychroma.com/research/context-rot)); Anthropic's recipe is a progress file, a feature list, one feature per session, a commit per session ([Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)); Pardel: "The filesystem is the memory".
5. **Separate the judge from the worker.** "Separating the agent doing the work from the agent judging it proves to be a strong lever" ([Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps)). Self-grading is lenient: 33.7% self-rated versus 14.1% independently ([arXiv](https://arxiv.org/html/2606.19544v1)). Practitioners call the missing piece "Marge" ([Puig](https://medium.com/@mpuig/ralph-wiggum-is-an-expensive-way-to-burn-tokens-he-needs-a-marge-811d81378ae4)).
6. **Bound everything.** Iterations, wall clock, money, and repeat detection: same error three times means stop ([Osmani](https://addyo.substack.com/p/practical-loop-engineering), [frankbria/ralph](https://github.com/frankbria/ralph-claude-code)).
7. **Carry scored history, not just notes.** Prior attempts with their scores in the prompt act as a gradient ([OPRO](https://arxiv.org/abs/2309.03409)); reflection on top of memory adds 8 points over memory alone ([Reflexion](https://arxiv.org/html/2303.11366)).
8. **Do one thing per iteration.** Anthropic: the incremental approach "turned out to be critical to addressing the agent's tendency to do too much at once". Huntley's rule: "Only one thing" per loop ([ghuntley.com/ralph](https://ghuntley.com/ralph/)).
9. **Keep a human inbox for the irreversible.** "Ambient does not mean fully autonomous" ([Sequoia](https://inferencebysequoia.substack.com/p/ambient-agents-and-the-new-agent)); approve, answer, edit, or stop.
10. **Log the trajectory.** Outcomes vary a lot between identical runs; keep everything and judge over several runs ([arXiv](https://arxiv.org/html/2509.09853v1)).
11. **Sandbox by default.** Every adapter bypasses permissions. The playbook's line: "It's not if it gets popped, it's when. And what is the blast radius?" ([ralph-playbook](https://claytonfarr.github.io/ralph-playbook/)).

## 3. Scorecard: `loop` 0.2

The first release (0.1) matched the three highest-evidence principles and little else. 0.2 was built against this table.

| Principle | `loop` 0.2 | How |
|---|---|---|
| Executable verification of done | Yes | `until:` commands and checklist; a false `<loop:done/>` is rejected with the failing output |
| Keep or revert against a metric | Yes | `metric:` + `keep: improve` measures after every iteration and reverts non-improvements with git; `keep: no-regress` reverts when a passing check starts failing; `target:` ends the loop |
| Assume tests are gameable | Yes | `protect:` globs are restored and the iteration rejected; reworded or deleted checklist items are restored; hidden checks remain the user's job |
| Fresh context, file handoff | Yes | The letter, the re-read Loopfile, git commits |
| Separate judge from worker | Yes | `critic:` runs an independent agent in a fresh session with the goal, diff, and letter; it can veto "done" or review every N iterations |
| Bound everything | Yes | `max`, `max_time`, `max_cost`, `timeout`, `stall`, and `repeat` (same failure fingerprint N times) |
| Scored history in the prompt | Yes | A history table of every iteration: files, checks, metric, kept/reverted/rejected |
| One thing per iteration | Prompt only | The rules say so; the metric and critic make violations expensive |
| Human inbox | Yes | `<loop:ask>`, `loop answer`, `stop`, `status`, and `notify:` webhooks |
| Trajectory logging | Yes | Journal, per-iteration prompt and output, critic prompt and output, HTML report with the metric curve |
| Sandbox by default | Opt-in | `git.worktree: true` isolates the branch; `sandbox:` wraps the agent command in a container or anything else. Not on by default |
| Survives sessions, resumable | Yes | The letter and notes persist; `loop run` continues |
| Multi-state exits | Yes | done, stuck, waiting, stalled, stopped, failed, with distinct exit codes |
| Plan before build | Yes | `rituals: [{at: 1}]` and the `plan-build` template |
| Cross-loop memory | Yes | `memory: NOTES.md` is inlined into every prompt and maintained by the agent |

Removed on the way: the `idle` stop condition (stall covers it, and "nothing changed" is not success) and the separate `templates` command (now `init --list`).

Still open: hidden hold-out checks the agent cannot see, parallel branches with best-of-N selection, a scheduled server mode, and sandboxing on by default. Each is a Loopfile key away and none changes the core.

## 4. What was built, and why each piece

1. **Metric-gated iterations** (`metric`, `direction`, `keep`, `target`): the autoresearch and AlphaEvolve pattern. Measure, keep only wins, revert the rest, record the attempt.
2. **Protected files and checklist integrity** (`protect`): the SpecBench and METR finding that visible verifiers get gamed. The verifier is not the agent's to edit.
3. **An independent critic** (`critic`): Anthropic's "separate the agent doing the work from the agent judging it", and the practitioner wish for "Marge".
4. **Repeat detection** (`repeat`): the circuit breaker practitioners kept rebuilding by hand.
5. **A scored history table**: OPRO's finding that prior attempts with scores act as a gradient.
6. **Rituals at fixed points** (`at: 1`, `at: last`): the plan/build split and Anthropic's initializer pattern.
7. **Durable notes** (`memory`): a tame version of Managed Agents' cross-session memory.
8. **Webhooks** (`notify`): the ambient-agent inbox, minimally.
9. **Isolation** (`git.worktree`, `sandbox`): the blast-radius question from the ralph playbook.
10. **A GitHub Action and a Claude Code skill**: the two places loops get triggered from, per the vendor survey.

## 5. What not to build

- **An LLM as the only verifier.** Judges are fooled by trivial "master keys" ([arXiv](https://arxiv.org/abs/2507.08794)). The critic should add a veto on top of executable checks, never replace them.
- **A grader the agent can see too well.** Once the agent optimises against a visible metric, expect hard-coded lookup tables and cached results ([SpecBench](https://arxiv.org/html/2605.21384v1), [Westland](https://cameronwestland.com/autoresearch-is-reward-function-design/)). Keep protected files, hold-out checks, and human review of anything with a suspicious jump.
- **Claims of safety.** Anthropic's own auto mode docs say it "does not guarantee safety" ([docs](https://code.claude.com/docs/en/permission-modes)). `loop` should say the same about sandboxing.
- **Elaborate harness features that fight today's model.** Anthropic removed sprints and context resets within one model generation ([Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps)). Keep every feature a Loopfile key that can be deleted.
