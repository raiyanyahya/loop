import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { which, shellQuote, shellCommand } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_AGENT_PATH = path.join(here, 'fake-agent.js');

/**
 * Agent adapters. Each one knows how to run its CLI non-interactively with a prompt.
 *   input: 'stdin' (prompt piped), 'arg' (prompt as argument), 'file' (path to prompt file as argument)
 *   parse: 'claude' enables structured rendering of Claude Code's stream-json output.
 */
export const AGENTS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code',
    verified: true,
    input: 'stdin',
    parse: 'claude',
    args: ({ model, permissions }) => ['-p', '--output-format', 'stream-json', '--verbose', ...(permissions === 'edits' ? ['--permission-mode', 'acceptEdits'] : permissions === 'default' ? [] : ['--dangerously-skip-permissions']), ...(model ? ['--model', model] : [])],
    env: (env) => {
      // Allow loop to be launched from inside a Claude Code session.
      const out = {};
      for (const [k, v] of Object.entries(env)) if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID)/.test(k)) out[k] = v;
      return out;
    },
  },
  codex: {
    label: 'Codex CLI',
    bin: 'codex',
    install: 'npm i -g @openai/codex',
    input: 'stdin',
    args: ({ model, permissions }) => ['exec', ...(permissions === 'edits' ? ['--sandbox', 'workspace-write'] : permissions === 'default' ? [] : ['--dangerously-bypass-approvals-and-sandbox']), '--skip-git-repo-check', ...(model ? ['-m', model] : []), '-'],
  },
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    install: 'npm i -g @google/gemini-cli',
    input: 'arg',
    args: ({ model, prompt, permissions }) => [...(permissions === 'edits' ? ['--approval-mode', 'auto_edit'] : permissions === 'default' ? [] : ['--yolo']), ...(model ? ['-m', model] : []), '-p', prompt],
  },
  aider: {
    label: 'Aider',
    bin: 'aider',
    install: 'pip install aider-chat',
    input: 'file',
    args: ({ model, promptFile }) => ['--message-file', promptFile, '--yes-always', ...(model ? ['--model', model] : [])],
  },
  opencode: {
    label: 'OpenCode',
    bin: 'opencode',
    install: 'npm i -g opencode-ai',
    input: 'arg',
    args: ({ model, prompt }) => ['run', ...(model ? ['-m', model] : []), prompt],
  },
  goose: {
    label: 'Goose',
    bin: 'goose',
    install: 'https://block.github.io/goose/docs/getting-started/installation',
    input: 'file',
    args: ({ promptFile }) => ['run', '-i', promptFile],
  },
  copilot: {
    label: 'GitHub Copilot CLI',
    bin: 'copilot',
    install: 'npm i -g @github/copilot',
    input: 'arg',
    args: ({ model, prompt }) => ['-p', prompt, '--allow-all-tools', ...(model ? ['--model', model] : [])],
  },
  amp: {
    label: 'Amp',
    bin: 'amp',
    install: 'npm i -g @sourcegraph/amp',
    input: 'stdin',
    args: () => ['-x', '--dangerously-allow-all'],
  },
  cursor: {
    label: 'Cursor Agent',
    bin: 'cursor-agent',
    install: 'curl https://cursor.com/install -fsS | bash',
    input: 'arg',
    args: ({ model, prompt }) => ['-p', prompt, '--force', ...(model ? ['--model', model] : [])],
  },
  fake: {
    label: 'Fake agent (demo/tests)',
    bin: process.execPath,
    hidden: true,
    verified: true,
    input: 'stdin',
    args: () => [FAKE_AGENT_PATH],
  },
};

export const PREFERRED_ORDER = ['claude', 'codex', 'gemini', 'opencode', 'copilot', 'aider', 'amp', 'goose', 'cursor'];

export function agentNames() {
  return Object.keys(AGENTS).filter((k) => !AGENTS[k].hidden);
}

export function isKnownAgent(name) {
  return Boolean(AGENTS[name]);
}

export function agentPath(name) {
  const a = AGENTS[name];
  if (!a) return null;
  return name === 'fake' ? a.bin : which(a.bin);
}

export function detectAgents() {
  return PREFERRED_ORDER.filter((n) => agentPath(n));
}

/**
 * Build the child-process invocation for one iteration.
 * Returns { file, args, input, stdinText, env, display }.
 */
export function buildInvocation({ agent, cfg, prompt, promptFile, iteration, role = 'worker', cwd = process.cwd(), env = process.env }) {
  const base = {
    ...env,
    LOOP: '1',
    LOOP_NAME: cfg.name,
    LOOP_ITERATION: String(iteration),
    LOOP_AGENT: agent,
    LOOP_ROLE: role,
    LOOP_PROMPT_FILE: promptFile,
    ...cfg.env,
  };
  const inv = buildBare({ agent, cfg, prompt, promptFile, base });
  if (!cfg.sandbox) return inv;
  // Wrap the whole agent command in the sandbox template: {cmd} and {cwd} are substituted.
  const cmdString = inv.shell ? inv.shell : [inv.file, ...inv.args].map(shellQuote).join(' ');
  const wrapped = cfg.sandbox.split('{cwd}').join(shellQuote(cwd)).split('{cmd}').join(shellQuote(cmdString));
  const [file, args] = shellCommand(wrapped);
  return { ...inv, file, args, display: `sandbox: ${wrapped}` };
}

function buildBare({ agent, cfg, prompt, promptFile, base }) {

  if (cfg.command && (agent === 'custom' || !AGENTS[agent])) {
    let cmd = cfg.command;
    let input = 'stdin';
    if (cmd.includes('{promptfile}')) {
      cmd = cmd.split('{promptfile}').join(shellQuote(promptFile));
      input = 'file';
    } else if (cmd.includes('{prompt}')) {
      cmd = cmd.split('{prompt}').join(shellQuote(prompt));
      input = 'arg';
    }
    const [file, args] = shellCommand(cmd);
    return { file, args, input, stdinText: input === 'stdin' ? prompt : null, env: base, display: cmd, shell: cmd };
  }

  const a = AGENTS[agent];
  if (!a) throw new Error(`unknown agent "${agent}" (known: ${agentNames().join(', ')}; or set command: in the Loopfile)`);
  const file = agent === 'fake' ? a.bin : agentPath(agent);
  if (!file) throw new Error(`agent "${agent}" is not installed (${a.install})`);
  const args = [...a.args({ model: cfg.model, prompt, promptFile, permissions: cfg.permissions || 'bypass' }), ...cfg.args];
  const finalEnv = a.env ? a.env(base) : base;
  const display = [a.bin, ...args.map((x) => (x === prompt ? '<prompt>' : x === promptFile ? '<promptfile>' : x))].join(' ');
  return { file, args, input: a.input, stdinText: a.input === 'stdin' ? prompt : null, env: finalEnv, parse: a.parse || null, display };
}
