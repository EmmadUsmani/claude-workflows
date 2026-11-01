# bug-intake — reference

Long-tail for **[SKILL.md](SKILL.md)**: intake mechanics, the log/exception split, the
prod-script request shapes that recur in bug RCA, and the write-up templates.

---

## 1. Chat intake mechanics (`chat: slack`)

Slack is the adapter this was built and verified on; another `<chat>` tool needs the same three
things — read a thread by its parent id, read attachments, search for mentions.

`ToolSearch 'select:mcp__claude_ai_Slack__slack_read_thread,mcp__claude_ai_Slack__slack_read_file,mcp__claude_ai_Slack__slack_search_public_and_private,mcp__claude_ai_Slack__slack_get_reactions'`
first — these are deferred tools.

A Slack thread link looks like:

```
https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<17 digits>[?thread_ts=<ts>&cid=<CHANNEL_ID>]
```

- `channel_id` = the `/archives/<…>` segment (same as `cid=`).
- `message_ts` = the **parent message's** ts. Take the `thread_ts=` query value when the link
  points at a reply; otherwise convert the `p` segment by inserting a decimal six digits from
  the end (`p2040003600000200` → `2040003600.000200`; the values here are invented).
- The parameter is named `message_ts`. Passing `thread_ts` fails with
  `initialization_failed: Missing value for parameter message_ts` — a wasted round trip every time.

```jsonc
{"channel_id": "<CHANNEL_ID>", "message_ts": "2040003600.000200"}
// long thread, and the link pointed at a specific reply — jump in there:
{"channel_id": "<CHANNEL_ID>", "message_ts": "<thread_ts>", "oldest": "<linked-message-ts>"}
```

- **Read the images.** `slack_read_file` with each `F…` file id from the thread. The actual
  symptom is usually in a screenshot, not in the prose, and two screenshots side by side are
  often the whole diagnosis. **For an image it returns base64, not a rendering** — write the
  decoded bytes to a file in the investigation's `adhoc/` dir and `Read` that file. Looking at
  the base64 is not looking at the screenshot.
- **Read any thread the thread links to.** A prior instance is precedent and frequently
  contains the answer already; the reporter linking it is them telling you so.
- `channel_not_found` ⇒ `slack_search_channels` / `slack_search_public` on the id. It is often a
  shared (cross-organization) channel with a vendor, which is itself a fact about who owns the bug.

**Finding the threads that mention you.** `to:me` returns nothing. The query that works, with
your own Slack user id:

```jsonc
mcp__claude_ai_Slack__slack_search_public_and_private {
  "query": "<@YOUR_USER_ID> -from:<@YOUR_USER_ID> after:YYYY-MM-DD",
  "sort": "timestamp",
  "channel_types": "public_channel,private_channel"
}
```

Results carry the channel id, `Message_ts` and a permalink (with `thread_ts=` when the hit is a
reply — that value is the parent ts `slack_read_thread` wants).

**Reactions: counts are not reactors.** `slack_read_channel` (and the thread read) shows a
reaction *count* only. To answer "did a specific person react?" — e.g. "has this already been
acknowledged?" — call `slack_get_reactions` on the message, which returns the reactor user ids.

## 2. Issue-tracker intake mechanics

`<issue_tracker>` decides the tools. The shape is always the same: read the issue **with its
relations**, read the comments (they usually hold the reporter's own words; the description
often doesn't), search for prior art by symptom keywords, and create/update **only when the user
asks for a ticket**.

| `<issue_tracker>` | Read | Comments | Prior art | Write (only on request) |
|---|---|---|---|---|
| `github` | `gh issue view <n> -R <owner>/<repo> --comments` (always pass `-R` — the issue usually lives in a repo other than the cwd) | (same call) | `gh issue list -R <owner>/<repo> --search "<kw>" --state all` | `gh issue create -R <owner>/<repo>` |
| `linear` | `mcp__claude_ai_Linear__get_issue {"id": "ABC-123", "includeRelations": true}` — the param is `id`, not `issueId` | `list_comments` | `list_issues` | `save_issue` |
| `jira` *(unverified adapter — never run with this skill)* | your Jira MCP / CLI's issue view | — | JQL search | — |

The `github` and `linear` rows have been exercised; treat `jira` as a sketch to confirm on first use.

## 3. Logs vs exceptions — the split that wastes the most time

| You want | Where it usually is |
|---|---|
| Request/job timeline, SQL, timings, "what happened at 15:19 UTC" | `<log_search>` |
| Exception, stack trace, breadcrumbs, frequency | `<error_tracker>` — in the setup this was built on, exceptions were **not** in the log search at all; check yours once and write it down |
| A human's action in the admin/back office | whichever log source the admin app writes to — often a separate source from the main app's |
| "When was this bad state written?" | the audit trail (below) |

Know your log sources by name before querying (main web app, admin, each worker pool). With an
MCP-backed log search, **always read the tool's query help for the source before composing a
query** — a guessed collection/table name errors, and a query on a top-level field can return
**zero rows with no error** when the structured-logging payload is JSON-in-a-string inside the
message field. Full query mechanics live in **prod-script**'s REFERENCE.

**The correlation-id trick.** When the report carries an `<error_tracker>` link, pull the issue
and extract its correlation ids (trace id, `X-Request-Id`, the background job id), then search
the logs for those **exact** values instead of a fuzzy time window. It turns an hour of
log-scrolling into one query.

**Audit trail.** If the model is versioned (PaperTrail in Rails, `django-simple-history`, a
hand-rolled `audit_logs` table), confirm *this* model is actually tracked before relying on it:

```ruby
record.versions.reorder(:created_at)
record.versions.reorder(:created_at).last.reify.<attr>
```

Bulk writes (`update_all`, raw SQL) bypass model callbacks and leave **no** version rows.

## 4. "Which PR made this change, and who authored it?"

```bash
git log --all --oneline -i --grep="<kw1>" --grep="<kw2>" -E | head -30
git log -1 --format='%an %ae %ad' <sha>
gh api repos/<owner>/<repo>/commits/<sha>/pulls --jq '.[] | {number, title, url}'
gh pr list --search "<sha>" --state all --json number,title,url,author   # fallback
git log -L <start>,<end>:<path/to/file.rb>                               # date a suspicious block
```

Squash-merge commit messages routinely omit the PR number, so the `commits/<sha>/pulls` lookup
is the reliable one. Be ready for the answer to be the user's own earlier PR — say so plainly.

---

## 5. Prod-script request shapes that recur in bug RCA

**prod-script** owns the script rules (halt lambda, per-section `rescue`, version banner,
COPY-FROM-HERE fence, read-only guards, DRY_RUN gate). What follows is only *what to ask for*
in a bug investigation, so the first paste-back settles the question instead of the third.

**Try each shape as `<warehouse>` SQL first** (**warehouse-data**: schema map, freshness, gaps).
The subject row, the denormalized copies and the population count are usually one query each
over the mirrored tables; the audit-trail timeline (5a.2) and anything needing the application's
own eligibility logic are what fall through to a script. The population count, for example:

```sql
SELECT status, COUNT(*) AS n, MIN(created_at), MAX(updated_at)
FROM <mirror_schema>.invoices
WHERE <the hypothesis predicate, translated from the application scope>
GROUP BY status;
```

### 5a. `01_diagnose.rb` — the four things to dump every time

1. **The subject row, raw.** Read the raw column, not the accessor — accessors have lazy write
   paths. Include `id`, `created_at`, `updated_at`, and every field the hypothesis touches.
2. **The timeline.** `record.versions.reorder(:created_at).pluck(:created_at, :event, :whodunnit)`
   plus the timestamps of the jobs/syncs the reporter believes refreshed it.
3. **Every denormalized copy** you enumerated in the cache sweep (SKILL.md Phase 2), each with
   its own timestamp, so "did the sync refresh this?" is answered per copy rather than in
   aggregate.
4. **The population count** — how many other records match the same predicate. This is the
   difference between "one customer's row" and "a class of bad state", and it decides whether
   Phase 6 gets a self-heal ticket.

Ask for all four in one script. A second round trip costs the human a context switch.

### 5b. `03_blast_radius.rb` — before any repair

Capped at a few dozen, tallied into **named buckets** (`fixable` / `no_change_needed` /
`skip_<reason>` / `failed`), each line carrying a **clickable link for the object a human acts
on** (an admin page when the app has one) — the object the operator recognizes, not an internal
join-table id. Build the URL from the app's own configured host, never by hand.

*Stack note:* the script names and snippets in §5 are Rails/ActiveRecord because that is where
this procedure was proven; on another stack the same four dumps, buckets and DRY_RUN gate run
through its own runner (`node script.js`, `python manage.py shell -c`, a SQL file against a
replica) — the shape, not the syntax, is the rule.

Derive candidates through **the same eligibility chain the real fix will use**, never a
hand-rolled query — otherwise the datafix and the code fix disagree about who was affected.

### 5c. `NN_remediate.rb` — the immediate repair

Full template in **prod-script**'s repair phase. The bug-intake-specific additions:

- The header states **which ticket / thread this is remediating** and that the code fix is
  still outstanding (link the PR once it exists).
- The dry run prints the would-be-**new** value, not the current one.
- Save the pre-change JSON dump under `== BACKUP:` — that is the rollback, and it is also the
  before-state for the verification re-run.
- **State the expected dry-run numbers per bucket before they run it** — "expect N repaired,
  M already correct, zero UNMATCHED. If the plan differs, stop and paste it back." Then flip
  `DRY_RUN = false` only after you have checked every field-level diff.
- After apply, verify by **re-running `01_diagnose.rb` and diffing against the saved output**.
  Don't write bespoke verification.
- **Then audit every denormalized copy again.** A rename does not regenerate a slug (a slug
  generated `if: :new_record?` never changes), and associated records — cached names, search
  documents, exports — can still carry the old value. This has been caught by the user after a
  "successful" apply.

### Promote to a committed data-fix class when

The user's stated preference when offered both is the lighter one: *"A console paste is fine,
I'll take that."* Promote only when it must be auditable, repeatable, or run against a
population rather than a handful of rows: a data-fix class in the repo's own convention
(a dedicated repairs dir such as `app/repairs/<namespace>/<name>.rb`, a `lib/tasks/*.rake` task, a one-off migration — grep
for an existing one and copy its shape) plus a spec. Watch for a `dry_run:` default that differs
between the class's entry points — check **prod-script**'s REFERENCE for the footguns. Confirm
prod has actually **deployed** the PR that adds the class before telling anyone to run it;
merged ≠ deployed.

---

## 6. Templates

### 6a. The verdict / intake report

```markdown
## Verdict
<Correct | Correct in spirit, incomplete | Incorrect> — one sentence.

## What the code actually does
1. <step> — `path/file.rb:123`
2. …

## Copies of this data
| Copy | Refreshed by the described process? | Evidence |
|---|---|---|
| <column / slug / derivative / export / FE cache> | yes / no / unknown | `file:line` or prod dump |

## Proven vs inferred
- Proven: …
- Inferred (and what would confirm it): …

## Discriminating check
The one query / log line / image fetch that decides it — and an offer to write it.

## Not covered
Scope of the trace; tenants, records or surfaces not surveyed.

RCA explainer: <path> · <Artifact URL>
```

### 6b. Issue-tracker ticket framing

- **Title and intro = the observable symptom plus the business impact.** RCA and the proposed
  fix come *later* in the body, not in the title.
- **Disambiguate colliding class names** every time you name one (`Billing::Invoice` vs
  `::Invoice`).
- **Pin every line-number citation to a commit SHA** — `path/file.rb:123` at `<sha>` — because
  the line moves and the ticket doesn't.
- **Trace the outward consumer path**, even when the crash was first found somewhere else. The
  ticket's reader cares which surface breaks for whom.
- **Link the admin page where an operator acts**, not the internal record.
- **Use non-closing magic words for sub-issues.** `Part of ABC-41.` links the issue without
  auto-closing it on merge; reserve `Fixes ABC-38.` for the one ticket the PR really closes.
  (Check which words your tracker treats as closing.)
- **Offer, don't file.** A durable finding that surfaced mid-investigation but isn't the task
  gets an explicit offer — *"want me to file it as a ticket so it's tracked outside this
  thread?"* — never an unprompted create.

```markdown
**Symptom.** <what a human sees, and for whom>
**Impact.** <how many, since when, what it blocks>

**Root cause.** <mechanism> — `path/file.rb:123` @ `<sha>`
**Affected population.** <count from the blast-radius sweep>

**Immediate remediation.** <done / proposed> — `<sandbox_dir>/adhoc/<date>-<slug>/NN_remediate.rb`
**Permanent fix.** <PR link or "not started">
**Follow-ups.** self-heal: … · observability: … · cleanup: …

Admin (if the app has one): <admin host>/<resource>/<id>
```

### 6c. Follow-up tickets

**Self-heal** — "when the system next encounters this state class, it repairs it instead of
failing":

```markdown
**State class.** <the exact condition, as a predicate you could write in code>
**Detected where.** <the guard / rescue that already sees it> — `file:line` @ `<sha>`
**Heal action.** <the one recovery step> — attempted **once**, never in a retry loop.
**Stays broken when.** <the condition under which staying in the bad state is correct>
**Logs.** `<domain>.<operation>.recovery_attempted` / `recovery_succeeded` / `recovery_failed`, with the record id.
**Manual override.** <the admin button> — an override for impatience, not the mechanism.
```

Two shapes worth copying — grep the repo for an existing instance of each before proposing one:

- **Idempotent re-check on the next scheduled run.** A record that entered a bad state is
  re-evaluated by the job that already runs on a schedule, and leaves that state on its own once
  the cause clears — e.g. a webhook subscription marked `failing` re-verifies its endpoint on the
  next scheduled delivery run and stays `failing` only while the endpoint still rejects it. A
  "Retry now" button that calls the same check is a manual override so nobody has to wait for the
  schedule, **not** the repair mechanism.
- **Heal-once inside the failing call.** Guarded by a **failure-signature predicate** (one
  specific error, not every error), the call performs one recovery step and retries once — e.g.
  on an "access token expired" response, refresh the OAuth token and retry the request once. When
  the recovery has nothing to work with (no refresh token on file), re-raise the original error
  untouched. Emit `<domain>.<operation>.recovery_attempted` / `recovery_succeeded` /
  `recovery_failed`.

When a self-heal ships, **update the operator doc to say the system heals itself and the button
is only a manual override** — otherwise the admin banner and the code disagree.

**Observability** — "this would have been caught on day one":

```markdown
**Signal.** <the outcome hook that fires — not a rescue block>
**Where.** a scheduled monitor job · <log_search> alert · <error_tracker>
**Payload.** <the upstream status code, the truncated response body, the reason string>
**Routing.** <the owning team's alerts channel>, cc the owning group
**Action link.** <admin host>/<resource>/<id>  ← required
```

- **Instrument the outcome, not the error branch.** Alert on *every* record that reaches the bad
  outcome (e.g. every record a nightly job marks failed, with the reason), not only the ones that
  raised. An error-only alert silently narrows itself the first time the code swallows a case.
- **Carry the upstream service's own data.** HTTP status plus a truncated response body in the message —
  the alert should be diagnosable without opening a console.
- **Every message carries action links.** *"the alert messages should include links, e.g. to the
  failing subscription, that way it's easy to click and retry it."* The operator workflow is:
  alert lands → click → act. Link the page where the action lives (an admin page, when the app has
  one), plus the affected object's own page.
- **An observability-only PR is a legitimate base of a stack** — zero behavior change, converts
  the existing outcome into today's outcome *plus* an alert. Retries and guards stack on top of
  it, so the alerting is already live while the behavior change is still in review.

Shape to copy for a scheduled monitor: a small job registered in the repo's scheduler config,
plus a notifier class that subclasses the app's existing chat-notification base (header block,
markdown body, link blocks, `send!(webhook_url, …)`), posts to a webhook read from
`ENV['<AREA>_ALERTS_WEBHOOK_URL']`, tags the owning group, and builds admin links from the app's
configured admin host. If the app has no such base yet, grep for any existing outbound alert and
copy that.

**Before proposing a retry or a backoff as the fix, check whether the existing retry ever
worked.** In one investigation every daily error count over several weeks was an exact multiple
of the job's attempt limit — every failure burned all of its attempts and not one was ever
rescued. That is a deterministic failure, not a flaky network, and exponential backoff would have
shipped nothing.

**Cleanup / post-datafix fallback removal**:

```markdown
Depends on: <datafix PR> having been applied to 100% of the affected population.
Removes: <the tolerant branch / fallback / coercion> — `file:line`
Proof it is safe: the diagnose script returns zero rows for <predicate>.
```

The pattern the user names as **A + B, then remove A**: ship a temporary bridge (A) alongside
the permanent datafix (B) in one PR, with a runbook comment saying exactly when A gets deleted;
then, once B has run in prod, delete A in its own follow-up PR. Worked example (invented): a PR
renamed an API serializer (`ArticleSerializer` → `ArticleView`), which changed the cache key of
every cached API response, so a fallback that also read the old cache key went in, to be kept
only until a data-fix that re-keyed the persisted cache entries had run. The removal PR was its
own worktree: grep every remaining reference, delete the fallback, update the spec that tested
it, **update the data-fix file's own comment that referenced it**, re-grep the repo for stale
references, then self-validate that caching still works via a local runner script before shipping.

The tolerant branch gets its own ticket the day it ships, with the removal condition written
down — otherwise it becomes permanent and the next reader treats the bad state as legitimate.

### 6d. Non-negotiables every RCA artifact inherits

The three that SKILL.md Phase 3 states outright — conclusion not journey, never ambiguous tense
about a fix's state, nothing publishable carrying customer names/emails/prod ids — plus:

- **Real class and method names**, with a one-line glossary before the section that leans on them.
  A doc that renames things to be friendly cannot be grepped against the code later.
- **Every prod number carries the query or script that produced it** (`NN_diagnose.rb`,
  `NN_probe.sql`), so a reader can re-run it rather than trusting a figure whose date they don't
  know.
- **Don't touch the code while writing the artifact.** Writing the RCA and editing the fix in the
  same pass is how a doc ends up describing a branch that no longer exists.

---

## 7. Recorded HTTP fixtures, when the fix changes a request

Re-record cassettes (VCR, Polly, `nock` recordings…) **only** when the change genuinely alters an
outbound request:

1. Back the cassette up.
2. Set the recorder to append new interactions (`record: :new_episodes` in VCR).
3. Run *just* that spec.
4. Revert the record mode, re-run the suite.
5. **Grep the cassette diff for leaked `Authorization` / `Bearer` / `api_key` / `signature`**
   before it goes anywhere near a commit.

Related trap: adding a second live fetch inside a method that existing recorded specs stub
off-network breaks those specs. Keep such methods pure/derived, or the "small" fix cascades.

---

## 8. Local tools, URL lessons, where artifacts live

- **Admin object URLs come from the router, not from memory.** Admin frameworks (ActiveAdmin,
  Django admin, Administrate…) let a registration rename the route (`ActiveAdmin.register X,
  as: …`), which is why a hand-built URL 404s. `bin/rails routes | grep <fragment>` (or the
  framework's equivalent) first.
- **The local dev login** is whatever the repo's seeds create — read the seed file or the repo's
  README for it; never guess credentials, and never reuse a production account.
- **Local read-only SQL** (`psql "$DATABASE_URL"`, `bin/rails dbconsole`, a local Postgres MCP)
  hits the **local dev** DB. A read-only production console the *user* can open gives you
  nothing from here; your own prod reads go through `<warehouse>` (**warehouse-data**).
- **Artifact destinations:** scratch → `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/`; reusable tools
  → `<sandbox_dir>/scripts/` (`CONFIRM=yes`, not `DRY_RUN` — **sandbox-tool**); committed
  exploration artifacts → `<sandbox_dir>/tickets/<topic>/`; durable write-ups → `<notes_dir>`
  (**research-doc**); screenshots → `<screenshots_dir>`. Every RCA pairs a README.md with a
  visual-explainer `explain` page in the same dir — the explainer is the default companion, not
  an optional extra.
