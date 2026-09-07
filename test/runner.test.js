import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, tmpdir, writeLoop, scenario, readState, iterations, readJournal } from './helpers.js';

const run = (dir, sc, extraEnv = {}, args = []) =>
  cli(['run', ...args], { cwd: dir, env: { LOOP_FAKE_SCENARIO: sc, LOOP_FAKE_PROMPT_LOG: path.join(dir, '.loop', 'prompts.log'), ...extraEnv } });
const prompts = (dir) => fs.readFileSync(path.join(dir, '.loop', 'prompts.log'), 'utf8');

test('done: the agent declares done and until is [done]', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 5 }, 'Do the thing.');
  const r = await run(dir, scenario([{ say: ['working'], write: { 'a.txt': 'a' }, letter: 'did a', done: true }]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /done after 1 iteration/);
  const st = readState(dir);
  assert.equal(st.status, 'done');
  assert.equal(st.iteration, 1);
  assert.equal(iterations(dir).length, 1);
  assert.match(prompts(dir), /No letter: this is the first iteration/);
});

test('a false done is rejected until the command passes, and the letter carries over', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: ['done', 'test -f ok.txt'], max: 5 }, 'Create ok.txt');
  const sc = scenario([
    { say: ['I think I am done'], letter: 'Iteration one letter. Next: actually create ok.txt', done: true },
    { say: ['ok, creating it'], write: { 'ok.txt': 'x' }, letter: 'created ok.txt', done: true },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /done rejected: `test -f ok.txt` exited 1/);
  assert.match(r.out, /done after 2 iterations/);
  const p = prompts(dir);
  assert.match(p, /===== iteration 2 =====[\s\S]*The loop rejected your last "done"/);
  assert.match(p, /===== iteration 2 =====[\s\S]*Iteration one letter\. Next: actually create ok\.txt/);
  assert.match(p, /### `test -f ok.txt` \(exit 1/);
  const its = iterations(dir);
  assert.equal(its[0].satisfied, false);
  assert.equal(its[1].satisfied, true);
  assert.deepEqual(its[1].changed, ['ok.txt']);
});

test('until [cmd] ends without a done claim once the command passes', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: 'test -f ok.txt', max: 5 }, 'Create ok.txt');
  const r = await run(dir, scenario([{ say: ['nope'], letter: 'l' }, { write: { 'ok.txt': '1' }, letter: 'l2' }]));
  assert.equal(r.code, 0, r.out);
  assert.equal(readState(dir).status, 'done');
  assert.equal(iterations(dir).length, 2);
});

test('checklist: ticks are re-read from the Loopfile each iteration', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', until: 'checklist', max: 5 }, '# Goal\n\n- [ ] one\n- [ ] two\n');
  const r = await run(dir, scenario([{ check: 1, letter: 'ticked one' }, { check: 1, letter: 'ticked two' }]));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 checklist item still open/);
  assert.match(fs.readFileSync(path.join(dir, 'LOOP.md'), 'utf8'), /- \[x\] one\n- \[x\] two/);
  assert.match(prompts(dir), /===== iteration 2 =====[\s\S]*Checklist: 1\/2 done\. Open: "two"/);
});

test('stuck stops the loop with exit code 2', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 5 }, 'x');
  const r = await run(dir, scenario([{ say: ['cannot continue'], stuck: 'need credentials' }]));
  assert.equal(r.code, 2);
  const st = readState(dir);
  assert.equal(st.status, 'stuck');
  assert.equal(st.reason, 'need credentials');
  assert.match(r.out, /stuck after 1 iteration/);
});

test('ask without a TTY parks the loop; answer + run resumes with the answer in the prompt', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 5 }, 'x');
  const r = await run(dir, scenario([{ say: ['hmm'], letter: 'asked about colour', ask: 'Blue or green?' }]));
  assert.equal(r.code, 3, r.out);
  const st = readState(dir);
  assert.equal(st.status, 'waiting');
  assert.equal(st.question, 'Blue or green?');
  assert.match((await cli(['status'], { cwd: dir })).out, /Blue or green\?/);
  const a = await cli(['answer', 'green', 'please'], { cwd: dir });
  assert.equal(a.code, 0, a.out);
  assert.ok(fs.existsSync(path.join(dir, '.loop', 'answer.md')));
  const r2 = await run(dir, scenario([{ say: ['thanks'], done: true }]));
  assert.equal(r2.code, 0, r2.out);
  assert.match(prompts(dir), /## Answer from the human[\s\S]*green please/);
  assert.match(prompts(dir), /asked about colour/); // letter survived across runs
  assert.ok(!fs.existsSync(path.join(dir, '.loop', 'answer.md')));
});

test('stall: idle iterations stop the loop', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 10, stall: 2 }, 'x');
  const r = await run(dir, scenario([{ say: ['nothing to do'] }]));
  assert.equal(r.code, 1);
  const st = readState(dir);
  assert.equal(st.status, 'stalled');
  assert.equal(st.iteration, 2);
});

test('max iterations guard', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 2, stall: 0 }, 'x');
  const r = await run(dir, scenario([{ write: { 'n.txt': 'x' }, append: { 'n.txt': '+' } }]));
  assert.equal(r.code, 1);
  assert.match(readState(dir).reason, /max iterations \(2\)/);
  assert.equal(iterations(dir).length, 2);
});

test('--once and --max override the Loopfile', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 9 }, 'x');
  const r = await run(dir, scenario([{ say: ['one'] }]), {}, ['--once']);
  assert.equal(r.code, 1);
  assert.match(readState(dir).reason, /--once/);
  assert.equal(iterations(dir).length, 1);
});

test('stop file ends the loop between iterations', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 5, before: 'mkdir -p .loop && touch .loop/STOP' }, 'x');
  const r = await run(dir, scenario([{ write: { 'f.txt': '1' } }]));
  assert.equal(r.code, 1);
  assert.match(readState(dir).reason, /stop requested/);
  assert.equal(iterations(dir).length, 1);
  assert.ok(!fs.existsSync(path.join(dir, '.loop', 'STOP')));
});

test('handoff switches agent for one iteration; custom command agent works', async () => {
  const dir = tmpdir();
  const fake = path.resolve('src/fake-agent.js');
  writeLoop(dir, { agent: 'fake', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(fake)}`, max: 5 }, 'x');
  const sc = scenario([
    { write: { 'a': '1' }, handoff: 'custom' },
    { write: { 'b': '2' } },
    { write: { 'c': '3' }, done: true },
  ]);
  const r = await run(dir, sc);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(iterations(dir).map((i) => i.agent), ['fake', 'custom', 'fake']);
  assert.match(prompts(dir), /===== iteration 2 =====[\s\S]*Agent: custom \(the previous iteration ran on fake\)/);
});

test('relay alternates agents', async () => {
  const dir = tmpdir();
  const fake = path.resolve('src/fake-agent.js');
  writeLoop(dir, { agent: ['fake', 'custom'], command: `${JSON.stringify(process.execPath)} ${JSON.stringify(fake)}`, max: 3, stall: 0 }, 'x');
  const r = await run(dir, scenario([{ write: { 'a': '1' } }, { write: { 'b': '1' } }, { write: { 'c': '1' } }]));
  assert.equal(r.code, 1);
  assert.deepEqual(iterations(dir).map((i) => i.agent), ['fake', 'custom', 'fake']);
});

test('rituals replace the instruction every N iterations', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'LOOP.md'), `---\nagent: fake\nmax: 2\nstall: 0\nrituals:\n  - every: 2\n    name: review\n    prompt: REVIEW EVERYTHING NOW\n---\nBuild it.\n`);
  const r = await run(dir, scenario([{ write: { 'a': '1' } }, { write: { 'b': '1' } }]));
  assert.equal(r.code, 1, r.out);
  const p = prompts(dir);
  assert.ok(!/===== iteration 1 =====[\s\S]*?REVIEW EVERYTHING NOW[\s\S]*?===== iteration 2/.test(p));
  assert.match(p, /===== iteration 2 =====[\s\S]*ritual: review[\s\S]*REVIEW EVERYTHING NOW/);
  assert.match(r.out, /ritual: review/);
});

test('feedback commands run before each iteration and land in the prompt', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 1, feedback: 'echo FEEDBACK-LINE-42' }, 'x');
  await run(dir, scenario([{ say: ['ok'] }]));
  assert.match(prompts(dir), /### `echo FEEDBACK-LINE-42` \(exit 0[\s\S]*FEEDBACK-LINE-42/);
});

test('context files are inlined', async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'SPEC.md'), 'THE SPEC CONTENT');
  writeLoop(dir, { agent: 'fake', max: 1, context: 'SPEC.md' }, 'x');
  await run(dir, scenario([{ say: ['ok'] }]));
  assert.match(prompts(dir), /## Context: `SPEC.md`[\s\S]*THE SPEC CONTENT/);
});

test('iteration timeout kills the agent and the loop continues', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 1, timeout: '1s' }, 'x');
  const r = await run(dir, scenario([{ say: ['slow', 'slower'], delay: 4000 }]));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /timed out/);
  assert.equal(iterations(dir)[0].timedOut, true);
});

test('agent failing three times in a row with no output stops the loop', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 10, stall: 0 }, 'x');
  const r = await run(dir, scenario([{ exit: 1 }]));
  assert.equal(r.code, 1);
  assert.equal(readState(dir).status, 'failed');
  assert.equal(iterations(dir).length, 3);
});

test('git: true commits every iteration that changed files', async () => {
  const dir = tmpdir();
  const gitEnv = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  await cli([], { cwd: dir }); // noop, just to ensure node works
  const { execSync } = await import('node:child_process');
  execSync('git init -q && git commit -q --allow-empty -m init', { cwd: dir, env: { ...process.env, ...gitEnv } });
  writeLoop(dir, { agent: 'fake', max: 3, git: true }, 'x');
  const r = await run(dir, scenario([{ write: { 'a.txt': '1' }, letter: 'wrote a' }, { write: { 'b.txt': '2' }, letter: 'wrote b', done: true }]), gitEnv);
  assert.equal(r.code, 0, r.out);
  const log = execSync('git log --oneline', { cwd: dir }).toString();
  assert.match(log, /loop\(.* #2\): wrote b/);
  assert.match(log, /loop\(.* #1\): wrote a/);
  assert.match(r.out, /git: committed/);
  const status = execSync('git status --porcelain', { cwd: dir }).toString();
  assert.ok(!/a\.txt|b\.txt|LOOP\.md/.test(status), 'work is committed');
  assert.equal(iterations(dir)[0].changed.includes('a.txt'), true);
});

test('--dry prints the prompt and command and creates no journal', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake' }, 'Dry goal');
  const r = await run(dir, scenario([]), {}, ['--dry']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Dry goal/);
  assert.match(r.out, /dry run: nothing was executed/);
  assert.ok(!fs.existsSync(path.join(dir, '.loop', 'state.json')));
});

test('ad-hoc prompt with -p and --until', async () => {
  const dir = tmpdir();
  const r = await run(dir, scenario([{ write: { 'ok': '1' } }]), {}, ['-p', 'make ok exist', '--agent', 'fake', '--until', 'test -f ok', '--name', 'adhoc']);
  assert.equal(r.code, 0, r.out);
  assert.equal(readState(dir).name, 'adhoc');
  assert.match(prompts(dir), /^make ok exist/m);
});

test('missing agent fails fast with an install hint', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'codex-does-not-exist' }, 'x');
  const r = await run(dir, scenario([]));
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown agent/);
  writeLoop(dir, { agent: 'goose' }, 'x');
  const r2 = await run(dir, scenario([]));
  assert.match(r2.out, /not installed|unknown agent/);
});

test('journal has start, spawn, iteration and end events', async () => {
  const dir = tmpdir();
  writeLoop(dir, { agent: 'fake', max: 1 }, 'x');
  await run(dir, scenario([{ say: ['x'], done: true }]));
  const types = readJournal(dir).map((e) => e.type);
  assert.deepEqual(types, ['start', 'spawn', 'iteration', 'end']);
});
