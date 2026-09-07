#!/usr/bin/env node
// Generates docs/demo.svg: an animated, looping replay of a real `loop run` in a plain terminal window,
// coloured the way the CLI colours its output. GitHub plays it straight from the README.
//
// The transcript is a real run (2026-09-07): Claude Haiku 4.5 as worker and critic, permissions: edits,
// a three-item checklist, `node test.js` as the check, test.js protected, git commits on. Three iterations,
// 2m13s, $0.23. Condensed for length only: iteration 2 is summarised in one line, and some of the agent's
// narration is cut. Every number, file name, commit hash, and verdict is as printed.
// Regenerate with `npm run demo:svg`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const C = { bg: '#1e2127', bar: '#2c313a', fg: '#c8ccd4', dim: '#6b7280', cyan: '#56b6c2', magenta: '#c678dd', yellow: '#e5c07b', green: '#98c379', white: '#eef0f3' };

// Each line: [segments, delay before it appears]. A segment: [text, colour, bold?]
export const LINES = [
  [[['─── iteration 1/5 ', C.cyan], ['───────────────────────────────', C.dim], [' claude · 0s ───', C.cyan]], 500],
  [[[' ', C.fg]], 150],
  [[['▸ ', C.magenta], ['claude', C.white, true], [' / claude-haiku-4-5-20251001', C.dim]], 600],
  [[['│ ', C.dim], ["I'll start fresh on this greeting library. First, let me read the test spec.", C.fg]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Read', C.white, true], ['  test.js', C.dim]], 600],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Write', C.white, true], ['  greet.js', C.dim]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Edit', C.white, true], ['  LOOP.md', C.dim]], 600],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Write', C.white, true], ['  .loop/letter.md', C.dim]], 600],
  [[['│ ', C.dim], ["Done! I've implemented greet(name). The next iteration can tick the second item and write the README.", C.fg]], 700],
  [[['│ ', C.dim], ['<loop:done/>', C.magenta]], 700],
  [[['▸ ', C.magenta], ['2 files changed, 46s, $0.07, 7 tool calls', C.fg], ['  LOOP.md, greet.js', C.dim]], 500],
  [[['▸ ', C.magenta], ['letter: ', C.fg], ['Created `greet.js` as an ES module with two exported functions:', C.dim]], 500],
  [[['▸ ', C.magenta], ['check: ', C.fg], ['node test.js', C.dim], [' -> ', C.fg], ['pass', C.green], [' (26ms)', C.dim]], 600],
  [[['▸ ', C.magenta], ['git: committed 15af07a', C.fg]], 500],
  [[['▸ ', C.magenta], ['verdict: ', C.fg], ['continue', C.cyan], ['  done rejected: 2 checklist items still open', C.dim]], 900],
  [[[' ', C.fg]], 200],
  [[['… iteration 2: verified and ticked shout(s), check pass, committed bd2b02d, 1 item still open …', C.dim]], 900],
  [[[' ', C.fg]], 200],
  [[['─── iteration 3/5 ', C.cyan], ['───────────────────────────', C.dim], [' claude · 1m23s · $0.13 ───', C.cyan]], 500],
  [[[' ', C.fg]], 150],
  [[['▸ ', C.magenta], ['claude', C.white, true], [' / claude-haiku-4-5-20251001', C.dim]], 600],
  [[['│ ', C.dim], ['Looking at the checklist, I need to write README.md documenting the two functions.', C.fg]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Read', C.white, true], ['  greet.js', C.dim]], 600],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Write', C.white, true], ['  README.md', C.dim]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Edit', C.white, true], ['  LOOP.md', C.dim]], 600],
  [[['│ ', C.dim], ['<loop:done/>', C.magenta]], 700],
  [[['▸ ', C.magenta], ['2 files changed, 35s, $0.06, 9 tool calls', C.fg], ['  LOOP.md, README.md', C.dim]], 500],
  [[['▸ ', C.magenta], ['check: ', C.fg], ['node test.js', C.dim], [' -> ', C.fg], ['pass', C.green], [' (19ms)', C.dim]], 600],
  [[['▸ ', C.magenta], ['git: committed 7748867', C.fg]], 500],
  [[['▸ ', C.magenta], ['critic', C.white, true], [' (claude)', C.dim]], 700],
  [[['│ ', C.dim], ["I'll review this systematically. Let me read the key files to verify the work against the goal.", C.fg]], 700],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Read', C.white, true], ['  greet.js', C.dim]], 500],
  [[['│ ', C.dim], ['⚙ ', C.yellow], ['Read', C.white, true], ['  README.md', C.dim]], 500],
  [[['│ ', C.dim], ['<loop:approve/>', C.magenta]], 800],
  [[['▸ ', C.magenta], ['critic: ', C.fg], ['approved', C.green]], 500],
  [[['▸ ', C.magenta], ['verdict: ', C.fg], ['done', C.green], ['  verified and approved', C.dim]], 800],
  [[[' ', C.fg]], 300],
  [[['✓ done after 3 iterations, 2m13s, $0.23', C.green, true]], 600],
];
export const HOLD = 4500;

const W = 800;
const BAR_H = 34;
const PAD_X = 20;
const PAD_Y = 14;
const LINE_H = 21;
const FONT = 12.5;
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
LINES.forEach(([segs], i) => {
  const y = BAR_H + PAD_Y + FONT + i * LINE_H;
  const start = pct(times[i]);
  css += `.l${i}{opacity:0;animation:a${i} ${total}ms linear infinite}@keyframes a${i}{0%{opacity:0}${start}%{opacity:0}${after(start)}%{opacity:1}100%{opacity:1}}\n`;
  const spans = segs.map(([text, color, bold]) => `<tspan fill="${color}"${bold ? ' font-weight="600"' : ''}>${esc(text)}</tspan>`).join('');
  body += `<text class="l${i}" x="${PAD_X}" y="${y}" xml:space="preserve">${spans}</text>\n`;
  const from = i === 0 ? 0 : times[i - 1];
  const to = times[i];
  css += `.c${i}{opacity:0;animation:c${i} ${total}ms linear infinite}@keyframes c${i}{0%{opacity:0}${pct(from)}%{opacity:0}${after(pct(from))}%{opacity:1}${pct(to)}%{opacity:1}${after(pct(to))}%{opacity:0}100%{opacity:0}}\n`;
  body += `<g class="c${i}"><rect class="blink" x="${PAD_X}" y="${y - FONT + 1}" width="8" height="15" fill="${C.fg}"/></g>\n`;
});
css += `.blink{animation:blink 1s step-end infinite}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="A real loop run, replayed: Claude Haiku builds a greeting library over three iterations. Iteration 1 claims done and is rejected with two checklist items open; iteration 3 finishes, the check passes, git commits, the critic approves, verdict done. 2m13s, $0.23.">
<title>loop run, replayed</title>
<style>${css}</style>
<defs><clipPath id="win"><rect width="${W}" height="${H}" rx="${RADIUS}"/></clipPath></defs>
<g clip-path="url(#win)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${BAR_H}" fill="${C.bar}"/>
  <circle cx="20" cy="${BAR_H / 2}" r="6" fill="#ff5f57"/><circle cx="40" cy="${BAR_H / 2}" r="6" fill="#febc2e"/><circle cx="60" cy="${BAR_H / 2}" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="${BAR_H / 2 + 4.5}" text-anchor="middle" fill="${C.dim}" font-size="12">greet-lib — loop run</text>
${body}</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${RADIUS}" fill="none" stroke="#3a3f4b"/>
</svg>
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'demo.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(1)} kB, ${LINES.length} lines, ${(total / 1000).toFixed(1)}s cycle)`);
