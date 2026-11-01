#!/usr/bin/env ruby
# frozen_string_literal: true

# ff.rb — the state CLI for /firefighter-loop. Ruby stdlib only, no gems.
#
# Every mutation of the firefighter's state goes through this script so that two
# ticks can never half-write the same file: writes are temp-file + File.rename,
# and the tick lock is an O_EXCL lockfile, not a flag inside the JSON.
#
# What that does and does not buy you, measured: rename makes each write atomic,
# so a concurrent reader always sees a whole valid state.json and no temp file is
# ever left behind — but a run of `upsert` calls is still read-modify-write, and a
# burst of them fired in parallel loses items (last writer wins). So: hold the
# lease for the whole tick. One tick mutates at a time; `get`/`summary`/`verify`
# are safe to run from anywhere at any moment.
#
# Two files, two owners:
#   config.json  YOURS. What to watch (channels, your user id, keywords, the optional
#                on-call rotation), dispatch caps, the ask reaction. Hand-edit it;
#                `config init` writes a template, `config check` validates it.
#   state.json   THE LOOP'S. Items, watermarks, the lease, the day pointer. Never
#                hand-edit it — every write goes through a subcommand below.
#
# READ-ONLY (safe to run any time, in any session):
#   ruby ff.rb get                          # whole state, human-readable
#   ruby ff.rb get --json                   # whole state, raw JSON
#   ruby ff.rb get --status needs_you       # just the items in one status
#   ruby ff.rb get CEXAMPLE1:<ts> --json    # one item by key (an arg with a ':' is an item key)
#   ruby ff.rb get profile                  # one top-level key (an arg without a ':' is a dotted path)
#   ruby ff.rb get cron.id                  # any nested value, dotted
#   ruby ff.rb summary                      # one line of counts + agents + watermarks + cron
#   ruby ff.rb verify                       # schema check; exit 1 if anything is off
#   ruby ff.rb config [--json]              # the effective config (template merged with yours)
#   ruby ff.rb config check                 # exit 1 if the config can't drive a tick
#
# MUTATING:
#   ruby ff.rb init                         # create the state dir + state.json (idempotent);
#                                           # also writes a config.json template if absent
#   ruby ff.rb init --profile local         # ...and stamp the runtime profile (local|cloud)
#   ruby ff.rb init --force                 # re-init state, discarding it (config.json is kept)
#   ruby ff.rb config init [--force]        # (re)write the config.json template
#   ruby ff.rb set profile local            # set one settable key; see SETTABLE_KEYS below
#   ruby ff.rb set mode autonomous
#   ruby ff.rb set interval 5m
#   ruby ff.rb set scheduler cron
#   ruby ff.rb set cron.id C-7f3e           # dotted paths create the intermediate hash
#   ruby ff.rb set dashboard.url https://…
#   ruby ff.rb set channels '["#support CEXAMPLE1","#billing-alerts CEXAMPLE2"]'
#                                           # LOG-header override; defaults to config's channels
#   ruby ff.rb watermark CEXAMPLE1 2040001800.000100     # advance one channel watermark
#   ruby ff.rb watermark mentions 2034-08-23             # set the mention search's after: date
#   ruby ff.rb watermark mentions 2040001800.000100      # remember one already-seen mention ts
#   ruby ff.rb watermark CEXAMPLE1 --forget              # drop a channel key (dropped from the
#                                                        # watch set, or written by a mangled
#                                                        # argv); refuses `mentions`
#   ruby ff.rb upsert CEXAMPLE1:2040001800.000100 --json '{"class":"INCIDENT","status":"new"}'
#   ruby ff.rb link CEXAMPLE2:<ts> CEXAMPLE1:<ts>        # dup root cause -> owner item
#   ruby ff.rb lease acquire --holder tick-0915          # exit 1 if a fresh lease is held
#   ruby ff.rb lease release
#   ruby ff.rb oncall status [--json]       # today's on-call rotation state (read-only)
#   ruby ff.rb oncall auto                  # detect from the on-call channel each tick
#   ruby ff.rb oncall on [<shift_start_ts>] # force TODAY only; rollover resets it to auto
#   ruby ff.rb oncall off                   # never watch the on-call channel
#   ruby ff.rb oncall active <shift_start_ts>  # a tick recording "you are on call today";
#                                           # prints transition=true on the inactive->active
#                                           # tick, which is the one that earns a DM
#   ruby ff.rb oncall inactive              # a tick recording "someone else's shift"
#   ruby ff.rb asks [--json]                # acked items awaiting your call, grouped by
#                                           # the DM ask thread to poll (read-only)
#   ruby ff.rb decide <key> skip|mine|loop [--via dm|reaction|session|cli] [--answer-ts TS]
#                                           # record your call on an acked item:
#                                           # skip -> ignored, mine -> user_owns,
#                                           # loop -> new (queued for dispatch)
#   ruby ff.rb decide <key> loop --via reaction --answer-ts <ask line ts>
#                                           # the ask reaction on the item's own ask line;
#                                           # loses to any reply answer
#   ruby ff.rb log-append --json '{"ch":"#support","from":"U123","class":"INCIDENT",...}'
#   ruby ff.rb log-append --json '{"ts":"2040001800.000100","ch":"#support",...}'
#                                           # `ts` (chat ts or ISO) is NOT a column: it only
#                                           # fills the `time` cell — HH:MM today, MM-DD HH:MM
#                                           # otherwise, so a multi-day sweep is unambiguous
#   ruby ff.rb log-append --tick '0 new - 2 live - next 09:20'
#   ruby ff.rb rollover                     # move the day pointer to today, mkdir the day dir
#   ruby ff.rb sync 'tick 09:15: 1 new, 1 dispatched'   # commit + push the state repo
#
# WHERE STATE LIVES
#   --state-dir DIR   default $FF_STATE_DIR, else ~/.local/state/firefighter-loop
#   --day-dir DIR     default $FF_DAY_DIR,   else <resolved state dir>/days/<YYYY-MM-DD>
#                     — the day dir hangs off the RESOLVED state dir, so --state-dir,
#                     $FF_STATE_DIR and --dry-run all move the day logs with the state
#                     they belong to.
#   --config FILE     default $FF_CONFIG, else <state dir>/config.json (the REAL state
#                     dir — a --dry-run rehearsal reads the same config as live ticks)
#   --dry-run         redirect BOTH dirs into a scratch sandbox so a rehearsal can
#                     write a real state.json, real LOG.md rows and real tick traces
#                     without touching the live ones:
#                       state dir -> <state-dir>/dryrun      (unless --state-dir was passed)
#                       day dir   -> <state-dir>/dryrun/days/<date>  (derived, as above)
#                     and stamp the LOG.md header with a DRY RUN marker. Start each
#                     rehearsal from a clean slate with `init --dry-run --force`.
#                     Gitignore `dryrun/` in a state repo — rehearsals never sync.
#
#   To share one history between a laptop and an off-laptop runner, make the state
#   dir a clone of a private git repo (the `<state_repo>` setting) in both places;
#   `sync` is what makes them one history. Without a repo, `sync` is a no-op and the
#   state is local-only. Nothing else in this script knows which profile it runs under.
#
# SYNC
#   `sync '<message>'` is a no-op with a notice (exit 0) when the state dir is not the
#   ROOT of a git repo (a dir merely nested inside another repo counts as not-a-repo:
#   sync never commits or pushes a parent repo), or when nothing tracked changed and
#   nothing is unpushed. Otherwise:
#   `git pull --rebase --autostash` -> `git add -A` scoped to state.json, config.json,
#   days/, dashboard.html, artifacts/, README.md and .gitignore -> `commit -- <those
#   paths>` (nothing else staged in the index rides along) -> push,
#   retrying `pull --rebase && push` once on a rejection. `--autostash` is required:
#   sync always runs with the tick's writes still uncommitted, and a plain rebase
#   refuses a dirty tree. **A failed push exits 1** — the caller must NOT advance
#   watermarks.
#
# EXIT CODES
#   0  fine
#   1  usage error, lease already held by a live tick, or `verify`/`config check`
#      found problems
#   2  state.json was unparseable. It has been moved to state.json.corrupt-<epoch>
#      and a fresh state has been written. The caller must DM the user about the loss
#      and must NOT auto-backfill.
#
# STATE SCHEMA (state.json)
#   version      1
#   profile      "local" | "cloud"          (`init --profile` or `set profile`)
#   scheduler    "local" | "cron" | "routine" | "cloud_agent"
#   mode         "sweep" | "tick" | "start" | ...  (whatever last armed the loop; LOG header)
#   interval     "5m" | "10m" | "15m"        (LOG header; loop-only — the header
#                                             renders `n/a (sweep)` when mode is
#                                             "sweep" and this is unset)
#   channels     ["#support CEXAMPLE1", …] or [{name, id}, …]  (LOG header override)
#   cron         {id, expression, created_at, expires_at, next_fire_at}
#   lease        {holder, acquired_at, pid}  mirror of lease.lock, for `summary`/dashboard
#   day          {date, dir}
#   dashboard    {path, url}
#   watermarks   {"<channel_id>": {latest_ts, checked_at},
#                 "mentions": {after_date, seen_ts[], checked_at}}
#   oncall       {mode, handle_id, channel_id, channel_name, active, active_date,
#                 shift_start_ts, forced_date}   (the `oncall` subcommand owns it)
#   items        {"<channel_id>:<ts>": item}
#   ticks        [{at, line}]                last TICK_HISTORY entries, newest last
#
# THE oncall BLOCK is read through a defaults merge (defaults drawn from config.json at
# READ time), never assumed present: `init` does not write it, so the mode follows the
# config until the user explicitly runs `oncall auto|on|off`, and with no
# oncall.channel_id in config the effective mode is always `off`. Nothing here writes
# the block just to add it.
#
# ITEM (all fields optional except status; the key is the only dedupe axis —
# never a text hash, because chat messages are edited in place)
#   permalink author title excerpt class priority mention oncall status
#   agent {name, id}  linked_to  linked_from[]  dm {root_ts, last_ts}
#   worktree artifacts[] pr last_reply_ts_seen reason ask env restarted
#   ack {via, ts, excerpt, ask {channel_id, thread_ts, ts, n},
#        decision, decided_at, decided_ts, decided_via}
#   channel_id ts first_seen_at updated_at
#
# Item keys are `<source>:<id>`. For chat that is `<channel_id>:<ts>`; an optional
# issue-tracker or error-tracker source uses its own stable id (`issues:ABC-123`,
# `errors:3907`) — anything with exactly one colon and no whitespace.
#
# `ack` is present only when the user acknowledged the item (their reaction on it, or
# their reply later than it). Acknowledgement never auto-skips: an item that would
# otherwise have been dispatched is parked in `acked` — skipped by default — and the
# user is asked once whether the loop should take it anyway. `decide` records the
# answer; until there is one it simply stays skipped, and stays answerable.
#
# last_reply_ts_seen is the `oldest` cursor for this item's own thread poll: the ts
# of the newest reply already forwarded to its agent (the root ts when no reply has
# been seen). It is NOT derived from the channel read — a channel read windowed on
# a watermark never shows replies on older roots, so every live item's thread is
# polled directly each tick.
#
# STATUSES  new | dispatched | in_progress | paused | needs_you | acked | user_owns |
#           done | ignored | linked
#   acked       the user acknowledged an item that would otherwise have dispatched; it
#               is skipped by default and their call is pending (`asks`, `decide`)
#   user_owns   they answered "I'll work on it myself" — terminal, never dispatched
#
# MERGE SEMANTICS  `upsert` deep-merges the partial into the existing item:
# nested hashes merge key by key, everything else (arrays included) replaces
# wholesale — pass the full artifacts list, not just the new entry.

require 'json'
require 'fileutils'
require 'time'
require 'optparse'

SCHEMA_VERSION = 1
STATUSES = %w[new dispatched in_progress paused needs_you acked user_owns done ignored linked].freeze
LIVE_STATUSES = %w[dispatched in_progress paused].freeze
# The user's three answers to "you acknowledged this — should the loop still take it?",
# and the status each lands the item in. Silence also means skip, but silence leaves
# the item in `acked` (still answerable); only an explicit `skip` closes it.
ACK_OUTCOMES = {
  'skip' => ['ignored', 'acknowledged by the user; they chose skip'],
  'mine' => ['user_owns', 'acknowledged by the user; they are handling it themselves'],
  'loop' => ['new', 'acknowledged by the user; they asked the loop to take it anyway']
}.freeze
ACK_VIAS = %w[dm reaction session cli].freeze
# `set` refuses anything else at the top level: items and watermarks have their own
# subcommands, and a typo'd top-level key would otherwise sit in state forever.
SETTABLE_KEYS = %w[profile scheduler mode interval cron dashboard channels].freeze
PROFILES = %w[local cloud].freeze
SCHEDULERS = %w[local cron routine cloud_agent].freeze
# On-call is a rotation: the loop watches requests tagged with the on-call handle in
# the on-call channel only on the days the user is on call. `auto` re-derives that
# from the channel every tick, `on` is the user's own assertion (today only —
# `rollover` resets it), `off` never looks. Which channel and handle: config.json.
ONCALL_MODES = %w[auto on off].freeze
LEASE_STALE_SECONDS = 15 * 60
# `sync` stages exactly these. Scoping the add is what keeps a stray file in the state
# dir — a lease.lock, a state.json.corrupt-*, a dryrun/ rehearsal — out of the history.
SYNC_PATHS = %w[state.json config.json days dashboard.html artifacts .gitignore README.md].freeze
TICK_HISTORY = 200
SEEN_TS_HISTORY = 500
LOG_TABLE_HEADER = <<~MD
  | time | ch | from | class | status | item | agent | artifacts | note |
  |---|---|---|---|---|---|---|---|---|
MD
LOG_COLUMNS = %w[time ch from class status item agent artifacts note].freeze
# `ts` is accepted but never rendered: it is what `time` is derived from.
LOG_ROW_KEYS = (LOG_COLUMNS + %w[ts]).freeze

def now_iso = Time.now.utc.iso8601

# A plain XDG-style state dir by default. Point --state-dir / $FF_STATE_DIR at a clone
# of your `<state_repo>` to share state with an off-laptop runner.
DEFAULT_STATE_DIR = File.join(Dir.home, '.local', 'state', 'firefighter-loop')

def default_state_dir
  ENV['FF_STATE_DIR'] || DEFAULT_STATE_DIR
end

# Derived from the RESOLVED state dir, never from a second hard-coded root: moving
# the state (--state-dir, $FF_STATE_DIR, --dry-run) moves the day logs with it, so
# state.json and the LOG.md it points at can never end up in different repos.
def default_day_dir(state_dir, date = Time.now.strftime('%Y-%m-%d'))
  ENV['FF_DAY_DIR'] || File.join(File.expand_path(state_dir), 'days', date)
end

# --- config (the user's file) -----------------------------------------------
#
# Everything that names a real channel, person or product area lives here, never in
# this script or the skill text. Values are read through a merge with the template,
# so a config that omits a section still gets sane defaults for it.

CONFIG_TEMPLATE = {
  '_comment' => 'firefighter-loop config. Yours to edit. Ids are your chat tool\'s ids ' \
                '(Slack: channel C..., user U..., user group S...). Run `ff.rb config check` after editing.',
  'chat' => 'slack',
  'self' => {
    'user_id' => nil,
    'dm_channel_id' => nil
  },
  'watch' => {
    'channels' => [],
    'mentions' => true,
    'keywords' => [],
    'area' => nil
  },
  'oncall' => {
    'channel_id' => nil,
    'channel_name' => nil,
    'handle_id' => nil,
    'rotation_bot_id' => nil,
    'resolved_reactions' => ['white_check_mark'],
    'in_progress_reactions' => ['eyes']
  },
  'dispatch' => {
    'max_per_tick' => 3,
    'max_initial_sweep' => 6,
    'live_cap' => 8,
    'hard_cap' => 15,
    'repo' => nil,
    'worktrees_dir' => nil,
    'branch_prefix' => 'ff/'
  },
  'asks' => {
    'reaction' => 'robot_face',
    'poll_days' => 7
  }
}.freeze

def deep_merge(base, overlay)
  base.merge(overlay) do |_key, old_value, new_value|
    old_value.is_a?(Hash) && new_value.is_a?(Hash) ? deep_merge(old_value, new_value) : new_value
  end
end

class Config
  attr_reader :path

  def initialize(path)
    @path = path && File.expand_path(path)
  end

  def exist? = !path.nil? && File.exist?(path)

  def raw
    return {} unless exist?

    parsed = JSON.parse(File.read(path))
    parsed.is_a?(Hash) ? parsed : {}
  rescue JSON::ParserError => error
    abort "ff.rb: #{path} is not valid JSON (#{error.message.split("\n").first}) — fix it by hand; it is your file"
  end

  def data = @data ||= deep_merge(JSON.parse(JSON.generate(CONFIG_TEMPLATE)), raw)

  def dig(*keys) = data.dig(*keys)

  def write_template(force: false)
    abort "ff.rb: #{path} exists — pass --force to overwrite it" if exist? && !force

    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "#{JSON.pretty_generate(CONFIG_TEMPLATE)}\n")
    @data = nil
    path
  end

  # What a tick cannot run without. Outward-facing values (channels, ids) are never
  # guessed, so a missing one is a problem to report, not a default to invent.
  # `report_only: true` relaxes only what dispatch needs (the agents' repo); a
  # classify-and-log rehearsal can run without it. Everything else is required.
  def problems(report_only: false)
    list = []
    list << "no config file at #{path} — run `ff.rb config init`, then edit it" unless exist?
    list << 'self.user_id is not set (mentions, acks and DMs key off it)' if blank?(dig('self', 'user_id'))
    channels = dig('watch', 'channels')
    if channels.is_a?(Array)
      list << 'watch.channels is empty — list at least one {"name", "id"} to watch' if channels.empty?
      channels.each_with_index do |entry, index|
        id = entry.is_a?(Hash) ? entry['id'] : nil
        list << "watch.channels[#{index}] has no id" if blank?(id)
      end
    else
      list << 'watch.channels must be an array of {"name", "id"} objects'
    end
    list << 'watch.keywords must be an array of strings' unless dig('watch', 'keywords').is_a?(Array)
    if blank?(dig('watch', 'area'))
      list << 'watch.area is not set — one line on the product area you own; the classifier needs it'
    end
    repo = dig('dispatch', 'repo')
    if blank?(repo)
      list << 'dispatch.repo is not set — the repo agents work in (or run with --report-only)' unless report_only
    elsif !File.exist?(File.join(File.expand_path(repo), '.git'))
      list << "dispatch.repo #{repo} is not a git checkout"
    end
    if oncall_configured? && blank?(dig('oncall', 'handle_id'))
      list << 'oncall.channel_id is set but oncall.handle_id is not (which tag marks a request?)'
    end
    %w[max_per_tick max_initial_sweep live_cap hard_cap].each do |key|
      value = dig('dispatch', key)
      list << "dispatch.#{key} must be a positive integer" unless value.is_a?(Integer) && value.positive?
    end
    live_cap = dig('dispatch', 'live_cap')
    hard_cap = dig('dispatch', 'hard_cap')
    if live_cap.is_a?(Integer) && hard_cap.is_a?(Integer) && live_cap > hard_cap
      list << 'dispatch.live_cap exceeds dispatch.hard_cap'
    end
    list
  end

  def oncall_configured? = !blank?(dig('oncall', 'channel_id'))

  private

  def blank?(value) = value.nil? || value.to_s.strip.empty?
end

def ff_config = ($ff_config ||= Config.new(nil))

def ack_reaction = ff_config.dig('asks', 'reaction') || 'robot_face'

# An ask thread is polled for answers this long; after that the item stays skipped and
# is still answerable in-session or with `decide`, but no tick spends a read on it.
def ack_poll_days = (ff_config.dig('asks', 'poll_days') || 7).to_i

# --- state file -------------------------------------------------------------

class State
  attr_reader :dir, :path

  def initialize(dir:, day_dir: nil)
    @dir = File.expand_path(dir)
    @day_dir = day_dir
    @path = File.join(@dir, 'state.json')
  end

  def exist? = File.exist?(path)

  def lock_path = File.join(dir, 'lease.lock')

  def day_dir_for(date) = @day_dir ? File.expand_path(@day_dir) : default_day_dir(@dir, date)

  def blank
    today = Time.now.strftime('%Y-%m-%d')
    {
      'version' => SCHEMA_VERSION,
      'created_at' => now_iso,
      'updated_at' => now_iso,
      'profile' => nil,
      'scheduler' => nil,
      'cron' => {},
      'lease' => {},
      'day' => { 'date' => today, 'dir' => day_dir_for(today) },
      'dashboard' => {},
      'watermarks' => { 'mentions' => { 'after_date' => nil, 'seen_ts' => [] } },
      # No `oncall` block: its mode is derived from config.json at read time, so a
      # state created before the user filled in the on-call section still turns on.
      'items' => {},
      'ticks' => []
    }
  end

  def init(force: false)
    FileUtils.mkdir_p(dir)
    return read if exist? && !force

    write(blank)
  end

  # A parse failure is not recoverable in place: quarantine, re-init, and make the
  # caller notice (exit 2) so it DMs the user instead of silently starting over.
  def read
    FileUtils.mkdir_p(dir)
    return write(blank) unless exist?

    JSON.parse(File.read(path))
  rescue JSON::ParserError => error
    quarantine = "#{path}.corrupt-#{Time.now.to_i}"
    FileUtils.mv(path, quarantine)
    write(blank)
    warn '!!! FIREFIGHTER STATE CORRUPT — quarantined and re-initialized. ' \
         "Bad file: #{quarantine} (#{error.message.split("\n").first}). " \
         'Items and watermarks are LOST. DM the user; do NOT auto-backfill.'
    exit 2
  end

  def write(state)
    FileUtils.mkdir_p(dir)
    state['updated_at'] = now_iso
    temp = File.join(dir, ".state.json.#{Process.pid}.#{Time.now.to_f}")
    File.write(temp, "#{JSON.pretty_generate(state)}\n")
    File.rename(temp, path)
    state
  ensure
    FileUtils.rm_f(temp) if temp && File.exist?(temp.to_s)
  end

  def update
    state = read
    yield(state)
    write(state)
  end
end

# --- helpers ----------------------------------------------------------------

def parse_json_argument(raw, what)
  abort "ff.rb: #{what} needs --json '<json object>'" if raw.nil? || raw.to_s.strip.empty?

  parsed = JSON.parse(raw)
  abort "ff.rb: #{what} --json must be a JSON object, got #{parsed.class}" unless parsed.is_a?(Hash)

  parsed
rescue JSON::ParserError => error
  abort "ff.rb: #{what} --json is not valid JSON: #{error.message}"
end

def age_in_words(from)
  seconds = seconds_since(from)
  return '?' if seconds.nil?
  return "in #{duration_words(-seconds)}" if seconds.negative?

  duration_words(seconds)
end

# "5m ago" for the past, "in 5m" for a future instant (e.g. a sample dated ahead).
def ago(from)
  age = age_in_words(from)
  age.start_with?('in ') || age == '?' ? age : "#{age} ago"
end

def duration_words(seconds)
  return "#{seconds.to_i}s" if seconds < 60
  return "#{(seconds / 60).to_i}m" if seconds < 3600
  return "#{(seconds / 3600).to_i}h" if seconds < 86_400

  "#{(seconds / 86_400).to_i}d"
end

# Both timestamp shapes this script sees: a chat ts ("<epoch>.<micros>") and an
# ISO instant. Returns nil rather than raising on anything else.
def parse_moment(value)
  return nil if value.nil? || value.to_s.strip.empty?

  value.to_s.match?(/\A\d+(\.\d+)?\z/) ? Time.at(value.to_f) : Time.parse(value.to_s)
rescue ArgumentError
  nil
end

def seconds_since(from)
  moment = parse_moment(from)
  moment && Time.now - moment
end

def live_agents(state)
  state.fetch('items', {}).filter_map do |_key, item|
    next unless LIVE_STATUSES.include?(item['status'])

    item.dig('agent', 'name')
  end.uniq
end

def ack_label(ack)
  label = "ack=#{ack['via'] || '?'}"
  label += " ask=##{ack.dig('ask', 'n')}" if ack.dig('ask', 'n')
  label += " decided=#{ack['decision']}(#{ack['decided_via']})" if ack['decision']
  label
end

def counts_by_status(state)
  tally = Hash.new(0)
  state.fetch('items', {}).each_value { |item| tally[item['status'] || 'unknown'] += 1 }
  tally
end

# --- on-call ----------------------------------------------------------------
#
# `active` is a fact about ONE day (`active_date`), never a standing setting: the
# rotation moves, and a stale `true` would have the loop working someone else's
# shift. So every read goes through `oncall_view` (defaults merged, nothing written),
# and `rollover` clears the day's activation plus any forced `on`.

def oncall_defaults
  config = ff_config
  {
    'mode' => config.oncall_configured? ? 'auto' : 'off',
    'handle_id' => config.dig('oncall', 'handle_id'),
    'channel_id' => config.dig('oncall', 'channel_id'),
    'channel_name' => config.dig('oncall', 'channel_name'),
    'active' => false,
    'active_date' => nil,
    'shift_start_ts' => nil,
    'forced_date' => nil
  }
end

# Read-only accessor: a state.json without the block reads as the defaults rather
# than being migrated behind the caller's back. A shared state repo is a
# concurrently-written file — a read must never write to it. The channel and handle
# always come from the current config, so editing config.json takes effect at once.
def oncall_view(state)
  block = state['oncall']
  merged = block.is_a?(Hash) ? oncall_defaults.merge(block) : oncall_defaults
  %w[handle_id channel_id channel_name].each do |key|
    current = ff_config.dig('oncall', key)
    merged[key] = current unless current.nil?
  end
  # Unconfigured means off, whatever an older block says: there is nothing to watch.
  unless ff_config.oncall_configured?
    merged.merge!('mode' => 'off', 'active' => false, 'active_date' => nil, 'shift_start_ts' => nil)
  end
  merged
end

def oncall_active_today?(oncall, today = Time.now.strftime('%Y-%m-%d'))
  oncall['active'] == true && oncall['active_date'] == today
end

def oncall_line(state)
  oncall = oncall_view(state)
  parts = ["mode #{oncall['mode']}"]
  parts << (oncall_active_today?(oncall) ? "ACTIVE #{oncall['active_date']}" : 'inactive')
  if oncall['shift_start_ts']
    started = parse_moment(oncall['shift_start_ts'])
    parts << "shift start #{started ? started.localtime.strftime('%H:%M') : oncall['shift_start_ts']}"
  end
  parts << "forced #{oncall['forced_date']}" if oncall['mode'] == 'on' && oncall['forced_date']
  if oncall_active_today?(oncall)
    parts << "watching #{oncall['channel_name'] || oncall['channel_id']} for #{oncall['handle_id']}"
  end
  parts << 'not configured (config.json oncall.channel_id)' unless ff_config.oncall_configured?
  parts.join(' · ')
end

# Local midnight, as a chat-shaped ts — the shift start a forced `on` gets when no
# rotation announcement named the user. "Today" here is the runtime's LOCAL date, the
# same notion `rollover` and `day.date` already use, deliberately: two definitions of
# today in one state file would be worse than one. The rotation-timezone read window
# in SKILL.md is the lead's to compute.
def start_of_today_ts
  now = Time.now
  format('%.6f', Time.new(now.year, now.month, now.day).to_f)
end

# --- day log ----------------------------------------------------------------

# The fallback goes through the store, not a bare default: an un-rolled state must
# still land its LOG.md under the state dir actually in use.
def log_path(store, state, day_dir)
  dir = day_dir || state.dig('day', 'dir') || store.day_dir_for(Time.now.strftime('%Y-%m-%d'))
  FileUtils.mkdir_p(dir)
  File.join(dir, 'LOG.md')
end

def channel_line(state)
  entries = state['channels']
  entries = ff_config.dig('watch', 'channels') unless entries.is_a?(Array) && entries.any?
  return '(unset)' unless entries.is_a?(Array) && entries.any?

  entries.map { |entry| entry.is_a?(Hash) ? [entry['name'], entry['id']].compact.join(' ') : entry.to_s }
         .join(' · ')
end

# A backfill or a `--since 48h` sweep puts rows from more than one calendar day in
# one table, where a bare HH:MM is ambiguous — so a row whose ts is not today dates
# itself. Callers pass the evaluated message's ts; `time` still wins if given.
def log_time_cell(ts)
  moment = parse_moment(ts) || Time.now
  today = Time.now.strftime('%Y-%m-%d')
  moment.strftime(moment.strftime('%Y-%m-%d') == today ? '%H:%M' : '%m-%d %H:%M')
end

# A sweep is one pass, not a loop: an unset interval there is correct, not missing.
def interval_line(state)
  return state['interval'] if state['interval']

  state['mode'].to_s == 'sweep' ? 'n/a (sweep)' : '(unset)'
end

def cron_line(state)
  cron = state.fetch('cron', {})
  return '(none)' unless cron.is_a?(Hash) && cron['id']

  [cron['id'], cron['expression'] && "(#{cron['expression']})",
   cron['expires_at'] && "expires #{cron['expires_at']}"].compact.join(' ')
end

# The header is what a human (or a later tick) reads first, so it carries every
# fact needed to tell one run from another — including whether it was a rehearsal.
def log_header(state)
  day = state.dig('day', 'date') || Time.now.strftime('%Y-%m-%d')
  <<~MD
    # Firefighter log - #{day}#{state['_dry_run'] ? '  [DRY RUN]' : ''}

    - mode: #{state['mode'] || '(unset)'} · interval: #{interval_line(state)}
    - profile: #{state['profile'] || 'local'}
    - scheduler: #{state['scheduler'] || 'local'}
    - cron: #{cron_line(state)}
    - channels: #{channel_line(state)}
    - dashboard: #{state.dig('dashboard', 'url') || '(unpublished)'}
    - state: #{state['_state_path']}

    ## Items

    #{LOG_TABLE_HEADER}
    ## Ticks

  MD
end

# `dashboard.url` and `cron.id` are typically still unset when the day's LOG.md is
# first created (day 1's first publish hasn't happened yet), so the header would be
# stuck rendering `(unpublished)` / `(none)` forever. Every append re-derives just
# these two lines from current state and rewrites them in place — the rest of the
# header (mode, profile, scheduler, channels, state path) is written once and stays
# immutable.
def resync_header_fields(body, state)
  body = body.sub(/^- cron: .*$/, "- cron: #{cron_line(state)}")
  body.sub(/^- dashboard: .*$/, "- dashboard: #{state.dig('dashboard', 'url') || '(unpublished)'}")
end

def read_or_create_log(path, state)
  if File.exist?(path)
    body = File.read(path)
    updated = resync_header_fields(body, state)
    atomic_write(path, updated) if updated != body
    return updated
  end

  body = log_header(state)
  atomic_write(path, body)
  body
end

def atomic_write(path, body)
  temp = "#{path}.tmp.#{Process.pid}"
  File.write(temp, body)
  File.rename(temp, path)
end

def append_log_row(path, state, row)
  body = read_or_create_log(path, state)
  cells = LOG_COLUMNS.map { |column| (row[column] || row[column.to_sym] || '').to_s.gsub('|', '\\|').gsub("\n", ' ') }
  line = "| #{cells.join(' | ')} |\n"
  head, tail = body.split("## Ticks", 2)
  if tail.nil?
    atomic_write(path, body + line)
  else
    atomic_write(path, "#{head.rstrip}\n#{line}\n## Ticks#{tail}")
  end
  line
end

def append_tick_line(path, state, line)
  body = read_or_create_log(path, state)
  stamped = "- #{Time.now.strftime('%H:%M')} #{line.gsub("\n", ' ')}\n"
  body += "\n## Ticks\n" unless body.include?('## Ticks')
  trimmed = body.rstrip
  separator = trimmed.end_with?('## Ticks') ? "\n\n" : "\n"
  atomic_write(path, trimmed + separator + stamped)
  stamped
end

# --- lease ------------------------------------------------------------------
#
# The lockfile is the real lock (O_EXCL is atomic even across two ticks racing);
# state.json only mirrors it so `summary` and the dashboard can show the holder.

def lease_acquire(store, holder)
  attempt = 0
  begin
    attempt += 1
    handle = File.open(store.lock_path, File::CREAT | File::EXCL | File::WRONLY)
    record = { 'holder' => holder, 'acquired_at' => now_iso, 'pid' => Process.pid }
    handle.write("#{JSON.generate(record)}\n")
    handle.close
    store.update { |state| state['lease'] = record }
    puts "lease acquired by #{holder}"
    0
  rescue Errno::EEXIST
    current = JSON.parse(File.read(store.lock_path)) rescue {}
    held_at = current['acquired_at'] || File.mtime(store.lock_path).utc.iso8601
    age = seconds_since(held_at) || 0
    if age < LEASE_STALE_SECONDS && attempt == 1
      warn "ff.rb: lease held by #{current['holder'] || 'unknown'} " \
           "(pid #{current['pid'] || '?'}, #{age_in_words(held_at)} old) — skipping this tick"
      return 1
    end
    if attempt == 1
      warn "ff.rb: clearing stale lease from #{current['holder'] || 'unknown'} (#{age_in_words(held_at)} old)"
      FileUtils.rm_f(store.lock_path)
      retry
    end
    warn 'ff.rb: could not acquire lease after clearing a stale one'
    1
  end
end

def lease_release(store)
  FileUtils.rm_f(store.lock_path)
  store.update { |state| state['lease'] = {} }
  puts 'lease released'
  0
end

# --- subcommands ------------------------------------------------------------

def render_items(items)
  return '(no items)' if items.empty?

  items.map do |key, item|
    parts = [
      format('%-12s', item['status'] || '?'),
      format('%-10s', item['class'] || '-'),
      key,
      item['title'] || item['excerpt'].to_s[0, 60]
    ]
    parts << "agent=#{item.dig('agent', 'name')}" if item.dig('agent', 'name')
    parts << "pr=#{item['pr']}" if item['pr']
    parts << "ask=#{item['ask']}" if item['ask']
    parts << ack_label(item['ack']) if item['ack'].is_a?(Hash)
    parts.compact.join('  ')
  end.join("\n")
end

def dig_path(state, dotted)
  dotted.split('.').reduce(state) do |cursor, segment|
    return nil unless cursor.is_a?(Hash)

    cursor[segment]
  end
end

def command_get(store, options)
  state = store.read
  items = state.fetch('items', {})
  key = options[:key]

  # An argument with a ':' is an item key; anything else is a dotted state path.
  if key&.include?(':')
    item = items[key]
    abort "ff.rb: no item #{key}" if item.nil?
    puts options[:json] ? JSON.pretty_generate(item) : render_items(key => item)
    return 0
  end

  if key
    value = dig_path(state, key)
    if options[:json]
      puts JSON.pretty_generate(value)
    else
      puts value.nil? ? '(unset)' : (value.is_a?(String) ? value : JSON.generate(value))
    end
    return 0
  end

  if options[:status]
    wanted = options[:status].split(',').map(&:strip)
    unknown = wanted - STATUSES
    abort "ff.rb: unknown status #{unknown.join(', ')}" if unknown.any?

    selected = items.select { |_key, item| wanted.include?(item['status']) }
    puts options[:json] ? JSON.pretty_generate(selected) : render_items(selected)
    return 0
  end

  if options[:json]
    puts JSON.pretty_generate(state)
  else
    puts "state: #{store.path}"
    puts "day:   #{state.dig('day', 'date')}  #{state.dig('day', 'dir')}"
    puts render_items(items)
  end
  0
end

# A value that parses as JSON is stored as JSON (numbers, booleans, arrays,
# objects); anything else is stored as the literal string, so `set profile local`
# and `set interval 5m` do not need quoting gymnastics.
def coerce_value(raw)
  JSON.parse(raw)
rescue JSON::ParserError
  raw
end

def command_set(store, dotted, raw)
  abort 'ff.rb: set needs <dotted.key> <value>' if dotted.nil? || raw.nil?

  parts = dotted.split('.')
  root = parts.first
  unless SETTABLE_KEYS.include?(root)
    abort "ff.rb: #{root.inspect} is not settable (allowed: #{SETTABLE_KEYS.join(' ')}); " \
          'items use `upsert`, watermarks use `watermark`, the on-call rotation uses `oncall`, ' \
          'and what to watch lives in config.json'
  end

  value = coerce_value(raw)
  if parts.size == 1
    case root
    when 'profile'
      abort "ff.rb: profile must be #{PROFILES.join('|')}" unless PROFILES.include?(value.to_s)
    when 'scheduler'
      abort "ff.rb: scheduler must be #{SCHEDULERS.join('|')}" unless SCHEDULERS.include?(value.to_s)
    when 'channels'
      abort 'ff.rb: channels must be a JSON array, e.g. \'["#support CEXAMPLE1"]\'' unless value.is_a?(Array)
    when 'cron', 'dashboard'
      abort "ff.rb: #{root} must be a JSON object, or set a leaf like #{root}.id" unless value.is_a?(Hash)
    end
  end

  store.update do |state|
    cursor = state
    parts[0..-2].each do |segment|
      cursor[segment] = {} unless cursor[segment].is_a?(Hash)
      cursor = cursor[segment]
    end
    cursor[parts.last] = value
  end
  puts "#{dotted} = #{value.is_a?(String) ? value : JSON.generate(value)}"
  0
end

# `oncall` is its own subcommand rather than four more SETTABLE_KEYS because the
# fields are not independent: forcing the mode stamps the day it was forced, and
# recording an activation must report whether it was a *transition* — the one tick
# that earns the "on-call mode active" DM. `get oncall.mode` still reads any leaf.
def command_oncall(store, action, value, options)
  today = Time.now.strftime('%Y-%m-%d')

  if %w[auto on active].include?(action) && !ff_config.oncall_configured?
    warn "ff.rb: no on-call channel configured — set oncall.channel_id and oncall.handle_id in #{ff_config.path}"
    return 1
  end

  case action
  when nil, 'status'
    state = store.read
    puts options[:json] ? JSON.pretty_generate(oncall_view(state)) : "oncall: #{oncall_line(state)}"
    return 0
  when 'auto', 'off'
    store.update do |state|
      oncall = state['oncall'] = oncall_view(state)
      oncall['mode'] = action
      oncall['forced_date'] = nil
      next unless action == 'off'

      oncall.merge!('active' => false, 'active_date' => nil, 'shift_start_ts' => nil)
    end
    puts "oncall mode = #{action}#{action == 'off' ? ' (never watching the on-call channel)' : ''}"
    return 0
  when 'on'
    # The user asserting "I'm on call" — good for TODAY only, which is what
    # `forced_date` records and `rollover` undoes. Activate straight away so `summary`
    # tells the truth before the next tick; a tick's own detection refines
    # `shift_start_ts`.
    store.update do |state|
      oncall = state['oncall'] = oncall_view(state)
      oncall['mode'] = 'on'
      oncall['forced_date'] = today
      # A shift start carried over from an earlier day is not today's.
      oncall['shift_start_ts'] = nil unless oncall_active_today?(oncall)
      oncall['shift_start_ts'] = value || oncall['shift_start_ts'] || start_of_today_ts
      oncall.merge!('active' => true, 'active_date' => today)
    end
    puts "oncall: #{oncall_line(store.read)}"
    return 0
  when 'active', 'inactive'
    oncall = oncall_view(store.read)
    if oncall['mode'] == 'off'
      warn 'ff.rb: oncall mode is off — run `ff.rb oncall auto` before recording a shift'
      return 1
    end
    if action == 'active' && (value.nil? || value.to_s.strip.empty?)
      abort 'ff.rb: oncall active needs <shift_start_ts> (the ts of the rotation announcement naming you)'
    end

    was_active = oncall_active_today?(oncall)
    if action == 'active'
      store.update do |state|
        block = state['oncall'] = oncall_view(state)
        block.merge!('active' => true, 'active_date' => today, 'shift_start_ts' => value)
      end
      puts "oncall: #{oncall_line(store.read)} · transition=#{!was_active}"
    else
      # A forced `on` outranks detection: `auto` said "not today", but the user said it is.
      if oncall['mode'] == 'on' && oncall['forced_date'] == today
        puts "oncall: #{oncall_line(store.read)} · kept (forced on for #{today})"
        return 0
      end
      store.update do |state|
        block = state['oncall'] = oncall_view(state)
        block.merge!('active' => false, 'active_date' => nil, 'shift_start_ts' => nil)
      end
      puts "oncall: #{oncall_line(store.read)} · transition=#{was_active}"
    end
    return 0
  end

  abort "ff.rb: oncall takes status|auto|on|off|active|inactive, got #{action.inspect}"
end

# --- acknowledged items: the ask and the answer --------------------------------
#
# An item the user acknowledged that would otherwise have been dispatched is parked
# `acked`: skipped by default, and asked about once — in-session when they are at
# the keyboard, otherwise as one numbered line in that day's ask thread in their
# self-DM. `asks` tells a tick which threads are worth a read; `decide` applies what
# it finds there.

# Only an item that carries an `ack` block and was never touched by an agent may be
# decided — and `new`/`ignored` only when an earlier answer put it there, so a change
# of mind before dispatch works but an unrelated ignore (self-resolved, resolved by
# reaction) can't be reopened, and nothing ever reaches a second dispatch through here.
def decide_refusal(item)
  return 'not in state' if item.nil?
  return 'has no ack block — only acknowledged items are decided' unless item['ack'].is_a?(Hash)
  return "already has agent #{item.dig('agent', 'name')} — never re-dispatched" if item.dig('agent', 'name')

  status = item['status']
  previous = item.dig('ack', 'decision')
  return nil if %w[acked user_owns].include?(status)
  return nil if status == 'new' && previous == 'loop'
  return nil if status == 'ignored' && previous

  "is #{status.inspect}#{previous ? '' : ' with no earlier decision'} — not decidable"
end

def command_decide(store, key, decision, options)
  abort 'ff.rb: decide needs <item key> skip|mine|loop' if key.nil? || decision.nil?
  unless ACK_OUTCOMES.key?(decision)
    abort "ff.rb: decision must be #{ACK_OUTCOMES.keys.join('|')}, got #{decision.inspect}"
  end
  via = options[:via] || 'cli'
  abort "ff.rb: --via must be #{ACK_VIAS.join('|')}" unless ACK_VIAS.include?(via)
  answer_ts = options[:answer_ts]
  if answer_ts && !answer_ts.match?(/\A\d+(\.\d+)?\z/)
    abort "ff.rb: --answer-ts must be a chat ts, got #{answer_ts.inspect}"
  end
  reaction = via == 'reaction'
  if reaction && decision != 'loop'
    abort "ff.rb: a :#{ack_reaction}: reaction only ever means loop, got #{decision.inspect}"
  end
  if reaction && answer_ts.nil?
    abort 'ff.rb: --via reaction needs --answer-ts <ts of the ask message that carries the reaction>'
  end

  item = store.read.fetch('items', {})[key]
  refusal = decide_refusal(item)
  # A reaction has no ts of its own, so it is pinned to the message it sits on — and that
  # must be THIS item's own ask line. That is what makes "answered before it was asked"
  # impossible for a reaction: the message it reacts to is the ask.
  if refusal.nil? && reaction && item.dig('ack', 'ask', 'ts') != answer_ts
    refusal = "the reacted message #{answer_ts} is not this item's ask line " \
              "(ack.ask.ts #{item.dig('ack', 'ask', 'ts').inspect})"
  end
  if refusal
    warn "ff.rb: cannot decide #{key}: #{refusal}"
    return 1
  end

  # `--answer-ts` is the ts of the DM reply carrying the answer. A tick re-reads the
  # whole ask thread every time, so an answer at or before the last one applied is
  # stale and must not undo a later decision (made in the thread, in-session or here).
  # And an answer older than the message that asked about this item was never about it:
  # an `all skip` from this morning must not sweep up an item added to the thread at noon.
  #
  # A reaction is stamped with the ask line's own ts — the earliest moment it could have
  # been placed. So a reply answer (always later than the ask) beats it whichever came
  # first, a decision already on the item makes it a no-op, and re-reading the same
  # reaction every tick changes nothing: reply beats reaction, by construction.
  stamp = answer_ts || format('%.6f', Time.now.to_f)
  outcome = nil
  store.update do |state|
    item = state['items'][key]
    ack = item['ack']
    asked_ts = ack.dig('ask', 'ts') || ack.dig('ask', 'thread_ts')
    if answer_ts && !reaction && asked_ts && stamp.to_f <= asked_ts.to_f
      outcome = "unchanged #{key} — this answer predates the ask (#{asked_ts})"
      next
    end
    if ack['decided_ts'] && stamp.to_f <= ack['decided_ts'].to_f
      outcome = "unchanged #{key} — #{ack['decision']} (decided #{ack['decided_ts']}) is not older than this answer"
      next
    end

    status, reason = ACK_OUTCOMES[decision]
    ack.merge!('decision' => decision, 'decided_at' => now_iso, 'decided_ts' => stamp, 'decided_via' => via)
    item.merge!('status' => status, 'reason' => reason, 'updated_at' => now_iso)
    outcome = "decided #{key} #{decision} -> #{status}#{decision == 'loop' ? ' (queued for dispatch)' : ''}"
  end
  puts outcome
  0
end

def ask_entry(key, item)
  ack = item['ack']
  { 'n' => ack.dig('ask', 'n'), 'key' => key, 'open' => item['status'] == 'acked',
    'asked_ts' => ack.dig('ask', 'ts') || ack.dig('ask', 'thread_ts'),
    'status' => item['status'], 'class' => item['class'],
    'title' => item['title'] || item['excerpt'].to_s[0, 60],
    'via' => ack['via'], 'decision' => ack['decision'], 'decided_ts' => ack['decided_ts'] }
end

# Grouped by ask thread, because that is the unit a tick pays for: one thread read
# per thread with an open item, however many items it lists. Decided items stay
# listed so a later "2 loop" in that thread still maps n -> key.
def ask_report(state)
  today = Time.now.strftime('%Y-%m-%d')
  threads = {}
  unasked = []
  state.fetch('items', {}).each do |key, item|
    next unless item['ack'].is_a?(Hash)

    ask = item.dig('ack', 'ask')
    if ask.is_a?(Hash) && ask['thread_ts']
      thread = threads["#{ask['channel_id']}:#{ask['thread_ts']}"] ||= {
        'channel_id' => ask['channel_id'], 'thread_ts' => ask['thread_ts'], 'items' => []
      }
      thread['items'] << ask_entry(key, item)
    elsif item['status'] == 'acked'
      unasked << ask_entry(key, item)
    end
  end

  threads.each_value do |thread|
    thread['date'] = parse_moment(thread['thread_ts'])&.strftime('%Y-%m-%d')
    thread['age'] = age_in_words(thread['thread_ts'])
    thread['open'] = thread['items'].count { |entry| entry['open'] }
    fresh = (seconds_since(thread['thread_ts']) || 0) <= ack_poll_days * 86_400
    thread['poll'] = thread['open'].positive? && fresh
    thread['items'].sort_by! { |entry| entry['n'].to_i }
  end

  # One ask thread per day: the day's first ask posts a root, later ticks reply under
  # it and carry the numbering on.
  todays = threads.values.find { |thread| thread['date'] == today }
  today_thread = { 'channel_id' => nil, 'thread_ts' => nil, 'next_n' => 1 }
  if todays
    today_thread = { 'channel_id' => todays['channel_id'], 'thread_ts' => todays['thread_ts'],
                     'next_n' => todays['items'].map { |entry| entry['n'].to_i }.max.to_i + 1 }
  end
  # The only messages worth a reaction check: an OPEN item's own ask line, in a thread
  # still being polled. A decided item's reaction can change nothing (reply beats reaction).
  probes = threads.values.select { |thread| thread['poll'] }.flat_map do |thread|
    thread['items'].select { |entry| entry['open'] && entry['asked_ts'] && entry['asked_ts'] != thread['thread_ts'] }
                   .map { |entry| { 'channel_id' => thread['channel_id'], 'message_ts' => entry['asked_ts'], 'key' => entry['key'], 'n' => entry['n'] } }
  end
  {
    'open' => threads.values.sum { |thread| thread['open'] } + unasked.size,
    'threads' => threads.values.sort_by { |thread| thread['thread_ts'].to_f },
    'reaction_probes' => probes,
    'unasked' => unasked,
    'today' => today_thread
  }
end

def command_asks(store, options)
  report = ask_report(store.read)
  if options[:json]
    puts JSON.pretty_generate(report)
    return 0
  end

  polled = report['threads'].count { |thread| thread['poll'] }
  puts "asks: #{report['open']} open · #{polled} thread(s) to poll · " \
       "#{report['reaction_probes'].size} ask line(s) to check for :#{ack_reaction}: · " \
       "#{report['unasked'].size} not yet asked"
  report['threads'].each do |thread|
    next if thread['open'].zero?

    flag = thread['poll'] ? 'poll' : "not polled (> #{ack_poll_days}d — answer in-session or with `decide`)"
    puts "thread #{thread['channel_id']}:#{thread['thread_ts']} (#{thread['date']}, #{ago(thread['thread_ts'])}) #{flag}"
    thread['items'].each do |entry|
      where = entry['open'] ? 'open' : "#{entry['decision']} -> #{entry['status']}"
      puts "  ##{entry['n']}  #{entry['key']}  #{entry['class'] || '-'}  #{entry['title']}  (#{entry['via']}; #{where})"
    end
  end
  unless report['unasked'].empty?
    puts 'not yet asked:'
    report['unasked'].each do |entry|
      puts "  #{entry['key']}  #{entry['class'] || '-'}  #{entry['title']}  (#{entry['via']})"
    end
  end
  today = report['today']
  if today['thread_ts']
    puts "today: reply under #{today['channel_id']}:#{today['thread_ts']}, next ##{today['next_n']}"
  else
    puts 'today: no ask thread yet — the next ask posts a new root, starting at #1'
  end
  0
end

# Time UNTIL expiry (not since): EXPIRED when past, a warning under 24h.
def cron_expiry_note(expires_at)
  moment = parse_moment(expires_at)
  return '' if moment.nil?

  remaining = moment - Time.now
  return ' EXPIRED — run `start` again' unless remaining.positive?

  note = " expires in #{duration_words(remaining)}"
  remaining < 86_400 ? "#{note} — WARNING: under 24h left, run `start` again soon" : note
end

def command_summary(store)
  state = store.read
  tally = counts_by_status(state)
  items = state.fetch('items', {})
  ordered = STATUSES.filter_map { |status| "#{tally[status]} #{status}" if tally[status].positive? }
  puts "items: #{items.size} total#{ordered.empty? ? '' : " — #{ordered.join(' · ')}"}"

  agents = live_agents(state)
  puts "agents: #{agents.size} live#{agents.empty? ? '' : " (#{agents.join(', ')})"}"

  marks = state.fetch('watermarks', {}).map do |name, mark|
    if name == 'mentions'
      "mentions after:#{mark['after_date'] || '?'} (#{(mark['seen_ts'] || []).size} seen, " \
        "checked #{ago(mark['checked_at'])})"
    else
      "#{name} #{ago(mark['checked_at'])}"
    end
  end
  puts "watermarks: #{marks.empty? ? '(none)' : marks.join(' · ')}"

  cron = state.fetch('cron', {})
  if cron['id']
    expiry = cron_expiry_note(cron['expires_at'])
    puts "cron: #{cron['id']} #{cron['expression']}#{expiry}"
  else
    puts 'cron: none (session-only cron; `start` re-creates it)'
  end

  puts "oncall: #{oncall_line(state)}"

  open_asks = items.count { |_key, item| item['status'] == 'acked' }
  if open_asks.positive?
    puts "asks: #{open_asks} acknowledged item(s) awaiting your call — skipped until you answer (`ff.rb asks`)"
  end

  config_problems = ff_config.problems
  status = config_problems.empty? ? 'ok' : "#{config_problems.size} problem(s), run `ff.rb config check`"
  puts "config: #{ff_config.path} — #{status}"

  lease = state.fetch('lease', {})
  puts "lease: #{lease['holder'] ? "#{lease['holder']} (#{age_in_words(lease['acquired_at'])} old)" : 'free'}"
  puts "day: #{state.dig('day', 'date')} #{state.dig('day', 'dir')}"
  0
end

def describe_channels(entries)
  list = Array(entries)
  return '(no channels)' if list.empty?

  list.map { |entry| entry.is_a?(Hash) ? [entry['name'], entry['id']].compact.join(' ') : entry.to_s }.join(' · ')
end

def command_config(action, options)
  config = ff_config
  case action
  when nil, 'show'
    if options[:json]
      puts JSON.pretty_generate(config.data)
      return 0
    end
    puts "config: #{config.path}#{config.exist? ? '' : ' (absent — showing the template)'}"
    puts "watch: #{describe_channels(config.dig('watch', 'channels'))}#{config.dig('watch', 'mentions') ? ' + your mentions' : ''}"
    keywords = Array(config.dig('watch', 'keywords'))
    puts "keywords: #{keywords.empty? ? '(none — every channel item is in scope)' : keywords.join(', ')}"
    puts "area: #{config.dig('watch', 'area') || '(unset)'}"
    puts "self: #{config.dig('self', 'user_id') || '(unset)'}"
    oncall = if config.oncall_configured?
               "#{config.dig('oncall', 'channel_name') || config.dig('oncall', 'channel_id')} " \
                 "tag #{config.dig('oncall', 'handle_id') || '(unset)'} " \
                 "rotation bot #{config.dig('oncall', 'rotation_bot_id') || '(unset — `oncall on` only)'}"
             else
               '(not configured)'
             end
    puts "oncall: #{oncall}"
    puts "dispatch: #{config.dig('dispatch', 'max_per_tick')}/tick · #{config.dig('dispatch', 'live_cap')} live · " \
         "hard cap #{config.dig('dispatch', 'hard_cap')} · repo #{config.dig('dispatch', 'repo') || '(unset)'} · " \
         "branches #{config.dig('dispatch', 'branch_prefix')}<slug>"
    0
  when 'init'
    path = config.write_template(force: options[:force])
    puts "wrote config template -> #{path} (edit it, then `ff.rb config check`)"
    0
  when 'check'
    problems = config.problems(report_only: options[:report_only])
    if problems.empty?
      puts "config OK — #{config.path}"
      return 0
    end
    problems.each { |problem| warn "CONFIG: #{problem}" }
    warn "ff.rb config check: #{problems.size} problem(s)"
    1
  else
    abort "ff.rb: config takes show|init|check, got #{action.inspect}"
  end
end

def command_watermark_forget(store, target)
  abort 'ff.rb: watermark --forget needs <channel_id>' if target.nil?
  # `mentions` is structural: the mention search has nowhere else to keep its after: date.
  abort 'ff.rb: watermark --forget will not remove the mentions watermark' if target == 'mentions'

  removed = nil
  store.update do |state|
    marks = state['watermarks'] ||= {}
    removed = marks.delete(target)
  end
  if removed.nil?
    warn "ff.rb: no watermark #{target.inspect} to forget"
    return 1
  end
  puts "forgot watermark #{target} (was latest_ts=#{removed['latest_ts'].inspect})"
  0
end

def command_watermark(store, target, value)
  abort 'ff.rb: watermark needs <channel_id|mentions> <ts|date>' if target.nil? || value.nil?

  stored = value
  store.update do |state|
    marks = state['watermarks'] ||= {}
    if target == 'mentions'
      mark = marks['mentions'] ||= { 'after_date' => nil, 'seen_ts' => [] }
      if value.match?(/\A\d{4}-\d{2}-\d{2}\z/)
        mark['after_date'] = value
      else
        mark['seen_ts'] = ((mark['seen_ts'] || []) + [value]).uniq.last(SEEN_TS_HISTORY)
      end
      mark['checked_at'] = now_iso
    else
      mark = marks[target] ||= {}
      # Never move a watermark backwards: a late-arriving read must not replay a channel.
      current = mark['latest_ts']
      mark['latest_ts'] = value if current.nil? || value.to_f >= current.to_f
      mark['checked_at'] = now_iso
      stored = mark['latest_ts']
    end
  end
  puts "watermark #{target} = #{stored}#{stored == value ? '' : " (kept; #{value} is older)"}"
  0
end

def command_upsert(store, key, payload)
  abort 'ff.rb: upsert needs <key>' if key.nil?
  unless key.match?(/\A[^:\s]+:[^:\s]+\z/)
    abort "ff.rb: item key must be <channel_id>:<ts> (or <source>:<id>), got #{key.inspect}"
  end

  partial = parse_json_argument(payload, 'upsert')
  if partial['status'] && !STATUSES.include?(partial['status'])
    abort "ff.rb: unknown status #{partial['status'].inspect} (allowed: #{STATUSES.join(' ')})"
  end

  created = false
  store.update do |state|
    items = state['items'] ||= {}
    existing = items[key]
    if existing.nil?
      created = true
      channel_id, ts = key.split(':', 2)
      existing = {
        'channel_id' => channel_id,
        'ts' => ts,
        'status' => 'new',
        'first_seen_at' => now_iso
      }
    end
    merged = deep_merge(existing, partial)
    merged['updated_at'] = now_iso
    items[key] = merged
  end
  puts "#{created ? 'created' : 'updated'} #{key}"
  0
end

def command_link(store, key, owner_key)
  abort 'ff.rb: link needs <key> <owner_key>' if key.nil? || owner_key.nil?
  abort 'ff.rb: an item cannot link to itself' if key == owner_key

  store.update do |state|
    items = state['items'] ||= {}
    warn "ff.rb: warning — owner #{owner_key} is not in state yet" unless items.key?(owner_key)
    item = items[key] || begin
      channel_id, ts = key.split(':', 2)
      { 'channel_id' => channel_id, 'ts' => ts, 'first_seen_at' => now_iso }
    end
    item['status'] = 'linked'
    item['linked_to'] = owner_key
    item['updated_at'] = now_iso
    items[key] = item

    owner = items[owner_key]
    if owner
      owner['linked_from'] = ((owner['linked_from'] || []) + [key]).uniq
      owner['updated_at'] = now_iso
    end
  end
  puts "linked #{key} -> #{owner_key}"
  0
end

def command_log_append(store, options)
  state = store.read
  state['_state_path'] = store.path
  state['_dry_run'] = true if options[:dry_run]
  path = log_path(store, state, options[:day_dir])

  if options[:tick]
    append_tick_line(path, state, options[:tick])
    store.update do |current|
      current['ticks'] = ((current['ticks'] || []) + [{ 'at' => now_iso, 'line' => options[:tick] }]).last(TICK_HISTORY)
    end
    puts "tick logged -> #{path}"
    return 0
  end

  row = parse_json_argument(options[:json_payload], 'log-append')
  unknown = row.keys.map(&:to_s) - LOG_ROW_KEYS
  unless unknown.empty?
    warn "log-append: unknown column(s) #{unknown.join(', ')} — allowed: #{LOG_ROW_KEYS.join(', ')}"
    return 1
  end
  ts = row.delete('ts')
  row['time'] = log_time_cell(ts) if row['time'].nil? || row['time'].to_s.empty?
  append_log_row(path, state, row)
  puts "row logged -> #{path}"
  0
end

def command_rollover(store, day_dir)
  today = Time.now.strftime('%Y-%m-%d')
  rolled = false
  target = nil
  oncall_reset = []
  store.update do |state|
    day = state['day'] ||= {}
    target = day_dir ? File.expand_path(day_dir) : store.day_dir_for(today)
    rolled = day['date'] != today || day['dir'] != target
    day['date'] = today
    day['dir'] = target

    # The rotation moves every day: yesterday's activation says nothing about today,
    # and a forced `on` was the user asserting *that* day only. Both expire here, so a
    # new day always starts from detection and never silently inherits someone else's
    # shift. An activation already stamped today is left alone — rollover runs every
    # tick, and re-clearing it would re-fire the activation DM.
    oncall = state['oncall']
    next unless oncall.is_a?(Hash)

    if oncall['active'] && oncall['active_date'] != today
      oncall.merge!('active' => false, 'active_date' => nil, 'shift_start_ts' => nil)
      oncall_reset << 'activation cleared'
    end
    if oncall['mode'] == 'on' && oncall['forced_date'] != today
      oncall['mode'] = 'auto'
      oncall['forced_date'] = nil
      oncall_reset << 'forced on -> auto'
    end
  end
  FileUtils.mkdir_p(target)
  puts "#{rolled ? 'rolled over to' : 'already on'} #{today} — #{target}" \
       "#{oncall_reset.empty? ? '' : " (oncall: #{oncall_reset.join(', ')})"}"
  0
end

def command_verify(store)
  state = store.read
  problems = []
  problems << "version is #{state['version'].inspect}, expected #{SCHEMA_VERSION}" if state['version'] != SCHEMA_VERSION
  %w[cron lease day dashboard watermarks items].each do |key|
    problems << "missing or non-object key #{key}" unless state[key].is_a?(Hash)
  end
  problems << 'ticks is not an array' unless state.fetch('ticks', []).is_a?(Array)
  if state['channels'] && !state['channels'].is_a?(Array)
    problems << 'channels must be an array of "#name ID" strings or {name, id} objects'
  end
  if state['profile'] && !PROFILES.include?(state['profile'])
    problems << "profile is #{state['profile'].inspect}, expected #{PROFILES.join('|')}"
  end
  if state['scheduler'] && !SCHEDULERS.include?(state['scheduler'])
    problems << "scheduler is #{state['scheduler'].inspect}, expected #{SCHEDULERS.join('|')}"
  end

  # Checked only when present: absent is valid (it reads as the defaults), malformed
  # is not.
  oncall = state['oncall']
  if !oncall.nil? && !oncall.is_a?(Hash)
    problems << 'oncall must be an object {mode, handle_id, channel_id, active, ...}'
  elsif oncall.is_a?(Hash)
    unless ONCALL_MODES.include?(oncall['mode'].to_s)
      problems << "oncall.mode is #{oncall['mode'].inspect}, expected #{ONCALL_MODES.join('|')}"
    end
    unless [true, false, nil].include?(oncall['active'])
      problems << "oncall.active is #{oncall['active'].inspect}, expected true|false"
    end
    %w[handle_id channel_id channel_name active_date shift_start_ts forced_date].each do |key|
      problems << "oncall.#{key} must be a string or null" unless oncall[key].nil? || oncall[key].is_a?(String)
    end
    problems << 'oncall.active is true with no active_date' if oncall['active'] == true && oncall['active_date'].nil?
    problems << 'oncall.active is true with no shift_start_ts' if oncall['active'] == true && oncall['shift_start_ts'].nil?
  end

  items = state.fetch('items', {})
  items = {} unless items.is_a?(Hash)
  items.each do |key, item|
    problems << "item key #{key.inspect} is not <channel_id>:<ts>" unless key.match?(/\A[^:\s]+:[^:\s]+\z/)
    unless item.is_a?(Hash)
      problems << "item #{key} is not an object"
      next
    end
    problems << "item #{key} has unknown status #{item['status'].inspect}" unless STATUSES.include?(item['status'])
    if item['agent'] && !item['agent'].is_a?(Hash)
      problems << "item #{key} agent must be an object {name, id}"
    end
    if item['artifacts'] && !item['artifacts'].is_a?(Array)
      problems << "item #{key} artifacts must be an array"
    end
    if item['linked_to'] && !items.key?(item['linked_to'])
      problems << "item #{key} links to missing owner #{item['linked_to']}"
    end
    if item['status'] == 'linked' && item['linked_to'].nil?
      problems << "item #{key} is linked but has no linked_to"
    end
    ack = item['ack']
    if !ack.nil? && !ack.is_a?(Hash)
      problems << "item #{key} ack must be an object {via, ts, ask, decision, ...}"
    elsif ack.is_a?(Hash)
      if ack['decision'] && !ACK_OUTCOMES.key?(ack['decision'])
        problems << "item #{key} ack.decision is #{ack['decision'].inspect}, expected #{ACK_OUTCOMES.keys.join('|')}"
      end
      problems << "item #{key} ack.ask must be an object {channel_id, thread_ts, ts, n}" if ack['ask'] && !ack['ask'].is_a?(Hash)
      if item['status'] == 'acked' && ack['decision']
        problems << "item #{key} is acked but already carries decision #{ack['decision'].inspect}"
      end
    end
    if %w[acked user_owns].include?(item['status']) && !ack.is_a?(Hash)
      problems << "item #{key} is #{item['status']} but has no ack block"
    end
  end

  watermarks = state['watermarks']
  watermarks = {} unless watermarks.is_a?(Hash)
  watermarks.each do |name, mark|
    next problems << "watermark #{name} is not an object" unless mark.is_a?(Hash)
    next unless name == 'mentions'

    problems << 'watermarks.mentions.seen_ts must be an array' unless (mark['seen_ts'] || []).is_a?(Array)
  end

  if problems.empty?
    puts "OK — #{items.size} items, #{state.fetch('watermarks', {}).size} watermarks, schema v#{SCHEMA_VERSION}"
    0
  else
    problems.each { |problem| warn "PROBLEM: #{problem}" }
    warn "ff.rb verify: #{problems.size} problem(s)"
    1
  end
end

# --- sync -------------------------------------------------------------------
#
# When the state dir is a clone of a private state repo, a tick's last act is to
# publish it. Everything here is deliberately loud on failure and silent-but-explicit
# on a no-op: the caller keys "may I advance the watermarks?" off the exit code.

def git_capture(dir, *args)
  output = IO.popen(['git', '-C', dir, *args], err: %i[child out], &:read)
  [output.to_s.strip, $?.success?]
end

# :root when the state dir IS a repo's top level, :nested when it merely sits inside
# some other repo (a sandbox, an app checkout), :none otherwise. Only :root syncs:
# `--is-inside-work-tree` alone once made sync pull, commit and try to push the
# PARENT repo of a state dir that happened to live inside it.
def state_repo_status(dir)
  return [:none, nil] unless File.directory?(dir)

  top, ok = git_capture(dir, 'rev-parse', '--show-toplevel')
  return [:none, nil] unless ok && !top.empty?

  File.realpath(top) == File.realpath(dir) ? [:root, top] : [:nested, top]
end

def last_line(text) = text.to_s.lines.map(&:strip).reject(&:empty?).last

# A pathspec that matches nothing makes `git add` fail outright, and `artifacts/`
# legitimately doesn't exist until the first cloud run — so only name what is really
# there, on disk or in the index (an index-only entry is a deletion to stage).
def sync_pathspecs(dir)
  SYNC_PATHS.select do |path|
    File.exist?(File.join(dir, path)) || !git_capture(dir, 'ls-files', '--', path).first.empty?
  end
end

def command_sync(store, message)
  if message.to_s.strip.empty?
    abort 'ff.rb: sync needs a commit message, e.g. ff.rb sync "tick 09:15: 1 new, 1 dispatched"'
  end

  dir = store.dir
  status, top = state_repo_status(dir)
  if status == :nested
    puts "sync: #{dir} sits inside the repo #{top} but is not its root — refusing to commit " \
         'or push a parent repo; state is local-only (no-op). Make the state dir its own clone to sync.'
    return 0
  end
  unless status == :root
    puts "sync: #{dir} is not a git repo — state is local-only, nothing to push (no-op)"
    return 0
  end

  # `--autostash` is not optional here: sync always runs with the tick's writes still
  # uncommitted, and a plain `pull --rebase` refuses outright on a dirty tree.
  pulled, pull_ok = git_capture(dir, 'pull', '--rebase', '--autostash')
  warn "ff.rb sync: pull --rebase failed, continuing to the push: #{last_line(pulled)}" unless pull_ok

  paths = sync_pathspecs(dir)
  dirty = paths.empty? ? '' : git_capture(dir, 'status', '--porcelain', '--', *paths).first
  unpushed, upstream_ok = git_capture(dir, 'rev-list', '--count', '@{u}..HEAD')
  if dirty.empty? && upstream_ok && unpushed == '0'
    puts 'sync: nothing changed and nothing unpushed (no-op)'
    return 0
  end

  unless dirty.empty?
    added, add_ok = git_capture(dir, 'add', '-A', '--', *paths)
    unless add_ok
      warn "ff.rb sync: git add failed: #{last_line(added)}"
      return 1
    end
    staged, = git_capture(dir, 'diff', '--cached', '--name-only', '--', *paths)
    unless staged.empty?
      # Pathspec-limited: anything else staged in this repo's index stays staged, uncommitted.
      committed, commit_ok = git_capture(dir, 'commit', '-m', message, '--', *paths)
      unless commit_ok
        warn "ff.rb sync: commit failed: #{last_line(committed)}"
        return 1
      end
    end
  end

  # One retry only, and only through pull --rebase: a `push --force` here would throw
  # away a concurrent run's items, which is exactly the loss this repo exists to prevent.
  2.times do |attempt|
    pushed, push_ok = git_capture(dir, 'push')
    if push_ok
      head, = git_capture(dir, 'rev-parse', '--short', 'HEAD')
      puts "sync: pushed #{head} — #{message}"
      return 0
    end
    if attempt.zero?
      warn "ff.rb sync: push rejected (#{last_line(pushed)}) — pull --rebase, retrying once"
      retried, retry_ok = git_capture(dir, 'pull', '--rebase', '--autostash')
      warn "ff.rb sync: retry pull --rebase failed: #{last_line(retried)}" unless retry_ok
    else
      warn "ff.rb sync: PUSH FAILED — #{last_line(pushed)}. " \
           'The commit is local only; do NOT advance watermarks.'
    end
  end
  1
end

# --- CLI --------------------------------------------------------------------

USAGE = <<~TEXT
  usage: ruby ff.rb <subcommand> [args] [--state-dir DIR] [--day-dir DIR] [--config FILE] [--dry-run]

  read-only:  get [<item key>|<dotted.key>] [--status S] [--json]  |  summary  |  verify
              config [show] [--json] | config check [--report-only]   (what to watch — YOUR file)
              oncall status [--json]     (today's on-call rotation state)
              asks [--json]              (acked items awaiting your call, by ask thread)
  mutating:   init [--profile local|cloud] [--force]  (also writes a config template if absent)
              config init [--force]      (write the config.json template)
              set <dotted.key> <value>   (#{SETTABLE_KEYS.join(' ')})
              oncall auto|on|off         (watch on-call requests in config's on-call channel:
                                          detect | force TODAY only | never; `rollover`
                                          resets a forced `on` back to auto on the next day)
              oncall active <shift_start_ts> | oncall inactive
                                         (what a tick records after detection;
                                          `active` prints transition=true on the
                                          inactive->active tick — the one that DMs)
              watermark <channel_id|mentions> <ts|date>
              watermark <channel_id> --forget   (remove that key; refuses `mentions`)
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
                 (row cols: #{LOG_COLUMNS.join(' ')}; plus `ts`, which only
                  dates the time cell: HH:MM today, MM-DD HH:MM otherwise)
              rollover
              sync '<commit message>'    (commit + push the state repo; exit 1 on a
                                          failed push — do NOT advance watermarks)

  --dry-run  redirects the state dir to <state-dir>/dryrun (and with it the derived
             day dir, <state-dir>/dryrun/days/<date>) unless that flag was passed
             explicitly, and stamps the LOG.md header DRY RUN. `init --dry-run
             --force` resets it. Gitignore `dryrun/` in a state repo so it never syncs.

  NOTE (zsh): never build flags in an unquoted variable — D="--state-dir X" makes
  ONE argv word. Write flags inline, or use an array: D=(--state-dir X); ... "${D[@]}"

  See the header comment of this file for the schema and exit codes.
TEXT

def main(argv)
  options = { state_dir: default_state_dir, day_dir: nil, holder: "tick-#{Process.pid}" }
  if argv.empty?
    warn USAGE
    return 1
  end
  if %w[-h --help help].include?(argv.first)
    puts USAGE
    return 0
  end

  parser = OptionParser.new do |opts|
    opts.banner = USAGE
    opts.on('--state-dir DIR', "state directory (default $FF_STATE_DIR or #{DEFAULT_STATE_DIR})") do |value|
      options[:state_dir] = value
      options[:state_dir_explicit] = true
    end
    opts.on('--day-dir DIR', 'day dir for LOG.md (default $FF_DAY_DIR or <state-dir>/days/<date>)') do |value|
      options[:day_dir] = value
    end
    opts.on('--config FILE', 'config file (default $FF_CONFIG or <state-dir>/config.json)') do |value|
      options[:config] = value
    end
    opts.on('--dry-run', 'write to a scratch <state-dir>/dryrun sandbox; mark the LOG header DRY RUN') do
      options[:dry_run] = true
    end
    opts.on('--profile NAME', "runtime profile for `init` (#{PROFILES.join('|')})") do |value|
      options[:profile] = value
    end
    opts.on('--json [JSON]', 'output raw JSON, or the JSON payload for upsert/log-append') do |value|
      value.nil? ? options[:json] = true : options[:json_payload] = value
    end
    opts.on('--status STATUS', 'filter `get` by status (comma-separated)') { |value| options[:status] = value }
    opts.on('--tick LINE', 'append a trace line to the day log\'s ## Ticks section') { |value| options[:tick] = value }
    opts.on('--holder NAME', 'lease holder name') { |value| options[:holder] = value }
    opts.on('--report-only', 'config check: do not require dispatch.repo (classify-and-log runs)') { options[:report_only] = true }
    opts.on('--force', 're-init state (discarding it), or overwrite the config template') { options[:force] = true }
    opts.on('--forget', 'watermark: remove that channel key instead of advancing it') { options[:forget] = true }
    opts.on('--via WHERE', "decide: where the answer came from (#{ACK_VIAS.join('|')})") { |value| options[:via] = value }
    opts.on('--answer-ts TS', 'decide: ts of the DM reply carrying the answer (with --via reaction: the reacted ask line)') do |value|
      options[:answer_ts] = value
    end
  end

  # Parse first, then take the subcommand off what's left, so flags may sit on
  # either side of it (`ff.rb --state-dir D init` and `ff.rb init --state-dir D`).
  begin
    parser.parse!(argv)
  rescue OptionParser::ParseError => error
    abort "ff.rb: #{error.message}\n\n#{USAGE}"
  end

  subcommand = argv.shift
  abort USAGE if subcommand.nil?

  # The config belongs to the REAL state dir: a rehearsal must watch exactly what a
  # live tick would, so resolve it before --dry-run moves the state dir.
  config_path = options[:config] || ENV['FF_CONFIG'] || File.join(File.expand_path(options[:state_dir]), 'config.json')
  $ff_config = Config.new(config_path)

  # A rehearsal still writes — just into its own sandbox, so tick traces and LOG
  # rows are real artifacts that no live tick will ever read.
  # The day dir derives from the state dir, so redirecting the state dir is the
  # whole redirect — <state-dir>/dryrun/days/<date> follows on its own.
  if options[:dry_run] && !options[:state_dir_explicit]
    options[:state_dir] = File.join(options[:state_dir], 'dryrun')
  end

  store = State.new(dir: options[:state_dir], day_dir: options[:day_dir])

  case subcommand
  when 'get' then options[:key] = argv.shift; command_get(store, options)
  when 'summary' then command_summary(store)
  when 'verify' then command_verify(store)
  when 'config' then command_config(argv.shift, options)
  when 'init'
    profile = options[:profile]
    abort "ff.rb: --profile must be #{PROFILES.join('|')}" if profile && !PROFILES.include?(profile)

    store.init(force: options[:force])
    store.update { |state| state['profile'] = profile } if profile
    puts "state ready at #{store.path}#{profile ? " (profile #{profile})" : ''}"
    unless ff_config.exist?
      ff_config.write_template
      puts "wrote config template -> #{ff_config.path} — edit it (channels, your user id), then `ff.rb config check`"
    end
    0
  when 'set' then command_set(store, argv.shift, argv.shift)
  when 'oncall' then command_oncall(store, argv.shift, argv.shift, options)
  when 'watermark'
    target = argv.shift
    options[:forget] ? command_watermark_forget(store, target) : command_watermark(store, target, argv.shift)
  when 'upsert' then command_upsert(store, argv.shift, options[:json_payload])
  when 'link' then command_link(store, argv.shift, argv.shift)
  when 'asks' then command_asks(store, options)
  when 'decide' then command_decide(store, argv.shift, argv.shift, options)
  when 'lease'
    action = argv.shift
    case action
    when 'acquire' then lease_acquire(store, options[:holder])
    when 'release' then lease_release(store)
    else abort "ff.rb: lease takes acquire|release, got #{action.inspect}"
    end
  when 'log-append' then command_log_append(store, options)
  when 'rollover' then command_rollover(store, options[:day_dir])
  when 'sync' then command_sync(store, argv.shift)
  else abort "ff.rb: unknown subcommand #{subcommand.inspect}\n\n#{USAGE}"
  end
end

exit(main(ARGV)) if $PROGRAM_NAME == __FILE__
