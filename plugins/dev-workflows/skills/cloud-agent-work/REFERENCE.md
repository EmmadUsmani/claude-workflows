# cloud-agent-work — reference

Long-tail for [SKILL.md](SKILL.md): the brief template, follow-up wording, the watch prompt, and
the per-environment facts a brief should carry.

---

## §1 The code-task brief (template)

Fill every `<…>`. Delete a section only when it clearly doesn't apply (say "backend-only,
screenshots optional" rather than silently dropping §Self-verify). Keep it under the agent's prompt
cap (check the agent's documented limit; a thorough brief is a few thousand words at most).

````markdown
You are authorized to ship this end to end yourself: implement, self-verify in the running app,
push, and open a READY-FOR-REVIEW (non-draft) PR. Nobody will answer questions — make reasonable
calls and list them in your final message. Do NOT merge, approve, or request reviewers. Never touch
production (no console, no admin sign-in, no writes; the prod facts you need are below). Never post
to chat (Slack, Teams, …).

## The bug
<symptom verbatim — the toast/flash/error text>. <Who hit it, where: the exact URL path / user or
operator flow>. Impact: <approximate counts, no customer names, emails or production ids>.

## Root cause (already confirmed — verify it against the code before building on it)
- <file:line> — <what it does>
- <file:line> — <the step that fails, and why>
- Production facts: <what the warehouse / ops bot / a prod script confirmed, cited per
  **warehouse-data** (`per <warehouse> (<table>, as of <UTC>)`), with the query>.

## The fix (scope it to exactly this)
<1–3 numbered changes, with a code sketch when the shape matters>
Do NOT: <adjacent fix>, <datafix/migration>, <loosening the validation>, <rescue in a view>.
Mention those under a "Not in this PR" heading in the PR description instead.

## Tests
- A regression test that pins the property: <the property>. Prove it FAILS on <base> without the
  change and PASSES with it, and say so explicitly in the PR body.
- Assert the HTTP status, not just the body — a dev error page can echo test source.
- Run the touched tests plus <neighbouring test files>, and the linter on changed files
  (<`bundle exec rubocop`, `npx eslint`, `ruff check`…>). Follow the repo's agent instructions
  (<AGENTS.md / CLAUDE.md / test-dir AGENTS.md>): comment density, full-word names, no ticket or PR
  ids in comments, no test-only code in production code.

## Self-verify in the running app (required — tests alone are not enough)
Boot the app per <the repo's agent instructions> (wait for the environment's setup to finish if it
is still running), sign in via <the app's dev sign-in path>. Find routes with <the route listing:
`bin/rails routes | grep <x>`, …> — don't hand-build URLs.
1. Build one real fixture per affected case with <a runner script: `bin/rails runner`, a `node`
   script, `python manage.py shell -c`> (factories as reference), using obviously fake data:
   <case a>, <case b>, <control>.
2. BEFORE (base code, fix stashed): drive <the exact path> with a browser (Playwright); capture the
   failure.
3. AFTER (your branch): the same path, same data; capture the fixed state; cross-check the DB with
   the runner.
If the frontend doesn't rebuild after switching code, restart the services instead of debugging the
diff. If you cannot boot the app or drive a browser, say so explicitly and say what you verified
instead — never describe the fix as verified on tests alone.

## Evidence
Upload before/after screenshots and a short screen recording of the after-flow with your PR-media
tool, recorded the way you normally do (simple trimming is fine). In the PR body: a Before | After
table of the screenshots, and a plain link to the hosted video — no GIF, no MP4 committed anywhere.
Confirm every URL returns 200 with `curl -sI` (no cookies) before writing the body. If a URL needs
auth, push the PNGs to a slash-free assets branch with git plumbing (never `git switch --orphan`)
and reference them as
`https://github.com/<owner>/<repo>/blob/<slug>-screenshots/pr-assets/<file>?raw=true`:
  BRANCH=<slug>-screenshots
  export GIT_INDEX_FILE=$(mktemp); rm -f "$GIT_INDEX_FILE"
  for f in <png files>; do git update-index --add --cacheinfo 100644,"$(git hash-object -w "$f")","pr-assets/$(basename "$f")"; done
  TREE=$(git write-tree); unset GIT_INDEX_FILE
  SHA=$(git -c commit.gpgsign=false commit-tree "$TREE" -m "PR screenshots (not for merge)")
  git push --force origin "${SHA}:refs/heads/${BRANCH}"

## Ship
- Branch `<prefix>/<area>/<slug>` off the latest `origin/<default branch>`. Commit only the files
  you deliberately changed — never `git add -A`; revert generated-asset, lockfile, schema-dump and
  annotation churn. End the commit message with <the commit trailer>.
- `gh pr create` ready for review against <default branch>[, then
  `gh pr edit <n> --add-label <pr_preview_label>`].
- Title: the observable outcome ("<Do X> for <case>"), not the mechanism.
- Body, in order: Summary (the symptom in one line, the root cause chain with file refs) →
  Reviewer's guide (one `File | Description` table, a few words per file) → Design notes (why this
  narrow fix, the invariant it keeps) → Testing (fail-before/pass-after, the in-app before/after
  results, test and lint results) → Not in this PR → Screens (the image table and video link,
  always last) → `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  It describes the final diff only — no development narrative. No customer names, emails or
  production record ids.
- Then watch CI and the bot reviews (e.g. Cursor Bugbot, CodeRabbit, cubic, Graphite). Verify each
  claim against the code before agreeing or refuting; fix real issues in new commits, reply
  in-thread with the fixing SHA and resolve; reply with evidence to the ones you refute. Never add
  a lock or transaction around anything that reaches a payment provider.
- The orchestrating Claude is watching this PR too, until CI and reviews settle, and may send you
  follow-ups about CI failures, review comments and the commits you push. Treat them as direction
  from the owner of the overall plan; if you have evidence one is wrong, push back with it instead
  of complying silently.

## Final message
PR URL; what changed; test fail-before/pass-after; the in-app results; evidence links; the calls
you made; anything you couldn't verify; the final CI status.
````

**Variants.** Stacked layer — add a `## Stacking` section (SKILL §8) and swap "off the latest
`origin/<default branch>`" for the stacked base. Dispatched while the user is away, or by a loop such as
**firefighter-loop** — the body opens with the autonomous-PR banner (SKILL §3, verbatim, naming the
agent or loop and the source link). Backend-only or no-UI change —
"no screenshots; drive the real entry point (the job, service, CLI command or public API — a
runnable snippet for a library) on the base and on the branch, and paste the trimmed output of
both into the PR body."

---

## §2 Follow-up wording

**Add a requirement mid-flight** (steer, default):
> Additional requirement from the user. Fold this into your current work; don't start over.
> <the ask, with the routes to try in order and what to do if none work>. Upload any new images
> the same way, confirm the URLs resolve, and add them to the PR description in their own section
> ("<name>"). State which route produced them and anything that was stubbed.

**Change authority** (say what it overrides):
> Change of instructions: you ARE authorized to push your branch and open a pull request yourself.
> This overrides the earlier "do not push / do not open a PR" lines. Do it only after the tests
> pass and the end-to-end self-verification is done. <PR requirements as in §1 Ship.>

**Edit a PR description you don't own the content of** (QA evidence, a demo section):
> The user approves putting <X> into PR #<n>'s description. KEEP the existing description exactly:
> read it with `gh pr view <n> --json body`, insert a new `## <Section>` above the final
> "🤖 Generated with [Claude Code]…" footer (which stays last), confirm every URL loads without
> auth, save with `gh pr edit <n> --body-file`, then re-fetch and confirm the original content is
> intact. Still: no code changes, commits, pushes, PR comments, reviews, labels or reviewers.

**Steer CI / review fixes** (SKILL §6 — one message per batch, one verdict per item):
> Review/CI round on PR #<n> — I checked each item against the code at <head sha> and the plan.
> 1. <check name | comment link> — AGREE: <one line why>. Go ahead as you planned.
> 2. <comment link> — DIFFERENT FIX: <the fix>. Why: <plan-level reason, e.g. "the stacked PR #m
>    owns that file" / "the brief keeps the validation strict">.
> 3. <comment link> — REFUTE: <evidence, file:line>. Reply in-thread with this and resolve it.
> 4. Your commit <sha> — PUSH BACK: <what's wrong with the approach>; replace it in a new commit
>    (no force-push) with <the approach>.
> If you disagree with any of these, say why with evidence before acting on it. Same rules as
> before: no merge/approve/reviewers, no prod, no chat, stay inside the original scope.

**Share images with the user outside the PR:** ask for *one self-contained HTML page published
through the agent's artifact/share tool, screenshots inline as base64 JPEG at most ~1280 px wide, a
one-line caption under each* — a single link is easier to open than a folder of files.

---

## §3 The watch prompt

Run every minute by whichever watch SKILL §5 armed (session cron, `/loop 1m`, or — GitHub-only — a
background `gh` poller), and stopped once settled.

```text
Watch cloud task(s) <task_id> (<short name>; PR #<n> once open in <owner>/<repo>; brief/plan:
<path or one line>) per cloud-agent-work §5–§6. State file: <scratchpad>/cloud-watch-<slug>.json.
1. Task status (an agent with no programmatic status, e.g. Claude Code on the web: look for the
   task's branch / PR on GitHub instead, and relay steers for the user to paste). Before a PR
   exists: one short line if nothing changed; otherwise what changed (status, branch, PR, latest
   message gist). An open question goes to the user verbatim with a
   proposed answer; answer it only if the brief clearly covers it. Needs attention without a
   question, or failed: read its latest events, say what is blocking, steer it if the fix is inside
   the brief, otherwise propose and wait. Frozen timestamps: read the last events before calling it
   stuck.
2. First time it is ready for review with its PR: read the final message, check
   `gh pr view <n> --json isDraft,baseRefName,labels,reviewRequests,statusCheckRollup,files`, read
   the diff, open the evidence, report. Do NOT delete this job — the watch continues until the PR
   settles. (No-PR task: report — that is settled, step 5.)
3. Once the PR is open, every tick: `gh pr view <n> --json state,headRefOid,statusCheckRollup,
   reviewDecision`, the PR's inline comments, issue comments and reviews (dedupe on id against the
   state file), unresolved review threads. For each new red check, new bot/human comment or review,
   or new head SHA: verify it against the code at the PR head and against the plan, read what the
   task is already doing, then send ONE follow-up with a verdict per item (agree / different fix /
   refute / push back on its commit) and the reason. Review every commit the task pushes.
   Escalate to the user instead of steering for scope changes, "Do NOT" items, merge/approve/
   reviewers, prod or chat; after two rounds of disagreement with the task, give the user both
   positions. Relay CI red/green, every new human comment, every steer sent, every task commit with
   your verdict.
4. Never commit, push, reply in-thread or resolve threads on this PR yourself.
5. Settled → stop. Stop this watch (CronDelete the job / stop the loop) and send one final relay
   naming each PR's state once every task/PR is one of: green and quiet (CI complete and green,
   no unresolved threads, task not working and no open question, no steer awaiting a reply, nothing new for 15 minutes); merged or
   closed; a no-PR task reported; blocked on the user (question/blocker relayed with a proposed
   answer); or stalled (nothing at all changed for 60 minutes — relay what it is stuck on). Never
   back off to a slower tick and never poll indefinitely. The user saying stop also ends it.
```

For a stack or batch, list every task with its branch, PR and expected base in the first line, and
stop only when every PR is settled.

---

## §4 Environment facts to record (per `<cloud_env>`)

The first tasks in a new environment show what every later brief needs to say about it. Record
the answers in the project's `CLAUDE.md` (not in this installed skill, which a plugin update
overwrites), and paste the relevant ones into each brief. Categories to cover:

- **Running services** — what the environment boots, and the URL/port the task should use.
- **Sign-in** — how a task gets an authenticated session in the app.
- **Secrets** — which credentials the sandbox can and can't read (secret manager / KMS access),
  and what the task should do when one is missing, including what it must never commit.
- **Configuration** — which environment variables the app expects that the sandbox doesn't set
  by default.
- **Absent dependencies** — services, integrations or network hosts the environment lacks.
- **Verification limits** — given the above, what a task here can prove end to end, what it can
  only prove partially, and what has to be verified locally instead (feeds SKILL §1).
- **Agent capabilities** — whether `gh` can push and open PRs, whether PR media URLs load
  without auth, and how the agent shares files outside the PR.
- **Environment upkeep** — how secrets and setup changes reach an existing environment, and any
  restart a task needs after switching branches.
- **Repo-level agent instructions** — anything the repo already tells the agent, so the brief
  doesn't repeat it.

---

## §5 Niteshift adapter (when `cloud_agent: niteshift`)

Public tool names and parameters from Niteshift's MCP, as used by this skill. Re-check against the
server's own instructions — they change.

| Need | Call |
|---|---|
| Its own usage guide, once per session | `load_niteshift_skill {"name": "niteshift/manage-tasks"}` |
| Models and effort levels | `list_models` — the strongest model's catalog default effort may be below `high`, so always pass `effortLevel` |
| Dispatch | `create_task {environment, model, effortLevel, taskName, branch?, prompt}` — prefer the environment id over a bare `repo` |
| Idempotency check after a dispatch timeout | `list_tasks {repo, activeSince: <just before the call>}` before retrying |
| Status | `get_task` → `agentStatus`, `latestMessage`, `openQuestion` (with its `eventId`), branch, PR |
| Why it's blocked | `read_task_events {types: ["agent_message", "error", "turn_end"]}`, or `onlyErrors: true` |
| Recent progress without flooding context | `read_task_messages {limit: <a handful>, maxChars: <a few hundred>}`; page events with the saved `newerCursor` (an empty page means nothing new) |
| The final report | `read_task_messages {kinds: ["assistant"], limit: <a few>, maxChars: <large>}` — or `grep: "<word>"` to find one message (e.g. the artifact link) |
| Steer | `send_followup {taskId, message, steer: true}` (`steer: false` queues instead) |
| Answer a question | `respond_to_question {eventId}` — a follow-up does **not** answer it, and unanswered questions expire |
| Hand over local files | `prepare_attachment_upload` (a small number of files, size-capped — check the tool's limits) |
| Tidy | `set_task_projects`, `rename_task`, `archive_tasks` / `unarchive_tasks` |
| Autofix | new review comments wake the owning task with an `/autofix <context>` turn: the task flips back to working; read its events before steering |
| Inside the sandbox (the brief's vocabulary) | `ns services status --wait` while setup is still running, `ns services restart` after a branch switch; `upload_pr_media` for PR screenshots/recordings (its URLs load without auth); `publish_artifact` to share a file or HTML page outside the PR (size-capped) |
