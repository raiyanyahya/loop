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
- `notify:` webhooks, `git.worktree: true`, `sandbox:` command wrapping, and `permissions: bypass | edits | default` for the claude, codex, and gemini adapters.
- `loop init` asks for a kind of loop (finish, optimize, maintain, research) and ships `optimize` and `plan-build` templates. `loop run <name>` resolves `loops/<name>.md`.
- Removed: the `idle` stop condition and the separate `templates` command (now `init --list`).
- Renamed from theloop to loop: command `loop`, folder `.loop/`, env `LOOP_*`, package `loop-cli`.
- A GitHub Action, a Claude Code skill, an animated README demo, and the phosphor website.
- Fixed before release, found by independent testing: protected files with non-ASCII names were not matched (git path quoting); a hung check command was not killed at `check_timeout` because only its shell died; commit summaries no longer use a letter's heading. Commit messages and file names produced by the agent were passed through a shell, so backticks in a letter broke commits and could have executed text; git now runs without a shell wherever agent-controlled strings are involved. Verified end to end with a real Claude worker and critic.

## 0.1.0

- Loopfile (`LOOP.md`), the letter, `until` verification with rejected done claims, the loop protocol, relay agents, rituals, guards, journal, HTML report, `demo`, and adapters for claude, codex, gemini, aider, opencode, copilot, amp, goose, cursor, and custom commands.
