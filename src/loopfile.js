import fs from 'node:fs';
import path from 'node:path';
import { parseYAML } from './yaml.js';
import { parseDuration, toArray } from './util.js';

export const LOOPFILE_NAMES = ['LOOP.md', 'loop.md', 'Loopfile.md', 'Loopfile'];

export const DEFAULTS = {
  max: 25,
  max_time: '8h',
  stall: 3,
  repeat: 3,
  timeout: '1h',
  check_timeout: '10m',
  until: ['done'],
};

/** Split a Loopfile into { raw, config, body, checklist }. */
export function parseLoopfile(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  let config = {};
  let body = src;
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (m) {
    config = parseYAML(m[1]) || {};
    body = src.slice(m[0].length);
  }
  return { raw: src, config, body: body.trim() + '\n', checklist: parseChecklist(body) };
}

export function findLoopfile(dir) {
  for (const name of LOOPFILE_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Resolve "loop run <thing>": a path, a name in loops/, or a bare name. */
export function resolveLoopfile(dir, arg) {
  const candidates = [arg, `${arg}.md`, path.join('loops', `${arg}.md`), path.join('loops', arg), `LOOP-${arg}.md`];
  for (const c of candidates) {
    const p = path.resolve(dir, c);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/** Extract markdown checkboxes from the body. */
export function parseChecklist(body) {
  const items = [];
  const re = /^[ \t]*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*\S)\s*$/gm;
  let m;
  while ((m = re.exec(body))) items.push({ done: m[1] !== ' ', text: m[2].trim() });
  return {
    items,
    total: items.length,
    done: items.filter((i) => i.done).length,
    open: items.filter((i) => !i.done).map((i) => i.text),
  };
}

const UNTIL_WORDS = new Set(['done', 'checklist', 'never']);

/**
 * Turn raw frontmatter + CLI overrides into a fully typed loop config.
 * Keys are grouped by the five parts of a loop: goal, worker, verifier, memory, brakes.
 */
export function normalizeConfig(raw = {}, overrides = {}, ctx = {}) {
  const r = { ...raw, ...stripUndefined(overrides) };
  const cfg = {};

  // --- identity & goal
  cfg.name = String(r.name || ctx.defaultName || 'loop').trim();
  cfg.context = toArray(r.context).map(String);

  // --- worker
  cfg.agents = toArray(r.agent ?? r.agents).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  cfg.model = r.model ? String(r.model) : null;
  cfg.command = r.command ? String(r.command) : null;
  cfg.args = toArray(r.args).map(String);
  cfg.cwd = r.cwd ? String(r.cwd) : null;
  cfg.env = r.env && typeof r.env === 'object' ? Object.fromEntries(Object.entries(r.env).map(([k, v]) => [k, String(v)])) : {};
  cfg.sandbox = r.sandbox ? String(r.sandbox) : null;
  const perms = r.permissions === undefined || r.permissions === null ? 'bypass' : String(r.permissions).toLowerCase();
  if (!['bypass', 'edits', 'default'].includes(perms)) throw new Error(`permissions must be bypass, edits, or default (got "${perms}")`);
  cfg.permissions = perms; // bypass: no prompts at all; edits: file edits auto-approved, everything else denied; default: the agent's own defaults

  // --- verifier
  const until = toArray(r.until ?? DEFAULTS.until).map((u) => String(u).trim()).filter(Boolean);
  for (const u of until) if (u === 'idle') throw new Error('until: idle was removed; use "stall" to stop loops that change nothing');
  cfg.until = until.length ? until : ['done'];
  cfg.metric = r.metric ? String(r.metric) : null;
  cfg.direction = r.direction === 'min' || r.direction === 'lower' ? 'min' : 'max';
  cfg.target = r.target === null || r.target === undefined || r.target === '' ? null : Number(r.target);
  const keep = r.keep === undefined || r.keep === null ? (cfg.metric ? 'improve' : 'always') : String(r.keep);
  if (!['improve', 'no-regress', 'always'].includes(keep)) throw new Error(`keep must be improve, no-regress, or always (got "${keep}")`);
  cfg.keep = keep;
  cfg.protect = toArray(r.protect).map(String);
  cfg.critic = normalizeCritic(r.critic);

  // --- memory
  cfg.letter = r.letter !== false;
  cfg.letter_path = typeof r.letter === 'string' ? r.letter : '.loop/letter.md';
  cfg.memory = r.memory ? String(r.memory) : null;

  // --- brakes
  cfg.max = intOr(r.max, DEFAULTS.max);
  cfg.max_time = parseDuration(r.max_time, parseDuration(DEFAULTS.max_time));
  cfg.max_cost = r.max_cost === null || r.max_cost === undefined || r.max_cost === '' ? null : Number(r.max_cost);
  cfg.stall = intOr(r.stall, DEFAULTS.stall);
  cfg.repeat = intOr(r.repeat, DEFAULTS.repeat);
  cfg.timeout = parseDuration(r.timeout, parseDuration(DEFAULTS.timeout));
  cfg.check_timeout = parseDuration(r.check_timeout, parseDuration(DEFAULTS.check_timeout));
  cfg.sleep = parseDuration(r.sleep, 0);

  // --- rhythm & hooks
  cfg.feedback = toArray(r.feedback).map(String);
  cfg.before = toArray(r.before).map(String);
  cfg.after = toArray(r.after).map(String);
  cfg.on_done = toArray(r.on_done).map(String);
  cfg.on_stop = toArray(r.on_stop).map(String);
  cfg.notify = r.notify ? String(r.notify) : null;
  cfg.rituals = toArray(r.rituals)
    .filter((x) => x && typeof x === 'object' && x.prompt)
    .map((x) => ({
      every: x.every === undefined || x.every === null ? null : Math.max(1, intOr(x.every, 5)),
      at: x.at === 'last' ? 'last' : x.at === undefined || x.at === null ? null : Math.max(1, intOr(x.at, 1)),
      prompt: String(x.prompt).trim(),
      agent: x.agent ? String(x.agent).toLowerCase() : null,
      name: x.name ? String(x.name) : null,
    }))
    .map((x) => (x.every === null && x.at === null ? { ...x, every: 5 } : x));

  // --- git
  const git = r.git;
  if (git === true) cfg.git = { commit: true, branch: null, worktree: false };
  else if (git && typeof git === 'object') cfg.git = { commit: git.commit !== false, branch: git.branch ? String(git.branch) : null, worktree: git.worktree === true };
  else cfg.git = { commit: false, branch: null, worktree: false };
  if (cfg.git.worktree && !cfg.git.branch) cfg.git.branch = `loop/${cfg.name}`;
  // Keep-or-revert needs a committed baseline: every kept iteration becomes a commit.
  if (cfg.keep !== 'always') cfg.git.commit = true;

  return cfg;
}

function normalizeCritic(v) {
  if (!v) return null;
  if (typeof v === 'string') return { agent: v.toLowerCase() === 'same' ? null : v.toLowerCase(), model: null, when: 'done', prompt: null };
  if (typeof v === 'object') {
    const when = v.when === undefined || v.when === null || v.when === 'done' ? 'done' : Math.max(1, intOr(v.when, 1));
    const agent = v.agent ? String(v.agent).toLowerCase() : null;
    return { agent: agent === 'same' ? null : agent, model: v.model ? String(v.model) : null, when, prompt: v.prompt ? String(v.prompt).trim() : null };
  }
  return null;
}

function intOr(v, d) {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function describeUntil(cfg) {
  const until = Array.isArray(cfg) ? cfg : cfg.until;
  const parts = until.map((u) => {
    if (u === 'done') return 'the agent declares <loop:done/>';
    if (u === 'checklist') return 'every checklist item is ticked';
    if (u === 'never') return 'never (guards only)';
    return `\`${u}\` exits 0`;
  });
  let s = parts.join(' AND ');
  if (!Array.isArray(cfg)) {
    if (cfg.critic) s += ' AND the critic approves';
    if (cfg.metric && cfg.target !== null) s = `the metric reaches ${cfg.target}${until.includes('never') ? '' : ', OR ' + s}`;
  }
  return s;
}

export function untilKinds(until) {
  return until.map((u) => (UNTIL_WORDS.has(u) ? { kind: u } : { kind: 'cmd', cmd: u }));
}

/** Minimal glob: ** matches across directories, * within one, ? one char. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(file, globs) {
  const f = String(file).replace(/\\/g, '/');
  return globs.some((g) => {
    const re = globToRegExp(g.replace(/\\/g, '/').replace(/^\.\//, ''));
    return re.test(f) || (!g.includes('/') && re.test(path.posix.basename(f)));
  });
}
