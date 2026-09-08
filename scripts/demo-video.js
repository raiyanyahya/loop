#!/usr/bin/env node
// Renders docs/demo.mp4 and docs/demo.gif from the same transcript and timing as docs/demo.svg,
// for places that do not play SVG animations (Twitter, Reddit, Hacker News comments, Slack).
//
// Needs a Chrome/Chromium binary (for rasterising each frame) and ffmpeg. Neither is a project
// dependency: set CHROME and FFMPEG, or have `google-chrome`/`chromium` and `ffmpeg` on PATH.
// Without ffmpeg on PATH it tries `npx -y -p ffmpeg-static` to locate a static build.
// Run with `npm run demo:video`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LINES, HOLD, frameSvg } from './demo-svg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-demo-video-'));

function find(cands) {
  for (const c of cands) {
    if (!c) continue;
    const r = spawnSync(c, ['--version'], { stdio: 'ignore' });
    if (!r.error) return c;
  }
  return null;
}
const chrome = find([process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
if (!chrome) throw new Error('no Chrome/Chromium found; set CHROME=/path/to/chrome');
let ffmpeg = find([process.env.FFMPEG, 'ffmpeg']);
if (!ffmpeg) {
  const r = spawnSync('npx', ['-y', '-p', 'ffmpeg-static', 'node', '-p', "require('ffmpeg-static')"], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) ffmpeg = r.stdout.trim().split('\n').pop();
}
if (!ffmpeg) throw new Error('no ffmpeg found; install it or set FFMPEG=/path/to/ffmpeg');

// One frame per state: k lines visible with the cursor on the next row; the last frame holds.
const frames = [];
for (let k = 0; k <= LINES.length; k++) {
  const svg = path.join(work, `f${String(k).padStart(3, '0')}.svg`);
  const png = path.join(work, `f${String(k).padStart(3, '0')}.png`);
  fs.writeFileSync(svg, frameSvg(k));
  const html = path.join(work, `f${String(k).padStart(3, '0')}.html`);
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#1e2127"><img src="file://${svg}" style="display:block"></body></html>`);
  const { width, height } = frameSize();
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--window-size=${width},${height}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore' });
  if (r.status !== 0 || !fs.existsSync(png)) throw new Error(`frame ${k} failed to render`);
  const duration = k < LINES.length ? LINES[k][1] / 1000 : HOLD / 1000;
  frames.push({ png, duration });
  process.stdout.write(`\rrendered frame ${k + 1}/${LINES.length + 1}`);
}
process.stdout.write('\n');

// ffmpeg concat demuxer with per-frame durations.
const list = path.join(work, 'frames.txt');
fs.writeFileSync(list, frames.map((f) => `file '${f.png}'\nduration ${f.duration.toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).png}'\n`);

const mp4 = path.join(root, 'docs', 'demo.mp4');
const gif = path.join(root, 'docs', 'demo.gif');
run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gif]);

for (const f of [mp4, gif]) console.log(`wrote ${path.relative(root, f)} (${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
fs.rmSync(work, { recursive: true, force: true });

function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${path.basename(bin)} failed`);
}

function frameSize() {
  const m = /width="(\d+)" height="(\d+)"/.exec(frameSvg(0));
  return { width: Number(m[1]), height: Number(m[2]) };
}
