---
# A living to-do list. The agent ticks boxes in this file; the loop ends when all are ticked and tests pass.
name: {{name}}
agent: {{agent}}
until: [checklist, "{{test}}"]
protect: ["{{protect}}"]
max: 40
---

# Goal

{{goal}}

# Checklist

Tick each item only when it is implemented, tested, and working. Do not add, remove, or reword items.

- [ ] Write down the plan for the work in `PLAN.md` (files to touch, order of work)
- [ ] First slice of the goal
- [ ] Second slice of the goal
- [ ] Tests cover the new behaviour
- [ ] Docs/README updated
