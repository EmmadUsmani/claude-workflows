'use strict';

// JSON read/write helpers shared by build.js, excerpt.js, scaffold.js and annotate.js.
//
// Data files keep the distinction between `2` and `2.0` (`--optimize-rows` writes rows as
// floats), and every script rewrites or embeds the whole file, so a float that happens to be
// whole is parsed into a Number object and written back with its `.0`. Arithmetic and
// comparisons on a Number object work as usual; only `===` and truthiness differ, so compare
// with `==`/`<` and test presence with `== null`.

const FLOAT = '\u0000f:'; // internal marker for floats that must keep their ".0"

// JSON.parse, except that a whole-valued float (`2.0`, `1e3`) becomes `new Number(...)`.
function parse(text) {
  const marked = text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
    if (token[0] === '"' || !/[.eE]/.test(token) || !Number.isInteger(Number(token))) return token;
    return JSON.stringify(FLOAT + token);
  });
  return JSON.parse(marked, (_key, value) =>
    typeof value === 'string' && value.startsWith(FLOAT) ? new Number(Number(value.slice(FLOAT.length))) : value);
}

function formatNumber(value) {
  if (!(value instanceof Number)) return String(value);
  const number = value.valueOf();
  if (Object.is(number, -0)) return '-0.0';
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

// JSON.stringify(value) (indent 0) or JSON.stringify(value, null, 2), writing Number objects as floats.
function stringify(value, indent = 0, depth = 0) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || value instanceof Number) return formatNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  const pad = indent ? '\n' + ' '.repeat(indent * (depth + 1)) : '';
  const close = indent ? '\n' + ' '.repeat(indent * depth) : '';
  const colon = indent ? ': ' : ':';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[' + value.map((item) => pad + stringify(item, indent, depth + 1)).join(',') + close + ']';
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (keys.length === 0) return '{}';
  return '{' + keys.map((key) => pad + JSON.stringify(key) + colon + stringify(value[key], indent, depth + 1)).join(',') + close + '}';
}

const generate = (value) => stringify(value);
const prettyGenerate = (value) => stringify(value, 2);

// How a value reads when interpolated into a message: null/undefined as '', floats with their `.0`.
function toS(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || value instanceof Number) return formatNumber(value);
  if (typeof value === 'object') return inspect(value);
  return String(value);
}

// A value as the messages quote it: strings in double quotes with escapes, null as nil,
// arrays as [a, b], objects as {"k"=>v}.
function inspect(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number' || value instanceof Number) return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return '[' + value.map(inspect).join(', ') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).map((key) => `${inspect(key)}=>${inspect(value[key])}`).join(', ') + '}';
  }
  const named = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\f': '\\f', '\v': '\\v', '\b': '\\b', '\x07': '\\a', '\x1b': '\\e', '"': '\\"', '\\': '\\\\' };
  let out = '';
  const chars = [...value];
  chars.forEach((char, index) => {
    if (named[char]) out += named[char];
    else if (char === '#' && ['{', '$', '@'].includes(chars[index + 1])) out += '\\#';
    else if (/[\p{Cc}\p{Cs}\p{Cn}\u2028\u2029]/u.test(char)) {
      const code = char.codePointAt(0).toString(16).toUpperCase();
      out += code.length > 4 ? `\\u{${code}}` : `\\u${code.padStart(4, '0')}`;
    } else out += char;
  });
  return `"${out}"`;
}

module.exports = { parse, generate, prettyGenerate, toS, inspect };
