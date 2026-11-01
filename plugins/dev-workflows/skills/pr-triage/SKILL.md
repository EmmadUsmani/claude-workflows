---
name: pr-triage
description: Watch an open PR (or a whole stack) for CI results and automated review findings (Cursor Bugbot, CodeRabbit, cubic, Graphite, Socket), verify every claim against the real code before agreeing OR refuting, then fix and reply in-thread with the fixing SHA and resolve the thread — or, in the default report-only mode, log a verdict per finding and hold. Use when the user says "watch the PR for comments", "address the CI comments", "check for outstanding comments we haven't considered", "read all PR comments, refute or implement, reply with the fix commit hashes", or "listen for CI + PR comments but don't make changes yourself" — and as the follow-on phase after ship-pr opens a PR. NOT for reviewing your own uncommitted diff (code-review), NOT for a human-in-the-loop walk through a stack chapter by chapter, and NOT for a chat/issue report that hasn't been traced to code yet (bug-intake).
argument-hint: "[pr-number...] [--report-only|--approval-gated|--autonomous]"
---

# Triage a live PR's CI + bot review findings

The loop after a PR is open: watch → read the finding in full → **verify it against the
real code** → fix or rebut → reply in-thread → resolve. The whole value is in the verify
step. Bots are wrong often enough that agreeing without reproducing is how you ship a
patch for a bug that doesn't exist — and how you miss that the real bug is worse than
reported.

`<owner>/<repo>` below is the PR's repository (`gh repo view --json nameWithOwner --jq .nameWithOwner`).
Echo it into a shell variable once (`REPO=...`) rather than retyping it.

## Hard rules

- **`--report-only` is the default.** (Report-only is the default because "watch the PR" and "evaluate the comments" are almost never a request to change code; people who wanted fixes said so.) Log every finding with a verdict and a proposed diff, then **stop**. Only fix/push/reply when the user said `--approval-gated` (propose each fix, apply after an OK) or `--autonomous` (fix/push/reply without asking), or explicitly approved this round. "Watch the PR" ≠ "fix the PR"; "evaluate the comments" ≠ "implement the comments". Same three-mode vocabulary as **ship-pr**, which passes its mode straight through to this skill.
- **The mode decides whether you fix; once you fix, commit.** In any mode that lets you make a fix, commit the verified fix by default (staged precisely — see the next rules) so the reply can cite its SHA; leave it uncommitted **only when the user explicitly says so** ("don't commit yet"). Committing is not a separate approval — pushing, replying and resolving still follow the mode.
- **Verify before agreeing *and* before refuting.** Grep the method, trace the call chain, reproduce over real rows with a runner script (`bin/rails runner`, `node -e`, `python manage.py shell -c`…). Never relay a bot claim you haven't checked.
- **Reasoning goes in the review thread or the PR body — never as a new code comment.** When the user asks you to explain a decision to a reviewer, explain it in the thread.
- **When the user dictates reply wording, post that text, not a paraphrase.**
- **Never apply a bot's suggested diff verbatim.** Take the half that's right and say which half you rejected and why.
- **Scoped `git add <files>` only** — never `-A`/`-u`. Exclude regenerated build outputs (compiled CSS, schema dumps, lockfiles) unless they're a real part of the fix. A `git add -u` once swept several unrelated WIP files into a one-area commit.
- **Dedupe on comment `id`.** Never on body hash (bots edit comments in place) and never on `path:line` (your own commit re-anchors threads).
- **Never work in a main checkout another session may own**, and never reclaim a dev server or port without explicit permission.
- **A PR owned by a cloud agent goes back to that agent, not to a local fix.** If `<cloud_agent>` is not `none`, check first whether the PR belongs to one of its tasks (for example, list the agent's open tasks and look for one whose branch/PR number matches). Many cloud agents already start a turn on the owning task with each batch of new review comments, so read its recent events before duplicating its work. **Never commit, push, reply in-thread or resolve on an agent-owned PR yourself** — one writer, or fixes land twice; steering the agent is the only channel. Your Phases 3–8 still apply in full: verify every finding and every commit the agent pushes (autofix ones included) against the code *and the plan*, then send **one** follow-up per batch with a verdict per item — agree, a different fix, refute with evidence, or push back on the agent's own fix — and debate it if the agent disagrees (two rounds, then the user decides). When the PR came from **cloud-agent-work**, that steering is sanctioned and proactive within the original brief whatever this skill's mode; scope changes, merge/approve/reviewers and prod still go to the user. Invoked standalone on an agent-owned PR, the mode governs: `--report-only` reports, naming the owning task and whether it already answered each finding. Never hand a locally-opened PR to a cloud agent (re-assign its ownership) unless the user asks. Procedure: **cloud-agent-work**.

---

## Phase 0 — baseline, before you push

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments --jq 'map(.id)|max'   # high-water mark
gh pr checks <n> --json name,bucket,state                             # snapshot
date -u +%Y-%m-%dT%H:%M:%SZ                                           # SINCE
```

Record `SINCE` and seed a SEEN set of comment ids. Use **absolute failure detection**
(is any check red *right now*), not transition detection — a stale baseline let a real
regression slip past once.

## Phase 1 — arm the watcher (non-blocking)

`Monitor` is a deferred tool: `ToolSearch 'select:Monitor'` first (same for `TaskStop`).
Arm **one** monitor covering every PR number in the stack, `persistent: true` (or
`timeout_ms` up to 3600000), polling at 60–90s:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate \
  --jq '.[] | select(.created_at > "<SINCE>") | "\(.id) | \(.user.login) | \(.path):\(.line) | \(.body[0:200])"'
gh pr view <n> --json reviews,reviewDecision
gh pr checks <n> --json name,bucket,state
```

Settle predicate: *all checks non-pending **and** the count of registered checks equals what this
repo normally registers* (learn the number from the default branch's latest run or a sibling PR).
**`pending == 0` alone is not proof** — calling CI green after only a handful of checks have
registered, when the workflow normally fans out to many more, is a real mistake: the matrix
hadn't registered yet.

No `Monitor` tool, or it dies on you? Plain fallback: re-run the three `gh` calls above by hand
every minute or two (or with `gh pr checks <n> --watch --interval 30` in the foreground for a
short wait), diffing against the SEEN set.

Watching a stack of 4+ PRs across a long session is the canonical **agent-team** monitor/scribe
contract: a long-running agent that *never changes code, never commits, never pushes, never posts to
GitHub* — it observes, records into a delimited append-only section of a tracking doc, and escalates.
The lead still verifies every finding itself. Use a mid-tier model for that agent, not the top-tier one.

**Persist seen-state outside the session scratchpad** — e.g. `~/.cache/pr-monitor/<pr>.seen`.
The scratchpad is wiped on a Claude Code process restart, and re-arming with lost state
replays every historical comment (once: every PR's full comment history arrived as "new").

A literal `sleep N && cmd` chain is blocked by the harness — use the Monitor until-loop.
Monitors also die silently across compaction / MCP teardown: treat silence as *"not
watching"*, re-poll with `gh`, re-arm, and say so rather than reporting calm.

## Phase 2 — classify the wake (noise taxonomy)

Emit only on: a genuinely new inline finding, a submitted approval/change-request, or a
newly-failing check. Suppress:

- the whole-PR **summary** comment every bot reposts on every push;
- **your own replies** — `gh` posts as the user's account, so they come back looking like a new human review;
- Bugbot **"skipping"** notices (it already reviewed this SHA; a shifting pass/skip count is not a regression);
- CodeRabbit's *"skipped, base is not the default branch"* — **CodeRabbit does not auto-review a PR whose base isn't the default branch** (a repo-level setting you can change), so every stack layer above the bottom gets Bugbot + humans only;
- a review bot's PR-level **risk assessment** (e.g. "medium risk — held for a human"): a request for *evidence*, not a defect report;
- jobs gated to the default branch (a `notify-failure`-style job with `if: github.ref == 'refs/heads/main'`), which **always skip on a PR** — a naive `grep fail` matches the job *name*. Tally by column instead:

```bash
gh pr checks <n> | awk -F'\t' '{print $2}' | sort | uniq -c
```

Stale vs. new: `gh api .../pulls/<n>/comments --jq '.[] | {id, line, original_commit_id, created_at}'`.
`line: null` + an `original_commit_id` on an older commit = the finding went stale because
the code moved. Distinguish new from GitHub **re-anchoring** by `created_at`, never by
presence on the new SHA.

## Phase 3 — did CI actually run?

```bash
gh api repos/<owner>/<repo>/actions/runs?head_sha=<sha>
```

Bot-only checks can read complete while the test matrix never triggered. **Zero Actions
runs with only bot checks registered = a dropped `synchronize` webhook**, not a code
problem. Fix with a real push: `git commit --amend --date=now` + force-push (preserves the
approval where the repo doesn't dismiss stale reviews). **Not** `gh workflow run`: a
`workflow_dispatch` run binds to the branch, never attaches to the PR's merge box.

## Phase 4 — CI red: infra or you?

```bash
gh api repos/<owner>/<repo>/actions/jobs/<id> --jq '.steps'
```

**Jobs dying at "Set up job" with zero executed steps — especially across unrelated job
types (a JS build, a docs build) from a single-language diff — is a runner outage.** Confirm:

```bash
curl -s https://www.githubstatus.com/api/v2/incidents/unresolved.json
```

Compare against the default branch's own latest run and a sibling PR, then `gh run rerun <run_id> --failed`
— **one job at a time**. A second rerun re-queues the whole run under its concurrency group
and cancels the in-flight one, and `--job` reruns are rejected while the parent run is
in progress. `bucket: cancel` ≠ `fail`. A *changing mix* of failures across reruns (the failing
count shrinking while the set of failing jobs shifts from build jobs to test shards) is **not progress** — re-check the "Set up job" signature each time.

Infra flakiness has other shapes too — a package-registry fetch timing out (`ERR_SOCKET_TIMEOUT` from npm/pnpm/pip) is not your diff; re-run once and compare with the default branch.

Real failures: `gh run view --job <id> --log-failed | grep -B2 -A8 'Failure/Error'` (adjust the
pattern to your test runner). Always `tee` a long local run — `| tail -20` destroys the
pass/fail summary.

If the *local* run can't reach the database, the test DB is the wrong database, or the stack won't
boot at all, that's **dev-doctor**, not a PR problem — and remember a test database with a
hardcoded name is shared: if another session may hold it, skip local specs, lean on `gh pr checks`
against the exact head SHA, and say that's what you did.

**Never write a failure off as "environmental" without unmasking the real error**, and if
you already called something environmental and it wasn't, correct that explicitly. Use the repo's
own "is this failure mine?" procedure if it has one (a project command or script for diagnosing test failures, or a CONTRIBUTING
section); otherwise: re-run the identical command on the base commit and diff failing test *names*.

## Phase 5 — read the finding in full

*Auditing a merged or closed PR instead of watching a live one?* Skip the watcher (Phases 0–2) and run Phases 5–7 over the final state: for each inline comment, read it in full, check whether the author or a bot already marked it addressed (an "Addressed in <sha>" footer, a human reply, `isResolved`), compare the code **at the commit the bot reviewed** (`original_commit_id`) with the merged code — its quoted line numbers point at the old commit — and report verdicts only; replying or resolving on a merged PR is almost never wanted.

```bash
gh api repos/<owner>/<repo>/pulls/comments/<id> --jq '.body'
gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id> --jq '.body'
```

Never act on a truncated notification. Strip HTML with `sed -E 's/<[^>]+>//g'`.

## Phase 6 — verify against the real code (this is the skill)

- Grep the method the bot says is missing; trace the call chain; check the **other** consumer of a shared component (the second caller a "fix" would break).
- For a **data claim**, write a runner script that reproduces the exact failure over real rows. This is how *"a few imported records have a blank id → `ArgumentError`"* gets confirmed ("3 of 410 rows"), how *"`undefined method id for nil` → 61 of 500 active records"* gets found, and how a full-table sweep can answer an automated risk assessment with evidence instead of argument.
  When the reproducer is one you'd run again — a sweep over every active record, a queue-depth
  probe, a fixture setup — promote it with **sandbox-tool** (`scripts/` + a header comment that *is*
  the documentation, read-only mode first) instead of leaving it in the scratchpad, which is wiped on
  restart.
- Replicate the **exact resolver path** (the real service object / query the app uses), never a simplified scope — a simplified replica once manufactured a false "48 vs 31 rows" discrepancy.
- For a **race claim**, monkey-patch `window.fetch` in the browser tool's evaluate step to delay/reorder the specific response; add real queueing pressure if inconclusive; then confirm the symptom independently of the injected repro. (See **verify-in-app**.)
- Settle **interpreter-level** claims with a one-liner in the language (`ruby -e`, `node -e`, `python -c`) — one line closed a Bugbot keyword-argument claim.
- **A bot resolving its own thread carries zero signal** that the issue was fixed. Verify against current code.
- **A finding can be real and still understate the bug.** Chase it to the real mechanism — one "stale response overwrites newer state" race led to a worse session-desync underneath.

## Phase 7 — classify and act

**Before you propose any fix, run it through `code-style`.** Many bot findings *are* shape claims,
and code-style is what tells you which shape the user actually wants — it is as often the basis for a
confident **refutation** ("that's a first-class domain method, not a leaky helper") as for a fix. A
fix you accept then gets the same self-review checklist before it goes in the report table.

| Verdict | Action |
|---|---|
| Real + reachable | Fix at the source |
| Real but declined tradeoff | Explain the tradeoff in-thread |
| False positive | Rebut with the mechanism ("identical to main", "that entry condition can't occur", "that's a first-class domain method") |
| Already fixed / stale anchor | Reply explaining, then resolve |

- **Three findings on the same mechanism ⇒ refactor, don't add a fourth patch** (a client-side cache-key lifecycle got patched three times).
- **If the complex approach keeps generating new defects, revert to the simple one** — a review bot once found a chain of defects on one PR, each introduced by the previous bot-suggested fix.
- Don't build speculative infrastructure for a proven-unreachable edge case; **note it as excluded** instead.
- Keep independently-reviewable fixes separable — one commit per fix by default, or `git stash push -m "…" -- <files>` per fix when the user said to leave them uncommitted — the user may want one and not the other.
- In `--report-only`, stop here: one consolidated table (finding · bot · verdict · proposed diff · blast radius), then hold.

## Phase 8 — prove the fix

- Add a **regression test pinning the property the reviewer worried about**, not the symptom; prove it fails without and passes with. If the fix has a user-visible surface, a green test is not the proof — run **verify-in-app** (`--depth browser`) and cite the captured payload or measured number in the reply. For a claim about a render or generated image, bust the caches first (**render-pipeline-debug**) or you will screenshot a stale image.
- Optional but strong: **mutation-test your own fix** — reintroduce the exact bug, confirm the new assertion fails, restore, and cite that in the reply.
- Run the repo's linter/formatter on changed files only (`rubocop --force-exclusion -a <files>` — without `--force-exclusion`, RuboCop ignores the repo's `Exclude:` list for explicitly passed files and autocorrects files the repo deliberately excludes; `eslint --fix`, `ruff`…), plus scoped type-checking.
- **Baseline before blaming your fix for a local failure**: re-run the identical command on the pre-fix commit in the **same worktree + DB**, and **diff failing example NAMES, not counts**. Failure-count parity proves nothing on a file that is wholesale-red locally.
- `git show --stat` after committing to confirm nothing extra got staged.

## Phase 9 — reply in-thread, then resolve

```bash
# Reply into the originating inline thread (REST)
gh api -X POST repos/<owner>/<repo>/pulls/<n>/comments/<comment_id>/replies -f body="$(cat reply.md)"

# PR-level only
gh pr comment <n> --body '…'

# Resolve — REST CANNOT do this; you need the thread's GraphQL node id
gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<node-id>"}){thread{isResolved}}}'
```

Thread node ids come from GraphQL (`reviewThreads`) — see REFERENCE.md for the query.
An empty or wrong `threadId` fails with `NOT_FOUND: Could not resolve to a node with the
global id of ''`, so **echo the id before firing the mutation**.

Cite the fixing SHA and the mechanism; if a fix leaves a new gap, say so. **Read back
`in_reply_to_id`** — a scripted loop once posted the same text twice into the first thread;
recover with `gh api repos/<owner>/<repo>/pulls/comments/<id> --method DELETE` and repost.
Retry transient GitHub failures (curl exit 28) by writing the body to a scratch file and
looping, rather than losing it.

## Phase 10 — re-arm and close out

- `TaskStop` the stale monitor **before** arming a corrected one, and re-arm after every push so settle-detection isn't watching a stale round. Retuning the filter 3× in one session is normal.
- Re-trigger bots by **comment**: `gh pr comment <n> --body 'bugbot run'` (also `@cursor review`, `@coderabbitai review`). `POST /check-runs/{id}/rerequest` **404s** for the Cursor app.
- Widen cadence once CI is green and only a human review is outstanding.
- On an explicit *"confirm nothing is outstanding"*, run **one deterministic sweep** instead of arming a watcher: GraphQL `reviewDecision` + `reviewThreads` + `gh pr checks` on the current head SHA, then report either "nothing outstanding" or the remaining items.
- To hold a PR: `gh pr ready --undo <n>`, reply in the bot's own thread, prepend a `> [!WARNING]` block to the body saying what's parked and why, stop the monitor.
- When the triage produced a real mechanism worth explaining (a race, a cache-layer interaction, a vendor inconsistency), offer a **visual-explainer** page or a **research-doc** write-up rather than leaving it in the thread — and, when the PR needs it, link the artifact from the PR body instead of re-explaining the bug there.
- Loop until one full pass yields zero new actionable findings.

---

## If a fix touches the PR description

**The PR-body procedure is owned by `ship-pr` §4** — final-diff-state only, regenerate from scratch
(never append), the three-dot diff, a fixed section order ending in Screens, the two-column
`File | Description` Reviewer's guide, the attach-without-close issue keyword, and the
`body_html` grep proving the images didn't become camo URLs. Run it after **any** commit, revert,
rebase or split.

The two triage-specific rules that are *not* there: **fold a late fix into the main narrative as if
written once** — a "Follow-up fixes (from code review)" section and a bot-findings section are banned
outright — and where a fix left a permanent design constraint, state the constraint ("a render must
not depend on the session"), not the story that produced it.

---

## Domain facts

- **Bots** (any review bot behaves like these: a whole-PR *summary* comment plus separate *inline* findings — summaries often land as issue comments, inline findings as review comments, so check both endpoints): `cursor[bot]` (Bugbot inline findings, **plus** — where enabled — a separate per-SHA auto-approve product that may legitimately *decline* risky diffs touching auth / permissions / money / migrations — that is a correct verdict, not a stuck state), `coderabbitai[bot]` (free tier: walkthrough first, inline later), `cubic-dev-ai[bot]`, Graphite AI Reviews, Socket Security.
- **A passing check ≠ an approval.** These automations report `pass` when the *agent completed*. Confirm with `gh pr view <n> --json reviewDecision,reviews`.
- **Learn the repo's CI shape once** (`.github/workflows/*.yml`): which jobs exist, how many shards each fans out to, which are gated to the default branch, and the total registered-check count on a PR — that number is your settle predicate. Approximate shard *k* of *N* locally with `find <test dir> -name '*_spec.rb' | sort | awk -v N=<shards> -v k=<index> 'NR % N == k'` (adjust to the repo's sharding script).
- **CodeRabbit's check never reports a conclusion** (`status=none`) and shows as perpetually pending in `statusCheckRollup`.
- **Known flakes are per-repo.** Ask, or grep recent failed runs, before calling one — and never call a failure "a known flake" from memory; check that it failed on the default branch too.
- **GitHub recomputes mergeability asynchronously** — poll `gh pr view <n> --json mergeable,mergeStateStatus`; it reads `UNKNOWN` briefly.
- **A repo may carry pre-existing local test failures**, so a nonzero local failure count is not by itself a signal — baseline it (Phase 8).

## Verified gotchas

- **`status` is a read-only variable in zsh.** A Monitor script that assigns to it aborts silently on arming — a recurring trap. Name it `s`, `state`, anything else.
- **`${var#prefix}` surgery silently produced `pulls/<n>/` with no id.** Echo generated URLs before firing them.
- **A chained `&&` command silently no-ops** when an earlier `grep -v` gate matches everything — that pushed a stale branch tip once.
- **Monitor diff-detection re-emitted an already-seen bot comment as new** on two different PRs. Seed the seen-set from a real sweep after any state loss.
- **Bash cwd resets between tool calls** — absolute paths in every command.
- **An idle subagent notification is not a completion report and not verification.**
- **Never cite an identifier from memory** — a PR number was once fabricated. Re-read from `gh`.

## When not to use this / hand off to

- Opening the PR in the first place, screenshots, the assets branch → **ship-pr** (this skill is its Phase 6, done properly).
- The PR is owned by a cloud-agent task → **cloud-agent-work** (the periodic watch and steering the owning task).
- Reviewing your own uncommitted diff → built-in `/code-review`.
- Reviewing *someone else's* PR into a local review doc, posting nothing → **deep-pr-review**.
- Restacking, splitting, rebasing past a squash-merge, recovering a mangled stack → **gh-stack** / **stack-surgery**.
- Driving the app to prove a UI claim → **verify-in-app**; needing an isolated env to do it → **worktree-create** / **worktree-dev-server**.
- Production data needed to settle a claim → **warehouse-data** (the ladder: `<warehouse>`, then `<ops_bot>` if one exists), **prod-script** last. There is **no live prod DB connection** from the agent; a local runner / query CLI / DB MCP tool hits the local dev database only.
- Is the fix the right *shape*? Is the bot's style claim right? → **code-style** (the gate before any proposed diff, and the basis for refuting a shape claim).
- Local stack broken — ports, Docker, queues, test-DB identity → **dev-doctor**.
- A stale render or generated image behind a visual claim → **render-pipeline-debug** (bust the cache layers before screenshotting).
- The reproducer deserves to be reusable → **sandbox-tool**.
- Watching a whole stack, or triaging several PRs in parallel → **agent-team**; the monitor/scribe contract for a 4+ PR stack is in Phase 1 above.
- The finding deserves a doc or a visual explainer → **research-doc** / **visual-explainer**.
- The report arrived as a chat thread or ticket and isn't traced to code yet → **bug-intake** first.
- The finding arrived via **firefighter-loop** → forward to the item's owning agent (revive, don't respawn); the loop notifies the user.

Long-tail command reference (GraphQL thread queries, the monitor script skeleton, the full
bot/check table) lives in [REFERENCE.md](REFERENCE.md).
