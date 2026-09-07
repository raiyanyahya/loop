import { readRun, listRuns } from './journal.js';
import { fmtDuration, fmtMoney } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function buildReport(cwd, runId) {
  const id = runId || listRuns(cwd).at(-1);
  if (!id) throw new Error('no runs found in .loop/runs');
  const run = readRun(cwd, id);
  if (!run) throw new Error(`run ${id} not found`);
  const start = run.start || {};
  const end = run.end || {};
  const its = run.iterations;
  const critics = run.events.filter((e) => e.type === 'critic');
  const totalMs = end.elapsedMs ?? its.reduce((a, b) => a + (b.ms || 0), 0);
  const cost = end.cost ?? its.at(-1)?.costTotal ?? 0;
  const status = end.status || 'running';
  const files = new Set();
  for (const it of its) for (const f of it.changed || []) files.add(f);
  const hasMetric = Boolean(start.metric);
  const baseline = run.events.find((e) => e.type === 'baseline')?.metric ?? null;
  const kept = its.filter((i) => i.result === 'kept').length;
  const reverted = its.filter((i) => i.result === 'reverted').length;

  const cards = its
    .map((it) => {
      const sig = (it.signals || []).map((s) => `<span class="sig">&lt;loop:${esc(s.tag)}${s.body ? '&gt;' + esc(s.body.slice(0, 80)) : '/&gt;'}</span>`).join(' ');
      const verdict = it.satisfied ? '<span class="v done">done</span>' : `<span class="v cont">continue</span>${it.failures?.length ? ` <span class="why">${esc(it.failures.join('; '))}</span>` : ''}`;
      const resultTag = it.result === 'reverted' ? `<span class="v rev">reverted</span> <span class="why">${esc(it.revertReason || '')}</span>` : it.result === 'kept' ? '<span class="v kept">kept</span>' : '';
      const criticEv = critics.find((cv) => cv.n === it.n);
      const criticTag = criticEv ? `<span class="v ${criticEv.verdict === 'approved' ? 'kept' : criticEv.verdict === 'rejected' ? 'rev' : 'cont'}">critic ${esc(criticEv.verdict)}</span>${criticEv.reasons ? ` <span class="why">${esc(criticEv.reasons.slice(0, 200))}</span>` : ''}` : '';
      const violations = it.violations?.length ? `<span class="v rev">protected restored</span> <span class="why">${esc(it.violations.join(', '))}</span>` : '';
      const changed = (it.changed || []).length ? `<ul class="files">${it.changed.slice(0, 40).map((f) => `<li>${esc(f)}</li>`).join('')}${it.changed.length > 40 ? `<li>… ${it.changed.length - 40} more</li>` : ''}</ul>` : '<p class="muted">no files changed</p>';
      const out = (it.output || '').slice(-20000);
      const checks = (it.checks || []).map((k) => `<span class="chk ${k.code === 0 ? 'ok' : 'bad'}">${esc(k.cmd)} ${k.code === 0 ? 'pass' : 'exit ' + k.code}</span>`).join(' ');
      return `<section class="it">
  <header><span class="n">#${it.n}</span> <span class="agent">${esc(it.agent)}</span>${it.ritual ? ` <span class="ritual">ritual: ${esc(it.ritual)}</span>` : ''} <span class="meta">${fmtDuration(it.ms || 0)}${typeof it.cost === 'number' ? ' · ' + fmtMoney(it.cost) : ''}${it.metric !== null && it.metric !== undefined ? ' · metric ' + esc(it.metric) : ''}${it.commit ? ' · ' + esc(it.commit) : ''}${it.code ? ` · exit ${it.code}` : ''}</span></header>
  <div class="row"><div><h4>Changed</h4>${changed}</div><div><h4>Letter to the next iteration</h4>${it.letterFull ? `<pre class="letter">${esc(it.letterFull)}</pre>` : '<p class="muted">none</p>'}</div></div>
  <p class="tags">${verdict} ${resultTag} ${criticTag} ${violations} ${sig}</p>
  ${checks ? `<p class="tags">${checks}</p>` : ''}
  <details><summary>Agent output</summary><pre>${esc(out) || '(empty)'}</pre></details>
</section>`;
    })
    .join('\n');

  const spark = hasMetric ? sparkline(its.map((i) => i.metric), its.map((i) => i.result === 'reverted')) : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(start.name || 'loop')} · loop report</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--muted:#8b949e;--accent:#58d3ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--pink:#ff7bd0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 20px 80px}h1{font-size:28px;margin:0 0 4px}h1 span{color:var(--accent)}h4{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sub{color:var(--muted);margin-bottom:24px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.stat b{display:block;font-size:22px}.stat small{color:var(--muted)}
.spark{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:24px}.spark svg{width:100%;height:120px;display:block}.spark small{color:var(--muted)}
.it{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0;position:relative}
.it header{display:flex;gap:10px;align-items:baseline;margin-bottom:10px;flex-wrap:wrap}.n{font-weight:700;color:var(--accent);font-size:18px}.agent{font-weight:600}.ritual{color:var(--pink);font-size:13px}.meta{color:var(--muted);font-size:13px;margin-left:auto}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:700px){.row{grid-template-columns:1fr}}
pre{background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:auto;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px}
pre.letter{max-height:260px;border-left:3px solid var(--pink)}.files{margin:0;padding-left:18px;font:13px ui-monospace,monospace;columns:2;max-height:200px;overflow:auto}
.muted{color:var(--muted);margin:0}.tags{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}.v{font-weight:700;padding:2px 8px;border-radius:999px;font-size:12px}.v.done{background:rgba(63,185,80,.15);color:var(--ok)}.v.cont{background:rgba(88,211,255,.12);color:var(--accent)}.v.kept{background:rgba(63,185,80,.12);color:var(--ok)}.v.rev{background:rgba(248,81,73,.14);color:var(--bad)}
.why{color:var(--warn);font-size:13px}.sig{font:12px ui-monospace,monospace;color:var(--pink);background:rgba(255,123,208,.08);padding:2px 6px;border-radius:6px}
.chk{font:12px ui-monospace,monospace;padding:2px 6px;border-radius:6px;border:1px solid var(--line)}.chk.ok{color:var(--ok)}.chk.bad{color:var(--bad)}
details summary{cursor:pointer;color:var(--muted);font-size:13px}.status{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;background:${status === 'done' ? 'rgba(63,185,80,.15)' : 'rgba(210,153,34,.15)'};color:${status === 'done' ? 'var(--ok)' : 'var(--warn)'}}
footer{color:var(--muted);font-size:13px;margin-top:40px;text-align:center}
</style></head><body><main>
<h1><span>⟲</span> ${esc(start.name || 'loop')}</h1>
<p class="sub">run ${esc(id)} · ${esc((start.agents || []).join(' → '))} · until ${esc((start.until || []).join(' AND '))}${start.critic ? ' · critic ' + esc(start.critic) : ''} <span class="status">${esc(status)}</span>${end.reason ? ` <span class="why">${esc(end.reason)}</span>` : ''}</p>
<div class="stats">
  <div class="stat"><b>${its.length}</b><small>iterations</small></div>
  <div class="stat"><b>${fmtDuration(totalMs)}</b><small>elapsed</small></div>
  <div class="stat"><b>${files.size}</b><small>files touched</small></div>
  <div class="stat"><b>${cost ? fmtMoney(cost) : '—'}</b><small>cost</small></div>
  ${hasMetric ? `<div class="stat"><b>${esc(end.best ?? '—')}</b><small>best metric (baseline ${esc(baseline ?? '—')})</small></div><div class="stat"><b>${kept} / ${reverted}</b><small>kept / reverted</small></div>` : `<div class="stat"><b>${its.filter((i) => (i.signals || []).some((s) => s.tag === 'done')).length}</b><small>done claims</small></div>`}
</div>
${spark}
${cards || '<p class="muted">No iterations recorded.</p>'}
<footer>made with <b>⟲ loop</b> · loop engineering for AI agents</footer>
</main></body></html>
`;
}

function sparkline(values, revertedFlags) {
  const pts = values.map((v, i) => ({ i, v: typeof v === 'number' ? v : null, r: revertedFlags[i] }));
  const nums = pts.filter((p) => p.v !== null).map((p) => p.v);
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const W = 800;
  const H = 120;
  const pad = 14;
  const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, pts.length - 1);
  const y = (v) => (max === min ? H / 2 : H - pad - ((v - min) * (H - 2 * pad)) / (max - min));
  const keptPts = pts.filter((p) => p.v !== null && !p.r);
  const line = keptPts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = pts.filter((p) => p.v !== null).map((p) => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${p.r ? '#f85149' : '#3fb950'}"><title>#${p.i + 1}: ${p.v}${p.r ? ' (reverted)' : ''}</title></circle>`).join('');
  return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="metric per iteration"><path d="${line}" fill="none" stroke="#58d3ff" stroke-width="2"/>${dots}</svg><small>metric per iteration: green kept, red reverted · range ${min} to ${max}</small></div>`;
}
