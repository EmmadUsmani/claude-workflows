---
name: daily-summary
description: 'Write the `## Summary` section of the user''s daily note for a day (default today) from what they actually did — reconstructed primarily from their Claude Code sessions (`~/.claude/projects` transcripts, via the bundled digest script) and cloud-agent tasks, cross-checked against GitHub PRs, chat threads, the issue tracker and Claude artifacts. Optionally builds on a partial summary or loose notes the user pastes, keeping their wording and links. Prints Markdown in their Summary format to the terminal for copy-paste; writes nothing unless explicitly asked to put it in the day''s note. Use for "write my daily summary", "summarize what I did today for my daily note", "fill in my summary — here''s what I have so far", "daily note summary for yesterday", "what did I actually do today?", "/daily-summary". NOT for the periodic status post (status-update aggregates these summaries into it) and NOT for mining sessions for new skills (mine-sessions).'
argument-hint: "[YYYY-MM-DD | today | yesterday] [partial summary or notes]"
---

# Daily summary — reconstruct the day, write the note's `## Summary`

The user keeps a daily note per working day (`<daily_notes>`, default
`<notes_dir>/daily/YYYY-MM-DD.md`); its `## Summary` section is the record of what they did, and
**status-update** later aggregates those Summaries into the periodic post. This skill writes that
Summary from the evidence of the day.

**Most of the work happens in Claude Code sessions** — investigations, PR shepherding, prod
scripts, cloud-agent dispatch, tooling work. Those transcripts are the primary source; everything
else confirms, links, and fills gaps. Format reference: [`references/format.md`](references/format.md)
— read it before composing.

## Hard rules

1. **Read-only, everywhere.** No chat messages, drafts or reactions; no GitHub comments; no
   cloud-agent follow-ups; no note writes. Output goes to the terminal only — unless the user
   explicitly says "write it to my note", and then only the `## Summary` section of that day's
   `<daily_notes>` file changes (show the diff of that section first if it already had content).
2. **Never invent.** Every item comes from a source you read in this run; every status from that
   source. Uncertain → an inline `[?: …]` marker, never a smoothed-over guess.
3. **The user's input wins.** If they paste a partial summary or notes, that's the base: keep
   their items, wording, order and links; add to it and refine it, never drop their lines.
4. **Never cite an identifier from memory** — PR numbers, titles, thread links are read back out
   of a lookup result.
5. **No fresh prod reads.** Prod facts that matter come from what a session already recorded
   (a `<warehouse>` query via **warehouse-data**, an `<ops_bot>` answer, pasted **prod-script**
   output).

## Phase 0 — inputs

- **Day**: argument (`YYYY-MM-DD`, `today`, `yesterday`), default today. The day is local
  midnight → midnight, in the user's timezone (the system zone unless they say otherwise). Use
  **one** zone everywhere: pass it to the digest with `--tz` and prefix the GitHub range
  one-liner in Phase 2 with `TZ=<Area/City>`, or the session window and the GitHub window
  disagree.
- **Partial summary / notes** (optional): anything pasted — a half-written Summary, loose notes,
  a task list. Parse it into items first; they seed the outline.
- **The previous note's Summary** (optional — pasted, or read from yesterday's `<daily_notes>`
  file when it exists): use its item names for continuing work ("search indexer rewrite",
  "billing export bug") so the two days read as one thread.

## Phase 1 — Claude Code sessions (primary)

Run the bundled digest for the day:

```bash
node <skill dir>/scripts/sessions_digest.js <YYYY-MM-DD> [--tz <Area/City>] [--projects-dir <dir>]
```

`--projects-dir` (or `$CLAUDE_PROJECTS_DIR`) points it at a non-default Claude Code config dir or
a test fixture; the default is `~/.claude/projects`. `--help` prints every option.

The session running this skill shows up too. If it was opened just to write the summary, ignore
it (or `--exclude <id>` — comma-separate several). If it also holds real work from today, keep
that work and ignore only the summary-writing prompts. **A resumed session keeps writing to its
original file under the original id** — the file to exclude is the one whose tail holds your
latest prompt, not one named after the resumed session's new id.

**Drill-down** when a session's outcome matters and the digest is cut off:
`node <skill dir>/scripts/sessions_digest.js <YYYY-MM-DD> --session <id prefix> [--from HH:MM]`
prints every prompt and every substantive reply for that window, untruncated. Never read raw
transcripts directly — they run to tens of MB.

Per session it prints: the custom title (if the user names sessions by topic, e.g.
`billing-export-timezone-bug`), active window, cwd/branch, slash commands and skills used
(`bug-intake` = an incoming issue, `warehouse-data` = prod data queried, `prod-script` = a prod
script was run, `cloud-agent-work` = a cloud task dispatched, `visual-explainer` = an artifact),
the MCP servers it called (a warehouse, chat or tracker server marks what it touched even
without a skill), PRs linked, **the user's prompts** (what they asked for — the strongest signal
of intent), and the **last assistant replies** (the outcome).

Turn each session into a candidate item:

- **What was the thread of work?** Title + first prompts. A chat permalink or issue URL in a
  `/bug-intake` command is the issue's thread.
- **What came out of it?** PRs linked, "merged", "applied in prod", "artifact published",
  "answered X". Read the final replies; if they're cut off and the outcome matters, drill down
  with `--session`.
- **Several sessions, one item — and one session, several items.** Sessions on the same
  PR/thread/topic merge into one item; a long-lived session (often resumed) can hold unrelated
  threads hours apart — split it by prompt topic.
- **`ran: <cmd>`** lines are shell commands the user typed themselves (`! gh pr merge 8 …`) — the
  way to tell *they* did something vs a session acting as them.
- **Tiny sessions** (a one-question check, an untitled 1-minute session) fold under the item
  they served (a PR review question → under that PR's item), or drop if they served nothing.
- Sessions that only ran cron ticks with "No change." contribute nothing.

Claude.ai web chats and claude.ai/code cloud sessions aren't on disk — if the user mentions work
done there, take their word (Phase 0 notes).

## Phase 2 — the other sources (confirm, link, fill)

Run these; they're cheap. Skip a source whose setting is unset or whose tools aren't connected —
say so in the coverage line rather than starting an OAuth flow.

**GitHub date filters are UTC** — a bare `--updated <date>` pulls in part of the previous day
and misses the end of this one for anyone not on UTC. Always pass the local day as a UTC range:

```bash
R=$(TZ=<Area/City> node -e 'const [y, m, d] = process.argv[1].split("-").map(Number)
  const iso = (t) => t.toISOString().replace(".000Z", "Z")
  console.log(`${iso(new Date(y, m - 1, d))}..${iso(new Date(y, m - 1, d + 1))}`)' 2026-03-04)
# PRs the user authored that moved today (add --owner <org> to narrow)
gh search prs --author @me --updated "$R" --limit 100 \
  --json repository,number,title,state,url,updatedAt
# others' PRs they reviewed or commented on today (drop their own login: gh api user -q .login)
gh search prs --reviewed-by @me --updated "$R" --limit 50 --json repository,number,title,author,url
gh search prs --commenter @me --updated "$R" --limit 50 --json repository,number,title,author,url
```

Back-to-back searches can trip GitHub's secondary rate limit (HTTP 403). Wait about a minute and
retry once; if it fails again, skip that query and name it in the coverage line.

- **GitHub**: for each PR, `gh pr view <n> --repo <owner/repo> --json title,state,createdAt,
  mergedAt,mergedBy,commits,reviews,comments,url`, and keep only events inside the local day.
  Separate **what the user did** (opened, pushed, merged, reviewed) from **what happened to
  their PRs** (a teammate reviewed, someone approved). Received reviews go in only as a status
  child of an item they worked on (`<reviewer> requested changes`), never as their own item.
  Review/merge activity under their account may be a session acting as them; the digest's
  `ran:` lines and session prompts tell you which. To keep the payload small, add
  `--jq '{title,state,mergedAt,reviews:[.reviews[]|{author:.author.login,state,submittedAt}]}'`.
- **Work with no session behind it still counts.** The user also works outside Claude Code: a PR
  they authored, pushed to, merged or reviewed today goes in from GitHub alone. If you can't tell
  what it was for, list it with its title and an `[?: context?]` marker. Leave out only PRs whose
  sole activity under their account came from a bot or a cloud-agent task they didn't start —
  those go under `Left out:`.
- **`<cloud_agent>`** (skip when `none`) — list tasks active since the day's start (for
  Niteshift: `list_tasks { activeSince: "<day start as UTC ISO>", limit: 50,
  includeArchived: true }`). Activity filters usually key on *last* activity — check the
  creation time for "started today". A task with no local session behind it was started from
  the agent's own UI or chat integration; its origin prompt is its earliest user message.
- **`<chat>`** — the user's messages that day (for Slack: `slack_search_public` with
  `filters: "from:<@<their user id>> on:<YYYY-MM-DD>"`, `sort: "timestamp"`,
  `response_format: "detailed"` — `concise` results carry no permalink). Resolve the user id once
  with `slack_read_user_profile` and no `user_id` (it returns the current user), never from
  memory. Threads they replied in are support/firefighting items; read the root for the requester
  and permalink.
  - **On-call shifts**, if the user rotates through one: the shift runs from their shift-start
    post to their shift-end post in the support channel. Threads in that channel worked inside
    the shift go in the `On-call` bucket; the same channel's threads outside it, and threads in
    other channels, are `Firefighting`.
  - Public search can't see DMs or private channels — but sessions already record most of those
    (`<ops_bot>` asks, drafts). Only ask for consent to a private-scope search if a session
    mentions a private thread you need to cite.
- **`<issue_tracker>` issues** — when support arrives as tracker issues rather than chat (common
  for open-source work), the issues the user commented on or closed that day are firefighting
  items: `gh search issues --commenter @me --updated "$R" --json repository,number,title,url,state`.
- **Claude artifacts** (only if the Artifact tool is available in this session) —
  `Artifact { action: "list", limit: 30 }`. The listed date is UTC and
  coarse — confirm an artifact was touched today by finding its id in the digest (or a
  drill-down) before listing it ("plan: <link>", "visual explainer: <link>").
- **`<issue_tracker>` / docs tools** — only to resolve a ticket or doc a session or note
  mentions (and only if already authenticated; never start OAuth).

## Phase 3 — compose

Follow `references/format.md`. The essentials:

```markdown
- <work item: project name | "<person> <issue> ([thread](<permalink>))" | bucket like Firefighting>
    - <what happened, terse lowercase fragment>
    - [<exact PR title>](https://github.com/<owner>/<repo>/pull/<n>)
        - <status: merged | needs review | needs self review | WIP | QA'd, merged>
- Firefighting
    - <person> <issue> ([thread](<permalink>))   ← or ([issue](<issue url>)) for a tracker issue
        - <what you did / PR>
```

- **Group by work item**, never by status or by source. One item per project / PR stack /
  support thread; support threads go under a `Firefighting` bucket when there are several (or an
  `On-call` bucket for threads worked during an on-call shift, if the user rotates through one).
- Terse, lowercase-first fragments, no trailing periods: `found root cause, ran prod fix`,
  `implemented plan, PRs need self review`, `QA'd, merged`.
- **Status = end of day**, from the strongest evidence: merged > applied in prod > PR opened >
  in review > WIP.
- **Bold** only for a next step a session or thread explicitly leaves with *the user*
  (`**backfill dry run done, need to run it for real**`, an unanswered question to them in a thread) — not
  for things others owe, and at most 2–3 per day.
- **Item labels for continuing work**: reuse the previous Summary's labels so **status-update**
  can key items across days; flag a borrowed label as a guess.
- Typical day: 3–8 top-level items. A heavy day can run longer — don't cut real work.
- App-specific page links in the user's notes (`obsidian://…`, `notion://…`) can't be
  generated. Keep any they pasted; otherwise use a plain label.

**With a partial summary**: keep every line of theirs as written, slot new items and children in
next to related ones, and only change a status they wrote if a source shows a newer one (list
each change).

## Phase 4 — present

1. **Coverage line** — counts of things that fed the Summary, not raw hits: `Wed 03/04 (as of
   15:20) — 5 Claude Code sessions, 2 cloud-agent tasks, 3 PRs moved by me (+2 reviews received),
   6 chat messages, 1 issue`. Each transcript file counts once; empty sessions don't count.
   Add "as of HH:MM" when the day isn't over, and name any source that was skipped.
2. **The Summary** in one fenced ```` ```markdown ```` block, ready to paste under `## Summary`.
3. **Notes**, short:
   - `Added:` items that weren't in their input (when they gave one).
   - `Changed:` statuses updated from their input, with the evidence.
   - `Flagged:` `[?: …]` items to confirm.
   - `Left out:` things seen but judged noise (cron ticks, a 1-minute question), so they can pull
     any back in.
4. One line: *"Edit here or tell me what to change."* Re-show the full Summary after each change.

## Verified gotchas

- **Sessions span days.** A session opened two weeks ago can be active today; the digest filters
  records by timestamp, not by file. Don't attribute a session's whole history to today.
- **Timestamps are UTC in every source** (transcripts, GitHub, cloud agents). The digest
  converts to local time; do the same for the rest — an evening merge west of UTC is "tomorrow"
  in UTC.
- **The session title is the best one-line label** when the user names sessions deliberately.
  Untitled sessions are usually quick one-off questions.
- **`pr-link` records only associate a PR with a session** — they're re-emitted on resume, so a
  session that changed nothing today still lists its PR. Confirm what happened with `gh pr view`.
- **Polling sessions** (**cloud-agent-work**, **pr-triage** watchers) emit dozens of "No change."
  ticks; the digest counts them and keeps the replies that mention an outcome (merged, opened,
  applied, published…). The busiest session can still push early outcomes out — GitHub fills
  those in.
- **Prompts that are just a file path** (`…/02-backfill-output.txt`), if the user runs
  production scripts through **prod-script**, are them pasting its output back — the session ran
  a prod script; the reply after it says what it showed.

## How this composes

- **status-update** consumes these Summaries; matching the Summary format here keeps that
  pipeline clean (items keyed by PR/thread, statuses in children, a `Firefighting` bucket).
- **bug-intake / warehouse-data / prod-script / cloud-agent-work** sessions are the most common
  items; their slash commands and skill names in the digest identify them.
- **mine-sessions** reads the same transcripts for a different purpose (skill mining) — don't
  confuse the two.

## When not to use

- The periodic status post → **status-update**.
- A write-up of one investigation → **research-doc** / **visual-explainer**.
