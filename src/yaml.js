/**
 * A small YAML subset parser for Loopfile frontmatter. Zero dependencies.
 * Supports: maps, nested maps, block lists, lists of maps, inline [lists] and {maps},
 * quoted/unquoted scalars, comments, and | / > block scalars. That is all a Loopfile needs.
 */

export function parseYAML(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const p = new Parser(lines);
  const first = p.peek();
  if (!first) return {};
  const value = p.parseBlock(first.indent);
  const extra = p.peek();
  if (extra) throw new Error(`yaml: unexpected content at line ${p.i + 1}: "${extra.text}"`);
  return value === null ? {} : value;
}

class Parser {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }

  peek() {
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i];
      const text = raw.trim();
      if (text === '' || text.startsWith('#')) {
        this.i++;
        continue;
      }
      const indent = raw.match(/^ */)[0].length;
      return { indent, text, raw };
    }
    return null;
  }

  parseBlock(indent) {
    const t = this.peek();
    if (!t || t.indent < indent) return null;
    if (isListItem(t.text)) return this.parseList(t.indent);
    return this.parseMap(t.indent);
  }

  parseMap(indent) {
    const obj = {};
    for (;;) {
      const t = this.peek();
      if (!t || t.indent < indent) break;
      if (t.indent > indent) throw new Error(`yaml: bad indentation at line ${this.i + 1}: "${t.text}"`);
      if (isListItem(t.text)) break;
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#]+?)\s*:(?:\s+(.*)|$)/.exec(t.text);
      if (!m) throw new Error(`yaml: expected "key: value" at line ${this.i + 1}: "${t.text}"`);
      const key = unquoteKey(m[1]);
      this.i++;
      const rest = stripComment(m[2] ?? '').trim();
      if (rest === '') {
        const next = this.peek();
        if (next && next.indent > indent) obj[key] = this.parseBlock(next.indent);
        else if (next && next.indent === indent && isListItem(next.text)) obj[key] = this.parseList(indent);
        else obj[key] = null;
      } else if (isBlockScalarMarker(rest)) {
        obj[key] = this.parseBlockScalar(indent, rest);
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  parseList(indent) {
    const arr = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.indent !== indent || !isListItem(t.text)) break;
      this.i++;
      const rest = stripComment(t.text === '-' ? '' : t.text.slice(2)).trim();
      if (rest === '') {
        const next = this.peek();
        arr.push(next && next.indent > indent ? this.parseBlock(next.indent) : null);
      } else if (/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_.\-]+)\s*:(\s|$)/.test(rest)) {
        // "- key: value" starts an inline map item; re-inject the line at the key indent.
        const keyIndent = indent + 2;
        this.lines[this.i - 1] = ' '.repeat(keyIndent) + rest;
        this.i--;
        arr.push(this.parseMap(keyIndent));
      } else if (isBlockScalarMarker(rest)) {
        arr.push(this.parseBlockScalar(indent, rest));
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  parseBlockScalar(parentIndent, marker) {
    const out = [];
    let blockIndent = null;
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i];
      if (raw.trim() === '') {
        out.push('');
        this.i++;
        continue;
      }
      const ind = raw.match(/^ */)[0].length;
      if (ind <= parentIndent) break;
      if (blockIndent === null) blockIndent = ind;
      out.push(raw.slice(Math.min(ind, blockIndent)));
      this.i++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    let s = out.join('\n');
    if (marker.startsWith('>')) s = s.replace(/([^\n])\n(?!\n)/g, '$1 ');
    return marker.endsWith('-') ? s : s + '\n';
  }
}

function unquoteKey(raw) {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    const v = parseScalar(s);
    return typeof v === 'string' ? v : s.slice(1, -1);
  }
  return s;
}

function isListItem(text) {
  return text === '-' || text.startsWith('- ');
}

function isBlockScalarMarker(s) {
  return /^[|>][+-]?$/.test(s);
}

function stripComment(s) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS && s[i - 1] !== '\\') inD = !inD;
    else if (ch === '#' && !inS && !inD && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

export function parseScalar(raw) {
  const s = String(raw).trim();
  if (s === '') return null;
  if (s.startsWith('"')) {
    const end = s.lastIndexOf('"');
    try {
      return JSON.parse(s.slice(0, end + 1).replace(/\n/g, '\\n'));
    } catch {
      return s; // not valid JSON-style quoting; keep the raw text rather than failing the whole file
    }
  }
  if (s.startsWith("'")) {
    const end = s.lastIndexOf("'");
    return s.slice(1, end).replace(/''/g, "'");
  }
  if (s.startsWith('[')) return splitInline(s.slice(1, s.lastIndexOf(']'))).map(parseScalar);
  if (s.startsWith('{')) {
    const obj = {};
    for (const part of splitInline(s.slice(1, s.lastIndexOf('}')))) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      obj[parseScalar(part.slice(0, idx))] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  if (s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === 'no' || s === 'off') return false;
  if (s === 'null' || s === '~') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function splitInline(s) {
  const parts = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (ch === '[' || ch === '{')) depth++;
    else if (!inS && !inD && (ch === ']' || ch === '}')) depth--;
    if (ch === ',' && !inS && !inD && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

/** Serialize a plain object to simple YAML (used by `init`). */
export function toYAML(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${pad}${k}: []`);
      else if (v.every((x) => typeof x !== 'object' || x === null)) lines.push(`${pad}${k}: [${v.map(scalarToYAML).join(', ')}]`);
      else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          const inner = toYAML(item, indent + 4).split('\n');
          lines.push(`${pad}  - ${inner[0].trimStart()}`);
          for (const l of inner.slice(1)) lines.push(l);
        }
      }
    } else if (v && typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(toYAML(v, indent + 2));
    } else lines.push(`${pad}${k}: ${scalarToYAML(v)}`);
  }
  return lines.join('\n');
}

function scalarToYAML(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^[A-Za-z0-9_./-]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/.test(s) && !/^[-+]?\d/.test(s)) return s;
  return JSON.stringify(s);
}
