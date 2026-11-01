#!/usr/bin/env ruby
# frozen_string_literal: true

# dashboard.rb — render the firefighter state as the Artifact dashboard page.
#
#   R=${FF_STATE_DIR:-~/.local/state/firefighter-loop}
#   ruby dashboard.rb $R/state.json $R/dashboard.html
#
# Then publish it with the Artifact tool, passing the stored `dashboard.url` as `url:`
# every time so the URL never changes even when the file moves:
#   Artifact(file_path: <out.html>, url: <state.dashboard.url>); first publish adds icon: "fire".
# Only the very first publish omits `url:` — record what it returns with
# `ff.rb set dashboard.url <url>`.
#
# WHAT COMES OUT
# A self-contained HTML *fragment*, not a document: it starts at <title> and has
# no doctype / <html> / <head> / <body> — the Artifact publisher supplies those.
# Constraints the publisher imposes, all enforced here:
#   - no external hosts at all (no CDN, no web fonts, no remote images); the CSS
#     is inline and there is no JavaScript
#   - every non-ASCII character is emitted as a numeric HTML entity, so the file
#     is pure 7-bit ASCII and survives any transport
#   - theme-aware: light tokens on bare :root, dark overrides both under
#     @media (prefers-color-scheme: dark) guarded by :root:not([data-theme="light"])
#     and again under :root[data-theme="dark"], so the viewer's explicit toggle
#     wins in both directions; body gets an explicit background
#   - wide content scrolls inside its own container; the page body never scrolls
#     sideways
#
# WHAT IT SHOWS  (all of it read from state.json — this script invents nothing)
#   1. status strip: live agents, needs-you, done today, next fire / cron, plus an
#      on-call indicator on the days state says the user is on call (absent otherwise)
#   2. "Needs you" first, because that is the only section the user must act on, then
#      "Acknowledged - your call": items they acknowledged that would otherwise have
#      been dispatched, skipped by default until they answer skip / mine / loop
#   3. one column per status, one card per item (class badge, channel, age,
#      permalink, agent, artifacts, PR, the pending ask / reason, the ack)
#   4. a 7-day tally built from each item's first_seen_at
#   5. the last 20 tick lines, when state carries them — a silent loop and a dead
#      loop look identical without this
#
# Customer names are never added here. Whatever the state holds is what renders,
# placeholders like <account_id> included, verbatim.

require 'json'
require 'erb'
require 'time'

STATUS_ORDER = %w[needs_you acked new dispatched in_progress paused user_owns done linked ignored].freeze
STATUS_LABELS = {
  'needs_you' => 'Needs you',
  'acked' => 'Acknowledged - your call',
  'new' => 'New',
  'dispatched' => 'Dispatched',
  'in_progress' => 'In progress',
  'paused' => 'Paused',
  'user_owns' => 'Yours (you took it)',
  'done' => 'Done',
  'linked' => 'Linked (duplicate)',
  'ignored' => 'Ignored'
}.freeze
LIVE_STATUSES = %w[dispatched in_progress paused].freeze
TALLY_DAYS = 7
TICK_LINES = 20

# --- text ------------------------------------------------------------------

def escape(value)
  value.to_s
       .gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;')
       .gsub('"', '&quot;').gsub("'", '&#39;')
end

# Final pass: anything outside 7-bit ASCII becomes a numeric entity, so the
# published file has no byte above 127 no matter what Slack put in the state.
def asciify(html)
  html.each_char.map { |char| char.ord > 127 ? "&##{char.ord};" : char }.join
end

def truncate(value, limit)
  text = value.to_s.strip
  text.length > limit ? "#{text[0, limit - 1]}..." : text
end

def parse_moment(value)
  return nil if value.nil? || value.to_s.strip.empty?

  value.to_s.match?(/\A\d+(\.\d+)?\z/) ? Time.at(value.to_f) : Time.parse(value.to_s)
rescue ArgumentError
  nil
end

def age_in_words(value)
  moment = parse_moment(value)
  return nil if moment.nil?

  seconds = Time.now - moment
  return "in #{duration_label(-seconds)}" if seconds.negative?

  duration_label(seconds)
end

def duration_label(seconds)
  return "#{seconds.to_i}s" if seconds < 60
  return "#{(seconds / 60).to_i}m" if seconds < 3600
  return "#{(seconds / 3600).to_i}h" if seconds < 86_400

  "#{(seconds / 86_400).to_i}d"
end

# --- state readers ---------------------------------------------------------

def items_of(state)
  raw = state['items']
  raw.is_a?(Hash) ? raw : {}
end

def item_moment(item)
  parse_moment(item['ts']) || parse_moment(item['first_seen_at'])
end

# Newest fire first within a column.
def sorted_items(items)
  items.sort_by { |_key, item| -(item_moment(item)&.to_f || 0) }
end

def live_agent_names(items)
  items.filter_map { |_key, item| item.dig('agent', 'name') if LIVE_STATUSES.include?(item['status']) }.uniq
end

def done_today(items)
  today = Time.now.strftime('%Y-%m-%d')
  items.count do |_key, item|
    item['status'] == 'done' && parse_moment(item['updated_at'])&.strftime('%Y-%m-%d') == today
  end
end

def next_fire_label(state)
  cron = state['cron'].is_a?(Hash) ? state['cron'] : {}
  if cron['next_fire_at']
    moment = parse_moment(cron['next_fire_at'])
    return moment ? moment.localtime.strftime('%H:%M') : cron['next_fire_at'].to_s
  end
  return cron['expression'] if cron['expression']

  'no cron'
end

# Nil on every day the user is not on call — including a state.json with no oncall
# block at all — and the strip simply has no on-call card then. `active` is a fact about
# one day: a stale `true` from an earlier `active_date` is not today's shift.
def oncall_note(state)
  oncall = state['oncall']
  return nil unless oncall.is_a?(Hash) && oncall['active'] == true
  return nil unless oncall['active_date'] == Time.now.strftime('%Y-%m-%d')

  started = parse_moment(oncall['shift_start_ts'])
  where = oncall['channel_name'] || oncall['channel_id'] || 'the on-call channel'
  "on-call requests in #{where}#{started ? " - since #{started.localtime.strftime('%H:%M')}" : ''}"
end

# What the card says about the user's acknowledgement, and — while the item is still
# `acked` — how to answer. Nil on an item they never acknowledged.
def ack_note(item)
  ack = item['ack']
  return nil unless ack.is_a?(Hash)

  seen = "you acknowledged it (#{ack['via'] || 'ack'})"
  return "#{seen}; you reacted :robot_face: on its ask line - loop" if ack['decided_via'] == 'reaction'
  return "#{seen}; you chose #{ack['decision']} via #{ack['decided_via'] || '?'}" if ack['decision']
  return "#{seen} - not actionable, nothing to decide" unless item['status'] == 'acked'

  number = ack.dig('ask', 'n')
  where = number ? "reply `#{number} skip|mine|loop` in the ask DM thread, or react :robot_face: on its line to dispatch" : 'ask not sent yet'
  "#{seen} - skipped unless you say otherwise: #{where}"
end

def cron_note(state)
  cron = state['cron'].is_a?(Hash) ? state['cron'] : {}
  return 'session-only cron not running - run `start`' if cron['id'].nil?

  parts = [cron['expression'], "id #{cron['id']}"].compact
  if (expiry = parse_moment(cron['expires_at']))
    remaining = expiry - Time.now
    parts << (remaining.positive? ? "expires in #{(remaining / 3600).to_i}h" : 'EXPIRED - run `start` again')
  end
  parts.join(' - ')
end

# Seven columns of one day each, oldest first, counted off first_seen_at.
def seven_day_tally(items)
  buckets = (0...TALLY_DAYS).map { |offset| (Time.now - (offset * 86_400)).strftime('%Y-%m-%d') }.reverse
  rows = buckets.map { |date| { 'date' => date, 'total' => 0, 'statuses' => Hash.new(0) } }
  index = rows.each_with_object({}) { |row, memo| memo[row['date']] = row }
  items.each_value do |item|
    date = parse_moment(item['first_seen_at'])&.strftime('%Y-%m-%d')
    row = index[date]
    next if row.nil?

    row['total'] += 1
    row['statuses'][item['status'] || 'unknown'] += 1
  end
  rows
end

def tick_lines(state)
  ticks = state['ticks']
  return [] unless ticks.is_a?(Array)

  ticks.last(TICK_LINES).reverse.map do |tick|
    if tick.is_a?(Hash)
      moment = parse_moment(tick['at'])
      { 'at' => moment ? moment.localtime.strftime('%m-%d %H:%M') : tick['at'].to_s, 'line' => tick['line'].to_s }
    else
      { 'at' => '', 'line' => tick.to_s }
    end
  end
end

# --- template ---------------------------------------------------------------

CARD = <<~'ERB'
  <article class="card status-<%= escape(item['status']) %>">
    <div class="card-head">
      <span class="badge badge-<%= escape((item['class'] || 'unclassified').downcase.gsub(/[^a-z0-9]+/, '-')) %>"><%= escape(item['class'] || 'unclassified') %></span>
      <% if item['mention'] %><span class="badge badge-mention">mention</span><% end %>
      <% if item['restarted'] %><span class="badge badge-restart">re-dispatched</span><% end %>
      <% if item['env'] && item['env'].to_s != 'local' %><span class="badge badge-env">env: <%= escape(item['env']) %></span><% end %>
      <span class="age"><%= escape(age_in_words(item_moment(item)) || '?') %></span>
    </div>
    <h4 class="card-title">
      <% if item['permalink'] %>
        <a href="<%= escape(item['permalink']) %>"><%= escape(truncate(item['title'] || key, 90)) %></a>
      <% else %>
        <%= escape(truncate(item['title'] || key, 90)) %>
      <% end %>
    </h4>
    <div class="meta">
      <span><%= escape(item['channel'] || item['channel_id']) %></span>
      <% if item['author'] %><span><%= escape(item['author']) %></span><% end %>
      <% if item['priority'] %><span>p<%= escape(item['priority']) %></span><% end %>
    </div>
    <% if item['excerpt'] && !item['excerpt'].to_s.empty? %>
      <p class="excerpt"><%= escape(truncate(item['excerpt'], 220)) %></p>
    <% end %>
    <% if item['ask'] && !item['ask'].to_s.empty? %>
      <p class="ask"><span class="ask-arrow">&gt;&gt;</span> <%= escape(item['ask']) %></p>
    <% end %>
    <% if item['reason'] && !item['reason'].to_s.empty? %>
      <p class="reason"><%= escape(item['reason']) %></p>
    <% end %>
    <% if item['linked_to'] %>
      <p class="reason">duplicate of <code><%= escape(item['linked_to']) %></code></p>
    <% end %>
    <% if (ack_text = ack_note(item)) %>
      <p class="ack-note"><%= escape(ack_text) %></p>
    <% end %>
    <dl class="facts">
      <% if item.dig('agent', 'name') %>
        <dt>agent</dt><dd><code><%= escape(item.dig('agent', 'name')) %></code></dd>
      <% end %>
      <% if item['pr'] %>
        <dt>PR</dt><dd><a href="<%= escape(item['pr']) %>"><%= escape(truncate(item['pr'].to_s.sub(%r{\Ahttps?://(www\.)?github\.com/}, ''), 48)) %></a></dd>
      <% end %>
      <% if item['worktree'] %>
        <dt>worktree</dt><dd><code><%= escape(item['worktree']) %></code></dd>
      <% end %>
      <% if item['artifacts'].is_a?(Array) && !item['artifacts'].empty? %>
        <dt>artifacts</dt>
        <dd><ul class="artifacts"><% item['artifacts'].each do |artifact| %><li><code><%= escape(artifact) %></code></li><% end %></ul></dd>
      <% end %>
      <% if item.dig('dm', 'root_ts') %>
        <dt>DM</dt><dd><code><%= escape(item.dig('dm', 'root_ts')) %></code></dd>
      <% end %>
    </dl>
    <div class="key"><code><%= escape(key) %></code></div>
  </article>
ERB

PAGE = <<~'ERB'
  <title>Firefighter Dashboard</title>
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
      <span class="sub"><%= escape(profile) %> &middot; <%= escape(day_label) %> &middot; generated <%= escape(generated_at) %></span>
    </header>

    <div class="strip">
      <div class="stat<%= agents.empty? ? '' : ' ok' %>">
        <div class="n"><%= agents.size %></div>
        <div class="k">live agents</div>
        <div class="d"><%= agents.empty? ? 'idle' : escape(agents.join(', ')) %></div>
      </div>
      <div class="stat<%= needs_you.empty? ? '' : ' alert' %>">
        <div class="n"><%= needs_you.size %></div>
        <div class="k">needs you</div>
        <div class="d"><%= needs_you.empty? ? 'nothing waiting on you' : 'act on these first' %></div>
      </div>
      <% unless your_call.empty? %>
        <div class="stat call">
          <div class="n"><%= your_call.size %></div>
          <div class="k">your call</div>
          <div class="d">acknowledged - skipped unless you say otherwise</div>
        </div>
      <% end %>
      <div class="stat ok">
        <div class="n"><%= done_count %></div>
        <div class="k">done today</div>
        <div class="d"><%= total_items %> items tracked</div>
      </div>
      <div class="stat">
        <div class="n" style="font-size:19px"><%= escape(next_fire) %></div>
        <div class="k">next fire</div>
        <div class="d"><%= escape(cron_line) %></div>
      </div>
      <% if oncall_line %>
        <div class="stat oncall">
          <div class="n" style="font-size:19px">ON CALL</div>
          <div class="k">your shift today</div>
          <div class="d"><%= escape(oncall_line) %></div>
        </div>
      <% end %>
    </div>

    <% unless needs_you.empty? %>
      <section class="needs-you">
        <h2>Needs you <span class="count">(<%= needs_you.size %>)</span></h2>
        <div class="cards">
          <% needs_you.each do |key, item| %><%= render_card(key, item) %><% end %>
        </div>
      </section>
    <% end %>

    <% unless your_call.empty? %>
      <section class="your-call">
        <h2>Acknowledged - your call <span class="count">(<%= your_call.size %>)</span></h2>
        <p class="hint">You already acknowledged these, so the loop is skipping them. Answer in the ask DM thread
          (<code>2 loop</code>, <code>all skip</code>, or react <code>:robot_face:</code> on an item's line to have the
          loop take it) or in-session, to have the loop take one or to mark it yours. A reply beats a reaction.</p>
        <div class="cards">
          <% your_call.each do |key, item| %><%= render_card(key, item) %><% end %>
        </div>
      </section>
    <% end %>

    <section>
      <h2>By status</h2>
      <% if columns.empty? %>
        <p class="empty">No items in state yet.</p>
      <% else %>
        <div class="columns">
          <% columns.each do |status, entries| %>
            <div class="column">
              <h2><%= escape(STATUS_LABELS[status] || status) %> <span class="count">(<%= entries.size %>)</span></h2>
              <div class="cards">
                <% entries.each do |key, item| %><%= render_card(key, item) %><% end %>
              </div>
            </div>
          <% end %>
        </div>
      <% end %>
    </section>

    <section>
      <h2>Last 7 days</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr><th>day</th><th>items</th><% STATUS_ORDER.each do |status| %><th><%= escape(STATUS_LABELS[status] || status) %></th><% end %></tr>
          </thead>
          <tbody>
            <% tally.each do |row| %>
              <tr>
                <td><%= escape(row['date']) %></td>
                <td class="num"><%= row['total'] %></td>
                <% STATUS_ORDER.each do |status| %><td class="num"><%= row['statuses'][status].to_i.zero? ? '&middot;' : row['statuses'][status] %></td><% end %>
              </tr>
            <% end %>
          </tbody>
        </table>
      </div>
    </section>

    <% unless ticks.empty? %>
      <section>
        <h2>Ticks <span class="count">(last <%= ticks.size %>)</span></h2>
        <div class="ticks">
          <ol>
            <% ticks.each do |tick| %>
              <li><span class="at"><%= escape(tick['at']) %></span><%= escape(tick['line']) %></li>
            <% end %>
          </ol>
        </div>
      </section>
    <% end %>
  </div>
ERB

# --- render -----------------------------------------------------------------

def render_card(key, item)
  ERB.new(CARD, trim_mode: '-').result(binding)
end

def render(state)
  items = items_of(state)
  needs_you = sorted_items(items.select { |_key, item| item['status'] == 'needs_you' })
  your_call = sorted_items(items.select { |_key, item| item['status'] == 'acked' })
  columns = STATUS_ORDER.filter_map do |status|
    entries = sorted_items(items.select { |_key, item| item['status'] == status })
    entries.empty? ? nil : [status, entries]
  end
  agents = live_agent_names(items)
  done_count = done_today(items)
  total_items = items.size
  next_fire = next_fire_label(state)
  cron_line = cron_note(state)
  oncall_line = oncall_note(state)
  tally = seven_day_tally(items)
  ticks = tick_lines(state)
  profile = state['profile'] || 'local'
  day_label = state.dig('day', 'date') || Time.now.strftime('%Y-%m-%d')
  generated_at = Time.now.localtime.strftime('%Y-%m-%d %H:%M')

  asciify(ERB.new(PAGE, trim_mode: '-').result(binding))
end

def main(argv)
  if argv.size != 2 || %w[-h --help].include?(argv.first)
    warn 'usage: ruby dashboard.rb <state.json> <out.html>'
    return 1
  end

  state_path, out_path = argv
  unless File.exist?(state_path)
    warn "dashboard.rb: no such state file: #{state_path}"
    return 1
  end

  begin
    state = JSON.parse(File.read(state_path))
  rescue JSON::ParserError => error
    warn "dashboard.rb: #{state_path} is not valid JSON (#{error.message.split("\n").first}). " \
         'Run `ff.rb get` first — it quarantines a corrupt state.'
    return 1
  end

  html = render(state)
  temp = "#{out_path}.tmp.#{Process.pid}"
  require 'fileutils'
  FileUtils.mkdir_p(File.dirname(out_path))
  File.write(temp, html)
  File.rename(temp, out_path)
  puts "wrote #{out_path} (#{html.bytesize} bytes, #{items_of(state).size} items)"
  0
end

exit(main(ARGV)) if $PROGRAM_NAME == __FILE__
