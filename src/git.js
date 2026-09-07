import fs from 'node:fs';
import path from 'node:path';
import { runCmd, sha1 } from './util.js';

const IGNORE_DIRS = new Set(['.git', '.loop', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target', '.next', '.cache', 'coverage']);

// Every git call goes through runCmd (no shell): paths, branch names, and commit messages can come
// from the agent, and quoting rules differ between sh and cmd.exe.
const git = (cwd, args, opts = {}) => runCmd('git', ['-c', 'core.quotePath=false', ...args], { cwd, timeout: 60000, ...opts });

export async function isRepo(cwd) {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree'], { timeout: 10000 });
  return r.code === 0 && r.output.trim() === 'true';
}

export async function headSha(cwd) {
  const r = await git(cwd, ['rev-parse', '--short', 'HEAD'], { timeout: 10000 });
  return r.code === 0 ? r.output.trim() : null;
}

export async function currentBranch(cwd) {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10000 });
  return r.code === 0 ? r.output.trim() : null;
}

/** The path of cwd inside the repository ("" at the root, "packages/api/" in a subdirectory). */
async function repoPrefix(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-prefix'], { timeout: 10000 });
  return r.code === 0 ? r.output.trim().replace(/\\/g, '/') : '';
}

/** git prints paths relative to the repository root; the loop thinks relative to its work dir. */
function toLocal(file, prefix) {
  const f = file.replace(/\\/g, '/');
  if (!prefix) return f;
  return f.startsWith(prefix) ? f.slice(prefix.length) : null; // outside the work dir: not ours
}

/**
 * A cheap fingerprint of the working tree so we can tell what an iteration touched.
 * With git: status + per-file diff stats, scoped to the work dir. Without: a walk of mtimes and sizes (capped).
 */
export async function snapshot(cwd, useGit) {
  const map = new Map();
  if (useGit) {
    const prefix = await repoPrefix(cwd);
    const st = await git(cwd, ['status', '--porcelain=v1', '-uall', '--', '.'], { maxOutput: 2_000_000 });
    for (const line of st.output.split('\n')) {
      if (!line.trim()) continue;
      const file = toLocal(line.slice(3).trim().replace(/^"|"$/g, ''), prefix);
      if (file === null || file.startsWith('.loop/')) continue;
      map.set(file, line.slice(0, 2) + ':' + fileStamp(path.join(cwd, file)));
    }
    const diff = await git(cwd, ['diff', '--numstat', 'HEAD', '--', '.'], { maxOutput: 2_000_000 });
    for (const line of diff.output.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const file = toLocal(m[3], prefix);
      if (file === null || file.startsWith('.loop/')) continue;
      map.set(file, (map.get(file) || '') + `|${m[1]}/${m[2]}`);
    }
    map.set('\0HEAD', (await headSha(cwd)) || '');
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
      map.set(path.relative(root, full).replace(/\\/g, '/'), fileStamp(full));
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

/** Stage everything under the work dir except .loop and commit it. Returns { sha } | { error } | null (nothing to commit). */
export async function commitAll(cwd, message) {
  const add = await git(cwd, ['add', '-A', '--', '.']);
  if (add.code !== 0) return { error: add.output.trim() };
  // Never commit the journal, whether or not the repo ignores it: put the index for .loop back to HEAD.
  // (An exclude pathspec on an ignored path makes git complain, and `rm --cached` would stage deletions if .loop were tracked.)
  await git(cwd, ['reset', '-q', '--', '.loop']);
  const staged = await git(cwd, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) return null;
  const r = await git(cwd, ['commit', '-q', '-m', message]);
  if (r.code !== 0) return { error: r.output.trim() };
  return { sha: await headSha(cwd) };
}

/** Commit whatever is dirty under the work dir as a baseline so keep/revert has a known-good HEAD. */
export async function baselineCommit(cwd, message) {
  const st = await git(cwd, ['status', '--porcelain', '--', '.']);
  if (!st.output.trim()) return null;
  return commitAll(cwd, message);
}

/** Throw away every change under the work dir since HEAD (tracked and untracked), keeping .loop. */
export async function revertToHead(cwd) {
  const a = await git(cwd, ['checkout', '-q', 'HEAD', '--', '.']);
  const b = await git(cwd, ['clean', '-fdq', '-e', '.loop', '--', '.']);
  return a.code === 0 && b.code === 0;
}

/** Restore specific work-dir-relative files to HEAD; new untracked files are deleted. */
export async function restoreFiles(cwd, files) {
  const restored = [];
  for (const f of files) {
    const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', f], { timeout: 10000 });
    let ok;
    if (tracked.code === 0) ok = (await git(cwd, ['checkout', '-q', 'HEAD', '--', f])).code === 0;
    else {
      try {
        fs.rmSync(path.join(cwd, f), { force: true });
        ok = !fs.existsSync(path.join(cwd, f));
      } catch {
        ok = false;
      }
    }
    if (ok) restored.push(f);
  }
  return restored;
}

/** Diff of the work dir against HEAD (or of the last commit when clean), capped. */
export async function diffForReview(cwd, { maxBytes = 60000 } = {}) {
  let out = '';
  const stat = await git(cwd, ['diff', 'HEAD', '--stat=120', '--', '.', ':(exclude).loop'], { maxOutput: maxBytes });
  const patch = await git(cwd, ['diff', 'HEAD', '--', '.', ':(exclude).loop'], { maxOutput: maxBytes });
  if (stat.code === 0 && patch.code === 0) out += stat.output + patch.output;
  // New files are invisible to `git diff HEAD`; show them as additions.
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard', '--', '.'], { timeout: 30000 });
  for (const f of untracked.output.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('.loop/'))) {
    const text = readFileCapped(path.join(cwd, f), 20000);
    if (text === null) continue;
    out += `\ndiff --git a/${f} b/${f}\nnew file\n--- /dev/null\n+++ b/${f}\n${text.split('\n').map((l) => '+' + l).join('\n')}\n`;
    if (out.length > maxBytes) break;
  }
  if (out.trim()) return out.slice(0, maxBytes);
  const last = await git(cwd, ['show', '--stat=120', '--patch', '--format=commit %h %s', 'HEAD', '--', '.', ':(exclude).loop'], { maxOutput: maxBytes });
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

export async function ensureBranch(cwd, branch) {
  const cur = await currentBranch(cwd);
  if (cur === branch) return { switched: false };
  const has = await git(cwd, ['rev-parse', '--verify', '--quiet', branch], { timeout: 10000 });
  const r = await git(cwd, has.code === 0 ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch]);
  if (r.code !== 0) throw new Error(`could not switch to branch ${branch}: ${r.output.trim()}`);
  return { switched: true, created: has.code !== 0 };
}

/** Create (or reuse) a worktree for the loop on its own branch. Returns the absolute path. */
export async function ensureWorktree(cwd, branch, dir) {
  const abs = path.resolve(cwd, dir);
  if (fs.existsSync(path.join(abs, '.git'))) return { path: abs, created: false };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const has = await git(cwd, ['rev-parse', '--verify', '--quiet', branch], { timeout: 10000 });
  const r = await git(cwd, has.code === 0 ? ['worktree', 'add', '-q', abs, branch] : ['worktree', 'add', '-q', '-b', branch, abs]);
  if (r.code !== 0) throw new Error(`could not create worktree: ${r.output.trim()}`);
  return { path: abs, created: true };
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
