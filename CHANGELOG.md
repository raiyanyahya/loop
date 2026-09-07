# Changelog

## 0.2.0

The verifier release, built from a research pass on long-running agents (see `docs/loop-engineering.md`).

- `metric:` with `direction`, `keep: improve | no-regress | always`, and `target:`. Iterations that do not measurably win are reverted with git; a baseline commit is made first if the tree is dirty.
- `critic:` runs an independent reviewer in a fresh session before "done" is accepted, or every N iterations. `<loop:approve/>` and `<loop:reject>` join the protocol.
- `protect:` globs are restored if the agent touches them, and the iteration is rejected. Reworded, added, or deleted checklist items are restored while legitimate ticks are kept.
- `repeat:` stops the loop when the same failure output repeats N times.
- A history table of every iteration (files, checks, metric, kept or reverted, critic) in each prompt.
- `memory:` inlines a durable notes file that the agent maintains across loops.
- Rituals at fixed points: `at: 1` and `at: last`, alongside `every`.
- `notify:` webhooks, `git.worktree: true`, and `sandbox:` command wrapping.
- `loop init` asks for a kind of loop (finish, optimize, maintain, research) and ships `optimize` and `plan-build` templates. `loop run <name>` resolves `loops/<name>.md`.
- Removed: the `idle` stop condition and the separate `templates` command (now `init --list`).
- Renamed from theloop to loop: command `loop`, folder `.loop/`, env `LOOP_*`, package `loop-cli`.
- A GitHub Action, a Claude Code skill, an animated README demo, and the phosphor website.

## 0.1.0

- Loopfile (`LOOP.md`), the letter, `until` verification with rejected done claims, the loop protocol, relay agents, rituals, guards, journal, HTML report, `demo`, and adapters for claude, codex, gemini, aider, opencode, copilot, amp, goose, cursor, and custom commands.
