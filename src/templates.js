import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** The kinds of loop, and the template that embodies each. */
export const KINDS = {
  finish: { template: 'default', blurb: 'reach a goal, then stop: done when the agent says so and the checks pass' },
  optimize: { template: 'optimize', blurb: 'push a number: one experiment per iteration, kept only if the metric improves' },
  maintain: { template: 'overnight', blurb: 'keep improving for hours with no "done", commits and review rituals' },
  research: { template: 'research', blurb: 'not code: deepen a written report against a checklist, with a critic' },
};

export const TEMPLATE_INFO = {
  default: 'a goal, an agent, loop until done',
  'plan-build': 'the full harness: plan ritual, one item per iteration, protected tests, memory, critic',
  tdd: 'done AND the test command must pass; tests are protected',
  'fix-ci': 'no "done" needed: loop until the test command passes',
  checklist: 'a living to-do list the agent ticks off; ends when all ticked and tests pass',
  optimize: 'autoresearch style: measure a metric, keep only improvements, revert the rest',
  overnight: 'runs for hours with no "done", review ritual every 5 iterations, notes file, commits on a branch',
  relay: 'two agents alternate: one builds, the other reviews; the reviewer is also the critic',
  research: 'not for code: deepen a written report each iteration, critic before done',
  ralph: 'the classic Ralph loop: one spec, loop until done, commit each iteration',
};

export function listTemplates() {
  return Object.keys(TEMPLATE_INFO).filter((n) => fs.existsSync(path.join(dir, `${n}.md`)));
}

export function renderTemplate(name, vars) {
  const p = path.join(dir, `${name}.md`);
  if (!fs.existsSync(p)) throw new Error(`unknown template "${name}" (available: ${listTemplates().join(', ')})`);
  let text = fs.readFileSync(p, 'utf8');
  const direction = vars.direction === 'min' ? 'min' : 'max';
  const v = {
    name: vars.name || 'loop',
    agent: vars.agent || 'claude',
    goal: vars.goal || 'Describe what this loop should achieve. Be concrete: what should exist, and how will you know it works?',
    test: vars.test || 'npm test',
    metric: vars.metric || 'node bench.js',
    direction,
    better: direction === 'min' ? 'goes down' : 'goes up',
    protect: vars.protect || 'test/**',
  };
  for (const [k, val] of Object.entries(v)) text = text.split(`{{${k}}}`).join(val);
  return text;
}
