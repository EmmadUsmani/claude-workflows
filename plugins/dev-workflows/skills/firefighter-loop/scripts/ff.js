#!/usr/bin/env node
'use strict';

// ff.js — the state CLI for /firefighter-loop. Node built-ins only, no npm packages.
//
// Every mutation of the firefighter's state goes through this script so that two
// ticks can never half-write the same file: writes are temp-file + fs.renameSync,
// and the tick lock is an O_EXCL lockfile, not a flag inside the JSON.
//
// What that does and does not buy you, measured: rename makes each write atomic,
// so a concurrent reader always sees a whole valid state.json and no temp file is
// ever left behind — but a run of `upsert` calls is still read-modify-write, and a
// burst of them fired in parallel loses items (last writer wins). So: hold the
// lease for the whole tick. One tick mutates at a time; `get`/`summary`/`verify`
// are safe to run from anywhere at any moment.
//
// Two files, two owners:
//   config.json  YOURS. What to watch (channels, your user id, keywords, the optional
//                on-call rotation), dispatch caps, the ask reaction. Hand-edit it;
//                `config init` writes a template, `config check` validates it.
//   state.json   THE LOOP'S. Items, watermarks, the lease, the day pointer. Never
//                hand-edit it — every write goes through a subcommand below.
//
// READ-ONLY (safe to run any time, in any session):
//   node ff.js get                          # whole state, human-readable
//   node ff.js get --json                   # whole state, raw JSON
//   node ff.js get --status needs_you       # just the items in one status
//   node ff.js get CEXAMPLE1:<ts> --json    # one item by key (an arg with a ':' is an item key)
//   node ff.js get profile                  # one top-level key (an arg without a ':' is a dotted path)
//   node ff.js get cron.id                  # any nested value, dotted
//   node ff.js summary                      # one line of counts + agents + watermarks + cron
//   node ff.js verify                       # schema check; exit 1 if anything is off
//   node ff.js config [--json]              # the effective config (template merged with yours)
//   node ff.js config check                 # exit 1 if the config can't drive a tick
//
// MUTATING:
//   node ff.js init                         # create the state dir + state.json (idempotent);
//                                           # also writes a config.json template if absent
//   node ff.js init --profile local         # ...and stamp the runtime profile (local|cloud)
//   node ff.js init --force                 # re-init state, discarding it (config.json is kept)
//   node ff.js config init [--force]        # (re)write the config.json template
//   node ff.js set profile local            # set one settable key; see SETTABLE_KEYS below
//   node ff.js set mode autonomous
//   node ff.js set interval 5m
//   node ff.js set scheduler cron
//   node ff.js set cron.id C-7f3e           # dotted paths create the intermediate object
//   node ff.js set dashboard.url https://…
//   node ff.js set channels '["#support CEXAMPLE1","#billing-alerts CEXAMPLE2"]'
//                                           # LOG-header override; defaults to config's channels
//   node ff.js watermark CEXAMPLE1 2040001800.000100     # advance one channel watermark
//   node ff.js watermark mentions 2034-08-23             # set the mention search's after: date
//   node ff.js watermark mentions 2040001800.000100      # remember one already-seen mention ts
//   node ff.js watermark CEXAMPLE1 --forget              # drop a channel key (dropped from the
//                                                        # watch set, or written by a mangled
//                                                        # argv); refuses `mentions`
//   node ff.js upsert CEXAMPLE1:2040001800.000100 --json '{"class":"INCIDENT","status":"new"}'
//   node ff.js link CEXAMPLE2:<ts> CEXAMPLE1:<ts>        # dup root cause -> owner item
//   node ff.js lease acquire --holder tick-0915          # exit 1 if a fresh lease is held
//   node ff.js lease release
//   node ff.js oncall status [--json]       # today's on-call rotation state (read-only)
//   node ff.js oncall auto                  # detect from the on-call channel each tick
//   node ff.js oncall on [<shift_start_ts>] # force TODAY only; rollover resets it to auto
//   node ff.js oncall off                   # never watch the on-call channel
//   node ff.js oncall active <shift_start_ts>  # a tick recording "you are on call today";
//                                           # prints transition=true on the inactive->active
//                                           # tick, which is the one that earns a DM
//   node ff.js oncall inactive              # a tick recording "someone else's shift"
//   node ff.js asks [--json]                # acked items awaiting your call, grouped by
//                                           # the DM ask thread to poll (read-only)
//   node ff.js decide <key> skip|mine|loop [--via dm|reaction|session|cli] [--answer-ts TS]
//                                           # record your call on an acked item:
//                                           # skip -> ignored, mine -> user_owns,
//                                           # loop -> new (queued for dispatch)
//   node ff.js decide <key> loop --via reaction --answer-ts <ask line ts>
//                                           # the ask reaction on the item's own ask line;
//                                           # loses to any reply answer
//   node ff.js log-append --json '{"ch":"#support","from":"U123","class":"INCIDENT",...}'
//   node ff.js log-append --json '{"ts":"2040001800.000100","ch":"#support",...}'
//                                           # `ts` (chat ts or ISO) is NOT a column: it only
//                                           # fills the `time` cell — HH:MM today, MM-DD HH:MM
//                                           # otherwise, so a multi-day sweep is unambiguous
//   node ff.js log-append --tick '0 new - 2 live - next 09:20'
//   node ff.js rollover                     # move the day pointer to today, mkdir the day dir
//   node ff.js sync 'tick 09:15: 1 new, 1 dispatched'   # commit + push the state repo
//
// WHERE STATE LIVES
//   --state-dir DIR   default $FF_STATE_DIR, else ~/.local/state/firefighter-loop
//   --day-dir DIR     default $FF_DAY_DIR,   else <resolved state dir>/days/<YYYY-MM-DD>
//                     — the day dir hangs off the RESOLVED state dir, so --state-dir,
//                     $FF_STATE_DIR and --dry-run all move the day logs with the state
//                     they belong to.
//   --config FILE     default $FF_CONFIG, else <state dir>/config.json (the REAL state
//                     dir — a --dry-run rehearsal reads the same config as live ticks)
//   --dry-run         redirect BOTH dirs into a scratch sandbox so a rehearsal can
//                     write a real state.json, real LOG.md rows and real tick traces
//                     without touching the live ones:
//                       state dir -> <state-dir>/dryrun      (unless --state-dir was passed)
//                       day dir   -> <state-dir>/dryrun/days/<date>  (derived, as above)
//                     and stamp the LOG.md header with a DRY RUN marker. Start each
//                     rehearsal from a clean slate with `init --dry-run --force`.
//                     Gitignore `dryrun/` in a state repo — rehearsals never sync.
//
//   To share one history between a laptop and an off-laptop runner, make the state
//   dir a clone of a private git repo (the `<state_repo>` setting) in both places;
//   `sync` is what makes them one history. Without a repo, `sync` is a no-op and the
//   state is local-only. Nothing else in this script knows which profile it runs under.
//
// SYNC
//   `sync '<message>'` is a no-op with a notice (exit 0) when the state dir is not the
//   ROOT of a git repo (a dir merely nested inside another repo counts as not-a-repo:
//   sync never commits or pushes a parent repo), or when nothing tracked changed and
//   nothing is unpushed. Otherwise:
//   `git pull --rebase --autostash` -> `git add -A` scoped to state.json, config.json,
//   days/, dashboard.html, artifacts/, README.md and .gitignore -> `commit -- <those
//   paths>` (nothing else staged in the index rides along) -> push,
//   retrying `pull --rebase && push` once on a rejection. `--autostash` is required:
//   sync always runs with the tick's writes still uncommitted, and a plain rebase
//   refuses a dirty tree. **A failed push exits 1** — the caller must NOT advance
//   watermarks.
//
// EXIT CODES
//   0  fine
//   1  usage error, lease already held by a live tick, or `verify`/`config check`
//      found problems
//   2  state.json was unparseable. It has been moved to state.json.corrupt-<epoch>
//      and a fresh state has been written. The caller must DM the user about the loss
//      and must NOT auto-backfill.
//
// STATE SCHEMA (state.json)
//   version      1
//   profile      "local" | "cloud"          (`init --profile` or `set profile`)
//   scheduler    "local" | "cron" | "routine" | "cloud_agent"
//   mode         "sweep" | "tick" | "start" | ...  (whatever last armed the loop; LOG header)
//   interval     "5m" | "10m" | "15m"        (LOG header; loop-only — the header
//                                             renders `n/a (sweep)` when mode is
//                                             "sweep" and this is unset)
//   channels     ["#support CEXAMPLE1", …] or [{name, id}, …]  (LOG header override)
//   cron         {id, expression, created_at, expires_at, next_fire_at}
//   lease        {holder, acquired_at, pid}  mirror of lease.lock, for `summary`/dashboard
//   day          {date, dir}
//   dashboard    {path, url}
//   watermarks   {"<channel_id>": {latest_ts, checked_at},
//                 "mentions": {after_date, seen_ts[], checked_at}}
//   oncall       {mode, handle_id, channel_id, channel_name, active, active_date,
//                 shift_start_ts, forced_date}   (the `oncall` subcommand owns it)
//   items        {"<channel_id>:<ts>": item}
//   ticks        [{at, line}]                last TICK_HISTORY entries, newest last
//
// THE oncall BLOCK is read through a defaults merge (defaults drawn from config.json at
// READ time), never assumed present: `init` does not write it, so the mode follows the
// config until the user explicitly runs `oncall auto|on|off`, and with no
// oncall.channel_id in config the effective mode is always `off`. Nothing here writes
// the block just to add it.
//
// ITEM (all fields optional except status; the key is the only dedupe axis —
// never a text hash, because chat messages are edited in place)
//   permalink author title excerpt class priority mention oncall status
//   agent {name, id}  linked_to  linked_from[]  dm {root_ts, last_ts}
//   worktree artifacts[] pr last_reply_ts_seen reason ask env restarted
//   ack {via, ts, excerpt, ask {channel_id, thread_ts, ts, n},
//        decision, decided_at, decided_ts, decided_via}
//   channel_id ts first_seen_at updated_at
//
// Item keys are `<source>:<id>`. For chat that is `<channel_id>:<ts>`; an optional
// issue-tracker or error-tracker source uses its own stable id (`issues:ABC-123`,
// `errors:3907`) — anything with exactly one colon and no whitespace.
//
// `ack` is present only when the user acknowledged the item (their reaction on it, or
// their reply later than it). Acknowledgement never auto-skips: an item that would
// otherwise have been dispatched is parked in `acked` — skipped by default — and the
// user is asked once whether the loop should take it anyway. `decide` records the
// answer; until there is one it simply stays skipped, and stays answerable.
//
// last_reply_ts_seen is the `oldest` cursor for this item's own thread poll: the ts
// of the newest reply already forwarded to its agent (the root ts when no reply has
// been seen). It is NOT derived from the channel read — a channel read windowed on
// a watermark never shows replies on older roots, so every live item's thread is
// polled directly each tick.
//
// STATUSES  new | dispatched | in_progress | paused | needs_you | acked | user_owns |
//           done | ignored | linked
//   acked       the user acknowledged an item that would otherwise have dispatched; it
//               is skipped by default and their call is pending (`asks`, `decide`)
//   user_owns   they answered "I'll work on it myself" — terminal, never dispatched
//
// MERGE SEMANTICS  `upsert` deep-merges the partial into the existing item:
// nested objects merge key by key, everything else (arrays included) replaces
// wholesale — pass the full artifacts list, not just the new entry.
//
// Number kinds, JSON formatting and error text are kept stable across versions by
// lib/compat.js (an integer stays an integer, `1.0` stays `1.0`).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  Exit, puts, warn, abort, run,
  isFloat, isInteger, isHash, isString, rt, nil, className,
  toI, toF, strip, rstrip, subFirst, charSlice, ljust, split, inspect, toS,
  dig, arrayOf, joinFlat, has, fetch, get, uniq, deepMerge,
  JSONParserError, parseJSON, firstLine, generate, prettyGenerate,
  nowSeconds, strftime, strftimeLocal, today, isoUTC, nowIso, localMidnight, parseMoment,
  expandPath, joinPath, exists, mkdirP
} = require('./lib/compat');

const SCHEMA_VERSION = 1;
const STATUSES = ['new', 'dispatched', 'in_progress', 'paused', 'needs_you', 'acked', 'user_owns', 'done', 'ignored', 'linked'];
const LIVE_STATUSES = ['dispatched', 'in_progress', 'paused'];
// The user's three answers to "you acknowledged this — should the loop still take it?",
// and the status each lands the item in. Silence also means skip, but silence leaves
// the item in `acked` (still answerable); only an explicit `skip` closes it.
const ACK_OUTCOMES = {
  skip: ['ignored', 'acknowledged by the user; they chose skip'],
  mine: ['user_owns', 'acknowledged by the user; they are handling it themselves'],
  loop: ['new', 'acknowledged by the user; they asked the loop to take it anyway']
};
const ACK_VIAS = ['dm', 'reaction', 'session', 'cli'];
// `set` refuses anything else at the top level: items and watermarks have their own
// subcommands, and a typo'd top-level key would otherwise sit in state forever.
const SETTABLE_KEYS = ['profile', 'scheduler', 'mode', 'interval', 'cron', 'dashboard', 'channels'];
const PROFILES = ['local', 'cloud'];
const SCHEDULERS = ['local', 'cron', 'routine', 'cloud_agent'];
// On-call is a rotation: the loop watches requests tagged with the on-call handle in
// the on-call channel only on the days the user is on call. `auto` re-derives that
// from the channel every tick, `on` is the user's own assertion (today only —
// `rollover` resets it), `off` never looks. Which channel and handle: config.json.
const ONCALL_MODES = ['auto', 'on', 'off'];
const LEASE_STALE_SECONDS = 15 * 60;
// `sync` stages exactly these. Scoping the add is what keeps a stray file in the state
// dir — a lease.lock, a state.json.corrupt-*, a dryrun/ rehearsal — out of the history.
const SYNC_PATHS = ['state.json', 'config.json', 'days', 'dashboard.html', 'artifacts', '.gitignore', 'README.md'];
const TICK_HISTORY = 200;
const SEEN_TS_HISTORY = 500;
const LOG_TABLE_HEADER = '| time | ch | from | class | status | item | agent | artifacts | note |\n' +
  '|---|---|---|---|---|---|---|---|---|\n';
const LOG_COLUMNS = ['time', 'ch', 'from', 'class', 'status', 'item', 'agent', 'artifacts', 'note'];
// `ts` is accepted but never rendered: it is what `time` is derived from.
const LOG_ROW_KEYS = [...LOG_COLUMNS, 'ts'];

const includes = (list, value) => list.includes(value);

// A plain XDG-style state dir by default. Point --state-dir / $FF_STATE_DIR at a clone
// of your `<state_repo>` to share state with an off-laptop runner.
const DEFAULT_STATE_DIR = joinPath(os.homedir(), '.local', 'state', 'firefighter-loop');

function defaultStateDir() {
  return nil(process.env.FF_STATE_DIR) ? DEFAULT_STATE_DIR : process.env.FF_STATE_DIR;
}

// Derived from the RESOLVED state dir, never from a second hard-coded root: moving
// the state (--state-dir, $FF_STATE_DIR, --dry-run) moves the day logs with it, so
// state.json and the LOG.md it points at can never end up in different repos.
function defaultDayDir(stateDir, date = today()) {
  return nil(process.env.FF_DAY_DIR) ? joinPath(expandPath(stateDir), 'days', date) : process.env.FF_DAY_DIR;
}

// --- config (the user's file) -----------------------------------------------
//
// Everything that names a real channel, person or product area lives here, never in
// this script or the skill text. Values are read through a merge with the template,
// so a config that omits a section still gets sane defaults for it.

const CONFIG_TEMPLATE = Object.freeze({
  _comment: 'firefighter-loop config. Yours to edit. Ids are your chat tool\'s ids ' +
            '(Slack: channel C..., user U..., user group S...). Run `ff.js config check` after editing.',
  chat: 'slack',
  self: {
    user_id: null,
    dm_channel_id: null
  },
  watch: {
    channels: [],
    mentions: true,
    keywords: [],
    area: null
  },
  oncall: {
    channel_id: null,
    channel_name: null,
    handle_id: null,
    rotation_bot_id: null,
    resolved_reactions: ['white_check_mark'],
    in_progress_reactions: ['eyes']
  },
  dispatch: {
    max_per_tick: 3,
    max_initial_sweep: 6,
    live_cap: 8,
    hard_cap: 15,
    repo: null,
    worktrees_dir: null,
    branch_prefix: 'ff/'
  },
  asks: {
    reaction: 'robot_face',
    poll_days: 7
  }
});

const blank = (value) => nil(value) || strip(toS(value)) === '';

class Config {
  constructor(file) {
    this.path = nil(file) ? null : expandPath(file);
    this._data = null;
  }

  exist() { return this.path !== null && exists(this.path); }

  raw() {
    if (!this.exist()) return {};
    try {
      const parsed = parseJSON(fs.readFileSync(this.path));
      return isHash(parsed) ? parsed : {};
    } catch (error) {
      if (!(error instanceof JSONParserError)) throw error;
      return abort(`ff.js: ${this.path} is not valid JSON (${firstLine(error.message)}) — fix it by hand; it is your file`);
    }
  }

  data() {
    if (this._data === null) this._data = deepMerge(parseJSON(generate(CONFIG_TEMPLATE)), this.raw());
    return this._data;
  }

  dig(...keys) { return dig(this.data(), ...keys); }

  writeTemplate(force = false) {
    if (this.exist() && !force) abort(`ff.js: ${this.path} exists — pass --force to overwrite it`);

    mkdirP(path.dirname(this.path));
    fs.writeFileSync(this.path, `${prettyGenerate(CONFIG_TEMPLATE)}\n`);
    this._data = null;
    return this.path;
  }

  // What a tick cannot run without. Outward-facing values (channels, ids) are never
  // guessed, so a missing one is a problem to report, not a default to invent.
  // `reportOnly: true` relaxes only what dispatch needs (the agents' repo); a
  // classify-and-log rehearsal can run without it. Everything else is required.
  problems(reportOnly = false) {
    const list = [];
    if (!this.exist()) list.push(`no config file at ${this.path} — run \`ff.js config init\`, then edit it`);
    if (blank(this.dig('self', 'user_id'))) list.push('self.user_id is not set (mentions, acks and DMs key off it)');
    const channels = this.dig('watch', 'channels');
    if (Array.isArray(channels)) {
      if (!channels.length) list.push('watch.channels is empty — list at least one {"name", "id"} to watch');
      channels.forEach((entry, index) => {
        const id = isHash(entry) ? get(entry, 'id') : null;
        if (blank(id)) list.push(`watch.channels[${index}] has no id`);
      });
    } else {
      list.push('watch.channels must be an array of {"name", "id"} objects');
    }
    if (!Array.isArray(this.dig('watch', 'keywords'))) list.push('watch.keywords must be an array of strings');
    if (blank(this.dig('watch', 'area'))) {
      list.push('watch.area is not set — one line on the product area you own; the classifier needs it');
    }
    const repo = this.dig('dispatch', 'repo');
    if (blank(repo)) {
      if (!reportOnly) list.push('dispatch.repo is not set — the repo agents work in (or run with --report-only)');
    } else if (!exists(joinPath(expandPath(repo), '.git'))) {
      list.push(`dispatch.repo ${toS(repo)} is not a git checkout`);
    }
    if (this.oncallConfigured() && blank(this.dig('oncall', 'handle_id'))) {
      list.push('oncall.channel_id is set but oncall.handle_id is not (which tag marks a request?)');
    }
    for (const key of ['max_per_tick', 'max_initial_sweep', 'live_cap', 'hard_cap']) {
      const value = this.dig('dispatch', key);
      if (!(isInteger(value) && value > 0)) list.push(`dispatch.${key} must be a positive integer`);
    }
    const liveCap = this.dig('dispatch', 'live_cap');
    const hardCap = this.dig('dispatch', 'hard_cap');
    if (isInteger(liveCap) && isInteger(hardCap) && liveCap > hardCap) {
      list.push('dispatch.live_cap exceeds dispatch.hard_cap');
    }
    return list;
  }

  oncallConfigured() { return !blank(this.dig('oncall', 'channel_id')); }
}

let config = new Config(null);
const ffConfig = () => config;

const ackReaction = () => {
  const value = ffConfig().dig('asks', 'reaction');
  return rt(value) ? value : 'robot_face';
};

// An ask thread is polled for answers this long; after that the item stays skipped and
// is still answerable in-session or with `decide`, but no tick spends a read on it.
const ackPollDays = () => {
  const value = ffConfig().dig('asks', 'poll_days');
  return toI(rt(value) ? value : 7);
};

// --- state file -------------------------------------------------------------

class State {
  constructor({ dir, dayDir = null }) {
    this.dir = expandPath(dir);
    this.dayDir = dayDir;
    this.path = joinPath(this.dir, 'state.json');
  }

  exist() { return exists(this.path); }

  lockPath() { return joinPath(this.dir, 'lease.lock'); }

  dayDirFor(date) { return rt(this.dayDir) ? expandPath(this.dayDir) : defaultDayDir(this.dir, date); }

  blank() {
    const day = today();
    return {
      version: SCHEMA_VERSION,
      created_at: nowIso(),
      updated_at: nowIso(),
      profile: null,
      scheduler: null,
      cron: {},
      lease: {},
      day: { date: day, dir: this.dayDirFor(day) },
      dashboard: {},
      watermarks: { mentions: { after_date: null, seen_ts: [] } },
      // No `oncall` block: its mode is derived from config.json at read time, so a
      // state created before the user filled in the on-call section still turns on.
      items: {},
      ticks: []
    };
  }

  init(force = false) {
    mkdirP(this.dir);
    if (this.exist() && !force) return this.read();

    return this.write(this.blank());
  }

  // A parse failure is not recoverable in place: quarantine, re-init, and make the
  // caller notice (exit 2) so it DMs the user instead of silently starting over.
  read() {
    mkdirP(this.dir);
    if (!this.exist()) return this.write(this.blank());

    try {
      return parseJSON(fs.readFileSync(this.path));
    } catch (error) {
      if (!(error instanceof JSONParserError)) throw error;
      const quarantine = `${this.path}.corrupt-${Math.floor(nowSeconds())}`;
      fs.renameSync(this.path, quarantine);
      this.write(this.blank());
      warn('!!! FIREFIGHTER STATE CORRUPT — quarantined and re-initialized. ' +
           `Bad file: ${quarantine} (${firstLine(error.message)}). ` +
           'Items and watermarks are LOST. DM the user; do NOT auto-backfill.');
      throw new Exit(2);
    }
  }

  write(state) {
    mkdirP(this.dir);
    state.updated_at = nowIso();
    const temp = joinPath(this.dir, `.state.json.${process.pid}.${nowSeconds()}`);
    try {
      fs.writeFileSync(temp, `${prettyGenerate(state)}\n`);
      fs.renameSync(temp, this.path);
      return state;
    } finally {
      if (exists(temp)) fs.rmSync(temp, { force: true });
    }
  }

  update(block) {
    const state = this.read();
    block(state);
    return this.write(state);
  }
}

// --- helpers ----------------------------------------------------------------

function parseJsonArgument(raw, what) {
  if (nil(raw) || strip(toS(raw)) === '') abort(`ff.js: ${what} needs --json '<json object>'`);

  let parsed;
  try {
    parsed = parseJSON(raw);
  } catch (error) {
    if (!(error instanceof JSONParserError)) throw error;
    abort(`ff.js: ${what} --json is not valid JSON: ${error.message}`);
  }
  if (!isHash(parsed)) abort(`ff.js: ${what} --json must be a JSON object, got ${className(parsed)}`);

  return parsed;
}

function ageInWords(from) {
  const seconds = secondsSince(from);
  if (seconds === null) return '?';
  if (seconds < 0) return `in ${durationWords(-seconds)}`;

  return durationWords(seconds);
}

// "5m ago" for the past, "in 5m" for a future instant (e.g. a sample dated ahead).
function ago(from) {
  const age = ageInWords(from);
  return age.startsWith('in ') || age === '?' ? age : `${age} ago`;
}

function durationWords(seconds) {
  if (seconds < 60) return `${Math.trunc(seconds)}s`;
  if (seconds < 3600) return `${Math.trunc(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.trunc(seconds / 3600)}h`;

  return `${Math.trunc(seconds / 86400)}d`;
}

function secondsSince(from) {
  const moment = parseMoment(from);
  return moment === null ? null : nowSeconds() - moment;
}

function liveAgents(state) {
  const names = [];
  for (const item of Object.values(fetch(state, 'items', {}))) {
    if (!includes(LIVE_STATUSES, get(item, 'status'))) continue;

    const name = dig(item, 'agent', 'name');
    if (rt(name)) names.push(name);
  }
  return uniq(names);
}

function ackLabel(ack) {
  let label = `ack=${toS(rt(get(ack, 'via')) ? ack.via : '?')}`;
  if (rt(dig(ack, 'ask', 'n'))) label += ` ask=#${toS(dig(ack, 'ask', 'n'))}`;
  if (rt(get(ack, 'decision'))) label += ` decided=${toS(ack.decision)}(${toS(get(ack, 'decided_via'))})`;
  return label;
}

function countsByStatus(state) {
  const tally = {};
  for (const item of Object.values(fetch(state, 'items', {}))) {
    const status = rt(get(item, 'status')) ? item.status : 'unknown';
    const key = toS(status);
    tally[key] = (tally[key] || 0) + 1;
  }
  return tally;
}

// --- on-call ----------------------------------------------------------------
//
// `active` is a fact about ONE day (`active_date`), never a standing setting: the
// rotation moves, and a stale `true` would have the loop working someone else's
// shift. So every read goes through `oncallView` (defaults merged, nothing written),
// and `rollover` clears the day's activation plus any forced `on`.

function oncallDefaults() {
  const cfg = ffConfig();
  return {
    mode: cfg.oncallConfigured() ? 'auto' : 'off',
    handle_id: cfg.dig('oncall', 'handle_id'),
    channel_id: cfg.dig('oncall', 'channel_id'),
    channel_name: cfg.dig('oncall', 'channel_name'),
    active: false,
    active_date: null,
    shift_start_ts: null,
    forced_date: null
  };
}

// Read-only accessor: a state.json without the block reads as the defaults rather
// than being migrated behind the caller's back. A shared state repo is a
// concurrently-written file — a read must never write to it. The channel and handle
// always come from the current config, so editing config.json takes effect at once.
function oncallView(state) {
  const block = get(state, 'oncall');
  const merged = isHash(block) ? Object.assign(oncallDefaults(), block) : oncallDefaults();
  for (const key of ['handle_id', 'channel_id', 'channel_name']) {
    const current = ffConfig().dig('oncall', key);
    if (!nil(current)) merged[key] = current;
  }
  // Unconfigured means off, whatever an older block says: there is nothing to watch.
  if (!ffConfig().oncallConfigured()) {
    Object.assign(merged, { mode: 'off', active: false, active_date: null, shift_start_ts: null });
  }
  return merged;
}

function oncallActiveToday(oncall, day = today()) {
  return get(oncall, 'active') === true && get(oncall, 'active_date') === day;
}

function oncallLine(state) {
  const oncall = oncallView(state);
  const parts = [`mode ${toS(oncall.mode)}`];
  parts.push(oncallActiveToday(oncall) ? `ACTIVE ${toS(oncall.active_date)}` : 'inactive');
  if (rt(oncall.shift_start_ts)) {
    const started = parseMoment(oncall.shift_start_ts);
    parts.push(`shift start ${started !== null ? strftimeLocal(started, '%H:%M') : toS(oncall.shift_start_ts)}`);
  }
  if (oncall.mode === 'on' && rt(oncall.forced_date)) parts.push(`forced ${toS(oncall.forced_date)}`);
  if (oncallActiveToday(oncall)) {
    parts.push(`watching ${toS(rt(oncall.channel_name) ? oncall.channel_name : oncall.channel_id)} for ${toS(oncall.handle_id)}`);
  }
  if (!ffConfig().oncallConfigured()) parts.push('not configured (config.json oncall.channel_id)');
  return parts.join(' · ');
}

// Local midnight, as a chat-shaped ts — the shift start a forced `on` gets when no
// rotation announcement named the user. "Today" here is the runtime's LOCAL date, the
// same notion `rollover` and `day.date` already use, deliberately: two definitions of
// today in one state file would be worse than one. The rotation-timezone read window
// in SKILL.md is the lead's to compute.
function startOfTodayTs() {
  return localMidnight(nowSeconds()).toFixed(6);
}

// --- day log ----------------------------------------------------------------

// The fallback goes through the store, not a bare default: an un-rolled state must
// still land its LOG.md under the state dir actually in use.
function logPath(store, state, dayDir) {
  let dir = dayDir;
  if (!rt(dir)) dir = dig(state, 'day', 'dir');
  if (!rt(dir)) dir = store.dayDirFor(today());
  mkdirP(toS(dir));
  return joinPath(toS(dir), 'LOG.md');
}

function describeEntries(entries) {
  return entries.map((entry) => (isHash(entry)
    ? [get(entry, 'name'), get(entry, 'id')].filter((part) => !nil(part)).map(toS).join(' ')
    : toS(entry))).join(' · ');
}

function channelLine(state) {
  let entries = get(state, 'channels');
  if (!(Array.isArray(entries) && entries.some(rt))) entries = ffConfig().dig('watch', 'channels');
  if (!(Array.isArray(entries) && entries.some(rt))) return '(unset)';

  return describeEntries(entries);
}

// A backfill or a `--since 48h` sweep puts rows from more than one calendar day in
// one table, where a bare HH:MM is ambiguous — so a row whose ts is not today dates
// itself. Callers pass the evaluated message's ts; `time` still wins if given.
function logTimeCell(ts) {
  const parsed = parseMoment(ts);
  const moment = parsed === null ? nowSeconds() : parsed;
  return strftime(moment, strftime(moment, '%Y-%m-%d') === today() ? '%H:%M' : '%m-%d %H:%M');
}

// A sweep is one pass, not a loop: an unset interval there is correct, not missing.
function intervalLine(state) {
  if (rt(get(state, 'interval'))) return toS(state.interval);

  return toS(get(state, 'mode')) === 'sweep' ? 'n/a (sweep)' : '(unset)';
}

function cronLine(state) {
  const cron = fetch(state, 'cron', {});
  if (!(isHash(cron) && rt(get(cron, 'id')))) return '(none)';

  // `x && "…"` keeps a false x as false (printed), and drops a null one.
  const and = (value, text) => (rt(value) ? text() : value);
  return joinFlat([cron.id, and(get(cron, 'expression'), () => `(${toS(cron.expression)})`),
    and(get(cron, 'expires_at'), () => `expires ${toS(cron.expires_at)}`)]
    .filter((part) => !nil(part)), ' ');
}

const dashboardUrl = (state) => {
  const url = dig(state, 'dashboard', 'url');
  return rt(url) ? toS(url) : '(unpublished)';
};

// The header is what a human (or a later tick) reads first, so it carries every
// fact needed to tell one run from another — including whether it was a rehearsal.
function logHeader(state) {
  const date = dig(state, 'day', 'date');
  const day = rt(date) ? toS(date) : today();
  const or = (key, fallback) => (rt(get(state, key)) ? toS(state[key]) : fallback);
  return `# Firefighter log - ${day}${rt(get(state, '_dry_run')) ? '  [DRY RUN]' : ''}\n` +
    '\n' +
    `- mode: ${or('mode', '(unset)')} · interval: ${intervalLine(state)}\n` +
    `- profile: ${or('profile', 'local')}\n` +
    `- scheduler: ${or('scheduler', 'local')}\n` +
    `- cron: ${cronLine(state)}\n` +
    `- channels: ${channelLine(state)}\n` +
    `- dashboard: ${dashboardUrl(state)}\n` +
    `- state: ${toS(get(state, '_state_path'))}\n` +
    '\n' +
    '## Items\n' +
    '\n' +
    `${LOG_TABLE_HEADER}\n` +
    '## Ticks\n' +
    '\n';
}

// `dashboard.url` and `cron.id` are typically still unset when the day's LOG.md is
// first created (day 1's first publish hasn't happened yet), so the header would be
// stuck rendering `(unpublished)` / `(none)` forever. Every append re-derives just
// these two lines from current state and rewrites them in place — the rest of the
// header (mode, profile, scheduler, channels, state path) is written once and stays
// immutable.
function resyncHeaderFields(body, state) {
  const withCron = subFirst(body, /(?:^|(?<=\n))- cron: [^\n]*/, `- cron: ${cronLine(state)}`);
  return subFirst(withCron, /(?:^|(?<=\n))- dashboard: [^\n]*/, `- dashboard: ${dashboardUrl(state)}`);
}

function readOrCreateLog(file, state) {
  if (exists(file)) {
    const body = fs.readFileSync(file, 'utf8');
    const updated = resyncHeaderFields(body, state);
    if (updated !== body) atomicWrite(file, updated);
    return updated;
  }

  const body = logHeader(state);
  atomicWrite(file, body);
  return body;
}

function atomicWrite(file, body) {
  const temp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
}

function appendLogRow(file, state, row) {
  const body = readOrCreateLog(file, state);
  const cells = LOG_COLUMNS.map((column) => toS(rt(get(row, column)) ? row[column] : '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
  const line = `| ${cells.join(' | ')} |\n`;
  const at = body.indexOf('## Ticks');
  if (at === -1) {
    atomicWrite(file, body + line);
  } else {
    const head = body.slice(0, at);
    const tail = body.slice(at + '## Ticks'.length);
    atomicWrite(file, `${rstrip(head)}\n${line}\n## Ticks${tail}`);
  }
  return line;
}

function appendTickLine(file, state, line) {
  let body = readOrCreateLog(file, state);
  const stamped = `- ${strftime(nowSeconds(), '%H:%M')} ${line.replace(/\n/g, ' ')}\n`;
  if (!body.includes('## Ticks')) body += '\n## Ticks\n';
  const trimmed = rstrip(body);
  const separator = trimmed.endsWith('## Ticks') ? '\n\n' : '\n';
  atomicWrite(file, trimmed + separator + stamped);
  return stamped;
}

// --- lease ------------------------------------------------------------------
//
// The lockfile is the real lock (O_EXCL is atomic even across two ticks racing);
// state.json only mirrors it so `summary` and the dashboard can show the holder.

function leaseAcquire(store, holder) {
  for (let attempt = 1; ; attempt += 1) {
    let handle;
    try {
      handle = fs.openSync(store.lockPath(), 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let current;
      try {
        current = parseJSON(fs.readFileSync(store.lockPath()));
      } catch (_ignored) {
        current = {};
      }
      const heldAt = rt(get(current, 'acquired_at')) ? current.acquired_at : isoUTC(fs.statSync(store.lockPath()).mtimeMs / 1000);
      const since = secondsSince(heldAt);
      const age = since === null ? 0 : since;
      const who = toS(rt(get(current, 'holder')) ? current.holder : 'unknown');
      if (age < LEASE_STALE_SECONDS && attempt === 1) {
        warn(`ff.js: lease held by ${who} ` +
             `(pid ${toS(rt(get(current, 'pid')) ? current.pid : '?')}, ${ageInWords(heldAt)} old) — skipping this tick`);
        return 1;
      }
      if (attempt === 1) {
        warn(`ff.js: clearing stale lease from ${who} (${ageInWords(heldAt)} old)`);
        fs.rmSync(store.lockPath(), { force: true });
        continue;
      }
      warn('ff.js: could not acquire lease after clearing a stale one');
      return 1;
    }
    const record = { holder, acquired_at: nowIso(), pid: process.pid };
    fs.writeSync(handle, `${generate(record)}\n`);
    fs.closeSync(handle);
    store.update((state) => { state.lease = record; });
    puts(`lease acquired by ${toS(holder)}`);
    return 0;
  }
}

function leaseRelease(store) {
  fs.rmSync(store.lockPath(), { force: true });
  store.update((state) => { state.lease = {}; });
  puts('lease released');
  return 0;
}

// --- subcommands ------------------------------------------------------------

function renderItems(items) {
  const keys = Object.keys(items);
  if (!keys.length) return '(no items)';

  return keys.map((key) => {
    const item = items[key];
    const parts = [
      ljust(toS(rt(get(item, 'status')) ? item.status : '?'), 12),
      ljust(toS(rt(get(item, 'class')) ? item.class : '-'), 10),
      key,
      rt(get(item, 'title')) ? item.title : charSlice(toS(get(item, 'excerpt')), 0, 60)
    ];
    if (rt(dig(item, 'agent', 'name'))) parts.push(`agent=${toS(dig(item, 'agent', 'name'))}`);
    if (rt(get(item, 'pr'))) parts.push(`pr=${toS(item.pr)}`);
    if (rt(get(item, 'ask'))) parts.push(`ask=${toS(item.ask)}`);
    if (isHash(get(item, 'ack'))) parts.push(ackLabel(item.ack));
    return joinFlat(parts.filter((part) => !nil(part)), '  ');
  }).join('\n');
}

function digPath(state, dotted) {
  let cursor = state;
  for (const segment of split(dotted, '.')) {
    if (!isHash(cursor)) return null;

    cursor = get(cursor, segment);
  }
  return cursor;
}

function commandGet(store, options) {
  const state = store.read();
  const items = fetch(state, 'items', {});
  const key = options.key;

  // An argument with a ':' is an item key; anything else is a dotted state path.
  if (!nil(key) && key.includes(':')) {
    const item = get(items, key);
    if (nil(item)) abort(`ff.js: no item ${key}`);
    puts(options.json ? prettyGenerate(item) : renderItems({ [key]: item }));
    return 0;
  }

  if (!nil(key)) {
    const value = digPath(state, key);
    if (options.json) {
      puts(prettyGenerate(value));
    } else {
      puts(nil(value) ? '(unset)' : (isString(value) ? value : generate(value)));
    }
    return 0;
  }

  if (!nil(options.status)) {
    const wanted = split(options.status, ',').map(strip);
    const unknown = wanted.filter((status) => !includes(STATUSES, status));
    if (unknown.length) abort(`ff.js: unknown status ${unknown.join(', ')}`);

    const selected = {};
    for (const [itemKey, item] of Object.entries(items)) {
      if (includes(wanted, get(item, 'status'))) selected[itemKey] = item;
    }
    puts(options.json ? prettyGenerate(selected) : renderItems(selected));
    return 0;
  }

  if (options.json) {
    puts(prettyGenerate(state));
  } else {
    puts(`state: ${store.path}`);
    puts(`day:   ${toS(dig(state, 'day', 'date'))}  ${toS(dig(state, 'day', 'dir'))}`);
    puts(renderItems(items));
  }
  return 0;
}

// A value that parses as JSON is stored as JSON (numbers, booleans, arrays,
// objects); anything else is stored as the literal string, so `set profile local`
// and `set interval 5m` do not need quoting gymnastics.
function coerceValue(raw) {
  try {
    return parseJSON(raw);
  } catch (error) {
    if (!(error instanceof JSONParserError)) throw error;
    return raw;
  }
}

function commandSet(store, dotted, raw) {
  if (nil(dotted) || nil(raw)) abort('ff.js: set needs <dotted.key> <value>');

  const parts = split(dotted, '.');
  const root = parts.length ? parts[0] : null;
  if (!includes(SETTABLE_KEYS, root)) {
    abort(`ff.js: ${inspect(root)} is not settable (allowed: ${SETTABLE_KEYS.join(' ')}); ` +
          'items use `upsert`, watermarks use `watermark`, the on-call rotation uses `oncall`, ' +
          'and what to watch lives in config.json');
  }

  const value = coerceValue(raw);
  if (parts.length === 1) {
    switch (root) {
      case 'profile':
        if (!includes(PROFILES, toS(value))) abort(`ff.js: profile must be ${PROFILES.join('|')}`);
        break;
      case 'scheduler':
        if (!includes(SCHEDULERS, toS(value))) abort(`ff.js: scheduler must be ${SCHEDULERS.join('|')}`);
        break;
      case 'channels':
        if (!Array.isArray(value)) abort('ff.js: channels must be a JSON array, e.g. \'["#support CEXAMPLE1"]\'');
        break;
      case 'cron':
      case 'dashboard':
        if (!isHash(value)) abort(`ff.js: ${root} must be a JSON object, or set a leaf like ${root}.id`);
        break;
      default:
        break;
    }
  }

  store.update((state) => {
    let cursor = state;
    for (const segment of parts.slice(0, -1)) {
      if (!isHash(get(cursor, segment))) cursor[segment] = {};
      cursor = cursor[segment];
    }
    cursor[parts[parts.length - 1]] = value;
  });
  puts(`${dotted} = ${isString(value) ? value : generate(value)}`);
  return 0;
}

// `oncall` is its own subcommand rather than four more SETTABLE_KEYS because the
// fields are not independent: forcing the mode stamps the day it was forced, and
// recording an activation must report whether it was a *transition* — the one tick
// that earns the "on-call mode active" DM. `get oncall.mode` still reads any leaf.
function commandOncall(store, action, value, options) {
  const day = today();

  if (includes(['auto', 'on', 'active'], action) && !ffConfig().oncallConfigured()) {
    warn(`ff.js: no on-call channel configured — set oncall.channel_id and oncall.handle_id in ${toS(ffConfig().path)}`);
    return 1;
  }

  switch (action) {
    case undefined:
    case null:
    case 'status': {
      const state = store.read();
      puts(options.json ? prettyGenerate(oncallView(state)) : `oncall: ${oncallLine(state)}`);
      return 0;
    }
    case 'auto':
    case 'off':
      store.update((state) => {
        const oncall = oncallView(state);
        state.oncall = oncall;
        oncall.mode = action;
        oncall.forced_date = null;
        if (action !== 'off') return;

        Object.assign(oncall, { active: false, active_date: null, shift_start_ts: null });
      });
      puts(`oncall mode = ${action}${action === 'off' ? ' (never watching the on-call channel)' : ''}`);
      return 0;
    case 'on':
      // The user asserting "I'm on call" — good for TODAY only, which is what
      // `forced_date` records and `rollover` undoes. Activate straight away so `summary`
      // tells the truth before the next tick; a tick's own detection refines
      // `shift_start_ts`.
      store.update((state) => {
        const oncall = oncallView(state);
        state.oncall = oncall;
        oncall.mode = 'on';
        oncall.forced_date = day;
        // A shift start carried over from an earlier day is not today's.
        if (!oncallActiveToday(oncall)) oncall.shift_start_ts = null;
        oncall.shift_start_ts = rt(value) ? value : (rt(oncall.shift_start_ts) ? oncall.shift_start_ts : startOfTodayTs());
        Object.assign(oncall, { active: true, active_date: day });
      });
      puts(`oncall: ${oncallLine(store.read())}`);
      return 0;
    case 'active':
    case 'inactive': {
      const oncall = oncallView(store.read());
      if (oncall.mode === 'off') {
        warn('ff.js: oncall mode is off — run `ff.js oncall auto` before recording a shift');
        return 1;
      }
      if (action === 'active' && (nil(value) || strip(toS(value)) === '')) {
        abort('ff.js: oncall active needs <shift_start_ts> (the ts of the rotation announcement naming you)');
      }

      const wasActive = oncallActiveToday(oncall);
      if (action === 'active') {
        store.update((state) => {
          const block = oncallView(state);
          state.oncall = block;
          Object.assign(block, { active: true, active_date: day, shift_start_ts: value });
        });
        puts(`oncall: ${oncallLine(store.read())} · transition=${!wasActive}`);
      } else {
        // A forced `on` outranks detection: `auto` said "not today", but the user said it is.
        if (oncall.mode === 'on' && oncall.forced_date === day) {
          puts(`oncall: ${oncallLine(store.read())} · kept (forced on for ${day})`);
          return 0;
        }
        store.update((state) => {
          const block = oncallView(state);
          state.oncall = block;
          Object.assign(block, { active: false, active_date: null, shift_start_ts: null });
        });
        puts(`oncall: ${oncallLine(store.read())} · transition=${wasActive}`);
      }
      return 0;
    }
    default:
      return abort(`ff.js: oncall takes status|auto|on|off|active|inactive, got ${inspect(action)}`);
  }
}

// --- acknowledged items: the ask and the answer --------------------------------
//
// An item the user acknowledged that would otherwise have been dispatched is parked
// `acked`: skipped by default, and asked about once — in-session when they are at
// the keyboard, otherwise as one numbered line in that day's ask thread in their
// self-DM. `asks` tells a tick which threads are worth a read; `decide` applies what
// it finds there.

// Only an item that carries an `ack` block and was never touched by an agent may be
// decided — and `new`/`ignored` only when an earlier answer put it there, so a change
// of mind before dispatch works but an unrelated ignore (self-resolved, resolved by
// reaction) can't be reopened, and nothing ever reaches a second dispatch through here.
function decideRefusal(item) {
  if (nil(item)) return 'not in state';
  if (!isHash(get(item, 'ack'))) return 'has no ack block — only acknowledged items are decided';
  if (rt(dig(item, 'agent', 'name'))) return `already has agent ${toS(dig(item, 'agent', 'name'))} — never re-dispatched`;

  const status = get(item, 'status');
  const previous = dig(item, 'ack', 'decision');
  if (includes(['acked', 'user_owns'], status)) return null;
  if (status === 'new' && previous === 'loop') return null;
  if (status === 'ignored' && rt(previous)) return null;

  return `is ${inspect(status)}${rt(previous) ? '' : ' with no earlier decision'} — not decidable`;
}

const CHAT_TS = /^\d+(\.\d+)?$/;

function commandDecide(store, key, decision, options) {
  if (nil(key) || nil(decision)) abort('ff.js: decide needs <item key> skip|mine|loop');
  if (!has(ACK_OUTCOMES, decision)) {
    abort(`ff.js: decision must be ${Object.keys(ACK_OUTCOMES).join('|')}, got ${inspect(decision)}`);
  }
  const via = nil(options.via) ? 'cli' : options.via;
  if (!includes(ACK_VIAS, via)) abort(`ff.js: --via must be ${ACK_VIAS.join('|')}`);
  const answerTs = nil(options.answer_ts) ? null : options.answer_ts;
  if (answerTs !== null && !CHAT_TS.test(answerTs)) {
    abort(`ff.js: --answer-ts must be a chat ts, got ${inspect(answerTs)}`);
  }
  const reaction = via === 'reaction';
  if (reaction && decision !== 'loop') {
    abort(`ff.js: a :${toS(ackReaction())}: reaction only ever means loop, got ${inspect(decision)}`);
  }
  if (reaction && answerTs === null) {
    abort('ff.js: --via reaction needs --answer-ts <ts of the ask message that carries the reaction>');
  }

  let item = get(fetch(store.read(), 'items', {}), key);
  let refusal = decideRefusal(item);
  // A reaction has no ts of its own, so it is pinned to the message it sits on — and that
  // must be THIS item's own ask line. That is what makes "answered before it was asked"
  // impossible for a reaction: the message it reacts to is the ask.
  if (refusal === null && reaction && dig(item, 'ack', 'ask', 'ts') !== answerTs) {
    refusal = `the reacted message ${answerTs} is not this item's ask line ` +
              `(ack.ask.ts ${inspect(dig(item, 'ack', 'ask', 'ts'))})`;
  }
  if (refusal !== null) {
    warn(`ff.js: cannot decide ${key}: ${refusal}`);
    return 1;
  }

  // `--answer-ts` is the ts of the DM reply carrying the answer. A tick re-reads the
  // whole ask thread every time, so an answer at or before the last one applied is
  // stale and must not undo a later decision (made in the thread, in-session or here).
  // And an answer older than the message that asked about this item was never about it:
  // an `all skip` from this morning must not sweep up an item added to the thread at noon.
  //
  // A reaction is stamped with the ask line's own ts — the earliest moment it could have
  // been placed. So a reply answer (always later than the ask) beats it whichever came
  // first, a decision already on the item makes it a no-op, and re-reading the same
  // reaction every tick changes nothing: reply beats reaction, by construction.
  const stamp = answerTs !== null ? answerTs : nowSeconds().toFixed(6);
  let outcome = null;
  store.update((state) => {
    item = state.items[key];
    const ack = item.ack;
    const askTs = dig(ack, 'ask', 'ts');
    const askedTs = rt(askTs) ? askTs : dig(ack, 'ask', 'thread_ts');
    if (answerTs !== null && !reaction && rt(askedTs) && toF(stamp) <= toF(askedTs)) {
      outcome = `unchanged ${key} — this answer predates the ask (${toS(askedTs)})`;
      return;
    }
    if (rt(get(ack, 'decided_ts')) && toF(stamp) <= toF(ack.decided_ts)) {
      outcome = `unchanged ${key} — ${toS(get(ack, 'decision'))} (decided ${toS(ack.decided_ts)}) is not older than this answer`;
      return;
    }

    const [status, reason] = ACK_OUTCOMES[decision];
    Object.assign(ack, { decision, decided_at: nowIso(), decided_ts: stamp, decided_via: via });
    Object.assign(item, { status, reason, updated_at: nowIso() });
    outcome = `decided ${key} ${decision} -> ${status}${decision === 'loop' ? ' (queued for dispatch)' : ''}`;
  });
  puts(outcome);
  return 0;
}

function askEntry(key, item) {
  const ack = item.ack;
  const askTs = dig(ack, 'ask', 'ts');
  return {
    n: dig(ack, 'ask', 'n'),
    key,
    open: get(item, 'status') === 'acked',
    asked_ts: rt(askTs) ? askTs : dig(ack, 'ask', 'thread_ts'),
    status: get(item, 'status'),
    class: get(item, 'class'),
    title: rt(get(item, 'title')) ? item.title : charSlice(toS(get(item, 'excerpt')), 0, 60),
    via: get(ack, 'via'),
    decision: get(ack, 'decision'),
    decided_ts: get(ack, 'decided_ts')
  };
}

// Grouped by ask thread, because that is the unit a tick pays for: one thread read
// per thread with an open item, however many items it lists. Decided items stay
// listed so a later "2 loop" in that thread still maps n -> key.
function askReport(state) {
  const day = today();
  const threads = {};
  const unasked = [];
  for (const [key, item] of Object.entries(fetch(state, 'items', {}))) {
    if (!isHash(get(item, 'ack'))) continue;

    const ask = dig(item, 'ack', 'ask');
    if (isHash(ask) && rt(get(ask, 'thread_ts'))) {
      const threadKey = `${toS(get(ask, 'channel_id'))}:${toS(ask.thread_ts)}`;
      if (!has(threads, threadKey)) {
        threads[threadKey] = { channel_id: get(ask, 'channel_id'), thread_ts: ask.thread_ts, items: [] };
      }
      threads[threadKey].items.push(askEntry(key, item));
    } else if (get(item, 'status') === 'acked') {
      unasked.push(askEntry(key, item));
    }
  }

  const threadList = Object.values(threads);
  for (const thread of threadList) {
    const moment = parseMoment(thread.thread_ts);
    thread.date = moment === null ? null : strftime(moment, '%Y-%m-%d');
    thread.age = ageInWords(thread.thread_ts);
    thread.open = thread.items.filter((entry) => entry.open).length;
    const since = secondsSince(thread.thread_ts);
    const fresh = (since === null ? 0 : since) <= ackPollDays() * 86400;
    thread.poll = thread.open > 0 && fresh;
    thread.items = stableSortBy(thread.items, (entry) => Number(toI(entry.n)));
  }

  // One ask thread per day: the day's first ask posts a root, later ticks reply under
  // it and carry the numbering on.
  const todays = threadList.find((thread) => thread.date === day);
  let todayThread = { channel_id: null, thread_ts: null, next_n: 1 };
  if (todays) {
    const numbers = todays.items.map((entry) => Number(toI(entry.n)));
    todayThread = { channel_id: todays.channel_id, thread_ts: todays.thread_ts,
                    next_n: (numbers.length ? Math.max(...numbers) : 0) + 1 };
  }
  // The only messages worth a reaction check: an OPEN item's own ask line, in a thread
  // still being polled. A decided item's reaction can change nothing (reply beats reaction).
  const probes = threadList.filter((thread) => thread.poll).flatMap((thread) => thread.items
    .filter((entry) => entry.open && rt(entry.asked_ts) && entry.asked_ts !== thread.thread_ts)
    .map((entry) => ({ channel_id: thread.channel_id, message_ts: entry.asked_ts, key: entry.key, n: entry.n })));
  return {
    open: threadList.reduce((sum, thread) => sum + thread.open, 0) + unasked.length,
    threads: stableSortBy(threadList, (thread) => toF(thread.thread_ts)),
    reaction_probes: probes,
    unasked,
    today: todayThread
  };
}

function stableSortBy(list, keyOf) {
  return list.map((value, index) => ({ value, index, key: keyOf(value) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((entry) => entry.value);
}

function commandAsks(store, options) {
  const report = askReport(store.read());
  if (options.json) {
    puts(prettyGenerate(report));
    return 0;
  }

  const polled = report.threads.filter((thread) => thread.poll).length;
  puts(`asks: ${report.open} open · ${polled} thread(s) to poll · ` +
       `${report.reaction_probes.length} ask line(s) to check for :${toS(ackReaction())}: · ` +
       `${report.unasked.length} not yet asked`);
  for (const thread of report.threads) {
    if (thread.open === 0) continue;

    const flag = thread.poll ? 'poll' : `not polled (> ${ackPollDays()}d — answer in-session or with \`decide\`)`;
    puts(`thread ${toS(thread.channel_id)}:${toS(thread.thread_ts)} (${toS(thread.date)}, ${ago(thread.thread_ts)}) ${flag}`);
    for (const entry of thread.items) {
      const where = entry.open ? 'open' : `${toS(entry.decision)} -> ${toS(entry.status)}`;
      puts(`  #${toS(entry.n)}  ${entry.key}  ${toS(rt(entry.class) ? entry.class : '-')}  ${toS(entry.title)}  (${toS(entry.via)}; ${where})`);
    }
  }
  if (report.unasked.length) {
    puts('not yet asked:');
    for (const entry of report.unasked) {
      puts(`  ${entry.key}  ${toS(rt(entry.class) ? entry.class : '-')}  ${toS(entry.title)}  (${toS(entry.via)})`);
    }
  }
  const todayThread = report.today;
  if (rt(todayThread.thread_ts)) {
    puts(`today: reply under ${toS(todayThread.channel_id)}:${toS(todayThread.thread_ts)}, next #${todayThread.next_n}`);
  } else {
    puts('today: no ask thread yet — the next ask posts a new root, starting at #1');
  }
  return 0;
}

// Time UNTIL expiry (not since): EXPIRED when past, a warning under 24h.
function cronExpiryNote(expiresAt) {
  const moment = parseMoment(expiresAt);
  if (moment === null) return '';

  const remaining = moment - nowSeconds();
  if (!(remaining > 0)) return ' EXPIRED — run `start` again';

  const note = ` expires in ${durationWords(remaining)}`;
  return remaining < 86400 ? `${note} — WARNING: under 24h left, run \`start\` again soon` : note;
}

function commandSummary(store) {
  const state = store.read();
  const tally = countsByStatus(state);
  const items = fetch(state, 'items', {});
  const ordered = STATUSES.filter((status) => (tally[status] || 0) > 0).map((status) => `${tally[status]} ${status}`);
  puts(`items: ${Object.keys(items).length} total${ordered.length ? ` — ${ordered.join(' · ')}` : ''}`);

  const agents = liveAgents(state);
  puts(`agents: ${agents.length} live${agents.length ? ` (${joinFlat(agents, ', ')})` : ''}`);

  const marks = Object.entries(fetch(state, 'watermarks', {})).map(([name, mark]) => {
    if (name === 'mentions') {
      const seen = get(mark, 'seen_ts');
      return `mentions after:${toS(rt(get(mark, 'after_date')) ? mark.after_date : '?')} (${(rt(seen) ? seen : []).length} seen, ` +
        `checked ${ago(get(mark, 'checked_at'))})`;
    }
    return `${name} ${ago(get(mark, 'checked_at'))}`;
  });
  puts(`watermarks: ${marks.length ? marks.join(' · ') : '(none)'}`);

  const cron = fetch(state, 'cron', {});
  if (rt(get(cron, 'id'))) {
    const expiry = cronExpiryNote(get(cron, 'expires_at'));
    puts(`cron: ${toS(cron.id)} ${toS(get(cron, 'expression'))}${expiry}`);
  } else {
    puts('cron: none (session-only cron; `start` re-creates it)');
  }

  puts(`oncall: ${oncallLine(state)}`);

  const openAsks = Object.values(items).filter((item) => get(item, 'status') === 'acked').length;
  if (openAsks > 0) {
    puts(`asks: ${openAsks} acknowledged item(s) awaiting your call — skipped until you answer (\`ff.js asks\`)`);
  }

  const configProblems = ffConfig().problems();
  const status = configProblems.length ? `${configProblems.length} problem(s), run \`ff.js config check\`` : 'ok';
  puts(`config: ${toS(ffConfig().path)} — ${status}`);

  const lease = fetch(state, 'lease', {});
  puts(`lease: ${rt(get(lease, 'holder')) ? `${toS(lease.holder)} (${ageInWords(get(lease, 'acquired_at'))} old)` : 'free'}`);
  puts(`day: ${toS(dig(state, 'day', 'date'))} ${toS(dig(state, 'day', 'dir'))}`);
  return 0;
}

function describeChannels(entries) {
  const list = arrayOf(entries);
  if (!list.length) return '(no channels)';

  return describeEntries(list);
}

function commandConfig(action, options) {
  const cfg = ffConfig();
  switch (action) {
    case undefined:
    case null:
    case 'show': {
      if (options.json) {
        puts(prettyGenerate(cfg.data()));
        return 0;
      }
      const orUnset = (value, fallback = '(unset)') => (rt(value) ? toS(value) : fallback);
      puts(`config: ${toS(cfg.path)}${cfg.exist() ? '' : ' (absent — showing the template)'}`);
      puts(`watch: ${describeChannels(cfg.dig('watch', 'channels'))}${rt(cfg.dig('watch', 'mentions')) ? ' + your mentions' : ''}`);
      const keywords = arrayOf(cfg.dig('watch', 'keywords'));
      puts(`keywords: ${keywords.length ? joinFlat(keywords, ', ') : '(none — every channel item is in scope)'}`);
      puts(`area: ${orUnset(cfg.dig('watch', 'area'))}`);
      puts(`self: ${orUnset(cfg.dig('self', 'user_id'))}`);
      const oncall = cfg.oncallConfigured()
        ? `${toS(rt(cfg.dig('oncall', 'channel_name')) ? cfg.dig('oncall', 'channel_name') : cfg.dig('oncall', 'channel_id'))} ` +
          `tag ${orUnset(cfg.dig('oncall', 'handle_id'))} ` +
          `rotation bot ${orUnset(cfg.dig('oncall', 'rotation_bot_id'), '(unset — `oncall on` only)')}`
        : '(not configured)';
      puts(`oncall: ${oncall}`);
      puts(`dispatch: ${toS(cfg.dig('dispatch', 'max_per_tick'))}/tick · ${toS(cfg.dig('dispatch', 'live_cap'))} live · ` +
           `hard cap ${toS(cfg.dig('dispatch', 'hard_cap'))} · repo ${orUnset(cfg.dig('dispatch', 'repo'))} · ` +
           `branches ${toS(cfg.dig('dispatch', 'branch_prefix'))}<slug>`);
      return 0;
    }
    case 'init': {
      const written = cfg.writeTemplate(options.force);
      puts(`wrote config template -> ${written} (edit it, then \`ff.js config check\`)`);
      return 0;
    }
    case 'check': {
      const problems = cfg.problems(options.report_only);
      if (!problems.length) {
        puts(`config OK — ${toS(cfg.path)}`);
        return 0;
      }
      problems.forEach((problem) => warn(`CONFIG: ${problem}`));
      warn(`ff.js config check: ${problems.length} problem(s)`);
      return 1;
    }
    default:
      return abort(`ff.js: config takes show|init|check, got ${inspect(action)}`);
  }
}

function commandWatermarkForget(store, target) {
  if (nil(target)) abort('ff.js: watermark --forget needs <channel_id>');
  // `mentions` is structural: the mention search has nowhere else to keep its after: date.
  if (target === 'mentions') abort('ff.js: watermark --forget will not remove the mentions watermark');

  let removed = null;
  store.update((state) => {
    if (!rt(get(state, 'watermarks'))) state.watermarks = {};
    const marks = state.watermarks;
    if (has(marks, target)) {
      removed = marks[target];
      delete marks[target];
    }
  });
  if (nil(removed)) {
    warn(`ff.js: no watermark ${inspect(target)} to forget`);
    return 1;
  }
  puts(`forgot watermark ${target} (was latest_ts=${inspect(get(removed, 'latest_ts'))})`);
  return 0;
}

function commandWatermark(store, target, value) {
  if (nil(target) || nil(value)) abort('ff.js: watermark needs <channel_id|mentions> <ts|date>');

  let stored = value;
  store.update((state) => {
    if (!rt(get(state, 'watermarks'))) state.watermarks = {};
    const marks = state.watermarks;
    if (target === 'mentions') {
      if (!rt(get(marks, 'mentions'))) marks.mentions = { after_date: null, seen_ts: [] };
      const mark = marks.mentions;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        mark.after_date = value;
      } else {
        const seen = rt(get(mark, 'seen_ts')) ? mark.seen_ts : [];
        mark.seen_ts = uniq([...seen, value]).slice(-SEEN_TS_HISTORY);
      }
      mark.checked_at = nowIso();
    } else {
      if (!rt(get(marks, target))) marks[target] = {};
      const mark = marks[target];
      // Never move a watermark backwards: a late-arriving read must not replay a channel.
      const current = get(mark, 'latest_ts');
      if (nil(current) || toF(value) >= toF(current)) mark.latest_ts = value;
      mark.checked_at = nowIso();
      stored = mark.latest_ts;
    }
  });
  puts(`watermark ${target} = ${toS(stored)}${stored === value ? '' : ` (kept; ${value} is older)`}`);
  return 0;
}

const ITEM_KEY = /^[^:\s]+:[^:\s]+$/;

// "<channel_id>:<ts>" -> [channel_id, ts]; only the first ':' splits.
function splitKey(key) {
  const at = key.indexOf(':');
  return at === -1 ? [key, null] : [key.slice(0, at), key.slice(at + 1)];
}

function commandUpsert(store, key, payload) {
  if (nil(key)) abort('ff.js: upsert needs <key>');
  if (!ITEM_KEY.test(key)) {
    abort(`ff.js: item key must be <channel_id>:<ts> (or <source>:<id>), got ${inspect(key)}`);
  }

  const partial = parseJsonArgument(payload, 'upsert');
  if (rt(get(partial, 'status')) && !includes(STATUSES, partial.status)) {
    abort(`ff.js: unknown status ${inspect(partial.status)} (allowed: ${STATUSES.join(' ')})`);
  }

  let created = false;
  store.update((state) => {
    if (!rt(get(state, 'items'))) state.items = {};
    const items = state.items;
    let existing = get(items, key);
    if (nil(existing)) {
      created = true;
      const [channelId, ts] = splitKey(key);
      existing = {
        channel_id: channelId,
        ts,
        status: 'new',
        first_seen_at: nowIso()
      };
    }
    const merged = deepMerge(existing, partial);
    merged.updated_at = nowIso();
    items[key] = merged;
  });
  puts(`${created ? 'created' : 'updated'} ${key}`);
  return 0;
}

function commandLink(store, key, ownerKey) {
  if (nil(key) || nil(ownerKey)) abort('ff.js: link needs <key> <owner_key>');
  if (key === ownerKey) abort('ff.js: an item cannot link to itself');

  store.update((state) => {
    if (!rt(get(state, 'items'))) state.items = {};
    const items = state.items;
    if (!has(items, ownerKey)) warn(`ff.js: warning — owner ${ownerKey} is not in state yet`);
    let item = get(items, key);
    if (!rt(item)) {
      const [channelId, ts] = splitKey(key);
      item = { channel_id: channelId, ts, first_seen_at: nowIso() };
    }
    item.status = 'linked';
    item.linked_to = ownerKey;
    item.updated_at = nowIso();
    items[key] = item;

    const owner = get(items, ownerKey);
    if (rt(owner)) {
      const from = rt(get(owner, 'linked_from')) ? owner.linked_from : [];
      owner.linked_from = uniq([...from, key]);
      owner.updated_at = nowIso();
    }
  });
  puts(`linked ${key} -> ${ownerKey}`);
  return 0;
}

function commandLogAppend(store, options) {
  const state = store.read();
  state._state_path = store.path;
  if (options.dry_run) state._dry_run = true;
  const file = logPath(store, state, options.day_dir);

  if (!nil(options.tick)) {
    appendTickLine(file, state, options.tick);
    store.update((current) => {
      const ticks = rt(get(current, 'ticks')) ? current.ticks : [];
      current.ticks = [...ticks, { at: nowIso(), line: options.tick }].slice(-TICK_HISTORY);
    });
    puts(`tick logged -> ${file}`);
    return 0;
  }

  const row = parseJsonArgument(options.json_payload, 'log-append');
  const unknown = Object.keys(row).filter((column) => !includes(LOG_ROW_KEYS, column));
  if (unknown.length) {
    warn(`log-append: unknown column(s) ${unknown.join(', ')} — allowed: ${LOG_ROW_KEYS.join(', ')}`);
    return 1;
  }
  const ts = get(row, 'ts');
  delete row.ts;
  if (nil(get(row, 'time')) || toS(row.time) === '') row.time = logTimeCell(ts);
  appendLogRow(file, state, row);
  puts(`row logged -> ${file}`);
  return 0;
}

function commandRollover(store, dayDir) {
  const day = today();
  let rolled = false;
  let target = null;
  const oncallReset = [];
  store.update((state) => {
    if (!rt(get(state, 'day'))) state.day = {};
    const dayBlock = state.day;
    target = rt(dayDir) ? expandPath(dayDir) : store.dayDirFor(day);
    rolled = get(dayBlock, 'date') !== day || get(dayBlock, 'dir') !== target;
    dayBlock.date = day;
    dayBlock.dir = target;

    // The rotation moves every day: yesterday's activation says nothing about today,
    // and a forced `on` was the user asserting *that* day only. Both expire here, so a
    // new day always starts from detection and never silently inherits someone else's
    // shift. An activation already stamped today is left alone — rollover runs every
    // tick, and re-clearing it would re-fire the activation DM.
    const oncall = get(state, 'oncall');
    if (!isHash(oncall)) return;

    if (rt(get(oncall, 'active')) && get(oncall, 'active_date') !== day) {
      Object.assign(oncall, { active: false, active_date: null, shift_start_ts: null });
      oncallReset.push('activation cleared');
    }
    if (get(oncall, 'mode') === 'on' && get(oncall, 'forced_date') !== day) {
      oncall.mode = 'auto';
      oncall.forced_date = null;
      oncallReset.push('forced on -> auto');
    }
  });
  mkdirP(target);
  puts(`${rolled ? 'rolled over to' : 'already on'} ${day} — ${target}` +
       `${oncallReset.length ? ` (oncall: ${oncallReset.join(', ')})` : ''}`);
  return 0;
}

function commandVerify(store) {
  const state = store.read();
  const problems = [];
  if (Number(get(state, 'version')) !== SCHEMA_VERSION || !(isInteger(state.version) || isFloat(state.version))) {
    problems.push(`version is ${inspect(get(state, 'version'))}, expected ${SCHEMA_VERSION}`);
  }
  for (const key of ['cron', 'lease', 'day', 'dashboard', 'watermarks', 'items']) {
    if (!isHash(get(state, key))) problems.push(`missing or non-object key ${key}`);
  }
  if (!Array.isArray(fetch(state, 'ticks', []))) problems.push('ticks is not an array');
  if (rt(get(state, 'channels')) && !Array.isArray(state.channels)) {
    problems.push('channels must be an array of "#name ID" strings or {name, id} objects');
  }
  if (rt(get(state, 'profile')) && !includes(PROFILES, state.profile)) {
    problems.push(`profile is ${inspect(state.profile)}, expected ${PROFILES.join('|')}`);
  }
  if (rt(get(state, 'scheduler')) && !includes(SCHEDULERS, state.scheduler)) {
    problems.push(`scheduler is ${inspect(state.scheduler)}, expected ${SCHEDULERS.join('|')}`);
  }

  // Checked only when present: absent is valid (it reads as the defaults), malformed
  // is not.
  const oncall = get(state, 'oncall');
  if (!nil(oncall) && !isHash(oncall)) {
    problems.push('oncall must be an object {mode, handle_id, channel_id, active, ...}');
  } else if (isHash(oncall)) {
    if (!includes(ONCALL_MODES, toS(get(oncall, 'mode')))) {
      problems.push(`oncall.mode is ${inspect(get(oncall, 'mode'))}, expected ${ONCALL_MODES.join('|')}`);
    }
    if (!includes([true, false, null], get(oncall, 'active'))) {
      problems.push(`oncall.active is ${inspect(get(oncall, 'active'))}, expected true|false`);
    }
    for (const key of ['handle_id', 'channel_id', 'channel_name', 'active_date', 'shift_start_ts', 'forced_date']) {
      if (!(nil(get(oncall, key)) || isString(oncall[key]))) problems.push(`oncall.${key} must be a string or null`);
    }
    if (get(oncall, 'active') === true && nil(get(oncall, 'active_date'))) problems.push('oncall.active is true with no active_date');
    if (get(oncall, 'active') === true && nil(get(oncall, 'shift_start_ts'))) problems.push('oncall.active is true with no shift_start_ts');
  }

  let items = fetch(state, 'items', {});
  if (!isHash(items)) items = {};
  for (const [key, item] of Object.entries(items)) {
    if (!ITEM_KEY.test(key)) problems.push(`item key ${inspect(key)} is not <channel_id>:<ts>`);
    if (!isHash(item)) {
      problems.push(`item ${key} is not an object`);
      continue;
    }
    if (!includes(STATUSES, get(item, 'status'))) problems.push(`item ${key} has unknown status ${inspect(get(item, 'status'))}`);
    if (rt(get(item, 'agent')) && !isHash(item.agent)) {
      problems.push(`item ${key} agent must be an object {name, id}`);
    }
    if (rt(get(item, 'artifacts')) && !Array.isArray(item.artifacts)) {
      problems.push(`item ${key} artifacts must be an array`);
    }
    if (rt(get(item, 'linked_to')) && !(isString(item.linked_to) && has(items, item.linked_to))) {
      problems.push(`item ${key} links to missing owner ${toS(item.linked_to)}`);
    }
    if (get(item, 'status') === 'linked' && nil(get(item, 'linked_to'))) {
      problems.push(`item ${key} is linked but has no linked_to`);
    }
    const ack = get(item, 'ack');
    if (!nil(ack) && !isHash(ack)) {
      problems.push(`item ${key} ack must be an object {via, ts, ask, decision, ...}`);
    } else if (isHash(ack)) {
      if (rt(get(ack, 'decision')) && !(isString(ack.decision) && has(ACK_OUTCOMES, ack.decision))) {
        problems.push(`item ${key} ack.decision is ${inspect(ack.decision)}, expected ${Object.keys(ACK_OUTCOMES).join('|')}`);
      }
      if (rt(get(ack, 'ask')) && !isHash(ack.ask)) problems.push(`item ${key} ack.ask must be an object {channel_id, thread_ts, ts, n}`);
      if (get(item, 'status') === 'acked' && rt(get(ack, 'decision'))) {
        problems.push(`item ${key} is acked but already carries decision ${inspect(ack.decision)}`);
      }
    }
    if (includes(['acked', 'user_owns'], get(item, 'status')) && !isHash(ack)) {
      problems.push(`item ${key} is ${toS(item.status)} but has no ack block`);
    }
  }

  let watermarks = get(state, 'watermarks');
  if (!isHash(watermarks)) watermarks = {};
  for (const [name, mark] of Object.entries(watermarks)) {
    if (!isHash(mark)) {
      problems.push(`watermark ${name} is not an object`);
      continue;
    }
    if (name !== 'mentions') continue;

    const seen = get(mark, 'seen_ts');
    if (!Array.isArray(rt(seen) ? seen : [])) problems.push('watermarks.mentions.seen_ts must be an array');
  }

  if (!problems.length) {
    const allMarks = fetch(state, 'watermarks', {});
    puts(`OK — ${Object.keys(items).length} items, ${Object.keys(allMarks).length} watermarks, schema v${SCHEMA_VERSION}`);
    return 0;
  }
  problems.forEach((problem) => warn(`PROBLEM: ${problem}`));
  warn(`ff.js verify: ${problems.length} problem(s)`);
  return 1;
}

// --- sync -------------------------------------------------------------------
//
// When the state dir is a clone of a private state repo, a tick's last act is to
// publish it. Everything here is deliberately loud on failure and silent-but-explicit
// on a no-op: the caller keys "may I advance the watermarks?" off the exit code.

// Run git with stdout and stderr interleaved into one capture (the order git wrote
// them), stdin inherited. Returns [trimmed output, succeeded?].
function gitCapture(dir, ...args) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-git-'));
  const capture = path.join(scratch, 'out');
  const fd = fs.openSync(capture, 'w');
  let result;
  try {
    result = spawnSync('git', ['-C', dir, ...args], { stdio: ['inherit', fd, fd] });
  } finally {
    fs.closeSync(fd);
  }
  const output = fs.readFileSync(capture, 'utf8');
  fs.rmSync(scratch, { recursive: true, force: true });
  return [strip(output), !result.error && result.status === 0];
}

// 'root' when the state dir IS a repo's top level, 'nested' when it merely sits inside
// some other repo (a sandbox, an app checkout), 'none' otherwise. Only 'root' syncs:
// `--is-inside-work-tree` alone once made sync pull, commit and try to push the
// PARENT repo of a state dir that happened to live inside it.
function stateRepoStatus(dir) {
  if (!(exists(dir) && fs.statSync(dir).isDirectory())) return ['none', null];

  const [top, ok] = gitCapture(dir, 'rev-parse', '--show-toplevel');
  if (!(ok && top !== '')) return ['none', null];

  return fs.realpathSync(top) === fs.realpathSync(dir) ? ['root', top] : ['nested', top];
}

function lastLine(text) {
  const lines = toS(text).split(/(?<=\n)/).map(strip).filter((line) => line !== '');
  return lines.length ? lines[lines.length - 1] : '';
}

// A pathspec that matches nothing makes `git add` fail outright, and `artifacts/`
// legitimately doesn't exist until the first cloud run — so only name what is really
// there, on disk or in the index (an index-only entry is a deletion to stage).
function syncPathspecs(dir) {
  return SYNC_PATHS.filter((entry) => exists(joinPath(dir, entry)) || gitCapture(dir, 'ls-files', '--', entry)[0] !== '');
}

function commandSync(store, message) {
  if (strip(toS(message)) === '') {
    abort('ff.js: sync needs a commit message, e.g. ff.js sync "tick 09:15: 1 new, 1 dispatched"');
  }

  const dir = store.dir;
  const [status, top] = stateRepoStatus(dir);
  if (status === 'nested') {
    puts(`sync: ${dir} sits inside the repo ${top} but is not its root — refusing to commit ` +
         'or push a parent repo; state is local-only (no-op). Make the state dir its own clone to sync.');
    return 0;
  }
  if (status !== 'root') {
    puts(`sync: ${dir} is not a git repo — state is local-only, nothing to push (no-op)`);
    return 0;
  }

  // `--autostash` is not optional here: sync always runs with the tick's writes still
  // uncommitted, and a plain `pull --rebase` refuses outright on a dirty tree.
  const [pulled, pullOk] = gitCapture(dir, 'pull', '--rebase', '--autostash');
  if (!pullOk) warn(`ff.js sync: pull --rebase failed, continuing to the push: ${lastLine(pulled)}`);

  const paths = syncPathspecs(dir);
  const dirty = paths.length ? gitCapture(dir, 'status', '--porcelain', '--', ...paths)[0] : '';
  const [unpushed, upstreamOk] = gitCapture(dir, 'rev-list', '--count', '@{u}..HEAD');
  if (dirty === '' && upstreamOk && unpushed === '0') {
    puts('sync: nothing changed and nothing unpushed (no-op)');
    return 0;
  }

  if (dirty !== '') {
    const [added, addOk] = gitCapture(dir, 'add', '-A', '--', ...paths);
    if (!addOk) {
      warn(`ff.js sync: git add failed: ${lastLine(added)}`);
      return 1;
    }
    const [staged] = gitCapture(dir, 'diff', '--cached', '--name-only', '--', ...paths);
    if (staged !== '') {
      // Pathspec-limited: anything else staged in this repo's index stays staged, uncommitted.
      const [committed, commitOk] = gitCapture(dir, 'commit', '-m', message, '--', ...paths);
      if (!commitOk) {
        warn(`ff.js sync: commit failed: ${lastLine(committed)}`);
        return 1;
      }
    }
  }

  // One retry only, and only through pull --rebase: a `push --force` here would throw
  // away a concurrent run's items, which is exactly the loss this repo exists to prevent.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [pushed, pushOk] = gitCapture(dir, 'push');
    if (pushOk) {
      const [head] = gitCapture(dir, 'rev-parse', '--short', 'HEAD');
      puts(`sync: pushed ${head} — ${message}`);
      return 0;
    }
    if (attempt === 0) {
      warn(`ff.js sync: push rejected (${lastLine(pushed)}) — pull --rebase, retrying once`);
      const [retried, retryOk] = gitCapture(dir, 'pull', '--rebase', '--autostash');
      if (!retryOk) warn(`ff.js sync: retry pull --rebase failed: ${lastLine(retried)}`);
    } else {
      warn(`ff.js sync: PUSH FAILED — ${lastLine(pushed)}. ` +
           'The commit is local only; do NOT advance watermarks.');
    }
  }
  return 1;
}

// --- CLI --------------------------------------------------------------------

const USAGE = `usage: node ff.js <subcommand> [args] [--state-dir DIR] [--day-dir DIR] [--config FILE] [--dry-run]

read-only:  get [<item key>|<dotted.key>] [--status S] [--json]  |  summary  |  verify
            config [show] [--json] | config check [--report-only]   (what to watch — YOUR file)
            oncall status [--json]     (today's on-call rotation state)
            asks [--json]              (acked items awaiting your call, by ask thread)
mutating:   init [--profile local|cloud] [--force]  (also writes a config template if absent)
            config init [--force]      (write the config.json template)
            set <dotted.key> <value>   (${SETTABLE_KEYS.join(' ')})
            oncall auto|on|off         (watch on-call requests in config's on-call channel:
                                        detect | force TODAY only | never; \`rollover\`
                                        resets a forced \`on\` back to auto on the next day)
            oncall active <shift_start_ts> | oncall inactive
                                       (what a tick records after detection;
                                        \`active\` prints transition=true on the
                                        inactive->active tick — the one that DMs)
            watermark <channel_id|mentions> <ts|date>
            watermark <channel_id> --forget   (remove that key; refuses \`mentions\`)
            upsert <key> --json '<partial item>'
            link <key> <owner_key>
            decide <key> skip|mine|loop [--via dm|reaction|session|cli] [--answer-ts TS]
                                       (your call on an acked item: skip -> ignored,
                                        mine -> user_owns, loop -> new; an answer no
                                        newer than the last decision is a no-op.
                                        --via reaction = the ask reaction on the item's
                                        own ask line: loop only, --answer-ts is that
                                        line's ts, and any reply answer beats it)
            lease acquire [--holder NAME] | lease release
            log-append --json '<row>' | log-append --tick '<line>'
               (row cols: ${LOG_COLUMNS.join(' ')}; plus \`ts\`, which only
                dates the time cell: HH:MM today, MM-DD HH:MM otherwise)
            rollover
            sync '<commit message>'    (commit + push the state repo; exit 1 on a
                                        failed push — do NOT advance watermarks)

--dry-run  redirects the state dir to <state-dir>/dryrun (and with it the derived
           day dir, <state-dir>/dryrun/days/<date>) unless that flag was passed
           explicitly, and stamps the LOG.md header DRY RUN. \`init --dry-run
           --force\` resets it. Gitignore \`dryrun/\` in a state repo so it never syncs.

NOTE (zsh): never build flags in an unquoted variable — D="--state-dir X" makes
ONE argv word. Write flags inline, or use an array: D=(--state-dir X); ... "\${D[@]}"

See the header comment of this file for the schema and exit codes.
`;

// --- option parsing ---------------------------------------------------------
//
// Flags may sit anywhere (`ff.js --state-dir D init` and `ff.js init --state-dir D`).
// Long flags accept unique abbreviations (`--stat` is ambiguous, `--statu` is
// --status), `--flag=value`, and a single-letter `-x` that names exactly one flag.
// A flag that takes a value consumes the next word; `--json` takes the next word
// only when it does not start with '-' (bare `--json` means "print JSON").

const OPTION_SPECS = [
  { name: 'state-dir', arg: 'required', label: 'DIR', desc: `state directory (default $FF_STATE_DIR or ${DEFAULT_STATE_DIR})`,
    set: (o, v) => { o.state_dir = v; o.state_dir_explicit = true; } },
  { name: 'day-dir', arg: 'required', label: 'DIR', desc: 'day dir for LOG.md (default $FF_DAY_DIR or <state-dir>/days/<date>)',
    set: (o, v) => { o.day_dir = v; } },
  { name: 'config', arg: 'required', label: 'FILE', desc: 'config file (default $FF_CONFIG or <state-dir>/config.json)',
    set: (o, v) => { o.config = v; } },
  { name: 'dry-run', arg: 'none', desc: 'write to a scratch <state-dir>/dryrun sandbox; mark the LOG header DRY RUN',
    set: (o) => { o.dry_run = true; } },
  { name: 'profile', arg: 'required', label: 'NAME', desc: `runtime profile for \`init\` (${PROFILES.join('|')})`,
    set: (o, v) => { o.profile = v; } },
  { name: 'json', arg: 'placed', label: '[JSON]', desc: 'output raw JSON, or the JSON payload for upsert/log-append',
    set: (o, v) => { if (nil(v)) o.json = true; else o.json_payload = v; } },
  { name: 'status', arg: 'required', label: 'STATUS', desc: 'filter `get` by status (comma-separated)',
    set: (o, v) => { o.status = v; } },
  { name: 'tick', arg: 'required', label: 'LINE', desc: 'append a trace line to the day log\'s ## Ticks section',
    set: (o, v) => { o.tick = v; } },
  { name: 'holder', arg: 'required', label: 'NAME', desc: 'lease holder name',
    set: (o, v) => { o.holder = v; } },
  { name: 'report-only', arg: 'none', desc: 'config check: do not require dispatch.repo (classify-and-log runs)',
    set: (o) => { o.report_only = true; } },
  { name: 'force', arg: 'none', desc: 're-init state (discarding it), or overwrite the config template',
    set: (o) => { o.force = true; } },
  { name: 'forget', arg: 'none', desc: 'watermark: remove that channel key instead of advancing it',
    set: (o) => { o.forget = true; } },
  { name: 'via', arg: 'required', label: 'WHERE', desc: `decide: where the answer came from (${ACK_VIAS.join('|')})`,
    set: (o, v) => { o.via = v; } },
  { name: 'answer-ts', arg: 'required', label: 'TS', desc: 'decide: ts of the DM reply carrying the answer (with --via reaction: the reacted ask line)',
    set: (o, v) => { o.answer_ts = v; } }
];

const PROGRAM_NAME = path.basename(process.argv[1] || 'ff.js', path.extname(process.argv[1] || 'ff.js'));

// Built-in flags every invocation understands, consulted only when none of ours match.
const BUILTIN_SPECS = [
  { name: 'help', arg: 'none', builtin: 'help' },
  { name: 'version', arg: 'optional', builtin: 'version' }
];
const OPTION_TABLES = [OPTION_SPECS, BUILTIN_SPECS, [{ name: '', arg: 'none', builtin: 'terminate' }]];

class OptionError extends Error {
  constructor(reason, arg, suggestFor, suggestTable) {
    super(reason);
    this.reason = reason;
    this.arg = arg;
    this.suggestFor = suggestFor;
    this.suggestTable = suggestTable;
  }

  get text() {
    const extra = this.suggestFor === undefined ? '' : suggestionText(this.suggestFor);
    return `${this.reason}: ${this.arg}${extra}`;
  }
}

function completionPattern(key, icase) {
  const quoted = key.replace(/[\n\t\r\f\v ]|[.*?+^$|()[\]{}\\/#-]/g, (ch) => {
    switch (ch) {
      case '\n': return '\\n';
      case '\t': return '\\t';
      case '\r': return '\\r';
      case '\f': return '\\f';
      case '\v': return '\\v';
      case ' ': return '\\ ';
      default: return `\\${ch}`;
    }
  });
  return new RegExp(`^${quoted.replace(/\w+\b/g, '$&\\w*')}`, icase ? 'i' : '');
}

// Resolve a (possibly abbreviated) long flag name. Exact names win; otherwise the
// first table with any candidate decides, and two unrelated candidates are ambiguous.
function completeLong(key, icase) {
  for (const table of OPTION_TABLES) {
    const exact = table.find((spec) => spec.name === key);
    if (exact) return exact;
  }
  const pattern = completionPattern(key, icase);
  for (const table of OPTION_TABLES) {
    const candidates = table.filter((spec) => pattern.test(spec.name))
      .map((spec, index) => ({ spec, index }))
      .sort((a, b) => a.spec.name.length - b.spec.name.length || a.index - b.index)
      .map((entry) => entry.spec);
    if (!candidates.length) continue;

    let chosen = candidates[0];
    for (const other of candidates.slice(1)) {
      if (other === chosen) continue;
      if (chosen.name.startsWith(other.name)) {
        chosen = other;
        continue;
      }
      if (other.name.startsWith(chosen.name)) continue;
      throw new OptionError('ambiguous option', key, key);
    }
    return chosen;
  }
  throw new OptionError('invalid option', key, key);
}

// "Did you mean?" suggestions for a mistyped flag (Jaro-Winkler, then Levenshtein).
function jaro(a, b) {
  let s1 = Array.from(a).map((ch) => ch.codePointAt(0));
  let s2 = Array.from(b).map((ch) => ch.codePointAt(0));
  if (s1.length > s2.length) [s1, s2] = [s2, s1];
  const length1 = s1.length;
  const length2 = s2.length;
  let m = 0;
  let t = 0;
  let range = Math.floor(length2 / 2) - 1;
  if (range < 0) range = 0;
  const flags1 = [];
  const flags2 = [];
  let i = 0;
  for (; i < length1; i += 1) {
    const last = i + range;
    for (let j = i >= range ? i - range : 0; j <= last; j += 1) {
      if (!flags2[j] && s1[i] === s2[j]) {
        flags2[j] = true;
        flags1[i] = true;
        m += 1;
        break;
      }
    }
  }
  let k = 0;
  for (i = 0; i < length1; i += 1) {
    if (!flags1[i]) continue;
    let index = k;
    for (let j = k; j < length2; j += 1) {
      index = j;
      if (flags2[j]) {
        k = j + 1;
        break;
      }
    }
    if (s1[i] !== s2[index]) t += 1;
  }
  t = Math.floor(t / 2);
  return m === 0 ? 0 : (m / length1 + m / length2 + (m - t) / m) / 3;
}

function jaroWinkler(a, b) {
  const distance = jaro(a, b);
  if (distance <= 0.7) return distance;
  const s1 = Array.from(a);
  const s2 = Array.from(b);
  let bonus = 0;
  for (let i = 0; i < s1.length; i += 1) {
    if (s1[i] === s2[i] && i < 4) bonus += 1;
    else break;
  }
  return distance + bonus * 0.1 * (1 - distance);
}

function levenshtein(a, b) {
  const s1 = Array.from(a);
  const s2 = Array.from(b);
  const n = s1.length;
  const m = s2.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = Array.from({ length: m + 1 }, (_v, index) => index);
  let x = null;
  s1.forEach((char1, offset) => {
    let i = offset + 1;
    for (let j = 0; j < m; j += 1) {
      const cost = char1 === s2[j] ? 0 : 1;
      const insertion = d[j + 1] + 1;
      const deletion = i + 1;
      const substitution = d[j] + cost;
      if (insertion < deletion && insertion < substitution) x = insertion;
      else if (deletion < substitution) x = deletion;
      else x = substitution;
      d[j] = i;
      i = x;
    }
    d[m] = x;
  });
  return x;
}

function suggestionText(input) {
  const dictionary = [...OPTION_SPECS.map((spec) => spec.name), 'help', '*-completion-bash', '*-completion-zsh', 'version', ''];
  const normalize = (word) => word.toLowerCase().replace(/@/g, '');
  const normalized = normalize(input);
  const threshold = Array.from(normalized).length > 3 ? 0.834 : 0.77;
  let words = dictionary.filter((word) => jaroWinkler(normalize(word), normalized) >= threshold && word !== input);
  words = stableSortBy(words, (word) => jaroWinkler(word, normalized)).reverse();
  const limit = Math.ceil(Array.from(normalized).length * 0.25);
  let corrections = words.filter((word) => levenshtein(normalize(word), normalized) <= limit);
  if (!corrections.length) {
    corrections = words.filter((word) => {
      const w = normalize(word);
      const length = Math.min(Array.from(normalized).length, Array.from(w).length);
      return levenshtein(w, normalized) < length;
    }).slice(0, 1);
  }
  const ordered = dictionary.filter((word) => corrections.includes(word));
  return ordered.length ? `\nDid you mean?  ${ordered.join('\n               ')}` : '';
}

function helpText() {
  const lines = OPTION_SPECS.map((spec) => {
    const left = `    --${spec.name}${spec.label ? ` ${spec.label}` : ''}`;
    return `    ${ljust(left, 32)} ${spec.desc}`;
  });
  return `${USAGE}${lines.join('\n')}\n`;
}

function applyOption(spec, value, options) {
  switch (spec.builtin) {
    case 'help':
      puts(helpText());
      throw new Exit(0);
    case 'version':
      if (!nil(value)) abort(`${PROGRAM_NAME}: no version found in package ${value}`);
      abort(`${PROGRAM_NAME}: version unknown`);
      break;
    case 'terminate':
      return 'terminate';
    default:
      spec.set(options, value);
  }
  return null;
}

// Parse every flag out of `argv`, leaving the positional words in order.
function parseOptions(argv, options) {
  const positional = [];
  while (argv.length) {
    const arg = argv.shift();
    let match = /^--([^=]*)(?:=([\s\S]*))?$/.exec(arg);
    if (match) {
      const key = match[1].replace(/_/g, '-');
      const rest = match[2];
      let spec;
      try {
        spec = completeLong(key, true);
      } catch (error) {
        error.arg = arg;
        throw error;
      }
      let value = null;
      if (spec.arg === 'none') {
        if (rest !== undefined) throw new OptionError('needless argument', arg);
      } else if (spec.arg === 'required') {
        if (rest !== undefined) value = rest;
        else if (!argv.length) throw new OptionError('missing argument', arg);
        else value = argv.shift();
      } else if (spec.arg === 'placed') {
        if (rest !== undefined) value = rest;
        else if (argv.length && !/^-./s.test(argv[0])) value = argv.shift();
      } else if (rest !== undefined) {
        value = rest;
      }
      if (applyOption(spec, value, options) === 'terminate') break;
      continue;
    }

    match = /^-(.)((=)[\s\S]*|[\s\S]+)?$/s.exec(arg);
    if (match) {
      const letter = match[1];
      const rest = match[2];
      const eq = match[3] !== undefined ? true : rest === undefined;
      let spec;
      try {
        spec = completeLong(letter, false);
      } catch (error) {
        error.arg = arg;
        throw error;
      }
      let value = null;
      if (spec.arg === 'none') {
        if (rest !== undefined) {
          if (eq) throw new OptionError('needless argument', arg);
          // `-ab`: the remainder is the next short flag.
          const next = `-${rest.replace(/^-*/, '')}`;
          if (next !== '-') argv.unshift(next);
        }
      } else if (spec.arg === 'required') {
        if (rest !== undefined) value = rest;
        else if (!argv.length) throw new OptionError('missing argument', arg);
        else value = argv.shift();
      } else if (spec.arg === 'placed') {
        if (rest !== undefined) value = rest;
        else if (argv.length && !/^-./s.test(argv[0])) value = argv.shift();
      } else if (rest !== undefined) {
        value = rest;
      }
      if (applyOption(spec, value, options) === 'terminate') break;
      continue;
    }

    positional.push(arg);
  }
  argv.unshift(...positional);
}

function main(argv) {
  const options = { state_dir: defaultStateDir(), day_dir: null, holder: `tick-${process.pid}` };
  if (!argv.length) {
    warn(USAGE);
    return 1;
  }
  if (includes(['-h', '--help', 'help'], argv[0])) {
    puts(USAGE);
    return 0;
  }

  try {
    parseOptions(argv, options);
  } catch (error) {
    if (!(error instanceof OptionError)) throw error;
    abort(`ff.js: ${error.text}\n\n${USAGE}`);
  }

  const subcommand = argv.shift();
  if (nil(subcommand)) abort(USAGE);

  // The config belongs to the REAL state dir: a rehearsal must watch exactly what a
  // live tick would, so resolve it before --dry-run moves the state dir.
  let configPath = options.config;
  if (nil(configPath)) configPath = process.env.FF_CONFIG;
  if (nil(configPath)) configPath = joinPath(expandPath(options.state_dir), 'config.json');
  config = new Config(configPath);

  // A rehearsal still writes — just into its own sandbox, so tick traces and LOG
  // rows are real artifacts that no live tick will ever read.
  // The day dir derives from the state dir, so redirecting the state dir is the
  // whole redirect — <state-dir>/dryrun/days/<date> follows on its own.
  if (options.dry_run && !options.state_dir_explicit) {
    options.state_dir = joinPath(options.state_dir, 'dryrun');
  }

  const store = new State({ dir: options.state_dir, dayDir: options.day_dir });

  switch (subcommand) {
    case 'get': options.key = argv.shift(); return commandGet(store, options);
    case 'summary': return commandSummary(store);
    case 'verify': return commandVerify(store);
    case 'config': return commandConfig(argv.shift(), options);
    case 'init': {
      const profile = options.profile;
      if (!nil(profile) && !includes(PROFILES, profile)) abort(`ff.js: --profile must be ${PROFILES.join('|')}`);

      store.init(options.force);
      if (!nil(profile)) store.update((state) => { state.profile = profile; });
      puts(`state ready at ${store.path}${nil(profile) ? '' : ` (profile ${profile})`}`);
      if (!ffConfig().exist()) {
        ffConfig().writeTemplate();
        puts(`wrote config template -> ${ffConfig().path} — edit it (channels, your user id), then \`ff.js config check\``);
      }
      return 0;
    }
    case 'set': return commandSet(store, argv.shift(), argv.shift());
    case 'oncall': return commandOncall(store, argv.shift(), argv.shift(), options);
    case 'watermark': {
      const target = argv.shift();
      return options.forget ? commandWatermarkForget(store, target) : commandWatermark(store, target, argv.shift());
    }
    case 'upsert': return commandUpsert(store, argv.shift(), options.json_payload);
    case 'link': return commandLink(store, argv.shift(), argv.shift());
    case 'asks': return commandAsks(store, options);
    case 'decide': return commandDecide(store, argv.shift(), argv.shift(), options);
    case 'lease': {
      const action = argv.shift();
      switch (action) {
        case 'acquire': return leaseAcquire(store, options.holder);
        case 'release': return leaseRelease(store);
        default: return abort(`ff.js: lease takes acquire|release, got ${inspect(action)}`);
      }
    }
    case 'log-append': return commandLogAppend(store, options);
    case 'rollover': return commandRollover(store, options.day_dir);
    case 'sync': return commandSync(store, argv.shift());
    default: return abort(`ff.js: unknown subcommand ${inspect(subcommand)}\n\n${USAGE}`);
  }
}

if (require.main === module) run(main);

module.exports = { main };
