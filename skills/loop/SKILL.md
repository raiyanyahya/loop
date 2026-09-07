---
name: loop
description: Use when the user wants to run an agent in a loop, set up an overnight or autonomous run, write a LOOP.md Loopfile, or asks about loop, loop engineering, metric/optimisation loops, or the loop protocol.
---

# loop

`loop` runs an agent CLI (claude, codex, gemini, aider, ...) repeatedly from one markdown file until a verifier says the work is done. Install with `npm i -g loop-cli`. Check `loop doctor` first.

## Writing a Loopfile

`LOOP.md` = YAML frontmatter (the loop) + markdown body (the goal). Keys, by the five parts of a loop:

- goal: the body; `- [ ]` checkboxes become the checklist; `context: [SPEC.md]` inlines files.
- worker: `agent: claude` or `agent: [claude, codex]` (relay); `model:`; `command:` for any CLI; `sandbox: "docker run ... {cmd}"`; `permissions: bypass|edits|default`.
- verifier: `until: [done, "npm test"]` (all must hold; `checklist`, `never`); `metric: "cmd"` + `direction: min|max` + `keep: improve|no-regress|always` + `target:`; `protect: ["test/**"]`; `critic: codex | same | {agent, when: done|N}`.
- memory: the letter (`.loop/letter.md`, automatic); `memory: NOTES.md` for durable notes.
- brakes: `max`, `max_time`, `max_cost`, `timeout`, `stall`, `repeat`.
- rhythm: `rituals: [{at: 1, prompt}, {every: 5, prompt}, {at: last, prompt}]`, `sleep`, `git: true` or `git: {commit, branch, worktree}`, `notify: <webhook>`.

Pick the kind first: finish (until done + tests), optimize (metric, keep: improve, until: never), maintain (until: never, rituals, max_time), research (checklist + critic). `loop init --kind <kind> --yes` writes a starting file; `loop init plan-build` gives the full harness.

## Running

- `loop run` (or `loop run <name>` for `loops/<name>.md`), `loop run --dry` to see the prompt and command without spending.
- Watch from another terminal: `loop status`, `loop log`, `loop stop`, `loop answer "..."` when the loop is waiting on a question.
- Exit codes: 0 done, 1 stopped/failed, 2 stuck, 3 waiting.

## When you are the agent inside a loop

If the prompt says you are an iteration of a `loop` run: read the letter and history first, do one thing, run the checks, never touch protected files or reword the checklist, write `.loop/letter.md` before finishing, and end with `<loop:done/>` only when every condition in "The loop finishes when" holds. Use `<loop:stuck>why</loop:stuck>` or `<loop:ask>question</loop:ask>` instead of guessing.
