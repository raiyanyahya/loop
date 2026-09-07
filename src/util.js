import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const isTTY = process.stdout.isTTY === true;
const useColor = isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const c = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const color = {
  enabled: useColor,
  bold: c(1, 22),
  dim: c(2, 22),
  italic: c(3, 23),
  underline: c(4, 24),
  red: c(31, 39),
  green: c(32, 39),
  yellow: c(33, 39),
  blue: c(34, 39),
  magenta: c(35, 39),
  cyan: c(36, 39),
  gray: c(90, 39),
  white: c(37, 39),
};

const UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

/** "30" | "30s" | "5m" | "1h30m" | 30 -> milliseconds */
export function parseDuration(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'number') return v * 1000;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(s))) {
    matched = true;
    total += Number(m[1]) * UNITS[m[2]];
  }
  if (!matched) throw new Error(`invalid duration "${v}" (try 30s, 5m, 8h)`);
  return total;
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtMoney(usd) {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`;
}

export function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

export function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

export function readJSON(p) {
  const t = readIfExists(p);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function shellQuote(s) {
  if (process.platform === 'win32') return `"${String(s).replace(/"/g, '""')}"`;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function toArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
}

export function tailLines(s, lines) {
  const a = String(s ?? '').split('\n');
  return a.length > lines ? `… (${a.length - lines} earlier lines omitted)\n` + a.slice(-lines).join('\n') : String(s ?? '');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function nowISO() {
  return new Date().toISOString();
}

export function runStamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Locate an executable on PATH (cross-platform, no deps). */
export function which(bin) {
  if (!bin) return null;
  if (bin.includes(path.sep) || bin.includes('/')) return exists(bin) ? bin : null;
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export function shellCommand(cmd) {
  return process.platform === 'win32' ? ['cmd', ['/d', '/s', '/c', cmd]] : ['sh', ['-c', cmd]];
}

/** Run a shell command, capture merged output (tail-limited), with timeout. */
export function runShell(cmd, { cwd, env, timeout = 600000, maxOutput = 200000, onData } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const [file, args] = shellCommand(cmd);
    let child;
    const posix = process.platform !== 'win32';
    try {
      child = spawn(file, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'], detached: posix });
    } catch (err) {
      return resolve({ code: 127, output: String(err.message), ms: 0, timedOut: false });
    }
    const killAll = (sig) => {
      try {
        if (posix) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    let out = '';
    let timedOut = false;
    const push = (buf) => {
      const s = buf.toString();
      if (onData) onData(s);
      out += s;
      if (out.length > maxOutput) out = out.slice(-maxOutput);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const timer = setTimeout(() => {
      timedOut = true;
      killAll('SIGKILL');
    }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, output: out + String(err.message), ms: Date.now() - started, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code === null ? (signal ? 128 : 1) : code, signal, output: out, ms: Date.now() - started, timedOut });
    });
  });
}

/** Run a program directly (no shell), so untrusted strings in args can never be interpreted. */
export function runCmd(file, args, { cwd, env, timeout = 600000, maxOutput = 200000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(file, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: 127, output: String(err.message), ms: 0, timedOut: false });
    }
    let out = '';
    let timedOut = false;
    const push = (buf) => {
      out += buf.toString();
      if (out.length > maxOutput) out = out.slice(-maxOutput);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, output: out + String(err.message), ms: Date.now() - started, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code === null ? (signal ? 128 : 1) : code, signal, output: out, ms: Date.now() - started, timedOut });
    });
  });
}

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function wrapText(text, width) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    if (raw.length <= width) {
      lines.push(raw);
      continue;
    }
    let line = '';
    for (const word of raw.split(' ')) {
      if (line.length + word.length + 1 > width && line) {
        lines.push(line);
        line = word;
      } else line = line ? line + ' ' + word : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function termWidth() {
  return Math.max(40, Math.min(process.stdout.columns || 100, 120));
}
