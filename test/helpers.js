import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'loop.js');

export function tmpdir(prefix = 'loop-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeLoop(dir, frontmatter, body, name = 'LOOP.md') {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  fs.writeFileSync(path.join(dir, name), `---\n${fm}\n---\n\n${body}\n`);
}

export function scenario(iterations, extra = {}) {
  return JSON.stringify({ iterations, ...extra });
}

const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^LOOP/.test(k)));

export function cli(args, { cwd, env = {}, input, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...CLEAN_ENV, NO_COLOR: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => child.kill('SIGKILL'), timeout);
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

export function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.loop', 'state.json'), 'utf8'));
}

export function readJournal(dir) {
  const runs = path.join(dir, '.loop', 'runs');
  const id = fs.readdirSync(runs).sort().at(-1);
  return fs
    .readFileSync(path.join(runs, id, 'journal.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

export function iterations(dir) {
  return readJournal(dir).filter((e) => e.type === 'iteration');
}
