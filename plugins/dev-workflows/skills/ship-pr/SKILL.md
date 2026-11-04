---
name: ship-pr
description: End-to-end workflow for opening a well-formed PR. If `<cloud_agent>` is set (not `none`) the work is delegated to it via cloud-agent-work; otherwise (the default) it runs locally — branch off the right base (or a stacked base), implement, self-review the diff's shape against code-style, verify the change by driving the running app, capture before/after screenshots to `<screenshots_dir>`, embed those screenshots in the PR description (works for private repos), open a non-draft PR, and hand off to pr-triage for automated review feedback. Use when the user asks to create / open / publish / ship a PR, especially for UI changes where before/after visuals help. NOT for triaging CI and bot findings once the PR is already open (pr-triage), NOT for reviewing someone else's PR (deep-pr-review), and NOT for splitting, adopting or restacking an existing stack (stack-surgery).
argument-hint: "[ticket-id or short description] [--report-only|--approval-gated|--autonomous] [--prepare-only]"
---

# Ship a PR

The full path from a working change to an open PR with visual evidence and green
automated review. Follow the phases in order; skip a phase only when it clearly
doesn't apply (e.g. no UI surface → no screenshots) and say so.

Settings used (see the plugin's SETTINGS.md): `<cloud_agent>` (default `none`), `<cloud_env>`,
`<screenshots_dir>` (default `~/Desktop/<TICKET>/{before,after}/` — it already ends in
`{before,after}/`, so its parent is the per-PR folder), `<issue_tracker>` (default `github`),
`<pr_preview_label>` (optional), `<dev_url>` (worktree caveat), `<warehouse>` and `<ops_bot>` (only for the prod-safety
paragraph in §6).

Hard rules:
- **Commit the verified work by default.** Shipping a PR means committing it: once the change is verified and self-reviewed, commit it (staged precisely — see Hygiene) and carry on to the PR. Leave work uncommitted **only when the user explicitly says so** ("don't commit yet", "leave it uncommitted so I can review the diff"); stop before pushing/opening the PR only on an explicit `--prepare-only`.
- **Autonomous is the default mode — act, then report** (personal `CLAUDE.md` § *Autonomy: act, then report*). "Ship a PR" means branch, implement, verify, commit, push, open it ready-for-review, and fix or refute CI and bot findings on it, then report what you did and the calls you made. Everything on that section's gated list stays gated even under `--autonomous` (draft, then wait for the user's word). For a PR that especially means: replies on human reviewers' threads the user didn't name, a new PR or a stack restructure the user didn't ask for, and the merge. Three modes — the vocabulary every mode-bearing skill in this plugin shares:
  - `--autonomous` (**default**) — fix/commit/push/reply without asking, never past the gated list above. Never merges.
  - `--approval-gated` — open the PR, then propose each further change to it (review fixes, force-pushes, body rewrites) and apply after an OK. Only when the user asks to approve fixes.
  - `--report-only` — local work only: implement and verify, but do not commit, push or open anything; report the diff and the plan.
  - Orthogonal to those, `--prepare-only`: do the branch/implement/verify/screenshot/commit work and stop *before pushing or opening the PR*, leaving artifacts ready for a later run.
  - Pass the mode through unchanged when you hand off to **pr-triage** (§6).
- **Self-review the diff against `code-style` before you present it.** Load **code-style** and walk its self-review checklist over your own changes — abstraction barriers, logic declared at the layer that owns it, declarative over imperative, one source of truth, names, comment budget. Fix what you can; raise anything you deliberately left as a numbered finding rather than shipping it silently. `code-review` (built-in) is the correctness pass; this is the shape pass — they are not substitutes.
- **Never stage build artifacts or scratch files.** Stage only the source files you deliberately changed (see Hygiene). Never `git add -A` / `git add -u`.
- **Shared local state is shared.** Another session may own the dev-server port, the shared browser profile, the dev DB, or the main checkout. Never work in a main checkout another session might be using, never reclaim a running server without explicit permission, and if you're interrupted mid-operation, stop and leave state exactly as-is.
- **Unattended PRs and their banners.** When the run is unattended (dispatched by **firefighter-loop**, or by a cloud agent dispatched while the user is away), the PR opens ready-for-review with the autonomy banner below as the first line of the body and is never merged — approval moves from "before the PR exists" to "before it merges". Banner text, verbatim (fill the two placeholders):

  ```
  > [!WARNING]
  > Opened autonomously by <agent or loop name> from <source link>. Not yet reviewed by a human — the agent will not merge or approve it.
  ```

  A cloud run that could not drive the app adds a second line, verbatim: `UNVERIFIED in-app (cloud run)` — see §4. Other skills (cloud-agent-work, firefighter-loop, cloud-runtime) use exactly these two strings; do not reword them.

---

## 0. Who does the work

**Read `<cloud_agent>`.**

- **`none` (the default) → run the local phases below (1–6).** Nothing to ask about *where* the work runs.
- **Anything else (any value but `none`) → load `cloud-agent-work` and stop here.** It writes the brief (this skill's
  base/stacking, verification, evidence and PR-body rules are baked into its template), dispatches
  the task, verifies the opened PR on GitHub before reporting, then keeps watching it until it
  settles (CI green, threads resolved, quiet): it checks each CI failure, review comment and
  agent-pushed commit itself and steers the agent's fixes (that replaces §6's local pr-triage
  hand-off). Asking for a PR through the cloud agent is the commit/PR go-ahead: the PR is the
  review surface, opened ready-for-review (with `<pr_preview_label>` if set), never merged.

  Even with a cloud agent configured, **run locally instead** when the user says "locally" /
  "do it here", or when the repo has no cloud environment (`<cloud_env>` doesn't cover it).
  **Ask** (cloud vs local, naming the reason) rather than picking when the work needs the user's
  machine — local dev-DB rows or prod-shaped local data, an existing local worktree or
  uncommitted work, a local-only service, credentials that only exist on the laptop — or the user
  has explicitly said they want to review the diff before any PR (`--prepare-only`, "don't commit
  yet"). Absent that, the local path commits and opens the PR too. Don't suggest creating a cloud
  environment for a repo that has none.

Phases 1–6 below are the local path, and the standard a cloud-agent brief holds its task to.

## 1. Branch off the right base

- Default base is the repo's default branch (typically `main`). Branch off it unless the work is **stacked** — i.e. it depends on code that only exists on another open branch/PR. In that case branch off *that* branch and remember it as the PR base.
- Never work directly on the default branch. If already on it, branch first.
- Naming: follow the repo's convention (`gh pr list --state all --limit 20 --json headRefName` shows it); a safe default is `<you>/<area>/TICKET-123-short-slug` (or `<you>/<area>/short-slug` with no ticket).
- **Where the repo uses stacked PRs (detect: `gh stack view --json` succeeds on the current branch, or `gh pr list --state open --json baseRefName` shows PR bases that are other feature branches), use `gh stack` (the GitHub CLI stacking extension) to manage the branch/PR mechanics, not raw `git switch` + `gh pr create`.** See the **gh-stack** skill for the full command reference and agent rules (always non-interactive: `--json`, `--auto`, explicit branch args).
  - **Starting a new stack:** `gh stack init <you>/<area>/<slug>` (creates and checks out the branch off the default branch, or pass `--base <BASE>` for a different trunk).
  - **Stacking off an existing branch/PR** (this is what "stacked" work above means in practice): check out that branch first (`gh stack checkout <branch-or-pr-number>`), then `gh stack add <you>/<area>/<slug>` to add the next layer on top.
  - Plan the layers by dependency order (foundational changes low, dependent changes high) before writing code — see gh-stack's "Thinking about stack structure."

```bash
gh stack init <you>/<area>/<slug>                 # new stack off the default branch (or --base <BASE>)
# — or, to stack on top of existing work —
gh stack checkout <existing-branch-or-pr>
gh stack add <you>/<area>/<slug>                  # new layer on top of the current branch
```

**Repos that don't use stacks** (or where the extension isn't installed — `gh extension list`):
use plain `git switch -c <branch>` + `gh pr create --base <default-branch>`, and check
`gh pr list --state open` first when the repo has a shared index file (a nav/route/registry file)
that tends to conflict.

Keep the base branch name — it's the branch this layer is stacked on (or the default branch), used
for the "before" screenshots and for context in the PR description.

**Anything but a fresh linear stack → the stack-surgery skill.** `gh stack init/add/submit` covers
"new branch, then the next one on top." Splitting an over-large branch into a stack, adopting
branches built with plain `git`, rebasing past a squash-merged base, siblings off one base (stacks
are strictly linear), or recovering a diff that "looks wrong" are all multi-step operations with
their own proof steps — use **stack-surgery**, don't improvise. In particular, a **branch that
already exists with commits** is an adoption case (`gh stack init <existing-branch>` *before*
`gh stack add <new>`, or `gh stack link`), not a `gh stack add`.

**Isolated env / worktree?** Use **worktree-create** (a worktree with its own port and, where
needed, its own services and DB). Caveat for this PR flow: if the frontend pins its API URL to the
`<dev_url>` port, a worktree served on a different port won't be reached by it — when phase 2/3
needs you to drive the UI for before/after screenshots, serve that worktree on the pinned port
(the **worktree-dev-server** skill).

**If the dev server misbehaves** — blank page, stuck spinner, a boot that never finishes, "specs
can't reach the database" — stop debugging your diff and run the **dev-doctor** diagnosis tree
(who owns the port, is shared infra up, was it booted the way the repo expects — e.g. a Rails dev server in cluster mode, `WEB_CONCURRENCY>0`, breaks reloading and debuggers — is the output just
cached, is the queue starved). A stale server from another checkout looks exactly like a bug in
your change.

## 2. Implement, then verify by DRIVING it

Tests and typecheck are necessary, not sufficient. **Exercise the actual affected flow in the running app** (browser automation such as Playwright for web UIs) and observe the behavior.

**Use the verify-in-app skill for the full procedure** — sign-in, reaching the surface the real way,
instrumenting `window.fetch` before the click, asserting on captured request payloads and persisted
rows, failure injection, and the browser-automation gotchas that make DOM probes lie (tooltips are
`pointer-events: none`, hover drops between calls, portaled content and z-index). The rules that
belong here:

- **Verification depth is the user's call, but a user-visible surface makes browser verification mandatory** — backend-only checks are not sufficient for a change a person can see. Skip it only when the user explicitly says to ("just ship it, we'll verify later"), and say that you did.
- **Reproduce before you fix.** Prove the bug with a deterministic check first, fix, re-run the identical check. Don't fix on suspicion, and don't relay a claim you haven't reproduced.
- If another session may be using the shared browser, spawn an **isolated** browser instance — fresh and signed-out, so it's for signed-out flows or a deterministic DOM harness, not authed app state.
- Measure, then fix, then re-measure: state the diagnosis numerically before writing the fix, and compare the same numbers after.

## 2.5 Self-review the shape, not just the behavior

Before the screenshots, before the PR body: run the **code-style** checklist over
`git diff <base>...HEAD`. The recurring findings it catches on generated code are a caller
re-deriving precedence a domain method should own, an `.each` + `next` accumulator, a service with
exactly one caller, a fallback chain where one source is guaranteed correct, and comments narrating
what the code already shows. Then run built-in `/code-review` for correctness bugs. Present both
result sets with the diff — an unfixed shape finding is a line in the PR body's design notes, not
something to bury.

## 3. Before/after screenshots → `<screenshots_dir>`

Only for changes with a visible surface. Capture the **same surfaces** in both states.

**Capture mechanics are owned by `verify-in-app` (`--depth evidence-pack`):** capture "after"
first, produce "before" by putting the working tree back to base, poll for a 200 before shooting,
bust caches between toggles, and copy the PNG out of the browser tool's allowed root — plus every
screenshot gotcha (scoped `target`, portaled tooltips, `fullPage` compositing, paths landing in the
process cwd). Run it; don't re-derive it here.

What stays this skill's call:

- **One before/after pair per PR, for current behavior** — not one per variant or record, and never a v1/v2 comparison. A resting/hover-only change can have an identical "before": capture it and say so rather than skipping the row. If the implementation changes materially later, **re-shoot at the final state** and prune the superseded PNGs from the assets branch.
- **Folder per PR: `<screenshots_dir>`** (default `~/Desktop/<TICKET-or-slug>/{before,after}/`, i.e. a `before/` and an `after/` subfolder) — the canonical foldering for the plugin, referenced from verify-in-app. **`Read` each PNG before citing it as evidence**, and `rm` any strays left in the repo (`git status --short` must be clean).
- These local copies are the human-facing deliverable. You'll host a copy for the PR separately (next phase).

## 4. Open the PR (non-draft) with a strong description

Where the repo uses stacks, push the branch and create the PR with `gh stack submit --auto` (not raw `git push` + `gh pr create`) — it pushes the whole active stack, creates a PR per branch with the correct base chaining (each branch's PR bases on the branch below it), and links them together as a Stack on GitHub. Default to **non-draft** unless the user said draft.

```bash
gh stack submit --auto --open   # --open marks new/existing PRs ready for review, not draft
# non-stacked repo:
git push -u origin HEAD && gh pr create --base <default-branch> --title "<title>" --body-file <BODY.md>
```

`submit` auto-generates the PR title/body from the branch's commits, then edit with `gh pr edit <PR> --body-file <BODY.md>` to replace it with the fuller description below. (`submit` has no flag for a custom title/body up front — see gh-stack's "Known limitations.") Add `<pr_preview_label>` if the setting exists (`gh pr edit <PR> --add-label <label>`).

### The description describes the FINAL DIFF STATE — nothing else

This section is the canonical PR-body procedure for the whole plugin — **pr-triage** and
**stack-surgery** both defer to it after a late fix, a rebase or a split. Re-run the whole pass after
any commit, revert, rebase or PR split.

This is the single most-corrected thing in this workflow. The PR body is not a log of how you got
here; it is a description of the branch as it stands, written as if you wrote it once, at the end.

- **Regenerate the body from scratch on every substantive update. Never append.** Re-derive every claim from the diff rather than editing prose in place — file lists, test counts, CI state all go stale after a rename or a revert.
  ```bash
  git fetch origin <default-branch> --quiet
  git diff --stat origin/<default-branch>...HEAD       # THREE dots (or $(git merge-base origin/<default-branch> HEAD))
  git diff --name-status origin/<default-branch>...HEAD  # a two-dot diff after a force-push shows unrelated
  gh pr view <PR> --json files --jq '.files[].path'     # files — the tracking ref moved past the merge base
  ```
- **Ban outright:** development narrative ("was X, now Y"), intermediate steps and design changes you made along the way, v1/v2 comparison images, rejected approaches, a "Follow-up fixes (from code review)" section, bot-findings sections, commit SHAs, "stacked on #X" once that stopped being true, unrelated blockers or side findings discovered while verifying, "X was left untouched" reassurances, and who requested what.
- **Fold late fixes into the main narrative** as if they'd always been there. Where a fix left a permanent design constraint, **state the constraint** ("a cached response must not depend on the session"), not the story that produced it.
- **Make scoping facts prominent** — say "this is dev-only" explicitly rather than leaving it to be inferred.
- **A cloud run** (see `cloud-runtime`) puts the line `UNVERIFIED in-app (cloud run)` above the description (after the autonomy banner, if any) and ships without before/after screenshots.
- **Re-run this whole pass after any commit, revert, rebase, or PR split.** After a split, each PR's description gets rewritten for its now-narrower scope, and screenshots depicting the other layer move to the other PR.
- **Issue links without closing** (per `<issue_tracker>`): Linear — `Part of <TICKET>.` attaches the PR and moves the issue to In Progress without closing it. GitHub — mention `#123` with no closing keyword (only `Fixes`/`Closes`/`Resolves` close; a bare mention just cross-references). Jira — put the issue key in the branch name and PR title. Reserve the closing forms for the single issue that should actually close on merge.

Section order, fixed:

1. **Summary** — the problem and who reported it (link the ticket).
2. **Reviewer's guide** — the map of the change (see below); replaces a flat "what changed" dump.
3. **Constraints / design notes** — the key logic and the invariants a reviewer needs.
4. **Testing** — what you drove and observed.
5. **Data findings**, if any.
6. **Screens** — the image table (phase 5). **Always last.**
7. The Claude Code attribution line the environment requires.

Mechanics: draft in a scratch `.md`, then `gh pr edit <PR> --body-file <path>`. (`Write` errors
"File has not been read yet" if that scratch file already exists ⇒ `Read` it first.) After
re-ordering sections, check that internal cross-references ("see the note below") still resolve.
**Publish the body only after the screenshots exist and their URLs resolve** (phase 5) — a body
referencing an assets branch that isn't pushed yet renders broken images to everyone watching.

### Reviewer's guide

Model it on a well-reviewed PR in the same repo — find one (`gh pr list --state merged --limit 20`)
and read its body (`gh pr view <n> --json body --jq .body`) rather than paraphrasing this from
memory. Don't dump a flat file-by-file list; organize the change so a reviewer reads it
top-to-bottom.

- **One compact `File | Description` table.** Two columns exactly, and the second is named literally **Description** — not "Notes", "Summary", or anything else.
- **A few words to one sentence per file. Never a paragraph, never prose.**
- **Split into one table per layer only when the change genuinely spans layers** (data model → service → API → UI → test coverage). Then order the layers so each builds on the previous, and state that framing in one lead sentence. A single-layer change gets a single table.

```markdown
## Reviewer's guide

| File | Description |
|---|---|
| `path/to/file.rb` | <a few words — what this file contributes> |

<!-- multi-layer variant -->
One idea — *<the single thread the change follows>* — across N layers. Review top to bottom; each builds on the previous.

**1. <Layer name>** — <what this layer establishes>
| File | Description |
|---|---|
| `path/to/file.ts` | <a few words> |
```

## 5. Embed the before/after images in the PR

Getting images to render in a **private-repo** PR is the tricky part:
- `raw.githubusercontent.com/...` → 404 for reviewers (their browser doesn't auth to that host).
- External hosts (S3, gist raw, etc.) → GitHub's camo proxy fetches them without the viewer's creds → broken for private repos.
- GitHub's native attachment upload (`user-attachments`) needs a **browser session token**, which the `gh` CLI/PAT is not (POSTs get rejected).

**What works: host the PNGs in the repo on a separate assets branch and link them via a `blob?raw` URL.** Those are `github.com` URLs, so the reviewer's own session authenticates them, and keeping them on a *side* branch keeps them out of the feature PR's diff.

**Build that branch with plumbing, in a temp index — never `git switch --orphan`.** The orphan
switch empties the working tree: it has killed a running dev server and corrupted its module cache
mid-session, and it clobbers any other agent sharing the worktree. This touches neither your
working tree nor your real index:

```bash
BRANCH=<slug>-screenshots     # SLASH-FREE: `assets/foo` breaks blob/<branch>/<path> resolution
export GIT_INDEX_FILE=$(mktemp -t pr-assets-index); rm -f "$GIT_INDEX_FILE"
SHOTS=<screenshots_dir>   # already ends in {before,after}/ — so use its parent, e.g. ~/Desktop/<TICKET-or-slug>
for f in "$SHOTS"/before/*.png "$SHOTS"/after/*.png; do
  name="pr-assets/$(basename "$(dirname "$f")")-$(basename "$f")"   # before-foo.png / after-foo.png
  git update-index --add --cacheinfo 100644,"$(git hash-object -w "$f")","$name"
done
TREE=$(git write-tree); unset GIT_INDEX_FILE
SHA=$(git -c commit.gpgsign=false commit-tree "$TREE" -m "PR screenshots for <TICKET> (not for merge)")
git push --force origin "${SHA}:refs/heads/${BRANCH}"   # brace the vars — zsh parses $SHA:r as a modifier
```

**Push the assets branch and confirm the files resolve BEFORE you set the PR body** — publishing a
body whose images 404 is a real mistake that has happened:
```bash
gh api "repos/<OWNER>/<REPO>/contents/pr-assets?ref=<slug>-screenshots" --jq '.[].name'
```

Reference each image in the PR body as:
```
![alt](https://github.com/<OWNER>/<REPO>/blob/<slug>-screenshots/pr-assets/foo-after.png?raw=true)
```
as a table:
```
| Surface | Before | After |
|---|---|---|
| <name> | ![](.../foo-before.png?raw=true) | ![](.../foo-after.png?raw=true) |
```

**Verify they actually render** — don't trust it, check the rendered HTML:
```bash
gh api repos/<OWNER>/<REPO>/pulls/<PR> -H "Accept: application/vnd.github.html+json" \
  --jq '.body_html' | grep -oE '<img[^>]*src="[^"]*"'
```
Good: the `src` stays a `github.com/.../blob/...?raw=true` URL. Bad: it became a `camo.githubusercontent.com/...` URL (will break for a private repo) — rethink the host.

Note in the PR body that the assets branch is not for merge.

**Never delete the `<slug>-screenshots` branch after the PR merges** — every image in the merged
body 404s the moment you do, permanently. Leave it, or replace the images in the body first.

**Public repo shortcut:** skip the assets branch — `raw.githubusercontent.com/<OWNER>/<REPO>/<BRANCH>/path.png` renders directly.

## 6. Watch for automated feedback → hand off to pr-triage

After the PR opens, CI and the automated reviewers (Cursor Bugbot, CodeRabbit, cubic, Socket, whichever the repo has) run.
**Run the pr-triage skill for this phase** — it carries the whole procedure: the comment-id-keyed
watcher, the noise taxonomy, "did CI actually run", infra-outage vs real failure, verify-before-you-
agree, replying in-thread and resolving via GraphQL, and re-triggering the bots. On a PR this run
opened, its default is `--autonomous`; pass the mode the user gave you (§ hard rules). Two things it must not have to
rediscover: **verify every bot claim against the current code before agreeing or refuting** (bots
produce confident false positives), and **a passing check is not an approval** — confirm with
`gh pr view <PR> --json reviewDecision,reviews`.

Quick look, if you just need a status line rather than a triage pass:
```bash
gh pr checks <PR>
gh pr view <PR> --json reviewDecision,reviews --jq '.reviews[] | "\(.author.login) · \(.state)"'
```

**Before a merge that touches prod-reachable code** — env-var branches, deploy packaging, auth,
money, migrations — run a prod-safety audit first: does the changed file even ship, is a past
deliberate hardening being silently reversed, and can you prove prod behavior is byte-identical
across every relevant env-var combination? Route that to a human if you can't prove it.

If you cannot prove prod behavior from the code alone, do not guess and do not sign in anywhere.
If it's a data question and you have the production-data settings (`<warehouse>`, optionally
`<ops_bot>`), go down the ladder in **warehouse-data** — `<warehouse>` first (query it yourself),
then the `<ops_bot>` if your team runs one, and only then write a **prod-script** `diagnose`
script for a human to run. Without those settings, say what you couldn't prove and route it to a human. The agent has no live prod connection, console or admin
sign-in — a local runner / query CLI / DB MCP tool hits the **local dev database only**, so never
describe its output as "prod" or "prod-synced".

## Hygiene & gotchas

- **Stage precisely.** `git add <specific files>`, never `git add -A` **and never `git add -u`** — a blanket `-u` once swept several unrelated WIP files from another part of the codebase into a one-area commit in a shared worktree. Dev watchers regenerate build outputs (compiled CSS, schema dumps, lockfiles, generated schema/type files) that show as modified — don't commit them unless they're a real, intended part of the change. **Check what you actually committed: `git show --stat HEAD`.**
- **Clean up scratch artifacts** the tooling drops in the repo (`.playwright-mcp/` and other browser-automation output dirs, stray screenshot PNGs, `.vite/`-style bundler caches) before/after — they're not part of the PR.
- **"Don't commit yet" is opt-in — only when the user says it explicitly.** Then keep work in the working tree, or `git stash push -m "<what>" -- <files>` a coherent slice so it's recoverable, and tell them the stash ref. Either way, **keep independently-reviewable fixes separable** — separate commits by default, separate stash entries in the explicit case — so one can be dropped without the other.
- **Prefer named constants over magic numbers**, especially for cross-cutting values (stacking/layer tiers, timeouts) so the change stays correct if the referenced value moves.
- **Commit messages**: imperative subject, short body explaining *why*; include the co-author trailer the environment requires. Follow the repo's commit convention (conventional-commit subject + body is a safe default when there isn't one — check `git log --oneline -20`).
- **A stack being built by several agents in parallel** → **agent-team**: partition by file ownership, one isolated worktree per track, the lead does every `git add`/commit/push and re-runs every check. Don't hand agents the most expensive model by default.
- **Use `gh stack` for the branch/commit/PR mechanics** where the repo stacks (init/add/submit/sync — see the **gh-stack** skill) rather than raw `git`/`gh pr` commands; the verification, screenshot, and image-embedding phases here still apply on top.
- **Mid-stack changes:** if you're on an upper layer and realize a lower layer needs a change, don't hack around it in place — `gh stack down`/`checkout` to the right branch, commit there, then `gh stack rebase --upstack` and navigate back up. Anything beyond that (split, adopt, restack past a squash merge, siblings, merge order) → **stack-surgery**.

## When not to use / hand off

| Situation | Skill |
|---|---|
| Doing the work + opening the PR through a cloud agent (`<cloud_agent>` set, §0) | **cloud-agent-work** |
| Reviewing the diff's *shape* before presenting it | **code-style** (mandatory pass, §2.5) |
| Correctness bugs in the current diff | built-in `/code-review` |
| Proving the change works in the running app; before/after capture | **verify-in-app** |
| CI + bot findings once the PR is open | **pr-triage** |
| `gh stack` command reference | **gh-stack** |
| Split / adopt / restack past a squash-merge / siblings / merge order | **stack-surgery** |
| Isolated env; serving a worktree on the pinned port | **worktree-create** / **worktree-dev-server** |
| Blank page, stuck spinner, boot failure, starved queues | **dev-doctor** |
| Production fact | **warehouse-data** (the ladder), **prod-script** last |
| Guarded production repair | **prod-script** `repair` |
| Reviewing *someone else's* PR into a local doc | **deep-pr-review** |
| A chat/issue report not yet traced to code | **bug-intake** |
| Several PRs / a stack built by parallel agents | **agent-team** |
| **Non-local environment** (cloud session, routine, fresh VM)? | Load **cloud-runtime** for what degrades and how to label it. |
