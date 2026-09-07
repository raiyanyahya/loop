import { fmtDuration, fmtMoney } from './util.js';

/** POST a small JSON payload to a webhook (Slack, Discord, or anything that accepts JSON). Never throws. */
export async function notify(url, payload) {
  if (!url || typeof fetch !== 'function') return false;
  const text = describe(payload);
  const body = JSON.stringify({ text, content: text, ...payload });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function describe(p) {
  const bits = [`loop ${p.loop}: ${p.status}`];
  if (p.iteration) bits.push(`${p.iteration} iteration${p.iteration === 1 ? '' : 's'}`);
  if (p.elapsedMs) bits.push(fmtDuration(p.elapsedMs));
  if (p.cost) bits.push(fmtMoney(p.cost));
  if (p.best !== undefined && p.best !== null) bits.push(`metric ${p.best}`);
  let s = bits.join(' - ');
  if (p.question) s += `\nThe agent asks: ${p.question}`;
  else if (p.reason) s += `\n${p.reason}`;
  return s;
}
