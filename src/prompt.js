import { describeUntil } from './loopfile.js';
import { fmtDuration, fmtMoney, tailLines, truncate } from './util.js';

const MAX_FEEDBACK_LINES = 80;

/**
 * Assemble the worker prompt for one iteration. The Loopfile body comes first (it is the goal),
 * then the loop's own context: status, history, notes, the letter, feedback, and the rules.
 */
export function buildPrompt(o) {
  const {
    body, cfg, iteration, agent, prevAgent, loopfileRel, elapsedMs, cost, changedFiles, checklist, letter, answer,
    feedback, rejectedDone, reverted, violations, ritual, contextFiles, memoryText, history, metric, extraNotes,
  } = o;
  const max = cfg.max;
  const L = [];
  L.push(body.trim());
  L.push('', '---', '');

  if (ritual) {
    L.push(`# loop · ritual${ritual.name ? `: ${ritual.name}` : ''}`, '');
    L.push('This iteration is a **ritual**, not regular work. The goal above is context only. Do exactly this:', '');
    L.push(ritual.prompt.trim(), '');
    L.push('When the ritual is complete, write your letter as usual and stop. The loop returns to the goal next iteration.', '');
    L.push('---', '');
  }

  const mode = cfg.metric ? 'experiment' : cfg.until.includes('never') ? 'improve' : 'finish';
  L.push(`# loop · iteration ${iteration}${max ? ` of ${max}` : ''}`, '');
  L.push(`You are one iteration of an autonomous loop called **${cfg.name}**, run by the loop CLI.`);
  L.push('Each iteration is a fresh session: you remember nothing from earlier iterations except what is written below.');
  if (mode === 'experiment') {
    L.push('This is an **optimisation loop**. Each iteration is one experiment: make one focused change, measure it, and hand off.');
    L.push(`The loop keeps an iteration only if the metric ${cfg.direction === 'min' ? 'goes down' : 'goes up'}; otherwise it reverts your changes and tells the next iteration what was tried.`);
  } else if (mode === 'improve') {
    L.push('This loop has no "done": it runs until its budget is spent. Each iteration, make the single most valuable improvement toward the goal.');
  } else {
    L.push('The loop will run you again after you finish, so you do not have to finish everything now.');
    L.push('Do the most valuable next step, do it properly, verify it, and hand off cleanly.');
  }
  L.push('');

  L.push('## Status');
  L.push(`- Agent: ${agent}${prevAgent && prevAgent !== agent ? ` (the previous iteration ran on ${prevAgent})` : ''}`);
  if (loopfileRel) L.push(`- Loop file: \`${loopfileRel}\` (the goal above lives there)`);
  L.push(`- Elapsed: ${fmtDuration(elapsedMs)}${cost ? ` · spent so far: ${fmtMoney(cost)}` : ''}`);
  L.push(`- The loop finishes when: ${describeUntil(cfg)}`);
  if (iteration > 1) L.push(`- Files changed by the previous iteration: ${changedFiles && changedFiles.length ? truncate(changedFiles.join(', '), 600) : 'none'}`);
  if (checklist && checklist.total) {
    L.push(`- Checklist: ${checklist.done}/${checklist.total} done${checklist.open.length ? `. Open: ${checklist.open.map((t) => `"${truncate(t, 80)}"`).slice(0, 8).join(', ')}${checklist.open.length > 8 ? ', …' : ''}` : ' — all done'}`);
  }
  if (metric) {
    const dir = cfg.direction === 'min' ? 'lower is better' : 'higher is better';
    L.push(`- Metric: \`${cfg.metric}\` (${dir})${metric.best !== null ? ` · best so far: ${metric.best}` : ' · no valid measurement yet'}${cfg.target !== null ? ` · target: ${cfg.target}` : ''}${metric.baseline !== null ? ` · baseline: ${metric.baseline}` : ''}`);
  }
  if (cfg.protect.length) L.push(`- Protected (do not modify): ${cfg.protect.map((p) => `\`${p}\``).join(', ')}`);
  if (cfg.critic) L.push(`- An independent critic${cfg.critic.agent ? ` (${cfg.critic.agent})` : ''} reviews your work${cfg.critic.when === 'done' ? ' before "done" is accepted' : ` every ${cfg.critic.when} iteration(s)`}.`);
  L.push('');

  if (history && history.length) {
    L.push('## History', '');
    L.push('| # | agent | changed | checks | metric | result |', '|---|---|---|---|---|---|');
    for (const h of history.slice(-8)) {
      L.push(`| ${h.n} | ${h.agent} | ${h.changed} file${h.changed === 1 ? '' : 's'} | ${h.checks} | ${h.metric === null || h.metric === undefined ? '—' : h.metric} | ${h.result} |`);
    }
    L.push('');
  }

  if (memoryText !== undefined && memoryText !== null) {
    L.push(`## Notes (\`${cfg.memory}\`)`, '');
    L.push('_Durable knowledge kept across loops: facts about the codebase, gotchas, decisions. Keep it accurate and short._', '');
    L.push(memoryText.trim() || '_(empty so far)_', '');
  }

  if (contextFiles && contextFiles.length) {
    for (const f of contextFiles) L.push(`## Context: \`${f.path}\``, '', '```', f.text.trim(), '```', '');
  }

  L.push(`## Letter from iteration ${iteration - 1}`, '');
  if (letter) L.push('_Written by your previous self. This is the only memory that survives between iterations._', '', letter.trim(), '');
  else if (iteration === 1) L.push('_No letter: this is the first iteration. You are starting fresh._', '');
  else L.push('_The previous iteration did not leave a letter. Look at the history, the files it changed, and the feedback below to infer where things stand._', '');

  if (answer) L.push('## Answer from the human', '', 'You asked a question in an earlier iteration. The human replied:', '', answer.trim(), '');

  if (feedback && feedback.length) {
    L.push('## Feedback', '');
    for (const f of feedback) {
      if (f.kind === 'critic') {
        L.push(`### Review by the critic${f.agent ? ` (${f.agent})` : ''} — ${f.verdict}`, '', f.text.trim(), '');
        continue;
      }
      const status = f.code === 0 ? 'exit 0' : f.timedOut ? 'timed out' : `exit ${f.code}`;
      L.push(`### \`${f.cmd}\` (${status}${f.ms ? `, ${fmtDuration(f.ms)}` : ''})`, '');
      L.push('```', tailLines(f.output || '', f.lines || MAX_FEEDBACK_LINES).trim() || '(no output)', '```', '');
    }
  }

  if (reverted) {
    L.push('## The loop reverted your last iteration', '');
    L.push(`Iteration ${reverted.n} was reverted: ${reverted.reason}.`);
    L.push('The repository is back to the last kept state. The history table above records what was tried; do not repeat it. Try a different idea.', '');
  }

  if (rejectedDone && rejectedDone.length) {
    L.push('## The loop rejected your last "done"', '');
    L.push('Your previous iteration ended with `<loop:done/>`, but the loop could not verify it:', '');
    for (const r of rejectedDone) L.push(`- ${r}`);
    L.push('', 'Keep working. Declare done only when these conditions actually hold.', '');
  }

  if (violations && violations.length) {
    L.push('## Protected files were restored', '');
    L.push(`Your previous iteration modified protected files: ${violations.map((v) => `\`${v}\``).join(', ')}. The loop restored them.`);
    L.push('Protected files are the specification and the verifier; changing them is never the fix. If one is genuinely wrong, say so with `<loop:stuck>` and explain.', '');
  }

  if (extraNotes && extraNotes.length) {
    L.push('## Notes from the loop', '');
    for (const n of extraNotes) L.push(`- ${n}`);
    L.push('');
  }

  L.push('## How to work in a loop', '');
  let n = 1;
  L.push(`${n++}. Read the letter, the history, and the feedback first, then act. Do not re-plan from scratch every iteration; keep momentum.`);
  L.push(`${n++}. Do one thing per iteration and do it completely. Leave the project in a working state: no half-applied changes, nothing broken that used to work.`);
  if (mode === 'experiment') L.push(`${n++}. One experiment per iteration. State your hypothesis in the letter, so a reverted attempt still teaches the next iteration something.`);
  if (cfg.letter) L.push(`${n++}. Before you finish, overwrite \`${cfg.letter_path}\` with a short letter to your next self: what you did, what to do next (most specific first), what to avoid or what surprised you. Under 30 lines. Rewrite it; do not append.`);
  if (cfg.memory) L.push(`${n++}. Keep \`${cfg.memory}\` current with durable knowledge (how the project works, gotchas, decisions and why). The letter is for the next iteration; the notes are for every future loop. Edit in place; keep it short.`);
  if (checklist && checklist.total) L.push(`${n++}. Tick checklist items in \`${loopfileRel}\` as you truly complete them (\`- [ ]\` → \`- [x]\`). Do not add, remove, or reword items; the loop restores the list if you do.`);
  if (cfg.protect.length) L.push(`${n++}. Never modify protected files. Tests and specs are the verifier, not the work.`);
  if (mode === 'improve') L.push(`${n++}. There is no "done". Each iteration, pick the most valuable improvement and make it. If nothing worthwhile remains, say so plainly and declare done.`);
  else if (mode === 'experiment') L.push(`${n++}. There is no "done" unless the target is reached. Keep experimenting; the loop measures and keeps or reverts.`);
  else L.push(`${n++}. When everything is complete and verified, end your reply with a line containing only \`<loop:done/>\`. The loop verifies the claim${cfg.critic ? ' and asks the critic' : ''}; a false claim just costs an iteration.`);
  L.push(`${n++}. If you cannot proceed without a human, end with \`<loop:stuck>why</loop:stuck>\`. To ask the human a question and wait: \`<loop:ask>question</loop:ask>\`. To hand the next iteration to another agent: \`<loop:handoff>codex</loop:handoff>\`. Signals count only at the start of a line.`);
  if (cfg.stall) L.push(`${n++}. An iteration that changes nothing counts toward the stall limit (${cfg.stall}); the same failure ${cfg.repeat} times in a row stops the loop. Change approach before that happens.`);
  L.push('');
  return L.join('\n');
}

/** The prompt for the independent critic. It reviews; it does not build. */
export function buildCriticPrompt(o) {
  const { body, cfg, iteration, workerAgent, changedFiles, diff, letter, checks, claimedDone, metric } = o;
  const L = [];
  L.push(`# loop · critic review of iteration ${iteration}`, '');
  L.push(`You are the independent critic for an autonomous loop called **${cfg.name}**. A worker agent (${workerAgent}) just finished iteration ${iteration}${claimedDone ? ' and claims the goal is complete' : ''}.`);
  L.push('Your job is to judge the work against the goal, not to redo it. Be specific and strict. A false approval wastes the whole loop; a vague rejection wastes an iteration.', '');
  L.push('## The goal', '', body.trim(), '');
  if (cfg.critic.prompt) L.push('## Review instructions', '', cfg.critic.prompt, '');
  L.push('## Automated checks after this iteration', '');
  if (checks && checks.length) for (const c of checks) L.push(`- \`${c.cmd}\`: ${c.code === 0 ? 'pass' : `exit ${c.code}`}`);
  else L.push('- none configured');
  if (metric && metric.value !== null && metric.value !== undefined) L.push(`- metric \`${cfg.metric}\`: ${metric.value} (best ${metric.best ?? '—'}, ${cfg.direction === 'min' ? 'lower' : 'higher'} is better)`);
  L.push('');
  L.push('## Files changed this iteration', '', changedFiles.length ? changedFiles.map((f) => `- ${f}`).join('\n') : '- none', '');
  if (diff) L.push('## Diff', '', '```diff', truncate(diff, 60000), '```', '');
  if (letter) L.push("## The worker's letter to its next iteration", '', letter.trim(), '');
  L.push('## How to answer', '');
  L.push('1. Read the goal, then the diff. Look for: work that is missing or only stubbed, tests that were weakened or bypassed, behaviour that differs from the goal, hard-coded answers, broken conventions, and claims in the letter that the diff does not support.');
  L.push('2. You may read files and run commands to verify. Do not modify any file.');
  L.push(claimedDone ? '3. End your reply with a line containing only `<loop:approve/>` if the goal is genuinely complete and correct, or with `<loop:reject>` followed by a concrete, numbered list of problems and `</loop:reject>`.' : '3. End your reply with `<loop:approve/>` if the iteration is sound, or `<loop:reject>` followed by a concrete, numbered list of problems for the next iteration to fix and `</loop:reject>`.');
  L.push('');
  return L.join('\n');
}
