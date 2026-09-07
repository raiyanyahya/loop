---
# Test-driven loop: the loop only ends when the agent says done AND the test command passes.
name: {{name}}
agent: {{agent}}
until: [done, "{{test}}"]
protect: ["{{protect}}"]
max: 30
---

# Goal

{{goal}}

# Method

1. Write or extend a failing test that pins down the next slice of behaviour.
2. Make it pass with the simplest correct change.
3. Refactor while the suite is green.
4. Repeat until the goal is fully covered.

The loop runs `{{test}}` after every iteration and shows you the output. Red is information, not failure.
