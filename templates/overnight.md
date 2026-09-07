---
# Runs unattended for hours. No "done": every iteration makes the codebase a little better.
# Every 5th iteration is a review ritual. Each iteration is committed on its own branch.
name: {{name}}
agent: {{agent}}
until: never
max: 100
max_time: 8h
stall: 4
sleep: 20s
memory: NOTES.md
protect: ["{{protect}}"]
git:
  commit: true
  branch: loop/{{name}}
rituals:
  - every: 5
    name: review
    prompt: |
      Review everything the loop has done so far (git log, git diff against the base branch).
      Look for regressions, dead code, inconsistent naming, missing tests, and anything a
      strict reviewer would reject. Fix what you find. Do not start new features in this iteration.
---

# Goal

{{goal}}

# Each iteration

- Pick the single most valuable improvement toward the goal that fits in one iteration.
- Implement it completely, run the tests, and leave the tree green.
- Write down in your letter what you would do next, in priority order, so the next iteration starts fast.
- Never leave uncommitted breakage: the loop commits after every iteration.
