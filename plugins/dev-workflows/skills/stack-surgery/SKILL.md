---
name: stack-surgery
description: Advanced stacked-PR operations that `gh stack`'s happy path doesn't cover and that are easy to get catastrophically wrong — split an over-large branch into a stack losslessly, restack past a squash-merged or concurrently-rewritten base, cascade a fix up a live stack, adopt branches built with plain git, ship siblings off one shared base (stacks are strictly linear), recover when another session rewrote branches underneath you, and prove a safe merge order. Every operation ends in a proof (byte-identical diff, empty diff-vs-backup, `git merge-tree` simulation). Use for "split this PR into a stack of two, backend changes first", "the base PR was merged — update main, rebase our branch, push", "the PR diff looks wrong on github", "rebase the stack on main, resolve the conflicts, don't touch the main checkout", "what order should I merge these in so there are no conflicts?". NOT the `gh stack` command reference (that's the **gh-stack** skill) and NOT for opening a fresh PR (that's **ship-pr**).
argument-hint: "split|restack|adopt|siblings|recover|merge-order [pr-or-branch...]"
---

# Stack surgery

Restructuring a live stack of PRs. `gh stack` handles the linear happy path;
everything here is the case where the shape is already wrong, the base moved
under you, or another session is writing to the same branches. Every operation
is **diagnose → back up → operate → prove**. The proof is not optional — it is
the only thing separating "rebased" from "silently destroyed." Command reference
for the CLI itself lives in the **gh-stack** skill; look it up there.

`<default-branch>` below is the repo's trunk (`main` in most repos —
`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`).

---

## Hard rules

The three near-disasters. Read them before typing anything.

1. **Never `git reset --mixed origin/<default-branch>`.** The trunk has almost certainly
   advanced past the branch's fork point — this staged **dozens of unrelated files**
   in a real session. Reset to the *true merge base*:
   `git reset --soft $(git merge-base origin/<default-branch> HEAD)`. Already did it? Recover
   with `git reset --mixed <backup-branch>` — which is why the backup ref is first.
2. **Never run `gh stack rebase` / `submit` / `sync --prune` when the stack holds
   branches you don't own or that are checked out in another worktree.**
   `gh stack rebase` rewrote some of the user's *other* stack branches while printing
   *"All branches restored to their original state"* — that message was false.
   Run the Phase 0 ownership check before every stack-wide command.
3. **Never trust a chained `&&` gate.** A `grep -v` filter that matches
   *everything* produces empty output and short-circuits the chain — the rebase
   never ran while the trailing push still fired against a stale HEAD. Likewise a
   chained `grep` on push output can show nothing on success. **Verify the
   resulting tip afterwards** (`git rev-parse`, `git fetch` + SHA compare); never
   infer it from the chain having "worked".

And the standing ones:

- **Propose → wait → act.** State the plan before the first destructive command: which branches
  move, which get force-pushed, what the backup refs are named, and what the proof will be. Every
  operation here rewrites published history; none of them is a default-yes. That gate is about
  rewriting and force-pushing — ordinary commits of verified work (a fix to cascade, a split
  slice) are made by default, staged precisely, and left uncommitted only when the user explicitly
  says so.
- **Work in a dedicated worktree, never the primary checkout.** If the user said "do not touch
  anything in the main repo, only work inside a worktree", that is a hard boundary, not a preference.
- **Backup ref before every operation:** `git branch -f backup/<name>-pre-<op> HEAD`.
- **Force-push only with a pinned lease:** `git push --force-with-lease=<branch>:<old-tip> origin <branch>`. Never bare `--force`.
- **Stage precisely.** `git add <explicit paths>` — `git add -u` swept several
  unrelated WIP files into a one-area commit in a shared worktree.
  `-A` is only safe in a scratch worktree you created yourself.
- **If the user interrupts mid-operation, freeze.** Leave state exactly as it is
  and report it with read-only commands — no auto-cleaning, no restoring a stash.
- **Never `git stash` in a worktree another agent owns** — the stash stack is
  repo-wide. Use `git checkout <base> -- <file>`.

---

## Phase 0 — Diagnose, then build the safety net

A PR whose diff "looks wrong" is almost always a **moved or rewritten base**,
not bad commits. Establish that before touching anything.

```bash
gh pr view <n> --json baseRefName,headRefOid,additions,deletions,changedFiles
gh pr diff <n> --name-only          # what GitHub thinks
git diff --name-only origin/<base>...HEAD    # what is actually true
gh pr view <base-pr> --json state,mergedAt,mergeCommit,mergedBy,baseRefName
git reflog show <branch>            # who moved it, and when
```

GitHub showing far more files than the change contains (dozens instead of a handful) means its merge-base fell back because the
shared base got new SHAs — a base problem. Rebasing onto the *new* base tip fixes
the displayed diff.

**Ownership check — before any stack-wide `gh stack` command:**

```bash
git worktree list                                  # who has what checked out
for b in <branches...>; do
  echo "$b local=$(git rev-parse --short "$b") remote=$(git ls-remote --heads origin "$b" | cut -c1-10)"
done
```
A branch whose local SHA differs from `git ls-remote` is either someone's
unpushed work or something you already moved. Stop and find out which.

**Fingerprint + backup, then operate.** The fingerprint is the only proof that
nothing but the base moved — one per branch *pair* before, re-taken after;
identical hashes mean that layer's diff is byte-identical.

```bash
git diff <lower-tip>..<upper-tip> | git hash-object --stdin
git branch -f backup/<name>-pre-<op> HEAD
```

## `restack` — the base moved, or a fix landed below you

### The base was squash-merged

The `--onto` form is `git rebase --onto <new-base> <old-base-tip> <branch>`: replay the commits
after `<old-base-tip>` onto `<new-base>`. `<old-base-tip>` is whatever the branch was stacked on
*before* the base moved — for the bottom branch of a stack, the commit just before its first
commit (its fork point from the trunk); for any branch above it, the **old tip of the branch
below it** (the same `<old-lower-tip>` the cascade recipe below uses). Take it from the backup ref
or reflog, never from the new base.

Check what the repo allows (`gh api repos/<owner>/<repo> --jq '{squash:.allow_squash_merge,merge:.allow_merge_commit,rebase:.allow_rebase_merge}'`).
When several methods are enabled, **pass `--squash` (or whichever the repo wants) explicitly**
rather than inheriting the last-used method. A squash means the base branch's
SHAs never reach the trunk, so a plain `git rebase <default-branch>` replays already-squashed
content and conflicts or duplicates. Use `--onto`:

```bash
git fetch origin <default-branch>:<default-branch>
git branch -f backup/<name>-pre-rebase HEAD
git checkout -- <watcher-noise files>                  # e.g. compiled CSS, lockfile — see gotchas
git rebase --onto origin/<default-branch> <old-base-tip> <branch>
git push --force-with-lease=<branch>:<old-tip> origin <branch>
```
Rebase the **bottom** branch of a stack first and push it, then each branch above
it onto the new tip (`--onto <new-lower-tip> <old-lower-tip> <branch>`).

Whether a plain `git rebase <default-branch>` would also have worked depends on how much the
squashed content overlaps later changes (additive-only changes often replay cleanly; overlapping
ones conflict or duplicate) — don't gamble, `--onto` is deterministic.

**Proof for a restack after a squash-merge.** `lower..upper` is meaningless once the base was
squashed, so fingerprint each branch against *its own base*, before and after:
```bash
# BEFORE (against the old base tip, taken from the backup ref)
git diff <old-base-tip>..backup/<name>-pre-rebase | git hash-object --stdin        # H_before
# AFTER (against the new base)
git diff origin/<default-branch>..<branch> | git hash-object --stdin               # H_after
git diff backup/<name>-pre-rebase <branch> --stat                                   # expect: only what the squash-merge itself changed
```
`H_before` must equal `H_after` when the trunk's only change since the fork was the squashed
base. If other trunk commits touched the same files, the hashes legitimately differ — then read
`git range-diff <old-base-tip>..backup/<name>-pre-rebase origin/<default-branch>..<branch>` and
account for every difference.

### A fix landed on a lower branch (cascade)
Navigate to the lowest branch that needs the fix, apply it there, then walk up:

```bash
git checkout -- <watcher-noise files>                  # before every hop
git add <explicit paths>
git -c commit.gpgsign=false commit --amend --no-edit   # or a fresh commit
git push --force-with-lease=<branch>:<old-tip> origin <branch>

# for each downstream branch, in order:
git rebase --onto <new-lower-tip> <old-lower-tip> <upper-branch>
```
`gh stack rebase --no-trunk && gh stack push` is the packaged form — **only** when
you own every branch in the stack (rule 2).

**Proof:** re-fingerprint every layer against the pre-op hashes (`git diff <lower-tip>..<upper-tip> | git hash-object --stdin`, per branch pair, compared to the Phase 0 values — identical means that layer is byte-identical). **Re-run the
relevant tests + the linter on changed files (e.g. `rubocop --force-exclusion <files>` — the flag makes RuboCop honour the repo's `Exclude:` for explicitly passed files) after every hop**, not just at the
end, plus one **full-chain sweep** before declaring done — a rename can break
tests in an *earlier* PR's own suite that a scoped run never touches. A conflict
resolution is code you wrote: run **code-style**'s checklist over every
hand-resolved hunk before pushing. Rebase resolutions are where a fallback
chain, a duplicated precedence derivation, or a re-added dead branch gets
reintroduced — and a green test will not catch any of them. Verify
the lockfile matches the actual **fork-point** commit
(`git diff <fork-point> HEAD -- <lockfile>`), not HEAD or `origin/<default-branch>`. When
the cascade touched user-visible behavior, the full-chain test sweep is
necessary and not sufficient: re-run the **verify-in-app** check that proved
the change in the first place, against the rebased tip. A rebase that drops a
hunk passes every test that never covered it.

**Then confirm reality on GitHub** — never trust the displayed diff after
concurrent activity:
```bash
gh pr view <n> --json baseRefName,headRefOid,additions,deletions,changedFiles,mergeable,mergeStateStatus
gh pr view <n> --json reviewDecision                       # approvals survived?
gh api repos/<owner>/<repo>/actions/runs?head_sha=<sha> --jq '.workflow_runs[0].status'
```
GitHub auto-retargets a stacked PR's base to the trunk once the parent merges; if it
didn't, `gh pr edit <n> --base <default-branch>` and delete stale "Stacked on #NNNN" text.

## `split` — one over-large branch into a stack, losslessly

Build the layers in a **scratch worktree** — it never disturbs the checkout the original branch
is in, needs no `reset`, and `git add -A` is safe there because you created it.

1. **Find a file-level seam** — backend vs frontend, services vs admin
   page/presenters. Never do hunk surgery. **Prove the seam:** grep that the
   lower layer's files never reference the upper layer's classes.
   ```bash
   git diff --numstat $(git merge-base origin/<default-branch> <orig-branch>)..<orig-branch>
   ```
2. **Back up, then find the true merge base** (never `origin/<default-branch>` — rule 1):
   ```bash
   git branch -f backup/pre-stack-split <orig-branch>
   MB=$(git merge-base origin/<default-branch> <orig-branch>)
   git worktree add --detach .worktrees/split "$MB"
   cd .worktrees/split
   ```
3. **Lower layer first**, one commit, files taken from the original tip:
   ```bash
   git checkout <orig-branch> -- <lower-layer paths...>     # fails for a path the original DELETED:
   # git rm <path>                                          # ...for those, remove it by hand
   git -c commit.gpgsign=false commit -q -F - <<'MSG'
   feat(scope): <lower layer subject>
   MSG
   LOWER=$(git rev-parse HEAD)
   ```
   **Then the upper layer = the original tree exactly** (this also carries every deletion):
   ```bash
   git read-tree -u --reset <orig-branch>      # index + worktree := the original tip's tree
   git -c commit.gpgsign=false commit -q -F - <<'MSG'
   feat(scope): <upper layer subject>
   MSG
   UPPER=$(git rev-parse HEAD)
   ```
4. **Losslessness proof (mandatory)** — the top of the stack is byte-identical to the original tip:
   ```bash
   git diff backup/pre-stack-split "$UPPER" --stat          # must be empty
   [ "$(git rev-parse "$UPPER^{tree}")" = "$(git rev-parse backup/pre-stack-split^{tree})" ] && echo identical
   ```
   Also check the lower layer alone holds exactly the seam: `git diff --stat "$MB" "$LOWER"` lists
   only the lower-layer paths.
5. **Move the branch names** (the original PR keeps its number by keeping the lower layer):
   ```bash
   cd <primary checkout>
   git worktree list     # if <orig-branch> is checked out anywhere, git refuses `branch -f`:
                         # `git switch --detach` in a checkout you own; if it's someone else's, stop and ask
   git branch -f <orig-branch> "$LOWER"
   git branch <you>/<area>/<slug>-<upper> "$UPPER"
   git worktree remove .worktrees/split --force   # only after the proof above passed
   ```
6. **Standalone-base proof** — check out the lower branch alone and run the full relevant
   suite. It must be green *with the upper layer absent* ("N examples, 0 failures"). Diff any
   failures against the original tip to prove they're pre-existing.
7. **Register in this order** — `gh stack init <existing-branch>` **before**
   `gh stack add <new-branch>`, or `init` bases the new branch off *trunk*:
   ```bash
   gh stack init <lower-branch>                 # adopts the existing branch
   gh stack add  <upper-branch>                 # layer on top
   gh stack init <lower> <upper>                # — or both at once, if both exist
   gh stack submit --auto --open
   git push --force-with-lease=<orig-branch>:<old-tip> origin <orig-branch>
   ```
   (Offline or no GitHub remote? Steps 1–6 and the `gh stack init` registration are all local;
   only `submit`/`link`/`merge` and the PR work need GitHub.)
8. **Aftermath:** repoint any downstream sibling's `--base`; rewrite **both** PR
   descriptions for their now-narrower scope (final diff state only — no "how we
   split it" narrative; see **ship-pr** §4); **move screenshots depicting the other layer into the
   other PR**; arm **pr-triage** across both PR numbers.

## `adopt` — register branches built with plain git

`gh stack add` only appends brand-new branches created sequentially *through the
tool*. For branches that already exist:

```bash
gh stack unstack --local                       # drop stale local tracking, keep the GitHub stack
gh stack init <b1> <b2> … <bN>                 # full ordered chain, bottom→top
# — or register after the fact with no local tracking (both forms work in v0.1.0) —
gh stack link --base <default-branch> <b1> <b2>
gh stack link <lowerPR#> <upperPR#> <branch> --open
```
`gh stack checkout <pr>` against a differently-composed local stack triggers an
unbypassable prompt — `gh stack unstack --local` first.

## `siblings` — competing implementations off one shared base

**Stacks are strictly linear; branching stacks are unsupported.** Two variants of
the same code path, each wanting its own PR, cannot be one stack.

```bash
git worktree add .worktrees/<name> <shared-base-sha>   # off the SHA, not origin/<default-branch>
# run the repo's worktree setup (env files, dependencies, DB) — see worktree-create
gh pr create --base <shared-branch> --head <branch> --title … --body-file …
```
A worktree helper that always forks from the default branch has no way to base a
sibling on a stacked branch — use the raw form above (**worktree-create** covers
the helper path when the default branch *is* the base).
**Verify the env files and symlinks; do not assume which landed** — a sibling
worktree with an incomplete set can silently fall back to the wrong
external-service endpoint or the wrong database. Check before trusting either — print the
database the test environment actually resolves to, for example:
```bash
RAILS_ENV=test bin/rails runner 'puts ActiveRecord::Base.connection_db_config.database'
# or the equivalent for your stack (`node -e 'console.log(process.env.DATABASE_URL)'` after loading config, ...)
```
The canonical check and the fallbacks (symlink the missing file by hand, or pass the
database URL inline) are owned by **worktree-create** — don't re-derive them here.

A sibling on an *already-stacked* branch is its own stack with a custom trunk:
`gh stack init --base <mid-stack-branch> <new-branch>`; re-root later with
`unstack --local` + `init`. Cross-link the sibling PR numbers in each body, and
when CI catches a regression common to all of them, fix each branch's own copy.

## `recover` — another session rewrote the branches

**Symptom:** local SHAs diverge from `git ls-remote`; PRs display grossly
inflated diffs; `gh stack rebase` claimed it restored everything.

1. What moved? `git reflog show <branch>` per branch, plus the Phase 0 ownership
   check. State plainly what *you* caused.
2. Nothing pushed ⇒ nothing lost. Restore each branch to its remote SHA with
   `git branch -f <branch> <remote-sha>`. **A branch checked out in someone
   else's worktree can't be restored this way** — a `reset --hard` there is
   correctly blocked. Stop, report the exact SHAs, let the human do it.
3. Push **only your own branch** (`git push --force-with-lease=… origin <branch>`),
   never `gh stack submit`, which force-pushes everyone's.
4. Detaching a branch from a stack entirely:
   `git rebase --onto origin/<default-branch> <old-base-sha> <branch>`. A `DU`
   (deleted-by-us) conflict on a file that exists only in a not-yet-merged
   sibling ⇒ `git rm --cached <path>` and delete it; it can't ride onto the trunk.
   Then re-run that branch's tests **against the trunk**.
5. **Proof:** `git diff origin/<default-branch>..HEAD | git hash-object --stdin` matches the
   pre-detach fingerprint, and `gh pr view` reports the right file count.

### Resolving the conflicts that actually occur

Full resolvers in **[REFERENCE.md](./REFERENCE.md) § Conflict resolvers**. The
headlines:

- **Schema dumps / migration-version lists** (`db/structure.sql`, `schema.rb`, a migrations-version table dump) — union both sides,
  keep the file's sort order (version lists are typically strictly descending or ascending), never pick a side; then re-run the migration tooling and diff.
- **Generated artifacts** (GraphQL types/schema dumps, OpenAPI clients, codegen output) — **never hand-merge.** Take the trunk's side, then
  regenerate against a server running the *rebased* code.
- **Additive test conflicts** — re-check the nesting even when green; git nests
  examples under the wrong `context` and the suite passes testing the wrong thing.
- **Deleted-by-base** — `--ours` is wrong; find where the refactor moved the
  logic and reapply it there.
- **`rebase --continue` refuses on a clean index** — stale rerere state, not a
  real conflict. Abort and cherry-pick with `rerere` disabled.

## `merge-order` — prove it, then merge

Test it, don't reason about it. `git merge-tree` performs a real merge without
touching any worktree, and a clean merge can still be semantically wrong:

```bash
git fetch origin --quiet
A=$(git rev-parse origin/<branch-a>); B=$(git rev-parse origin/<branch-b>)
TREE=$(git merge-tree --write-tree --name-only $A $B)   # exit 0 = clean; 1 = conflicts listed
# materialize the winner, then run the real suite + a behavior check
SHA=$(git commit-tree "$TREE" -p $A -p $B -m "merge-check")
git worktree add --detach .worktrees/merge-check "$SHA"
# … run the relevant tests ; a runner-script behavior check …
git worktree remove .worktrees/merge-check --force
```
If the repo **squash-merges**, also simulate squash semantics — reset to a
synthetic single-commit state before the second `merge-tree`. That's the harder
case: a squash discards ancestry, so the second PR three-way merges against the
original base with no knowledge that the first landed. Test **both orders**.

Merge in the user's stated order, and **respect explicit sequencing**
(*"merge the base PR if CI is green, don't merge the UI layer yet"*):

```bash
gh pr view <n> --json headRefOid,mergeable,mergeStateStatus,reviewDecision   # CLEAN + APPROVED first
gh pr merge <n> --squash
# then POLL before the next — GitHub recomputes mergeability asynchronously and
# briefly reports UNKNOWN:
for i in $(seq 1 12); do gh pr view <m> --json mergeable,mergeStateStatus; sleep 5; done
```
On a **registered stack**, `gh pr merge` on the base PR is **rejected** ⇒
`gh stack checkout <top-pr>` then `gh stack merge --yes --squash` (bottom-up,
atomic). Afterwards confirm both merged and `origin/<default-branch>` actually advanced;
since a squash hides the intermediate commits, report the rebase-time fixes
explicitly with `git diff origin/<default-branch>...<branch> -- <path>` per fix.

---

## Verified gotchas

- **Watcher-regenerated files (compiled CSS, lockfiles) re-dirty the tree between chained
  commands** (a CSS watcher, an incidental `bundle install` / `npm install`) and abort every
  rebase with "You have unstaged changes". `git checkout -- <them>` immediately
  before each rebase/commit — not `git stash`.
- **Inside a worktree `.git` is a file**, so a scripted `[ -d .git/rebase-merge ]`
  check silently no-ops. Use `git rev-parse --git-path rebase-merge`. And a
  scripted `git rebase --continue` exiting non-zero usually just means the *next*
  commit conflicts — read the output before panicking.
- **Every force-push triggers fresh CI** even when the diff is unchanged.
  `git commit --amend --date=now` is the approval-preserving way to force a real
  `synchronize` event (where the repo doesn't dismiss stale reviews) with no filler commit.
- **`gh workflow run` (workflow_dispatch) does not satisfy branch protection.**
  Dispatch runs bind to the *branch*, not the PR, so a fully green dispatched run
  never attaches to the merge box. Only a real push does.
- **`gh stack sync --prune` silently relocates another worktree** that had the
  pruned branch checked out, keeping its old directory name.
- **Layer placement follows real coupling** — e.g. a base-class macro that both
  declares an attribute list and generates the accessor means an attribute-removal
  commit must live in the layer owning every caller (REFERENCE.md § Layer-placement).
- If the database/Docker isn't available locally, **say so and rely on CI** rather
  than silently skipping the test proof.
- More in **[REFERENCE.md](./REFERENCE.md) § Long-tail gotchas** — asset-tooling
  `.keep` deletions, zsh refspec parsing, eslint globs, detached HEAD after
  `--onto`, stale hardcoded-literal tests, `gh pr merge --delete-branch` vs.
  worktrees, CodeRabbit skipping non-default bases.

---

## When not to use this / hand off to

- **gh-stack** — the CLI reference: subcommands, flags, exit codes, `--json`
  shapes, non-interactive agent rules. Read it before any `gh stack` invocation.
- **ship-pr** — opening a *new* PR: branching, verifying by driving the app,
  before/after screenshots, private-repo image embedding, description shape.
- **worktree-create** / **worktree-dev-server** — provisioning the worktree this
  surgery must happen in, and serving one on the app's pinned port.
- **pr-triage** — after the restack: watching CI and bot findings across the new
  PR numbers and verifying each against the code.
- **dev-doctor** — when the tests behind a proof step won't run because the local
  stack is broken, not because the rebase was wrong.
- **agent-team** — a stack being built by parallel agents: file ownership and the
  freeze-and-relocate incident response live there.
- **code-style** — shape review of any hand-resolved conflict hunk before
  pushing it.
- **verify-in-app** — re-proving behavior on a rebased or split tip, not just
  re-running tests.
- **deep-pr-review** — reading what each layer actually contains, against its
  real base, before deciding where to cut a split.

An ordinary rebase onto an unmoved trunk doesn't need this skill —
`gh stack sync` (when you own every branch) is enough.
