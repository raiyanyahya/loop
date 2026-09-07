#!/usr/bin/env node
/**
 * A scripted stand-in for a real coding agent. Used by `loop demo` and the test-suite.
 * It reads the prompt on stdin like a real agent would, then performs the actions for the
 * current iteration from a scenario (LOOP_FAKE_SCENARIO = JSON string or a path to one).
 *
 * Scenario shape: { "iterations": [ step, ... ], "critic": [ step, ... ], "loopfile": "LOOP.md", "delay": 0 }
 * step: { "say": [...], "write": {"file": "content"}, "append": {...}, "check": 1, "letter": "...",
 *         "then": [...], "done": true, "stuck": "...", "ask": "...", "handoff": "codex", "sleep": "1s",
 *         "approve": true, "reject": "...", "exit": 0, "delay": 50 }
 * Iterations past the end of the list repeat the last entry. LOOP_ROLE=critic selects `critic` steps.
 */
import fs from 'node:fs';
import path from 'node:path';

const iteration = Number(process.env.LOOP_ITERATION || '1');
const role = process.env.LOOP_ROLE || 'worker';
const cwd = process.cwd();

let scenario = { iterations: [] };
const raw = process.env.LOOP_FAKE_SCENARIO;
if (raw) {
  try {
    scenario = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
  } catch (err) {
    process.stderr.write(`fake-agent: bad scenario: ${err.message}\n`);
    process.exit(2);
  }
}

let prompt = '';
try {
  prompt = fs.readFileSync(0, 'utf8');
} catch {
  /* no stdin */
}
if (process.env.LOOP_FAKE_PROMPT_LOG) {
  fs.mkdirSync(path.dirname(process.env.LOOP_FAKE_PROMPT_LOG), { recursive: true });
  fs.appendFileSync(process.env.LOOP_FAKE_PROMPT_LOG, `\n===== ${role === 'critic' ? 'critic ' : ''}iteration ${iteration} =====\n${prompt}`);
}

const steps = (role === 'critic' ? scenario.critic : scenario.iterations) || [];
const step = steps[Math.min(iteration, steps.length) - 1] || {};
const say = (s) => process.stdout.write(s + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const delay = Number(step.delay ?? scenario.delay ?? 0);
  for (const line of step.say || []) {
    say(line);
    if (delay) await wait(delay);
  }
  for (const [file, content] of Object.entries(step.write || {})) {
    const p = path.join(cwd, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    say(`⚙ Write ${file}`);
    if (delay) await wait(delay);
  }
  for (const [file, content] of Object.entries(step.append || {})) {
    fs.appendFileSync(path.join(cwd, file), content);
    say(`⚙ Edit ${file}`);
  }
  for (const file of step.delete || []) {
    try {
      fs.unlinkSync(path.join(cwd, file));
      say(`⚙ Delete ${file}`);
    } catch {
      /* ignore */
    }
  }
  if (step.check) {
    const lf = path.join(cwd, scenario.loopfile || 'LOOP.md');
    let text = fs.readFileSync(lf, 'utf8');
    for (let i = 0; i < Number(step.check); i++) text = text.replace(/^(\s*[-*]\s+)\[ \]/m, '$1[x]');
    fs.writeFileSync(lf, text);
    say(`⚙ Edit ${scenario.loopfile || 'LOOP.md'}  (ticked ${step.check} item${step.check > 1 ? 's' : ''})`);
    if (delay) await wait(delay);
  }
  if (step.reword) {
    const lf = path.join(cwd, scenario.loopfile || 'LOOP.md');
    fs.writeFileSync(lf, fs.readFileSync(lf, 'utf8').replace(step.reword[0], step.reword[1]));
    say(`⚙ Edit ${scenario.loopfile || 'LOOP.md'}  (reworded)`);
  }
  if (step.letter) {
    const lp = path.join(cwd, scenario.letterPath || '.loop/letter.md');
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(lp, step.letter.trim() + '\n');
    say(`⚙ Write .loop/letter.md`);
    if (delay) await wait(delay);
  }
  for (const line of step.then || []) {
    say(line);
    if (delay) await wait(delay);
  }
  if (step.ask) say(`<loop:ask>${step.ask}</loop:ask>`);
  if (step.handoff) say(`<loop:handoff>${step.handoff}</loop:handoff>`);
  if (step.stuck) say(`<loop:stuck>${step.stuck}</loop:stuck>`);
  if (step.sleep) say(`<loop:sleep>${step.sleep}</loop:sleep>`);
  if (step.reject) say(`<loop:reject>${step.reject}</loop:reject>`);
  if (step.approve) say('<loop:approve/>');
  if (step.done) say('<loop:done/>');
  process.exit(Number(step.exit ?? 0));
};

run();
