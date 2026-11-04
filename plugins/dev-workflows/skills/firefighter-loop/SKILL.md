---
name: firefighter-loop
description: Watch your chat channels (plus your @-mentions and an optional on-call rotation channel) for incoming issues in the area you own, decide what is actionable, and hand each one to an Opus agent that runs bug-intake end to end unattended — so by the time you are online each issue has a hypothesis, RCA artifacts, a drafted remediation script and often an open PR. Deduped state machine, acknowledged items parked and asked about, a dashboard; one-shot (`sweep`) or a cron loop (`start`), locally or on a cloud runner for the night shift. Use for "run the firefighter loop", "handle the night shift before I'm online", "watch our support channel and triage whatever lands", "sweep the last 24h of unacknowledged messages and dispatch agents", "start/stop the loop", "what is the firefighter loop working on". NOT for one already-identified report (bug-intake), an open PR's CI and bot comments (pr-triage), or partitioning one effort across agents (agent-team).
argument-hint: "sweep|tick|start|stop|status [--interval 5m] [--since 24h] [--dry-run] [--report-only|--approval-gated|--autonomous] [--max-dispatch N] [--profile local|cloud] [--oncall auto|on|off]"
---

# Firefighter loop — chat in, dispatched agents out

You are the traffic controller, not the investigator. Each tick: read a fixed watch set, classify
it, park what the user already acknowledged (skipped by default — but asked about), and hand each
other real issue to one **Opus** agent that owns it end to end via **bug-intake**. You never trace
code yourself, never post in a channel, never touch production. Outputs: agents, DMs to the user,
a day log, a dashboard. It runs while the user is asleep — every rule below exists to make that
safe.

**What to watch is configuration, not skill text.** Channel ids, the user's own chat id, optional
scope keywords, the optional on-call rotation, dispatch caps and the agents' repo live in
`config.json` in the state dir — the user's file (**REFERENCE §0**). Settings read: `<chat>`
(**Slack only** — the tool calls and on-call detection are Slack-specific; another chat tool needs
a port, REFERENCE §1), `<watch_channels>` (seeds the config once), `<state_repo>`,
`<sandbox_dir>`, `<sandbox_autocommit>`, `<worktrees_dir>`, `<cloud_agent>`, `<warehouse>`,
`<ops_bot>`, and — only for the untested optional sources — `<issue_tracker>`, `<error_tracker>`.

**This skill's default autonomy is `--autonomous`**, like the rest of the plugin (act, then
report) — and because it runs unattended, running the loop is itself the grant (the start banner
spells out what that covers). `--approval-gated` and `--report-only` are available below.

---

## Standing rules for unattended runs

The *only* place these apply, and only to items this loop dispatched — stated verbatim so a future
run doesn't have to re-derive them:

1. **The autonomy grant:** `sweep`/`start` without `--dry-run`/`--report-only` **is** the explicit
   per-session autonomy grant (the start banner enumerates it); nothing else inherits it.
2. **PRs open without asking:** only for dispatched items — branch in a dedicated worktree,
   commit there (committing verified work is the default everywhere, not an exception), PR
   ready-for-review with the banner + source link, **never merged / approved / rebased into
   anything**; approval moves to "before it merges".
3. **No live production access: not overridden.** Reading prod data through `<warehouse>`
   (**warehouse-data**) is allowed and preferred — agents query it directly, read-only, ahead of
   the `<ops_bot>`; it involves no chat and no human.
4. **Never post to chat:** overridden only for the lead's DMs to the user (config
   `self.dm_channel_id`, else `self.user_id`), and read-only questions to the `<ops_bot>`, if
   your team runs one, in its own channel (**warehouse-data**).
5. **Unchanged:** never the main checkout, one worktree per agent, Opus or Sonnet for agents
   (never a lighter model for an investigation), `<sandbox_dir>/adhoc/<date>-<slug>/` for
   artifacts — whose writes agents commit themselves, own paths only, never asking, when
   `<sandbox_autocommit>` is on (**sandbox-tool**); loop
   state never goes there, only to the state dir via `ff.js`. Print the banner (REFERENCE §8)
   on `sweep`/`start`, before the first dispatch.

## Hard rules

- **Chat is read-only in channels — two sanctioned writes**: the lead's DMs to the user, and
  `<ops_bot>` questions in that bot's channel (read-only questions only, lead or agent).
  Everything else stays forbidden: no reply, no reaction, no draft, no channel message anywhere
  else, from anyone.
- **Never watch DMs or group DMs.** The watch set is config's `watch.channels` plus the user's
  `@`-mentions in public/private channels — plus on-call requests in the on-call channel **on the
  user's rotation days only** (on-call mode, below). Drop any DM channel id and any `im`/`mpim`
  search hit. The one DM the loop reads is its own ❓ ask thread in the user's self-DM — for
  their answers, never as an item source.
- **Acknowledgement is the user's alone, only *after* the fact — and it parks, it never
  auto-skips:** their reaction on the evaluated message, or their reply later than it (step 4),
  turns an item that would otherwise dispatch into `acked` — skipped by default, and the user is
  asked *skip / I'll work on it / have the loop work on it* (**Acknowledged items**, below). No
  answer ⇒ it stays skipped, and stays answerable. User-authored ⇒ skip. Anyone else's reply
  never counts — still dispatch. Two things **close** an item outright, unasked, because they
  are resolutions, not acks: the **requester withdrawing their own ask** (step 4), and, **in the
  on-call channel only**, one of config's `oncall.resolved_reactions` by anyone — that
  channel's resolved convention (on-call mode, below). Nowhere else does someone else's ✅ count.
- **Never hand-edit `state.json`** — every read and write goes through `scripts/ff.js`.
  (`config.json` is the user's: edit it only with their go-ahead.) **The item key
  `<channel_id>:<ts>` is the only dedupe axis** (never a text hash — chat edits in place); a key
  already in `items` is never re-dispatched, in any status (an `acked` item the user answers
  `loop` gets its *first* dispatch). Watermarks advance only after items are persisted, never
  after a failed tick.
- **One `opus` agent per issue**; Sonnet only for the bulk-classifier escape hatch (step 5).
  **Revive, don't respawn** — follow-ups go to the owning agent by name via `SendMessage`.
- **Idle ≠ done.** An idle notification is not a report; read `verification-notes.md` and the
  diff before believing anything.
- **Never claim a cloud run proved something locally.** Profile is stamped on every DM and card.
- **Never guess an outward-facing value.** A channel id, the user's id, the DM target, the repo
  agents push to: from config, or asked for once — never inferred.

---

## Modes

| Mode | Behavior |
|---|---|
| `sweep` *(default)* | Init state if absent; check config; backfill `--since 24h`; classify → ask the user in-session about anything they acknowledged that would dispatch → dispatch → DM → log → publish dashboard → terminal summary. Sets watermarks. No cron. |
| `tick` | One incremental pass from the stored watermarks. This is what the cron fires. |
| `start [--interval 5m]` | Runs `sweep` first (seeds watermarks so tick 1 isn't a replay), then arms the cron. Prints the session-only + 7-day-expiry caveat. `--interval` 5m/10m/15m; anything under 5m is refused. |
| `stop` | `CronDelete`; reports agents still live (does **not** kill them). |
| `status` | State summary + `CronList` + the on-call line (`ff.js oncall status`) + open asks (`ff.js asks`) + `ff.js config check`. State claims a cron but `CronList` is empty ⇒ "session restarted; run `start` again". |

**`--oncall auto|on|off`** (default `auto` when config has an on-call channel, else `off`) gates
the on-call watch — see **On-call mode** below. Morning routine: `sweep`, then `start`.
**Autonomy:** `--autonomous` is this skill's default (see above) — running it *is* the grant.
`--approval-gated` DMs a proposed dispatch and holds. `--report-only` classifies and logs only: no
agents, no DMs. **`--dry-run` = `--report-only` + a scratch state dir** — `ff.js --dry-run`
redirects state *and* day dirs to `<state-dir>/dryrun/` (config is still read from the real state
dir), so a rehearsal writes real LOG rows and tick traces (header marked `DRY RUN`) while live
state is untouched, and never publishes the dashboard; `init --dry-run --force` resets it
(**REFERENCE §4**).

### First run — config before anything else

`ff.js init` writes a `config.json` template beside `state.json` if none exists. Every `sweep` and
`start` runs `ff.js config check` first; if it fails, **stop and set it up with the user** — never
start watching on a guess:

1. Seed `watch.channels` from the `<watch_channels>` setting if present; resolve each name to its
   id read-only (`slack_search_channels`). Seed `self.user_id` from the user's own profile
   (`slack_search_users` on their name/email, or ask).
2. Ask for anything still missing (`AskUserQuestion`): the channels, the one-line `watch.area`,
   optional `watch.keywords`, the repo agents work in (`dispatch.repo`), and whether there is an
   on-call rotation (channel, group handle, the bot that announces it).
3. Show the resulting JSON, write it only on their OK, and re-run `config check`. It must pass —
   it requires `self.user_id`, at least one channel, `watch.area` and a `dispatch.repo` that is a
   git checkout (`config check --report-only` waives the repo). On-call needs no extra step: its
   mode follows the config at read time, so filling in the `oncall` block after `init` is enough.

---

## State

**The state dir defaults to `~/.local/state/firefighter-loop/`** (`$FF_STATE_DIR` /
`--state-dir` override). To share one history with an off-laptop runner, make it a clone of a
private `<state_repo>` in both places — `ff.js sync` then commits and pushes it at the end of
every tick. It holds `config.json`, `state.json`, `days/<YYYY-MM-DD>/LOG.md`, `dashboard.html` and
(cloud only) `artifacts/`. Never the scratchpad, which is wiped on restart. Schema: **REFERENCE §4**.

```bash
S=<this skill's base directory>/scripts   # shown when the skill loads; for an installed plugin
                                          # it lives under ~/.claude/plugins/
node $S/ff.js init [--profile local|cloud] [--force]    # create state dir + state.json (+ config template)
node $S/ff.js config [--json] | config check | config init   # the user's watch config
node $S/ff.js set <dotted.key> <value>                  # profile scheduler mode interval cron
                                                        # dashboard channels — nothing else
node $S/ff.js get [<item key>|<dotted.key>] [--status S] [--json]   # an arg with ':' is an item
node $S/ff.js summary                                   # counts, live agents, watermarks, cron
node $S/ff.js verify                                    # schema check; exit 1 if anything is off
node $S/ff.js lease acquire [--holder NAME]             # exit 1 ⇒ another tick holds it
node $S/ff.js lease release
node $S/ff.js oncall status|auto|on|off                 # rotation mode (`on` = today only)
node $S/ff.js oncall active <shift_start_ts> | oncall inactive   # each tick's detection;
                                                        # `active` prints transition=true on the DM tick
node $S/ff.js watermark <channel_id|mentions> <ts|date> # advance one watermark
node $S/ff.js upsert <key> --json '<partial item>'      # deep-merge; arrays replace wholesale
node $S/ff.js link <key> <owner_key>                    # mark an item a duplicate of a live one
node $S/ff.js asks [--json]                             # acked items awaiting the user, by ask thread
node $S/ff.js decide <key> skip|mine|loop [--via dm|session|cli] [--answer-ts <reply ts>]
node $S/ff.js log-append --json '<row>' | --tick '<line>'
node $S/ff.js rollover                                  # move the day pointer, mkdir the day dir
node $S/ff.js sync '<commit message>'                   # pull --rebase → scoped commit → push
```

At `sweep`/`start`, `set` the keys the LOG header reads — `mode`, `profile`, `scheduler`,
`cron.id`, plus **`interval` only on the loop** (`start`/`tick`; a `sweep` header renders
`interval: n/a (sweep)` itself — don't invent one) — **before** the day's first `log-append`;
`ff.js` writes most of that header once, when it creates the file. The `channels:` line comes
from config's `watch.channels` unless `set channels` overrides it. `dashboard.url` is the one
exception — it's not required before the first append, because it typically doesn't exist yet
(day 1's first publish hasn't happened): `cron:` and `dashboard:` are re-derived from current
state and rewritten in place on *every* `log-append`, so a day-1 header that started
`(unpublished)`/`(none)` self-heals once you `set` them (**REFERENCE §5**).

Full help: `node $S/ff.js --help`. `--state-dir DIR` / `--day-dir DIR` / `--config FILE`
override the locations (env `FF_STATE_DIR` / `FF_DAY_DIR` / `FF_CONFIG`); **the day dir is
derived from the resolved state dir** (`<state-dir>/days/<date>`), so moving the state moves its
logs with it and the two can never end up in different repos. A cloud run just points
`--state-dir` at its own clone of the same repo. Writes are temp-file + rename, so a reader never
sees a half-file — but a run of `upsert`s is still read-modify-write, so **hold the lease for the
whole tick**, not just each write. **Exit 1** = usage error, unsettable key, lease held, or
`verify`/`config check` found problems. **Exit 2** = `state.json` was unparseable: already
quarantined to `state.json.corrupt-<epoch>` and re-inited — DM the loss and **do not
auto-backfill**.

---

## The tick

Cost when idle: **one channel read per watched channel (+1 for the on-call channel while on-call
mode isn't `off`) + 1 mention search + one thread poll per live item** (≤ `dispatch.live_cap`,
only `dispatched`/`in_progress`/`paused`/`needs_you`) **+ one thread read per distinct mention
thread (deduped by parent ts) + a reaction probe only when the thread read didn't settle it + one
read per ❓ ask thread that still has an open item and is ≤7 days old** (one thread a day, so
usually 0–1; ask reactions ride along in that read) — no agents, one terminal line. Measured
lesson, from a backfill sweep run *before* the noise-first / probe-until-acked fix below: thread
reads plus reaction probes outnumbered the messages themselves, and most of the reaction probes
were spent on praise that happened to mention the user.

**Remaining cost floor: COORDINATION and other non-engineering items still cost an ack probe
apiece.** Step 4 (probe-until-acked) runs *before* step 5 (classify) — the thread it reads is also
classification input and the self-resolved gate's evidence — so a "legal says the review lands
Friday" hit still pays its thread read (and, if that didn't settle it, its reaction probe):
~2 calls each, not free just because the class turns out to be a drop. The ack itself drops
nothing; it only decides `acked` vs dispatch once the class is known.

**Load the deferred tools once, before step 1** (`chat: slack`):

```
ToolSearch 'select:mcp__claude_ai_Slack__slack_read_channel,mcp__claude_ai_Slack__slack_read_thread,mcp__claude_ai_Slack__slack_get_reactions,mcp__claude_ai_Slack__slack_search_public_and_private,mcp__claude_ai_Slack__slack_send_message,mcp__claude_ai_Slack__slack_read_file'
ToolSearch 'select:CronCreate,CronList,CronDelete,SendMessage,TaskStop'
```

1. **Lease.** `ff.js lease acquire`; exit 1 = a fresh lease is held by another tick, exit silently.
   A lease older than 15 min `ff.js` clears and retakes itself; never delete `lease.lock` by hand.
   Then `ff.js rollover` for the day dir + `LOG.md`, and `ff.js config --json` for this tick's
   watch set, user id, keywords, on-call block and caps. Hold the lease until step 9.

2. **Read.** Every `watch.channels` entry, then the on-call channel (unless on-call is `off`), then
   the mention search. Runtime profile probe first (below).

   ```jsonc
   slack_read_channel {"channel_id": "<watch channel id>", "oldest": "<watermark_ts>", "limit": 100,
                       "response_format": "detailed"}   // × every watched channel
   slack_read_channel {"channel_id": "<oncall.channel_id>", "oldest": "<now−30h>", "limit": 50,
                       "response_format": "detailed"}   // on-call detection + requests
   slack_search_public_and_private {
     "query": "<@SELF_USER_ID> -from:<@SELF_USER_ID> after:<yesterday YYYY-MM-DD>",
     "sort": "timestamp", "sort_dir": "desc",
     "channel_types": "public_channel,private_channel", "limit": 20 }
   ```

   Drop any result whose channel is a DM/im/mpim and any user-authored result. Mentions are
   **not** allowlisted to the watched channels — a mention anywhere except a DM is in scope. But
   `after:` is **date**-granular, so the search window is wider than `--since`: **clip hits
   client-side to `ts >= (now − <since>)`**. An older hit is **tally only** — one `LOG.md`
   tick-line count plus the terminal summary — never probed, never dispatched, and **never `ff.js
   upsert`'d into `items`**: the 24h backfill window applies to mentions too, but persisting an
   out-of-window key would poison it forever under the "a key in `items` is never re-dispatched"
   invariant, so a later wider sweep (`--since 48h`, a backfill) could never pick it back up
   (REFERENCE §1b).

3. **Filter cheapest-first, before any probe**, logging every drop: user-authored ⇒ skip; praise /
   thanks / congrats / bot / `has joined` / empty ⇒ NOISE **even when it mentions the user** —
   noise is never worth a probe; a channel *reply* that is neither a mention nor on a live item ⇒
   skip. **If `watch.keywords` is non-empty**, a channel item (not a mention, not an on-call
   request) that matches none of them, case-insensitively, is `out of scope` ⇒ tally only — use
   keywords for a broad shared channel where only some traffic is yours; leave them empty for a
   channel that is all yours.

4. **Acknowledgement — probe until acked, cheapest probe first.** From a **channel read**, probe
   only on a signal (the main cost control): `Reactions:` ⇒ `slack_get_reactions {"channel_id": …,
   "message_ts": …}`; `Thread: N replies` ⇒ `slack_read_thread {"channel_id": …, "message_ts":
   "<parent ts>", "response_format": "detailed"}` (fold the thread text into the item). From the
   **mention search**, which carries neither field: **thread read first** — it settles most
   mentions via the reply-after rule and hands you the thread text anyway — then
   `slack_get_reactions` **only if that read did not acknowledge**. Always `detailed`, never
   `concise`. **Dedupe thread reads by `<channel_id>:<parent ts>` across the whole pass** — mention
   hits, channel items and step 7's polls share one read per thread.
   **Temporal rule.** The *evaluated message* is the root for a top-level item, the **mention's
   own message** for a mention that landed in a reply. A user **reply** acknowledges only if its
   ts is **strictly later** than the evaluated message's ts; a user **reaction** counts only on
   the evaluated message **itself** (a reaction on the root never acks a mention in reply 12).
   Then the item is **acknowledged** — note `ack: {via: reaction|reply, ts, excerpt}` (their
   reply, ≤80 chars) and carry it on to step 5. It is **not** dropped here (**Acknowledged
   items**, below). Anyone else's reply never counts.
   **On-call channel only:** a count on the root for any of `oncall.resolved_reactions` ⇒
   `ignored`, `reason: "resolved (✅ on-call convention)"`, decided off the channel read — **zero
   probes**, never asked about: it is a resolution, not an acknowledgement.
   `oncall.in_progress_reactions` close nothing; probe as usual (the user's own in-progress
   reaction is an ordinary ack ⇒ `acked`).
   **Self-resolved / withdrawn** — the one close somebody other than the user can make. In that
   same thread text, if the **original requester** (or the person the ask is for) explicitly
   withdrew it or confirmed resolution — "nevermind", "figured it out", "I'll do X instead, thank
   you", "that worked", "resolved" — ⇒ `ignored`, `reason: "self-resolved (<quote ≤80 chars>)"`,
   logged, **no dispatch, no DM**. Only their own words close it, and only after the ask; a third
   party's "looks fixed" does not. **When in doubt, dispatch** — the agent's Phase 0 closes it
   cheaply, whereas a wrongly-ignored fire is silent all night (REFERENCE §1c, §6).

5. **Classify** from the text you already have (table below), with config's `watch.area` as the
   hint for what is engineering-in-scope. Escalate to a *single* Sonnet classifier only when >10
   unclassified survivors remain in one pass — realistically only sweep 1. An acknowledged item
   whose class (mention/on-call promotion included) would dispatch ⇒ `ff.js upsert` it `status:
   acked` with its `ack` block — no agent, no step 8 (step 6 may still link it to a live
   duplicate, which closes the question). One that would not dispatch takes its usual log-only /
   `ignored` path, `note: acked`, and is never asked about.

6. **Duplicate root cause** — same admin URL, record id, or error string as a live item ⇒ `ff.js
   link`, `status: linked`, and `SendMessage` the owning agent the new permalink instead of
   spawning a second one (agent-team's contended-resource rule).

7. **Thread deltas — poll each open item's own thread.** A watermarked channel read returns only
   *roots inside the window* and so can **not** detect a reply on an older root (REFERENCE §1c-bis).
   For every `dispatched`/`in_progress`/`paused`/`needs_you` item: `slack_read_thread {"channel_id":
   …, "message_ts": "<root ts>", "oldest": "<last_reply_ts_seen>"}` — one poll per item (ceiling =
   the live cap), reusing the pass's deduped read when that thread was already fetched. New
   replies ⇒ `SendMessage` the delta to the owning agent (revive, never respawn); on a `needs_you`
   item a **user** reply *is* their input — relay it into the item's DM thread and act on it
   (someone else's is context only). Advance `last_reply_ts_seen` in the same `upsert`. No new
   reply for **>7 days** ⇒ `done` (`reason: "stale — no thread activity 7d"`), out of the poll set.
   **Ask answers:** `ff.js asks --json`; for each thread with `poll: true`, one `slack_read_thread`
   and `ff.js decide` per answer found — reply answers first, then ask reactions (**Acknowledged
   items**, below). A `loop` lands in this tick's step 8. On a foreground `sweep`, the in-session
   ask happens here too.

8. **Dispatch** in priority order: `mention` and `oncall` items share the top tier, then INCIDENT,
   OPERATIONAL, QUESTION, REVIEW_FEEDBACK; FIFO within a class. `--max-dispatch` defaults to
   config `dispatch.max_per_tick` (3) per tick (`dispatch.max_initial_sweep`, 6, on the initial
   sweep). Hard ceiling `dispatch.live_cap` (8) live agents — the session's subagent cap is
   higher; leave headroom. Over cap ⇒ items stay `new` and the summary says "N queued". `new`
   includes queued items from earlier ticks and any `acked` item the user answered `loop`.

9. **Close out, in this order:** persist items → send pickup DMs, then one ❓ ask line per item
   newly parked `acked` (plus the day's header root first, if none yet), serially from the lead →
   advance watermarks → append `LOG.md` rows → regenerate + republish the dashboard *only if
   something changed* → **`node $S/ff.js sync "tick <UTC ts>: <n> new, <n> dispatched"`** →
   release the lease → print one summary line (`· N awaiting your call` while any item is `acked`):
   `firefighter tick 09:15 — 0 new (billing-support: 1 acked, 3 noise) · 1 awaiting your call · 3 live · next 09:20`

   **`sync` is part of the local cycle too, not just the cloud one** — when the state dir is a
   `<state_repo>` clone in both profiles, every tick ends by publishing it. It no-ops with a
   notice when the dir isn't a git repo or nothing changed, and `pull --rebase --autostash`es
   first, so a cloud run's commits land underneath yours. The watermark advance stays *before*
   `sync` on purpose: the pushed commit has to carry it, or the next cloud run replays the window.

   **Exit 1 = the push failed.** Put the watermarks back where the tick found them — note them
   before step 9, and restore each channel's with `ff.js watermark <ch> --forget` then `ff.js
   watermark <ch> <old_ts>` (a plain `watermark` refuses to move backwards by design; the
   `mentions` watermark is exempt and needs no restore — REFERENCE §4). Say so in the tick line
   (`… · SYNC FAILED — watermarks held`) and DM it. The next tick redoes the window; the item key
   dedupes. Never `push --force` to get past it — that discards a concurrent run's items.

### Optional sources — issue tracker and error tracker *(untested extension)*

The loop was built and run on chat only. If the user wants `<issue_tracker>` or `<error_tracker>`
watched too, the state machine already supports it — the item key is any `<source>:<id>` with
one colon (`issues:ABC-123`, `errors:3907`), the source name doubling as the watermark key. Read
new/updated issues since the watermark (assigned to the user, or in a configured project/label),
treat the user's own comment or self-assignment as the acknowledgement (temporal rule unchanged),
the reporter closing it as self-resolved, and dispatch with the issue URL as the permalink. Say
it is untested in the start banner, run it `--report-only` for a few days first, and never write
to the tracker (no comment, no status change) — the same read-only rule as chat.

---

## Acknowledged items — skipped by default, asked once

An acknowledgement **parks** an item that would otherwise have been dispatched in `acked`: skipped
unless the user says otherwise, with the choice put to them once — **skip** (the default),
**mine** ("I'll work on it myself"), or **loop** ("have the loop work on it": dispatched exactly
as an unacknowledged item would be).

- **Asked about:** only an item step 5 would dispatch — INCIDENT, OPERATIONAL, QUESTION,
  REVIEW_FEEDBACK, or a FEATURE/COORDINATION promoted by a mention/on-call tag. Never NOISE, an
  unpromoted FEATURE/COORDINATION, a self-resolved or reaction-resolved item, a user-authored
  one, or one step 6 linked to a live duplicate. `acked` is not live: no agent, no thread poll, no
  cap slot.
- **In-session, when the user is at the keyboard** — a foreground `sweep` they typed only: never
  a cron `tick` or `start` (the cron fires only while the REPL is idle, so a pending prompt would
  stall the loop), never a cloud run. After step 7, persist the `acked` items first, then
  `AskUserQuestion` (load it with `ToolSearch` if deferred), ≤4 items per call, options **Skip
  (default)** / **I'll work on it myself** / **Have the loop work on it**, each labeled with the
  title, class, permalink and their ack. Record each answer with `ff.js decide <key>
  <skip|mine|loop> --via session`; anything left unanswered falls through to the DM.
- **By DM otherwise** — one **❓ ask thread per day** in the user's self-DM (**REFERENCE §3d**):
  the day's first ask posts a header root, and **each item is its own one-line threaded reply**,
  so a reaction on it names exactly one item. Items are numbered in order (`ff.js asks` gives
  today's thread and the next number); lines go out in step 9 and count toward the DM budget;
  record `ack.ask {channel_id, thread_ts, ts, n}` on each item, `ts` being its own line.
- **Reading the answer, every tick (step 7).** `ff.js asks --json`; each thread with `poll: true`
  (an open item, ≤7 days old) costs one `slack_read_thread`, which carries both answer kinds:
  - a **reply** matching `<n|all> skip|mine|loop` (grammar **REFERENCE §1h**) ⇒ `ff.js decide
    <key> <answer> --via dm --answer-ts <reply ts>`;
  - the **ask reaction** (config `asks.reaction`, default 🤖 `robot_face`) **on an open item's
    line** ⇒ `loop`: `ff.js decide <key> loop --via reaction --answer-ts <that line's ts>`. The
    self-DM has one member, so the count is enough. Only if the thread read turns out to show no
    reactions at all, fall back to one `slack_get_reactions` per entry of `asks --json` →
    `reaction_probes` (open items' lines only).
  - **A reply beats a reaction**, whichever came first: apply replies, then reactions; `decide`
    stamps a reaction with its ask line's ts, so it never overrides a reply, session or CLI
    answer. To turn a `skip` into a dispatch the user replies `<n> loop`.

  The whole thread is re-read each tick; `--answer-ts` makes a replayed or superseded answer a
  no-op, so applying every match is safe.
- **Outcomes.** `skip` ⇒ `ignored`. `mine` ⇒ `user_owns` — closed and shown on the dashboard as
  theirs, though a newer `<n> loop` reply can still reopen it while no agent has started. `loop` ⇒ `new`, dispatched in that tick's step 8 under the normal caps, with the brief
  saying they acknowledged it and asked for it anyway (**REFERENCE §2**). **Silence ⇒ it stays
  `acked`**: skipped, and answerable. After 7 days the thread is no longer polled, but `ff.js
  decide` and an in-session answer still work. A change of mind before dispatch is just a newer
  reply; once an agent owns it, `decide` refuses — for a reply and a reaction alike, so nothing is
  ever dispatched twice, and nothing answers an item before it was asked (a reaction must sit on
  the item's own line; a reply must be later than it).
- **Autonomy flags.** `--report-only`/`--dry-run`: record `acked`, never ask. `--approval-gated`:
  a `loop` answer is the approval — no second proposal DM.

---

## On-call mode — tagged requests in the on-call channel, on the user's rotation days only

Optional: configured by config's `oncall` block (channel, group handle, the rotation bot, the
resolved / in-progress reactions). Without an `oncall.channel_id` it is `off` and costs nothing.
`--oncall auto|on|off`. On-call is a rotation, so **detection gates everything**: working the
on-call queue on someone else's day means triaging their shift.

- **Detect (auto).** One extra on-call channel read per tick — call shape and the rule in
  **REFERENCE §1g**. Active **iff the newest message from `oncall.rotation_bot_id` *today* names
  the user**, ignoring any announcement that was struck through, edited away or superseded by a
  later one. That message's ts is the **shift start**. Record it each tick: `ff.js oncall active <ts>`, else `ff.js oncall
  inactive`. No `rotation_bot_id` configured ⇒ `auto` can't detect; use `on`.
- **Shift window.** `shift_start` → now, ending early at the user's own sign-off (whatever the
  team's convention is) if they posted one (what follows is the next person's).
  Items = **top-level** on-call-channel messages containing the handle (Slack renders a user
  group as `<!subteam^SXXXX>`) with `ts >= max(on-call watermark, shift_start)`, user-authored
  excluded as everywhere; `sweep`'s 24h backfill is **clipped to the shift window** too.
  Untagged traffic there is out of scope (the mention search already covers personal mentions),
  and rotation-bot posts plus hand-off chatter are NOISE (step 3).
- **A resolved reaction closes it, from anyone** — the on-call-channel-only resolution rule,
  decided in step 4, no probe, never asked about: it means the request was *done*, not merely
  seen. The user's own in-progress reaction or reply on a request is an ordinary ack ⇒ `acked`,
  and asked.
- **Priority.** On-call items carry `oncall: true`, priority 1, and share the top dispatch tier
  with `mention` — it's the user's duty of the day. Classes and routes unchanged; an on-call
  request to change production state gets a **drafted** prod-script repair plus the steps to apply
  it (through a console or admin, when the project has them) — never a run.
- **Forcing and expiry.** `--oncall on` is the user asserting "I'm on call" (`ff.js oncall on`,
  **today only**); `off` never reads the channel. `ff.js rollover` clears the day's activation and
  turns a forced `on` back to `auto`, so **the loop never inherits someone else's shift on a later
  day**.
- **One DM, once.** On the auto tick that flips inactive→active (`ff.js oncall active` prints
  `transition=true`), the lead DMs `On-call mode active for today — watching <channel>` plus
  the shift-start time. Never per tick; deactivation is a tick-summary note, never a DM.

---

## Classification & routing

| Class | Typical examples (invented) | Route |
|---|---|---|
| **INCIDENT / BUG** | the CSV export does nothing for one plan since a deploy; a screen recording of a date picker jumping a month; an error-tracker spike on a nightly job; overlapping text in a rendered receipt; a third-party tax-rate lookup returning 0% | `bug-intake <permalink> --autonomous --to fix` |
| **OPERATIONAL REQUEST** | "can you extend this trial by two weeks"; "a partner leaked their API key — revoke it and issue a new one"; *(on-call)* "a beta flag is stuck on for this workspace, please turn it off" | `bug-intake --autonomous --to remediate` → a **drafted** `prod-script` repair (DRY_RUN, blast radius, rollback) plus the steps to apply it. The agent never runs it. |
| **QUESTION** | "how long do we keep audit-log entries for deleted users?"; "support thinks refunds always go back to the original card — right?"; "how big a job would SAML SSO be?" | `bug-intake --autonomous --to verdict` → `reply-draft.md` in the day dir; the user posts it |
| **REVIEW FEEDBACK on the user's PR** | a reviewer's comment: "this migration isn't reversible — intended?" | verification-only agent under pr-triage's report-only discipline → `needs_you`. Never pushes to the user's PR. |
| **FEATURE / PRODUCT** | "it'd be great if invoices could be scheduled for the first of the month" | log only; rolled into the daily summary DM |
| **NON-ENGINEERING COORDINATION** | "can finance confirm the quarter-end numbers with this customer?"; "marketing wants the launch copy reviewed by Thursday" | `ignored (not engineering)` |
| **NOISE** | praise, thanks, congrats, bots, joins, empty | tally only — dropped in step 3, **never probed**, even when it mentions the user |

A mention **never changes the class**: it forces priority 1, makes FEATURE and COORDINATION
dispatch as QUESTION (a reply is owed), and always produces a pickup DM. An on-call request
behaves the same way (worked examples: **REFERENCE §6**). Ambiguous ⇒ pick the **cheaper**
class; the agent escalates itself if the trace proves a defect.

---

## Dispatch

`Agent(subagent_type: "general-purpose", model: "opus", description: "ff-<slug>",
prompt: <REFERENCE §2 brief>)`

- **Name every agent `ff-<slug>`** and record the returned name **and** id in
  `items[<key>].agent`. `SendMessage` addresses by name; `TaskStop` takes the id.
- **One worktree per agent, created and provisioned by the lead** before spawning, following
  **worktree-create**: the branch `<dispatch.branch_prefix><slug>` off the default branch at
  `<worktrees_dir>/ff-<slug>` (`<worktrees_dir>` defaults to `<repo>/.worktrees`), then its
  provisioning checklist — env files linked (never read), dependencies installed, a
  collision-free port, and an isolated database when the agent will rehearse writes. A bare `git
  worktree add` gives source files only, and the brief tells the agent to run the app and specs
  there. Absolute paths everywhere in the brief — an agent's Bash cwd resets to the main checkout
  between calls.
- **Caps:** `dispatch.max_per_tick` per tick (`max_initial_sweep` on the initial sweep),
  `dispatch.live_cap` live agents, hard refusal past `dispatch.hard_cap`.
- **Duplicate root cause ⇒ link, don't spawn** (`SendMessage` the owner the new permalink, item
  ⇒ `linked`); **new thread replies ⇒ forward to the owner.** Never two agents on one thread.
- **`--approval-gated`:** DM the proposed dispatch (class, brief summary, what it may do) and
  hold; dispatch on the user's reply next tick.
- **The fix itself goes to the `<cloud_agent>` by default when one is configured** (bug-intake
  Phase 5 → **cloud-agent-work**). The dispatched agent writes the task brief carrying this loop's
  banner and the same no-prod / no-chat / never-merge clauses, dispatches it, and puts the task
  URL in its report and `verification-notes.md`. It arms **no watch cron of its own** — the lead's
  tick is the one watcher: for each live item whose agent reported a task, check the task, and
  when the PR lands run cloud-agent-work §7's verification before the "done" DM. The lead then
  keeps doing cloud-agent-work §5 Phase B at the tick's cadence until the PR settles (green,
  resolved and quiet; merged/closed; blocked on the user; or stalled), then drops it from the tick
  — verify each CI failure, comment and task commit, and steer the task within the dispatched
  brief (cloud-agent-work §6). It never pushes to that PR,
  which is why this is compatible with the brief's `pr-triage --report-only`. A local fix in the
  agent's worktree stays the fallback when the repro depends on that worktree's data, and is the
  only path when `<cloud_agent>` is `none`. In the cloud profile the cloud agent is the upgrade
  path: the task drives a real app, so its PR is not `UNVERIFIED in-app`.

The full brief template is **REFERENCE §2**. Its non-negotiable clauses: chat strictly read-only
(the lead owns every DM); no live production ever — prod reads go to `<warehouse>` first
(**warehouse-data**), then the `<ops_bot>` if one exists; scripts drafted only, each rehearsed
locally first (**prod-script**'s rehearsal phase, rollback-wrapped if it writes) or labeled
`[UNREHEARSED]`, facts the warehouse and the bot can't supply labeled `[PENDING — needs prod
script <path>]` and the trace continues on its best hypothesis; a NEVER-touch list (other
worktrees, the main checkout, lockfiles, `.env*`, the shared dev port, the shared browser
profile, the shared test DB); any PR opened **ready for review** by `ship-pr --autonomous` with
the canonical banner as the first lines of its description —

```
> [!WARNING]
> Opened autonomously by /firefighter-loop from <permalink>. Not yet reviewed by a human — the agent will not merge or approve it.
```

(plus `UNVERIFIED in-app (cloud run)` as a second line only for a cloud run that couldn't drive
the app) — then `pr-triage --report-only`,
never merged/approved/reviewer-requested and never one of the user's own; every pause ⇒
`SendMessage main` at once; the report also written to `<worktree>/verification-notes.md`. **The
lead verifies before the "done" DM** — the diff, the linter, the touched specs. Never relay a
claim (**agent-team**).

---

## DM protocol

One DM thread per item: `slack_send_message {"channel_id": "<DM target>", "message": …}` for the
pickup, follow-ups with `"thread_ts": "<dm.root_ts>"` (shapes **REFERENCE §1e**, templates **§3**).
The DM target is config `self.dm_channel_id`, else `self.user_id`.

- **Pickup** (`🔥 Picked up:`) — first line machine-readable, so a stateless cloud run can rebuild
  `items` from the last 24h of self-DMs. **Pause / terminal** — `⏸ Needs you` | `✅ Done` |
  `⚠️ Blocked`, ending in one imperative ask.
- **Ask** (`❓ You acknowledged these — skipping unless you say otherwise`) — the day's one thread
  for `acked` items: a header root, then one numbered one-line reply per item carrying
  `<channel_id>:<ts>`, answered in-thread or with the ask reaction on the line (**REFERENCE
  §3d**). An item answered in-session never gets one.
- No DMs for `ignored`/log-only items — they appear once, in the sweep or daily summary DM
  (**REFERENCE §7**). ≤1 DM per item per state transition and per ~10 min; ≤20/hour, else digest.
  The one item-less DM is the on-call activation notice, once a day (**REFERENCE §3c**).
- Every DM carries the permalink and the profile stamp (`env: cloud`), and is sent **serially, by
  the lead, at tick end** — never by an agent.

---

## Log & dashboard

`<state dir>/days/<YYYY-MM-DD>/LOG.md`, written via `ff.js log-append`, which emits the header
itself on first write — date (+ `[DRY RUN]`), mode, interval, profile, scheduler, cron, channels,
dashboard url, state path, all read from state/config, so `set` them first. Then the item table
`| time | ch | from | class | status | item | agent | artifacts | note |` (`item` is a markdown
link to the permalink; those nine keys plus **`ts`** are what `log-append --json` takes —
**always pass the evaluated message's `ts`**: not a column, it dates the `time` cell `MM-DD
HH:MM` when the row isn't from today, which a multi-day sweep needs). Then one `## Ticks` trace
line **per tick**, `HH:MM` — a silent loop must differ from a dead one. Format: **REFERENCE §5**.

```bash
R=${FF_STATE_DIR:-~/.local/state/firefighter-loop}
node $S/dashboard.js $R/state.json $R/dashboard.html
```

Then publish with `Artifact` (icon `fire` on the first publish). **Once `dashboard.url` is set,
pass it as the `url:` parameter on every publish** — that, not the file path, is what pins the
artifact, so the URL survives a path move and any change of session. First publish only: no
`url`, then record the one you get with `ff.js set dashboard.url <url>`. Republish only when an
item changed status, and always after `sweep`/`start`/`stop`. Fragment-form, theme-aware,
non-ASCII normalized: a status strip (live / needs-you / your call / done today / next fire / on
call), a "Needs you" then an "Acknowledged - your call" section, a column per status, one card per
item, 7-day tally, last 20 ticks. The page's `<title>` lives in `dashboard.js` (not an `Artifact`
`title` param, which is inert once the file has its own `<title>`) — keep it, and the icon, stable
across redeploys.

---

## Cron mechanics & restart

Call shapes and the off-minute expression per interval: **REFERENCE §1f**. `CronCreate {"cron":
"2-59/5 * * * *", "prompt": "/dev-workflows:firefighter-loop tick", "recurring": true}` →
store the returned id in `state.cron.id`; `CronList {}` verifies it; `CronDelete` stops it.

- **Session-only** and **auto-expiring after 7 days** in the build this was written against —
  check your build — warn in the summary when under 24h remain.
- **Fires only while the REPL is idle**, with ~10% jitter. Use an off-minute schedule
  (`2-59/5`, `3-59/10`, `4-59/15`) so it doesn't collide with every other on-the-minute job.
- `status` reconciles: state claims a cron, `CronList` is empty ⇒ say "session restarted; run
  `start` again" rather than assuming the loop is alive.

**Restart rule.** Agents die with the session; state doesn't. On the first tick after a restart,
items in `dispatched`/`in_progress` whose agent is no longer live are **re-dispatched once**
(`restarted: true`, day-dir artifacts + `verification-notes.md` handed over as a head start) and
listed in **one** DM. A second loss ⇒ `needs_you`, worktree surfaced. Never a third dispatch.

---

## Runtime profile

Probe first thing in every `sweep`/`tick`: **local** when config's `dispatch.repo`, Docker (if
the repo's dev stack uses it) and `<sandbox_dir>` all exist; otherwise **cloud**. `--profile
local|cloud` overrides (and `ff.js init --profile` / `set profile` records it). Print it at start,
stamp every DM and card.

| | local | cloud |
|---|---|---|
| State dir | `~/.local/state/firefighter-loop/`, or a local clone of `<state_repo>` | that run's own clone of `<state_repo>` (`ff.js --state-dir`) — required |
| Sync | every tick ends `ff.js sync '<msg>'` = `pull --rebase --autostash` → one scoped commit → `push` (a no-op without a repo); a failed push (exit 1) does **not** advance watermarks | identical |
| Scheduler | `CronCreate` 5-min tick | the platform's own schedule fires `… firefighter-loop sweep --since 2h --profile cloud` hourly; the 2h window overlaps the previous fire and the item key dedupes |
| Depth | full | reduced — see the degradation table |

**Non-local environment? Load the `cloud-runtime` skill** — it owns the degradation table (what
`worktree-create`, `verify-in-app --depth browser`, `dev-doctor`, a local runner script and
`render-pipeline-debug` become in the cloud), the `[UNVERIFIED — needs local repro]` /
`UNVERIFIED in-app (cloud run)` labels, and the platform trial checklist. A ready-to-adapt routine
body: `scripts/routine.example.json`. **Ledger fallback:** state repo unreachable ⇒ rebuild
`items` from 24h of self-DM pickup first lines, watermarks at `now−24h`.

---

## Failure modes

| Symptom | Response |
|---|---|
| Chat MCP down / auth expired | Do **not** advance watermarks; mark the tick failed. After 2 consecutive failures, `CronDelete` + DM "firefighter stopped — re-auth and run `start`". |
| `ff.js config check` fails | Don't tick. Locally: set it up with the user (First run, above). Cloud/cron: log it, DM it once, stop. |
| Two ticks overlap | The lease. `lease acquire` exit 1 ⇒ exit silently; a >15 min lease `ff.js` clears and retakes on its own. |
| Agent idle with no report | Ping **once** naming the missing fields; then read `verification-notes.md` + `git -C <worktree> diff` yourself; `TaskStop` on a second idle. Idle ≠ done ⇒ `needs_you`. |
| More than the live cap | Queue; say "N queued" in the summary. Hard-refuse past `hard_cap`. |
| Message deleted upstream | `ignored (deleted upstream)`; stand the agent down with `SendMessage`. |
| `state.json` unparseable | Any `ff.js` call exits **2** having already quarantined to `state.json.corrupt-<epoch>` and re-inited. DM the loss. **No auto-backfill** — a silent replay would re-dispatch everything. |
| Session restarted / cron expiring | `status` says so; reconcile in-flight items per the restart rule. `start` again re-arms a fresh 7 days. |
| Mention search lag | Also scan fetched thread replies for the literal `<@SELF_USER_ID>`; always `after:<yesterday>`. |
| Agent reports a broken local stack | That is a **dev-doctor** symptom, not a defect in its work. Diagnose on the lead thread; agents never restart shared infra. |

---

## Verified gotchas

- **`slack_read_thread` takes `message_ts`, never `thread_ts`** — and it wants the *parent's* ts.
  Passing `thread_ts` fails with `Missing value for parameter message_ts`.
- **The Artifact tool refuses to republish a dashboard this session hasn't "viewed."** The URL is
  pinned by `dashboard.url`, not by the file path, but a new session must first `Artifact action:
  read` the stored `dashboard.url` in the same session as its first republish — otherwise
  `publish` errors with "You hadn't viewed the live version," and resending the same file is
  refused again as "identical content." Do the read once at `sweep`/`start` when `dashboard.url`
  is set; regenerating from state is the merge (state is the source of truth, never the published
  copy). **Pass `url: <dashboard.url>` on every publish once it is set** — a publish without
  `url` mints a *second* artifact at a different URL — moving `dashboard.html` to a new path is
  exactly when that bites.
- **Item titles are a publishable surface.** The lead writes `title` — describe the symptom and
  the feature, never the customer or account (`wrong currency symbol on an invoice PDF`, not
  `<Customer> invoice mix-up`). Titles reach the dashboard Artifact, the DM ledger line and LOG.md.
- **`slack_read_thread` with `response_format: "concise"` omits `Message TS` from the replies**,
  which makes the temporal ack rule unenforceable — you see *that* the user replied, never
  *when*. Always `detailed` for an ack probe; bound a huge thread with `"oldest": "<evaluated
  message ts>"` instead of dropping to `concise`.
- **The ❓ ask thread lives in the user's self-DM, so the loop's posts and their answers share
  an author.** Author is no discriminator there — the answer grammar is. Loop posts are shaped
  never to match it (`1.` list lines, `✓ #2 → loop` confirmations), so only a line reading
  `<n|all> skip|mine|loop` is ever taken as an answer (REFERENCE §1h). Likewise any reaction
  there is theirs — the self-DM has one member. **Not yet confirmed live:** whether the detailed
  `slack_read_thread` shows `Reactions:` on replies; until it is, use §1h's `get_reactions`
  fallback (open items' lines only) and record the answer here once seen.
- **`to:me` returns nothing.** The mention query that works is
  `<@SELF_USER_ID> -from:<@SELF_USER_ID> after:YYYY-MM-DD` with `sort: "timestamp"`.
- **`slack_read_channel` gives reaction *counts*, not reactors.** Who reacted needs
  `slack_get_reactions`; who replied needs `slack_read_thread`. Only spend those calls when the
  channel read shows the signal.
- **`slack_read_thread`'s `oldest` is exclusive, not inclusive.** Bounding a big thread with
  `"oldest": "<evaluated message ts>"` drops the evaluated message itself from the response — the
  one message the temporal ack rule needs to see. Subtract one microsecond (`oldest:
  evaluated_ts - 0.000001`) so the bound sits strictly before it, or skip `oldest` entirely on a
  short thread (REFERENCE §1c).
- **`CronCreate` is session-only, expires after 7 days, and fires only while the REPL is idle.**
  A busy main thread silently skips ticks; that is expected, not a fault.
- **`slack_read_file` returns base64** for screenshots. Agents write it to a file and `Read` it.
- **`status` is a read-only variable in zsh** — a helper script that assigns to it aborts
  silently. Name it `s`, `state`, anything else.
- **Never compose flags into an unquoted shell variable.** `D="--state-dir X"; node ff.js $D init`
  passes `--state-dir X` as **one** argv word under zsh (no word-splitting) and `ff.js` exits 1
  with `invalid option: --state-dir X`. Write flags inline, or use an array:
  `D=(--state-dir X); node ff.js "${D[@]}" init`. A bare *path* variable is one word and is fine.
- **`--dry-run` with an explicit `--state-dir` makes that dir the sandbox** — `init --dry-run
  --force --state-dir <live dir>` wipes live state. Rehearse via `$FF_STATE_DIR` (or no flag) so
  the redirect to `<state-dir>/dryrun/` applies.
- **Bash cwd resets between tool calls**, starting in the main checkout — absolute paths in every
  command, in the lead and in every brief. **The scratchpad is wiped on restart**; state lives in
  the state dir.
- **An idle notification is not a completion report**, and the agent's final text output is never
  shown to the user — the lead relays.

## Working facts

- Watch set, user id, DM target, on-call block, caps, repo and branch prefix: `ff.js config`.
- Slack permalinks: `https://<workspace>.slack.com/archives/<CID>/p<17 digits>`, plus
  `?thread_ts=<parent ts>` when the link points into a reply.
- Per-issue RCA artifacts are **not** in the state dir — they stay in
  `<sandbox_dir>/adhoc/<date>-<slug>/` (locally) or `<state repo>/artifacts/<date>-<slug>/`
  (cloud). Branches `<dispatch.branch_prefix><slug>`.

## When not to use this — hand off instead

**bug-intake** one report you already have · **pr-triage** an open PR's CI and bot findings ·
**agent-team** partitioning one effort across agents · **worktree-create** the per-issue worktree ·
**warehouse-data** any production read, first (agents query it directly) · **prod-script** a
guarded repair, or a read the warehouse and the `<ops_bot>` can't answer (drafted by agents, run
by the user) · **ship-pr** opening the PR itself · **cloud-runtime** a non-local environment ·
**dev-doctor** a broken local stack. This skill dispatches those, never does their work. The user
at the keyboard pointing at one thread is `bug-intake`, not a sweep.

Long-tail — config, query cookbook, dispatch brief, DM templates, state schema, LOG format, worked
classification examples, summary DM, start banner: **[REFERENCE.md](REFERENCE.md)**. Operator's
guide for the human: **[README.md](README.md)**.
