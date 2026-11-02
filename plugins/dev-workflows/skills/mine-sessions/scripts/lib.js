'use strict';

// Shared helpers for the mine-sessions scripts. They keep the output byte-identical with the
// original Python tools: string lengths and slices count code points (not UTF-16 units),
// "whitespace" is Python's set, numbers round half-to-even, and str()/repr()/json.dumps()
// formatting (key order, separators, ensure_ascii) matches Python's.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Characters Python's str.isspace() / re's \s accept.
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const LSTRIP = new RegExp(`^[${WS}]+`);
const RSTRIP = new RegExp(`[${WS}]+$`);
const strip = (s) => s.replace(LSTRIP, '').replace(RSTRIP, '');
const rstrip = (s) => s.replace(RSTRIP, '');
const splitWs = (s) => s.split(new RegExp(`[${WS}]+`)).filter((x) => x !== ''); // str.split()

// Code-point length and Python-style slice (negative indices count from the end).
const len = (s) => (/[\ud800-\udfff]/.test(s) ? Array.from(s).length : s.length);
const slice = (s, a, b) => (/[\ud800-\udfff]/.test(s) ? Array.from(s).slice(a, b).join('') : s.slice(a, b));
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// Python str ordering (by code point); JS's default sort compares UTF-16 units.
function cmp(a, b) {
  const A = Array.from(a);
  const B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d) return d;
  }
  return A.length - B.length;
}
const sorted = (arr) => [...arr].sort(cmp);

// format(x, '.Nf'): toFixed rounds exact ties up, Python rounds them to even.
function fixed(x, d) {
  const s = x.toFixed(d);
  const [ip, fp = ''] = Math.abs(x).toFixed(100).split('.');
  if (!/^50*$/.test(fp.slice(d))) return s;
  const last = d === 0 ? ip[ip.length - 1] : fp[d - 1];
  if (Number(last) % 2) return s;
  return (x < 0 ? '-' : '') + ip + (d ? '.' + fp.slice(0, d) : '');
}

// repr(float): shortest round-trip digits, exponent form below 1e-4 and from 1e16.
function num(x) {
  if (Number.isInteger(x)) return String(x);
  const [mant, e] = x.toExponential().split('e');
  const exp = Number(e);
  if (exp < -4 || exp >= 16) return `${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  const neg = mant.startsWith('-');
  const digits = mant.replace(/^-/, '').replace('.', '');
  let out;
  if (exp < 0) out = '0.' + '0'.repeat(-exp - 1) + digits;
  else if (digits.length > exp + 1) out = digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  else out = digits + '0'.repeat(exp + 1 - digits.length) + '.0';
  return (neg ? '-' : '') + out;
}

const NONPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
function reprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NONPRINTABLE.test(ch)) {
      const h = cp.toString(16);
      out += cp < 0x100 ? '\\x' + h.padStart(2, '0') : cp < 0x10000 ? '\\u' + h.padStart(4, '0') : '\\U' + h.padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

const isMap = (v) => v instanceof Map;
const entries = (v) => (isMap(v) ? [...v] : Object.entries(v));

function repr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return reprStr(v);
  if (Array.isArray(v)) return '[' + v.map(repr).join(', ') + ']';
  return '{' + entries(v).map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(', ') + '}';
}
const str = (v) => (typeof v === 'string' ? v : repr(v)); // f"{v}" / str(v)

function jsonStr(s, ensureAscii) {
  const out = JSON.stringify(s);
  return ensureAscii ? out.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : out;
}

// json.dumps(v, indent=…, ensure_ascii=…). Maps keep insertion order (plain objects would hoist
// integer-like keys).
function dumps(v, { indent = null, ensureAscii = true } = {}, level = 0) {
  const nl = (l) => (indent === null ? '' : '\n' + ' '.repeat(indent * l));
  const sep = indent === null ? ', ' : ',';
  const opts = { indent, ensureAscii };
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return jsonStr(v, ensureAscii);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[' + v.map((x) => nl(level + 1) + dumps(x, opts, level + 1)).join(sep) + nl(level) + ']';
  }
  const es = entries(v);
  if (!es.length) return '{}';
  return '{' + es.map(([k, x]) => nl(level + 1) + jsonStr(k, ensureAscii) + ': ' + dumps(x, opts, level + 1)).join(sep) + nl(level) + '}';
}

// Python truthiness for JSON values.
const truthy = (v) => !(v === null || v === undefined || v === false || v === 0 || v === '' ||
  (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length));

// dict.get(key, default)
const get = (o, k, d = null) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d);

// int(s)
function int(s) {
  const t = strip(String(s));
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) {
    process.stderr.write(`ValueError: invalid literal for int() with base 10: ${reprStr(String(s))}\n`);
    process.exit(1);
  }
  return parseInt(t.replace(/_/g, ''), 10);
}

class Counter {
  constructor() { this.m = new Map(); }
  add(k, n = 1) { this.m.set(k, (this.m.get(k) || 0) + n); }
  get size() { return this.m.size; }
  total() { let t = 0; for (const v of this.m.values()) t += v; return t; }
  mostCommon(n) {
    const all = [...this.m].sort((a, b) => b[1] - a[1]); // stable: ties keep insertion order
    return n === undefined ? all : all.slice(0, n);
  }
}

// open(p).read(): text mode turns \r\n and \r into \n.
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

const expanduser = (p) => (p === '~' || p.startsWith('~/') ? os.homedir() + p.slice(1) : p);

// glob(os.path.join(dir, "*<suffix>")): non-hidden entries of dir ending in suffix, full paths.
function globDir(dir, suffix = '') {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && n.endsWith(suffix)).map((n) => path.join(dir, n));
}
// os.path.join (no normalisation; an absolute part restarts the path)
const join = (...parts) => parts.reduce((a, b) => (b.startsWith('/') ? b : a === '' || a.endsWith('/') ? a + b : a + '/' + b));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

module.exports = {
  strip, rstrip, splitWs, len, slice, bytes, cmp, sorted, fixed, num, repr, str, dumps,
  truthy, get, int, Counter, readText, expanduser, globDir, join, isDir,
};
