import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { cli, tmpdir, writeLoop, scenario, readState, iterations, readJournal } from './helpers.js';
import { enforceChecklist, lastNumber } from '../src/runner.js';
import { globToRegExp, matchesAny, normalizeConfig } from '../src/loopfile.js';
import { parseSignals } from '../src/protocol.js';

const gitEnv = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const run = (dir, sc, extraEnv = {}, args = []) =>
  cli(['run', ...args], { cwd: dir, env: { LOOP_FAKE_SCENARIO: sc, LOOP_FAKE_PROMPT_LOG: path.join(dir, '.loop', 'prompts.log'), ...gitEnv, ...extraEnv } });
const prompts = (dir) => fs.readFileSync(path.join(dir, '.loop', 'prompts.log'), 'utf8');
const gitInit = (dir) => execSync('git init -q && git commit -q --allow-empty -m init', { cwd: dir, env: { ...process.env, ...gitEnv } });
const gitLog = (dir) => execSync('git log --oneline', { cwd: dir }).toString();

// ---------------------------------------------------------------- units

test('lastNumber picks the last number in the output', () => {
  assert.equal(lastNumber('epoch 3 val_bpb: 1.802\n'), 1.802);
  assert.equal(lastNumber('score=42'), 42);
  assert.equal(lastNumber('1e-3'), 0.001);
  assert.equal(lastNumber('no numbers here'), null);
});

test('glob matching for protect', () => {
  assert.ok(globToRegExp('test/**').test('test/a/b.js'));
  assert.ok(matchesAny('test/x.test.js', ['test/**']));
  assert.ok(matchesAny('src/deep/spec.md', ['**/spec.md']));
  assert.ok(matchesAny('SPEC.md', ['SPEC.md']));
  assert.ok(!matchesAny('src/spec.js', ['test/**']));
  assert.ok(matchesAny('a/b/c.test.js', ['*.test.js']));
});

test('enforceChecklist restores reworded items but keeps legitimate ticks', () => {
  const before = '# Goal\n\n- [ ] one\n- [ ] two\n- [x] three\n';
  assert.equal(enforceChecklist(before, '# Goal\n\n- [x] one\n- [ ] two\n- [x] three\n'), null);
  const fixed = enforceChecklist(before, '# Goal\n\n- [x] one\n- [ ] two (easier version)\n- [x] three\n');
  assert.equal(fixed, '# Goal\n\n- [x] one\n- [ ] two\n- [x] three\n');
  const removed = enforceChecklist(before, '# Goal\n\n- [x] one\n- [x] three\n');
  assert.equal(removed, '# Goal\n\n- [x] one\n- [ ] two\n- [x] three\n');
});

test('config: metric implies keep improve and git commit; critic forms; rituals at', () => {
  const cfg = normalizeConfig({ metric: 'node bench.js', direction: 'min', target: 1.5, critic: 'codex', protect: 'test/**', rituals: [{ at: 1, prompt: 'plan' }, { at: 'last', prompt: 'wrap' }, { prompt: 'review' }] });
  assert.equal(cfg.keep, 'improve');
  assert.equal(cfg.git.commit, true);
  assert.equal(cfg.direction, 'min');
  assert.equal(cfg.target, 1.5);
  assert.deepEqual(cfg.critic, { agent: 'codex', model: null, when: 'done', prompt: null });
  assert.deepEqual(cfg.protect, ['test/**']);
  assert.equal(cfg.rituals[0].at, 1);
  assert.equal(cfg.rituals[1].at, 'last');
  assert.equal(cfg.rituals[2].every, 5);
  assert.deepEqual(normalizeConfig({ critic: { agent: 'same', when: 3 } }).critic, { agent: null, model: null, when: 3, prompt: null });
  assert.throws(() => normalizeConfig({ until: 'idle' }), /removed/);
  assert.throws(() => normalizeConfig({ keep: 'sometimes' }), /keep must be/);
});

test('protocol: approve and reject', () => {
  assert.equal(parseSignals('Looks right.\n<loop:approve/>').approve, true);
  assert.equal(parseSignals('<loop:reject>\n1. no tests\n2. stub\n</loop:reject>').reject, '1. no tests\n2. stub');
});

// ---------------------------------------------------------------- metric loops

test('metric keep/revert: improvements are committed, regressions reverted, target ends the loop', async () => {
  const dir = tmpdir();
  gitInit(dir);
  fs.writeFileSync(path.join(dir, 'score.txt'), '10');
  fs.writeFileSync(path.join(dir, 'bench.sh'), 'cat score.txt');
  execSync('git add -A && git commit -qm base', { cwd: dir, env: { ...process.env, ...gitEnv } });
  writeLoop(dir, { agent: 'fake', until: 'never', metric: 'sh bench.sh', direction: 'max', target: 30, max: 10, stall: 0 }, 'Raise the score.');
  const sc = scenario([
    { write: { 'score.txt': '20' }, letter: 'tried 20' },
    { write: { 'score.txt': '5' }, letter: 'tried 5 (worse)' },
    { write: { 'score.txt': '20\n' }, letter: 'tried a variant that also scores 20 (no improvement)' },
    { write: { 'score.txt': '35' }, letter: 'tried 35' },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /metric baseline: 10/);
  assert.match(r.out, /reverted: the metric did not improve \(5 vs best 20\)/);
  assert.match(r.out, /target 30 reached/);
  const its = iterations(dir);
  assert.deepEqual(its.map((i) => i.result), ['kept', 'reverted', 'reverted', 'kept']);
  assert.deepEqual(its.map((i) => i.metric), [20, 5, 20, 35]);
  assert.equal(fs.readFileSync(path.join(dir, 'score.txt'), 'utf8'), '35');
  const log = gitLog(dir);
  assert.match(log, /#4/);
  assert.match(log, /#1/);
  assert.ok(!/#2\)|#3\)/.test(log), 'reverted iterations are not committed');
  const st = readState(dir);
  assert.equal(st.status, 'done');
  assert.equal(st.metric.best, 35);
  assert.equal(st.kept, 2);
  assert.equal(st.reverted, 2);
  const p = prompts(dir);
  assert.match(p, /===== iteration 3 =====[\s\S]*The loop reverted your last iteration[\s\S]*Iteration 2 was reverted: the metric did not improve/);
  assert.match(p, /\| 2 \| fake \| 1 file \| - \| 5 \| reverted \|/);
});

test('keep: no-regress reverts when a passing check starts failing; baseline commit covers dirty trees', async () => {
  const dir = tmpdir();
  gitInit(dir);
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'yes'); // uncommitted -> baseline commit
  writeLoop(dir, { agent: 'fake', until: ['done', 'test -f ok.txt'], keep: 'no-regress', max: 4 }, 'Keep ok.txt.');
  const sc = scenario([
    { write: { 'a.txt': '1' }, letter: 'added a' },
    { delete: ['ok.txt'], write: { 'b.txt': '2' }, letter: 'removed ok (oops)' },
    { write: { 'c.txt': '3' }, letter: 'added c', done: true },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /committed baseline/);
  assert.match(r.out, /reverted: a check that used to pass now fails \(test -f ok.txt\)/);
  assert.ok(fs.existsSync(path.join(dir, 'ok.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'b.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'c.txt')));
});

// ---------------------------------------------------------------- protect & checklist integrity

test('protected files are restored and the done claim is rejected', async () => {
  const dir = tmpdir();
  gitInit(dir);
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'spec.js'), 'original');
  execSync('git add -A && git commit -qm base', { cwd: dir, env: { ...process.env, ...gitEnv } });
  writeLoop(dir, { agent: 'fake', protect: ['test/**'], max: 3 }, 'Do it.');
  const sc = scenario([
    { write: { 'test/spec.js': 'weakened', 'test/new.js': 'x', 'src.js': 'ok' }, letter: 'cheated', done: true },
    { write: { 'src.js': 'better' }, letter: 'fixed properly', done: true },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /protected files modified: test\/new.js, test\/spec.js \(restored\)/);
  assert.match(r.out, /done rejected: protected files were modified/);
  assert.equal(fs.readFileSync(path.join(dir, 'test', 'spec.js'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(dir, 'test', 'new.js')));
  assert.match(prompts(dir), /===== iteration 2 =====[\s\S]*Protected files were restored[\s\S]*`test\/new.js`, `test\/spec.js`/);
  assert.deepEqual(iterations(dir)[0].violations, ['test/new.js', 'test/spec.js']);
});

test('reworded checklist items are restored and the iteration is not done', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: 'checklist', max: 3 }, '# Goal\n\n- [ ] hard thing\n- [ ] other thing\n');
  const sc = scenario([
    { check: 2, reword: ['hard thing', 'easy thing'], letter: 'made it easy' },
    { check: 2, letter: 'did it right' },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /checklist items were added, removed, or reworded/);
  const text = fs.readFileSync(path.join(dir, 'LOOP.md'), 'utf8');
  assert.match(text, /- \[x\] hard thing\n- \[x\] other thing/);
  assert.equal(iterations(dir).length, 2);
  assert.match(prompts(dir), /===== iteration 2 =====[\s\S]*You changed the checklist text/);
});

// ---------------------------------------------------------------- critic

test('critic: a rejection blocks done and feeds the next iteration; approval finishes', async () => {
  const dir = tmpdir();
  gitInit(dir);
  writeLoop(dir, { agent: 'fake', critic: 'same', max: 4 }, 'Build it well.');
  const sc = scenario(
    [
      { write: { 'a.js': 'v1' }, letter: 'built v1', done: true },
      { write: { 'a.js': 'v2 with tests' }, letter: 'added tests', done: true },
    ],
    { critic: [{ say: ['Reviewing the diff.'], reject: '1. No tests were added.\n2. The letter overstates the work.' }, { say: ['Looks complete.'], approve: true }] },
  );
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /critic: rejected/);
  assert.match(r.out, /done rejected: the critic rejected the work/);
  assert.match(r.out, /critic: approved/);
  assert.match(r.out, /verified and approved/);
  const p = prompts(dir);
  assert.match(p, /===== critic iteration 1 =====[\s\S]*critic review of iteration 1[\s\S]*claims the goal is complete[\s\S]*## Diff/);
  assert.match(p, /===== iteration 2 =====[\s\S]*Review by the critic \(fake\) — rejected[\s\S]*No tests were added/);
  const events = readJournal(dir).filter((e) => e.type === 'critic');
  assert.deepEqual(events.map((e) => e.verdict), ['rejected', 'approved']);
  assert.equal(iterations(dir)[1].critic.verdict, 'approved');
});

test('critic every N runs as a periodic review and its notes feed the next prompt', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', critic: { agent: 'same', when: 2 }, max: 3, stall: 0 }, 'Keep going.');
  const sc = scenario([{ write: { 'f.txt': '1' } }, { write: { 'f.txt': '2' } }, { write: { 'f.txt': '3' } }], { critic: [{}, { say: ['Solid so far. Consider naming.'], approve: true }] });
  const r = await run(dir, sc);
  assert.equal(r.code, 1, r.out);
  const events = readJournal(dir).filter((e) => e.type === 'critic');
  assert.deepEqual(events.map((e) => e.n), [2]);
  assert.match(prompts(dir), /===== iteration 3 =====[\s\S]*Review by the critic \(fake\) — approved[\s\S]*Consider naming/);
});

// ---------------------------------------------------------------- brakes & rhythm

test('the same failure repeated N times stops the loop as stuck', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: 'test -f never.txt', repeat: 2, max: 10, stall: 0 }, 'x');
  const r = await run(dir, scenario([{ write: { 'a.txt': '1' } }, { write: { 'a.txt': '2' } }, { write: { 'a.txt': '3' } }]));
  assert.equal(r.code, 2);
  const st = readState(dir);
  assert.equal(st.status, 'stuck');
  assert.match(st.reason, /same failure repeated 2 times/);
  assert.equal(st.iteration, 2);
});

test('rituals at: 1 and at: last', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'LOOP.md'), `---\nagent: fake\nmax: 3\nstall: 0\nrituals:\n  - at: 1\n    name: plan\n    prompt: PLAN FIRST\n  - at: last\n    name: wrap\n    prompt: WRAP UP\n---\nBuild.\n`);
  const r = await run(dir, scenario([{ write: { 'a': '1' } }, { write: { 'b': '1' } }, { write: { 'c': '1' } }]));
  assert.equal(r.code, 1, r.out);
  const p = prompts(dir);
  assert.match(p, /===== iteration 1 =====[\s\S]*ritual: plan[\s\S]*PLAN FIRST[\s\S]*===== iteration 2/);
  assert.ok(!/===== iteration 2 =====[\s\S]*?(PLAN FIRST|WRAP UP)[\s\S]*?===== iteration 3/.test(p));
  assert.match(p, /===== iteration 3 =====[\s\S]*ritual: wrap[\s\S]*WRAP UP/);
});

test('memory file is inlined and history table accumulates', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'NOTES.md'), 'The build uses make.');
  writeLoop(dir, { agent: 'fake', memory: 'NOTES.md', until: 'test -f done.txt', max: 3 }, 'x');
  const r = await run(dir, scenario([{ write: { 'a': '1' } }, { write: { 'done.txt': '1' } }]));
  assert.equal(r.code, 0, r.out);
  const p = prompts(dir);
  assert.match(p, /## Notes \(`NOTES.md`\)[\s\S]*The build uses make\./);
  assert.match(p, /===== iteration 2 =====[\s\S]*## History[\s\S]*\| 1 \| fake \| 1 file \| 1\/1 failing \| — \| kept \|/);
  assert.match(p, /Keep `NOTES.md` current/);
});

test('notify posts to a webhook on completion', async () => {
  const dir = tmpdir();
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  writeLoop(dir, { agent: 'fake', notify: url, max: 2 }, 'x');
  const r = await run(dir, scenario([{ say: ['hi'], done: true }]));
  server.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(received.length, 1);
  assert.equal(received[0].status, 'done');
  assert.match(received[0].text, /done/);
});

// ---------------------------------------------------------------- isolation

test('git.worktree runs the loop in a worktree on its own branch; the journal stays home', async () => {
  const dir = tmpdir();
  gitInit(dir);
  writeLoop(dir, { agent: 'fake', git: { worktree: true }, max: 2 }, 'x');
  execSync('git add -A && git commit -qm loopfile', { cwd: dir, env: { ...process.env, ...gitEnv } });
  const r = await run(dir, scenario([{ write: { 'wt.txt': '1' }, letter: 'in worktree', done: true }]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /created worktree/);
  const wt = path.join(dir, '.loop', 'worktrees', path.basename(dir));
  assert.ok(fs.existsSync(path.join(wt, 'wt.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'wt.txt')), 'main tree untouched');
  assert.ok(fs.existsSync(path.join(dir, '.loop', 'state.json')));
  const branches = execSync('git branch --list', { cwd: dir }).toString();
  assert.match(branches, new RegExp(`loop/${path.basename(dir)}`));
  assert.match(execSync('git log --oneline', { cwd: wt }).toString(), /#1/);
});

test('sandbox wraps the agent command', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', sandbox: 'sh -c {cmd}', max: 1 }, 'x');
  const r = await run(dir, scenario([{ say: ['inside'], done: true }]), {}, ['--dry']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /command: sandbox: sh -c/);
  const r2 = await run(dir, scenario([{ say: ['inside'], done: true }]));
  assert.equal(r2.code, 0, r2.out);
});

// ---------------------------------------------------------------- cli surface

test('init --kind optimize renders the optimize template; run resolves names', async () => {
  const dir = tmpdir();
  const r = await cli(['init', '--kind', 'optimize', '--yes', '--agent', 'fake', '--goal', 'Faster', '--metric', 'sh bench.sh', '--direction', 'min'], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  const text = fs.readFileSync(path.join(dir, 'LOOP.md'), 'utf8');
  assert.match(text, /metric: "sh bench.sh"/);
  assert.match(text, /direction: min/);
  assert.match(text, /keep: improve/);
  fs.mkdirSync(path.join(dir, 'loops'));
  fs.writeFileSync(path.join(dir, 'loops', 'quick.md'), '---\nagent: fake\nmax: 1\n---\nQuick.\n');
  const r2 = await run(dir, scenario([{ say: ['ok'], done: true }]), {}, ['quick']);
  assert.equal(r2.code, 0, r2.out);
  assert.match((await cli(['init', '--list'], { cwd: dir })).out, /optimize[\s\S]*plan-build/);
});

// ---------------------------------------------------------------- regressions found by independent testing

test('protected files with spaces and accents are matched and restored (git quotePath)', async () => {
  const dir = tmpdir();
  gitInit(dir);
  fs.mkdirSync(path.join(dir, 'tést dir'));
  fs.writeFileSync(path.join(dir, 'tést dir', 'spec é.txt'), 'keep');
  execSync('git add -A && git commit -qm base', { cwd: dir, env: { ...process.env, ...gitEnv } });
  writeLoop(dir, { agent: 'fake', protect: ['tést dir/**'], max: 2, git: true }, 'x');
  const r = await run(dir, scenario([{ write: { 'tést dir/spec é.txt': 'hacked', 'new fïle.txt': '1' }, done: true }, { write: { 'other.txt': '2' }, done: true }]));
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(dir, 'tést dir', 'spec é.txt'), 'utf8'), 'keep');
  assert.deepEqual(iterations(dir)[0].violations, ['tést dir/spec é.txt']);
  assert.match(gitLog(dir), /#2/);
});

test('a hung check is killed at check_timeout, including its children', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: 'sleep 5', check_timeout: '1s', max: 1, stall: 0 }, 'x');
  const t0 = Date.now();
  const r = await run(dir, scenario([{ write: { a: '1' } }]));
  const ms = Date.now() - t0;
  assert.equal(r.code, 1);
  assert.match(r.out, /timed out/);
  assert.ok(ms < 4000, `took ${ms}ms`);
});

test('300 KB of agent output is captured in full and the final signal still counts', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 1 }, 'x');
  const sc = scenario([{ say: Array.from({ length: 2000 }, () => 'line of output '.repeat(10)).concat(['<loop:done/>']) }]);
  fs.writeFileSync(path.join(dir, 'sc.json'), sc);
  const r = await run(dir, path.join(dir, 'sc.json'), {}, ['--quiet']);
  assert.equal(r.code, 0, r.out);
  const runs = path.join(dir, '.loop', 'runs');
  const out = fs.statSync(path.join(runs, fs.readdirSync(runs).sort().at(-1), 'iter-001', 'output.txt')).size;
  assert.ok(out > 250000, `output.txt is ${out} bytes`);
});

test('permissions: edits maps to each adapter\'s edit-only mode', async () => {
  const { buildInvocation } = await import('../src/agents.js');
  const cfg = normalizeConfig({ agent: 'claude', permissions: 'edits' });
  const inv = buildInvocation({ agent: 'fake', cfg: { ...cfg, name: 'x' }, prompt: 'p', promptFile: '/tmp/p.md', iteration: 1 });
  assert.ok(inv.display.includes('fake-agent.js'));
  const { AGENTS } = await import('../src/agents.js');
  assert.deepEqual(AGENTS.claude.args({ permissions: 'edits' }).slice(-2), ['--permission-mode', 'acceptEdits']);
  assert.ok(AGENTS.claude.args({ permissions: 'bypass' }).includes('--dangerously-skip-permissions'));
  assert.ok(!AGENTS.claude.args({ permissions: 'default' }).includes('--dangerously-skip-permissions'));
  assert.ok(AGENTS.codex.args({ permissions: 'edits' }).includes('workspace-write'));
  assert.ok(AGENTS.gemini.args({ permissions: 'edits', prompt: 'p' }).includes('auto_edit'));
  assert.throws(() => normalizeConfig({ permissions: 'sometimes' }), /permissions must be/);
});

test('agent-controlled text never reaches a shell: commit messages and file names with backticks and $(...)', async () => {
  const dir = tmpdir();
  gitInit(dir);
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a`b$(touch pwned-restore).js'), 'keep');
  execSync('git add -A && git commit -qm base', { cwd: dir, env: { ...process.env, ...gitEnv } });
  writeLoop(dir, { agent: 'fake', protect: ['test/**'], git: true, max: 2 }, 'x');
  const letter = 'Implemented `greet(name)` and ran $(touch pwned-commit); see `README.md`';
  const r = await run(dir, scenario([{ write: { 'test/a`b$(touch pwned-restore).js': 'hacked', 'src.js': 'ok' }, letter, done: true }, { write: { 'src.js': 'v2' }, letter, done: true }]));
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(dir, 'pwned-commit')), 'commit message was executed by a shell');
  assert.ok(!fs.existsSync(path.join(dir, 'pwned-restore')), 'file name was executed by a shell');
  assert.equal(fs.readFileSync(path.join(dir, 'test', 'a`b$(touch pwned-restore).js'), 'utf8'), 'keep');
  assert.match(gitLog(dir), /Implemented `greet\(name\)` and ran \$\(touch pwned-commit\)/);
  assert.match(r.out, /git: committed/);
});
