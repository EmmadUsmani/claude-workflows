'use strict';

// compat.js — the small runtime ff.js and dashboard.js share. Node built-ins only.
//
// state.json is written by many ticks over many months, possibly by different
// versions of these scripts, and is diffed in a git history. So the exact bytes
// matter: this module pins down the details plain JSON.parse/JSON.stringify and
// Date would otherwise change behind the caller's back —
//   - numbers keep their kind: `1` stays an integer and `1.0` stays a float
//     (Float), and both print back exactly as they were read;
//   - JSON syntax errors carry a stable "<what> at line L column C" message;
//   - "Ruby-style" truthiness (only null/undefined/false are false — "" and 0 are
//     values), string conversion, inspect() for error messages, and split/strip;
//   - timestamps: chat ts ("<epoch>.<micros>") and ISO-8601 instants, local-time
//     strftime, and UTC ISO stamps with whole seconds.

const fs = require('fs');
const os = require('os');
const path = require('path');

// --- process output ---------------------------------------------------------

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function lineOf(text) {
  const s = text === undefined || text === null ? '' : String(text);
  return s.endsWith('\n') ? s : `${s}\n`;
}

// puts / warn: one trailing newline, never two.
function puts(text = '') { process.stdout.write(lineOf(text)); }
function warn(text = '') { process.stderr.write(lineOf(text)); }

// Print to stderr and stop with exit 1 (unwinds to main, which sets the code).
function abort(text) {
  warn(text);
  throw new Exit(1);
}

// Run a `main(argv) -> exit code` function as the process entry point.
function run(main) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    code = error.code;
  }
  process.exitCode = code;
}

// --- value kinds ------------------------------------------------------------

// A JSON number written with a fraction or exponent. Kept distinct from integers
// so `1.0` round-trips as `1.0`, and integer-only settings can reject it.
class Float {
  constructor(value) { this.value = value; }
  valueOf() { return this.value; }
}

const isFloat = (value) => value instanceof Float;
const isInteger = (value) => (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'bigint';
const isHash = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !isFloat(value);
const isString = (value) => typeof value === 'string';
// Only null/undefined/false are falsy; '' and 0 are ordinary values.
const rt = (value) => value !== null && value !== undefined && value !== false;
const nil = (value) => value === null || value === undefined;

function className(value) {
  if (nil(value)) return 'NilClass';
  if (value === true) return 'TrueClass';
  if (value === false) return 'FalseClass';
  if (isString(value)) return 'String';
  if (isFloat(value) || (typeof value === 'number' && !Number.isInteger(value))) return 'Float';
  if (isInteger(value)) return 'Integer';
  if (Array.isArray(value)) return 'Array';
  return 'Hash';
}

// --- numbers ----------------------------------------------------------------

function shortestDigits(x) {
  const [mantissa, exponent] = Math.abs(x).toExponential().split('e');
  return { digits: mantissa.replace('.', ''), exponent: parseInt(exponent, 10) };
}

// Float to string for messages: 1.0, 0.0001, 1.0e-05, 1.5e+16.
function floatToS(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const { digits, exponent } = shortestDigits(x);
  const decpt = exponent + 1;
  // Fixed notation up to 15 integer digits, or 16 when there is also a fraction.
  if (decpt > -4 && (decpt <= 15 || (decpt === 16 && digits.length > 16))) {
    if (decpt <= 0) return `${sign}0.${'0'.repeat(-decpt)}${digits}`;
    if (decpt >= digits.length) return `${sign}${digits}${'0'.repeat(decpt - digits.length)}.0`;
    return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }
  const fraction = digits.length > 1 ? digits.slice(1) : '0';
  const e = Math.abs(exponent);
  return `${sign}${digits[0]}.${fraction}e${exponent < 0 ? '-' : '+'}${e < 10 ? `0${e}` : e}`;
}

// Grisu2 digit generation (Loitsch; the fpconv variant): the digits JSON output
// uses for a float, plus the decimal exponent K of the last digit. Usually the
// shortest round-trip digits; for some 16-17 digit values it picks a different
// (equally round-tripping) last digit, and JSON output must match it exactly.
const U64 = (1n << 64n) - 1n;
const POWERS_TEN = [
  [18054884314459144840n, -1220], [13451937075301367670n, -1193], [10022474136428063862n, -1166],
  [14934650266808366570n, -1140], [11127181549972568877n, -1113], [16580792590934885855n, -1087],
  [12353653155963782858n, -1060], [18408377700990114895n, -1034], [13715310171984221708n, -1007],
  [10218702384817765436n, -980], [15227053142812498563n, -954], [11345038669416679861n, -927],
  [16905424996341287883n, -901], [12595523146049147757n, -874], [9384396036005875287n, -847],
  [13983839803942852151n, -821], [10418772551374772303n, -794], [15525180923007089351n, -768],
  [11567161174868858868n, -741], [17236413322193710309n, -715], [12842128665889583758n, -688],
  [9568131466127621947n, -661], [14257626930069360058n, -635], [10622759856335341974n, -608],
  [15829145694278690180n, -582], [11793632577567316726n, -555], [17573882009934360870n, -529],
  [13093562431584567480n, -502], [9755464219737475723n, -475], [14536774485912137811n, -449],
  [10830740992659433045n, -422], [16139061738043178685n, -396], [12024538023802026127n, -369],
  [17917957937422433684n, -343], [13349918974505688015n, -316], [9946464728195732843n, -289],
  [14821387422376473014n, -263], [11042794154864902060n, -236], [16455045573212060422n, -210],
  [12259964326927110867n, -183], [18268770466636286478n, -157], [13611294676837538539n, -130],
  [10141204801825835212n, -103], [15111572745182864684n, -77], [11258999068426240000n, -50],
  [16777216000000000000n, -24], [12500000000000000000n, 3], [9313225746154785156n, 30],
  [13877787807814456755n, 56], [10339757656912845936n, 83], [15407439555097886824n, 109],
  [11479437019748901445n, 136], [17105694144590052135n, 162], [12744735289059618216n, 189],
  [9495567745759798747n, 216], [14149498560666738074n, 242], [10542197943230523224n, 269],
  [15709099088952724970n, 295], [11704190886730495818n, 322], [17440603504673385349n, 348],
  [12994262207056124023n, 375], [9681479787123295682n, 402], [14426529090290212157n, 428],
  [10748601772107342003n, 455], [16016664761464807395n, 481], [11933345169920330789n, 508],
  [17782069995880619868n, 534], [13248674568444952270n, 561], [9871031767461413346n, 588],
  [14708983551653345445n, 614], [10959046745042015199n, 641], [16330252207878254650n, 667],
  [12166986024289022870n, 694], [18130221999122236476n, 720], [13508068024458167312n, 747],
  [10064294952495520794n, 774], [14996968138956309548n, 800], [11173611982879273257n, 827],
  [16649979327439178909n, 853], [12405201291620119593n, 880], [9242595204427927429n, 907],
  [13772540099066387757n, 933], [10261342003245940623n, 960], [15290591125556738113n, 986],
  [11392378155556871081n, 1013], [16975966327722178521n, 1039], [12648080533535911531n, 1066]
];
const TENS = [10000000000000000000n, 1000000000000000000n, 100000000000000000n, 10000000000000000n, 1000000000000000n,
  100000000000000n, 10000000000000n, 1000000000000n, 100000000000n, 10000000000n, 1000000000n, 100000000n,
  10000000n, 1000000n, 100000n, 10000n, 1000n, 100n, 10n, 1n];
const HIDDEN_BIT = 0x0010000000000000n;

function grisuMultiply(a, b) {
  const lomask = 0xffffffffn;
  const ahBl = (a.frac >> 32n) * (b.frac & lomask);
  const alBh = (a.frac & lomask) * (b.frac >> 32n);
  const alBl = (a.frac & lomask) * (b.frac & lomask);
  const ahBh = (a.frac >> 32n) * (b.frac >> 32n);
  let tmp = (ahBl & lomask) + (alBh & lomask) + (alBl >> 32n);
  tmp += 1n << 31n;
  return { frac: (ahBh + (ahBl >> 32n) + (alBh >> 32n) + (tmp >> 32n)) & U64, exp: a.exp + b.exp + 64 };
}

function grisuDigits(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const w = { frac: bits & 0x000fffffffffffffn, exp: Number((bits & 0x7ff0000000000000n) >> 52n) };
  if (w.exp) {
    w.frac += HIDDEN_BIT;
    w.exp -= 1023 + 52;
  } else {
    w.exp = -(1023 + 52) + 1;
  }

  // Boundaries of the rounding interval, then normalise w.
  const upper = { frac: (w.frac << 1n) + 1n, exp: w.exp - 1 };
  while ((upper.frac & (HIDDEN_BIT << 1n)) === 0n) {
    upper.frac <<= 1n;
    upper.exp -= 1;
  }
  upper.frac = (upper.frac << 10n) & U64;
  upper.exp -= 10;
  const lShift = w.frac === HIDDEN_BIT ? 2 : 1;
  const lower = { frac: (w.frac << BigInt(lShift)) - 1n, exp: w.exp - lShift };
  lower.frac = (lower.frac << BigInt(lower.exp - upper.exp)) & U64;
  lower.exp = upper.exp;
  while ((w.frac & HIDDEN_BIT) === 0n) {
    w.frac <<= 1n;
    w.exp -= 1;
  }
  w.frac = (w.frac << 11n) & U64;
  w.exp -= 11;

  // Cached power of ten that brings the exponent into [-60, -32].
  const approx = Math.trunc(-(upper.exp + 87) * 0.30102999566398114);
  let idx = Math.trunc((approx + 348) / 8);
  for (;;) {
    const current = upper.exp + POWERS_TEN[idx][1] + 64;
    if (current < -60) idx += 1;
    else if (current > -32) idx -= 1;
    else break;
  }
  const cp = { frac: POWERS_TEN[idx][0], exp: POWERS_TEN[idx][1] };
  let K = -(-348 + idx * 8);
  const wp = grisuMultiply(w, cp);
  const up = grisuMultiply(upper, cp);
  const lo = grisuMultiply(lower, cp);
  lo.frac = (lo.frac + 1n) & U64;
  up.frac = (up.frac - 1n) & U64;

  const digits = [];
  const roundDigit = (delta, rem, kappa, frac) => {
    while (rem < frac && ((delta - rem) & U64) >= kappa &&
           (((rem + kappa) & U64) < frac || ((frac - rem) & U64) > ((rem + kappa - frac) & U64))) {
      digits[digits.length - 1] -= 1;
      rem = (rem + kappa) & U64;
    }
  };
  const wfrac = (up.frac - wp.frac) & U64;
  let delta = (up.frac - lo.frac) & U64;
  const shift = BigInt(-up.exp);
  const one = 1n << shift;
  let part1 = up.frac >> shift;
  let part2 = up.frac & (one - 1n);
  let kappa = 10;
  for (let d = 10; kappa > 0; d += 1) {
    const div = TENS[d];
    const digit = part1 / div;
    if (digit || digits.length) digits.push(Number(digit));
    part1 -= digit * div;
    kappa -= 1;
    const tmp = ((part1 << shift) & U64) + part2;
    if (tmp <= delta) {
      K += kappa;
      roundDigit(delta, tmp, (div << shift) & U64, wfrac);
      return { digits: digits.join(''), K };
    }
  }
  for (let unit = 18; ; unit -= 1) {
    part2 = (part2 * 10n) & U64;
    delta = (delta * 10n) & U64;
    kappa -= 1;
    const digit = part2 >> shift;
    if (digit || digits.length) digits.push(Number(digit));
    part2 &= one - 1n;
    if (part2 < delta) {
      K += kappa;
      roundDigit(delta, part2, one, (wfrac * TENS[unit]) & U64);
      return { digits: digits.join(''), K };
    }
  }
}

// Float as written into JSON: 1.0, 0.000015, 1e+20.
function jsonFloat(x) {
  if (!Number.isFinite(x)) throw new Error(`${floatToS(x)} not allowed in JSON`);
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const neg = x < 0;
  const sign = neg ? '-' : '';
  let { digits, K } = grisuDigits(x);
  let ndigits = digits.length;
  const exp = Math.abs(K + ndigits - 1);
  if (K >= 0 && exp < 15) return `${sign}${digits}${'0'.repeat(K)}.0`;
  if (K < 0 && (K > -7 || exp < 10)) {
    const offset = ndigits - Math.abs(K);
    if (offset <= 0) return `${sign}0.${'0'.repeat(-offset)}${digits}`;
    return `${sign}${digits.slice(0, offset)}.${digits.slice(offset)}`;
  }
  ndigits = Math.min(ndigits, 18 - (neg ? 1 : 0));
  digits = digits.slice(0, ndigits);
  let out = `${sign}${digits[0]}${ndigits > 1 ? `.${digits.slice(1)}` : ''}e${K + ndigits - 1 < 0 ? '-' : '+'}`;
  let rest = exp;
  let cent = 0;
  if (rest > 99) {
    cent = Math.floor(rest / 100);
    out += cent;
    rest -= cent * 100;
  }
  if (rest > 9) {
    const dec = Math.floor(rest / 10);
    out += dec;
    rest -= dec * 10;
  } else if (cent) {
    out += '0';
  }
  return out + (rest % 10);
}

// Leading-number parse of a string: "12abc" -> 12, "abc" -> 0, "1_000" -> 1000.
function toI(value) {
  if (nil(value)) return 0;
  if (isFloat(value)) return Math.trunc(value.value);
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'bigint') return value;
  const match = /^[\t\n\v\f\r ]*([+-]?)(\d+(?:_\d+)*)/.exec(String(value));
  return match ? Number(`${match[1]}${match[2].replace(/_/g, '')}`) : 0;
}

function toF(value) {
  if (nil(value)) return 0;
  if (isFloat(value)) return value.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const match = /^[\t\n\v\f\r ]*([+-]?)(\d+(?:_\d+)*)?(?:\.(\d+(?:_\d+)*))?(?:[eE]([+-]?\d+))?/.exec(String(value));
  if (!match || (match[2] === undefined && match[3] === undefined)) return 0;
  const whole = (match[2] || '0').replace(/_/g, '');
  const fraction = match[3] ? `.${match[3].replace(/_/g, '')}` : '';
  const exponent = match[4] ? `e${match[4]}` : '';
  return Number(`${match[1]}${whole}${fraction}${exponent}`);
}

// --- strings ----------------------------------------------------------------

const STRIP_SET = '[\\0\\t\\n\\v\\f\\r ]';
const strip = (text) => String(text).replace(new RegExp(`^${STRIP_SET}+`), '').replace(new RegExp(`${STRIP_SET}+$`), '');
const rstrip = (text) => String(text).replace(new RegExp(`${STRIP_SET}+$`), '');

// Replace the first match of `pattern` with `replacement`, where the replacement may
// refer to the match: \0 or \& (whole match), \1..\9 (groups), \` and \' (before /
// after), \\ (a backslash). Any other backslash pair is kept as written.
function subFirst(text, pattern, replacement) {
  const match = pattern.exec(text);
  if (!match) return text;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const expanded = replacement.replace(/\\(\d|&|`|'|\\)/g, (pair, code) => {
    if (code === '&' || code === '0') return match[0];
    if (/\d/.test(code)) return match[Number(code)] || '';
    if (code === '`') return before;
    if (code === "'") return after;
    return '\\';
  });
  return before + expanded + after;
}

// Character (code point) aware helpers.
const chars = (text) => Array.from(String(text));
const charLength = (text) => chars(text).length;
const charSlice = (text, start, length) => chars(text).slice(start, start + length).join('');
const ljust = (text, width) => {
  const s = String(text);
  const n = charLength(s);
  return n >= width ? s : s + ' '.repeat(width - n);
};

// split(sep) that drops trailing empty fields: "a.".split('.') -> ["a"], "" -> [].
function split(text, separator) {
  const parts = String(text).split(separator);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function inspectString(text) {
  let out = '"';
  const list = chars(text);
  list.forEach((ch, index) => {
    const code = ch.codePointAt(0);
    const next = list[index + 1];
    switch (ch) {
      case '"': out += '\\"'; return;
      case '\\': out += '\\\\'; return;
      case '\n': out += '\\n'; return;
      case '\t': out += '\\t'; return;
      case '\r': out += '\\r'; return;
      case '\f': out += '\\f'; return;
      case '\v': out += '\\v'; return;
      case '\b': out += '\\b'; return;
      case '\x07': out += '\\a'; return;
      case '\x1b': out += '\\e'; return;
      case '#':
        out += next === '{' || next === '$' || next === '@' ? '\\#' : '#';
        return;
      default:
        break;
    }
    if (/[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\p{Cn}]/u.test(ch)) {
      const hex = code.toString(16).toUpperCase();
      out += code > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
    } else {
      out += ch;
    }
  });
  return `${out}"`;
}

// The debugging representation used in error messages: "str", nil, 1.0, ["a", 1], {"k"=>v}.
function inspect(value) {
  if (nil(value)) return 'nil';
  if (value === true || value === false) return String(value);
  if (isString(value)) return inspectString(value);
  if (isFloat(value)) return floatToS(value.value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatToS(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(inspect).join(', ')}]`;
  return `{${Object.keys(value).map((key) => `${inspect(key)}=>${inspect(value[key])}`).join(', ')}}`;
}

// String conversion as used by interpolation: nil -> "", 1.0 -> "1.0", [..] -> inspect.
function toS(value) {
  if (nil(value)) return '';
  if (isString(value)) return value;
  if (isFloat(value)) return floatToS(value.value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatToS(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === true || value === false) return String(value);
  return inspect(value);
}

// --- collections ------------------------------------------------------------

// Nested lookup that is nil-safe but refuses to walk through a non-container.
function dig(container, ...keys) {
  let cursor = container;
  for (const key of keys) {
    if (nil(cursor)) return null;
    if (Array.isArray(cursor)) {
      if (!isInteger(key)) throw new TypeError(`no implicit conversion of ${className(key)} into Integer`);
      cursor = cursor[key < 0 ? cursor.length + Number(key) : Number(key)];
    } else if (isHash(cursor)) {
      cursor = Object.prototype.hasOwnProperty.call(cursor, key) ? cursor[key] : undefined;
    } else {
      throw new TypeError(`${className(cursor)} does not have #dig method`);
    }
    if (cursor === undefined) cursor = null;
  }
  return cursor === undefined ? null : cursor;
}

// Array(value): nil -> [], an array as is, an object -> its [key, value] pairs, else [value].
function arrayOf(value) {
  if (nil(value)) return [];
  if (Array.isArray(value)) return value;
  if (isHash(value)) return Object.entries(value);
  return [value];
}

// join that flattens nested arrays and stringifies each element.
function joinFlat(list, separator) {
  return list.flat(Infinity).map(toS).join(separator);
}

const has = (hash, key) => Object.prototype.hasOwnProperty.call(hash, key);
// hash[key], or `fallback` only when the key is absent (a present null stays null).
const fetch = (hash, key, fallback) => (has(hash, key) ? hash[key] : fallback);
const get = (hash, key) => (has(hash, key) ? hash[key] : null);

function uniqKey(value) {
  if (isHash(value)) return `H${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${uniqKey(value[key])}`).join(',')}`;
  if (Array.isArray(value)) return `A[${value.map(uniqKey).join(',')}]`;
  return `${className(value)}:${toS(value)}`;
}

function uniq(list) {
  const seen = new Set();
  return list.filter((value) => {
    const key = uniqKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// obj[key] = value, safe for a key named "__proto__" (stored as plain data).
function setKey(object, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    object[key] = value;
  }
}

function deepMerge(base, overlay) {
  const merged = {};
  for (const key of Object.keys(base)) setKey(merged, key, base[key]);
  for (const key of Object.keys(overlay)) {
    const oldValue = merged[key];
    const newValue = overlay[key];
    setKey(merged, key, has(base, key) && isHash(oldValue) && isHash(newValue) ? deepMerge(oldValue, newValue) : newValue);
  }
  return merged;
}

// --- JSON: parse ------------------------------------------------------------

class JSONParserError extends Error {}

const FRAGMENT_LEN = 32;

function parseJSON(source) {
  const buf = Buffer.isBuffer(source) ? source : Buffer.from(String(source), 'utf8');
  const end = buf.length;
  let cursor = 0;

  const byteAt = (index) => (index < end ? buf[index] : 0);
  const peek = () => byteAt(cursor);
  const eos = () => cursor >= end;

  function fragment() {
    if (cursor >= end) return 'EOF';
    let len = 0;
    while (len < FRAGMENT_LEN) {
      const ch = byteAt(cursor + len);
      if (!ch || ch === 0x0a || ch === 0x20 || ch === 0x09 || ch === 0x0d) break;
      len += 1;
    }
    if (!len) {
      let stop = cursor;
      while (stop < end && buf[stop] !== 0) stop += 1;
      return buf.toString('utf8', cursor, stop);
    }
    const bytes = [0x27];
    for (let i = 0; i < len; i += 1) bytes.push(buf[cursor + i]);
    while (bytes[len] >= 0x80 && bytes[len] < 0xc0) len -= 1;
    if (bytes[len] >= 0xc0) len -= 1;
    return `'${Buffer.from(bytes.slice(1, len + 1)).toString('utf8')}'`;
  }

  function position() {
    let at = cursor;
    let column = 0;
    let line = 1;
    while (at >= 0) {
      const ch = byteAt(at);
      at -= 1;
      if (ch === 0x0a) {
        line += 1;
        break;
      }
      column += 1;
    }
    while (at >= 0) {
      if (buf[at] === 0x0a) line += 1;
      at -= 1;
    }
    return { line, column };
  }

  function fail(format, at) {
    if (at !== undefined) cursor = at;
    const message = format.includes('%s') ? format.replace('%s', fragment()) : format;
    const { line, column } = position();
    throw new JSONParserError(`${message} at line ${line} column ${column}`);
  }

  function eatComment() {
    const start = cursor;
    cursor += 1;
    const next = peek();
    if (next === 0x2f) {
      const newline = buf.indexOf(0x0a, cursor);
      cursor = newline === -1 ? end : newline + 1;
    } else if (next === 0x2a) {
      cursor += 1;
      for (;;) {
        const star = buf.indexOf(0x2a, cursor);
        if (star === -1) fail("unterminated comment, expected closing '*/'", start);
        cursor = star + 1;
        if (peek() === 0x2f) {
          cursor += 1;
          break;
        }
      }
    } else {
      fail('unexpected token %s', start);
    }
  }

  function eatWhitespace() {
    for (;;) {
      const ch = peek();
      if (ch === 0x20 || ch === 0x0a || ch === 0x09 || ch === 0x0d) cursor += 1;
      else if (ch === 0x2f) eatComment();
      else return;
    }
  }

  function matchKeyword(keyword) {
    if (end - cursor >= keyword.length && buf.toString('latin1', cursor, cursor + keyword.length) === keyword) {
      cursor += keyword.length;
      return;
    }
    fail('unexpected token %s');
  }

  const isDigit = (ch) => ch >= 0x30 && ch <= 0x39;
  function digits() {
    const start = cursor;
    while (isDigit(peek())) cursor += 1;
    return cursor - start;
  }

  // undefined when malformed; the caller reports it at the number's start.
  function parseNumber(negative, start) {
    let integer = true;
    const first = peek();
    const count = digits();
    if ((first === 0x30 && count > 1) || (negative && count === 0)) return undefined;
    if (peek() === 0x2e) {
      integer = false;
      cursor += 1;
      if (!digits()) return undefined;
    }
    if (peek() === 0x65 || peek() === 0x45) {
      integer = false;
      cursor += 1;
      if (peek() === 0x2d || peek() === 0x2b) cursor += 1;
      if (!digits()) return undefined;
    }
    const text = buf.toString('latin1', start, cursor);
    if (!integer) return new Float(Number(text));
    const big = BigInt(text);
    return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
  }

  function hexAt(index) {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const ch = buf[index + i];
      let digit = -1;
      if (ch >= 0x30 && ch <= 0x39) digit = ch - 0x30;
      else if (ch >= 0x61 && ch <= 0x66) digit = ch - 0x57;
      else if (ch >= 0x41 && ch <= 0x46) digit = ch - 0x37;
      if (digit < 0) return -1;
      value = (value << 4) | digit;
    }
    return value;
  }

  function unescapeUnicode(sp, stringEnd) {
    if (sp > stringEnd - 4) fail('incomplete unicode character escape sequence at %s', sp - 2);
    const value = hexAt(sp);
    if (value < 0) fail('incomplete unicode character escape sequence at %s', sp - 2);
    return value;
  }

  function unescape(start, stringEnd) {
    let out = '';
    let p = start;
    let pe = start;
    while (pe < stringEnd) {
      const backslash = buf.indexOf(0x5c, pe);
      if (backslash === -1 || backslash >= stringEnd) break;
      pe = backslash;
      if (pe > p) out += buf.toString('utf8', p, pe);
      pe += 1;
      const ch = buf[pe];
      switch (ch) {
        case 0x22: case 0x2f: p = pe; break;
        case 0x5c: out += '\\'; pe += 1; p = pe; break;
        case 0x6e: out += '\n'; pe += 1; p = pe; break;
        case 0x72: out += '\r'; pe += 1; p = pe; break;
        case 0x74: out += '\t'; pe += 1; p = pe; break;
        case 0x62: out += '\b'; pe += 1; p = pe; break;
        case 0x66: out += '\f'; pe += 1; p = pe; break;
        case 0x75: {
          pe += 1;
          let code = unescapeUnicode(pe, stringEnd);
          pe += 3;
          if ((code & 0xfc00) === 0xd800) {
            pe += 1;
            if (pe <= stringEnd - 6 && buf[pe] === 0x5c && buf[pe + 1] === 0x75) {
              const low = unescapeUnicode(pe + 2, stringEnd);
              if ((low & 0xfc00) !== 0xdc00) fail('invalid surrogate pair at %s', p);
              code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
              pe += 5;
            } else {
              fail('incomplete surrogate pair at %s', p);
            }
          }
          out += String.fromCodePoint(code);
          pe += 1;
          p = pe;
          break;
        }
        default:
          if (ch < 0x20) {
            if (ch === 0x0a) fail('Invalid unescaped newline character (\\n) in string: %s', pe - 1);
            fail('invalid ASCII control character in string: %s', pe - 1);
          }
          fail('invalid escape character in string: %s', pe - 1);
      }
    }
    if (stringEnd > p) out += buf.toString('utf8', p, stringEnd);
    return out;
  }

  // Scan to the next '"', '\\' or control byte; false at the end of input.
  function scan() {
    while (cursor < end) {
      const ch = buf[cursor];
      if (ch < 0x20 || ch === 0x22 || ch === 0x5c) return true;
      cursor += 1;
    }
    cursor = end;
    return false;
  }

  // undefined when the string never closes.
  function parseString() {
    cursor += 1;
    const start = cursor;
    if (!scan()) return undefined;
    if (buf[cursor] === 0x22) {
      const text = buf.toString('utf8', start, cursor);
      cursor += 1;
      return text;
    }
    do {
      const ch = buf[cursor];
      if (ch === 0x22) {
        const text = unescape(start, cursor);
        cursor += 1;
        return text;
      }
      if (ch !== 0x5c) fail('invalid ASCII control character in string: %s');
      cursor += 1;
      cursor += 1;
    } while (scan());
    return undefined;
  }

  const EOS = Symbol('eos');

  function parseValue() {
    eatWhitespace();
    const start = cursor;
    const ch = peek();
    switch (ch) {
      case 0x6e: matchKeyword('null'); return null;
      case 0x74: matchKeyword('true'); return true;
      case 0x66: matchKeyword('false'); return false;
      case 0x4e: case 0x49: fail('unexpected token %s'); break;
      case 0x2d: {
        cursor += 1;
        const value = parseNumber(true, start);
        if (value === undefined) fail('invalid number: %s', start);
        return value;
      }
      case 0x22: {
        const value = parseString();
        if (value === undefined) fail('unexpected end of input, expected closing "');
        return value;
      }
      case 0x5b: return parseArray();
      case 0x7b: return parseObject(start);
      case 0:
        if (eos()) return EOS;
        fail('unexpected NULL byte: %s');
        break;
      default:
        if (isDigit(ch)) {
          const value = parseNumber(false, start);
          if (value === undefined) fail('invalid number: %s', start);
          return value;
        }
        fail('unexpected character: %s');
    }
    return undefined;
  }

  function parseArray() {
    cursor += 1;
    eatWhitespace();
    const list = [];
    if (peek() === 0x5d) {
      cursor += 1;
      return list;
    }
    for (;;) {
      const value = parseValue();
      if (value === EOS) return EOS;
      list.push(value);
      eatWhitespace();
      const next = peek();
      if (next === 0x2c) {
        cursor += 1;
      } else if (next === 0x5d) {
        cursor += 1;
        return list;
      } else {
        fail("expected ',' or ']' after array value");
      }
    }
  }

  function parseObject() {
    cursor += 1;
    eatWhitespace();
    const object = {};
    if (peek() === 0x7d) {
      cursor += 1;
      return object;
    }
    let first = true;
    for (;;) {
      eatWhitespace();
      if (peek() !== 0x22) fail(first ? 'expected object key, got %s' : 'expected object key, got: %s');
      const key = parseString();
      if (key === undefined) fail('unexpected end of input, expected closing "');
      eatWhitespace();
      if (peek() !== 0x3a) fail(first ? "expected ':' after object key" : "expected ':' after object key, got: %s");
      cursor += 1;
      const value = parseValue();
      if (value === EOS) return EOS;
      setKey(object, key, value);
      first = false;
      eatWhitespace();
      const next = peek();
      if (next === 0x2c) {
        cursor += 1;
      } else if (next === 0x7d) {
        cursor += 1;
        return object;
      } else {
        fail("expected ',' or '}' after object value, got: %s");
      }
    }
  }

  const result = parseValue();
  if (result === EOS) fail('unexpected end of input');
  eatWhitespace();
  if (!eos()) fail('unexpected token at end of stream %s');
  return result;
}

const firstLine = (message) => String(message).split('\n')[0];

// --- JSON: generate ---------------------------------------------------------

function generateValue(value, pretty, depth) {
  if (nil(value)) return 'null';
  if (value === true || value === false) return String(value);
  if (isFloat(value)) return jsonFloat(value.value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : jsonFloat(value);
  if (typeof value === 'bigint') return value.toString();
  if (isString(value)) return JSON.stringify(value);
  const indent = pretty ? '  '.repeat(depth + 1) : '';
  const closeIndent = pretty ? '  '.repeat(depth) : '';
  const newline = pretty ? '\n' : '';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const body = value.map((entry) => indent + generateValue(entry, pretty, depth + 1));
    return `[${newline}${body.join(`,${newline}`)}${newline}${closeIndent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  const colon = pretty ? ': ' : ':';
  const body = keys.map((key) => `${indent}${JSON.stringify(key)}${colon}${generateValue(value[key], pretty, depth + 1)}`);
  return `{${newline}${body.join(`,${newline}`)}${newline}${closeIndent}}`;
}

const generate = (value) => generateValue(value, false, 0);
const prettyGenerate = (value) => generateValue(value, true, 0);

// --- time -------------------------------------------------------------------

// Seconds since the epoch, with sub-millisecond precision.
const nowSeconds = () => (performance.timeOrigin + performance.now()) / 1000;

const pad2 = (n) => String(n).padStart(2, '0');

// A parsed instant that remembers the zone it was written in: `offset` is seconds
// east of UTC (0 for "Z"), or null for local time (a chat ts, or ISO without a zone).
// Arithmetic sees plain epoch seconds.
class Moment {
  constructor(seconds, offset = null) {
    this.seconds = seconds;
    this.offset = offset;
  }

  valueOf() { return this.seconds; }
}

function fields(value, local) {
  const seconds = Number(value);
  if (!local && value instanceof Moment && value.offset !== null) {
    const shifted = new Date((Math.floor(seconds) + value.offset) * 1000);
    return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(),
      shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds()];
  }
  const date = new Date(Math.floor(seconds * 1000));
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
}

function format(value, pattern, local) {
  const [year, month, day, hour, minute, second] = fields(value, local);
  return pattern.replace(/%([YmdHMS])/g, (_match, code) => {
    switch (code) {
      case 'Y': return String(year).padStart(4, '0');
      case 'm': return pad2(month);
      case 'd': return pad2(day);
      case 'H': return pad2(hour);
      case 'M': return pad2(minute);
      default: return pad2(second);
    }
  });
}

// Format in the instant's own zone (a "Z" stamp prints in UTC); plain seconds are local.
const strftime = (value, pattern) => format(value, pattern, false);
// Format in the local zone, whatever zone the instant was written in.
const strftimeLocal = (value, pattern) => format(value, pattern, true);

const today = () => strftime(nowSeconds(), '%Y-%m-%d');

// UTC, whole seconds: 2034-08-24T10:30:00Z
function isoUTC(seconds) {
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const nowIso = () => isoUTC(nowSeconds());

// Local midnight of the given day, in seconds.
function localMidnight(seconds) {
  const date = new Date(Math.floor(seconds * 1000));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
}

const ISO_PATTERN = /^[\t\n\v\f\r ]*(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?[\t\n\v\f\r ]*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?[\t\n\v\f\r ]*$/i;

function parseIso(text) {
  const match = ISO_PATTERN.exec(text);
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 60) return null;
  if (hour === 24 && (minute || second)) return null;
  const fraction = frac ? Number(`0.${frac}`) : 0;
  if (!zone) {
    return new Moment(new Date(year, month - 1, day, hour, minute, second).getTime() / 1000 + fraction);
  }
  let offset = 0;
  if (/^[+-]/.test(zone)) {
    const digitsOnly = zone.replace(':', '');
    const sign = digitsOnly[0] === '-' ? -1 : 1;
    offset = sign * (Number(digitsOnly.slice(1, 3)) * 3600 + Number(digitsOnly.slice(3, 5) || 0) * 60);
  }
  return new Moment(Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - offset + fraction, offset);
}

// Both timestamp shapes these scripts see: a chat ts ("<epoch>.<micros>") and an
// ISO-8601 instant (a zone-less one is local time). A Moment, or null for
// anything else.
function parseMoment(value) {
  if (nil(value)) return null;
  const text = toS(value);
  if (strip(text) === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return new Moment(toF(text));
  return parseIso(text);
}

// --- files ------------------------------------------------------------------

// Absolute path; a leading ~ is the home directory.
function expandPath(file) {
  let text = String(file);
  if (text === '~' || text.startsWith('~/')) text = os.homedir() + text.slice(1);
  return path.resolve(text);
}

// Join path segments with exactly one separator between each pair (no other
// normalisation, so the text matches what was stored).
function joinPath(...parts) {
  return parts.reduce((left, right) => {
    const a = String(left);
    const b = String(right);
    if (a.endsWith('/') && b.startsWith('/')) return a + b.replace(/^\/+/, '');
    if (a.endsWith('/') || b.startsWith('/')) return a + b;
    return `${a}/${b}`;
  });
}

const exists = (file) => fs.existsSync(file);

function mkdirP(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  Exit, puts, warn, abort, run,
  Float, isFloat, isInteger, isHash, isString, rt, nil, className,
  floatToS, jsonFloat, toI, toF,
  strip, rstrip, subFirst, chars, charLength, charSlice, ljust, split, inspect, toS,
  dig, arrayOf, joinFlat, has, fetch, get, uniq, deepMerge,
  JSONParserError, parseJSON, firstLine, generate, prettyGenerate,
  nowSeconds, Moment, strftime, strftimeLocal, today, isoUTC, nowIso, localMidnight, parseMoment,
  expandPath, joinPath, exists, mkdirP
};
