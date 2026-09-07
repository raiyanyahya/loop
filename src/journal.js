import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readIfExists, readJSON, writeJSON, nowISO, runStamp } from './util.js';

export const DIR = '.loop';

export function loopDir(cwd) {
  return path.join(cwd, DIR);
}

export function paths(cwd) {
  const root = loopDir(cwd);
  return {
    root,
    state: path.join(root, 'state.json'),
    letter: path.join(root, 'letter.md'),
    answer: path.join(root, 'answer.md'),
    stop: path.join(root, 'STOP'),
    runs: path.join(root, 'runs'),
  };
}

export class Journal {
  constructor(cwd, { runId } = {}) {
    this.cwd = cwd;
    this.p = paths(cwd);
    this.runId = runId || runStamp();
    this.runDir = path.join(this.p.runs, this.runId);
    ensureDir(this.runDir);
    this.journalPath = path.join(this.runDir, 'journal.jsonl');
  }

  iterDir(n) {
    const d = path.join(this.runDir, `iter-${String(n).padStart(3, '0')}`);
    ensureDir(d);
    return d;
  }

  event(type, data = {}) {
    fs.appendFileSync(this.journalPath, JSON.stringify({ t: nowISO(), type, ...data }) + '\n');
  }

  writeState(state) {
    ensureDir(this.p.root);
    writeJSON(this.p.state, { ...state, runId: this.runId, updatedAt: nowISO() });
  }

  readLetter(letterPath) {
    const p = path.isAbsolute(letterPath) ? letterPath : path.join(this.cwd, letterPath);
    const t = readIfExists(p);
    return t === null ? null : t.trim();
  }

  clearLetter(letterPath) {
    const p = path.isAbsolute(letterPath) ? letterPath : path.join(this.cwd, letterPath);
    try {
      fs.unlinkSync(p);
    } catch {
      /* nothing to clear */
    }
  }

  consumeAnswer() {
    const t = readIfExists(this.p.answer);
    if (t === null) return null;
    try {
      fs.unlinkSync(this.p.answer);
    } catch {
      /* ignore */
    }
    return t.trim() || null;
  }

  stopRequested() {
    if (!fs.existsSync(this.p.stop)) return false;
    try {
      fs.unlinkSync(this.p.stop);
    } catch {
      /* ignore */
    }
    return true;
  }
}

export function readState(cwd) {
  return readJSON(paths(cwd).state);
}

export function listRuns(cwd) {
  const dir = paths(cwd).runs;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'journal.jsonl')))
    .sort();
}

export function readRun(cwd, runId) {
  const dir = path.join(paths(cwd).runs, runId);
  const text = readIfExists(path.join(dir, 'journal.jsonl'));
  if (text === null) return null;
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const iterations = events.filter((e) => e.type === 'iteration');
  for (const it of iterations) {
    const d = path.join(dir, `iter-${String(it.n).padStart(3, '0')}`);
    it.dir = d;
    it.output = readIfExists(path.join(d, 'output.txt'));
    it.prompt = readIfExists(path.join(d, 'prompt.md'));
    it.letterFull = readIfExists(path.join(d, 'letter.md'));
  }
  return { runId, dir, events, iterations, start: events.find((e) => e.type === 'start') || null, end: events.find((e) => e.type === 'end') || null };
}

export function requestStop(cwd) {
  const p = paths(cwd);
  ensureDir(p.root);
  fs.writeFileSync(p.stop, nowISO() + '\n');
}

export function writeAnswer(cwd, text) {
  const p = paths(cwd);
  ensureDir(p.root);
  fs.writeFileSync(p.answer, text.trim() + '\n');
}
