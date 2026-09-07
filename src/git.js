import fs from 'node:fs';
import path from 'node:path';
import { runShell, sha1 } from './util.js';

const IGNORE_DIRS = new Set(['.git', '.loop', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target', '.next', '.cache', 'coverage']);

export async function isRepo(cwd) {
  const r = await runShell('git rev-parse --is-inside-work-tree', { cwd, timeout: 10000 });
  return r.code === 0 && r.output.trim() === 'true';
}

export async function headSha(cwd) {
  const r = await runShell('git rev-parse --short HEAD', { cwd, timeout: 10000 });
  return r.code === 0 ? r.output.trim() : null;
}

export async function currentBranch(cwd) {
  const r = await runShell('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 10000 });
  return r.code === 0 ? r.output.trim() : null;
}

/**
 * A cheap fingerprint of the working tree so we can tell what an iteration touched.
 * With git: status + per-file diff stats. Without: a walk of mtimes and sizes (capped).
 */
export async function snapshot(cwd, useGit) {
  const map = new Map();
  if (useGit) {
    const st = await runShell('git status --porcelain=v1 -uall', { cwd, timeout: 30000, maxOutput: 2_000_000 });
    for (const line of st.output.split('\n')) {
      if (!line.trim()) continue;
      const file = line.slice(3).trim().replace(/^"|"$/g, '');
      if (file.startsWith('.loop/')) continue;
      map.set(file, line.slice(0, 2) + ':' + fileStamp(path.join(cwd, file)));
    }
    const diff = await runShell('git diff --numstat HEAD --', { cwd, timeout: 30000, maxOutput: 2_000_000 });
    for (const line of diff.output.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+(.+)$/.exec(line);
      if (!m || m[3].startsWith('.loop/')) continue;
      map.set(m[3], (map.get(m[3]) || '') + `|${m[1]}/${m[2]}`);
    }
    const head = await headSha(cwd);
    map.set('\0HEAD', head || '');
    return map;
  }
  walk(cwd, cwd, map, { count: 0 });
  return map;
}

function fileStamp(p) {
  try {
    const s = fs.statSync(p);
    return `${s.size}-${Math.floor(s.mtimeMs)}`;
  } catch {
    return 'gone';
  }
}

function walk(root, dir, map, ctr) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (ctr.count > 50000) return;
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, full, map, ctr);
    else if (e.isFile()) {
      ctr.count++;
      map.set(path.relative(root, full), fileStamp(full));
    }
  }
}

export function diffSnapshots(before, after) {
  const changed = new Set();
  for (const [k, v] of after) if (!k.startsWith('\0') && before.get(k) !== v) changed.add(k);
  for (const k of before.keys()) if (!k.startsWith('\0') && !after.has(k)) changed.add(k);
  const headMoved = before.get('\0HEAD') !== after.get('\0HEAD');
  return { files: [...changed].sort(), headMoved };
}

export async function commitAll(cwd, message) {
  await runShell("git add -A -- . ':(exclude).loop'", { cwd, timeout: 60000 });
  const staged = await runShell('git diff --cached --quiet', { cwd, timeout: 60000 });
  if (staged.code === 0) return null; // nothing to commit
  const r = await runShell(`git commit -q -m ${JSON.stringify(message)}`, { cwd, timeout: 60000 });
  if (r.code !== 0) return { error: r.output.trim() };
  return { sha: await headSha(cwd) };
}

export async function ensureBranch(cwd, branch) {
  const cur = await currentBranch(cwd);
  if (cur === branch) return { switched: false };
  const has = await runShell(`git rev-parse --verify --quiet ${JSON.stringify(branch)}`, { cwd, timeout: 10000 });
  const r = await runShell(has.code === 0 ? `git checkout -q ${JSON.stringify(branch)}` : `git checkout -q -b ${JSON.stringify(branch)}`, { cwd, timeout: 30000 });
  if (r.code !== 0) throw new Error(`could not switch to branch ${branch}: ${r.output.trim()}`);
  return { switched: true, created: has.code !== 0 };
}

export function ensureGitignore(cwd) {
  const p = path.join(cwd, '.gitignore');
  let text = '';
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    if (!fs.existsSync(path.join(cwd, '.git'))) return false;
  }
  if (/^\.loop\/?\s*$/m.test(text)) return false;
  fs.writeFileSync(p, text + (text && !text.endsWith('\n') ? '\n' : '') + '.loop/\n');
  return true;
}

export { sha1 };

/** Commit whatever is in the tree as a baseline so keep/revert has a known-good HEAD. */
export async function baselineCommit(cwd, message) {
  const st = await runShell('git status --porcelain', { cwd, timeout: 30000 });
  if (!st.output.trim()) return null;
  return commitAll(cwd, message);
}

/** Throw away every change since HEAD (tracked and untracked), keeping .loop. */
export async function revertToHead(cwd) {
  const a = await runShell('git reset -q --hard HEAD', { cwd, timeout: 60000 });
  const b = await runShell('git clean -fdq -e .loop', { cwd, timeout: 60000 });
  return a.code === 0 && b.code === 0;
}

/** Restore specific files to HEAD; new untracked files are deleted. */
export async function restoreFiles(cwd, files) {
  const restored = [];
  for (const f of files) {
    const tracked = await runShell(`git ls-files --error-unmatch -- ${JSON.stringify(f)}`, { cwd, timeout: 10000 });
    let r;
    if (tracked.code === 0) r = await runShell(`git checkout -q HEAD -- ${JSON.stringify(f)}`, { cwd, timeout: 30000 });
    else {
      try {
        fs.rmSync(path.join(cwd, f), { force: true });
        r = { code: 0 };
      } catch {
        r = { code: 1 };
      }
    }
    if (r.code === 0) restored.push(f);
  }
  return restored;
}

/** Diff of the working tree against HEAD (or of the last commit when clean), capped. */
export async function diffForReview(cwd, { maxBytes = 60000 } = {}) {
  let out = '';
  const tracked = await runShell('git diff HEAD --stat=120 -- . ":(exclude).loop" && git diff HEAD -- . ":(exclude).loop"', { cwd, timeout: 60000, maxOutput: maxBytes });
  if (tracked.code === 0) out += tracked.output;
  // New files are invisible to `git diff HEAD`; show them as additions.
  const untracked = await runShell('git ls-files --others --exclude-standard', { cwd, timeout: 30000 });
  for (const f of untracked.output.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('.loop/'))) {
    const text = readFileCapped(path.join(cwd, f), 20000);
    if (text === null) continue;
    out += `\ndiff --git a/${f} b/${f}\nnew file\n--- /dev/null\n+++ b/${f}\n${text.split('\n').map((l) => '+' + l).join('\n')}\n`;
    if (out.length > maxBytes) break;
  }
  if (out.trim()) return out.slice(0, maxBytes);
  const last = await runShell('git show --stat=120 --patch --format="commit %h %s" HEAD -- . ":(exclude).loop"', { cwd, timeout: 60000, maxOutput: maxBytes });
  return last.code === 0 ? last.output : '';
}

function readFileCapped(p, max) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) return '(binary file)';
    const s = buf.toString('utf8');
    return s.length > max ? s.slice(0, max) + '\n… (truncated)' : s;
  } catch {
    return null;
  }
}

/** Create (or reuse) a worktree for the loop on its own branch. Returns the absolute path. */
export async function ensureWorktree(cwd, branch, dir) {
  const abs = path.resolve(cwd, dir);
  if (fs.existsSync(path.join(abs, '.git'))) return { path: abs, created: false };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const has = await runShell(`git rev-parse --verify --quiet ${JSON.stringify(branch)}`, { cwd, timeout: 10000 });
  const cmd = has.code === 0 ? `git worktree add -q ${JSON.stringify(abs)} ${JSON.stringify(branch)}` : `git worktree add -q -b ${JSON.stringify(branch)} ${JSON.stringify(abs)}`;
  const r = await runShell(cmd, { cwd, timeout: 60000 });
  if (r.code !== 0) throw new Error(`could not create worktree: ${r.output.trim()}`);
  return { path: abs, created: true };
}
