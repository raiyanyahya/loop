import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../src/cli.js';
import { cli, tmpdir } from './helpers.js';

test('parseArgs handles flags, repeats, and prompts', () => {
  const r = parseArgs(['run', 'LOOP.md', '--until', 'npm test', '--until=done', '--max', '3', '--dry', '-p', 'do it', '--no-prompt']);
  assert.equal(r.cmd, 'run');
  assert.deepEqual(r.args, ['LOOP.md']);
  assert.deepEqual(r.flags.until, ['npm test', 'done']);
  assert.equal(r.flags.max, '3');
  assert.equal(r.flags.dry, true);
  assert.equal(r.flags.p, 'do it');
  assert.equal(r.flags['no-prompt'], true);
});

test('help and version', async () => {
  const h = await cli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /loop init/);
  const v = await cli(['--version']);
  assert.match(v.out, /loop \d+\.\d+\.\d+/);
});

test('init writes a Loopfile from a template and refuses to overwrite', async () => {
  const dir = tmpdir();
  const r = await cli(['init', 'tdd', '--yes', '--agent', 'fake', '--goal', 'Build X', '--test', 'npm test', '--name', 'proj'], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  const text = fs.readFileSync(path.join(dir, 'LOOP.md'), 'utf8');
  assert.match(text, /name: proj/);
  assert.match(text, /agent: fake/);
  assert.match(text, /until: \[done, "npm test"\]/);
  assert.match(text, /Build X/);
  const again = await cli(['init', '--yes'], { cwd: dir });
  assert.equal(again.code, 1);
  assert.match(again.out, /already exists/);
});

test('unknown template and unknown command fail cleanly', async () => {
  const dir = tmpdir();
  assert.match((await cli(['init', 'nope', '--yes'], { cwd: dir })).out, /unknown template/);
  assert.match((await cli(['frobnicate'], { cwd: dir })).out, /unknown command/);
});

test('status/log/letter with nothing recorded', async () => {
  const dir = tmpdir();
  assert.match((await cli(['status'], { cwd: dir })).out, /no loop has run/);
  assert.match((await cli(['log'], { cwd: dir })).out, /no runs yet/);
  assert.match((await cli(['letter'], { cwd: dir })).out, /no letter yet/);
  assert.match((await cli(['stop'], { cwd: dir })).out, /no loop is running/);
});

test('demo --quick runs to done', async () => {
  const dir = tmpdir();
  const r = await cli(['demo', '--quick', '--dir', dir], { cwd: dir, timeout: 60000 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /done rejected: 1 checklist item still open/);
  assert.match(r.out, /done after 3 iterations/);
  assert.ok(fs.existsSync(path.join(dir, 'README.md')));
  const log = await cli(['log'], { cwd: dir });
  assert.match(log.out, /done rejected/);
  const rep = await cli(['report'], { cwd: dir });
  assert.equal(rep.code, 0);
  assert.ok(fs.readFileSync(path.join(dir, '.loop', 'report.html'), 'utf8').includes('demo'));
});
