#!/usr/bin/env node
// Generates docs/demo.svg: an animated, looping replay of a `loop run` in a plain terminal window,
// coloured the way the real CLI colours its output. GitHub plays it straight from the README.
// Regenerate with `npm run demo:svg`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Terminal palette (One Dark-ish)
const C = { bg: '#1e2127', bar: '#2c313a', fg: '#c8ccd4', dim: '#6b7280', cyan: '#56b6c2', magenta: '#c678dd', yellow: '#e5c07b', green: '#98c379', white: '#eef0f3' };

// Each line: [segments, delay before it appears]. A segment: [text, colour, bold?]
const LINES = [
  [[['─── iteration 3/25 ', C.cyan], ['──────────────────────────────', C.dim], [' claude · 1m33s · $0.20 ───', C.cyan]], 600],
  [[[' ', C.fg]], 200],
  [[['▸ ', C.magenta], ['claude', C.white, true], [' (claude -p --output-format stream-json ...)', C.dim]], 700],
  [[['│ ', C.dim], ['The loop rejected my "done": the README item is still open.', C.fg]], 500],
  [[['│ ', C.dim], ['Writing it now.', C.fg]], 500],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Write', C.white, true], ['  README.md', C.dim]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Edit', C.white, true], ['  LOOP.md', C.dim]], 700],
  [[['│ ', C.dim], ['<loop:done/>', C.magenta]], 800],
  [[['▸ ', C.magenta], ['2 files changed, 41s, $0.09, 3 tool calls', C.fg], ['  LOOP.md, README.md', C.dim]], 600],
  [[['▸ ', C.magenta], ['letter: ', C.fg], ['Wrote README.md and ticked the last item.', C.dim]], 600],
  [[['▸ ', C.magenta], ['check: ', C.fg], ['node test.js', C.dim], [' -> ', C.fg], ['pass', C.green], [' (30ms)', C.dim]], 700],
  [[['▸ ', C.magenta], ['git: committed 06c6eae', C.fg]], 600],
  [[['▸ ', C.magenta], ['critic', C.white, true], [' (claude)', C.dim]], 700],
  [[['│ ', C.dim], ['Read the diff against the goal. Tests cover both functions;', C.fg]], 450],
  [[['│ ', C.dim], ['README matches. No stubs.', C.fg]], 450],
  [[['│ ', C.dim], ['<loop:approve/>', C.magenta]], 800],
  [[['▸ ', C.magenta], ['critic: ', C.fg], ['approved', C.green]], 500],
  [[['▸ ', C.magenta], ['verdict: ', C.fg], ['done', C.green], ['  verified and approved', C.dim]], 800],
  [[[' ', C.fg]], 300],
  [[['✓ done after 3 iterations, 2m14s, $0.29', C.green, true]], 600],
];
const HOLD = 4000;

const W = 760;
const BAR_H = 34;
const PAD_X = 20;
const PAD_Y = 16;
const LINE_H = 22;
const FONT = 13;
const RADIUS = 10;
const H = BAR_H + PAD_Y * 2 + LINES.length * LINE_H + 4;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const times = [];
let t = 0;
for (const l of LINES) {
  t += l[1];
  times.push(t);
}
const total = t + HOLD;
const pct = (ms) => ((ms / total) * 100).toFixed(3);
const after = (p) => (Number(p) + 0.01).toFixed(3);

let css = `text{font-family:'SF Mono','Cascadia Code','JetBrains Mono','Fira Code',Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:${FONT}px;white-space:pre}\n`;
let body = '';
LINES.forEach(([segs, _d], i) => {
  const y = BAR_H + PAD_Y + FONT + i * LINE_H;
  const start = pct(times[i]);
  css += `.l${i}{opacity:0;animation:a${i} ${total}ms linear infinite}@keyframes a${i}{0%{opacity:0}${start}%{opacity:0}${after(start)}%{opacity:1}100%{opacity:1}}\n`;
  const spans = segs.map(([text, color, bold]) => `<tspan fill="${color}"${bold ? ' font-weight="600"' : ''}>${esc(text)}</tspan>`).join('');
  body += `<text class="l${i}" x="${PAD_X}" y="${y}" xml:space="preserve">${spans}</text>\n`;
  const from = i === 0 ? 0 : times[i - 1];
  const to = times[i];
  css += `.c${i}{opacity:0;animation:c${i} ${total}ms linear infinite}@keyframes c${i}{0%{opacity:0}${pct(from)}%{opacity:0}${after(pct(from))}%{opacity:1}${pct(to)}%{opacity:1}${after(pct(to))}%{opacity:0}100%{opacity:0}}\n`;
  body += `<g class="c${i}"><rect class="blink" x="${PAD_X}" y="${y - FONT + 1}" width="8" height="16" fill="${C.fg}"/></g>\n`;
});
css += `.blink{animation:blink 1s step-end infinite}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="A loop run, replayed: iteration 3 of 25 on claude. The agent finishes the README and declares done, the check passes, git commits, the critic approves, verdict done.">
<title>loop run, replayed</title>
<style>${css}</style>
<defs><clipPath id="win"><rect width="${W}" height="${H}" rx="${RADIUS}"/></clipPath></defs>
<g clip-path="url(#win)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${BAR_H}" fill="${C.bar}"/>
  <circle cx="20" cy="${BAR_H / 2}" r="6" fill="#ff5f57"/><circle cx="40" cy="${BAR_H / 2}" r="6" fill="#febc2e"/><circle cx="60" cy="${BAR_H / 2}" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="${BAR_H / 2 + 4.5}" text-anchor="middle" fill="${C.dim}" font-size="12">⟲ loop</text>
${body}</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${RADIUS}" fill="none" stroke="#3a3f4b"/>
</svg>
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'demo.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(1)} kB, ${LINES.length} lines, ${(total / 1000).toFixed(1)}s cycle)`);
