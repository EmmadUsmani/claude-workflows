# Worked examples

Two invented runs, written from the rules in `SKILL.md` and `style.md`. The user maintains an
open-source link checker (`hrefcheck`, with a co-maintainer, Sam) and a small event-signup app
(`potluck`), and posts to `#dev-updates` on `status_cadence: tue,thu`. Every name, number, time and
link is made up; `p0000000000…` thread ids are placeholders. Notes after `→` explain a choice and
are not part of the output.

---

## Run A — no notes at all (Thursday 04/16)

The user typed `/status-update` and nothing else.

**What Phase 1 found.** The last post is Tue 04/14, 4:05 PM. Its L1s were `Calendar Sync` and
`Firefighting`; under Firefighting it carried `Stale RSVP counts ([issue](…/issues/112))` with
"fix merged, need to run the recount in prod".

**What the sweeps found** (window Tue 04/14 4:05 PM → now):
- Sessions: `calendar-sync-ics-feed` (04/14 evening + 04/15), `rsvp-recount` (04/15, ran a prod
  script, reply "recount applied, 0 mismatches left"), `sams-backoff-change` (04/16), and an
  untitled one-question session.
- GitHub: #171, #172, #173 (a stack, #171 the base, body says "1 of 3"), all authored by the user,
  open; Sam's hrefcheck #118 with a review from the user (changes requested).
- Issues: the user commented on and closed potluck #112.
- Chat: one thread in `#support` the user replied in — Maya asking why an event's ICS link 404s.

### Draft

```markdown
Thursday 04/16
- Calendar Sync
    - Built the ICS feed per event, hosts can subscribe from the event page
        - New 3 PR stack, base PR: [Serve an ICS feed for each published event #171](https://github.com/example-dev/potluck/pull/171)
        - Need to review myself
- PR reviews
    - Reviewed Sam's retry PR, asked for Retry-After date handling before it merges: [Back off on 429 using Retry-After #118](https://github.com/example-dev/hrefcheck/pull/118)
- Firefighting
    - Stale RSVP counts ([issue](https://github.com/example-dev/potluck/issues/112))
        - ran the recount in prod, no mismatches left, closed the issue
    - ICS link 404 for unpublished events raised by Maya ([thread](https://example.slack.com/archives/CHELP0001/p0000000000001101))
        - expected for drafts, the feed only exists once an event is published, replied in thread
```

→ `Calendar Sync` keeps the previous post's name. The stack size and base come from #171's body
and `baseRefName`, not from any note. "Need to review myself" is there because no session of the
user's reviewed #171–#173 — they were written in the `calendar-sync-ics-feed` session.
→ The review of Sam's PR doesn't belong to a workstream of the user's, so it gets the `PR reviews`
side L1, listed as an optional cut.
→ The carried issue moves from "need to run the recount" to done, so it's news; it uses `([issue](…))`
because the report came in as a tracker issue.
→ Maya's thread is in because the user replied in it; the outcome comes from the thread itself.

**Shown under the draft:**
- `Covers Tue 04/14 4:05 PM → Thu 04/16 (notes: none). Research: 4 Claude Code sessions over 3 days, 4 PRs (+1 reviewed), 1 issue, 1 chat thread. Status cutoff: now.`
- `Flagged:` PR reviews L1 is an optional cut. The untitled session (a one-line question about ICS
  MIME types) was folded into Calendar Sync, not listed.
- `Sources:` Calendar Sync ← `calendar-sync-ics-feed`, gh #171–#173. Stale RSVP counts ←
  `rsvp-recount`, issue #112. ICS 404 ← `#support` thread.

---

## Run B — two loose lines of notes (Tuesday 04/21)

The user pasted:

```text
mostly the gzip sitemap work this time
also the waitlist email fire on monday, claude fixed it
```

**What Phase 1 found.** The last post is Thu 04/16, 10:30 AM — so the Run A draft went out
later that morning, with Calendar Sync still "need to review myself".

**What the sweeps found:**
- Sessions: `hrefcheck-gzip-sitemaps` (three days), `waitlist-double-send` (Monday, a
  `/bug-intake <permalink>` from Leo's thread), and a session that recorded a demo with the
  screen recorder.
- GitHub: hrefcheck #121 merged, #122 open (gzip sitemaps); potluck #176 opened by Claude in
  `waitlist-double-send`, merged this morning at 9:40; #171–#173 merged on Friday.
- An artifact published from `hrefcheck-gzip-sitemaps` on 04/17.

### Draft (status cutoff 9:15 AM, before #176 merged)

```markdown
Tuesday 04/21
- Sitemap Crawler
    - Gzip sitemaps are in: `.xml.gz` files are streamed instead of loaded whole
        - merged - [Stream gzip sitemaps instead of buffering them #121](https://github.com/example-dev/hrefcheck/pull/121)
        - plan artifact: [claude.ai/artifact/…](https://claude.ai/artifact/00000000-example-gzip)
    - Next is sitemap index files: [Follow sitemap index files one level deep #122](https://github.com/example-dev/hrefcheck/pull/122)
        - needs review
        - see attached demo
- Calendar Sync
    - PR stack merged, hosts can subscribe to an event's ICS feed now
- Firefighting
    - Waitlist emails sent twice raised by Leo ([thread](https://example.slack.com/archives/CHELP0001/p0000000000001202))
        - Claude found the cause and opened a fix: [Skip the digest when this event's send is already queued #176](https://github.com/example-dev/potluck/pull/176)
        - needs my review
```

→ "mostly the gzip sitemap work" made Sitemap Crawler the first L1 and the deepest.
→ Calendar Sync wasn't in the notes; research added it because its status moved (merged Friday)
since the last post said "need to review myself". Listed under `Added:`.
→ The notes said "claude fixed it"; GitHub said open at the 9:15 cutoff, so the line reads "needs my
review". Re-drafted after 9:40 it would be `merged - […#176](…)`.
→ The demo came from the recording session; the user confirmed they'd attach it.

**Shown under the draft:**
- `Covers Thu 04/16 10:30 AM → Tue 04/21 (notes: 2 loose lines, set the order). Research: 5 Claude Code sessions, 5 PRs, 1 chat thread, 1 artifact. Status cutoff: 9:15 AM.`
- `Looked up:` #176 was opened by Claude in `waitlist-double-send`; no session shows the user
  reviewing it.
- `Added:` Calendar Sync (merged since the last post).
- `Flagged:` #176 merged at 9:40 — it would read `merged` in a later post.

---

## What research can't supply

- **Why**: why the user chose an approach, how a side project felt, what they thought of a review.
  Write the plain factual line and let them add it in the feedback round; read the linked thread
  or issue when it might say.
- **What they did offline**, and **whether they reviewed AI-written code** when no session shows
  it. Mark those `[?: …]` instead of guessing.
