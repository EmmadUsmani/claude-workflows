---
name: status-update
description: 'Draft the user''s periodic status update for `<status_channel>` (cadence `<status_cadence>`) from whatever notes they give — none, loose lines, or full daily-note Summaries — using them as the base and filling every gap by researching the window since the last post: their Claude Code sessions (`~/.claude/projects` transcripts, a primary source) plus GitHub, chat, the cloud agent, the issue tracker, docs and Claude artifacts. Writes their format (a `<Weekday> MM/DD` header, workstream bullets, `Firefighting` last, PR-title anchors, `(thread)` links), shows the draft in the terminal and iterates; on request saves an unsent chat draft in their self-DM; posts ONLY on an explicit "post it". Use for "write my status update", "draft my friday update from these notes", "here are some notes, fill in the rest", "write my update, I have no notes", "figure out what I did since my last post", "/status-update". NOT for replying to a priorities thread, project-channel updates, or the daily note itself (daily-summary).'
argument-hint: "[weekday] [notes — any amount, or none | note file paths]"
---

# Status update — notes or research → the periodic post

The user posts a progress update in **`<status_channel>`** on a fixed cadence
(**`<status_cadence>`**). The reader is whoever follows that channel — a lead, the team, or just
the user's own record. Whatever the cadence, every post has the same shape: a **delta since the
previous post**, grouped by workstream.

**Notes are optional, and any amount works.** The user may paste nothing, a few loose lines,
semi-detailed notes for some days, or complete daily-note Summaries (**daily-summary**'s output)
for every day. It's a spectrum, not a switch: **whatever they give is the base, and research
fills in everything they didn't write** — missing days, missing items, missing links, stale
statuses. With no notes at all, research writes the whole update; don't stop to ask for notes.

**Research always covers every source**, however complete the notes look:

- **Their Claude Code sessions** — one of the most important sources: much of the work happens
  in them, and the transcripts hold what notes compress away (root causes, numbers, outcomes,
  who wrote the code).
- **Work systems** — GitHub, `<chat>`, `<cloud_agent>`, `<issue_tracker>`, docs, Claude
  artifacts. These carry what sessions don't: current PR and review state, the requester and
  outcome of a support thread, work done outside a session, docs.

No single source is enough on its own; an item is strongest when a session and a work system
agree.

- Style rules, templates and the transformation vocabulary: [`references/style.md`](references/style.md) — **read it before composing.**
- Two worked runs — one with no notes, one with two loose lines: [`references/examples.md`](references/examples.md).

## Settings

- `status_channel` (required — ask once if unset, then suggest adding it to the settings
  section; never guess it).
- `status_cadence` — the posting days as a weekday list (`fri`, `tue,thu`, `mon,wed,fri`). The
  bare default `weekly` names no day: ask once which day and suggest `status_cadence: <day>`.
- `chat` (default `slack`), `issue_tracker`, `cloud_agent`, `daily_notes`, `sandbox_dir`,
  `ops_bot`.
- The user's own chat user id is needed for search filters and the self-DM draft. Resolve it
  once per run with `slack_read_user_profile` and no `user_id` (it returns the current user);
  never from memory.
- Header format defaults to `<Weekday> MM/DD`; if the user's past posts use another header, copy
  theirs.

## Hard rules

1. **Never post to `<status_channel>` without an explicit instruction for this draft, in this
   conversation** — "post it", "send it to the channel". Approval of the wording ("looks good",
   "perfect") is not permission to post. A go-ahead from an earlier update does not carry over.
2. **Chat drafts go to the user's self-DM only** — for Slack, `slack_send_message_draft` with
   `channel_id` set to their own user id (it resolves to the self-DM). Never create a draft in
   `<status_channel>` or any other channel.
3. **Every other chat call is read-only.** No reactions, no replies, no messages to anyone else.
4. **Never invent work, statuses, numbers or links.** Every link comes from the notes or from a
   lookup you actually ran; every status from the notes, a session's recorded outcome, a thread,
   or GitHub — and a PR's review state always from GitHub. What you couldn't confirm gets
   flagged (Phase 5), not smoothed over.
5. **Never cite an identifier from memory** — PR numbers, titles, thread URLs, user ids are read
   back out of the notes or a lookup result.
6. **No default notes location beyond `<daily_notes>`.** Use what the user pastes, the file paths
   they give, or the `<daily_notes>` files for days in the window if they exist — don't go
   searching the disk for other notes. With none, research covers the whole window; never stop
   to ask for notes. One more source, found by the session sweep rather than searched for: notes
   pasted into a **daily-summary** session in the window, and the Summary it produced, count as
   that day's notes (Phase 3, "Summary-writing sessions").
7. **Research is still evidence-only.** Every item traces to a session, PR, task, thread,
   doc or artifact you read in this run. "They probably also…" is not an item.

## Phase 0 — inputs

- **Notes** (optional, any amount): pasted Markdown (one or several days), file paths, or loose
  free-form notes — "mostly the crawler thing, plus support on tuesday" is as valid as a full
  Summary per day. Less structure just means more lookups.
- **How notes and research combine** — the same rules whatever the amount:
  - **The user's notes are the base.** Every noted item appears, in their wording (flagged if
    nothing confirms it); items they name lead their section and get the most depth ("mostly X"
    → X is the first L1); a status they wrote holds unless a source shows a newer one (list the
    change).
  - **Research fills the rest.** Work in the window with evidence of *their* action ("Build the
    items from research") goes in even if the notes never mention it — a day with no note, an
    item they didn't write down, the rest of a stack, a support thread. These additions are
    listed under `Added:` in Phase 5 so they can cut any they left out on purpose.
  - **Notes are usually per topic, not per day** — don't try to mark days as "covered"; research
    runs over the whole window either way.
- **Day**: from the argument, else today. Header date = the day it will be posted (today unless
  they say otherwise). If today isn't a `<status_cadence>` day, don't block: draft with today's
  header, say in the coverage line that it's off-cadence, and let the user change it.
- **Attachments**: if the notes mention a demo, recording, screenshot or video, ask whether
  they'll attach it — the text then points at it ("see attached demo", "Video attached below").

## Phase 1 — read the previous post (read-only)

Read the last few messages of `<status_channel>` (for Slack: `slack_read_channel` with
`limit: 5` and `response_format: "detailed"` — `concise` omits `ts`, and the default 100 is a huge
payload; paginate only if the last post isn't in it); find the user's most recent message whose
first line matches the header pattern (`^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b`
by default — any weekday, since an off-cadence post is still the last post). Note its `ts` — it's
the cutoff for "already reported" in Phase 3.

**No previous post** (first update, the channel can't be read, or `<chat>` isn't connected): ask
the user to paste their last post if there is one. Otherwise the window starts at the previous
cadence day (7 days back for a single weekly day) — say so in the coverage line, and skip the
"already reported" and "carry" rules below.

From the previous post take:

- **The window** = the post's `ts` through now. Post times vary, so on the first day only work
  after the post time counts — run that day's digest with `--from HH:MM` (the post time, local);
  it works on the whole-day digest, not just with `--session`. If the last post is more than one
  slot back (missed updates), the window simply spans everything since; say so in the coverage
  line.
- **Already-reported items** — drop anything that post already reported at the same status. An
  item reappears only if its status moved (needs review → merged, merged → ran in prod).
  Compare against **the status the post printed**, not timestamps: a post can say "approved, not
  merged yet" about a PR that merged shortly before it went out — so "merged" is news.
- **Workstream names** — reuse its L1 names verbatim for continuing work rather than a note's
  page label.
- **Open threads to carry** — every active workstream and every unresolved Firefighting issue in
  the last post gets a line in this one, even with no progress (`will continue working on this
  soon`). An issue is *resolved* when its last status there was fixed / live / done / confirmed
  working — don't carry it. A carried line with no activity in the window gets that neutral line
  (or its unchanged status, "still needs my review") — never an invented reason. A carried
  on-call issue keeps its `On-call` sub-bullet even when there was no shift in this window.

If the team has a priorities post the update answers to (a weekly "priorities this week" message
— ask the user where once if they mention one, and suggest remembering it in their settings),
read the latest and the user's reply to it: the L1 order roughly follows its priority order, and
it tells you what's "main" vs side work. A listed priority with no work in the window and no line
in the last post is left out — list it under `Flagged:` instead.

**Naming a new workstream** (no previous-post name exists): the user's own wording in their reply
to the priorities post → the note's label (minus emoji) → the priorities post's wording. Title
Case, short — except a repo or product name, which keeps its own casing (`hrefcheck`, `potluck`).

## Phase 2 — extract from the notes

Skip this phase when they gave no notes — every item then comes from Phase 3 ("Build the items
from research").

Per note, take the lines under `^## Summary\s*$` to the next heading, `---`, or EOF. A task list
above it is a fallback only for a day with an empty or missing Summary, and personal/admin tasks
never appear in an update.

- **Status lives in the child free-text bullets** (`merged`, `live in prod`, `fix live`, `ran in
  prod`, `needs review`, `WIP`, `investigating`). **Never** read status from an emoji in a page
  link label (`✅ ❌ ⏸️ ✏️`) — that's the page's state at export time, not that day's. Strip them.
- **App-specific links (`obsidian://`, `notion://`) don't resolve outside the app.** Keep the
  label as the item name, drop the URL. A ticket key in the label (`ABC-123`) → the tracker's URL
  for it, built from a link the user has used before.
- **Canonicalize PR links** to `https://github.com/<owner>/<repo>/pull/<n>`: strip `#top`,
  `/files`, `/changes`, tracking tails; convert stacked-PR-tool URLs to GitHub ones. Take the
  number from the URL, not the label — labels are often bare titles with no `#N` at all.
- **Collapse across days** — key by PR URL, then ticket key, then note page, then chat thread or
  issue; keep the **latest** status in the window.
- Clean note-export noise: trailing `\` soft breaks, empty `- ` bullets, `+` used as a list
  marker, bracket typos like `[thread)]`.

## Phase 3 — research: look it up, don't guess

This phase does two jobs at once: it **enriches** what the notes say (they're terse by design —
resolve every gap) and it **produces the items the notes don't have** (all of them, when there
are none). The cost is tool calls; the payoff is an update with real links and correct statuses.
**Run every sweep, every time** — sessions and work systems alike, however complete the notes
look — and don't ask permission to read. Skip a sweep whose setting is unset or whose tools
aren't connected, and name it in the coverage line.

**First sweep — Claude Code sessions (one of the most important sources, never skip).** The
transcripts hold what the notes compress away: the root cause, the numbers, which PRs a session
opened, whether a prod script was applied, what a reviewer asked, whether Claude or the cloud
agent wrote the code and whether the user reviewed it. Run it for **every day in the window** —
even when the notes look complete, the sessions are where you check them. It doesn't replace the
work-system sweeps after it: sessions say what they worked on, GitHub and chat say where it
stands now and catch what never went through a session. Digest each day with the
**daily-summary** skill's script (same plugin, `../daily-summary/` from this skill's directory):

```bash
S=<dev-workflows skills dir>/daily-summary/scripts/sessions_digest.rb
ruby $S <first day> --tz <Area/City> --from <previous post time, HH:MM>   # first day: after the post only
for d in <each later date in the window>; do ruby $S "$d" --tz <Area/City>; done
# one session in full, when an outcome matters and the digest is cut off:
ruby $S <date> --tz <Area/City> --session <id prefix> [--from HH:MM]
```

The output shows each session's title, its prompts, the skills and MCP servers it used, the PRs
linked to it, and its outcome replies. **daily-summary** Phase 1 explains how to read it:
sessions span days, a resumed session keeps its original file, `ran: <cmd>` lines are commands
the user typed themselves, and `pr-link` only associates a PR with a session. Use the digest to:

- **enrich** note items with root causes, numbers, outcomes, and "made with <cloud agent> /
  Claude investigated and created a fix" or "need to review myself";
- **resolve** unlinked items: a session titled `rsvp-count-off-by-one` with a
  `/bug-intake <permalink>` gives the thread and the requester;
- **fill in what the notes don't cover** — a missing or empty note (today's before it's written,
  a skipped day), or work they didn't write down: see "Build the items from research" below.

**What the digest covers.** Every session under `~/.claude/projects` — the terminal CLI, the
desktop app's Code tab, IDE extensions and Remote Control sessions all write there, across every
repo and worktree. The session running this skill appears too: `--exclude` it (the file whose
tail holds the `/status-update` prompt; when you run as a subagent, that's the parent session).
Other Claude surfaces:

- **Summary-writing sessions** (`/daily-summary`, an earlier `/status-update`) aren't work items,
  but they're the best notes there are: pasted partial notes in them count as notes for that
  day, and the Summary a daily-summary session produced is a pre-built item list for that day —
  use it as the day's base, then verify statuses against GitHub. Drill into the session
  (`--session <id>`) to read both.
- **Forked sessions duplicate content.** A fork (`/branch`, or a session copied to start a new
  one) repeats the parent's prompts and replies under a new id. Identical prompts at identical
  times are one session.
- **Session outcomes repeat bot approvals.** A reply saying a PR was "approved" may be a review
  bot. Check every review state against `gh` `reviews`.
- **Session titles aren't facts.** A title with "on-call" in it doesn't make that day an on-call
  shift; only the chat record does.
- **Cloud-agent tasks** are cloud Claude sessions — the cloud-agent sweep below covers them; read
  a task's messages when it has no local session driving it.
- **Claude desktop Cowork sessions** (macOS) live outside that tree. Check for any in the window
  with `find ~/Library/Application\ Support/Claude/local-agent-mode-sessions -name 'local_*.json'
  -newermt <window start>`; if any turn up, mention them in the coverage line and ask before
  reading them.
- **claude.ai web chats** aren't reachable — take the user's word for anything they say happened
  there.

**Long windows: delegate the digests.** One day's digest runs to tens of KB, and drill-downs add
as much again, so a multi-day window costs tens of thousands of tokens to read. For a window of
more than 3 days (missed slots), spawn one subagent per day on a cheaper model that runs the
digest — plus drill-downs where an outcome is cut off — and returns that day's candidate items in
the daily-summary format (item, what happened, PR/thread links, end-of-day status, session ids),
so the main thread composes from the item lists instead of raw digests.

**Second sweep — GitHub, the cloud agent and artifacts.** These answer most remaining gaps in one
call each. GitHub date filters are UTC, so pass the window as a local-day UTC range (the Ruby
one-liner in **daily-summary** Phase 2 prints it for any zone, DST-safe):

```bash
R="<window start as UTC ISO>..<day after end, local midnight, as UTC ISO>"
# every PR the user authored that moved in the window, all repos (add --owner <org> to narrow)
gh search prs --author @me --updated "$R" --limit 100 \
  --json repository,number,title,state,url,updatedAt
# others' PRs they reviewed — drop their own login (gh api user -q .login)
gh search prs --reviewed-by @me --updated "$R" --limit 50 --json repository,number,title,author,url
```

Back-to-back searches can trip GitHub's secondary rate limit (HTTP 403): wait about a minute,
retry once, else note the skipped query in the coverage line.

For `<cloud_agent>` (skip when `none`): list tasks active since the window start (for Niteshift:
`list_tasks { activeSince: "<window start as UTC ISO>", limit: 50, includeArchived: true }`; a
task's PRs are under `repos[].branches[].prNumber`). The list tags which PRs were AI-built ("made
with <cloud agent>"; notes rarely say so) and surfaces demo videos and recordings worth attaching.
Activity filters key on *last* activity, so check the creation time for when work started.
`gh pr list` without `--limit` silently stops at 30; don't use it for the sweep.

Keep **what the user did** (opened, pushed, merged, reviewed) separate from **what happened to
their PRs** (a teammate reviewed, someone approved). Received reviews belong in a status line
under their item ("<reviewer> requested changes on the base PR, need to address their
feedback"), never as items of their own.

**Claude artifacts** (only if the Artifact tool is available): `Artifact { action: "list",
limit: 30 }` returns plan and explainer artifacts updated in the window, which the post links as
`<label> artifact: [claude.ai/artifact/…](url)`. The listed date is UTC and coarse, so before
linking one, confirm it belongs to the window from the publishing session (the default digest
truncates replies, so the id often only shows in a `--session` drill-down). If an artifact link
needs a share key, reuse one only if it appears in the notes or an earlier post; don't go
hunting for keys in transcripts — link without it and flag it.

**Third sweep — support threads and issues.** Where support reaches the user, the threads they
worked are Firefighting candidates:

- **Chat**: their messages in the window, any channel:
  ```
  slack_search_public { filters: "from:<@<their user id>> after:<day before window start>",
                        sort: "timestamp", include_context: false,
                        response_format: "detailed", limit: 20 }
  ```
  Page with `cursor`. Slack's `after:` is exclusive, hence the day before. `concise` results
  carry no permalink or `ts`, so use `detailed` whenever you'll need the thread. Read each root
  for the requester and permalink (`slack_read_thread`) and the thread for the outcome. Their own
  top-level posts in project channels are status signals for workstream items. Skip
  `<status_channel>` itself, social channels and one-word acks.
- **Tracker issues**: when support arrives as issues (common for open-source work), the issues
  they commented on or closed in the window: `gh search issues --commenter @me --updated "$R"
  --json repository,number,title,url,state,author`. The issue's author is the requester, and the
  link word is `issue` (style.md).
- **Default: include every support thread or issue they worked**, including ones the notes never
  mention (the user trims by hand if they want).
- **On-call shifts**, if the user rotates through a support duty in a dedicated support channel:
  - A shift runs from their shift-start post to their shift-end post (or the rotation bot's
    announcement naming them). Threads that land after their shift-end belong to whoever is on
    next.
  - Only threads **in the support channel, worked during a shift**, go in the `On-call`
    sub-bullet. The same channel's threads on a non-shift day (they were pulled in), and threads
    in any other channel even on a shift day, are plain Firefighting.
  - Shift days come from the chat record, never from a session title. A shift day with only the
    start/end posts and no thread replies contributes nothing.
- **Shared channels with external organizations (Slack Connect) may not show up in search** —
  read any such thread a session links with `slack_read_thread`.
- Public search can't see DMs or private channels; the session digest already records most of
  those (`<ops_bot>` asks, **warehouse-data** queries, prod scripts), so private search is rarely
  needed — ask for consent first if it is.

**Fourth sweep — the rest of their apps.** Cheap, and they catch work that never went through a
session:

- **Docs** (Notion, Google Docs…): once the items are collapsed, one search per L1 for docs the
  user created in the window (for Notion: `notion-search { query: "<L1 keywords>", filters: {
  created_by_user_ids: ["me"], created_date_range: { start_date: "<window start>" } } }`), plus
  each doc a session or note mentions. Zero hits is the usual result. A tech doc / design doc
  they wrote is a line under its workstream, anchored by its title. A "recently modified" listing
  usually returns other people's shared files, so it isn't a sweep.
- **`<issue_tracker>`** (if it isn't GitHub): only if its tools are already authenticated (never
  start OAuth) — issues they created or moved in the window.
- **Calendar and meeting notes are not items.** A meeting appears only when a session or thread
  shows it produced work ("agreed the rollout order in the weekly sync → updated the plan").

### Build the items from research

For everything the notes don't cover (the whole window, when there are none), turn the sweeps
into the item list that Phase 2 would have produced from notes and merge it with the noted items
— a noted item and a researched one about the same PR/thread/topic are one item, in the user's
wording. Then carry on to the per-gap lookups below.

1. **Per day, run the daily-summary procedure** (its Phases 1–3) against that day's digest plus
   the sweep results for that day — sessions turn into candidate items, merged and split by
   topic, with an end-of-day status from the strongest evidence (merged > applied in prod > PR
   opened > in review > WIP). Keep it in memory; nothing is written or shown per day.
2. **Collapse across days** exactly as Phase 2 does (key by PR URL, then ticket, then chat
   thread or issue, then session title/topic); keep the latest status in the window.
3. **Inclusion — something the user did, not just something that happened.** An item goes in the
   draft when there is evidence of *their* action in the window, from any source: their prompts
   in a session, a `ran:` line, a PR they opened, pushed to, merged or reviewed (GitHub alone is
   enough — they also work outside Claude Code), a task they dispatched, a thread or issue they
   replied in, a doc they wrote. Left out (listed under `Flagged:` with the reason, so they can
   pull any back):
   - PRs and tasks whose only activity in the window came from someone else — a cloud-agent task
     they didn't start, a bot pushing to a PR they authored long ago, a teammate's PR in their
     search results. A task they started from the agent's own UI carries their prompt (its first
     user message): it counts when it serves a workstream; one that looks like a test or an idle
     experiment is flagged;
   - one-question sessions that served nothing, cron-only sessions, the summary/update-writing
     sessions themselves;
   - their own tooling — sessions in their personal plugin repo, `<sandbox_dir>` and similar. Flag
     it as one line ("skill work: one-pager, status-update") unless it was done for a workstream
     (a script that unblocked a fire goes under that fire).
4. **What notes would have told you, and research can't.** Whether *they* reviewed a
   Claude/cloud-agent PR ("need to review myself"), which item is the main one, and anything they
   did offline. Infer review state from their session prompts (a `/deep-pr-review` or a "review
   this" session on it means they looked); otherwise write `need to review myself` only when a
   session leaves the review explicitly with them, and mark the rest `[?: reviewed?]`. Order
   workstreams by the priorities post if there is one, then by the time sessions spent on each.
5. **Firefighting** comes from `/bug-intake` and **firefighter-loop** sessions, support-thread
   replies, tracker issues, and the third sweep — requester and link from the thread root or
   issue, outcome from the thread and the session.
6. **Reviews of others' PRs** go under the workstream they belong to ("Reviewed the crawler PR,
   flagged a few edge cases" sits under its project). Reviews that belong to no workstream share
   one `PR reviews` side L1, just above Firefighting, and are listed as an optional cut. A
   review still running at draft time (a **deep-pr-review** session, nothing posted on GitHub)
   is `Reviewing …` — flag it, since the post goes out before it lands.
7. **Length.** Research surfaces more than notes do, so a draft can run well past the usual
   length. Keep everything and list optional cuts under `Flagged:`.

Then per gap:

| Gap in the notes | Look it up |
|---|---|
| A PR mentioned with no link ("2nd PR, worked on by claude", "the stack", "PRs up") | Match it in the sweep by topic/branch, then `gh pr view`. |
| A PR's current status | `gh pr view <n> --repo <owner/repo> --json title,state,mergedAt,body,reviews,reviewRequests` — use the **exact current title** for the anchor. **Don't trust `reviewDecision`**: review bots (Cursor Bugbot, CodeRabbit, Graphite, cloud-agent bots) can flip it to APPROVED. Read `reviews`, drop bot authors, and report human reviews by name ("<reviewer> requested changes on the base PR"); `reviewRequests` shows who they asked. |
| A stack ("new N PR stack") | The base PR's body often says it ("Bottom of a three-PR stack"). Else walk `baseRefName` — branch names can mislead (a `-part3` branch can sit below `-part2`). The post names the base PR + "N PR stack". |
| A thread link in the notes | `slack_read_thread` (or the chat tool's equivalent) — this is where requester names, root causes, numbers and outcomes ("<requester> confirmed it's working") come from. Slack permalink `…/archives/<C>/p<10 digits><6 digits>` → `channel_id: <C>`, `message_ts: "<10 digits>.<6 digits>"` (a dot before the last six digits); for a reply permalink use its `thread_ts` param instead. |
| An issue link in the notes | `gh issue view <n> --repo <owner/repo> --json title,author,state,comments,closedAt`. |
| A support issue with no thread link, or no requester name | Chat search with the issue keywords + person, or `gh search issues` with the keywords. Private-scope chat search asks the user for consent — only if public search fails. |
| A ticket key, or "made a ticket" | `<issue_tracker>` tools if already authenticated; otherwise the URL built from the key and the label's title. |
| A tech doc / design request / project doc | Docs search for the page title — the anchor is the page title. |
| A number the update would want ("how many records", "how many users") | Only if it's in the notes, a linked artifact, or the chat thread. Never run prod queries for this. |

**Timestamps.** GitHub returns UTC; convert to local time before comparing dates (an evening merge
west of UTC shows as the next day). "Status moved since the last post" = the current status
differs from what the previous post printed (Phase 1) — usually because `mergedAt` / review time
is after its `ts`, but a post can already be stale when it goes out.

**Status cutoff = draft time**, by default. If the user says they're posting later, or drafts the
night before, state which cutoff you used, and flag any status change from the last few hours
("#57 approved at 2:40 PM today — would read `needs review` in a morning post").

**PRs in the sweep that no note mentions** — the inclusion rule in "Build the items from
research" decides: in when there's evidence of their action (listed under `Added:`), otherwise
`Flagged:` with number, title and state so they can pull any in.

**Names.** A name the user's past posts use wins (a nickname over the full profile name);
otherwise spell people as the chat tool or GitHub profile does, not as the notes do. Session
prompts are often dictated, so names in them can be wrong (a dictated "Aaron" for "Erin"):
resolve them through the linked thread, issue or DM, never take them as written.

Record what each lookup found; unresolved items are flagged in Phase 5, not dropped silently.

**Demo videos are attachments, and proof.** If the window produced any recordings (for example
**demo-video** output, often published as GitHub release assets linked from a PR body as
`releases/tag/<tag>`), ask whether to attach them, and add a line saying what produced them.
Fetch release assets with:

```bash
D=~/Desktop/status-update-<YYYY-MM-DD>; mkdir -p $D
gh release download <tag> --repo <owner/repo> --pattern '*.mp4' --dir $D --skip-existing
```

Chat draft/send tools generally can't carry files — the user drags them from that folder into the
message. The same goes for any other recording or screenshot a lookup turns up.

## Phase 4 — compose

Follow `references/style.md` exactly. The essentials:

```
Friday 03/06
- <Main workstream>
    - <past-tense fragment of what changed>
        - <label>: [claude.ai/artifact/…](<artifact url>)
        - New 3 PR stack, base PR: [<exact PR title> #<n>](<pr url>)
        - Need to review myself
- <Side item / small standalone PR>
    - <one line>
- Firefighting
    - <Issue description> raised by <FirstName> ([thread](<permalink>))
        - merged - [<exact PR title> #<n>](<pr url>)
    - <Long-running issue short name> ([issue](<issue url>))
        - <status>, <next step>
```

- Header `<Weekday> MM/DD` (default), zero-padded, alone on line 1. No greeting, bold, emoji or
  sign-off.
- Group by **workstream**, never by status. Main projects first, side items next,
  **`Firefighting` always last** — and omitted entirely when there's nothing new and nothing to
  carry. An `On-call` sub-bullet inside it only for support-channel threads worked on a shift
  (Phase 3), or a carried on-call issue.
- Typically a handful of top-level bullets, 3 levels deep (a 4th for a PR under an explanation),
  a few hundred words. **A window spanning missed slots** runs longer, and that's fine —
  complete beats short. Keep each line tight (a resolved Firefighting issue is issue +
  `merged - [PR]`), but **never cut an item on your own**; list optional cuts under `Flagged:` and
  let the user choose.
- Fragments, no trailing periods; past tense for done work, "Working on…"/"looking into it" for
  in-progress, "Will…" for next steps, "need(s)…" for blockers. Say when Claude/the cloud agent
  wrote something and whether the user has reviewed it.
- Every link is an anchor, never a bare URL: PR → `[exact title #N](url)`; chat →
  `([thread](url))` at the end of the line; tracker issue → `([issue](url))`; doc → page title;
  artifact → display anchor.
- Addressing the reader: only when a specific person reads the channel and the post asks them
  something — a real @-mention for that direct ask. Otherwise no "you" at all.

**Write in Markdown, not Slack mrkdwn** — `- ` bullets with 4-space nesting and `[text](url)`
links. That is what both the terminal and the Slack draft/send tools take, and the tools convert
it to a real rich-text list. Never emit the `•`/`◦`/`▪︎` glyphs or `<url|text>` — pasted into the
composer, those are literal text.

## Phase 5 — present and iterate

Show, in this order:

1. **Coverage line** — `Covers Tue 03/03 → Fri 03/13 (notes: 03/03, 03/04, 03/09, 03/10; no note
   for 03/05, 03/06, 03/11–03/13). Last post Tue 03/03 10:20 AM — the Fri 03/06 and Tue 03/10
   updates were skipped, so this covers them too.` Plus the status cutoff used, and any skipped
   sweep. Always add what fed it, counted per source: `Notes: 2 loose lines (set the order:
   crawler, waitlist). Research: 11 Claude Code sessions over 5 days, 3 cloud-agent tasks, 7 PRs
   (+2 reviewed), 4 chat threads, 2 issues, 1 artifact.` — or `Notes: none`.
2. **The draft** in one fenced ```` ```markdown ```` block, so they can copy it whole.
3. **Lookups and flags**, short:
   - `Looked up:` what enrichment added (e.g. "#143 is now merged — notes said PR up").
   - `Flagged:` anything unresolved, written as an inline `[?: …]` marker in the draft too, so
     nothing unverified slips through.
   - `Dropped:` items left out and why (already reported 03/03 at the same status, personal task).
   - `Added:` items research added that the notes didn't mention (omit when there were no notes
     — then everything is research).
   - `Sources:` one line per item research added or changed, naming the sessions (title) and
     lookups it came from, so they can check any line they don't recognize.
4. One line: *"Edit it here, or tell me what to change. Say 'draft it' for a chat draft in your
   self-DM, or 'post it' to send to `<status_channel>`."*

Feedback rounds: apply the change, re-show the **full** draft (not a diff), keep the flag list
current. Reorders, rewordings and "drop that" are normal.

## Phase 6 — deliver

- **"draft it" / "put it in Slack"** → `slack_send_message_draft` with `channel_id` = the user's
  own user id, and the Markdown. Remove every `[?: …]` marker first — ask about any that remain.
  Return the channel link. If it fails with `draft_already_exists`, ask the user to send or
  delete the existing self-DM draft (the tool can't), then retry. Then tell them how it gets to
  the channel, since a self-DM draft can't be moved there:
  1. In the self-DM composer, select all and copy — copying within Slack keeps the links and
     nested lists.
  2. Paste into the `<status_channel>` composer.
  3. Attach any files (e.g. videos in `~/Desktop/status-update-<date>/`) and send.
- **"post it"** (explicit, this draft) → `slack_send_message` to `<status_channel>` and return
  the permalink. Before sending, warn once if the text points at attachments ("see attached
  demo") — the tool can't attach files, so they should post it themselves from the self-DM draft
  instead. Messages sent through an app may carry an attribution footer.
- Other chat tools: the same contract — draft only into the user's own space, send only on "post
  it". If the tool has no draft concept, leave it in the terminal.
- Anything else → leave it in the terminal.

## Verified gotchas

- **Raw mrkdwn isn't pasteable.** The Slack API returns posts as `<url|text>` and `•/◦/▪︎`
  characters; that's how Slack serializes a rich-text list, not what the user typed. Typed or
  pasted back in, it's literal text.
- **The post day's own note is usually incomplete or missing** at posting time. Status in that
  note may be *ahead* of the post (the note says merged, the post said "needs my review" because
  it merged after posting). Always check GitHub state now.
- **Review activity under the user's GitHub account isn't the user reviewing.** Claude and
  cloud-agent sessions comment on their PRs as them. For "need to review myself", the notes win —
  GitHub can show the user's comments on most PRs in a stack they haven't actually reviewed.
- **PRs the user doesn't recognize are usually the cloud agent's.** When listing unmentioned PRs
  under `Flagged:`, say which cloud-agent task opened each (match the sweep's PR numbers against
  the task list's PR fields) — that's the context they'll need to decide.
- **Labels lie, URLs don't**: a note label can drop a digit from the PR number, and two different
  PR titles can both link the same `/pull/<n>`. Trust the URL, then confirm the title via `gh`.
- **Note page names ≠ post names.** A note page called `Crawler rewrite - sitemap support` may be
  `Sitemap Crawler` in posts. Reuse the previous post's names.
- If the user's posts stopped using tracker or stacked-PR-tool links at some point, use GitHub PR
  links; mention a ticket only if the notes make it the item.

## How this composes

- **cloud-agent-work / ship-pr** — their PRs and tasks are the most common unlinked items; Phase 3
  finds them through `gh` and the cloud agent's task list.
- **firefighter-loop / bug-intake** — the threads they work become Firefighting lines; the
  `raised by <FirstName> ([thread](…))` link comes from the original thread, not the loop's DM.
- **warehouse-data / prod-script** (and the `<ops_bot>`, if your team runs one) — never invoked
  for an update. A number that isn't already written down is left out or flagged, not fetched
  from prod.
- **daily-summary** — writes the per-day Summaries this skill aggregates, and owns the digest
  script.

## When not to use

- Replying to a priorities thread — same voice, different job; answer it directly.
- Project-channel updates or anyone else's update.
- Daily notes — **daily-summary** writes those; this skill aggregates them.
