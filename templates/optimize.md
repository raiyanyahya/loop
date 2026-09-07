---
# An optimisation loop, autoresearch style: one experiment per iteration, measured, kept only if it wins.
name: {{name}}
agent: {{agent}}
until: never
metric: "{{metric}}"
direction: {{direction}}
keep: improve
max: 50
max_time: 6h
stall: 5
protect: ["{{protect}}"]
git: true
---

# Goal

{{goal}}

# The experiment loop

- The loop measures `{{metric}}` after every iteration and keeps your change only if the number {{better}}.
- One idea per iteration. Small, reversible, measurable. Write the hypothesis in your letter so a reverted attempt still teaches the next iteration.
- Protected files hold the benchmark and the correctness checks. Never edit them; if the benchmark is wrong, say so with <loop:stuck>.
- Keep correctness: a faster wrong answer is a regression. Run the tests before you hand off.
