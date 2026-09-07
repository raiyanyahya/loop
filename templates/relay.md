---
# Two agents take turns: one builds, the next reviews and fixes. Repeat until both agree it is done.
name: {{name}}
agent: [claude, codex]
until: [done, "{{test}}"]
critic: codex
protect: ["{{protect}}"]
max: 30
---

# Goal

{{goal}}

# Roles

The loop alternates agents. Check the "Agent" line in the status block to know which one you are.

- **claude** builds: implement the next slice of the goal, with tests.
- **codex** reviews: read the previous iteration's changes critically (`git diff`), fix real problems, tighten tests, and note remaining gaps in the letter. Do not add new features.

Either agent may declare <loop:done/> when the goal is complete and the tests pass. The loop will verify.
