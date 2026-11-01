---
name: cloud-agent-work
description: Delegate a PR-shaped change to a cloud coding agent (`<cloud_agent>` — e.g. Niteshift via its MCP, or Claude Code on the web). Write a self-contained brief, dispatch a task in `<cloud_env>` that implements, self-verifies in its own running app, opens a ready-for-review PR with screenshots and a recording, and answers CI and review comments — while Claude watches the task, then its PR, every minute until it settles (CI green, threads resolved, quiet 15 min, merged/closed, or blocked on the user), verifies every CI failure, comment and task commit itself, and steers fixes via follow-ups, never pushing itself. Use for "have the cloud agent build it", "spawn a cloud task to make the PR", "it should self-verify and open the PR itself", "have it QA this PR", "poll it every minute", and when ship-pr / bug-intake / pr-triage route code work here. NOT when `<cloud_agent>` is `none` or the repo has no `<cloud_env>` (ship-pr local), NOT for work needing the user's machine, NOT for a narrated demo video (demo-video).
argument-hint: "[what to build | PR to QA or record] [--base <branch>] [--stack-on <branch>] [--no-pr] [--qa <pr>] [--record <pr>] [--model <id>] [--effort high|xhigh]"
---

# Cloud agent work — brief, dispatch, verify, watch and steer

A cloud task is a coding agent in a remote sandbox with the project's stack running — whatever
`<cloud_env>` provisions (database, cache, app server, job workers, frontend dev servers, a
headless browser). It sees **only the repo and your prompt** — never this conversation — and it
runs for minutes to hours without notifying anyone. The value it adds over a local agent is that
it can boot, drive and record the real app without touching any of the user's shared local state,
then own the PR through review.

The orchestrator's job is the part the task can't do: **a brief that carries every judgment
call**, **verification on GitHub before saying "done"**, and a **1-minute watch that lasts until
things settle** — then it stops; it never polls indefinitely. During the watch it brings what the
task lacks — the whole plan, the RCA, the sibling PRs — to every CI failure and review comment,
and steers or debates the task's fix. Brief template, follow-up wording, the watch prompt and the
per-environment facts to record: [REFERENCE.md](REFERENCE.md).

## Settings

| Setting | Meaning |
|---|---|
| `<cloud_agent>` | `none` (default) \| `niteshift` \| `claude-code-web` \| another MCP-driven coding agent. `none` ⇒ this skill says so and hands the work to **ship-pr**'s local path. |
| `<cloud_env>` | The environment / repo the agent runs in. A repo without one is always local. |
| `<pr_preview_label>` | A label that triggers preview deploys, if your CI has one. Unset ⇒ no label step. |
| `<warehouse>`, `<ops_bot>` | Where production facts for the brief come from (Hard rules). |
| `<sandbox_dir>` | Scratch work; never has a `<cloud_env>` (§1). |

### Operations, per agent

The procedure below names generic operations. Map them once per session to your agent's tools
(load deferred MCP schemas first, e.g. `ToolSearch select:<tool>,<tool>`). Niteshift's parameters
and quirks: REFERENCE §5.

| Operation | Niteshift MCP — full loop | Claude Code on the web — **dispatch + PR-side watch only** |
|---|---|---|
| dispatch | `create_task {environment, model, effortLevel, taskName, branch?, prompt}` | `claude --cloud "<brief>"` creates a cloud session from the current repo; add `--environment <id>` for a self-hosted environment. Pass `--model` / `--effort` if the CLI accepts them alongside `--cloud` |
| status | `get_task` (`agentStatus`, `latestMessage`, `openQuestion`, PR) | **none programmatic** — watch GitHub for the task's branch / PR (§5 Phase A, GitHub-only) |
| read the transcript | `read_task_messages`, `read_task_events` (with `newerCursor`), `search_task_events` | none programmatic; the user opens the session (claude.ai/code, or `claude --cloud <session id or url>` / `claude --teleport <id>` to attach) |
| steer / answer a question | `send_followup {steer: true}`; questions via `respond_to_question {eventId}` — **not** `send_followup` | **relay**: write the follow-up and give it to the user to paste into the session, or have the task's PR comments carry it if the session watches its PR |
| hand over files | `prepare_attachment_upload` | commit them to the branch the session starts from, or inline them |
| file / tidy | `set_task_projects`, `archive_tasks`, `rename_task` | — |
| models | `list_models` | `--model` / `--effort` on the CLI, else the session's picker |

The Claude Code on the web column was checked against `claude --help` only, not exercised: what
`--cloud` prints on creation (a session URL?), whether it returns without an interactive prompt,
and whether `--model`/`--effort` reach the cloud session are **unverified** — try one throwaway
session first and record the answers in the project's `CLAUDE.md`. With this backend the phases
degrade as follows: **dispatch** works; **Phase A** becomes "poll GitHub for the branch/PR"
(no question detection — a stalled session looks like silence, so the 60-minute stall rule is
what surfaces it); **steering** (§6) becomes drafted follow-ups the user relays; **Phase B**, §7
verification and the one-writer rule are unchanged, because they only use `gh`.

## Hard rules

- **Dispatching is acting.** A question, a "what do you think", or a plan request gets analysis
  and no task. Dispatch when the user asked for the code work (directly, or via **ship-pr** /
  **bug-intake** `--to fix`). Read-only recon tasks follow the same rule.
- **Asking for the work through the cloud agent *is* the PR go-ahead.** A remote sandbox has no
  local uncommitted state to review, so the PR is the review surface: the task pushes and opens a
  **ready for review** PR itself, after self-verifying — don't stop it at "changes ready, shall I
  push?", because nobody is there to answer. Exceptions: `--no-pr`, a QA-only or
  recording-only task, or the user saying "don't open a PR".
- **Never merge, approve, or request reviewers** — in the brief and in every follow-up. The task
  may reply to and fix review threads on its own PR; it never touches anyone else's.
- **Strongest model, explicit effort — where the agent exposes them.** Pass the agent's strongest
  coding model and `high` effort for code work — catalog defaults are often lower, so pass both
  whenever there is a knob for them; when there isn't, say which model/effort the session will use
  (or that it's unknown) in the dispatch reply. A cheaper model only for smoke tests and trivial
  chores. Honor any model the user has ruled out in their CLAUDE.md, even
  if the catalog features it.
- **No production, no chat posting.** Every brief says so. Production facts the task needs are
  inlined, with no customer names, emails or production record ids — those also stay out of the
  PR. Gather them yourself before dispatch (the task may not have your connectors):
  `<warehouse>` first (**warehouse-data**), then the `<ops_bot>` if your team runs one,
  **prod-script** last.
- **Steer inside the brief; relay everything else.** Steering the task on CI failures and review
  comments (bots and humans) is sanctioned and expected — be proactive: agree, propose a different
  fix, refute, or push back on the task's fix (§6). The bound is the original brief and plan. A
  scope change, anything on the brief's "Do NOT" list, a question the brief doesn't cover,
  merge/approve/reviewers, production and chat all go to the user instead.
- **One writer per PR.** Never commit, push, reply in-thread or resolve threads yourself on a
  task-owned PR. Every fix and every reply goes through the task, so nothing is fixed twice.
- **Verify before you report.** A task's "verified" is a claim. Before telling the user it's done,
  check the PR on GitHub, read the diff, and look at the evidence yourself (§7).

## 1. Cloud or local?

**`<cloud_agent>: none` ⇒ local, always.** Say "no cloud agent configured — doing this locally
via ship-pr" and hand over. Otherwise the default is the cloud agent, and two more routes go local
(ship-pr's own phases) **automatically, with no question**:

- The user says so ("locally", "do it here").
- **The repo has no `<cloud_env>`.** `<sandbox_dir>` and repos without a runnable app never
  need one — don't ask, and don't suggest creating an environment for them.

Otherwise, if any of these is true, **ask** (cloud recommended vs local, naming the reason)
instead of guessing:

| Signal | Why it pulls local |
|---|---|
| The repro needs **specific local dev-DB rows** (prod-shaped data someone loaded, a hand-built record) or test-DB state | The sandbox has its own seeded DB; the task rebuilds fixtures with factories or a runner script, but never sees your rows |
| An **existing local worktree / branch with uncommitted work** to build on | The task only sees what's pushed |
| Proof needs a service or host that `<cloud_env>` doesn't have (REFERENCE §4, *Absent dependencies*) | The task could only prove part of it; say what it could and couldn't show |
| **Live third-party writes**, credentials the sandbox can't read, or the user's signed-in browser session | Usually unavailable to the sandbox (REFERENCE §4, *Secrets*) |
| The user **explicitly** says "leave it uncommitted" / "I want to review the diff before a PR" (or passes `--prepare-only`) | The task's deliverable is a PR. Only an explicit instruction counts — ship-pr's local default is to commit and open the PR too |

## 2. Dispatch

Once per session: load the agent's tool schemas, read its own usage guide if it ships one
(Niteshift: `load_niteshift_skill`), and list its models.

```text
dispatch {
  environment: <cloud_env>,                 # an environment id beats a bare repo name when both exist
  model: <strongest coding model>, effort: "high",
  name: "<observable symptom or deliverable, ≤60 chars>",
  branch: "<only to START on an existing pushed branch: stacking, QA, recording>",
  prompt: <REFERENCE §1 brief>
}
```

- **Dispatch is not idempotent.** On a timeout, list the agent's recent tasks for the repo before
  retrying — never double-dispatch.
- Reply to the user with the task URL, model/effort, and a 3–5 bullet summary of what it was asked
  to do — then **arm the watch in the same turn** (§5). Don't make them ask for it, and don't
  substitute one long background `sleep` for a watch: it reports nothing until it wakes and
  misses every question in between.
- If the agent groups tasks into projects, file video-only tasks in a dedicated one and leave
  code tasks unfiled (or follow the user's convention).

## 3. The brief

The task can't ask — on most agents an unanswered question expires and stalls it — so
**pre-resolve every judgment call**. A code brief carries these sections, in this order (template
with wording: REFERENCE §1):

1. **Authority line first** — *"You are authorized to ship this end to end yourself: implement,
   self-verify in the running app, push, and open a ready-for-review PR. Nobody will answer
   questions; make reasonable calls and list them in your final message. Do NOT merge, approve,
   or request reviewers. Never touch production. Never post to chat."*
2. **The bug / goal** — symptom verbatim, who hit it, impact numbers (approximate, no identifiers).
3. **Root cause, already confirmed** — the call chain with `file:line`, *"verify it against the
   code before building on it"*, and which facts came from production.
4. **The fix — scope it exactly**, with a code sketch when the shape matters, then an explicit
   **"Do NOT"** list (adjacent fixes, datafixes, loosening a validation, a `rescue` in a view).
   Out-of-scope items go in the PR's **"Not in this PR"** section, not in the diff.
5. **Tests** — a regression test that pins the *property*; **prove it fails on the base and passes
   with the fix, and say so in the PR body**; assert the HTTP status, not just the body (a dev
   error page can echo test source); run the touched tests + the linter; follow the repo's agent
   instructions (`AGENTS.md`, `CLAUDE.md`, a test-dir `AGENTS.md`) for comment density, naming and
   no ticket ids in comments.
6. **Self-verify in the running app (required — tests alone don't count)** — boot per the repo's
   agent instructions, sign in through the app's dev sign-in path, build one real fixture per
   affected case (a runner script — `bin/rails runner`, a `node` script, `python manage.py shell
   -c` — with factories as reference), drive the exact user/operator path with a browser:
   **before** on the base (fix stashed) and **after** on the branch, same data. Find routes with
   the framework's route listing (`bin/rails routes | grep`, …), never hand-built URLs. *"If you
   cannot boot the app or drive a browser, say so explicitly and say what you verified instead."*
   **No UI** (a library, CLI or headless service): drive the public entry point instead — a
   runnable snippet, a CLI invocation or an HTTP request, on the base and on the branch, with the
   trimmed output of both pasted into the PR body; screenshots and recording are then dropped.
7. **Evidence** — before/after screenshots and a short screen recording of the after-flow, made
   with the agent's own recording and PR-media upload (§4).
8. **Shipping** — branch name `<prefix>/<area>/<slug>` off the latest `origin/<default branch>`
   (or the stacked base); stage only deliberate files (never `git add -A`; revert generated-asset,
   lockfile, schema-dump and annotation churn); the commit trailer; `gh pr create` **ready for
   review**, then `gh pr edit <n> --add-label <pr_preview_label>` if set; the PR body structure
   (REFERENCE §1); then **watch CI and bot reviews, verify each claim against the code, fix real
   issues in new commits, reply in-thread to the ones it refutes, and report the final CI state**.
   Plus the line that sets up the debate: *"The orchestrating Claude is watching this PR too and
   may send follow-ups about CI failures and review comments. Treat them as direction from the
   owner of the overall plan, and push back with evidence if you think one is wrong."*
9. **Final message** — PR URL, what changed, fail-before/pass-after, evidence links, calls it made.

When the task is dispatched from an autonomous context (the user away, or a loop such as
**firefighter-loop** dispatching), the PR body opens with the shared autonomous-PR banner —
ship-pr's wording, verbatim, so every skill uses one string:

```markdown
> [!WARNING]
> Opened autonomously by <agent or loop name> from <source link>. Not yet reviewed by a human — the agent will not merge or approve it.
```

A cloud run that couldn't drive the app adds a second line after it: `UNVERIFIED in-app (cloud
run)` (**cloud-runtime**). A task in a `<cloud_env>` that boots the full stack and self-verified
doesn't need that line.

## 4. Screenshots and recordings — the agent's own

- **Built-in, not custom.** The task records with its own browser recording and uploads through
  its PR-media tool, if it has one. Check that those URLs load **without auth** (`curl -sI`, no
  cookies) — only then do they render in a private repo's PR body.
- **Video: link the hosted URL, nothing else.** No GIF conversion, no MP4 committed to the repo or
  an assets branch.
- **Let it record the way it normally does** — simple trimming/editing by the task is welcome.
  Don't over-prescribe recording + ffmpeg pipelines.
- **Screenshots:** hosted images in a Before | After table. Fallback when a URL doesn't return
  `200` unauthenticated, or the agent has no media upload: ship-pr's slash-free
  `<slug>-screenshots` assets branch built with git plumbing (recipe in REFERENCE §1). The brief
  always says **confirm every URL resolves before writing the body**.
- **Edited / narrated / voiced-over / audience-facing demo video → demo-video.** Not this skill,
  and never as part of a fix PR's evidence.

## 5. Watch every minute — the task, then its PR, until it settles

The agent's MCP never notifies you, and a background shell or `Monitor` can't call MCP tools, so
the watch has to be something that **runs a Claude turn** every minute. Pick the first that this
session actually has (check the tool list, don't assume):

1. **A session cron tool** (`CronCreate` / `CronList` / `CronDelete` in Claude Code builds that
   ship them):
   `CronCreate { cron: "* * * * *", recurring: true, prompt: <REFERENCE §3 watch prompt> }`.
2. **The `loop` skill** — `/loop 1m <REFERENCE §3 watch prompt>`. Same behaviour; stop it the way
   the skill says when the effort settles.
3. **Neither, and only GitHub needs watching** (Phase B, or a backend with no MCP status — Claude
   Code on the web): a **background shell** (`run_in_background`) that polls the `gh` calls below
   every minute and **exits as soon as anything changes** (new head SHA, check state, comment or
   review id, PR appears). Its exit re-invokes you; do the §6 pass, then start a fresh one. A
   background shell can call `gh`, just not MCP tools.
4. **None of these** — say so plainly: *"I can't watch this session unattended; ask me 'check the
   task' and I'll do one pass."* Never promise a watch you didn't arm.

Record what you armed (cron id, loop, or shell id) and tell the user: *"watching every minute
(`<id>`) until it settles, then I stop polling."* A cron or loop fires only while the REPL is idle
— fine; it catches up after your turn. **One watch for all the tasks of one effort** (a stack, a
batch), not one per task. Keep the watch state in the session scratchpad,
`cloud-watch-<slug>.json`: the watch mechanism, its id and cadence, per PR the seen comment/review
ids, the last head SHA, the last CI snapshot, and `quiet_since`.

**Phase A — the task is building (no PR yet).** Each fire: status per task, then:

| State | Do |
|---|---|
| working, nothing new | **One line** ("still working — <latest message gist>"). Nothing else. |
| working, latest message changed / branch or PR appeared | One or two lines: the new step, branch, PR number. |
| needs attention + an open question | Surface it **verbatim** with a proposed answer. Answer it only if the original brief or the user's ask clearly covers it; otherwise it's **blocked on the user** — settled (below). Time-sensitive — questions may expire. |
| needs attention without a question, or failed | Read its latest events / errors; tell the user what's blocking in plain words. Steer it if the fix is inside the brief (§6); otherwise propose the follow-up — **blocked on the user**, settled. |
| ready for review with its PR | §7 once, then **Phase B** — the watch keeps running until the PR settles. |
| done / failed, no-PR task (QA, recording, recon) | §7 — settled. |

**Phase B — the PR is open.** Each fire, alongside the task status:

```bash
gh pr view <n> --repo <owner>/<repo> --json state,headRefOid,statusCheckRollup,reviewDecision
gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate      # inline review comments
gh api repos/<owner>/<repo>/issues/<n>/comments --paginate     # conversation comments
gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate       # review bodies + states
```

Dedupe on comment/review **id** (pr-triage Phase 0 — never body hash, never `path:line`).
Unresolved threads come from GraphQL `reviewThreads { isResolved }` (pr-triage Phase 9). Each
**event** goes to §6:

- a check that went red (after pr-triage's "did it run / infra or real" call);
- a new bot or human comment or review;
- a new head SHA — the task (or its autofix turn) pushed commits, so review them.

No event ⇒ one line, or nothing if the last line said the same. Relay to the user: the PR
opening, CI going red or green, **every new human comment**, every steer you send (one line: what
and why), every task commit with your verdict, an escalation, and the stop.

**Stop once settled — never poll indefinitely.** There is no slow tick: when the effort settles,
stop the watch (`CronDelete` the job, stop the loop, or let the background shell end without
restarting it) and send one final relay. It is settled when **every** task/PR of the effort is in
one of these states:

| Settled state | Means |
|---|---|
| **PR green and quiet** | CI complete and green (nothing pending), zero unresolved threads, the task not working with no open question, no steer of yours still awaiting a reply, and no new comment, review, commit or check for **15 minutes** |
| **PR merged or closed** | Including a dropped PR (closed + the task archived) |
| **No-PR task done** | A QA / recording / recon task finished or failed, reported per §7 |
| **Blocked on the user** | An open question or a blocker only the user can decide — relayed with a proposed answer. Their reply is a new turn anyway |
| **Stalled** | Not settled by the above, but nothing at all changed — latest message, events, head SHA, check states, comments — for **60 minutes**. Read the last events, relay what it's stuck on, and stop rather than poll a hang |

The final relay names the state per PR, e.g. *"PR #n is green, resolved and quiet — stopped
watching (`<id>` stopped). Say 'watch #n' to re-arm."* (If the agent answers new review
comments on its own, say so.) The user saying stop ends it too.

**Re-arm** the same 1-minute watch (new id in the state file, say so) when the user asks ("watch
#n", "check the PR again"), when you send the task new work (a follow-up, an answer, the user's
go-ahead), or when a later turn notices a new comment, commit or red check on a PR you'd stopped
on. It then runs until settled again.

**Status timestamps go stale** while a task is busy (a "last activity" field froze for 10 minutes
on a task that was actively building fixtures). Use the latest message, and before calling a task
stuck, read its last events with the saved cursor (an empty page means "nothing new", not an
error). A task that is working after its PR opened is usually **watching CI and bot reviews**, or
an autofix turn — that's the job, not a hang.

## 6. Steering CI and review comments — and other follow-ups

Claude and the task **both** watch the PR, and Claude is proactive: it has more context on the
plan as a whole, so it debates with the task about the right fix for CI failures and automated
comments instead of leaving the task to guess.

**On every Phase B event:**

1. **Verify independently, the pr-triage way.** Did CI actually run, and is a red check infra or
   the change? Read the finding in full, then check it against the code at the PR head: `gh pr
   diff <n>`, or fetch the branch into a scratch worktree, never the main checkout. Bots are
   confidently wrong often enough that agreeing unverified ships non-fixes.
2. **Check it against the plan** — the brief, its "Do NOT" list, the RCA, the sibling and stacked
   PRs, what the user decided. This is the context the task doesn't have.
3. **See what the task is already doing.** Some agents (Niteshift's autofix, for one) start a turn
   on the owning task when new review comments land. Read its latest events first, so you respond
   to its plan instead of racing it.
4. **Steer with one follow-up per batch** (mid-turn steer by default). Each item gets one verdict
   and its reason:
   - **agree** — say so briefly when the task is choosing between fixes or hasn't acted yet;
   - **a different fix** — and the plan-level reason;
   - **refute** — with the evidence, and ask the task to reply in-thread with it and resolve;
   - **push back** on the fix the task chose or already pushed.
5. **Review every commit the task pushes**, autofix ones included, when the head SHA moves:
   `gh api repos/<owner>/<repo>/compare/<old>...<new>`. Check it against the comment it answers,
   the plan and **code-style**. Wrong approach ⇒ steer again (a new commit, not a force-push).
6. **Debate, bounded.** If the task pushes back with evidence, re-verify — it may be right, and
   then say so. After two rounds without agreement, stop: give the user both positions and your
   recommendation, and tell the task to hold that item.

**Authority.** All of this stays inside the original brief and plan. These go to the user instead
of being steered: a reviewer asking for something on the brief's "Do NOT" list or new behaviour, a
human's design objection that conflicts with the plan, a fix that needs a migration, datafix or
prod fact the brief didn't cover, and anything about merging, approving, reviewers, prod or chat.

**One writer.** Never commit, push, reply or resolve threads on the task's PR yourself — steering
is the only channel. **pr-triage** carries the same rule for task-owned PRs.

**Other follow-ups:**

- **Follow-ups steer by default** (mid-turn). Lead with *"Fold this into your current work; don't
  start over."* Queue instead only for independent work that should wait.
- **Outside CI and review, a follow-up is acting.** Send one when the user asks for it ("ask it to
  also show the empty-state screen, then add that to the PR description"), or when it's strictly
  within the original ask. When it changes authority, **say what it overrides**: *"Change of
  instructions: you ARE authorized to push and open a PR. This overrides the earlier 'do not
  push' lines."*
- **Restate the invariants in every follow-up** — no merge/approve/reviewers, no chat, no prod,
  and for PR-body edits: *keep the existing description exactly, insert the new section above the
  "🤖 Generated with" footer, re-fetch and diff to confirm nothing else changed.*
- **A human comment the user wants handled their way** → a follow-up with the comment link and
  their decision, verbatim.
- **New work → a new task**, not an overloaded finished one.
- **Closing:** when the user drops a PR, close it with the comment they asked for and archive the
  task.

## 7. When it says done — verify before reporting

1. Read the task's final report (its last assistant messages, untruncated).
2. On GitHub: `gh pr view <n> --json isDraft,baseRefName,labels,reviewRequests,statusCheckRollup,files`
   — not a draft, the right base (stacks!), `<pr_preview_label>` present if set, **no reviewers
   requested**, CI state, and a file list matching the brief's scope.
3. **Read the diff** (`gh pr diff <n>`) and run it past **code-style**'s checklist; unexpected
   files or an out-of-scope change is a finding, not a footnote.
4. **Look at the evidence**: open the screenshots, confirm the before actually shows the failure
   and the after the fix, and that fixtures are obviously fake (a prefix the brief chose, like
   `TEST-…`, makes that obvious at a glance).
5. Report: PR link, state line (draft/label/reviewers/CI), the change in 3–5 bullets,
   fail-before/pass-after, evidence links, anything the task chose or couldn't verify, and
   anything still "Not in this PR". Then update any RCA doc that said "fix in progress", and say
   the watch continues (§5 Phase B) until the PR settles — CI green, threads resolved, quiet —
   then stops.

## 8. Stacks, batches, QA and recording tasks

- **Stacks:** dispatch PR 1 with an exact branch name and *"push as early as possible; don't
  rename or force-push away history after the PR opens."* Once its branch is on GitHub, dispatch
  PR 2 starting from PR 1's branch with a **Stacking** section: new branch from `origin/<PR1>`,
  `gh pr create --base <PR1>`, never push to PR 1's branch, `git fetch` + rebase onto the latest
  PR 1 before opening and before finishing. Report merge order.
- **Parallel siblings** that touch the same file: assign insertion points so they can't conflict
  (*"add your case after `archived`, not next to `draft` — the sibling PR inserts there"*), use
  fixture values that will never become real, and say which sibling owns what.
- **QA-only task** (`--qa <pr>`, starting on the PR head): BEFORE = `git merge-base
  origin/<default> HEAD`, AFTER = head, same seeded data reset between runs, restart the app
  server after each switch; DO NOT change code, commit, push, comment or post; evidence + a flow ×
  side PASS/FAIL table; mark a flow BLOCKED rather than stop. Putting the evidence into the PR
  body is a separate, explicit follow-up.
- **Recording-only task** (`--record <pr>`): *"Make NO code changes"*; the only edit allowed is
  the PR description; keep the existing body and footer; re-fetch to verify.
- **Recon task**: read-only, scratch outside the repo, *"print every file in its own Bash call"*,
  final message a probe → result table.

## Verified gotchas

- A starting `branch` must already exist on the remote or provisioning fails — the stacked task
  waits for the upstream push.
- The task can't see local files. Hand-offs go through the agent's attachment upload or get
  inlined in the prompt.
- A steer message does **not** answer an open question on agents that model questions separately
  (Niteshift: `respond_to_question` with the question's `eventId`, not `send_followup`).
- In a sandbox, `fetch` to an admin page can be blocked by a cross-origin redirect — tell browser
  checks to navigate and read the DOM instead.
- A finished task can flip back to working when an autofix turn starts (§6). In Phase B that's an
  event — the PR isn't settled until that turn ends and goes quiet; review the commit it pushes.
- Where the cron tools exist (`CronCreate` / `CronList` / `CronDelete`) there is no schedule edit,
  so re-arming is a fresh create, and the new id goes in the watch state file. A `CronList` with no
  job while the effort isn't settled means the session restarted: re-arm.
- The per-environment facts a brief should carry (ports, sign-in, unreachable secrets, missing
  services): REFERENCE §4.

## Hand-offs

| Situation | Skill |
|---|---|
| The PR flow itself, and the local path when §1 says local or `<cloud_agent>` is `none` | **ship-pr** |
| Root-causing before there is anything to build | **bug-intake** (its fix phase dispatches here) |
| CI / review comments on a PR — task-owned or not | **pr-triage** (routes task-owned PRs back here) |
| Production facts for the brief | **warehouse-data** first, then the `<ops_bot>` if one exists, then **prod-script** |
| Edited, narrated, voiced-over demo video | **demo-video** |
| Several local agents on one effort | **agent-team** |
| Running these skills *on* a cloud runtime (a routine, a remote VM) | **cloud-runtime** |
