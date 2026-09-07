---
# Loops are not just for code. This one deepens a written report a little each iteration.
name: {{name}}
agent: {{agent}}
until: checklist
critic: same
max: 12
---

# Goal

Produce `REPORT.md`: a thorough, well-sourced report on the following question.

{{goal}}

# Checklist

- [ ] Outline the report in `REPORT.md` with section headings and one line per section on what it will argue
- [ ] Fill in every section with substance (facts, numbers, sources as links)
- [ ] Add a "Counterarguments" section that steelmans the opposing view
- [ ] Write an executive summary at the top (under 200 words)
- [ ] Read the whole report as a sceptical editor and fix weak claims, repetition, and gaps
