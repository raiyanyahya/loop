import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { parseLoopfile, normalizeConfig, untilKinds, describeUntil, matchesAny, parseChecklist } from './loopfile.js';
import { buildInvocation, detectAgents, AGENTS, agentPath } from './agents.js';
import { buildPrompt, buildCriticPrompt } from './prompt.js';
import { parseSignals } from './protocol.js';
import { Journal, readState } from './journal.js';
import * as git from './git.js';
import { notify } from './notify.js';
import { ui, createRenderer } from './render.js';
import { color as c, fmtDuration, fmtMoney, parseDuration, runShell, readIfExists, truncate, isTTY, pidAlive, sha1 } from './util.js';

/**
 * Run a loop to completion. Returns { status, reason, iterations, cost, elapsedMs, exitCode }.
 *   status: done | stuck | waiting | stopped | stalled | failed
 */
export async function runLoop({ cwd, loopfilePath, inlinePrompt, overrides = {}, flags = {}, version = '0' }) {
  const quiet = Boolean(flags.quiet);
  const homeDir = cwd; // where the journal, state, and stop/answer files live
  let workDir = cwd; // where the agent works (a worktree when git.worktree is on)
  const loopfileRel = loopfilePath ? path.relative(cwd, loopfilePath) || path.basename(loopfilePath) : null;
  let loopfileWork = loopfilePath;
  const defaultName = loopfilePath ? path.basename(cwd) : 'loop';
  let lastLoaded = null;

  const loadLoop = () => {
    if (inlinePrompt !== undefined && inlinePrompt !== null) {
      const parsed = parseLoopfile(inlinePrompt);
      lastLoaded = { ...parsed, config: normalizeConfig(parsed.config, overrides, { defaultName }) };
      return lastLoaded;
    }
    const text = readIfExists(loopfileWork);
    if (text === null) {
      if (lastLoaded) return lastLoaded;
      throw new Error(`cannot read ${loopfileWork}`);
    }
    const parsed = parseLoopfile(text);
    lastLoaded = { ...parsed, config: normalizeConfig(parsed.config, overrides, { defaultName }) };
    return lastLoaded;
  };

  let loop = loadLoop();
  let cfg = loop.config;
  if (cfg.cwd) workDir = path.resolve(cwd, cfg.cwd);

  // --- resolve agents (fail fast if one is missing)
  let agents = cfg.agents.length ? cfg.agents : cfg.command ? ['custom'] : detectAgents().slice(0, 1);
  if (!agents.length) {
    throw new Error(`no agent found. Install one (${Object.values(AGENTS).filter((a) => !a.hidden).map((a) => a.bin).join(', ')}) or set "agent:" / "command:" in the Loopfile.`);
  }
  const checkAgent = (a, what) => {
    if (a === 'custom') {
      if (!cfg.command) throw new Error(`${what} "custom" needs a "command:" in the Loopfile`);
      return;
    }
    if (!AGENTS[a]) throw new Error(`unknown ${what} "${a}" (known: ${Object.keys(AGENTS).filter((k) => !AGENTS[k].hidden).join(', ')})`);
    if (!agentPath(a)) throw new Error(`${what} "${a}" is not installed. Install: ${AGENTS[a].install}`);
  };
  for (const a of agents) checkAgent(a, 'agent');
  if (cfg.critic && cfg.critic.agent) checkAgent(cfg.critic.agent, 'critic');

  if (!quiet) {
    ui.banner(version);
    ui.kv([
      ['loop', c.bold(cfg.name)],
      ['agent', agents.length > 1 ? `${agents.join(' -> ')} ${c.dim('(relay)')}` : agents[0] + (cfg.model ? c.dim(` / ${cfg.model}`) : '') + (cfg.sandbox ? c.dim(' / sandboxed') : '')],
      ['until', describeUntil(cfg)],
      ...(cfg.metric ? [['metric', `${cfg.metric} ${c.dim(`(${cfg.direction === 'min' ? 'lower' : 'higher'} is better, keep: ${cfg.keep}${cfg.target !== null ? `, target ${cfg.target}` : ''})`)}`]] : []),
      ...(cfg.critic ? [['critic', `${cfg.critic.agent || agents[0] + ' (fresh session)'} ${c.dim(cfg.critic.when === 'done' ? 'reviews before done is accepted' : `reviews every ${cfg.critic.when}`)}`]] : []),
      ...(cfg.protect.length ? [['protect', cfg.protect.join(', ')]] : []),
      ['guards', `${cfg.max} iterations, ${fmtDuration(cfg.max_time)}${cfg.max_cost != null ? `, ${fmtMoney(cfg.max_cost)}` : ''}${cfg.stall ? `, stall after ${cfg.stall} idle` : ''}${cfg.repeat ? `, same failure x${cfg.repeat}` : ''}`],
      ...(loopfileRel ? [['file', loopfileRel + (loop.checklist.total ? c.dim(`  (${loop.checklist.done}/${loop.checklist.total} ticked)`) : '')]] : []),
      ...(cfg.memory ? [['memory', cfg.memory]] : []),
      ...(cfg.git.commit || cfg.git.worktree ? [['git', `${cfg.git.commit ? 'commit each kept iteration' : ''}${cfg.git.worktree ? ` in a worktree on ${cfg.git.branch}` : cfg.git.branch ? ` on ${cfg.git.branch}` : ''}`]] : []),
      ...(cfg.rituals.length ? [['rituals', cfg.rituals.map((r) => `${r.at ? `at ${r.at}` : `every ${r.every}`}: ${truncate(r.name || r.prompt, 40)}`).join('; ')]] : []),
    ]);
    if (cfg.until.includes('checklist') && !loop.checklist.total) ui.warn('until: checklist, but the Loopfile has no "- [ ]" items. The loop can never finish that way.');
    if (cfg.max_cost != null && !agents.every((a) => AGENTS[a] && AGENTS[a].parse === 'claude')) ui.warn('max_cost only works with agents that report cost (claude). Other agents are unmetered.');
  }

  // --- git setup: worktree, branch, baseline
  let useGit = await git.isRepo(workDir);
  if (cfg.git.worktree) {
    if (!useGit) throw new Error('git.worktree needs a git repository');
    const wt = await git.ensureWorktree(homeDir, cfg.git.branch, path.join('.loop', 'worktrees', cfg.name));
    workDir = wt.path;
    if (loopfilePath && !fs.existsSync(path.join(workDir, loopfileRel))) fs.copyFileSync(loopfilePath, path.join(workDir, loopfileRel));
    if (loopfilePath) loopfileWork = path.join(workDir, loopfileRel);
    if (!quiet) ui.step(`git: ${wt.created ? 'created' : 'reusing'} worktree ${c.dim(path.relative(homeDir, workDir))} on ${cfg.git.branch}`);
  } else if (cfg.git.branch && useGit) {
    const b = await git.ensureBranch(workDir, cfg.git.branch);
    if (b.switched && !quiet) ui.step(`git: ${b.created ? 'created' : 'switched to'} branch ${cfg.git.branch}`);
  }
  if (!useGit && !quiet) {
    if (cfg.git.commit) ui.warn('git.commit is on, but this is not a git repository. Skipping commits.');
    if (cfg.keep !== 'always') ui.warn(`keep: ${cfg.keep} needs git to revert; without it the loop only reports what it would have reverted.`);
    if (cfg.protect.length) ui.warn('protect: needs git to restore files; without it violations are only reported.');
  }

  const startedAt = Date.now();
  const journal = new Journal(homeDir);
  const elapsed = () => Date.now() - startedAt;
  const letterAbs = () => (path.isAbsolute(cfg.letter_path) ? cfg.letter_path : path.join(workDir, cfg.letter_path));
  const readLetter = () => {
    if (!cfg.letter) return null;
    const t = readIfExists(letterAbs());
    return t === null ? null : t.trim();
  };

  const state = {
    name: cfg.name, status: 'running', pid: process.pid, cwd: homeDir, workDir, loopfile: loopfileRel, agents,
    startedAt: new Date(startedAt).toISOString(), iteration: 0, max: cfg.max, cost: 0, reason: null, question: null,
    metric: cfg.metric ? { baseline: null, best: null } : null, kept: 0, reverted: 0,
  };

  const metricState = { baseline: null, best: null };
  const promptArgsFor = (extra) => {
    const contextFiles = cfg.context.map((p) => ({ path: p, text: readIfExists(path.resolve(workDir, p)) ?? '(file not found)' }));
    const memoryText = cfg.memory ? readIfExists(path.resolve(workDir, cfg.memory)) ?? '' : null;
    return { body: loop.body, cfg, loopfileRel, checklist: loop.checklist, contextFiles, memoryText, metric: cfg.metric ? metricState : null, ...extra };
  };

  if (flags.dry) {
    const prompt = buildPrompt(promptArgsFor({ iteration: 1, agent: agents[0], prevAgent: null, elapsedMs: 0, cost: 0, changedFiles: [], letter: readLetter(), answer: null, feedback: [], history: [] }));
    const inv = buildInvocation({ agent: agents[0], cfg, prompt, promptFile: '<promptfile>', iteration: 1, cwd: workDir });
    ui.raw(`${c.dim('-'.repeat(30))} prompt for iteration 1 ${c.dim('-'.repeat(30))}\n\n${prompt}\n${c.dim('-'.repeat(80))}\n`);
    ui.step(`command: ${c.bold(inv.display)}`);
    if (cfg.critic) ui.step(`critic: ${cfg.critic.agent || agents[0]} would review ${cfg.critic.when === 'done' ? 'before done is accepted' : `every ${cfg.critic.when} iterations`}`);
    ui.step(`dry run: nothing was executed`);
    return { status: 'dry', exitCode: 0 };
  }

  const prior = readState(homeDir);
  if (prior && prior.status === 'running' && prior.pid && prior.pid !== process.pid && pidAlive(prior.pid)) {
    throw new Error(`a loop is already running in this directory (pid ${prior.pid}, run ${prior.runId}). Use "loop stop" first.`);
  }
  if (flags.fresh) {
    try {
      fs.unlinkSync(letterAbs());
    } catch {
      /* nothing to clear */
    }
  }
  journal.writeState(state);
  journal.event('start', { name: cfg.name, agents, until: cfg.until, max: cfg.max, loopfile: loopfileRel, cwd: homeDir, workDir, metric: cfg.metric, keep: cfg.keep, critic: cfg.critic ? cfg.critic.agent || 'same' : null, protect: cfg.protect });

  if (useGit && (cfg.keep !== 'always' || cfg.protect.length)) {
    const b = await git.baselineCommit(workDir, `loop(${cfg.name}): baseline before run`);
    if (b && b.sha && !quiet) ui.step(`git: committed baseline ${b.sha} ${c.dim('(uncommitted changes, so keep/revert has a known state)')}`);
    if (b && b.error) throw new Error(`could not commit baseline: ${b.error}`);
  }
  const hookEnvBase = () => ({ LOOP: '1', LOOP_NAME: cfg.name, LOOP_WORKDIR: workDir, ...cfg.env });
  const measure = async () => {
    const r = await runShell(cfg.metric, { cwd: workDir, env: hookEnvBase(), timeout: cfg.check_timeout });
    const value = r.code === 0 ? lastNumber(r.output) : null;
    return { value, code: r.code, output: r.output, ms: r.ms };
  };
  if (cfg.metric) {
    const m = await measure();
    metricState.baseline = m.value;
    metricState.best = m.value;
    state.metric = { ...metricState };
    journal.event('baseline', { metric: m.value, code: m.code });
    if (!quiet) ui.step(`metric baseline: ${m.value === null ? c.yellow(`could not measure (exit ${m.code})`) : c.bold(String(m.value))} ${c.dim(`(${fmtDuration(m.ms)})`)}`);
  }

  // --- signal handling: first Ctrl-C finishes the iteration, second kills the agent
  let stopRequested = null;
  let killChild = () => {};
  const onSigint = () => {
    if (stopRequested) {
      ui.warn('killing the agent now');
      stopRequested = 'killed (Ctrl-C twice)';
      killChild('SIGKILL');
    } else {
      stopRequested = 'interrupted (Ctrl-C)';
      ui.warn('stopping after this iteration; press Ctrl-C again to kill the agent now');
    }
  };
  const onTerm = () => {
    stopRequested = stopRequested || 'terminated';
    killChild('SIGTERM');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onTerm);
  process.on('SIGHUP', onTerm);

  let n = 0;
  let cost = 0;
  let idle = 0;
  let consecutiveFailures = 0;
  let prevAgent = null;
  let nextAgentOverride = null;
  let carriedFeedback = [];
  let rejectedDone = null;
  let revertedInfo = null;
  let violationsInfo = [];
  let extraNotes = [];
  let lastChanged = [];
  let pendingAnswer = null;
  let lastFingerprint = null;
  let repeatCount = 0;
  const checkState = {};
  const history = [];
  let status = 'stopped';
  let reason = null;
  let question = null;

  try {
    for (;;) {
      loop = loadLoop();
      cfg = loop.config;

      // --- guards
      if (stopRequested) {
        reason = stopRequested;
        break;
      }
      if (journal.stopRequested()) {
        reason = 'stop requested (loop stop)';
        break;
      }
      if (n >= cfg.max) {
        reason = `reached max iterations (${cfg.max})`;
        break;
      }
      if (elapsed() >= cfg.max_time) {
        reason = `reached max_time (${fmtDuration(cfg.max_time)})`;
        break;
      }
      if (cfg.max_cost != null && cost >= cfg.max_cost) {
        reason = `reached max_cost (${fmtMoney(cfg.max_cost)})`;
        break;
      }

      n++;
      let agent = nextAgentOverride || agents[(n - 1) % agents.length];
      nextAgentOverride = null;
      const ritual = cfg.rituals.find((r) => r.at === n || (r.at === 'last' && n === cfg.max)) || cfg.rituals.find((r) => r.every && r.at === null && n % r.every === 0) || null;
      if (ritual && ritual.agent && agentPath(ritual.agent)) agent = ritual.agent;

      if (!quiet) ui.iterationHeader({ n, max: cfg.max, agent, elapsedMs: elapsed(), cost });
      if (ritual && !quiet) ui.step(`ritual${ritual.name ? `: ${ritual.name}` : ''} ${c.dim(ritual.at ? `(at ${ritual.at})` : `(every ${ritual.every})`)}`);
      const iterDir = journal.iterDir(n);
      const hookEnv = { ...hookEnvBase(), LOOP_ITERATION: String(n), LOOP_AGENT: agent };

      for (const cmd of cfg.before) {
        const r = await runShell(cmd, { cwd: workDir, env: hookEnv, timeout: cfg.check_timeout });
        if (!quiet) ui.step(`before: ${c.dim(cmd)} -> exit ${r.code}`);
      }

      const feedback = [];
      for (const cmd of cfg.feedback) {
        const r = await runShell(cmd, { cwd: workDir, env: hookEnv, timeout: cfg.check_timeout });
        feedback.push({ cmd, code: r.code, output: r.output, ms: r.ms, timedOut: r.timedOut });
        if (!quiet) ui.step(`feedback: ${c.dim(cmd)} -> exit ${r.code} ${c.dim(`(${fmtDuration(r.ms)})`)}`);
      }
      feedback.push(...carriedFeedback);
      carriedFeedback = [];

      const letter = readLetter();
      const answer = journal.consumeAnswer() || pendingAnswer;
      pendingAnswer = null;

      const prompt = buildPrompt(promptArgsFor({ iteration: n, agent, prevAgent, elapsedMs: elapsed(), cost, changedFiles: lastChanged, letter, answer, feedback, rejectedDone, reverted: revertedInfo, violations: violationsInfo, ritual, history, extraNotes }));
      rejectedDone = null;
      revertedInfo = null;
      violationsInfo = [];
      extraNotes = [];
      const promptFile = path.join(iterDir, 'prompt.md');
      fs.writeFileSync(promptFile, prompt);

      const loopfileBefore = loopfileWork ? readIfExists(loopfileWork) : null;
      const before = await git.snapshot(workDir, useGit);
      const inv = buildInvocation({ agent, cfg, prompt, promptFile, iteration: n, cwd: workDir });
      if (!quiet) ui.step(`${c.bold(agent)}${cfg.model ? c.dim(` / ${cfg.model}`) : ''} ${c.dim(`(${truncate(inv.display, 70)})`)}`);
      journal.event('spawn', { n, agent, command: inv.display });

      const t0 = Date.now();
      const res = await runAgent(inv, { cwd: workDir, timeout: cfg.timeout, quiet, setKill: (k) => (killChild = k) });
      killChild = () => {};
      const ms = Date.now() - t0;
      fs.writeFileSync(path.join(iterDir, 'output.txt'), res.all);

      const after = await git.snapshot(workDir, useGit);
      let { files: changed } = git.diffSnapshots(before, after);
      const attempted = changed.slice();

      // --- integrity: protected files and the checklist text
      const violations = changed.filter((f) => cfg.protect.length && matchesAny(f, cfg.protect) && f !== loopfileRel);
      if (violations.length) {
        const restored = useGit ? await git.restoreFiles(workDir, violations) : [];
        changed = changed.filter((f) => !restored.includes(f));
        violationsInfo = violations;
        if (!quiet) ui.warn(`protected files modified: ${violations.join(', ')}${restored.length ? ' (restored)' : ' (cannot restore without git)'}`);
      }
      let checklistRestored = false;
      if (loopfileWork && loopfileBefore !== null) {
        const fixed = enforceChecklist(loopfileBefore, readIfExists(loopfileWork));
        if (fixed !== null) {
          fs.writeFileSync(loopfileWork, fixed);
          checklistRestored = true;
          if (!quiet) ui.warn('checklist items were added, removed, or reworded; restored the original list and kept legitimate ticks');
        }
      }

      const letterAfter = readLetter();
      if (letterAfter) fs.writeFileSync(path.join(iterDir, 'letter.md'), letterAfter + '\n');
      const sig = parseSignals(res.text);
      if (typeof res.cost === 'number') cost += res.cost;

      for (const cmd of cfg.after) {
        const r = await runShell(cmd, { cwd: workDir, env: { ...hookEnv, LOOP_CHANGED: changed.join('\n') }, timeout: cfg.check_timeout });
        if (!quiet) ui.step(`after: ${c.dim(cmd)} -> exit ${r.code}`);
      }

      if (!quiet) {
        const bits = [`${changed.length} file${changed.length === 1 ? '' : 's'} changed`, fmtDuration(ms)];
        if (typeof res.cost === 'number') bits.push(fmtMoney(res.cost));
        if (res.toolCalls) bits.push(`${res.toolCalls} tool calls`);
        if (res.timedOut) bits.push(c.yellow('timed out'));
        else if (res.code !== 0) bits.push(c.yellow(`exit ${res.code}`));
        ui.step(bits.join(', ') + (changed.length ? c.dim(`  ${truncate(changed.join(', '), 80)}`) : ''));
        if (letterAfter) ui.step(`letter: ${c.italic(truncate(firstLine(letterAfter), 100))}`);
        else if (cfg.letter && res.code === 0) ui.warn('the agent left no letter');
        for (const note of sig.notes) ui.step(`note: ${note}`);
      }
      for (const note of sig.notes) journal.event('note', { n, text: note });

      // --- verify
      loop = loadLoop();
      const verdict = await evaluateUntil(loop.config, { sig, checklist: loop.checklist }, { cwd: workDir, env: hookEnv, quiet });
      let satisfied = verdict.satisfied;
      const failures = verdict.failures.slice();
      carriedFeedback.push(...verdict.feedback);
      extraNotes.push(...verdict.notes);
      if (violations.length) {
        satisfied = false;
        failures.push(`protected files were modified (${violations.join(', ')})`);
      }
      if (checklistRestored) {
        satisfied = false;
        failures.push('the checklist was altered and had to be restored');
        extraNotes.push('You changed the checklist text last iteration. The loop restored it. Only tick boxes; never edit the items.');
      }

      let metricValue = null;
      let metricImproved = false;
      if (cfg.metric) {
        const m = await measure();
        metricValue = m.value;
        if (m.value === null) {
          if (!quiet) ui.step(`metric: ${c.yellow(`could not measure (exit ${m.code})`)}`);
          carriedFeedback.push({ cmd: cfg.metric, code: m.code, output: m.output, ms: m.ms });
        } else {
          const best = metricState.best;
          metricImproved = best === null || (cfg.direction === 'min' ? m.value < best : m.value > best);
          if (!quiet) ui.step(`metric: ${c.bold(String(m.value))} ${metricImproved ? c.green(best === null ? '(first measurement)' : `(improved from ${best})`) : c.dim(`(best ${best})`)}`);
        }
      }

      // --- keep or revert
      let result = changed.length ? 'kept' : 'no change';
      let revertReason = null;
      if (cfg.keep !== 'always' && changed.length) {
        const regressed = verdict.checks.filter((k) => checkState[k.cmd] === 'pass' && k.code !== 0).map((k) => k.cmd);
        if (regressed.length) revertReason = `a check that used to pass now fails (${regressed.join(', ')})`;
        else if (cfg.metric) {
          if (metricValue === null) revertReason = 'the metric could not be measured';
          else if (metricState.best !== null) {
            const worse = cfg.direction === 'min' ? metricValue > metricState.best : metricValue < metricState.best;
            if (cfg.keep === 'improve' && !metricImproved) revertReason = `the metric did not improve (${metricValue} vs best ${metricState.best})`;
            if (cfg.keep === 'no-regress' && worse) revertReason = `the metric regressed (${metricValue} vs best ${metricState.best})`;
          }
        }
      }
      let commit = null;
      if (revertReason && useGit) {
        await git.revertToHead(workDir);
        result = 'reverted';
        revertedInfo = { n, reason: revertReason };
        satisfied = false;
        failures.push(`the iteration was reverted: ${revertReason}`);
        state.reverted++;
        if (!quiet) ui.step(`${c.yellow('reverted')}: ${revertReason}`);
      } else {
        if (revertReason && !quiet) ui.warn(`would have reverted (${revertReason}), but there is no git repository`);
        if (metricValue !== null && metricImproved) metricState.best = metricValue;
        for (const k of verdict.checks) checkState[k.cmd] = k.code === 0 ? 'pass' : 'fail';
        if (cfg.git.commit && useGit && changed.length) {
          const summaryLine = firstLine(letterAfter) || firstLine(res.text) || `iteration ${n}`;
          commit = await git.commitAll(workDir, `loop(${cfg.name} #${n}): ${truncate(summaryLine, 72)}`);
          if (commit && commit.sha && !quiet) ui.step(`git: committed ${commit.sha}`);
          if (commit && commit.error && !quiet) ui.warn(`git commit failed: ${truncate(commit.error, 200)}`);
        }
        if (changed.length) state.kept++;
      }
      state.metric = cfg.metric ? { ...metricState } : null;

      let targetReached = false;
      if (cfg.metric && cfg.target !== null && metricState.best !== null) {
        targetReached = cfg.direction === 'min' ? metricState.best <= cfg.target : metricState.best >= cfg.target;
        if (targetReached) satisfied = true;
      }

      // --- the critic: a second opinion, in its own session, before done counts
      let critic = null;
      const wantCritic = cfg.critic && result !== 'reverted' && ((satisfied && !targetReached) || (typeof cfg.critic.when === 'number' && n % cfg.critic.when === 0));
      if (wantCritic) {
        const criticAgent = cfg.critic.agent || agent;
        const cPrompt = buildCriticPrompt({ body: loop.body, cfg, iteration: n, workerAgent: agent, changedFiles: changed, diff: useGit ? await git.diffForReview(workDir) : '', letter: letterAfter, checks: verdict.checks, claimedDone: sig.done || satisfied, metric: cfg.metric ? { value: metricValue, best: metricState.best } : null });
        const cPromptFile = path.join(iterDir, 'critic-prompt.md');
        fs.writeFileSync(cPromptFile, cPrompt);
        const cInv = buildInvocation({ agent: criticAgent, cfg: { ...cfg, model: cfg.critic.model || cfg.model }, prompt: cPrompt, promptFile: cPromptFile, iteration: n, role: 'critic', cwd: workDir });
        if (!quiet) ui.step(`${c.bold('critic')} ${c.dim(`(${criticAgent})`)}`);
        const cBefore = await git.snapshot(workDir, useGit);
        const ct0 = Date.now();
        const cres = await runAgent(cInv, { cwd: workDir, timeout: cfg.timeout, quiet, setKill: (k) => (killChild = k) });
        killChild = () => {};
        fs.writeFileSync(path.join(iterDir, 'critic-output.txt'), cres.all);
        if (typeof cres.cost === 'number') cost += cres.cost;
        const cAfter = await git.snapshot(workDir, useGit);
        const cChanged = git.diffSnapshots(cBefore, cAfter).files;
        if (cChanged.length) {
          const restored = useGit && cfg.git.commit ? await git.restoreFiles(workDir, cChanged) : [];
          if (!quiet) ui.warn(`the critic modified files (${cChanged.join(', ')})${restored.length ? ' (restored)' : ''}`);
        }
        const csig = parseSignals(cres.text);
        const verdictWord = csig.reject ? 'rejected' : csig.approve ? 'approved' : 'no verdict';
        critic = { agent: criticAgent, verdict: verdictWord, text: csig.reject || cres.text.trim(), ms: Date.now() - ct0, cost: cres.cost ?? null };
        journal.event('critic', { n, agent: criticAgent, verdict: verdictWord, reasons: csig.reject || null, ms: critic.ms, cost: critic.cost });
        if (!quiet) ui.step(`critic: ${csig.reject ? c.yellow('rejected') : csig.approve ? c.green('approved') : c.yellow('no clear verdict (treated as approval)')}${csig.reject ? c.dim('  ' + truncate(csig.reject.replace(/\s+/g, ' '), 90)) : ''}`);
        if (csig.reject) {
          satisfied = false;
          failures.push('the critic rejected the work');
          carriedFeedback.push({ kind: 'critic', agent: criticAgent, verdict: 'rejected', text: csig.reject });
        } else if (typeof cfg.critic.when === 'number' && cres.text.trim()) {
          carriedFeedback.push({ kind: 'critic', agent: criticAgent, verdict: 'approved', text: truncate(cres.text.trim(), 3000) });
        }
      }

      // --- same failure, again and again?
      const failing = verdict.checks.filter((k) => k.code !== 0);
      const fingerprint = failing.length ? sha1(failing.map((k) => k.cmd + '\n' + normalizeOutput(k.output)).join('\n---\n')) : null;
      if (fingerprint && fingerprint === lastFingerprint) repeatCount++;
      else repeatCount = fingerprint ? 1 : 0;
      lastFingerprint = fingerprint;

      const checksSummary = verdict.checks.length ? (failing.length ? `${failing.length}/${verdict.checks.length} failing` : 'pass') : '-';
      history.push({ n, agent, changed: attempted.length, checks: checksSummary, metric: metricValue, result: [result, critic ? `critic ${critic.verdict}` : null, violations.length ? 'protected restored' : null, sig.done && !satisfied ? 'done rejected' : null].filter(Boolean).join(', ') });
      lastChanged = result === 'reverted' ? [] : changed;

      journal.event('iteration', {
        n, agent, ms, code: res.code, timedOut: Boolean(res.timedOut), changed, attempted, cost: res.cost ?? null, costTotal: cost,
        signals: sig.raw, satisfied, failures, commit: commit && commit.sha ? commit.sha : null, result, revertReason, metric: metricValue, best: metricState.best,
        violations, checklistRestored, critic: critic ? { agent: critic.agent, verdict: critic.verdict } : null, checks: verdict.checks.map((k) => ({ cmd: k.cmd, code: k.code })),
        letter: letterAfter ? truncate(firstLine(letterAfter), 200) : null, ritual: ritual ? ritual.name || ritual.prompt.slice(0, 40) : null,
      });
      state.iteration = n;
      state.cost = cost;
      state.lastAgent = agent;
      state.lastChanged = changed;
      state.lastLetter = letterAfter ? truncate(letterAfter, 500) : null;
      journal.writeState(state);

      // --- decide
      if (satisfied) {
        if (!quiet) ui.verdict('done', targetReached ? `target ${cfg.target} reached (best ${metricState.best})` : sig.done ? (critic ? 'verified and approved' : '') : '(until conditions met)');
        status = 'done';
        reason = targetReached ? `metric target ${cfg.target} reached` : null;
        break;
      }
      if (sig.stuck) {
        if (!quiet) ui.verdict('stuck', sig.stuck);
        status = 'stuck';
        reason = sig.stuck;
        break;
      }
      if (sig.done) {
        rejectedDone = failures.length ? failures : ['the until conditions are not met yet'];
        if (!quiet) ui.verdict('continue', `done rejected: ${rejectedDone.join('; ')}`);
      } else if (!quiet) ui.verdict('continue', failures.join('; '));
      if (res.authFailed) {
        status = 'failed';
        reason = 'the agent could not authenticate (see output above)';
        break;
      }
      if (sig.ask) {
        if (isTTY && process.stdin.isTTY && !flags.noPrompt) {
          pendingAnswer = await askHuman(sig.ask);
          journal.event('answer', { n, question: sig.ask, answer: pendingAnswer });
        } else {
          status = 'waiting';
          question = sig.ask;
          reason = `the agent has a question: ${sig.ask}`;
          break;
        }
      }
      if (cfg.repeat && repeatCount >= cfg.repeat) {
        status = 'stuck';
        reason = `the same failure repeated ${repeatCount} times in a row (${failing.map((k) => k.cmd).join(', ')})`;
        break;
      }
      if (attempted.length === 0 && res.code === 0) idle++;
      else idle = 0;
      if (cfg.stall && idle >= cfg.stall) {
        status = 'stalled';
        reason = `${idle} iterations in a row changed nothing`;
        break;
      }
      if (res.code !== 0 && !res.text.trim()) consecutiveFailures++;
      else consecutiveFailures = 0;
      if (consecutiveFailures >= 3) {
        status = 'failed';
        reason = 'the agent exited with an error 3 times in a row and produced no output';
        break;
      }
      if (sig.handoff) {
        if (sig.handoff === agent) {
          /* no-op */
        } else if (sig.handoff === 'custom' ? cfg.command : AGENTS[sig.handoff] && agentPath(sig.handoff)) {
          nextAgentOverride = sig.handoff;
          if (!quiet) ui.step(`handoff -> ${c.bold(sig.handoff)}`);
        } else if (!quiet) ui.warn(`handoff to "${sig.handoff}" ignored: not an installed agent`);
      }
      prevAgent = agent;
      if (flags.once) {
        reason = 'ran a single iteration (--once)';
        break;
      }
      const sleepMs = sig.sleep ? parseDuration(sig.sleep, cfg.sleep) : cfg.sleep;
      if (sleepMs > 0 && !stopRequested) {
        if (!quiet) ui.step(`sleeping ${fmtDuration(sleepMs)}`);
        await interruptibleSleep(sleepMs, () => stopRequested || fs.existsSync(journal.p.stop));
      }
    }
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onTerm);
    process.off('SIGHUP', onTerm);
  }

  const elapsedMs = elapsed();
  state.status = status;
  state.reason = reason;
  state.question = question;
  state.endedAt = new Date().toISOString();
  state.pid = null;
  journal.writeState(state);
  journal.event('end', { status, reason, iterations: n, cost, elapsedMs, best: metricState.best, baseline: metricState.baseline, kept: state.kept, reverted: state.reverted });

  const hookEnv = { ...hookEnvBase(), LOOP_STATUS: status, LOOP_REASON: reason || '', LOOP_ITERATIONS: String(n), LOOP_COST: String(cost) };
  for (const cmd of status === 'done' ? cfg.on_done : cfg.on_stop) await runShell(cmd, { cwd: workDir, env: hookEnv, timeout: cfg.check_timeout });
  if (cfg.notify) {
    const ok = await notify(cfg.notify, { loop: cfg.name, status, reason, question, iteration: n, cost, elapsedMs, best: metricState.best, runId: journal.runId });
    if (!ok && !quiet) ui.warn('notify: the webhook did not accept the message');
  }

  if (!quiet) {
    const tally = `${n} iteration${n === 1 ? '' : 's'}, ${fmtDuration(elapsedMs)}${cost ? `, ${fmtMoney(cost)}` : ''}${cfg.metric ? `, metric ${metricState.baseline ?? '?'} -> ${metricState.best ?? '?'}` : ''}${state.reverted ? `, ${state.reverted} reverted` : ''}`;
    if (status === 'done') ui.success(`done after ${tally}`);
    else if (status === 'waiting') {
      ui.stopped(`waiting for you after ${tally}`);
      ui.raw(`  The agent asked: ${c.bold(question)}\n\n  Reply with  ${c.cyan(`loop answer "..."`)}  then  ${c.cyan('loop run')}  to continue.\n\n`);
    } else if (status === 'stuck') {
      ui.stopped(`stuck after ${tally}`);
      ui.raw(`  ${reason}\n\n  Fix what it needs, then  ${c.cyan('loop run')}  to continue (the letter is kept).\n\n`);
    } else ui.stopped(`${status} after ${tally}${reason ? c.dim(` (${reason})`) : ''}`);
    ui.raw(`  ${c.dim(`journal: ${path.relative(homeDir, journal.runDir) || journal.runDir}  |  loop log  |  loop report`)}\n\n`);
  }

  return { status, reason, iterations: n, cost, elapsedMs, best: metricState.best, exitCode: status === 'done' ? 0 : status === 'waiting' ? 3 : status === 'stuck' ? 2 : 1 };
}

async function evaluateUntil(cfg, { sig, checklist }, { cwd, env, quiet }) {
  const failures = [];
  const feedback = [];
  const notes = [];
  const checks = [];
  let satisfied = true;
  for (const u of untilKinds(cfg.until)) {
    if (u.kind === 'never') satisfied = false;
    else if (u.kind === 'done') {
      if (!sig.done) satisfied = false;
    } else if (u.kind === 'checklist') {
      if (!checklist.total || checklist.open.length) {
        satisfied = false;
        failures.push(checklist.total ? `${checklist.open.length} checklist item${checklist.open.length === 1 ? '' : 's'} still open` : 'the Loopfile has no checklist items');
      }
    } else {
      const r = await runShell(u.cmd, { cwd, env, timeout: cfg.check_timeout });
      checks.push({ cmd: u.cmd, code: r.code, output: r.output, ms: r.ms, timedOut: r.timedOut });
      if (!quiet) ui.step(`check: ${c.dim(u.cmd)} -> ${r.code === 0 ? c.green('pass') : c.yellow(r.timedOut ? 'timed out' : `exit ${r.code}`)} ${c.dim(`(${fmtDuration(r.ms)})`)}`);
      if (r.code !== 0) {
        satisfied = false;
        failures.push(`\`${u.cmd}\` exited ${r.code}${r.timedOut ? ' (timed out)' : ''}`);
        feedback.push({ cmd: u.cmd, code: r.code, output: r.output, ms: r.ms, timedOut: r.timedOut });
      } else notes.push(`\`${u.cmd}\` passed after the previous iteration.`);
    }
  }
  return { satisfied, failures, feedback, notes, checks };
}

/**
 * If checklist items were added, removed, or reworded, rebuild the file from the pre-iteration
 * text and re-apply only the ticks whose item text is unchanged. Returns null when nothing is wrong.
 */
export function enforceChecklist(beforeText, afterText) {
  if (afterText === null || afterText === undefined) return null;
  const before = parseChecklist(beforeText).items;
  if (!before.length) return null;
  const after = parseChecklist(afterText).items;
  const key = (items) => items.map((i) => i.text).join('\n');
  if (key(before) === key(after)) return null;
  const tickedAfter = new Set(after.filter((i) => i.done).map((i) => i.text));
  let idx = 0;
  return beforeText.replace(/^([ \t]*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+.*\S)[ \t]*$/gm, (m, pre, mark, rest) => {
    const item = before[idx++];
    const done = mark !== ' ' || (item && tickedAfter.has(item.text));
    return `${pre}[${done ? 'x' : ' '}]${rest}`;
  });
}

function runAgent(inv, { cwd, timeout, quiet, setKill }) {
  return new Promise((resolve) => {
    let child;
    let timedOut = false;
    let authFailed = false;
    const renderer = createRenderer({
      mode: inv.parse,
      quiet,
      cwd,
      onAuthFailure: () => {
        authFailed = true;
        kill('SIGTERM');
      },
    });
    const kill = (sig) => {
      if (!child || child.exitCode !== null) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* gone */
        }
      }
    };
    try {
      child = spawn(inv.file, inv.args, {
        cwd,
        env: inv.env,
        stdio: [inv.input === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      return resolve({ code: 127, error: err.message, timedOut, authFailed, ...renderer.finish() });
    }
    setKill(kill);
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 5000).unref();
    }, timeout);
    child.stdout.on('data', renderer.stdout);
    child.stderr.on('data', renderer.stderr);
    if (inv.input === 'stdin') {
      child.stdin.on('error', () => {});
      child.stdin.end(inv.stdinText);
    }
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, error: err.message, timedOut, authFailed, ...renderer.finish() });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code === null ? (signal ? 128 : 1) : code, signal, timedOut, authFailed, ...renderer.finish() });
    });
  });
}

async function askHuman(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  ui.raw(`\n  ${c.bold(c.yellow('The agent asks:'))} ${q}\n`);
  const answer = await new Promise((r) => rl.question(`  ${c.cyan('your answer >')} `, r));
  rl.close();
  ui.blank();
  return answer.trim() || '(no answer given; use your best judgement)';
}

async function interruptibleSleep(ms, shouldStop) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) return;
    await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
  }
}

/** The first substantive line of a letter or reply: skips headings, salutations, and section labels. */
function firstLine(s) {
  if (!s) return '';
  const raw = String(s).split('\n');
  const clean = (l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
  const usable = (l) => l && !l.startsWith('<loop:') && !/^(letter( to| from)?\b.*|dear\b.*|hi\b.*|hello\b.*)$/i.test(l) && !/^[a-z ]{1,24}:?$/i.test(l);
  const body = raw.filter((l) => !/^\s*#/.test(l)).map(clean).find(usable);
  return body || raw.map(clean).find((l) => l && !l.startsWith('<loop:')) || '';
}

/** The last number printed by a metric command, e.g. "val_bpb: 1.802" -> 1.802. */
export function lastNumber(output) {
  const m = String(output ?? '').match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g);
  if (!m) return null;
  const v = Number(m[m.length - 1]);
  return Number.isFinite(v) ? v : null;
}

function normalizeOutput(s) {
  return String(s ?? '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 3000);
}
