import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYAML, toYAML } from '../src/yaml.js';

test('scalars, quotes, comments, booleans, numbers', () => {
  const y = parseYAML(`
# comment
name: my loop   # trailing comment
agent: claude
max: 25
cost: 1.5
flag: true
off: no
nothing: ~
quoted: "a: b # not a comment"
single: 'it''s'
url: https://example.com/x#y
`);
  assert.deepEqual(y, { name: 'my loop', agent: 'claude', max: 25, cost: 1.5, flag: true, off: false, nothing: null, quoted: 'a: b # not a comment', single: "it's", url: 'https://example.com/x#y' });
});

test('inline and block lists', () => {
  const y = parseYAML(`until: [done, "npm test", checklist]
agent:
  - claude
  - codex
empty: []
`);
  assert.deepEqual(y, { until: ['done', 'npm test', 'checklist'], agent: ['claude', 'codex'], empty: [] });
});

test('nested maps, list of maps, block scalars', () => {
  const y = parseYAML(`git:
  commit: true
  branch: loop/x
rituals:
  - every: 5
    name: review
    prompt: |
      Review everything.

      Fix what you find.
  - every: 10
    prompt: >-
      folded
      text
inline: {a: 1, b: "two"}
`);
  assert.deepEqual(y.git, { commit: true, branch: 'loop/x' });
  assert.equal(y.rituals.length, 2);
  assert.equal(y.rituals[0].every, 5);
  assert.equal(y.rituals[0].prompt, 'Review everything.\n\nFix what you find.\n');
  assert.equal(y.rituals[1].prompt, 'folded text');
  assert.deepEqual(y.inline, { a: 1, b: 'two' });
});

test('list at same indent as key', () => {
  const y = parseYAML(`feedback:\n- npm test\n- npm run lint\n`);
  assert.deepEqual(y, { feedback: ['npm test', 'npm run lint'] });
});

test('empty and whitespace-only documents', () => {
  assert.deepEqual(parseYAML(''), {});
  assert.deepEqual(parseYAML('\n# only a comment\n'), {});
});

test('toYAML round-trips simple configs', () => {
  const obj = { name: 'x', agent: ['claude', 'codex'], until: ['done', 'npm test'], git: { commit: true, branch: 'loop/x' }, max: 3 };
  assert.deepEqual(parseYAML(toYAML(obj)), obj);
});
