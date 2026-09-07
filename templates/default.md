---
name: {{name}}
agent: {{agent}}
until: done
max: 25
---

# Goal

{{goal}}

# What "done" means

- The goal above is fully achieved, not just started.
- Tests pass. If there are none for the changed behaviour, add them.
- Nothing that worked before is broken.

# Working agreements

- Prefer small verified steps over big rewrites. One coherent change per iteration is fine.
- Run the tests before you finish an iteration.
- If a decision needs a human (product choice, credentials, destructive action), ask with <loop:ask> instead of guessing.
