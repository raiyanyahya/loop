import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runLoop } from './runner.js';
import { findLoopfile, resolveLoopfile, parseLoopfile, normalizeConfig, LOOPFILE_NAMES } from './loopfile.js';
import { AGENTS, agentNames, detectAgents, agentPath, PREFERRED_ORDER } from './agents.js';
import { readState, listRuns, readRun, requestStop, writeAnswer, paths } from './journal.js';
import { buildReport } from './report.js';
import { listTemplates, renderTemplate, TEMPLATE_INFO, KINDS } from './templates.js';
import { ensureGitignore } from './git.js';
import { ui } from './render.js';
import { color as c, fmtDuration, fmtMoney, readIfExists, runShell, pidAlive, isTTY, truncate, exists } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

const HELP = `
  ${c.bold(c.cyan('⟲ loop'))} ${c.dim('v' + VERSION)}  ${c.dim('loop engineering for AI agents')}

  ${c.bold('Usage')}
    loop init [template]        write a LOOP.md here (interactive; --list shows templates)
    loop run [LOOP.md | name]   run the loop (default: ./LOOP.md; "name" finds loops/name.md)
    loop run -p "prompt"        run an ad-hoc loop without a file
    loop demo                   watch a loop work, no API key needed
    loop status                 what the current/last loop is doing
    loop log                    iteration-by-iteration timeline of the last run
    loop report [--open]        build a shareable HTML report of the last run
    loop stop [--now]           stop a running loop (after its iteration, or now)
    loop answer "text"          answer a question the agent asked with <loop:ask>
    loop letter [--clear]       show (or clear) the letter passed between iterations
    loop doctor                 check installed agents and configuration

  ${c.bold('Run options')}
    --agent <name>     claude | codex | gemini | aider | opencode | goose | copilot | amp | cursor
    --model <name>     model to pass to the agent
    --until <cond>     done | checklist | never | "<shell command>"   (repeatable)
    --metric <cmd>     a command that prints a number; --direction min|max; --target <n>
    --critic <agent>   an independent reviewer before "done" counts (or "same")
    --permissions <p>  bypass (default) | edits (file edits only, no shell) | default (the agent's own)
    --max <n>          max iterations            --max-time <dur>   e.g. 8h
    --max-cost <usd>   stop at this spend (claude)   --sleep <dur>  pause between iterations
    --once             run one iteration only   --dry              print the prompt + command, run nothing
    --fresh            forget the letter first  --quiet            headers only, no agent output

  ${c.bold('The loop protocol')} ${c.dim('(what the agent writes, on its own line)')}
    <loop:done/>  <loop:stuck>why</loop:stuck>  <loop:ask>question</loop:ask>  <loop:handoff>codex</loop:handoff>
    ${c.dim('critic:')} <loop:approve/>  <loop:reject>reasons</loop:reject>

  ${c.dim('docs: README.md · try it now: loop demo')}
`;

export async function main(argv) {
  const { cmd, args, flags } = parseArgs(argv);
  if (flags.version || flags.v) {
    process.stdout.write(`loop ${VERSION}\n`);
    return 0;
  }
  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  const cwd = process.cwd();
  switch (cmd) {
    case 'init':
      return cmdInit(cwd, args, flags);
    case 'run':
      return cmdRun(cwd, args, flags);
    case 'demo':
      return cmdDemo(cwd, flags);
    case 'status':
      return cmdStatus(cwd, flags);
    case 'log':
      return cmdLog(cwd, args, flags);
    case 'report':
      return cmdReport(cwd, args, flags);
    case 'stop':
      return cmdStop(cwd, flags);
    case 'answer':
      return cmdAnswer(cwd, args);
    case 'letter':
      return cmdLetter(cwd, flags);
    case 'doctor':
      return cmdDoctor(cwd, flags);
    case 'templates':
      return cmdTemplates();
    case 'kinds':
      return cmdTemplates();
    default:
      if (cmd.endsWith('.md') && exists(path.resolve(cwd, cmd))) return cmdRun(cwd, [cmd], flags);
      throw new Error(`unknown command "${cmd}". Run "loop --help".`);
  }
}

// ---------------------------------------------------------------- run

async function cmdRun(cwd, args, flags) {
  const overrides = {
    agent: flags.agent,
    model: flags.model,
    until: flags.until,
    max: flags.max !== undefined ? Number(flags.max) : undefined,
    max_time: flags['max-time'],
    max_cost: flags['max-cost'] !== undefined ? Number(flags['max-cost']) : undefined,
    sleep: flags.sleep,
    name: flags.name,
    stall: flags.stall !== undefined ? Number(flags.stall) : undefined,
    metric: flags.metric,
    direction: flags.direction,
    target: flags.target !== undefined ? Number(flags.target) : undefined,
    keep: flags.keep,
    critic: flags.critic,
    protect: flags.protect,
    memory: flags.memory,
    notify: flags.notify,
    permissions: flags.permissions,
  };
  const runFlags = { dry: Boolean(flags.dry), once: Boolean(flags.once), fresh: Boolean(flags.fresh), quiet: Boolean(flags.quiet || flags.q) };

  if (flags.p !== undefined || flags.prompt !== undefined) {
    const prompt = String(flags.p ?? flags.prompt);
    if (!prompt.trim()) throw new Error('empty prompt');
    const r = await runLoop({ cwd, inlinePrompt: prompt, overrides, flags: runFlags, version: VERSION });
    return r.exitCode;
  }

  const target = args[0] ? resolveLoopfile(cwd, args[0]) : findLoopfile(cwd);
  if (!target) {
    throw new Error(args[0] ? `no Loopfile found for "${args[0]}" (tried the path, ${args[0]}.md, loops/${args[0]}.md)` : `no ${LOOPFILE_NAMES[0]} here. Create one with "loop init", or run an ad-hoc loop: loop run -p "your goal"`);
  }
  const r = await runLoop({ cwd, loopfilePath: target, overrides, flags: runFlags, version: VERSION });
  return r.exitCode;
}

// ---------------------------------------------------------------- init

async function cmdInit(cwd, args, flags) {
  if (flags.list) return cmdTemplates();
  let template = args[0] || flags.template || null;
  if (flags.kind) {
    if (!KINDS[flags.kind]) throw new Error(`unknown kind "${flags.kind}" (finish, optimize, maintain, research)`);
    template = template || KINDS[flags.kind].template;
  }
  if (template && !listTemplates().includes(template)) throw new Error(`unknown template "${template}". Available: ${listTemplates().join(', ')}`);
  const target = path.join(cwd, flags.out || 'LOOP.md');
  if (exists(target) && !flags.force) throw new Error(`${path.basename(target)} already exists (use --force to overwrite)`);

  const detected = detectAgents();
  const vars = {
    name: flags.name || slug(path.basename(cwd)),
    agent: flags.agent || detected[0] || 'claude',
    goal: flags.goal || '',
    test: flags.test || guessTestCommand(cwd),
    metric: flags.metric || '',
    direction: flags.direction || 'max',
    protect: flags.protect || guessProtect(cwd),
  };

  const interactive = isTTY && process.stdin.isTTY && !flags.yes && !flags.y;
  if (interactive) {
    ui.banner(VERSION);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q, def) => new Promise((r) => rl.question(`  ${q}${def ? c.dim(` [${def}]`) : ''} `, (a) => r(a.trim() || def || '')));
    if (!template) {
      const kinds = Object.keys(KINDS);
      process.stdout.write(`  ${c.bold('What kind of loop?')}\n`);
      kinds.forEach((k, i) => process.stdout.write(`    ${c.cyan(String(i + 1))}  ${k.padEnd(9)} ${c.dim(KINDS[k].blurb)}\n`));
      process.stdout.write(`    ${c.cyan(String(kinds.length + 1))}  ${'full'.padEnd(9)} ${c.dim(TEMPLATE_INFO['plan-build'])}\n\n`);
      const pick = await ask('Kind?', '1');
      const idx = Number(pick) - 1;
      template = idx === kinds.length ? 'plan-build' : KINDS[kinds[idx]] ? KINDS[kinds[idx]].template : KINDS[pick] ? KINDS[pick].template : 'default';
      process.stdout.write('\n');
    }
    process.stdout.write(`  ${c.dim(`template: ${template} — ${TEMPLATE_INFO[template]}`)}\n\n`);
    vars.name = await ask('Loop name?', vars.name);
    const agentHint = detected.length ? `installed: ${detected.join(', ')}` : 'none detected!';
    vars.agent = (await ask(`Agent? ${c.dim(`(${agentHint})`)}`, vars.agent)).toLowerCase();
    if (!flags.goal) vars.goal = await ask(template === 'optimize' ? 'What should get better, and what must stay correct?' : 'What should the loop achieve?', '');
    if (['tdd', 'fix-ci', 'checklist', 'relay', 'plan-build'].includes(template)) vars.test = await ask('Test command?', vars.test);
    if (template === 'optimize') {
      vars.metric = await ask('Metric command? (prints a number)', vars.metric || 'node bench.js');
      vars.direction = (await ask('Better is? (min/max)', 'max')).toLowerCase() === 'min' ? 'min' : 'max';
    }
    if (['tdd', 'fix-ci', 'checklist', 'relay', 'plan-build', 'optimize', 'overnight'].includes(template)) vars.protect = await ask('Protected files? (glob the agent must not edit)', vars.protect);
    rl.close();
    process.stdout.write('\n');
  }
  template = template || 'default';

  fs.writeFileSync(target, renderTemplate(template, vars));
  const gi = ensureGitignore(cwd);
  ui.step(`wrote ${c.bold(path.relative(cwd, target))} ${c.dim(`(template: ${template})`)}`);
  if (gi) ui.step(`added .loop/ to .gitignore`);
  if (!vars.goal) ui.step(`edit the ${c.bold('Goal')} section, then run ${c.cyan('loop run')}`);
  else ui.step(`now run ${c.cyan('loop run')}${vars.agent && !agentPath(vars.agent) && vars.agent !== 'fake' ? c.yellow(`  (note: "${vars.agent}" is not installed yet)`) : ''}`);
  process.stdout.write('\n');
  return 0;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loop';
}

function guessProtect(cwd) {
  for (const d of ['test', 'tests', '__tests__', 'spec']) if (exists(path.join(cwd, d))) return `${d}/**`;
  return 'test/**';
}

function guessTestCommand(cwd) {
  const pkg = readIfExists(path.join(cwd, 'package.json'));
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      if (j.scripts && j.scripts.test && !/no test specified/.test(j.scripts.test)) return 'npm test';
    } catch {
      /* ignore */
    }
  }
  if (exists(path.join(cwd, 'Cargo.toml'))) return 'cargo test';
  if (exists(path.join(cwd, 'go.mod'))) return 'go test ./...';
  if (exists(path.join(cwd, 'pyproject.toml')) || exists(path.join(cwd, 'pytest.ini')) || exists(path.join(cwd, 'setup.py'))) return 'pytest';
  if (exists(path.join(cwd, 'Makefile'))) return 'make test';
  if (exists(path.join(cwd, 'Gemfile'))) return 'bundle exec rspec';
  return 'npm test';
}

function cmdTemplates() {
  process.stdout.write(`\n  ${c.bold('kinds')}\n`);
  for (const [k, v] of Object.entries(KINDS)) process.stdout.write(`  ${c.bold(k.padEnd(11))} ${c.dim(v.blurb)}  ${c.dim(`(loop init --kind ${k})`)}\n`);
  process.stdout.write(`\n  ${c.bold('templates')}\n`);
  for (const t of listTemplates()) process.stdout.write(`  ${c.bold(t.padEnd(11))} ${c.dim(TEMPLATE_INFO[t])}\n`);
  process.stdout.write(`\n  ${c.dim('loop init <template>')}\n\n`);
  return 0;
}

// ---------------------------------------------------------------- demo

async function cmdDemo(cwd, flags) {
  const dir = flags.dir ? path.resolve(cwd, flags.dir) : fs.mkdtempSync(path.join(os.tmpdir(), 'loop-demo-'));
  fs.mkdirSync(dir, { recursive: true });
  const quick = Boolean(flags.quick);
  const delay = quick ? 0 : 350;

  fs.writeFileSync(
    path.join(dir, 'test.js'),
    `import { greet, shout } from './greet.js';
let fails = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) fails++; };
check('greet("world") === "Hello, world!"', greet('world') === 'Hello, world!');
check('shout("hi") === "HI!"', shout('hi') === 'HI!');
process.exit(fails ? 1 : 0);
`,
  );
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "loop-demo", "type": "module", "private": true }\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.loop/\n');
  const scenarioPath = path.join(dir, '.loop', 'demo-scenario.json');
  fs.mkdirSync(path.dirname(scenarioPath), { recursive: true });
  const scenario = {
    delay,
    critic: [{}, {}, { say: ['Read the diff against the goal. greet() and shout() match test.js, the README documents both, no stubs, tests untouched.'], approve: true }],
    iterations: [
      {
        say: ['No letter yet, so this is the first iteration. The checklist has three open items and `node test.js` fails on both functions.', 'Starting with greet(), the smallest slice.'],
        write: { 'greet.js': "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n" },
        check: 1,
        letter: 'Implemented greet() in greet.js and ticked the first checklist item.\nNext: shout() — test.js expects uppercase + "!". Then the README.\nAvoid: do not touch test.js, it is the spec.',
        then: ['greet() is in and ticked. Leaving shout() for the next iteration so the tree stays green-ish.'],
      },
      {
        say: ['The letter says shout() is next and test.js is the spec. Adding it.'],
        append: { 'greet.js': '\nexport function shout(s) {\n  return `${s.toUpperCase()}!`;\n}\n' },
        check: 1,
        letter: 'Added shout(). Both functions pass test.js. Ticked item 2.\nRemaining: the README item. Actually I think we are done.',
        then: ['Both functions pass. I believe the work is complete.'],
        done: true,
      },
      {
        say: ['The loop rejected my "done": one checklist item is still open (the README). Fair — writing it now.'],
        write: { 'README.md': '# loop demo\n\nA tiny greeting library, built by a loop.\n\n- `greet(name)` → `Hello, name!`\n- `shout(s)` → `S!`\n' },
        check: 1,
        letter: 'Wrote README.md and ticked the last item. All three items are done and node test.js passes.\nNothing left to do.',
        done: true,
      },
    ],
  };
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));
  fs.writeFileSync(
    path.join(dir, 'LOOP.md'),
    `---
name: demo
agent: fake
until: [checklist, "node test.js"]
critic: same
protect: [test.js]
git: true
max: 6
env:
  LOOP_FAKE_SCENARIO: ${JSON.stringify(scenarioPath)}
---

# Goal

Build a tiny greeting library in \`greet.js\` so that \`node test.js\` passes.

# Checklist

- [ ] Implement \`greet(name)\`
- [ ] Implement \`shout(s)\`
- [ ] Write a README
`,
  );

  if (!flags.quiet) {
    process.stdout.write(`\n  ${c.bold('Demo:')} a scripted fake agent runs a real loop in ${c.dim(dir)}\n`);
    process.stdout.write(`  ${c.dim('Watch for: the letter carried between iterations, the checklist being ticked, the loop')}\n  ${c.dim('rejecting a premature "done" in iteration 2, and the critic reviewing before done counts.')}\n`);
  }
  // A git repo makes the demo complete: protected files can be restored and kept iterations committed.
  const gitEnv = { GIT_AUTHOR_NAME: 'loop demo', GIT_AUTHOR_EMAIL: 'demo@loop', GIT_COMMITTER_NAME: 'loop demo', GIT_COMMITTER_EMAIL: 'demo@loop' };
  const g = await runShell('git init -q && git add -A && git commit -qm "demo baseline"', { cwd: dir, env: gitEnv, timeout: 20000 });
  if (g.code !== 0) fs.writeFileSync(path.join(dir, 'LOOP.md'), fs.readFileSync(path.join(dir, 'LOOP.md'), 'utf8').replace('git: true\n', ''));
  const prev = process.cwd();
  process.chdir(dir);
  const prevEnv = {};
  for (const [k, v] of Object.entries(gitEnv)) {
    prevEnv[k] = process.env[k];
    if (!process.env[k]) process.env[k] = v;
  }
  try {
    const r = await runLoop({ cwd: dir, loopfilePath: path.join(dir, 'LOOP.md'), flags: { quiet: Boolean(flags.quiet) }, version: VERSION });
    if (!flags.quiet) {
      process.stdout.write(`  ${c.dim('Next:')} ${c.cyan('loop init')} in your own project, or read the demo's journal:\n  ${c.dim(`cd ${dir} && loop log`)}\n\n`);
    }
    return r.exitCode;
  } finally {
    process.chdir(prev);
    for (const [k, v] of Object.entries(prevEnv)) if (v === undefined) delete process.env[k];
  }
}

// ---------------------------------------------------------------- status / log / report

function cmdStatus(cwd, flags) {
  const st = readState(cwd);
  if (!st) {
    process.stdout.write(`\n  no loop has run in this directory yet ${c.dim('(loop init, then loop run)')}\n\n`);
    return 1;
  }
  const alive = st.status === 'running' && pidAlive(st.pid);
  const status = st.status === 'running' && !alive ? 'crashed' : st.status;
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...st, status }, null, 2) + '\n');
    return 0;
  }
  const colorize = status === 'done' ? c.green : status === 'running' ? c.cyan : c.yellow;
  process.stdout.write('\n');
  ui.kv([
    ['loop', c.bold(st.name)],
    ['status', colorize(status) + (st.reason ? c.dim(`  ${st.reason}`) : '')],
    ['iteration', `${st.iteration}${st.max ? ` / ${st.max}` : ''}`],
    ['agent', (st.lastAgent || (st.agents || []).join(' → ')) + ''],
    ['started', `${st.startedAt}${st.endedAt ? c.dim(`  → ${st.endedAt}`) : ''}`],
    ...(st.cost ? [['cost', fmtMoney(st.cost)]] : []),
    ...(st.metric ? [['metric', `${st.metric.best ?? '?'} ${c.dim(`(baseline ${st.metric.baseline ?? '?'} · ${st.kept || 0} kept · ${st.reverted || 0} reverted)`)}`]] : []),
    ...(alive ? [['pid', String(st.pid)]] : []),
    ...(st.workDir && st.workDir !== st.cwd ? [['workdir', st.workDir]] : []),
    ...(st.question ? [['question', c.yellow(st.question)]] : []),
    ...(st.lastLetter ? [['letter', truncate(st.lastLetter.split('\n')[0], 90)]] : []),
    ['run', st.runId],
  ]);
  if (status === 'waiting') process.stdout.write(`  answer with  ${c.cyan('loop answer "..."')}  then  ${c.cyan('loop run')}\n\n`);
  return 0;
}

function cmdLog(cwd, args, flags) {
  const runs = listRuns(cwd);
  if (!runs.length) {
    process.stdout.write('\n  no runs yet\n\n');
    return 1;
  }
  if (flags.runs) {
    for (const r of runs) process.stdout.write(`  ${r}\n`);
    return 0;
  }
  const run = readRun(cwd, args[0] || flags.run || runs.at(-1));
  if (!run) throw new Error('run not found');
  const s = run.start || {};
  process.stdout.write(`\n  ${c.bold(c.cyan('⟲ ' + (s.name || 'loop')))} ${c.dim(run.runId)}  ${c.dim(`${(s.agents || []).join(' → ')} · until ${(s.until || []).join(' AND ')}`)}\n\n`);
  const rows = run.iterations.map((it) => [
    `#${it.n}`,
    it.agent + (it.ritual ? c.magenta(' ✦') : ''),
    fmtDuration(it.ms || 0),
    `${(it.changed || []).length} files`,
    typeof it.cost === 'number' ? fmtMoney(it.cost) : '',
    it.metric !== null && it.metric !== undefined ? String(it.metric) : '',
    it.result === 'reverted' ? c.red('reverted') : it.result === 'kept' ? c.green('kept') : c.dim(it.result || ''),
    it.critic ? (it.critic.verdict === 'approved' ? c.green('critic ✓') : it.critic.verdict === 'rejected' ? c.yellow('critic ✗') : c.dim('critic ?')) : '',
    it.satisfied ? c.green('done') : it.signals?.some((x) => x.tag === 'done') ? c.yellow('done rejected') : it.signals?.some((x) => x.tag === 'stuck') ? c.red('stuck') : it.signals?.some((x) => x.tag === 'ask') ? c.yellow('asked') : c.dim('continue'),
    c.dim(truncate(it.letter || '', 50)),
  ]);
  const widths = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] || 0, stripAnsi(cell).length)));
  for (const r of rows) process.stdout.write('  ' + r.map((cell, i) => cell + ' '.repeat(widths[i] - stripAnsi(cell).length)).join('  ') + '\n');
  const e = run.end;
  if (e) process.stdout.write(`\n  ${e.status === 'done' ? c.green('✓ done') : c.yellow('■ ' + e.status)} ${c.dim(`${e.iterations} iterations · ${fmtDuration(e.elapsedMs || 0)}${e.cost ? ` · ${fmtMoney(e.cost)}` : ''}${e.best !== null && e.best !== undefined ? ` · metric ${e.baseline ?? '?'} → ${e.best}` : ''}${e.reverted ? ` · ${e.reverted} reverted` : ''}${e.reason ? ` · ${e.reason}` : ''}`)}\n`);
  else process.stdout.write(`\n  ${c.cyan('… still running')}\n`);
  process.stdout.write('\n');
  return 0;
}

async function cmdReport(cwd, args, flags) {
  const html = buildReport(cwd, args[0] || flags.run);
  const out = path.resolve(cwd, flags.out || path.join('.loop', 'report.html'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  ui.step(`wrote ${c.bold(path.relative(cwd, out))}`);
  if (flags.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    await runShell(`${opener} ${JSON.stringify(out)}`, { cwd, timeout: 5000 });
  }
  return 0;
}

// ---------------------------------------------------------------- stop / answer / letter

function cmdStop(cwd, flags) {
  const st = readState(cwd);
  if (!st || st.status !== 'running' || !pidAlive(st.pid)) {
    process.stdout.write(`\n  no loop is running here\n\n`);
    return 1;
  }
  if (flags.now) {
    process.kill(st.pid, 'SIGTERM');
    ui.step(`sent SIGTERM to pid ${st.pid}: the current iteration is being killed`);
  } else {
    requestStop(cwd);
    ui.step(`stop requested: the loop will end after iteration ${st.iteration + 1} finishes ${c.dim('(use --now to kill it)')}`);
  }
  return 0;
}

function cmdAnswer(cwd, args) {
  const text = args.join(' ').trim();
  if (!text) throw new Error('usage: loop answer "your answer"');
  writeAnswer(cwd, text);
  const st = readState(cwd);
  ui.step(`answer saved. ${st && st.status === 'waiting' ? `Run ${c.cyan('loop run')} to continue the loop.` : 'The next iteration will see it.'}`);
  return 0;
}

function cmdLetter(cwd, flags) {
  const p = paths(cwd).letter;
  if (flags.clear) {
    try {
      fs.unlinkSync(p);
      ui.step('letter cleared');
    } catch {
      ui.step('no letter to clear');
    }
    return 0;
  }
  const t = readIfExists(p);
  if (t === null) {
    process.stdout.write(`\n  no letter yet ${c.dim('(the agent writes .loop/letter.md at the end of each iteration)')}\n\n`);
    return 1;
  }
  process.stdout.write('\n' + t.trim() + '\n\n');
  return 0;
}

// ---------------------------------------------------------------- doctor

async function cmdDoctor(cwd) {
  ui.banner(VERSION);
  const rows = [['node', process.version + (Number(process.versions.node.split('.')[0]) < 18 ? c.red('  (18+ required)') : c.green('  ok'))]];
  const g = await runShell('git --version', { cwd, timeout: 5000 });
  rows.push(['git', g.code === 0 ? c.green(g.output.trim()) : c.yellow('not found (auto-commit and change tracking degrade gracefully)')]);
  const inClaude = Boolean(process.env.CLAUDECODE);
  if (inClaude) rows.push(['env', c.yellow('running inside a Claude Code session; the loop CLI strips CLAUDE_CODE_* so a nested claude can run')]);
  if (process.env.ANTHROPIC_API_KEY) rows.push(['env', c.dim('ANTHROPIC_API_KEY is set: claude will bill that key instead of your claude.ai login')]);
  ui.kv(rows);

  process.stdout.write(`  ${c.bold('agents')}\n`);
  for (const name of PREFERRED_ORDER) {
    const a = AGENTS[name];
    const p = agentPath(name);
    let version = '';
    if (p) {
      const v = await runShell(`${JSON.stringify(p)} --version`, { cwd, timeout: 8000 });
      version = v.code === 0 ? v.output.trim().split('\n')[0] : '';
    }
    const mark = p ? c.green('●') : c.dim('○');
    const note = p ? `${c.dim(truncate(version, 40))}${a.verified ? '' : c.dim('  (adapter unverified: check "loop run --dry")')}` : c.dim(`install: ${a.install}`);
    process.stdout.write(`  ${mark} ${name.padEnd(9)} ${a.label.padEnd(20)} ${note}\n`);
  }
  process.stdout.write('\n');
  const lf = findLoopfile(cwd);
  if (lf) {
    try {
      const parsed = parseLoopfile(fs.readFileSync(lf, 'utf8'));
      const cfg = normalizeConfig(parsed.config, {}, { defaultName: path.basename(cwd) });
      ui.kv([
        ['loopfile', path.relative(cwd, lf)],
        ['agent', cfg.agents.join(' → ') || (cfg.command ? 'custom' : c.dim('auto: ' + (detectAgents()[0] || 'none!')))],
        ['until', cfg.until.join(' AND ')],
        ['checklist', parsed.checklist.total ? `${parsed.checklist.done}/${parsed.checklist.total}` : c.dim('none')],
      ]);
    } catch (err) {
      ui.error(`Loopfile problem: ${err.message}`);
    }
  } else process.stdout.write(`  ${c.dim('no LOOP.md here')}\n\n`);
  const st = readState(cwd);
  if (st) process.stdout.write(`  last run: ${st.status}${st.reason ? c.dim(` — ${st.reason}`) : ''} ${c.dim(`(${st.runId})`)}\n\n`);
  return 0;
}

// ---------------------------------------------------------------- args

const BOOL_FLAGS = new Set(['dry', 'once', 'fresh', 'quiet', 'q', 'help', 'h', 'version', 'v', 'force', 'yes', 'y', 'list', 'now', 'clear', 'open', 'json', 'quick', 'runs', 'no-prompt']);
const REPEATABLE = new Set(['until', 'protect']);

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      let [key, val] = a.slice(2).split(/=(.*)/s);
      if (key.startsWith('no-') && val === undefined && !BOOL_FLAGS.has(key)) {
        flags[key.slice(3)] = false;
        continue;
      }
      if (val === undefined && !BOOL_FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) val = argv[++i];
      setFlag(flags, key, val === undefined ? true : val);
    } else if (a.startsWith('-') && a.length > 1) {
      const key = a.slice(1);
      if (!BOOL_FLAGS.has(key) && i + 1 < argv.length) setFlag(flags, key, argv[++i]);
      else setFlag(flags, key, true);
    } else positional.push(a);
  }
  const [cmd, ...args] = positional;
  return { cmd, args, flags };
}

function setFlag(flags, key, val) {
  if (REPEATABLE.has(key)) flags[key] = [...(flags[key] || []), val];
  else flags[key] = val;
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}
