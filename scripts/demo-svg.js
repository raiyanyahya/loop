#!/usr/bin/env node
// Generates docs/demo.svg: an animated, looping replay of a `loop run`, in the website's
// phosphor style, with the same lines, colours, and per-line delays. GitHub renders it in the README.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINES = [
  ['─── iteration 3/25 ─────────────── claude · 1m33s · $0.20 ───', '#55a061', 600],
  ['', '#55a061', 200],
  ['▸ claude (claude -p --output-format stream-json ...)', '#9fe8a9', 700],
  ['│ The loop rejected my "done": the README item is still', '#5da368', 500],
  ['│ open. Writing it now.', '#5da368', 500],
  ['│ ⚙ Write README.md', '#ffd24d', 700],
  ['│ ⚙ Edit  LOOP.md', '#ffd24d', 700],
  ['│ <loop:done/>', '#b6ffca', 800],
  ['▸ 2 files changed, 41s, $0.09, 3 tool calls  LOOP.md, README.md', '#9fe8a9', 600],
  ['▸ letter: Wrote README.md and ticked the last item.', '#9fe8a9', 600],
  ['▸ check: node test.js -> pass (30ms)', '#3dff70', 700],
  ['▸ git: committed 06c6eae', '#9fe8a9', 600],
  ['▸ critic (claude)', '#9fe8a9', 700],
  ['│ Read the diff against the goal. Tests cover both', '#5da368', 450],
  ['│ functions; README matches. No stubs.', '#5da368', 450],
  ['│ <loop:approve/>', '#b6ffca', 800],
  ['▸ critic: approved', '#9fe8a9', 500],
  ['▸ verdict: done verified and approved', '#9fe8a9', 800],
  ['', '#9fe8a9', 300],
  ['✓ done after 3 iterations, 2m14s, $0.29', '#3dff70', 600],
];
const HOLD = 4000;

const W = 760;
const PAD_X = 22;
const PAD_TOP = 54; // room for the "$ loop run" prompt above the box
const LINE_H = 22;
const FONT = 13;
const BOX_TOP = 26;
const BOX_PAD = 18;
const H = BOX_TOP + BOX_PAD * 2 + LINES.length * LINE_H + 8;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ {2}/g, '  ');

// cumulative appearance times
const times = [];
let t = 0;
for (const l of LINES) {
  t += l[2];
  times.push(t);
}
const total = t + HOLD;
const pct = (ms) => ((ms / total) * 100).toFixed(3);

let css = `
text { font-family: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace; font-size: ${FONT}px; }
.glow { filter: url(#glow); }
`;
let body = '';
LINES.forEach((l, i) => {
  const y = PAD_TOP + BOX_PAD + i * LINE_H;
  const start = pct(times[i]);
  css += `.l${i}{opacity:0;animation:a${i} ${total}ms linear infinite}@keyframes a${i}{0%{opacity:0}${start}%{opacity:0}${(Number(start) + 0.01).toFixed(3)}%{opacity:1}100%{opacity:1}}\n`;
  body += `<text class="l${i} glow" x="${PAD_X + 4}" y="${y}" fill="${l[1]}" xml:space="preserve">${esc(l[0] || ' ')}</text>\n`;
  // cursor sits on this row while the row is still empty (from the previous line's appearance until this one's)
  const from = i === 0 ? 0 : times[i - 1];
  const to = times[i];
  css += `.c${i}{opacity:0;animation:c${i} ${total}ms linear infinite}@keyframes c${i}{0%{opacity:0}${pct(from)}%{opacity:0}${(Number(pct(from)) + 0.01).toFixed(3)}%{opacity:1}${pct(to)}%{opacity:1}${(Number(pct(to)) + 0.01).toFixed(3)}%{opacity:0}100%{opacity:0}}\n`;
  body += `<g class="c${i}"><rect class="blink" x="${PAD_X + 4}" y="${y - FONT + 1}" width="8" height="15" fill="#3dff70"/></g>\n`;
});
css += `.blink{animation:blink 1s step-end infinite}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="loop run: iteration 3 of 25 on claude. The agent finishes the README, declares done, the checks pass, git commits, the critic approves, verdict done.">
<title>loop run, replayed</title>
<defs>
  <filter id="glow" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<style>${css}</style>
<rect width="${W}" height="${H}" fill="#050805"/>
<text x="${PAD_X}" y="17" fill="#55a061">$ loop run</text>
<rect x="${PAD_X}" y="${BOX_TOP}" width="${W - PAD_X * 2}" height="${H - BOX_TOP - 6}" fill="#060d06" stroke="#1e4526"/>
<g transform="translate(${BOX_PAD - 4}, ${BOX_PAD - 8})">
${body}</g>
</svg>
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'demo.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(svg.length / 1024).toFixed(1)} kB, ${LINES.length} lines, ${(total / 1000).toFixed(1)}s cycle)`);
