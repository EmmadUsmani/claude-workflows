#!/usr/bin/env node
'use strict';
// Digest of the user's local Claude Code sessions for one local-time day.
//
//   node sessions_digest.js [YYYY-MM-DD] [--from HH:MM] [--exclude ID[,ID]] [--prompt-chars N] [--reply-chars N]
//                           [--tz Area/City] [--projects-dir DIR]
//   node sessions_digest.js [YYYY-MM-DD] --session ID [--from HH:MM]   # drill into one session
//
// Reads <projects-dir>/*/*.jsonl (default ~/.claude/projects; main transcripts only — subagent
// transcripts are skipped, their reports land in the parent session). Only records timestamped
// inside the day count, because one session often spans several days, and a /resume keeps
// appending to the original file under the original session id. Read-only.
//
// The day is midnight → midnight in --tz, else $TZ, else the system's local zone.

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
// Removes the flag and its value; a flag given last yields itself, like the original's slice!(i, 2).last.
const opt = (flag, dflt) => {
  const i = args.indexOf(flag);
  if (i === -1) return dflt;
  const taken = args.splice(i, 2);
  return taken[taken.length - 1];
};
const del = (flag) => {
  const found = args.includes(flag);
  for (let i; (i = args.indexOf(flag)) !== -1;) args.splice(i, 1);
  return found;
};
if (del('--help') || del('-h')) {
  const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(2);
  const header = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    header.push(l.replace(/^\/\/ ?/, ''));
  }
  process.stdout.write(header.join('\n') + '\n');
  process.exit(0);
}

const fail = (msg) => {
  process.stderr.write(`sessions_digest.js: ${msg}\n`);
  process.exit(1);
};

// ---- time zone math (Intl only) ----
const tz = opt('--tz', null);
if (tz) process.env.TZ = tz;
const ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
let dtf;
try {
  dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
} catch {
  fail(`unknown time zone ${ZONE}`);
}
// Wall-clock fields of an instant (epoch ms) in ZONE.
function wall(ms) {
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(Math.floor(ms)))) p[type] = Number(value);
  return p;
}
const offsetAt = (ms) => {
  const p = wall(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};
// Time.local: wall-clock time in ZONE → epoch ms. A time skipped by a DST jump moves forward; a
// repeated one resolves to its later (standard-time) instant — what mktime does on macOS/glibc.
function localTime(y, mo, d, h = 0, mi = 0, s = 0) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = offsetAt(naive - 86400000);
  const after = offsetAt(naive + 86400000);
  const valid = [naive - before, naive - after].filter((t) => offsetAt(t) === naive - t);
  return valid.length ? Math.max(...valid) : naive - before;
}
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => {
  const p = wall(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
};
// Time.parse for the ISO-8601 stamps transcripts carry; a stamp without an offset is local.
function parseTime(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?\s*$/i);
  if (!m) return null;
  const [, y, mo, d, h = 0, mi = 0, sec = 0, frac = '', off] = m;
  const fracMs = frac ? Number(`0.${frac}`) * 1000 : 0;
  if (!off) return localTime(+y, +mo, +d, +h, +mi, +sec) + fracMs;
  let offMin = 0;
  if (off.toUpperCase() !== 'Z') {
    const digits = off.slice(1).replace(':', '');
    offMin = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0)) * (off[0] === '-' ? -1 : 1);
  }
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offMin * 60000 + fracMs;
}
// String#to_i
const toI = (s) => {
  const m = String(s).match(/^\s*([+-]?\d+(?:_\d+)*)/);
  return m ? parseInt(m[1].replace(/_/g, ''), 10) : 0;
};
// "YYYY-MM-DD" → {year, month, day}, validated.
function parseDate(s) {
  const m = s.match(/^\s*(\d{4})-?(\d{2})-?(\d{2})\s*$/);
  const date = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!date || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3]) fail(`invalid date: ${s} (expected YYYY-MM-DD)`);
  return { year: +m[1], month: +m[2], day: +m[3] };
}
const addDays = ({ year, month, day }, n) => {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const home = os.homedir();
const expand = (p) => path.resolve(p === '~' || p.startsWith('~/') ? home + p.slice(1) : p);
const projectsDir = expand(opt('--projects-dir', process.env.CLAUDE_PROJECTS_DIR ?? '~/.claude/projects'));
// String#split: trailing empty fields are dropped.
const rsplit = (s, sep) => {
  const parts = s.split(sep);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
};
const exclude = rsplit(opt('--exclude', ''), ',');
const drill = opt('--session', null);
const from = opt('--from', null);
const promptChars = toI(opt('--prompt-chars', drill ? '4000' : '500'));
const replyChars = toI(opt('--reply-chars', drill ? '4000' : '700'));
const date = args.length ? parseDate(args[0]) : (({ year, month, day }) => ({ year, month, day }))(wall(Date.now()));
let dayStart = localTime(date.year, date.month, date.day);
if (from) dayStart = localTime(date.year, date.month, date.day, ...rsplit(from, ':').map(toI).slice(0, 3));
const nextDay = addDays(date, 1);
const dayEnd = localTime(nextDay.year, nextDay.month, nextDay.day); // DST-safe: not +86_400
const zoneLabel = () => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'short' }).formatToParts(new Date(localTime(date.year, date.month, date.day)));
  return p.find((x) => x.type === 'timeZoneName').value;
};
const zone = process.env.TZ || zoneLabel();

// ---- digest ----
// Ruby's \b treats any Unicode letter, mark or digit as a word character.
const B = '(?:(?<=[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}])(?![\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}])|(?<![\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}])(?=[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}]))';
const TICK = new RegExp(`^(No change|No new|Still (waiting|running|no)|Nothing new|Quiet)${B}|${B}no change${B}|green and quiet`, 'iu');
const OUTCOME = new RegExp(`${B}(merged|opened|created|applied|published|republished|posted|deployed|live in prod|ready for review|confirmed)${B}`, 'iu');

const RUBY_WS = '[\\0\\t\\n\\v\\f\\r ]';
const strip = (s) => s.replace(new RegExp(`^${RUBY_WS}+|${RUBY_WS}+$`, 'g'), '');
const lstrip = (s) => s.replace(new RegExp(`^${RUBY_WS}+`), '');
const chars = (s) => Array.from(s);
const notNil = (v) => v !== null && v !== undefined;
const truthy = (v) => notNil(v) && v !== false; // Ruby truthiness
const toS = (v) => (v === null || v === undefined ? '' : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cmp = (a, b) => { // String#<=> (byte order == code point order)
  const A = chars(a);
  const B2 = chars(b);
  for (let i = 0; i < Math.min(A.length, B2.length); i++) {
    const d = A[i].codePointAt(0) - B2[i].codePointAt(0);
    if (d) return d;
  }
  return A.length - B2.length;
};
const uniq = (a) => [...new Set(a)];
const tallyOf = (a) => {
  const m = new Map();
  for (const x of a) m.set(x, (m.get(x) || 0) + 1);
  return m;
};

function clean(text) {
  return strip(text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/[ \t\n\v\f\r]+/g, ' '));
}

function texts(content) {
  if (typeof content === 'string') return [content];
  const arr = Array.isArray(content) ? content : content === null || content === undefined ? [] : [content];
  return arr.filter((b) => isObj(b) && b.type === 'text').map((b) => b.text);
}

const truncate = (text, n) => {
  const c = chars(text);
  return c.length > n ? `${n < 0 ? '' : c.slice(0, n).join('')}…` : text;
};

const nearDup = (a, b) => truthy(a) && truthy(b) && (a.startsWith(chars(b).slice(0, 120).join('')) || b.startsWith(chars(a).slice(0, 120).join('')));

const dig = (o, ...ks) => ks.reduce((v, k) => (isObj(v) ? v[k] : undefined), o);

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort(cmp).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
};
const base = (f) => path.basename(f, '.jsonl');
let files = listDir(projectsDir)
  .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
  .flatMap((d) => listDir(d).filter((f) => f.endsWith('.jsonl')))
  .filter((f) => fs.statSync(f).mtimeMs >= dayStart);
if (drill) files = files.filter((f) => base(f).startsWith(drill));
files = files.filter((f) => !exclude.some((id) => base(f).startsWith(id)));

function* records(file) {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const buf = fs.readFileSync(file);
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    const line = buf.subarray(start, end);
    start = end + 1;
    let rec;
    try {
      rec = JSON.parse(dec.decode(line));
    } catch {
      continue;
    }
    if (isObj(rec)) yield rec;
  }
}

const digests = [];
for (const file of files) {
  let title = null;
  const cwds = [];
  const branches = [];
  const prompts = [];
  const commands = [];
  const replies = [];
  const skills = [];
  const mcp = [];
  const prs = [];
  const stamps = [];
  let ticks = 0;

  for (const rec of records(file)) {
    if (rec.type === 'custom-title') title = rec.customTitle ?? null;
    const ts = truthy(rec.timestamp) ? parseTime(rec.timestamp) : null;
    if (!(ts !== null && ts >= dayStart && ts < dayEnd)) continue;
    if (truthy(rec.isSidechain)) continue;

    if (truthy(rec.cwd)) cwds.push(rec.cwd);
    if (truthy(rec.gitBranch) && rec.gitBranch !== 'HEAD') branches.push(rec.gitBranch);

    if (rec.type === 'pr-link') {
      prs.push(rec.prUrl ?? null);
    } else if (rec.type === 'user') {
      if (truthy(rec.isMeta)) continue;
      for (const t of texts(dig(rec, 'message', 'content'))) {
        const cmd = t.match(/<command-name>([^\n]*?)<\/command-name>/);
        if (cmd) {
          const a = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
          commands.push([cmd[1], strip(a ? a[1] : '')].filter((x) => x !== '').join(' '));
          stamps.push(ts);
          continue;
        }
        const bash = t.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
        if (bash) {
          prompts.push(`${hhmm(ts)} ran: ${truncate(strip(bash[1]), promptChars)}`);
          stamps.push(ts);
          continue;
        }
        if (t.startsWith('[Request interrupted') || t.includes('<local-command-stdout>') || t.includes('<bash-stdout>')) continue;
        if (['<task-notification>', '<teammate-message', '<agent-message'].some((p) => lstrip(t).startsWith(p))) continue;
        const c = clean(t);
        if (!c) continue;
        stamps.push(ts);
        const prev = prompts.length ? prompts[prompts.length - 1].replace(/^\d\d:\d\d /, '') : null;
        if (nearDup(prev, c)) continue;
        prompts.push(`${hhmm(ts)} ${truncate(c, promptChars)}`);
      }
    } else if (rec.type === 'assistant') {
      const content = dig(rec, 'message', 'content');
      for (const b of Array.isArray(content) ? content : content === null || content === undefined ? [] : [content]) {
        if (!isObj(b)) continue;
        if (b.type === 'tool_use') {
          if (b.name === 'Skill') skills.push(dig(b, 'input', 'skill') ?? null);
          // MCP servers are often used without loading a skill (a warehouse query, a chat
          // search), so the server name itself marks what the session touched.
          if (toS(b.name).startsWith('mcp__')) mcp.push(rsplit(b.name, '__')[1] ?? null);
        }
        if (!(b.type === 'text' && strip(b.text) !== '')) continue;
        const c = clean(b.text);
        stamps.push(ts);
        if (chars(c).length < 200 && TICK.test(c)) {
          ticks += 1;
        } else {
          replies.push(`${hhmm(ts)} ${truncate(c, replyChars)}`);
        }
      }
    }
  }

  if (!prompts.length && !commands.length && !replies.length) continue;

  const picked = uniq([...replies.filter((r) => OUTCOME.test(r)).slice(-8), ...replies.slice(-3)]).sort(cmp);
  digests.push({
    id: base(file), title, cwds: uniq(cwds), branches: uniq(branches),
    first: Math.min(...stamps), last: Math.max(...stamps), ticks,
    prompts, commands: uniq(commands), skills: tallyOf(skills.filter(notNil)), mcp: tallyOf(mcp.filter(notNil)),
    prs: uniq(prs), replies: drill ? replies : picked,
  });
}

const tally = (h) => [...h].map(([k, v]) => (v > 1 ? `${k} ×${v}` : toS(k))).join(', ');
const out = [];
const puts = (s = '') => out.push(s.endsWith('\n') ? s : s + '\n');

const ymd = `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
puts(`# Claude Code sessions — ${ymd} (${weekday}, ${zone})${from ? ` from ${from}` : ''}`);
puts(`${digests.length} session(s) with activity${exclude.length ? ` (excluding ${exclude.join(', ')})` : ''}`);
for (const d of [...digests].sort((a, b) => a.first - b.first)) {
  puts();
  puts(`## ${truthy(d.title) ? toS(d.title) : '(untitled)'} — ${hhmm(d.first)}–${hhmm(d.last)}`);
  puts(`- session: ${d.id}`);
  puts(`- cwd: ${d.cwds.map(toS).join(', ')}${d.branches.length ? ` (branches: ${d.branches.map(toS).join(', ')})` : ''}`);
  if (d.commands.length) puts(`- slash commands: ${d.commands.join('; ')}`);
  if (d.skills.size) puts(`- skills: ${tally(d.skills)}`);
  if (d.mcp.size) puts(`- MCP servers used: ${tally(d.mcp)}`);
  if (d.prs.some(truthy)) puts(`- PRs associated (confirm with gh — may be from an earlier day): ${d.prs.map(toS).join(' ')}`);
  if (d.prompts.length) {
    puts('- user prompts:');
    for (const p of d.prompts) puts(`    - ${p}`);
  } else if (!d.commands.length) {
    puts('- no prompts from the user today (automated/cron-driven activity only)');
  }
  if (d.replies.length) {
    puts(`- ${drill ? 'assistant replies' : 'outcome + last assistant replies'}:`);
    for (const r of d.replies) puts(`    - ${r}`);
  }
  if (d.ticks > 0) puts(`- cron/poll ticks with no change: ${d.ticks}`);
}
process.stdout.write(out.join(''));
