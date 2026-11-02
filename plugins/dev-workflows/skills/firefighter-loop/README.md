# Running the firefighter loop — operator's guide

This is the human-facing runbook for `/firefighter-loop`. `SKILL.md` is what Claude follows; this
file is what *you* do to set it up, arm it, check on it, and stop it. Two modes exist: **local**
(your laptop, 5-minute cron inside one long-lived Claude Code session) and **cloud** (an hourly
scheduled routine — see the bottom).

## Prerequisites (once)

- The `dev-workflows` plugin installed and current. The plugin cache only refreshes when the
  plugin's version changes — if a skill edit doesn't show up, bump the version and restart.
- Node.js 18+ on `PATH`. The state CLI (`scripts/ff.js`) and the dashboard renderer
  (`scripts/dashboard.js`) are plain Node scripts — built-ins only, no `npm install`.
- A chat connector (Slack is the one this was built on) connected, with read access to the
  channels you want watched and permission to DM you.
- The repo the agents will work in, on disk, with its dev stack working (Docker up if it uses it).
- `<sandbox_dir>` exists — per-issue RCA artifacts go to `<sandbox_dir>/adhoc/<date>-<slug>/`. The
  loop's own state never touches it.
- Optional, for sharing state with a cloud runner: a private git repo (`<state_repo>`) cloned
  locally and pushable (`git -C <clone> push --dry-run`). Point `FF_STATE_DIR` at the clone's
  **root** — a state dir that merely sits inside some other repo (your sandbox, an app checkout)
  is treated as not-a-repo and never synced, so the loop can't commit into a repo it doesn't own.

## Configure what it watches (once)

```bash
# The skill's base directory is printed when the skill loads; for an installed plugin it is under
# ~/.claude/plugins/ (find it with: ls -d ~/.claude/plugins/**/skills/firefighter-loop).
S=<skill base directory>/scripts
node $S/ff.js init --profile local     # creates the state dir + a config.json template
$EDITOR ~/.local/state/firefighter-loop/config.json
node $S/ff.js config check             # must say OK before the loop will tick
```

`config check` fails until you fill in `self.user_id` (your chat user id), at least one
`watch.channels` entry (`[{name, id}]`), a one-line `watch.area` describing what you own, and
`dispatch.repo` (the git checkout agents work in; `config check --report-only` skips it for a
classify-only rehearsal). Optionally add `watch.keywords` if a channel is shared and only some of
it is yours, and the `oncall` block if your team has an on-call rotation with a channel, a group
handle and an announcing bot — on-call turns on as soon as that block is filled in, even after
`init`. Only Slack is supported as the chat tool today. See
`scripts/fixtures/config.sample.json` for a filled-in example. (Or just run `/firefighter-loop
sweep` — if the config is incomplete it walks you through it and writes it on your OK.)

## Arming it for the day (local)

Start a **fresh** Claude Code session from the app repo, so dispatched agents inherit its
`CLAUDE.md`/`AGENTS.md` (the lead never edits the main checkout; every agent gets its own
worktree):

```bash
cd <your app repo> && claude
```

Then, in that session (any model for the lead; every dispatched agent is Opus). The command is
`/firefighter-loop` or, fully qualified, `/dev-workflows:firefighter-loop` (the form the cron
prompt uses):

```
/firefighter-loop status                 # what state knows: items, needs-you, cron, config
/firefighter-loop sweep                  # drain the 24h backfill / since last watermark
/firefighter-loop start --interval 5m    # arm the cron; accept the CronCreate prompt
```

`start` prints a banner listing exactly what may happen unattended (dispatch Opus agents,
draft prod scripts, open ready-for-review PRs, DM you). That banner *is* the autonomy grant for
the session; nothing else in the session inherits it. Use `--report-only` to classify + log
without dispatching, `--dry-run` to rehearse in a scratch state dir.

**On-call days.** If you configured an on-call rotation, on the days it lands on you the loop
also handles requests tagged with the on-call handle in the on-call channel — by default it
detects this itself from the rotation bot's announcement (you'll get one `On-call mode active`
DM when it flips on) and expires it at day rollover, so it never works someone else's shift.
`--oncall on` forces it for today (bot missed, mid-day takeover), `--oncall off` disables it
entirely; a configured "resolved" reaction by anyone counts as resolved there — that channel's
convention.

**Keep the terminal open.** The cron is session-only and auto-expires after 7 days; it fires
only while the REPL is idle. Before closing the laptop or the session:

```
/firefighter-loop stop                   # deletes the cron, lists agents still live
```

If the session died, `status` says "session restarted; run `start` again" — state in the state
dir survives (and is pushed, if it is a repo), agents do not; in-flight items are re-dispatched
once.

## What you will see

| Where | What |
|---|---|
| **Chat DM to yourself** | One thread per issue: `🔥 Picked up …` when an agent starts, then `⏸ Needs you / ✅ Done / ⚠️ Blocked` with verdict, evidence, artifacts, explainer URL, PR, and **one imperative ask**. Plus at most one `❓ You acknowledged these` thread a day (below). No DMs for ignored/noise items — those appear once in the sweep-summary DM. |
| **Terminal** | One line per tick; silent ticks read `firefighter tick HH:MM — 0 new … · N live · next HH:MM`. |
| `<state dir>/days/<date>/LOG.md` | Every item considered with class/status/reason, plus a `## Ticks` trace (a silent loop must be distinguishable from a dead one). Committed and pushed each tick when the state dir is a repo. |
| Dashboard Artifact | Needs-you first, then per-status cards; republished when an item changes. Generated from `<state dir>/dashboard.html`; its URL is in `ff.js get dashboard.url`. |
| `<sandbox_dir>/adhoc/<date>-<slug>/` | Each dispatched issue's RCA: `README.md` + an explainer page (also an Artifact), numbered scripts (`NN_diagnose.rb` read-only, `NN_…_repair.rb` DRY_RUN), and `verification-notes.md` in the agent's worktree. |
| `<state_repo>` (optional) | The same state, pushed. A night's work is readable from anywhere, and a cloud run picks up exactly where the laptop left off. |

Your inputs come back through the same channels: paste a requested prod script's output into the
DM thread or the session; reply in the chat thread the agent is watching (live items' threads are
polled every tick and forwarded to the owning agent).

**Things you already acknowledged.** A reaction or reply from you never makes the loop skip an
item silently. If it would otherwise have dispatched an agent, it's parked as *your call* —
skipped by default — and you're asked once: on a `sweep` you typed, right there in the session;
otherwise as its own numbered line in that day's `❓` DM thread. Quickest answer: react with the
ask reaction (🤖 `:robot_face:` by default) on the line to have the loop work on it, exactly as if
you hadn't acked it. Or reply in the thread with `2 loop`, `2 mine` (you're on it) or `2 skip`
(or `all skip`). A reply always beats a reaction as long as no agent has started (a reaction
usually dispatches on the next tick), and a reaction never overrides a reply — to turn a skip
into a dispatch, reply `2 loop`. No answer = it stays skipped, and you can still answer later —
the thread is read every tick for 7 days, and after that `ff.js decide` works from any terminal.
Items that wouldn't have been dispatched anyway (coordination, feature wishes) never generate a
question.

## What it will never do

Post, react or draft in any channel (the only chat write is the DM to you) · run anything against
production or sign in to a production admin UI (prod reads come from your warehouse mirror via
**warehouse-data**) · merge, approve or request reviewers · touch the main checkout (every agent
works in its own worktree) · exceed the configured dispatch caps (3 per tick / 8 live agents by
default).

## Checking on it

```bash
S=<skill base directory>/scripts
R=${FF_STATE_DIR:-~/.local/state/firefighter-loop}
node $S/ff.js summary                       # counts, live agents, watermark ages, cron, lease, config
node $S/ff.js get --status needs_you        # what is waiting on you
node $S/ff.js asks                          # acknowledged items still waiting on your call
node $S/ff.js decide <key> loop             # answer one from here (skip|mine|loop); the next
                                            # tick dispatches a `loop`
node $S/ff.js verify                        # schema check
node $S/ff.js config check                  # is the watch config complete
node $S/ff.js oncall status                 # is on-call mode on today, and since when
tail -20 $R/days/$(date +%F)/LOG.md
git -C $R log --oneline -5                  # did the ticks push? (state repo only)
```

`get`/`summary`/`verify`/`asks`/`config` are safe from any terminal at any time; mutations go
through the running session only — `decide` is the one exception meant for you, and it is a
single atomic write (best done between ticks).

## Cloud mode (night shift)

The same skill can run as an hourly scheduled routine (`sweep --since 2h --profile cloud`)
against the *same* `<state_repo>` the local loop uses, so a cloud sweep resumes from your laptop's
last tick and vice versa. Load the **cloud-runtime** skill for the platform recipe and the
degradation rules; `scripts/routine.example.json` is a ready-to-adapt routine body (fill every
`<…>`, keep it disabled until a manual dry run passes). It needs GitHub access to the app repo,
the plugin repo and the state repo, and the chat connector on the cloud side.

## Known gotchas (operator-relevant)

- The dashboard republish from a **new** session first needs the skill to `Artifact action: read`
  the stored URL (it does this itself at `sweep`/`start`); publishing without it mints a new URL.
- `CronCreate` and chat DMs go through the permission classifier — the first time in a session
  you'll get prompts; accept them for the loop to run unattended.
- A 24h `sweep` after days off will surface stale items; anything you already reacted to or
  replied to is skipped by default and put to you as one question each (in-session on a
  `sweep`), everything else is dispatched (a teammate's reply does **not** count as your
  acknowledgement — by design). A resolved reaction in the on-call channel is different: it
  means *resolved*, so that request is closed without asking.
- `--dry-run` together with an explicit `--state-dir` treats that dir as the sandbox: `init
  --dry-run --force --state-dir <live dir>` wipes live state. Rehearse via `FF_STATE_DIR`.
