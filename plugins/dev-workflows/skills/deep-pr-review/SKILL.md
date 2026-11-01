---
name: deep-pr-review
description: Deep, context-gathered review of a pull request (often someone else's) that writes a numbered local review doc to `<review_dir>` and posts nothing to GitHub. Gathers issue-tracker, chat and repo context and maps subsystems with parallel Explore agents *before* reading the diff, reviews against the PR's real (often stacked) base, and numbers every finding F1, F2… with file:line evidence. By default also builds the review graph (`pr-review-graph`) and a PR one-pager (`one-pager`) explaining the change; skip with `--no-graph` / `--no-one-pager`. Use for "review this PR — gather context first, write it to my code-review folder, don't post to github", "same review process for the PR stacked on top", "do inline comments for F1–F4, don't approve or reject", "do a self code review of our branch, don't make changes just report", "re-review after the force-push and tell me what's resolved". NOT a quick bug scan of the current diff (built-in `code-review`), NOT triaging bots on your own open PR (`pr-triage`).
argument-hint: "<pr-url-or-number> [--post F1,F2] [--v2] [--no-graph] [--no-one-pager] [--no-publish]"
---

# Deep PR review

Context first, review second. The deliverables are a **local markdown review doc** with
numbered findings — not a GitHub review — and, by default, a **review graph** of the PR built
from that doc (§6b) and a **one-pager** that explains the PR itself (§6c). Posting to GitHub is a
**separate, explicitly requested step**, and it does exactly what was asked and nothing adjacent.

Placeholders: `<owner>/<repo>` is the PR's repository (`<repo>` alone is its name, used in file
names); `<main-checkout>` is a local clone of it, if you have one; `<N>` is the PR number.

## Where the outputs go (one contract)

pr-review-graph and one-pager follow the same layout when called from here:

| Output | Path |
|---|---|
| Review doc | `<review_dir>/<repo>-pr<N>-review.md` (re-review: `<repo>-pr<N>-review-v2.md`) |
| Review graph (HTML + data file) | `<sandbox_dir>/tickets/<repo>-pr<N>/review-graph/` |
| One-pager (HTML, PNG, Artifact page) | `<sandbox_dir>/tickets/<repo>-pr<N>/one-pager/` |
| Screenshots, visual report | `<sandbox_dir>/tickets/<repo>-pr<N>/screenshots/{before,after}/`, `…/visual-report/` |

The review doc's header links to each of these (local path, plus the private Artifact URL once
published). The ticket goes in the doc's header, not its file name; a GitHub issue is
`<owner>/<repo>#<n>` there.

## Hard rules

- **Require the PR link.** If the user didn't give one, ask before starting any work.
- **Never switch branches in a main checkout.** If you have one with the PR branch already checked
  out, read it in place; otherwise — the usual case for someone else's PR — use a throwaway
  **detached worktree** (§1, §8). Never `git switch` in a checkout another session may be using.
- **Post nothing to GitHub** — no comment, no approval, no request-changes, no resolve —
  unless told to in a separate instruction. Then post *exactly* the findings named, with
  *exactly* the event asked for. "Do inline comments for F1–F4. Don't approve or reject."
  means one `COMMENT` review with four comments; F5+ stay in the doc.
- **Report only; change no code.** A review never edits the branch. Even the self-review
  variant stops at findings until the user picks by number.
- **Review against the real base**, which is frequently another open branch in a stack, not `main`.
- **Don't take contested local state.** Another session may hold the dev server, the dev port,
  or a shared test DB. Check before booting anything; if the test DB may be in use, skip local
  tests and lean on CI — and say that's what you did.
- **Never read `.env*`.** Read env values through the app (`ENV['NAME']` in a runner script,
  `process.env.NAME` in a node one-liner) if needed.
- **Grep before asserting a convention.** "Is this idiomatic in our codebase?" is answered
  with real usage counts and prior art, never with framework opinion.
- **Build the review graph and the one-pager unless told not to** (§6b, §6c). "No graph" /
  `--no-graph` and "no one-pager" / `--no-one-pager` skip one each; "just the doc" skips both;
  nothing else does. They are the only review outputs that get published, and only as
  **private** Artifacts for the user — they name a colleague's code, so they're never shared or
  linked on GitHub without the user asking. `--no-publish` builds them locally only.
- **Subagent models:** a capable mid/top-tier model for the Explore fan-out (e.g. sonnet or opus),
  and never a model the user has said not to use for agents.

---

## 1. Orient: PR metadata and the real base

Pass `--repo <owner>/<repo>` to every `gh` call, so nothing depends on which directory you're in:

```bash
gh pr view <N> --repo <owner>/<repo> --json number,title,body,baseRefName,headRefName,\
baseRefOid,headRefOid,state,isDraft,author,additions,deletions,changedFiles,url,mergedAt,updatedAt
```

`baseRefName` is the answer, not an assumption. If it isn't `main`, note the whole chain
(`#5730 → #5734 → #5741`) — it belongs in the review header, and it changes what "new in
this PR" means.

**Default: a detached worktree at the PR's own SHAs.** It works for someone else's PR you haven't
pulled, a fork PR, a merged PR, and a stacked child whose base branch was deleted:

```bash
# no local clone yet — a blobless clone is fast and complete enough
git clone --filter=blob:none https://github.com/<owner>/<repo>.git <main-checkout>
git -C <main-checkout> fetch origin pull/<N>/head <baseRefOid>
git -C <main-checkout> worktree add --detach <worktrees_dir>/<repo>-pr<N> <headRefOid>
git -C <worktrees_dir>/<repo>-pr<N> diff <baseRefOid>...<headRefOid> --stat     # must match changedFiles
git -C <worktrees_dir>/<repo>-pr<N> diff <baseRefOid>...<headRefOid> -- <code-only pathspec> > <scratch>/pr<N>-code.diff
git -C <worktrees_dir>/<repo>-pr<N> log --oneline <baseRefOid>..<headRefOid>
```

If your own checkout already has the PR branch checked out, the same diffs against
`origin/<base>...HEAD` are fine — after `git fetch origin <base>`.

Three dots, not two (it diffs from the merge-base; for a merged PR that is still the commit it
branched from, so the stat matches the PR's file count — check it does).

The **code-only pathspec** excludes the tests and the generated files, which are huge and
reviewed differently: in a JS repo something like `':!test' ':!**/*.test.*' ':!package-lock.json'`;
in a Rails repo `':!spec' ':!db/structure.sql'`; in Go `':!**/*_test.go'`. Diff the excluded half
separately — tests for coverage of the PR's claims, schema dumps for *only* this branch's DDL.

## 2. Context first, review second

Do all of this **before** forming an opinion on the diff.

- **`<issue_tracker>`** — the ticket *and* its epic/parent (`gh issue view <n> --repo
  <owner>/<repo> --comments`, Linear `get_issue` + `list_comments`, the Jira issue…). Acceptance
  criteria and explicit out-of-scope notes are what turn "this is odd" into "this breaks a stated
  acceptance criterion". Comments carry design decisions that never made the description — and
  often link a **competing or earlier PR** for the same issue; read it, it explains scope choices.
- **`<chat>`** — search the ticket id and the feature nouns (e.g. the Slack MCP's search, then
  read the thread it finds). Skip for a project with no team chat (most open-source PRs), and say so.
- **Repo docs** — the agent/contributor docs at the root and per directory (`AGENTS.md`,
  `CLAUDE.md`, `CONTRIBUTING.md`), any `docs/<area>/` runbook the PR adds or references, and
  inline comments in the touched files.
- Design docs, `<error_tracker>` / `<log_search>` only if the PR points at an incident or a spec.
- **No ticket, or the tracker isn't authenticated** — say so in the doc's header and take the
  context from the PR body and the thread it came from; don't stall on sign-in.

Then **parallel `Agent[Explore]` subagents, one per subsystem**, scaled to the size of the
*code* diff: under ~100 code lines, read it inline and skip the fan-out; a few hundred lines
across several subsystems, two or three agents is normal (a model's lifecycle, a service/job
convention set, the framework surface being extended). Each brief names the exact files and
demands **verbatim quotes with line numbers** — not summaries.

While they run, read the load-bearing files yourself. Verify, don't relay. The briefing and
verification discipline for that fan-out is **agent-team** §1 and §7: one agent per independent
question, `file:line` citations and verbatim quotes demanded, the main thread kept working while
they run, and the 1–2 core files each one flagged personally `Read` — an idle notification is not
a report. Agents extrapolate: a "this could throw for X" claim from an agent is a hypothesis until
you've traced it — record the ones you rule out in the doc's "checked and ruled out" list. An
Explore agent that ends without a report has done nothing you can use: do its reads inline and
note it, rather than respawning it blind.

If the PR is a *fix* for a reported bug, read the report the way **bug-intake** does before the
diff — its front half (the thread plus its attachments and the prior instance it links, then a
repro or a localization) tells you whether the fix addresses the actual mechanism or only the
symptom the reporter described. That skill owns the whole arc — intake → RCA → remediation → fix
→ follow-ups — so a PR that is somebody's *fix* phase gets reviewed against its RCA, not against
the ticket title.

## 3. Pull the prior review state

The review must know what earlier reviewers and bots already said, which findings the
author fixed, and which they refuted — otherwise it re-litigates settled comments.

```bash
gh pr view <N> --repo <owner>/<repo> --json reviews,comments \
  --jq '{reviews: [.reviews[] | {author: .author.login, state, body: (.body|.[0:1700])}]}'
gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate \
  --jq '.[] | "=== \(.user.login) | \(.path):\(.line // .original_line) | \(.created_at) ===\n\(.body[0:1700])\n"'
```

For each bot finding, check whether the SHA it was written against is still an ancestor:

```bash
git -C <worktree> merge-base --is-ancestor <reviewed-sha> <headRefOid> && echo ancestor || echo "rewritten (rebase/force-push)"
```

A rebase detaches every inline comment from its code. That's exactly when the review earns
its keep: state per finding whether it is **fixed**, **still live**, **partly right** (the
mechanism is real but a stated detail is wrong — say which), or **refuted, correctly**. Note
dismissed approvals too — an approval that predates a force-push no longer covers the code.

## 4. Run the touched tests — or say exactly why you didn't

```bash
# the repo's own runner, on the test files the diff touches:
npm test -- <files>  ·  node --test <files>  ·  bundle exec rspec <files>  ·  pytest <files>  ·  go test ./<pkgs>
```

List the test paths from `git diff --name-only`; **don't infer them** — guessed paths fail
to load and read like a defect.

- **Stale local schema.** If failures are only a missing column/table, refresh the test schema
  (`RAILS_ENV=test bin/rails db:test:prepare`, or the stack's equivalent) and rerun **before**
  writing anything down.
- **Shared test DB.** If another session may be using the same test database (common when its
  name is fixed in config with no per-worktree override), skip local tests and use CI instead,
  and say so in the doc.
- **The environment is wrong** — the DB unreachable, the wrong test database, a stack that won't
  boot — is **dev-doctor**, not a PR finding. Never file an environment failure as a defect.
- **You can't execute the repo's code here** (sandbox policy, missing toolchain, no services):
  do a static review, verify the specific platform/library semantics the change relies on with a
  self-contained snippet if you can (`node -e`, `ruby -e`), and write "tests not run locally:
  <reason>" in the doc's Verification section.

**CI is evidence only when the test workflows actually ran on the head SHA.**

```bash
gh pr view <N> --repo <owner>/<repo> --json headRefOid,statusCheckRollup \
  --jq '.statusCheckRollup[] | "\(.name // .context)  \(.status // .state)  \(.conclusion // "")"'
```

On a **fork PR**, the project's test workflows often wait for maintainer approval, so `gh pr
checks` may show only labelers, CLA or bot checks. That is **not** "CI green" — write "CI has not
run the test suite on `<sha>`" and lower your confidence accordingly.

## 5. Optional: drive the surfaces with Playwright

Do this when the PR adds UI/admin surfaces and the user asks for links, a walkthrough, or a
visual report. It repeatedly *confirms or kills* findings that static reading only suspects.

- Get real URLs from the router (`bin/rails routes | grep -i <thing>`, the framework's route
  listing) — **never hand-build an admin path**. Example from a Rails + ActiveAdmin app: custom
  page mounts use underscores (`/admin/posts_bulk_unpublish`); the slash form gets swallowed by
  `/admin/posts/:id` and dies on a raw stack trace.
- Sign in at `<dev_url>` the way the dev app allows (a dev-login route, a seeded admin).
- Dev databases are often thin on the data a feature needs. Build a scenario with the app's own
  factories/fixtures through a runner (`bin/rails runner`, a seed script…), and make the state
  *consistent* (a published post needs its author and slug) or you'll attribute your own seed bug
  to the PR.
- Deliverable: the `visual-report/` folder from the output contract, holding one self-contained
  page. **The page itself is `visual-explainer`'s job** (mode `explain`) — load it for the
  structure, the real-class-names-plus-glossary rule, the serve-and-drive verification, and the
  `file://`-is-blocked workaround. What this skill mandates: a **"not exercised"** section
  listing what the fixture couldn't cover, and every finding number (`F3`) visible on the
  screenshot that evidences it. **The visual report stays local — never publish it as a
  Claude Artifact**; it names a colleague's code. (The review graph and the one-pager are the
  published outputs, privately.)
- Capture a **before** (base) and **after** (head) screenshot of every surface the PR changes,
  into the contract's `screenshots/{before,after}/`: the review graph boxes each one on the
  element its node renders, so a capture taken for one finding usually serves two or three nodes.

## 6. Write the review doc

Path: per the output contract. House structure (match the existing docs in `<review_dir>` once
there are some; the full skeleton is in [REFERENCE.md](REFERENCE.md)):

1. **Header block** — title, author, ticket link, **base branch with a ⚠️ if it isn't main**,
   head SHA, size (`N files, +X / −Y`, noting how much is tests), review date, and links to the
   graph, one-pager and screenshots.
2. **Summary** — what the change does, in the domain's language, as a table of the moving parts.
3. **Verdict** — `Approve` / `Approve with changes` / `Request changes`, then the two or
   three findings that drive it, by number. For a PR that has already merged, say what follows
   instead: nothing, a follow-up PR, or — for an app with production data — a follow-up PR plus a
   prod repair (`prod-script` repair).
4. **Verification I ran** — suites and counts, or "CI green on `<sha>`", or "tests not run
   locally: <reason>; CI has not run the test suite on `<sha>`".
5. **Findings** — `F1`, `F2`, … each with a severity (`High` = fix before merge · `Medium` =
   fix or consciously accept · `Low`/`Nit` = author's call), `file:line` evidence, the
   reachability argument, and a concrete suggested fix. Findings come in two flavors and both
   belong in the doc: **correctness** (reachability, a real failing input) and **shape**. For
   shape, review against **code-style** (its stack tags say which sections apply; a library PR
   gets its public-API lens too) and cite the principle — "the controller filters the registry
   instead of calling `ExportFormats.menu_for`" is a finding; "I'd have written it differently" is
   not. That skill also tells you which of the author's choices are *already* the house shape, so
   you don't file a nit against a convention.
   **For a deployed app** (merged, or behind a flag that is on), measure each correctness finding's
   footprint in production with `warehouse-data` (`<warehouse>`) before you set its severity, and
   quote the query and the counts: a finding with a live instance in prod is High however narrow
   the race looks. Libraries and apps without a warehouse skip this.
6. **Checked and ruled out** — suspicions (yours or an agent's) you traced and dismissed, with why.
7. **Prior review state** — which bot/human findings are genuinely fixed (credit them), which
   stand, which the author correctly refuted; competing PRs; dismissed approvals.

Say what's good and *why* it's good; the docs that land well are specific about craft, not
just defects.

## 6b. Build the review graph (default)

Unless told not to, load **`pr-review-graph`** and build the graph for this PR from what the
review already has — nothing is re-derived:

| Input to pr-review-graph | From this review |
|---|---|
| PR, real base, head SHA, detached worktree | §1 (re-check `headRefOid` first; a force-push moves every line link) |
| Lower stack layers as `context` nodes, the `stack` strip | §1's chain and the Explore agents' map of the API it consumes |
| Findings: `id`, `sev` (High → `high`, Medium → `med`, Low → `low`, Nit → `nit`), `node`, title, one paragraph | §6, keeping the F-numbers |
| Screenshots, before and after | §5, when the PR has a visible surface; otherwise none, and the page's note says so |

It goes in the contract's `review-graph/` folder. Publish it as a **private** Artifact and put the
link at the top of your report and in the review doc's header; `--no-publish` builds it locally
and reports the path instead. A finding whose fix spans several nodes goes on the node where the
first change lands, with the rest in `alsoNodes`. Building it often surfaces a missed dependency
or an unexplained edge; when it does, add the finding to the doc, then rebuild.

## 6c. Build the PR one-pager (default)

Unless told not to, load **`one-pager`** and condense **the PR itself** into one spec sheet, using
that skill's pull-request recipe and its worked example (`examples/pr2497-multipart-parser.new.html`):
the PR's goal and why it exists, the system it touches with its new units marked, the trace paths
through the new code, the mechanism it hinges on, how it's consumed, and what it guarantees or
leaves for later. **It is an explainer of the change, not of the review: no findings, verdict or
severity on the sheet.** Someone who never opens the review doc should come away understanding
what the PR does and how.

| Input to one-pager (its "called from deep-pr-review" rules) | From this review |
|---|---|
| The plan = the PR: description, ticket, diff at the head SHA | §1, §2 |
| Verified facts: names, calls, tables, contract | The Explore agents' maps and the review graph's data file (§6b): its node names, `facts`, `edges[].detail` and `note` — not its `summary`/`bullets`, which carry findings — never re-derived from memory |
| Status and delivery | The PR's real state (`IN REVIEW`, `STACK OPEN · NOT MERGED`, `MERGED <date>`) and the §1 stack chain — plus the layers above it (`gh pr list --repo <owner>/<repo> --search "base:<this PR's head branch>"`), so the strip shows the whole stack with this PR's cell marked |
| Panels | one-pager's **pull request** recipe |

It goes in the contract's `one-pager/` folder and is published privately alongside the graph,
each linking to the other in your report and both linked from the review doc; `--no-publish`
applies to both, building and linting them locally and reporting the paths. On `--v2` it is
rebuilt as a `revision` sheet against the first one.

Stop here and report: the verdict, the top findings, the review doc path, the graph link and the
one-pager link. **Nothing is posted.**

## 7. Posting to GitHub (only when told)

Anchoring is the whole difficulty — GitHub attaches inline comments to the diff at the head
commit, so a stale local tree silently mis-places every comment.

```bash
gh pr view <N> --repo <owner>/<repo> --json headRefOid --jq .headRefOid   # must equal the SHA you reviewed
```

If they differ, read the file *at that SHA* (`git show <sha>:<path>`) and re-confirm every
finding's current line range and exact indentation before building the payload. Then build
one review payload and post it as a single review — see **[REFERENCE.md](REFERENCE.md)** for
the JSON shape, multi-line and `suggestion` block details.

```bash
gh api repos/<owner>/<repo>/pulls/<N>/reviews --method POST --input <scratch>/review.json
```

`event` is `COMMENT` unless the user said approve (`APPROVE`) — never `REQUEST_CHANGES`
unless asked in those words. Then **verify it landed**:

```bash
gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate \
  --jq '.[] | select(.pull_request_review_id == <review-id>) | "\(.path):\(.start_line // .line)-\(.line) [\(.side)]"'
gh pr view <N> --repo <owner>/<repo> --json reviewDecision,state
```

Report where each finding landed and confirm `reviewDecision` is what was intended
(`REVIEW_REQUIRED` still, if you were told not to approve). Fold closely related nits into
one comment rather than spraying threads.

## 8. Re-review after a force-push (`--v2`)

```bash
gh pr view <N> --repo <owner>/<repo> --json headRefOid,baseRefOid,updatedAt,additions,deletions,changedFiles
git -C <main-checkout> cat-file -t <old-head-sha>          # still reachable locally?
git -C <main-checkout> fetch origin pull/<N>/head
git -C <main-checkout> worktree add --detach <worktrees_dir>/<repo>-pr<N>-v2 <new-head-sha>
```

Then, from inside the worktree:

- `git log --oneline <new-base>..<new-head>` vs. the old list — what's genuinely new.
- `git show <fix-commit>` **per finding you raised**, checking the fix against the exact
  lines you flagged, and whether the tests added actually cover the gap you named.
- For commits labelled "refactor" or "comments", prove it: diff with comment lines filtered
  out and confirm zero non-comment changes, and that no test assertions were dropped.
- Re-check the findings you *didn't* post — most will still stand; say so explicitly.
- Check for new bot comments since the update, and whether your own suggested fix
  introduced anything (it happens).
- Rebuild the review graph at the new head (unless the first review skipped it): drop the
  resolved findings, keep the open ones, refresh every excerpt and line link, and republish to
  the same Artifact. Rebuild the one-pager too, as a `revision` sheet marking what the new commits
  changed in the PR (not in the review), and republish it to its Artifact.

Write `<repo>-pr<N>-review-v2.md` as **resolved vs. still open**, then:

```bash
git -C <main-checkout> worktree remove <worktrees_dir>/<repo>-pr<N>-v2 --force
git -C <main-checkout> worktree list && git -C <main-checkout> status -sb   # prove the checkout is untouched
```

---

## Variants

**Self-review of your own branch** — *"do a self code review of our branch. Don't make
changes, but ask yourself and report to me if there's anything we can improve."*
Same rigor, no doc: report inline as a **numbered picklist ordered by what you'd actually
act on**, because the answer comes back as "1. do this, 2. do this differently, 3. skip,
4. skip". Each item: the duplication/problem as a `file:line` table, the concrete change,
and the trade-off. Before claiming something is (or isn't) the codebase's convention,
**grep for it** — count real usages of the constant/component/pattern. The picklist *is*
**code-style**'s self-review checklist run against your own branch, ordered by what
you'd actually act on. Close with which items you'd pair and why, and offer to implement. Then
wait — report and stop; never edit.

**Explainer instead of a verdict** — *"explain what a 'revision' is for posts and how it
works"* while the user reviews a PR themselves. Same parallel-Explore front half; the deliverable
is a doc in `<notes_dir>/docs/`. It **must open with the motivation** — what problem the concept
solves, why it's needed, what it accomplishes — and only then transition into models, methods,
and the PR's bug. A doc that starts cold on model internals gets sent back. (For anything beyond a
review-support explainer, hand off to **research-doc**.)

## Verified gotchas

- **A PR and its base can both be force-pushed at once.** Diffing the new head against the
  *old* base tip shows the whole lower layer as "new". Re-resolve `baseRefName`/`baseRefOid` and
  fetch before every diff, and check `git cat-file -t` on the old SHAs while they're still local —
  once origin drops them, the only copy is your local object store.
- **Guessed test paths were wrong on the first try.** Enumerate from the diff.
- **`grep -rn <removed_name>` every call site before endorsing a rename or a removal** — and
  before agreeing a method is dead.
- **"Refactor for symmetry" suggestions are dangerous.** Hoisting one line so every branch
  evaluated a value reintroduced the exact `NoMethodError` class the PR was fixing. If you
  suggest one, name the guard that keeps it safe (`.try(…)` plus a comment marking the line
  load-bearing) — and prefer suggesting nothing over suggesting a plausible-looking hoist.
- **Playwright MCP file handling.** It's often sandboxed to the session's allowed roots: a
  *relative* `filename` lands in the calling session's cwd, and an absolute path outside the
  allowed roots is refused. Always pass an **absolute** filename under an allowed root (e.g.
  `<main-checkout>/.playwright-mcp/`, gitignored), then `mv` it into the contract's
  `screenshots/` folder. `git status --short` afterwards for strays.
- **The Playwright browser may be shared with other agents**, who can resize or navigate it
  mid-capture. Re-assert the viewport (`browser_resize`) and the URL immediately before every
  screenshot.
- `file://` is blocked, so a generated HTML report can't be previewed directly —
  `python3 -m http.server <port>` in its directory, drive `http://localhost:<port>/`, then
  kill the server.
- **Full-page admin screenshots fight a fixed sidebar** that expands on hover and covers
  content. Capture a container element (`target: "#some-page-container"`) instead.
- **Scripts as deliverables are Ruby** (the user's preference); throwaway payload builders are
  fine in any language.

## When not to use this — hand off to

- **Quick correctness scan of the current diff** → built-in `/code-review` (with `--fix` if
  changes are wanted). This skill is the opposite trade: much more context, no edits.
- **Walking a whole stack layer by layer with the human in the loop, implementing and
  cascading rebases** → review each layer here ("same review process for the PR stacked on top"),
  and hand the implementation to `stack-surgery` for the cascade and `ship-pr` / `pr-triage` per layer.
- **Triaging incoming CI failures and bot comments on your own live PR, then fixing or
  rebutting** → `pr-triage`.
- **Opening the PR in the first place** → `ship-pr`; branch/stack mechanics → `gh-stack`.
- **An isolated env to run a branch's tests or app** → `worktree-create` /
  `worktree-dev-server`. (A read-only review needs neither: a detached worktree is enough.)
- **A durable write-up that isn't tied to reviewing a PR** → `research-doc`.
- **The shape rubric behind a finding, and the self-review picklist** → `code-style`. It is the
  review lens for §6's shape findings, and it tells you which choices are already the house shape.
- **Briefing and verifying the parallel Explore agents** → `agent-team` (§1 brief, §7 verify).
- **The review graph in §6b** → `pr-review-graph`; this skill supplies the findings, the base,
  the stack and the §5 screenshots. Published privately by default.
- **The PR one-pager in §6c** → `one-pager` (its "called from deep-pr-review" rules and pull request
  recipe); this skill supplies the PR, its context and the graph's verified facts. Published
  privately by default.
- **Building the visual report page in §5** → `visual-explainer` (mode `explain`); this skill
  supplies the findings and the "not exercised" section. Local-only, never an Artifact.
- **Tests won't run because the environment is wrong**, not because the PR is → `dev-doctor`.
- **A production count behind a finding's severity** → `warehouse-data`.
- **Reading the originating bug report before the diff** → `bug-intake` (intake → RCA →
  remediation → fix → follow-ups). Its RCA artifacts are `research-doc` + `visual-explainer`.
