# Changelog

## 0.2.3

Fixes from a full code review, each covered by a test.

- The agent can no longer weaken its own verifier: edits to the Loopfile's frontmatter (until, protect, critic, hooks, limits) made during an iteration are restored and the iteration is rejected. Humans can still edit the configuration between iterations.
- Running in a subdirectory of a repository works: git reports paths relative to the repository root, so protected files were never matched there and reverts were never scoped. Snapshots, protect, restore, and revert are now all scoped to the loop's directory; uncommitted work elsewhere in the repository is never touched.
- A failed git commit ends a keep/revert loop as `failed` instead of pretending the iteration was kept; a failed baseline commit is recorded truthfully too.
- An agent that exits while a background process still holds its output pipes no longer hangs the loop; kills reach the whole process group even after the agent exited.
- Agent-supplied `<loop:sleep>` text that is not a duration is ignored instead of crashing the run, and any unexpected error still writes the final state, the journal's `end` event, hooks, and the webhook.
- `loop demo --dir` refuses a non-empty directory instead of overwriting files and committing them.
- Agents that take the prompt as a command-line argument get a pointer to the prompt file when it would exceed the argument size limit; spawn failures are reported with the reason.
- `--no-prompt` now works. `loop letter` follows `letter:`, `cwd:`, and worktrees. Negative numbers such as `--target -5` parse as values. Worktree runs create the Loopfile's parent directory. Ctrl-C while a question is open stops the loop cleanly.
- All git invocations run without a shell, so quoting is identical on every platform. Two remaining shell-interpolated commands in the CLI were converted as well.
- Removed `docs/loop-engineering.md`; the reasoning lives in the README's Engineering notes.

## 0.2.2

- First release published through npm trusted publishing (OIDC from GitHub Actions, no token). No code changes since 0.2.1.

## 0.2.1

- Package published as `@raiyanyahya/loop` (the command is still `loop`). `loop` is taken, `loop-cli` was unpublished by another account in 2022 and npm never reuses such names, and `theloop` is rejected as too similar to `the-loop`; the scoped name matches the GitHub repository.
- Tests run on Node 18 and 20 again: `npm test` now uses `scripts/test.js`, which lists the test files itself instead of relying on glob support that only Node 21+ has.
- CI and the website deploy also trigger on `master`. Releases use npm trusted publishing instead of a token.

## 0.2.0

The verifier release, built from a research pass on long-running agents.

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
- Renamed from theloop to loop: command `loop`, folder `.loop/`, env `LOOP_*`, package `theloop`.
- A GitHub Action, a Claude Code skill, an animated README demo, and the phosphor website.
- Fixed before release, found by independent testing: protected files with non-ASCII names were not matched (git path quoting); a hung check command was not killed at `check_timeout` because only its shell died; commit summaries no longer use a letter's heading. Commit messages and file names produced by the agent were passed through a shell, so backticks in a letter broke commits and could have executed text; git now runs without a shell wherever agent-controlled strings are involved. Verified end to end with a real Claude worker and critic.

## 0.1.0

- Loopfile (`LOOP.md`), the letter, `until` verification with rejected done claims, the loop protocol, relay agents, rituals, guards, journal, HTML report, `demo`, and adapters for claude, codex, gemini, aider, opencode, copilot, amp, goose, cursor, and custom commands.
