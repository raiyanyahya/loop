import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoopfile, normalizeConfig, parseChecklist, describeUntil } from '../src/loopfile.js';

test('frontmatter + body + checklist', () => {
  const p = parseLoopfile(`---\nname: x\nuntil: [checklist]\n---\n\n# Goal\n\n- [ ] one\n- [x] two\n1. [ ] three\n* [X] four\n`);
  assert.equal(p.config.name, 'x');
  assert.match(p.body, /^# Goal/);
  assert.equal(p.checklist.total, 4);
  assert.equal(p.checklist.done, 2);
  assert.deepEqual(p.checklist.open, ['one', 'three']);
});

test('no frontmatter means the whole file is the prompt', () => {
  const p = parseLoopfile('Just do the thing.\n');
  assert.deepEqual(p.config, {});
  assert.equal(p.body, 'Just do the thing.\n');
  assert.equal(p.checklist.total, 0);
});

test('checklist ignores code blocks? (it does not; boxes are boxes)', () => {
  assert.equal(parseChecklist('- [ ] a\n  - [ ] nested\n').total, 2);
});

test('normalizeConfig defaults and overrides', () => {
  const cfg = normalizeConfig({ agent: 'Claude', until: 'npm test', max_time: '90m', git: true, rituals: [{ every: 3, prompt: 'review' }] }, { max: 5 }, { defaultName: 'dir' });
  assert.equal(cfg.name, 'dir');
  assert.deepEqual(cfg.agents, ['claude']);
  assert.deepEqual(cfg.until, ['npm test']);
  assert.equal(cfg.max, 5);
  assert.equal(cfg.max_time, 90 * 60 * 1000);
  assert.deepEqual(cfg.git, { commit: true, branch: null, worktree: false });
  assert.equal(cfg.rituals[0].every, 3);
  assert.equal(cfg.stall, 3);
  assert.equal(cfg.letter_path, '.loop/letter.md');
});

test('relay agents and git object', () => {
  const cfg = normalizeConfig({ agent: ['claude', 'codex'], git: { commit: true, branch: 'loop/x' }, until: [] });
  assert.deepEqual(cfg.agents, ['claude', 'codex']);
  assert.equal(cfg.git.branch, 'loop/x');
  assert.deepEqual(cfg.until, ['done']);
});

test('invalid duration throws', () => {
  assert.throws(() => normalizeConfig({ max_time: 'soon' }), /invalid duration/);
});

test('describeUntil', () => {
  assert.equal(describeUntil(['done', 'npm test']), 'the agent declares <loop:done/> AND `npm test` exits 0');
});
