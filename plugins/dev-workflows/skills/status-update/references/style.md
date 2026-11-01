# Status-update style guide

The format the user's updates follow. If they have past posts in `<status_channel>`, copy the
shape of the most recent ones over this file — this is the default, theirs wins. Examples use an
invented open-source link-checker CLI (`hrefcheck`) and an event-signup web app (`potluck`).

## Shape

```
Thursday 03/12
- <Workstream>                       ← main projects first, roughly the priorities order if there is one
    - <what changed>
        - <detail / link / number / TL;DR>
- <Side item>                        ← side project, demo video, small standalone PR, tooling
    - …
- Firefighting                       ← always last, plain bullet, no bold or colon; omitted when empty
    - <Issue> raised by <FirstName> ([thread](…))
        - <PR line>
        - <status>
```

- **Header**: `<Weekday> MM/DD` (e.g. `Tuesday 03/10`), zero-padded (`03/05`), alone on line 1,
  first bullet on line 2. No year, greeting, emoji, bold, "check-in", or closing line — the post
  ends on its last bullet. (Configurable: if past posts use another header, copy it.)
- **No status headings** (no Shipped / In progress / Next / Blockers). Status lives in sub-bullets.
- **A handful of L1 bullets**, each a short name. Usually 3 levels deep; a 4th for a PR under an
  explanation (`Claude investigated and created a fix` → PR one level down). A few hundred words.
- **Every active workstream gets a line even with no progress**: `Have been preoccupied with
  support, will continue working on this soon`, `Waiting on feedback before the next step`,
  `Will pick this back up soon`, `Punting for now, will return in the coming weeks`.
- **Workstream names are stable across posts** (reuse the previous post's), occasionally refined
  (`Crawler` → `Sitemap Crawler`).

### L1 kinds

1. Plain project name, Title Case: `Sitemap Crawler`, `Waitlist Emails`, `Config V2` — but a repo
   or product name keeps its own casing (`hrefcheck`, `potluck`).
2. A project doc as the title: `- [Config v2 design](<doc url>)`.
3. A single small PR as the title, with one explaining sub-bullet:
   ```
   - [Print a summary line when every link passes #66](https://github.com/example-dev/hrefcheck/pull/66)
       - small quality-of-life fix for CI logs, merged
   ```
4. A side item with links in one parenthesis: `- hrefcheck GitHub Action ([thread](…), [repo](…))`.
5. `- Firefighting`.

### Firefighting

- One L2 per issue: `<Short issue description> raised by <FirstName> ([thread](<permalink>))`.
  Variants: `Issue with <problem> raised by <Name>`, `request from <Name> to <ask> ([thread](…))`,
  `Follow-up timezone issue raised by Leo`.
- **Tracker issues** (common for open-source support): same shape, the link word is `issue` —
  `Redirect loop raised by Ines ([issue](<issue url>))`. The issue author is the requester.
- A long-running issue gets a **short name** and drops "raised by": `Duplicate waitlist emails
  ([thread](…))`. It's carried in every post until resolved.
- L3 under an issue: each PR on its own line; status lines; a one-line root cause (`turns out …`,
  `bug was introduced by …`, `Problem is that …`); numbers when the thread has them; the outcome
  (`ran the backfill in prod, no duplicates since :relieved:`).
- **On-call sub-bullet** (only if the user rotates through a support duty in a support channel):
  general support issues are Firefighting's L2s, then a final `- On-call` L2 whose children are
  the support-channel threads they worked during a shift, same `raised by <Name> ([thread](…))`
  shape, one level deeper. Threads in other channels, or in the support channel off-shift, stay
  plain Firefighting L2s. Bot-raised items (an error-tracker alert) drop "raised by": `Error
  spike in the export worker ([thread](…))`. Small requests keep the `request from <Name> to …`
  form.
  ```
  - Firefighting
      - Request from Maya to add an allergy column to exports ([thread](…))
          - merged - [Add an allergies column to the CSV export #148](…)
      - On-call
          - RSVP page 500 raised by Noah ([thread](…))
              - merged - [Handle an event with no end time on the RSVP page #146](…)
  ```

## Links — always anchors, never bare URLs

| Kind | Anchor |
|---|---|
| GitHub PR | **Exact PR title + ` #N`**: `[Stop following a redirect that points back to a visited URL #79](https://github.com/example-dev/hrefcheck/pull/79)`. github.com only, never a stacked-PR tool's mirror. |
| Chat thread | The word `thread`, in parentheses, at the end of the line: `raised by Maya ([thread](…))`. Keep `?thread_ts=…&cid=…` on reply permalinks. In prose: `Details on how I made this are in the [thread](…)`, `originally from this [thread](…) by Leo`. |
| Tracker issue | The word `issue`: `([issue](…))`. |
| Doc | Page title, after a label: `wrote up the options: [Docs Theme Options](…)`, `Created tech doc: [Waitlist Digest Design](…)`. |
| Claude artifact | Label, colon, display-URL anchor with a real `…`: `implementation plan artifact: [claude.ai/artifact/…](<url>)`. |
| App / admin URL | Display URL without scheme, `…`-truncated: `[potluck.example.dev/admin/events](…)`. |
| Dashboard | Dashboard name: `[Exports — Latency](…)`. |
| Channel | A real channel mention (`<#CHANNELID>` in Slack), never a typed `#name`. |

- **One PR per line.** Several PRs → sibling lines. A stack → base PR + count:
  `New 3 PR stack, base PR: [<title> #57](…)`.
- PR line forms: alone; status prefix `merged - [<title> #N](…)`; after a label `PR was opened by
  claude: [<title> #N](…)`, `same fix already in the CLI: [<title> #N](…)`.
- Two links sharing a parenthesis: `([thread](…), [repo](…))`.

## Voice

- **Fragments, no trailing period.** Questions to a reader end in `?`.
- Done → past tense, verb-first: `Reviewed the robots.txt PR, waiting on his changes now`,
  `Split the work into a stack`, `wrote and ran a backfill for this`.
- In progress → `Working on …`, `Am building …`, `looking into it`.
- Next → `Will …`. Blocked/owed → `Need to review myself`, `needs my review`, `need to rerun the
  backfill`.
- Clauses chained with commas — status, then next step: `fix is merged, dry run of the backfill
  looked right, need to run it for real`.
- Subject dropped; "I" only for opinions: `not a fan of the approach it took, I'm trying a
  simpler fix`.
- Capitalization: L1 always capitalized (except repo/product names); L2 mostly; L3+ and status
  lines usually lowercase (`merged - …`, `needs my review`, `see attached demo`).
- Shorthand: `+` for "and" (`review + follow-up fixes`), `e.g.`, `TL;DR`, `->` for flows,
  occasional `imo`/`lmk`. Jargon the readers share goes unexplained.
- **Call out AI-authored work and its review state**: `Claude investigated and created a fix` →
  `needs my review`; `PR was opened by claude: …`; `made with <cloud agent>`.
- Meetings appear as facts under the workstream (`agreed the order with Sam in our weekly
  call`), never their own section. Decisions and dead ends stated plainly.
- Numbers whenever the notes/thread have them.
- **People**: first names, plain text. A real @-mention only for a direct ask (`@sam lmk which
  one you'd prefer`); no "you" otherwise.
- **Emoji**: at most one or two per post, reactive, at line end (`:grimacing:`, `:relieved:`).
  Never in the header. Only where the notes justify the sentiment — don't add flair.
- **Never bold or italic.** Backticks only for code identifiers (`max_redirects`,
  `SendWaitlistDigest`).
- Attachments are pointed at in the text (`see attached demo`, `Video attached below`, `(see
  before+after screenshots)`) and ride on the same message.
- Casual register is fine; don't reproduce typos.

## Notes → post vocabulary

| In the notes | In the post |
|---|---|
| `noah RSVP count off by one ([thread](…))` | `RSVP count off by one raised by Noah ([thread](…))` |
| `[export times out for big events](<chat link>) - raised by maya` | `CSV export timing out for large events raised by Maya ([thread](…))` |
| `ines redirect loop ([issue](…))` | `Redirect loop raised by Ines ([issue](…))` |
| `[✅ Waitlist digest](obsidian://…) - backfill` | `Duplicate waitlist emails ([thread](…))` (the name from previous posts) |
| `[✏️ Sitemap crawler](obsidian://…) - gzip sitemaps` | `Sitemap Crawler` |
| `crawler` / `splitting into PRs` | `Sitemap Crawler` / `Split the work into a stack, sitemap parsing first` |
| `reviewed Sam's PR, left comments` | `Reviewed the robots.txt PR, waiting on his changes now` |
| `merged, fix live` (×2 PRs on one issue) | both PR lines, then `PRs merged, fix is live` |
| `merged` on one PR | `merged - [<title> #N](…)` |
| `**backfill dry run done, need to run it for real**` | `fix is merged, dry run of the backfill looked right, need to run it for real` |
| `plan: [https://claude.ai/artifact/X](…)` | `[claude.ai/artifact/…](…)` under the workstream |
| `action: [https://…](…)` / `announcement: [<chat url>](…)` | `hrefcheck GitHub Action ([thread](…), [repo](…))` |
| `docs theme` / `wrote up options` | `Docs Site` / `wrote up the theme options: [Docs Theme Options](<doc>)` — doc link looked up |
| `Firefighting` / person-issue buckets | L2s under the trailing `Firefighting` |
| `On-call` bucket (support-channel threads from a shift) | under `Firefighting` → `On-call`; other threads from that day stay plain Firefighting |
| Page-label emoji `✅ ❌ ⏸️ ✏️` | dropped |
| `needs review` on a PR Claude/the cloud agent wrote | `needs my review` (they haven't read it yet) vs `needs review` (waiting on others) — check which |
