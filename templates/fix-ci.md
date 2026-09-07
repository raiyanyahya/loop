---
# Loop until the build is green. No "done" needed: a passing command ends the loop.
name: {{name}}
agent: {{agent}}
until: "{{test}}"
protect: ["{{protect}}"]
max: 15
stall: 2
---

# Goal

Make `{{test}}` pass.

{{goal}}

# Rules

- Fix root causes, not symptoms. Do not delete or skip tests to make them pass.
- If a failure is flaky, say so in your letter and make it deterministic.
- If the failure needs something you cannot obtain (credentials, a service), stop with <loop:stuck>.
