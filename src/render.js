import { color as c, fmtDuration, fmtMoney, truncate, wrapText, termWidth } from './util.js';

const out = (s) => process.stdout.write(s);

export const ui = {
  banner(version) {
    out(`\n  ${c.bold(c.cyan('⟲ loop'))} ${c.dim('v' + version)}\n\n`);
  },
  kv(rows) {
    const w = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) out(`  ${c.dim(k.padEnd(w))}  ${v}\n`);
    out('\n');
  },
  iterationHeader({ n, max, agent, elapsedMs, cost }) {
    const width = termWidth();
    const left = `─── iteration ${n}${max ? `/${max}` : ''} `;
    const right = ` ${agent} · ${fmtDuration(elapsedMs)}${cost ? ` · ${fmtMoney(cost)}` : ''} ───`;
    const fill = Math.max(3, width - 2 - left.length - right.length);
    out(`\n  ${c.cyan(left)}${c.dim('─'.repeat(fill))}${c.cyan(right)}\n\n`);
  },
  step(text) {
    out(`  ${c.magenta('▸')} ${text}\n`);
  },
  agentLine(text, { dim = false } = {}) {
    for (const line of wrapText(text, termWidth() - 6)) out(`  ${c.dim('│')} ${dim ? c.dim(line) : line}\n`);
  },
  tool(name, summary) {
    out(`  ${c.dim('│')} ${c.yellow('⚙')} ${c.bold(name)}${summary ? '  ' + c.dim(truncate(summary, termWidth() - 12 - name.length)) : ''}\n`);
  },
  warn(text) {
    out(`  ${c.yellow('!')} ${c.yellow(text)}\n`);
  },
  error(text) {
    out(`  ${c.red('✗')} ${c.red(text)}\n`);
  },
  success(text) {
    out(`\n  ${c.green('✓')} ${c.green(c.bold(text))}\n\n`);
  },
  stopped(text) {
    out(`\n  ${c.yellow('■')} ${c.yellow(c.bold(text))}\n\n`);
  },
  verdict(kind, text) {
    const tag = kind === 'done' ? c.green('done') : kind === 'continue' ? c.cyan('continue') : c.yellow(kind);
    out(`  ${c.magenta('▸')} verdict: ${tag}${text ? ' ' + c.dim(text) : ''}\n`);
  },
  blank() {
    out('\n');
  },
  raw(s) {
    out(s);
  },
};

/**
 * Renders an agent's live output and collects the text we need afterwards.
 * mode 'claude' understands stream-json; anything else is treated as plain text.
 */
export function createRenderer({ mode, quiet, onAuthFailure }) {
  let buf = '';
  let text = ''; // the agent's own words (protocol is parsed from this)
  let all = ''; // everything, saved to output.txt
  let cost = null;
  let sessionId = null;
  let model = null;
  let isError = false;
  let authFailures = 0;
  let toolCalls = 0;

  const plainLine = (line) => {
    if (!quiet && line.trim() !== '') ui.agentLine(line);
    text += line + '\n';
  };

  const claudeEvent = (ev) => {
    if (ev.type === 'system') {
      if (ev.subtype === 'init') {
        sessionId = ev.session_id || null;
        model = ev.model || null;
        if (!quiet) ui.agentLine(`session ${sessionId || '?'}${model ? ` · ${model}` : ''}`, { dim: true });
      } else if (ev.subtype === 'api_retry') {
        if (!quiet) ui.agentLine(`⚠ api retry ${ev.attempt}/${ev.max_retries}: ${ev.error || ev.error_status}`, { dim: true });
        if (ev.error === 'authentication_failed' || ev.error_status === 401) {
          authFailures++;
          if (authFailures >= 2 && onAuthFailure) onAuthFailure();
        }
      }
      return;
    }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && block.text) {
          text += block.text + '\n';
          if (!quiet) for (const line of block.text.split('\n')) if (line.trim()) ui.agentLine(line);
        } else if (block.type === 'tool_use') {
          toolCalls++;
          if (!quiet) ui.tool(block.name, summarizeToolInput(block.name, block.input));
        }
      }
      return;
    }
    if (ev.type === 'result' || typeof ev.total_cost_usd === 'number') {
      if (typeof ev.total_cost_usd === 'number') cost = ev.total_cost_usd;
      if (ev.is_error) isError = true;
      if (ev.is_error && ev.result && !quiet) ui.agentLine(`error: ${truncate(String(ev.result), 400)}`, { dim: true });
      if (!text.trim() && typeof ev.result === 'string') text = ev.result + '\n';
      return;
    }
    if (ev.type === 'rate_limit_event' && ev.rate_limit_info && ev.rate_limit_info.status && ev.rate_limit_info.status !== 'allowed') {
      if (!quiet) ui.agentLine(`⚠ rate limit: ${ev.rate_limit_info.status}`, { dim: true });
    }
  };

  const handleLine = (line) => {
    if (mode === 'claude') {
      const t = line.trim();
      if (t.startsWith('{')) {
        try {
          claudeEvent(JSON.parse(t));
          return;
        } catch {
          /* not json after all */
        }
      }
      if (t) {
        if (!quiet) ui.agentLine(line, { dim: true });
        if (!/^⚠/.test(t)) text += line + '\n';
      }
      return;
    }
    plainLine(line);
  };

  return {
    stdout(chunk) {
      const s = chunk.toString();
      all += s;
      buf += s;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        handleLine(buf.slice(0, idx).replace(/\r$/, ''));
        buf = buf.slice(idx + 1);
      }
    },
    stderr(chunk) {
      const s = chunk.toString();
      all += s;
      if (!quiet) for (const line of s.split('\n')) if (line.trim()) ui.agentLine(line.replace(/\r$/, ''), { dim: true });
    },
    finish() {
      if (buf.trim()) handleLine(buf);
      buf = '';
      return { text, all, cost, sessionId, model, isError, toolCalls };
    },
  };
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = (...keys) => {
    for (const k of keys) if (input[k]) return String(input[k]);
    return '';
  };
  switch (name) {
    case 'Bash':
      return pick('command').split('\n')[0];
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pick('file_path', 'notebook_path');
    case 'Grep':
      return pick('pattern');
    case 'Glob':
      return pick('pattern');
    case 'Task':
    case 'Agent':
      return pick('description', 'prompt');
    case 'WebFetch':
      return pick('url');
    case 'WebSearch':
      return pick('query');
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string');
      return first ? first.split('\n')[0] : '';
    }
  }
}
