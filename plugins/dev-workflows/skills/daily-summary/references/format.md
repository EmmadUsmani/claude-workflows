# Daily-note `## Summary` format

The shape the user's Summaries take. If they already have past daily notes, copy the shape of the
most recent ones over this file — this is the default, theirs wins.

## Shape

- A plain Markdown list: `- ` markers, **4-space nesting**, up to 3 levels. No checkboxes, no
  headings inside, no trailing periods.
- **One top-level bullet per work item**: a project, a PR, a support thread, or a bucket.
  - Project: `- Sitemap crawler`, `- Waitlist emails`, or a note-app page link they
    pasted (`[Config v2](obsidian://open?vault=notes&file=…) - schema migration`).
  - Support thread: `<person> <issue> ([thread](<permalink>))`, lowercase person first —
    `- noah RSVP count off by one ([thread](…))`, `- ines redirect loop ([issue](…))`.
  - Buckets when several of a kind: `Firefighting` (support issues), `On-call` (threads worked
    during an on-call shift, if the user has one — the shift runs from their shift-start post to
    their shift-end post in the support channel; that channel's threads outside the shift, and
    threads in other channels, are `Firefighting`), `Tooling`, `Release`.
- **Children** hold PR links and status phrases; status sits one level under its PR.
- A typical Summary is short — a few dozen words, 2–6 top-level items; heavy days (support +
  project work) run longer.

## Voice

Terse, telegraphic, lowercase-first, implicit "I": `found root cause, ran prod fix`, `addressed review
comments, widened the fix to relative links too`, `sketched the approach, flag-gated for now`,
`implemented plan, PRs need self review`. Fix typos; don't copy them.

**Status vocabulary** (common phrases, no particular order): `merged`, `working on`, `started`, `WIP`, `needs
review`, `awaiting review`, `approved`, `PR up`, `continued work`, `found root cause`, `live in
prod`, `ready for review`, `need to review`, `submitted for review`, `draft`, `done`,
`investigating`, `in progress`, `fix live`, `ran prod fix`, `QA'd, merged`, `needs self review`,
`ran in prod, issue fixed now`, `ran data fix in prod`, `released`, `canceled`, `closed`.

**Bold** = needs the user's action next: `**backfill dry run done, need to run it for real**`.

## Links

- PR: `[<exact PR title>](https://github.com/<owner>/<repo>/pull/<n>)` — the title as the anchor
  (no `#N` appended), optionally prefixed `PR: `. One PR per line; several PRs → sibling lines.
- Chat thread: the word `thread` — `([thread](<permalink>))` at the end of the item's line. When the
  report came in as a tracker issue (common for open-source work), link it the same way with the
  word `issue`: `([issue](<issue url>))`.
- Claude artifact: `plan: [<url>](<url>)` or `<label>: [<url>](<url>)`.
- Doc: page title as anchor. Tracker ticket: `[<KEY-123>: <Title>](<ticket url>)` or
  `[#<n>: <Title>](<issue url>)` for GitHub issues.
- Backticks for code identifiers (`RobotsCache`, `SendWaitlistDigest`).

## Examples

Invented illustrations of the format — a developer maintaining an open-source link-checker CLI
(`hrefcheck`) and a small event-signup web app (`potluck`). Every name, number and link is made
up; the `p0000000000…` thread ids are placeholders.

### 2026-03-04 (Wednesday)

```markdown
- Sitemap crawler
    - sketched the approach, flag-gated for now
    - [Crawl sitemap.xml before falling back to link discovery](https://github.com/example-dev/hrefcheck/pull/57)
        - needs self review
- Firefighting
    - noah RSVP count off by one ([thread](https://example.slack.com/archives/CHELP0001/p0000000000000101))
        - [Count the host once when they also RSVP](https://github.com/example-dev/potluck/pull/143)
            - merged, fix live
    - ines redirect loop ([issue](https://github.com/example-dev/hrefcheck/issues/76))
        - found root cause, a trailing-slash rule on her server
        - [Stop following a redirect that points back to a visited URL](https://github.com/example-dev/hrefcheck/pull/79)
            - PR up
- Release
    - cut v0.7.0, changelog + tag
        - released
```

### 2026-03-03 (Tuesday, on-call day)

```markdown
- On-call
    - maya waitlist emails sent twice ([thread](https://example.slack.com/archives/CHELP0001/p0000000000000202))
        - PR: [Mark the waitlist digest sent before enqueueing it](https://github.com/example-dev/potluck/pull/139)
        - **backfill dry run done, need to run it for real**
    - CSV export timing out for large events ([thread](https://example.slack.com/archives/CHELP0001/p0000000000000303))
        - investigating, likely the N+1 on dietary notes
- [Config v2](obsidian://open?vault=notes&file=Config%20v2) - schema migration
    - addressed review comments, widened the fix to relative links too
    - [Read hrefcheck.toml before the legacy .hrefcheckrc](https://github.com/example-dev/hrefcheck/pull/55)
        - approved
```

### 2026-02-24 (Tuesday, mostly one project)

```markdown
- Waitlist emails
    - implemented plan, PRs need self review
    - [Add a waitlist table and position column](https://github.com/example-dev/potluck/pull/128)
    - [Send a daily digest to people who moved up the waitlist](https://github.com/example-dev/potluck/pull/129)
- Tooling
    - moved CI to the repo's own runner image: [Build the CI image from the Dockerfile in the repo](https://github.com/example-dev/potluck/pull/131)
        - merged
```
