---
name: bug-intake
description: Own an incoming bug from a chat thread, an issue-tracker ticket, an error-tracker issue or a hunch all the way through — read the thread, attachments and linked precedent, reproduce or localize, RCA it against real production facts (warehouse-data first, then prod-script) instead of guesses, deliver a falsifiable verdict, then produce the RCA artifacts (research-doc, visual-explainer), the immediate remediation (a guarded prod-console repair), the permanent fix (ship-pr) and the follow-ups that stop it recurring. Use for "investigate why this thread is happening, I have a hypothesis", "is X's understanding correct? don't post anything", "how can I reproduce this?", "RCA this and write it up for the team", "write a prod script to unblock the customer, then fix the root cause", "what self heals / alerting should we add". Propose → wait → act per phase; default stops at the verdict; the autonomy flags are orthogonal to --to. NOT for reviewing a PR (deep-pr-review) or an open PR's CI and bot comments (pr-triage).
argument-hint: "<thread-url | ticket-id | error-tracker-url | description> [--to verdict|rca|remediate|fix|followups] [--report-only|--approval-gated|--autonomous]"
---

# Bug intake — report → RCA → remediation → fix → follow-ups

The on-call path, end to end. Somebody pasted a link and a hunch; this skill turns that into a
defensible answer, then into a customer unblocked, then into code that can't do it again. The
trace itself is ordinary work — the value is the front (thread + linked threads + attachments +
precedent), the boundaries, the verdict discipline, and the fact that **the console repair is not
the fix and the fix is not the follow-up**.

**`--to` sets how far to go, and the default is `verdict`.** Each phase ends by proposing the
next one and stopping. *"What do you think about this, just answer, don't make any code change
or decision yet."*

| `--to` | Stops after | Deliverable |
|---|---|---|
| `verdict` *(default)* | Phase 2 | A falsifiable verdict with `file:line` proof |
| `rca` | Phase 3 | Verdict + a README and a visual explainer (default pair) |
| `remediate` | Phase 4 | The customer unblocked via a guarded prod script |
| `fix` | Phase 5 | A PR that removes the root cause (committed by default; uncommitted only if told) |
| `followups` | Phase 6 | Self-heal / observability / cleanup / tickets, proposed |

Settings this skill reads (see the plugin's `SETTINGS.md`): `<chat>`, `<issue_tracker>`,
`<error_tracker>`, `<log_search>`, `<warehouse>`, `<ops_bot>`, `<prod_console_cmd>`,
`<sandbox_dir>`, `<sandbox_autocommit>`, `<cloud_agent>`, `<dev_url>`, `<docs_site>`,
`<notes_dir>`, `<screenshots_dir>`.

## Autonomy

`--to` says how far the work goes; the autonomy flag says **who approves each step**. The two axes
are orthogonal — `--to fix --autonomous` and `--to verdict --report-only` are both coherent. Three
modes, and the user names one — the same vocabulary every mode-bearing skill in this plugin uses:

**This skill's default is `--approval-gated`** (stated here because defaults are per skill).

- `--report-only` — trace, read, verdict. Change nothing in the code, the tracker or production,
  and propose nothing to run. Scratch notes in the investigation's sandbox dir (`repro-steps.md`,
  probes, the verdict) are still written; whether they are committed follows
  `<sandbox_autocommit>`.
- `--approval-gated` (**default**) — propose each phase, act after an OK. This is the behavior the
  rest of this skill describes.
- `--autonomous` — run the phases through the requested `--to` without asking. Only when the user
  says so explicitly, or when a dispatching skill (**firefighter-loop**) granted it in the brief.

| `--autonomous` may, unattended | and must never |
|---|---|
| Run every phase up to the requested `--to` | Go past it |
| Draft a prod script, `diagnose` or `repair` | **Run** one, or have anyone else run it unasked |
| Query `<warehouse>` (**warehouse-data**) for prod facts; mark only what it can't supply `[PENDING — needs prod script <path>]` and continue on the best hypothesis | Present an unverified prod fact as verified |
| Write **both** RCA artifacts (README.md + visual-explainer) into the investigation's own dir, unattended, by default | Sign in to an authenticated production admin UI, or impersonate anyone |
| Commit a scoped fix and open a **ready for review** PR via `ship-pr --autonomous`, then `pr-triage --report-only` | Merge, approve, request human review, or touch someone else's PR |
| Work in its own worktree | Touch the main checkout, or post to `<chat>` in any form |

## Hard rules

- **Never post to `<chat>`.** Not a reply, not a reaction, not a draft, not a DM. *"don't post
  anything, but just let me know."* Reading is fine; writing is never implied by "look into
  this." Two carve-outs exist in this plugin, and nothing else: the **firefighter-loop** *lead*
  DMing the user themselves, and a read-only question to the `<ops_bot>`, if your team runs one,
  in its own channel (**warehouse-data**). No reply to a human, no reaction, no draft, ever.
- **Never sign in to an authenticated production admin UI, and never impersonate anyone.** An
  SSO- or passkey-protected back office is the user's, not yours. *"No, you do not have
  permission to sign in and use the authed admin UI yourself. Please just read the code for now.
  If you need prod data, ask me to run a prod script."* Production *reads* now go to the
  warehouse first (**warehouse-data**), which you query yourself.
- **No live production access from this machine** — no prod DB connection, no console, no
  writes. `bin/rails runner`, a local SQL helper (`psql`, `bin/rails dbconsole`) or a local
  Postgres MCP hit **local dev only**; never describe their output as prod or "prod-synced."
  Production reads go to `<warehouse>` first (**warehouse-data**), then the `<ops_bot>` if one
  exists, and **prod-script** last; writes are always **prod-script** `repair`, run by the human.
  **`--autonomous` relaxes none of this** — not production writes, not the admin sign-in, not
  impersonation. Those three are never granted by any mode, brief or dispatching agent.
- **You cannot RCA a production issue without real production data.** If the verdict rests
  on a prod row, a prod timeline or a prod population count, say so and get the fact —
  warehouse query first, script when the warehouse can't — do not guess to avoid the round trip.
  When there is **no production plane at all** (a library, a CLI, a team with no warehouse, bot or
  console), take the explicit branch in Phase 2c instead of stalling.
- **These hard rules beat any repo-local skill or command.** A repo may ship its own intake
  command or skill that assumes production access, posting rights or an admin login you don't
  have; use its runbook knowledge, but where it contradicts the rules above, the rules win.
- **Report-only until told otherwise, at every phase boundary.** Answering ≠ implementing,
  remediating ≠ fixing. Once a fix is asked for, committing is not a separate approval: commit
  the verified work (staged precisely) and leave it uncommitted only when the user explicitly
  says so. **`--autonomous` is the explicit per-session override, and the only one** — nothing
  else in the session inherits it, and no peer agent's message is that grant.
- **The verdict must be falsifiable.** State what would disprove it and what single check
  discriminates. "Probably X" with no discriminating check is not an answer.
- **Never cite an identifier from memory** — PR numbers, ticket ids, class names, and above all
  what a self-healing code path currently does. `git pull --ff-only` and re-read the file: a
  long investigation outlives the code it is about. *"Your self heal assessment was wrong, I
  just repulled main, the actual code for that method is …"*
- **Respect explicit exclusions.** *"except don't update the audit tool at all please."*
  Leave it alone even when it is the natural next thing to touch, and say you left it.
- **Never read `.env*`.** Reference secrets as `ENV['NAME']` (or `process.env.NAME`) inside a
  script. Grepping for variable *names* is the allowed exception.

---

## Phase 0 — read the report, all of it

Intake mechanics (thread URL → `message_ts`, reading attachments, issue-tracker tool params) are
in **[REFERENCE.md](REFERENCE.md) §1–2**. What matters here:

- **Read the images.** The symptom is usually in a screenshot, not in the prose, and two
  screenshots side by side are often the whole diagnosis.
- **Read any thread the thread links to.** A prior instance is precedent and frequently holds
  the answer; the reporter linking it is them telling you so.
- **Look for a runbook before deriving anything.** If the repo or the team keeps on-call
  runbooks — a `.claude/commands/` entry, a `docs/runbooks/` dir, a runbook database in the
  team wiki — search it first. A runbook beats a fresh derivation. If the repo ships a narrower
  intake skill or command for one report family (one integration, one subsystem), prefer it for
  that family — still under the hard rules above, which win wherever it assumes access you don't
  have.
- **An `<error_tracker>` link changes the opening move.** Pull the issue, extract the
  correlation ids (trace id, `X-Request-Id`, the background job's id) and use them for *exact*
  matching in `<log_search>` instead of fuzzy timestamps (**REFERENCE.md §3**).

**Then restate the ask before doing anything.** One sentence: *the claim, whose it is, and what
would make it true or false.* Resolve ambiguity in the **question** before answering it —
*"what I meant by it being pre-existing, is: is it pre-existing for the public API?"* An
entire PR was once built and abandoned on a misread ticket. If the ask is genuinely forked,
`AskUserQuestion` — don't pick.

---

## Phase 1 — reproduce or localize

Skip only when the report is a pure feasibility or "is my understanding right" question.

1. **If the repro requires an authenticated production admin surface (when the project has one):
   STOP.** Never attempt the SSO sign-in or the passkey. Describe the click-path and hand it back.
2. **The local stack being broken is not the bug.** Blank page, stuck loading, specs that can't
   reach the database, a starved job queue → **dev-doctor** first, before blaming the diff or
   the code. Check who owns the dev server before starting one (`curl` + `lsof`); ports, Docker,
   the shared dev DB and the browser profile are contested across sessions.
   **worktree-dev-server** runs your own. Never reclaim a port without permission.
3. **A rendered-asset symptom (an image, a PDF, a preview) is its own pipeline** →
   **render-pipeline-debug**: identify which surface you are actually looking at, then bust every
   cache layer between the source and the screen before concluding the code is wrong.
4. **Never hand-build an admin URL** (when the project has an admin) — ask the router first
   (`bin/rails routes | grep <fragment>`, or your framework's route listing). Hand-built ones 404
   or land on the wrong controller.
5. **A web app:** drive the exact user or operator click-path to the failing state —
   **verify-in-app** owns the browser mechanics, the dev login and the payload capture; give it
   `--depth browser` (or `backend` when there is no user-visible surface). **A library or CLI:**
   reproduce with the smallest script or failing spec that hits the reported path, pinned to the
   reported version/commit, in its own clone or worktree (never another session's checkout).
6. Write `repro-steps.md` into `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/`: numbered path plus
   the direct local URL under `<dev_url>` (or the exact command, for a library/CLI). Update it
   once the user supplies the real prod URL, to confirm local == prod.
7. **Execution blocked** (a sandbox or permission classifier refuses to run cloned code, no
   toolchain, no way to boot the app): don't force it. **Localize statically** — trace the code
   path from the reported error to the raise — label the repro `[UNEXECUTED — <why>]` in
   `repro-steps.md` and the verdict, and lower the verdict's stated confidence accordingly.

**Dev is a stale, partial snapshot of prod.** "It doesn't reproduce locally" is not evidence
the bug isn't real; it is a reason to go to Phase 2.

---

## Phase 2 — RCA: trace the code, then prove it with prod facts

### 2a. Answer from the code, never from general knowledge

Every claim gets a `path/file.rb:123`.

- **Grep broadly first**, across languages, excluding `node_modules`. Quote the globs — bare
  `--include=*.rb` is eaten by zsh (`no matches found`). Search every casing of the concept:
  ```bash
  grep -rniIl -E "autoRetry|auto_retry|autoretry|auto-retry" \
    --include='*.rb' --include='*.ts' --include='*.tsx' --include='*.js' . | grep -v node_modules
  ```
  When there's an error message in a screenshot, **grep the literal message text** — it lands
  you on the raising service in one hop.
- **Grep the whole repo for a class name before asserting what it does.** In a large codebase
  the same job or model name routinely exists in several engines/packages, and a
  long-standing misspelling in a name (say `Recieve` for `Receive`) is common. Disambiguate a
  namespaced `Billing::Invoice` from a top-level `::Invoice` explicitly, **every time**. Scheduled
  jobs live in the repo's scheduler config (`config/schedule.yml`, a crontab, a cron workflow) —
  read the actual entry, its time, and the comment explaining it.
- **Parallelize without idling.** Dispatch `Agent[Explore]` per *independent* half of the flow
  (mutation path vs. read path; model/service/job vs. authorization), with explicit "quote
  verbatim, report `file:line`" instructions, and **keep grepping yourself while they run**.
  Fold in only genuinely new detail. Briefing and verification discipline: **agent-team** — and
  its worktree rules are not optional, agents have drifted into the main checkout mid-RCA.

### 2b. Enumerate every copy, every consumer and every sibling exit

**This is what separates a right answer from a wrong one**, and it is the step Claude skips.

The reporter's mental model is almost always "the job fixes it." Ask, per surface the symptom
appears on: *does the described process actually refresh this copy?* In one verified case a
nightly import refreshed the post row only — **not** the cached HTML fragment and **not** the RSS
feed — so the reporter's plan would have looked correct and changed nothing.

Sweep for: derived/denormalized columns, slugs (a rename does not regenerate one), cached
renders and their content-hashed URLs, generated exports and feeds, associated records holding a
copy of the value, search-index documents, and the frontend's own cached query. Name each copy:
refreshed / not refreshed / unknown.

**For an exception-path bug, the same sweep is over consumers, not copies:** list every caller
that receives the bad value, and every *other* step in the same path that can raise on the same
input (a sibling decode, a second parse, a later re-encode). Ask "can this exit raise too?", not
only "what does this exit produce?" — the sibling that raises on the same malformed input is the
follow-up bug you will otherwise miss.

### 2c. Get the production facts — **`<warehouse>` first**, then the `<ops_bot>`, then **prod-script**

Production reads go to `<warehouse>` first (**warehouse-data**), then the `<ops_bot>`, if your
team runs one, for what the warehouse lacks, and **prod-script** last; writes are always
**prod-script** `repair`. Before falling back from the warehouse, write one line:
`Warehouse can't: <reason>`.

| Question shape | Route |
|---|---|
| "What does the prod row actually say / how many are affected?" — rows, counts, populations, timelines from timestamps | **warehouse-data** — query the mirrored table yourself |
| Something the warehouse lacks — a hashed/redacted column's content, a just-added table/column, a change newer than the mirror's lag | the `<ops_bot>`, if one exists (**warehouse-data** owns that rung) |
| Application-only logic over live rows (eligibility chains, computed methods), or neither above can answer | **prod-script** `diagnose` |
| "What happened at 15:19 UTC?" | `<log_search>` (mechanics in **REFERENCE.md §3**) |
| Exception / stack trace | `<error_tracker>` — confirm whether exceptions reach your log search at all; often they don't |
| "When was this bad state written?" | the audit trail, if the model has one (PaperTrail, `django-simple-history`, an `audit_logs` table — §3); usually not mirrored, so the `<ops_bot>` or a script |
| "Did this datafix / bulk update run in prod?" | **warehouse-data** — residual predicate + `updated_at` fingerprint + reconcile to the dry-run count (an audit trail can't see a bulk `update_all`) |
| "Is the vendor or are we wrong?" | **vendor-api-probe** — drive the real API, then delete what you created and confirm with a re-GET expecting 404 |
| "Which PR did this, and who authored it?" | **REFERENCE.md §4** |

The loop, run properly, is cheap:

1. Write a **falsifiable hypothesis first**, then one numbered single-purpose probe per
   hypothesis into `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/` — a warehouse query saved as
   `NN_<probe>.sql` + `NN_<probe>.json` (**warehouse-data**'s evidence convention), or a script
   only for what the warehouse can't reach. Expect #1 to be wrong.
2. Get all four things at once (**REFERENCE.md §5a**): the raw subject row, the timeline,
   every denormalized copy from 2b with its own timestamp, and **the population count**. That
   last number decides whether this is one customer's row or a class of bad state — which is
   what Phase 6 hangs on. The warehouse usually answers all four; state its as-of.
3. *Script steps (3–4) apply only after `Warehouse can't: …`.*
   **Rehearse it locally first** (**prod-script**'s rehearsal phase) — `ruby -c` (or the
   language's syntax check), then a real `bin/rails runner` (or equivalent) run against the dev
   DB from the worktree that already exists for this bug (create one only if none does),
   confirming the fenced JSON parses and every section degrades to nil/empty rather than raising
   on ids dev doesn't have. If that worktree carries the fix, run the branch-diff check so the
   script doesn't lean on code prod doesn't run.
4. `pbcopy` the file, lead with the `Rehearsed locally: …` line (or `[UNREHEARSED — <reason>]`),
   have the human paste it into `<prod_console_cmd>`, save the paste-back as
   `NN-prod-data.json`, and **parse it with a tool, not by eye**. If the hypothesis died, write
   the *next numbered script* for the corrected question rather than defending the first answer.

**Cross-check each prod id against dev individually**, never in bulk, and say explicitly which
facts are prod-verified.

**Rung 2: the `<ops_bot>`, if your team runs one** — a read-only assistant with production
access, answering in seconds — for the small facts the warehouse lacks. Read-only questions only
— never a write — and where a bot answer is the sole support for a load-bearing claim, mark it
`[BOT — cross-check if load-bearing]`. If bot and script disagree, the pasted script wins; if the
warehouse and a live read disagree, check the mirror's lag before trusting either.

**No production plane** — a library, a CLI, an open-source project, or a team with no
`<warehouse>`, no `<ops_bot>` and no `<prod_console_cmd>`. Write `Warehouse can't: no production
plane — <why>` once, then: the "prod facts" are the reporter's own evidence (logs, versions,
traces they pasted) plus your local repro; mark every one of them **inferred** in the verdict,
skip the prod-script steps, and **skip Phase 4 entirely** (there is nothing to remediate in place;
say so). The verdict still carries its discriminating check — it is just one the reporter or a
maintainer can run, not a prod query.

**Under `--autonomous` the round trip is asynchronous, not skipped.** The warehouse needs no
human, so query it unattended. Only for the facts it can't supply: still write the numbered
diagnose script, then mark every verdict line that depends on it
`[PENDING — needs prod script <path>]` and carry on down the best-supported hypothesis instead of
stalling. List the pending scripts at the **top** of the report, in the order they should be
pasted, each with its `Warehouse can't: …` and `Rehearsed locally: …` / `[UNREHEARSED — …]`
lines — that list is the human's first action when they get back. A `[PENDING]` item may
instead read `[PENDING — ask <ops_bot>: <question>]` when it's small enough for the bot; size,
not convenience, picks which.

### 2d. Write the verdict

Lead with the verdict, then the proof. One of:

- **Correct** — and here is the code that makes it inevitable.
- **Correct in spirit, incomplete** — the mechanism is right, but *these* copies/branches don't
  behave as described, so the proposed action won't produce the expected result.
- **Incorrect** — with the specific artifact that disproves it.

Then, always:

- **Name where the plain-language framing maps onto nothing in the code.** "There's no 'the
  cache asks the origin again' branch at all" beats a hedge.
- **Separate proven from inferred.** Mark the unevidenced step and say what would confirm it.
- **State the discriminating check** — the one query, log line or image fetch that decides it.
- **Be willing to disconfirm the user.** One investigation proved a suspected "stale CDN copy"
  was the origin's own current output, from the response headers plus two fetched responses.
  `curl` + reading the two artifacts beat both a browser session and argument.
- **Say what you did not cover** — scope of the trace, tenants/records not surveyed, follow-ups.

**Feasibility questions stop here**, with options + trade-offs + which existing infra to build
on. No repro, no fix, no prototype.

**If a premise you leaned on gets corrected, re-examine every argument that rested on it**, not
just the conclusion, and reissue the verdict. Report template: **REFERENCE.md §6a**.

---

## Phase 3 — RCA artifacts, for humans who weren't here (`--to rca`)

A verdict in a terminal is not a record. **Every RCA that reaches this phase produces both, by
default** — skip the explainer only if the user says so:

| Artifact | What it is |
|---|---|
| **README.md** | The durable record, in the investigation's own `<sandbox_dir>/adhoc/<date>-<slug>/` — or **research-doc**'s notes destination when the user asked for that instead |
| **visual-explainer** `explain` | Same dir, more concise/visual/interactive than the README; published as an Artifact when that tool is available and the user hasn't said to keep it local; the README links to it |

Other destinations layer on top of this pair, they don't replace it:

| Audience | Extra artifact |
|---|---|
| The team, as onboarding material | **research-doc** with its docs-site destination (`<docs_site>`; opens a PR) |
| An operator, as a runbook | the repo's runbook / operator-docs dir, if it has one |
| Product / leadership | your team's design-doc or PRD template, if there is one |

Non-negotiables both artifacts inherit: deliver **the conclusion, not the journey** (*"skip all
the long journey of debugging and investigation we did to get there"*); **never ambiguous tense
about a fix's state** (*live in production today* / *fixed on branch `<x>`, not deployed* /
*proposed*); and nothing publishable carries a customer name, email or prod identifier
(`<account_id>`). The rest of the list: **REFERENCE.md §6d**.

**The `<issue_tracker>` ticket is an artifact too**, and it has its own framing rules: title and
intro are the observable **symptom plus business impact**, with RCA and proposed fix later in
the body; colliding class names disambiguated; every line-number citation pinned to a commit
SHA; the *outward consumer path* traced even when the crash was found elsewhere; and a link to
the admin page where an operator acts (when the app has an admin). Template and the
non-closing-magic-words convention:
**REFERENCE.md §6b**. Offer to file it — never create a ticket unprompted.

---

## Phase 4 — immediate remediation (`--to remediate`)

Unblock the customer. This is **prod-script** mode `repair`, and it does not close the bug. It
applies only when there is a production plane you can repair through `<prod_console_cmd>` (or
the project's own console/admin); with none, skip this phase and say so (Phase 2c).

1. **Root cause confirmed against real prod data first** — a warehouse query (**warehouse-data**)
   or a read-only dump. Never propose a write before that has established what is actually wrong.
2. **Blast-radius sweep before the repair** — preview it in the warehouse first; those
   per-bucket counts are the numbers the dry run must reproduce. Then (`03_blast_radius.rb`,
   **REFERENCE.md §5b**): every other record matching the pattern, capped at a few dozen, tallied into
   **named buckets**, each line carrying a clickable admin URL for **the object a human acts
   on** — the account or the document, not an internal join-table id. Derive candidates through
   *the same eligibility chain the real fix will use*, so the datafix and the code fix agree
   about who was affected.
3. **Read the model's callbacks** and report any money-adjacent, email-sending or outbound-API
   side effect *before* green-lighting the flip. Flag anything the ask didn't cover.
4. **DRY_RUN → paste back → confirm → apply.** The dry run must print the would-be-**new** value
   (assign in memory, print the diff, `reload` inside the `if DRY_RUN` branch). State the
   expected numbers per bucket and tell the user to **stop and report back if the real dry run
   differs**. `DRY_RUN` is sticky across a console session.
   **Before handing it over, rehearse all three paths locally** (**prod-script**): guard halts
   on bad state; dry run prints the new value with zero writes; apply runs against a seeded
   fixture on an isolated DB or inside a rolled-back transaction (`joinable: false` in Rails), so
   the shared dev DB is never left mutated. The hand-off states `Rehearsed locally: …` per path
   and names what wasn't exercised (faked job enqueues, a stubbed vendor call, prod-only records).
5. **Record the rollback.** Dump the pre-change state under `== BACKUP:` and name the undo path
   (with PaperTrail: `record.versions.reorder(:created_at).last.reify.<attr>`).
6. **Verify by re-running the diagnose script and diffing** against the saved output — not with
   bespoke verification tooling. Then re-audit the denormalized copies from 2b; a "successful"
   apply has been caught leaving a stale slug and a stale associated copy behind. Some blockers
   are one-shot and manual: they are cleared by hand, not by the fix.
7. Record in the ticket: what was repaired, how many records, by which script, and that the
   **code still has the bug**.

A console paste is the default; promote to a committed, spec'd data-fix class only when it must
be auditable or repeatable (**REFERENCE.md §5c**).

---

## Phase 5 — the permanent fix (`--to fix`)

**Ask which the user wants; the default is a verdict, not a PR.** Both are real instructions
from this user: one session explicitly wanted the fix left uncommitted with screenshots prepped
for a *later* `/ship-pr`; another wanted the PR opened in-session.

**Who builds it: the `<cloud_agent>` by default when one is configured** (**cloud-agent-work**,
via **ship-pr**). Once the fix is asked for, the verdict *is* the brief: the confirmed root
cause with `file:line`, the prod facts (counts, no identifiers), the exact fix shape and its
non-goals, and the bar from steps 1–2 below — reproduce on the old code in its running app,
fail-before/pass-after spec. The user's correction the first time this ran: *"make sure it self
verifies that the fix works"*, *"it should open a PR itself actually."* Put the task URL (then
the PR) in the RCA doc's status line. Go local — after asking — when the repro depends on this
machine (the local dev-DB rows you reproduced on, a worktree already holding the fix), or when
`<cloud_agent>` is `none`.

Local path: work in a **worktree, never the main checkout** (**worktree-create**). Then:

1. **Reproduce the exact prod failure locally against the old code**, confirm identical failure,
   apply the fix, confirm silence.
2. **A regression spec that pins the property**, not the incident. Prove it fails without the
   fix and passes with it, and say so: *"Confirmed: the spec reproduces the exact bug (fails
   without the fix, passes with it)."* For a refactor, additionally prove **byte-identical
   output** across a fixed input set before and after, and delete the throwaway harness.
3. **Don't overcorrect the failure mode.** The first-pass fix routinely swings from "always
   deactivate on error" to "never deactivate on error," and neither is right. Check the real
   failure distribution before accepting a retry or a backoff as the fix (see Phase 6), and be
   conservative on the critical path — *"if the identity provider errors we probably shouldn't
   let the session through, at least while it's still erroring."* A guard in the auth or payments
   path gets its own design pass, not a ride on the original fix.
4. Self-review the diff against **code-style**'s checklist, then verify with **verify-in-app**
   at the depth the change deserves (`browser` for anything user-visible; `evidence-pack` when
   before/after screenshots go in the PR description).
5. Clear locally cached bad state (`bin/rails runner` or equivalent), run the touched specs,
   run the linter on the changed files, revert generated-file noise (compiled CSS, lockfiles),
   then **ship-pr** — and after it opens, **pr-triage** (report-only unless told otherwise),
   which verifies every bot claim against the real code before agreeing *or* refuting.
6. **If the fix spans more than one PR, sequence it deliberately** — observability-only at the
   base (zero behavior change), then the behavior change on top. **stack-surgery** for splits,
   restacks and merge order; **gh-stack** for the everyday mechanics; **agent-team** when the
   tracks are genuinely independent.

**Locally, commit the verified fix by default** — staged precisely (`git add <the files you
changed>`, never `-A`/`-u`), on the worktree's branch. Leave it uncommitted **only when the user
explicitly says so** ("don't commit yet", "leave it for me to review"); committing is not a
separate approval, though the phase gate above still decides whether there is a fix at all (a
cloud-agent dispatch is itself the PR go-ahead — its PR is the review surface). Recorded HTTP
fixture (VCR / cassette) re-recording, if the change alters a request: **REFERENCE.md §7**.

**Under `--autonomous`, `--to fix` opens the PR without asking** — and opens it
**ready for review**, not draft: `ship-pr --autonomous`, commits scoped to the files you
deliberately changed (never `git add -A`), then `pr-triage --report-only`. The description leads
with the canonical banner, verbatim (the source link is the thread, ticket or error-tracker issue;
the name is `/bug-intake`, or `/firefighter-loop` when that loop dispatched the run):

```
> [!WARNING]
> Opened autonomously by <agent or loop name> from <source link>. Not yet reviewed by a human — the agent will not merge or approve it.
```

A cloud run that couldn't drive the app adds a second line, `UNVERIFIED in-app (cloud run)`.
Merging, approving and requesting human review stay with the human — approval moves to before
the merge, not away.

---

## Phase 6 — follow-ups (`--to followups`)

Propose these; don't build them unasked. Templates and shapes to copy: **REFERENCE.md §6c**.

**Self-heal — make the system tolerate and repair the state class on its own.**
Ask: *if this exact state recurs at 3am, does anything fix it without a human?* Two proven shapes
— an idempotent re-check on the next scheduled run, and a heal-once-inside-the-failing-call;
both described in **REFERENCE.md §6c**. Before proposing either, grep for an existing instance
in the repo and copy its shape. Rules: heal **once**, never in a retry loop; name the condition
under which staying broken is correct; emit `…recovery_attempted` / `recovery_succeeded` / `recovery_failed`
structured log events; and treat the admin button as an **override for impatience**, not the
mechanism — then update the operator doc to say so.

**Before you assert what an existing self-heal does, `git pull --ff-only` and re-read the
file.** This is the correction that cost the most in the source corpus: a claim that a failed
state was "sticky, needs a manual reset" came from a stale checkout, and the manual action it
named had already been deleted precisely because the scheduled job now healed it.

**Observability — what would have caught this on day one.**
Instrument the **outcome hook**, not a rescue block: alert on every record that reaches the bad
state with the reason attached, not only the ones that raised. Carry the upstream service's own
HTTP status and a truncated body, and **link the page where the operator acts** (*"that way it's
easy to click and retry it"*). An observability-only PR with zero behavior
change is a legitimate base of a stack.

**Cleanup — the fallback you shipped is scaffolding.**
Any tolerant branch added to bridge a datafix (**A + B, then remove A**) gets its own ticket the
day it ships, with the removal condition written down: *depends on `<datafix>` having covered
100% of the population; proof it is safe is the diagnose script returning zero rows.* What the
removal PR itself must do, with a worked example: **REFERENCE.md §6c**.

**Tickets — file the residue.** Anything you proved but did not fix, anything out of scope,
anything the investigation surfaced by accident (a separate pre-existing bug is a common
by-product). Offer; don't file unprompted.

---

## Verified gotchas

- **Slack's `slack_read_thread` takes `message_ts`, not `thread_ts`** — and it wants the
  *parent's* ts, which for a link into a reply is the `thread_ts=` query value.
- **Unquoted grep globs die in zsh.** `--include=*.rb` → `no matches found`.
- **A hand-built admin URL 404s or hits the wrong controller.** Ask the router first.
- **A long investigation outlives its own findings.** Re-pull before restating what any
  self-healing or recently-changed path does.
- **A "read-only" script has written to production** through a lazy accessor that creates on
  read. Audit every accessor the script touches; **prod-script** carries the guards.
- **Structured-log search can return zero rows with no error** when you query a top-level field
  but the payload is JSON-in-a-string nested one level down — and exceptions may not be in the
  log search at all (**REFERENCE.md §3**).
- **A prior `<sandbox_dir>/adhoc/` dir on the same integration usually has the API shapes and
  credential sourcing already solved.** `ls <sandbox_dir>/adhoc/` first.
- **Two things named alike in one codebase are usually two different things.** Confirm the
  class, the namespace and the file path together before building an argument on one.

## Working conventions

- Scratch scripts and findings: one dir per investigation,
  `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/`. Standalone scripts the user runs are plain Node
  (`node file.js`, built-ins only) unless their settings say otherwise; code that runs inside the app (a runner/console script) uses the app's language.
- **Sandbox writes auto-commit when `<sandbox_autocommit>` is on (the default) — never ask.**
  After each meaningful write under `<sandbox_dir>` (when it is a git repo), `git -C
  <sandbox_dir> add <only the paths you wrote>` and commit with a short descriptive message, no
  prompt — at every phase, `--report-only` included. Never `add -A`/`.` — other sessions leave
  uncommitted work there; never commit, revert, stash or clean theirs. No push; secrets get
  gitignored, never committed. Cloud runs: the state repo's own commit rule applies
  (**cloud-runtime**).
- **Merged ≠ deployed.** A prod console can be running pre-deploy code; check your deploy status
  before telling anyone a fix or a data-fix class is live.
- Local tools, URL-shape lessons and the other artifact destinations: **REFERENCE.md §8**.

## When not to use this — hand off instead

| Situation | Skill |
|---|---|
| Reviewing someone else's PR into a local review doc | **deep-pr-review** |
| An already-open PR's CI and bot review comments | **pr-triage** |
| A production fact | **warehouse-data** first → the `<ops_bot>`, if any → **prod-script** `diagnose` |
| A guarded production repair | **prod-script** `repair` |
| Proving a change works in the running app | **verify-in-app** |
| Local stack broken (ports, Docker, queues, local cloud emulators) | **dev-doctor** |
| A rendered image/PDF/preview isn't rendering right | **render-pipeline-debug** |
| Validating a vendor integration claim against the real API | **vendor-api-probe** |
| A durable write-up / an HTML explainer | **research-doc** / **visual-explainer** |
| Building the fix and opening its PR | **cloud-agent-work** (when `<cloud_agent>` is set) / **ship-pr** locally (+ **worktree-create**) |
| Splitting or restacking it | **stack-surgery** |
| A reusable local script or fixture toolkit | **sandbox-tool** |
| Is the fix the right *shape*? (the Phase 5 gate) | **code-style** — its self-review checklist |
| Parallelizing the investigation or the fix | **agent-team** |
| A stream of unread `<chat>` traffic to triage, not one thread | **firefighter-loop** |

Non-local environment (cloud session / scheduled routine)? Load **cloud-runtime** for the
degradation rules before Phase 1.
