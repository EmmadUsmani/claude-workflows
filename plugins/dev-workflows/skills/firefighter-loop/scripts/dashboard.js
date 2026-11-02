#!/usr/bin/env node
'use strict';

// dashboard.js — render the firefighter state as the Artifact dashboard page.
//
//   R=${FF_STATE_DIR:-~/.local/state/firefighter-loop}
//   node dashboard.js $R/state.json $R/dashboard.html
//
// Then publish it with the Artifact tool, passing the stored `dashboard.url` as `url:`
// every time so the URL never changes even when the file moves:
//   Artifact(file_path: <out.html>, url: <state.dashboard.url>); first publish adds icon: "fire".
// Only the very first publish omits `url:` — record what it returns with
// `ff.js set dashboard.url <url>`.
//
// WHAT COMES OUT
// A self-contained HTML *fragment*, not a document: it starts at <title> and has
// no doctype / <html> / <head> / <body> — the Artifact publisher supplies those.
// Constraints the publisher imposes, all enforced here:
//   - no external hosts at all (no CDN, no web fonts, no remote images); the CSS
//     is inline and there is no JavaScript
//   - every non-ASCII character is emitted as a numeric HTML entity, so the file
//     is pure 7-bit ASCII and survives any transport
//   - theme-aware: light tokens on bare :root, dark overrides both under
//     @media (prefers-color-scheme: dark) guarded by :root:not([data-theme="light"])
//     and again under :root[data-theme="dark"], so the viewer's explicit toggle
//     wins in both directions; body gets an explicit background
//   - wide content scrolls inside its own container; the page body never scrolls
//     sideways
//
// WHAT IT SHOWS  (all of it read from state.json — this script invents nothing)
//   1. status strip: live agents, needs-you, done today, next fire / cron, plus an
//      on-call indicator on the days state says the user is on call (absent otherwise)
//   2. "Needs you" first, because that is the only section the user must act on, then
//      "Acknowledged - your call": items they acknowledged that would otherwise have
//      been dispatched, skipped by default until they answer skip / mine / loop
//   3. one column per status, one card per item (class badge, channel, age,
//      permalink, agent, artifacts, PR, the pending ask / reason, the ack)
//   4. a 7-day tally built from each item's first_seen_at
//   5. the last 20 tick lines, when state carries them — a silent loop and a dead
//      loop look identical without this
//
// Customer names are never added here. Whatever the state holds is what renders,
// placeholders like <account_id> included, verbatim.

const fs = require('fs');
const path = require('path');
const {
  run, warn, puts, isHash, isString, rt, toS, dig, get, joinFlat, uniq, strip, chars,
  JSONParserError, parseJSON, firstLine, nowSeconds, strftime, strftimeLocal, today, parseMoment
} = require('./lib/compat');

const STATUS_ORDER = ['needs_you', 'acked', 'new', 'dispatched', 'in_progress', 'paused', 'user_owns', 'done', 'linked', 'ignored'];
const STATUS_LABELS = {
  needs_you: 'Needs you',
  acked: 'Acknowledged - your call',
  new: 'New',
  dispatched: 'Dispatched',
  in_progress: 'In progress',
  paused: 'Paused',
  user_owns: 'Yours (you took it)',
  done: 'Done',
  linked: 'Linked (duplicate)',
  ignored: 'Ignored'
};
const LIVE_STATUSES = ['dispatched', 'in_progress', 'paused'];
const TALLY_DAYS = 7;
const TICK_LINES = 20;

// --- text ------------------------------------------------------------------

function escape(value) {
  return toS(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Final pass: anything outside 7-bit ASCII becomes a numeric entity, so the
// published file has no byte above 127 no matter what Slack put in the state.
function asciify(html) {
  return chars(html).map((ch) => {
    const code = ch.codePointAt(0);
    return code > 127 ? `&#${code};` : ch;
  }).join('');
}

function truncate(value, limit) {
  const text = strip(toS(value));
  const list = chars(text);
  return list.length > limit ? `${list.slice(0, limit - 1).join('')}...` : text;
}

// `value || fallback`, where only null/undefined/false fall through.
const either = (value, fallback) => (rt(value) ? value : fallback);

function downcase(value) {
  if (!isString(value)) throw new TypeError(`undefined method 'downcase' for ${toS(value)}`);
  return value.toLowerCase();
}

// Age of an instant (seconds), counted in whole seconds of that instant.
function ageOfMoment(moment) {
  if (moment === null) return null;

  const seconds = nowSeconds() - Math.floor(moment);
  if (seconds < 0) return `in ${durationLabel(-seconds)}`;

  return durationLabel(seconds);
}

function durationLabel(seconds) {
  if (seconds < 60) return `${Math.trunc(seconds)}s`;
  if (seconds < 3600) return `${Math.trunc(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.trunc(seconds / 3600)}h`;

  return `${Math.trunc(seconds / 86400)}d`;
}

// --- state readers ---------------------------------------------------------

function itemsOf(state) {
  const raw = get(state, 'items');
  return isHash(raw) ? raw : {};
}

function itemMoment(item) {
  const fromTs = parseMoment(get(item, 'ts'));
  return fromTs !== null ? fromTs : parseMoment(get(item, 'first_seen_at'));
}

// Newest fire first within a column (ties keep state order).
function sortedItems(entries) {
  return entries.map((entry, index) => {
    const moment = itemMoment(entry[1]);
    return { entry, index, key: -(moment === null ? 0 : moment) };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index)).map((row) => row.entry);
}

function liveAgentNames(entries) {
  const names = [];
  for (const [, item] of entries) {
    const name = dig(item, 'agent', 'name');
    if (LIVE_STATUSES.includes(get(item, 'status')) && rt(name)) names.push(name);
  }
  return uniq(names);
}

function doneToday(entries) {
  const day = today();
  return entries.filter(([, item]) => {
    if (get(item, 'status') !== 'done') return false;
    const moment = parseMoment(get(item, 'updated_at'));
    return moment !== null && strftime(moment, '%Y-%m-%d') === day;
  }).length;
}

function nextFireLabel(state) {
  const cron = isHash(get(state, 'cron')) ? state.cron : {};
  if (rt(get(cron, 'next_fire_at'))) {
    const moment = parseMoment(cron.next_fire_at);
    return moment !== null ? strftimeLocal(moment, '%H:%M') : toS(cron.next_fire_at);
  }
  if (rt(get(cron, 'expression'))) return cron.expression;

  return 'no cron';
}

// Null on every day the user is not on call — including a state.json with no oncall
// block at all — and the strip simply has no on-call card then. `active` is a fact about
// one day: a stale `true` from an earlier `active_date` is not today's shift.
function oncallNote(state) {
  const oncall = get(state, 'oncall');
  if (!(isHash(oncall) && get(oncall, 'active') === true)) return null;
  if (get(oncall, 'active_date') !== today()) return null;

  const started = parseMoment(get(oncall, 'shift_start_ts'));
  const where = either(either(get(oncall, 'channel_name'), get(oncall, 'channel_id')), 'the on-call channel');
  return `on-call requests in ${toS(where)}${started !== null ? ` - since ${strftimeLocal(started, '%H:%M')}` : ''}`;
}

// What the card says about the user's acknowledgement, and — while the item is still
// `acked` — how to answer. Null on an item they never acknowledged.
function ackNote(item) {
  const ack = get(item, 'ack');
  if (!isHash(ack)) return null;

  const seen = `you acknowledged it (${toS(either(get(ack, 'via'), 'ack'))})`;
  if (get(ack, 'decided_via') === 'reaction') return `${seen}; you reacted :robot_face: on its ask line - loop`;
  if (rt(get(ack, 'decision'))) return `${seen}; you chose ${toS(ack.decision)} via ${toS(either(get(ack, 'decided_via'), '?'))}`;
  if (get(item, 'status') !== 'acked') return `${seen} - not actionable, nothing to decide`;

  const number = dig(ack, 'ask', 'n');
  const where = rt(number)
    ? `reply \`${toS(number)} skip|mine|loop\` in the ask DM thread, or react :robot_face: on its line to dispatch`
    : 'ask not sent yet';
  return `${seen} - skipped unless you say otherwise: ${where}`;
}

function cronNote(state) {
  const cron = isHash(get(state, 'cron')) ? state.cron : {};
  if (get(cron, 'id') === null) return 'session-only cron not running - run `start`';

  const parts = [get(cron, 'expression'), `id ${toS(cron.id)}`].filter((part) => part !== null);
  const expiry = parseMoment(get(cron, 'expires_at'));
  if (expiry !== null) {
    const remaining = expiry - nowSeconds();
    parts.push(remaining > 0 ? `expires in ${Math.trunc(remaining / 3600)}h` : 'EXPIRED - run `start` again');
  }
  return joinFlat(parts, ' - ');
}

// Seven columns of one day each, oldest first, counted off first_seen_at.
function sevenDayTally(entries) {
  const now = nowSeconds();
  const buckets = [];
  for (let offset = 0; offset < TALLY_DAYS; offset += 1) buckets.push(strftime(now - offset * 86400, '%Y-%m-%d'));
  buckets.reverse();
  const rows = buckets.map((date) => ({ date, total: 0, statuses: {} }));
  const index = {};
  for (const row of rows) index[row.date] = row;
  for (const [, item] of entries) {
    const moment = parseMoment(get(item, 'first_seen_at'));
    const row = moment === null ? undefined : index[strftime(moment, '%Y-%m-%d')];
    if (row === undefined) continue;

    row.total += 1;
    const status = toS(either(get(item, 'status'), 'unknown'));
    row.statuses[status] = (row.statuses[status] || 0) + 1;
  }
  return rows;
}

function tickLines(state) {
  const ticks = get(state, 'ticks');
  if (!Array.isArray(ticks)) return [];

  return ticks.slice(-TICK_LINES).reverse().map((tick) => {
    if (isHash(tick)) {
      const moment = parseMoment(get(tick, 'at'));
      return { at: moment !== null ? strftimeLocal(moment, '%m-%d %H:%M') : toS(get(tick, 'at')), line: toS(get(tick, 'line')) };
    }
    return { at: '', line: toS(tick) };
  });
}

// --- template ---------------------------------------------------------------
//
// <%= expr %> inserts String(expr); <% code %> runs JS. Text outside the tags is
// emitted exactly as written, whitespace included.

function compileTemplate(template, params) {
  let body = "let out = '';\n";
  const tag = /<%(=?)([\s\S]*?)%>/g;
  let last = 0;
  let match;
  while ((match = tag.exec(template)) !== null) {
    body += `out += ${JSON.stringify(template.slice(last, match.index))};\n`;
    body += match[1] ? `out += toS(${match[2]});\n` : `${match[2]}\n`;
    last = tag.lastIndex;
  }
  body += `out += ${JSON.stringify(template.slice(last))};\nreturn out;\n`;
  return new Function(...params, body); // eslint-disable-line no-new-func
}

const HELPERS = { escape, truncate, either, downcase, ageOfMoment, itemMoment, ackNote, rt, toS, dig, get, joinFlat };

const CARD = String.raw`<article class="card status-<%= escape(get(item, 'status')) %>">
  <div class="card-head">
    <span class="badge badge-<%= escape(downcase(either(get(item, 'class'), 'unclassified')).replace(/[^a-z0-9]+/g, '-')) %>"><%= escape(either(get(item, 'class'), 'unclassified')) %></span>
    <% if (rt(get(item, 'mention'))) { %><span class="badge badge-mention">mention</span><% } %>
    <% if (rt(get(item, 'restarted'))) { %><span class="badge badge-restart">re-dispatched</span><% } %>
    <% if (rt(get(item, 'env')) && toS(item.env) !== 'local') { %><span class="badge badge-env">env: <%= escape(get(item, 'env')) %></span><% } %>
    <span class="age"><%= escape(either(ageOfMoment(itemMoment(item)), '?')) %></span>
  </div>
  <h4 class="card-title">
    <% if (rt(get(item, 'permalink'))) { %>
      <a href="<%= escape(get(item, 'permalink')) %>"><%= escape(truncate(either(get(item, 'title'), key), 90)) %></a>
    <% } else { %>
      <%= escape(truncate(either(get(item, 'title'), key), 90)) %>
    <% } %>
  </h4>
  <div class="meta">
    <span><%= escape(either(get(item, 'channel'), get(item, 'channel_id'))) %></span>
    <% if (rt(get(item, 'author'))) { %><span><%= escape(get(item, 'author')) %></span><% } %>
    <% if (rt(get(item, 'priority'))) { %><span>p<%= escape(get(item, 'priority')) %></span><% } %>
  </div>
  <% if (rt(get(item, 'excerpt')) && toS(item.excerpt) !== '') { %>
    <p class="excerpt"><%= escape(truncate(get(item, 'excerpt'), 220)) %></p>
  <% } %>
  <% if (rt(get(item, 'ask')) && toS(item.ask) !== '') { %>
    <p class="ask"><span class="ask-arrow">&gt;&gt;</span> <%= escape(get(item, 'ask')) %></p>
  <% } %>
  <% if (rt(get(item, 'reason')) && toS(item.reason) !== '') { %>
    <p class="reason"><%= escape(get(item, 'reason')) %></p>
  <% } %>
  <% if (rt(get(item, 'linked_to'))) { %>
    <p class="reason">duplicate of <code><%= escape(get(item, 'linked_to')) %></code></p>
  <% } %>
  <% const ackText = ackNote(item); if (rt(ackText)) { %>
    <p class="ack-note"><%= escape(ackText) %></p>
  <% } %>
  <dl class="facts">
    <% if (rt(dig(item, 'agent', 'name'))) { %>
      <dt>agent</dt><dd><code><%= escape(dig(item, 'agent', 'name')) %></code></dd>
    <% } %>
    <% if (rt(get(item, 'pr'))) { %>
      <dt>PR</dt><dd><a href="<%= escape(get(item, 'pr')) %>"><%= escape(truncate(toS(get(item, 'pr')).replace(/^https?:\/\/(www\.)?github\.com\//, ''), 48)) %></a></dd>
    <% } %>
    <% if (rt(get(item, 'worktree'))) { %>
      <dt>worktree</dt><dd><code><%= escape(get(item, 'worktree')) %></code></dd>
    <% } %>
    <% if (Array.isArray(get(item, 'artifacts')) && item.artifacts.length > 0) { %>
      <dt>artifacts</dt>
      <dd><ul class="artifacts"><% for (const artifact of item.artifacts) { %><li><code><%= escape(artifact) %></code></li><% } %></ul></dd>
    <% } %>
    <% if (rt(dig(item, 'dm', 'root_ts'))) { %>
      <dt>DM</dt><dd><code><%= escape(dig(item, 'dm', 'root_ts')) %></code></dd>
    <% } %>
  </dl>
  <div class="key"><code><%= escape(key) %></code></div>
</article>
`;

const PAGE = String.raw`<title>Firefighter Dashboard</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --panel: #ffffff;
    --panel-2: #f0f2f5;
    --ink: #14171c;
    --ink-dim: #5a6472;
    --ink-faint: #8b95a4;
    --line: #dfe3e9;
    --accent: #b4400f;
    --accent-soft: #fdeee6;
    --ok: #1c7a4a;
    --ok-soft: #e5f4ec;
    --warn: #8a5a00;
    --warn-soft: #fbf1da;
    --alert: #a51d2d;
    --alert-soft: #fbe7e9;
    --shadow: 0 1px 2px rgba(20, 23, 28, .07), 0 3px 10px rgba(20, 23, 28, .05);
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0f1216;
      --panel: #171b21;
      --panel-2: #1e242c;
      --ink: #e8ecf1;
      --ink-dim: #a3adbb;
      --ink-faint: #6f7b8a;
      --line: #2b323b;
      --accent: #ff8b52;
      --accent-soft: #35211a;
      --ok: #64d19b;
      --ok-soft: #16291f;
      --warn: #e5b45c;
      --warn-soft: #2b2417;
      --alert: #ff8188;
      --alert-soft: #2f191c;
      --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 3px 12px rgba(0, 0, 0, .35);
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f1216;
    --panel: #171b21;
    --panel-2: #1e242c;
    --ink: #e8ecf1;
    --ink-dim: #a3adbb;
    --ink-faint: #6f7b8a;
    --line: #2b323b;
    --accent: #ff8b52;
    --accent-soft: #35211a;
    --ok: #64d19b;
    --ok-soft: #16291f;
    --warn: #e5b45c;
    --warn-soft: #2b2417;
    --alert: #ff8188;
    --alert-soft: #2f191c;
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 3px 12px rgba(0, 0, 0, .35);
  }

  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.5;
    margin: 0;
    padding: 28px 20px 64px;
    overflow-x: hidden;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  a { color: var(--accent); }
  code { font-family: var(--mono); font-size: .82em; }

  header.page { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; margin-bottom: 18px; }
  header.page h1 { font-size: 21px; margin: 0; letter-spacing: -.01em; }
  header.page .sub { color: var(--ink-faint); font-size: 13px; font-family: var(--mono); }

  .strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 26px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; box-shadow: var(--shadow); }
  .stat .n { font-size: 26px; font-weight: 650; line-height: 1.1; letter-spacing: -.02em; }
  .stat .k { color: var(--ink-faint); font-size: 11px; text-transform: uppercase; letter-spacing: .07em; margin-top: 4px; }
  .stat .d { color: var(--ink-dim); font-size: 12px; margin-top: 6px; font-family: var(--mono); word-break: break-word; }
  .stat.alert .n { color: var(--alert); }
  .stat.ok .n { color: var(--ok); }
  .stat.oncall { border-color: var(--warn); background: var(--warn-soft); }
  .stat.oncall .n { color: var(--warn); letter-spacing: .04em; }
  .stat.call .n { color: var(--warn); }

  section { margin-bottom: 30px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-dim); margin: 0 0 12px; }
  h2 .count { color: var(--ink-faint); font-weight: 400; }

  .needs-you { border: 1px solid var(--alert); background: var(--alert-soft); border-radius: 12px; padding: 14px; }
  .needs-you h2 { color: var(--alert); }
  .needs-you .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .your-call { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: 12px; padding: 14px; }
  .your-call h2 { color: var(--warn); }
  .your-call .hint { color: var(--ink-dim); font-size: 13px; margin: -6px 0 12px; }
  .your-call .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }

  .columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; align-items: start; }
  .column { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  .column > .cards { display: grid; gap: 10px; }

  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 11px 12px; box-shadow: var(--shadow); }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
  .card-title { font-size: 14px; margin: 0 0 5px; font-weight: 600; line-height: 1.35; }
  .card-title a { text-decoration: none; }
  .card-title a:hover { text-decoration: underline; }
  .age { margin-left: auto; color: var(--ink-faint); font-family: var(--mono); font-size: 11px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ink-dim); font-size: 12px; font-family: var(--mono); }
  .excerpt { color: var(--ink-dim); font-size: 13px; margin: 8px 0 0; }
  .ask { margin: 9px 0 0; padding: 7px 9px; border-radius: 7px; background: var(--accent-soft); color: var(--ink); font-size: 13px; }
  .ask-arrow { color: var(--accent); font-weight: 700; font-family: var(--mono); }
  .reason { margin: 8px 0 0; color: var(--ink-faint); font-size: 12px; }
  .ack-note { margin: 8px 0 0; color: var(--warn); font-size: 12px; }
  .key { margin-top: 9px; color: var(--ink-faint); font-size: 11px; word-break: break-all; }

  .badge { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; font-weight: 650;
           padding: 2px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink-dim); background: var(--panel-2); }
  .badge-incident, .badge-incident-bug, .badge-bug { color: var(--alert); background: var(--alert-soft); border-color: transparent; }
  .badge-operational, .badge-operational-request { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .badge-question { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
  .badge-mention { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
  .badge-restart { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .badge-env { color: var(--ink); background: var(--panel-2); }

  .facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 9px 0 0; font-size: 12px; }
  .facts dt { color: var(--ink-faint); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; padding-top: 2px; }
  .facts dd { margin: 0; word-break: break-word; }
  .artifacts { list-style: none; margin: 0; padding: 0; }

  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--ink-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; font-weight: 600; }
  td.num { font-family: var(--mono); }

  .ticks { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .ticks ol { list-style: none; margin: 0; padding: 0; }
  .ticks li { font-family: var(--mono); font-size: 12px; color: var(--ink-dim); padding: 3px 0; border-bottom: 1px solid var(--line); overflow-x: auto; white-space: nowrap; }
  .ticks li:last-child { border-bottom: 0; }
  .ticks .at { color: var(--ink-faint); margin-right: 10px; }
  .empty { color: var(--ink-faint); font-size: 13px; font-style: italic; }
</style>

<div class="wrap">
  <header class="page">
    <h1>Firefighter</h1>
    <span class="sub"><%= escape(profile) %> &middot; <%= escape(dayLabel) %> &middot; generated <%= escape(generatedAt) %></span>
  </header>

  <div class="strip">
    <div class="stat<%= agents.length === 0 ? '' : ' ok' %>">
      <div class="n"><%= agents.length %></div>
      <div class="k">live agents</div>
      <div class="d"><%= agents.length === 0 ? 'idle' : escape(joinFlat(agents, ', ')) %></div>
    </div>
    <div class="stat<%= needsYou.length === 0 ? '' : ' alert' %>">
      <div class="n"><%= needsYou.length %></div>
      <div class="k">needs you</div>
      <div class="d"><%= needsYou.length === 0 ? 'nothing waiting on you' : 'act on these first' %></div>
    </div>
    <% if (!(yourCall.length === 0)) { %>
      <div class="stat call">
        <div class="n"><%= yourCall.length %></div>
        <div class="k">your call</div>
        <div class="d">acknowledged - skipped unless you say otherwise</div>
      </div>
    <% } %>
    <div class="stat ok">
      <div class="n"><%= doneCount %></div>
      <div class="k">done today</div>
      <div class="d"><%= totalItems %> items tracked</div>
    </div>
    <div class="stat">
      <div class="n" style="font-size:19px"><%= escape(nextFire) %></div>
      <div class="k">next fire</div>
      <div class="d"><%= escape(cronLine) %></div>
    </div>
    <% if (rt(oncallLine)) { %>
      <div class="stat oncall">
        <div class="n" style="font-size:19px">ON CALL</div>
        <div class="k">your shift today</div>
        <div class="d"><%= escape(oncallLine) %></div>
      </div>
    <% } %>
  </div>

  <% if (!(needsYou.length === 0)) { %>
    <section class="needs-you">
      <h2>Needs you <span class="count">(<%= needsYou.length %>)</span></h2>
      <div class="cards">
        <% for (const [key, item] of needsYou) { %><%= renderCard(key, item) %><% } %>
      </div>
    </section>
  <% } %>

  <% if (!(yourCall.length === 0)) { %>
    <section class="your-call">
      <h2>Acknowledged - your call <span class="count">(<%= yourCall.length %>)</span></h2>
      <p class="hint">You already acknowledged these, so the loop is skipping them. Answer in the ask DM thread
        (<code>2 loop</code>, <code>all skip</code>, or react <code>:robot_face:</code> on an item's line to have the
        loop take it) or in-session, to have the loop take one or to mark it yours. A reply beats a reaction.</p>
      <div class="cards">
        <% for (const [key, item] of yourCall) { %><%= renderCard(key, item) %><% } %>
      </div>
    </section>
  <% } %>

  <section>
    <h2>By status</h2>
    <% if (columns.length === 0) { %>
      <p class="empty">No items in state yet.</p>
    <% } else { %>
      <div class="columns">
        <% for (const [status, entries] of columns) { %>
          <div class="column">
            <h2><%= escape(either(STATUS_LABELS[status], status)) %> <span class="count">(<%= entries.length %>)</span></h2>
            <div class="cards">
              <% for (const [key, item] of entries) { %><%= renderCard(key, item) %><% } %>
            </div>
          </div>
        <% } %>
      </div>
    <% } %>
  </section>

  <section>
    <h2>Last 7 days</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr><th>day</th><th>items</th><% for (const status of STATUS_ORDER) { %><th><%= escape(either(STATUS_LABELS[status], status)) %></th><% } %></tr>
        </thead>
        <tbody>
          <% for (const row of tally) { %>
            <tr>
              <td><%= escape(row.date) %></td>
              <td class="num"><%= row.total %></td>
              <% for (const status of STATUS_ORDER) { %><td class="num"><%= (row.statuses[status] || 0) === 0 ? '&middot;' : row.statuses[status] %></td><% } %>
            </tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </section>

  <% if (!(ticks.length === 0)) { %>
    <section>
      <h2>Ticks <span class="count">(last <%= ticks.length %>)</span></h2>
      <div class="ticks">
        <ol>
          <% for (const tick of ticks) { %>
            <li><span class="at"><%= escape(tick.at) %></span><%= escape(tick.line) %></li>
          <% } %>
        </ol>
      </div>
    </section>
  <% } %>
</div>
`;

// --- render -----------------------------------------------------------------

const CARD_PARAMS = [...Object.keys(HELPERS), 'key', 'item'];
const renderCardTemplate = compileTemplate(CARD, CARD_PARAMS);

function renderCard(key, item) {
  return renderCardTemplate(...Object.values(HELPERS), key, item);
}

const PAGE_VALUES = ['STATUS_ORDER', 'STATUS_LABELS', 'renderCard', 'profile', 'dayLabel', 'generatedAt', 'agents',
  'needsYou', 'yourCall', 'columns', 'doneCount', 'totalItems', 'nextFire', 'cronLine', 'oncallLine', 'tally', 'ticks'];
const renderPageTemplate = compileTemplate(PAGE, [...Object.keys(HELPERS), ...PAGE_VALUES]);

function render(state) {
  const entries = Object.entries(itemsOf(state));
  const withStatus = (status) => entries.filter(([, item]) => get(item, 'status') === status);
  const columns = [];
  for (const status of STATUS_ORDER) {
    const list = sortedItems(withStatus(status));
    if (list.length) columns.push([status, list]);
  }
  const dayDate = dig(state, 'day', 'date');
  const values = {
    STATUS_ORDER,
    STATUS_LABELS,
    renderCard,
    profile: either(get(state, 'profile'), 'local'),
    dayLabel: either(dayDate, today()),
    generatedAt: strftime(nowSeconds(), '%Y-%m-%d %H:%M'),
    agents: liveAgentNames(entries),
    needsYou: sortedItems(withStatus('needs_you')),
    yourCall: sortedItems(withStatus('acked')),
    columns,
    doneCount: doneToday(entries),
    totalItems: entries.length,
    nextFire: nextFireLabel(state),
    cronLine: cronNote(state),
    oncallLine: oncallNote(state),
    tally: sevenDayTally(entries),
    ticks: tickLines(state)
  };
  return asciify(renderPageTemplate(...Object.values(HELPERS), ...PAGE_VALUES.map((name) => values[name])));
}

function main(argv) {
  if (argv.length !== 2 || ['-h', '--help'].includes(argv[0])) {
    warn('usage: node dashboard.js <state.json> <out.html>');
    return 1;
  }

  const [statePath, outPath] = argv;
  if (!fs.existsSync(statePath)) {
    warn(`dashboard.js: no such state file: ${statePath}`);
    return 1;
  }

  let state;
  try {
    state = parseJSON(fs.readFileSync(statePath));
  } catch (error) {
    if (!(error instanceof JSONParserError)) throw error;
    warn(`dashboard.js: ${statePath} is not valid JSON (${firstLine(error.message)}). ` +
         'Run `ff.js get` first — it quarantines a corrupt state.');
    return 1;
  }

  const html = render(state);
  const temp = `${outPath}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(temp, html);
  fs.renameSync(temp, outPath);
  puts(`wrote ${outPath} (${Buffer.byteLength(html)} bytes, ${Object.keys(itemsOf(state)).length} items)`);
  return 0;
}

if (require.main === module) run(main);

module.exports = { render, main };
