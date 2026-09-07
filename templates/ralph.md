---
# The classic: one spec, one agent, loop until it says done. Named after the Ralph Wiggum loop.
name: {{name}}
agent: {{agent}}
until: done
max: 50
max_time: 6h
git: true
---

# Goal

{{goal}}

Read `SPEC.md` (if it exists) for the full specification. Implement it completely.

# Rules

- Study the codebase before changing it. Follow the existing conventions.
- Pick one unfinished part of the spec per iteration, implement it end to end, and test it.
- Keep a running list of what is finished in your letter so the next iteration does not redo it.
- Do not declare done until every part of the spec is implemented and the whole test-suite passes.
