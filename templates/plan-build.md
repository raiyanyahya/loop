---
# The full harness: plan first, build one item per iteration, protect the tests, and let a critic judge "done".
name: {{name}}
agent: {{agent}}
until: [checklist, "{{test}}"]
critic: same
protect: ["{{protect}}"]
memory: NOTES.md
max: 40
git: true
rituals:
  - at: 1
    name: plan
    prompt: |
      Do not write code this iteration. Study the codebase and the goal, then:
      1. Write PLAN.md: the design, the files to touch, risks, and the order of work.
      2. Replace the placeholder checklist items in this Loopfile with 5 to 12 concrete, verifiable items,
         each small enough for one iteration. This is the only iteration allowed to edit the checklist.
      3. Start NOTES.md with what the next iterations need to know about this codebase.
  - every: 5
    name: review
    prompt: |
      Review everything done so far against PLAN.md and the goal, as a strict reviewer: regressions,
      dead code, weak tests, drift from the plan. Fix what you find. Do not start new items.
---

# Goal

{{goal}}

# Checklist

- [ ] (the plan ritual replaces these placeholders with concrete items)
- [ ] ...

# Working agreements

- One checklist item per iteration, implemented end to end with tests, then ticked.
- `{{test}}` must pass before you finish an iteration.
- The critic reviews the diff before "done" is accepted. Write for a reviewer: small commits, clear names, no leftovers.
