import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignals } from '../src/protocol.js';

test('done only counts at the start of a line', () => {
  assert.equal(parseSignals('All finished.\n<loop:done/>\n').done, true);
  assert.equal(parseSignals('  <loop:done />').done, true);
  assert.equal(parseSignals('<loop:done></loop:done>').done, true);
  assert.equal(parseSignals('I will output <loop:done/> when finished.').done, false);
  assert.equal(parseSignals('').done, false);
});

test('stuck, ask, handoff, sleep, note', () => {
  const s = parseSignals(`Progress.\n<loop:stuck>need the API key</loop:stuck>\n<loop:ask>Should I use Postgres?</loop:ask>\n<loop:handoff> Codex </loop:handoff>\n<loop:sleep>10m</loop:sleep>\n<loop:note>flaky test in ci</loop:note>\n`);
  assert.equal(s.stuck, 'need the API key');
  assert.equal(s.ask, 'Should I use Postgres?');
  assert.equal(s.handoff, 'codex');
  assert.equal(s.sleep, '10m');
  assert.deepEqual(s.notes, ['flaky test in ci']);
  assert.equal(s.done, false);
});

test('self-closing stuck and multi-line bodies', () => {
  assert.equal(parseSignals('<loop:stuck/>').stuck, 'no reason given');
  const s = parseSignals('<loop:ask>\nWhich one?\n- a\n- b\n</loop:ask>');
  assert.equal(s.ask, 'Which one?\n- a\n- b');
});

test('case-insensitive tags', () => {
  assert.equal(parseSignals('<LOOP:DONE/>').done, true);
});
