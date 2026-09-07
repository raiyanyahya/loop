/**
 * The loop protocol: how an agent talks back to the loop, in plain text.
 * A signal counts only when its opening tag starts a line, so the agent can talk
 * *about* the protocol without triggering it.
 *
 *   worker:
 *   <loop:done/>                        everything is finished and verified
 *   <loop:stuck>reason</loop:stuck>     a human must intervene; the loop stops
 *   <loop:ask>question</loop:ask>       pause and wait for a human answer
 *   <loop:handoff>codex</loop:handoff>  next iteration runs on another agent
 *   <loop:sleep>10m</loop:sleep>        wait before the next iteration
 *   <loop:note>text</loop:note>         append a line to the loop journal
 *
 *   critic:
 *   <loop:approve/>                     the work is acceptable
 *   <loop:reject>reasons</loop:reject>  the work is not; reasons feed the next iteration
 */

export const PROTOCOL_TAGS = ['done', 'stuck', 'ask', 'handoff', 'sleep', 'note', 'approve', 'reject'];

export function parseSignals(text) {
  const out = { done: false, stuck: null, ask: null, handoff: null, sleep: null, notes: [], approve: false, reject: null, raw: [] };
  if (!text) return out;
  const src = String(text);
  const re = /^[ \t]*<loop:(done|stuck|ask|handoff|sleep|note|approve|reject)(?:\s*\/>|\s*>([\s\S]*?)<\/loop:\1\s*>|\s*>)/gim;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1].toLowerCase();
    const body = (m[2] ?? '').trim();
    out.raw.push({ tag, body });
    if (tag === 'done') out.done = true;
    else if (tag === 'stuck') out.stuck = body || 'no reason given';
    else if (tag === 'ask') out.ask = body || null;
    else if (tag === 'handoff') out.handoff = body.toLowerCase().replace(/[^a-z0-9_.-]/g, '') || null;
    else if (tag === 'sleep') out.sleep = body || null;
    else if (tag === 'note' && body) out.notes.push(body);
    else if (tag === 'approve') out.approve = true;
    else if (tag === 'reject') out.reject = body || 'no reasons given';
  }
  return out;
}

export function describeSignals(sig) {
  const parts = [];
  if (sig.done) parts.push('done');
  if (sig.stuck) parts.push(`stuck: ${sig.stuck}`);
  if (sig.ask) parts.push(`asks: ${sig.ask}`);
  if (sig.handoff) parts.push(`handoff → ${sig.handoff}`);
  if (sig.sleep) parts.push(`sleep ${sig.sleep}`);
  if (sig.approve) parts.push('approve');
  if (sig.reject) parts.push(`reject: ${sig.reject}`);
  if (sig.notes.length) parts.push(`${sig.notes.length} note(s)`);
  return parts.join(' · ');
}
