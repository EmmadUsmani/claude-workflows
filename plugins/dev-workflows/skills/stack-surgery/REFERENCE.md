# stack-surgery reference

Long-tail detail for the **stack-surgery** skill. Read the relevant section when
you hit the situation; don't read it front to back.

For `gh stack` CLI syntax (flags, exit codes, `--json` shapes, agent rules) see
the **gh-stack** skill instead.

---

## Conflict resolvers

The conflicts that actually occur when restacking, and the resolution that is
correct rather than merely green. File names below are Rails/React-flavoured
examples; the rule applies to the equivalent in any stack.

### Schema dumps and migration-version lists (`db/structure.sql`, `schema.rb`)
Almost always the applied-migrations version list at the bottom of the file
(`INSERT INTO "schema_migrations" (version) VALUES …`). The versions are stored in a
fixed order (strictly descending in a `structure.sql`).

**Union both sides and re-sort in the file's own order** — never pick a side, and never
`--ours` / `--theirs`. Then run the migration tooling (`db:migrate`) and diff the regenerated
file against your hand-merge; they should agree.

The same keep-both judgment applies to two independently-appended `validates`
lines, or any other purely additive list.

### Generated artifacts (GraphQL types, schema dumps, OpenAPI clients)
Example: `graphql-types.ts`, a `gql-schema.json` introspection dump, a `schema.graphql` file.

**Never hand-merge these.** Take the trunk's side through the rebase, then regenerate with the
project's codegen command (`yarn codegen`, `npm run generate`, …):

Regeneration requirements that bite:
- It needs a **running server serving the rebased code** when codegen introspects a live
  endpoint. A dev server started before the rebase serves the *stale* schema and silently drops
  genuinely new types — the diff looks plausible and a brand-new input type is just missing.
- Check which server your framework's default dev command starts: some (WEBrick, a
  single-threaded dev server) cannot serve the introspection POST at all.
- Deterministic alternative when no server is available: dump the schema from the app's own
  runner (`bundle exec rails runner`, a script importing the schema module), write it to a
  file, and point a temporary codegen config at that file.
- Formatting drift is real: fresh codegen may emit single-line docstrings where the trunk's
  committed artifact has them wrapped, producing a large phantom diff. That is a
  formatting-pipeline mismatch, not your change. Land unrelated codegen drift in its **own**
  "regenerate types" PR rather than smuggling it into a feature layer.

### Additive test conflicts
Read *both* versions' nesting, then hand-reconstruct from the trunk's file with your
block re-inserted at the right level.

**Re-check test nesting after any non-trivial auto-merge even when the suite is
green.** Git will happily nest one `context`'s examples inside an unrelated one;
the suite passes while testing the wrong thing.

### Deleted-by-base / modified-by-mine
`git checkout --ours` is wrong here. The base didn't delete the file by accident
— a refactor moved the logic. Find where:

```bash
git ls-tree -r --name-only <new-base> | grep <fragment>
git grep -n '<ClassName>' <new-base>
```
Reapply your change at the new home. (A real shape of this: a monolithic `ReportRow` class was split into three
query objects on the trunk; the fix belonged in the last one.)

A `DU` (deleted-by-us) conflict on a file that exists **only** in a not-yet-merged
sibling branch: `git rm --cached <path>` and delete it. It cannot ride onto the trunk.

### Semantic preservation across a rebase
Before rebasing, enumerate the trunk's commits since the branch point that touch the
same files, `git show` each, and **name every invariant they encode** in words
("soft-deleted posts stay hidden unless an admin restores them"). Merge both
intents rather than choosing.

Afterwards, **prove each preserved behavior is load-bearing**: temporarily strip
just that logic and re-run the specific test. If it doesn't fail, either the
coverage or your resolution is missing something.

Finally sweep for leftovers — `git grep -ln '^<<<<<<< \|^>>>>>>> '`. Decorative
`====` banner comments are false positives.

### `git rebase --continue` refuses on a clean index
Symptom: `git ls-files -u` is empty, `git status` shows nothing unmerged, and
`rebase --continue` still refuses. Cause: stale `rerere` / `AUTO_MERGE` /
`MERGE_RR` state.

Do **not** debug git internals. Switch to a deterministic equivalent:

```bash
git rebase --abort
git reset --hard origin/<default-branch>
git -c rerere.enabled=false cherry-pick <c1> <c2> <c3> …    # one commit at a time
git branch -f <branch> HEAD
```

Alternate escape from the same state:
`git -c core.editor=true commit --no-edit`, `git rebase --quit`, cherry-pick the
remainder, then move the branch ref.

---

## Layer-placement facts

Real code coupling sometimes dictates which stack layer a commit must live in. Check, before
deciding the cut, whether either of these shapes is in play:

- **A declaration macro that also generates accessors.** Example: a base-class helper
  `has_fields :title, :body` that both records the field list **and** calls
  `attr_accessor` for each. Removing a field deletes the reader method entirely, so a
  field-removal commit must sit in whichever layer owns *every* caller, not in a lower one.
  Grep for the macro's callers before choosing the layer.
- **Generated files that land in the wrong place.** A modular app may generate migrations
  (or other scaffolding) into the host app's directory and expect them to be moved into the
  owning module's directory. A commit that includes the generated file in the wrong
  directory belongs to no layer cleanly — move it first, then place the commit.

---

## Long-tail gotchas

- **A failed asset build (`yarn build` / `assets:precompile`) deletes tracked placeholder
  files** such as `app/assets/builds/.keep`, which a broad `git add app` then sweeps
  into the commit. Check `git diff --stat` against the base before committing
  after any asset tooling ran.
- **zsh eats part of a push refspec** when an unbraced `$var:r` parses as a
  parameter modifier. Brace it: `${var}`.
- **`eslint` globs matching a deleted file reject the whole batch** — filter the
  list to files that still exist before invoking it.
- **`--onto` can leave a detached HEAD.** Move the branch ref to the rebased tip
  (`git branch -f <branch> HEAD`) before pushing, or you push nothing.
- **A test asserting a hardcoded literal** (e.g. a computed checksum or formatted total) can go stale because
  unrelated upstream code changed the computation. Recompute the expected value
  from the current code path; don't delete the assertion.
- **`git stash push -- <file>` on an already-committed change is a silent
  no-op**, and `stash@{0}` may belong to another worktree — the stash stack is
  repo-wide and shared. `git stash list` first; prefer
  `git checkout <base> -- <file>`. Never stash inside a worktree another agent owns.
- **`gh stack sync --prune` silently relocates another worktree** that had the
  pruned branch checked out, moving it to trunk while keeping its old directory
  name — so the directory lies about what's in it.
- **`gh pr merge --delete-branch` fails when the default branch is checked out in another
  worktree.** Pull the default branch there instead of deleting from here.
- **`gh stack checkout <pr>`** against a differently-composed local stack
  triggers an unbypassable interactive prompt. `gh stack unstack --local` first
  (that keeps the GitHub stack intact), then retry.
- **`gh run rerun` on an individual job silently no-ops** while the parent run is
  still in progress.
- **CodeRabbit skips any PR whose base isn't the default branch**, so every stack layer above
  the bottom gets only Bugbot plus humans. A quiet upper layer is not a clean one.

---

## Repo facts this skill assumes — re-check them per repo

| Fact | How to re-check |
|---|---|
| Which merge methods are allowed (squash / merge commit / rebase) | `gh api repos/<owner>/<repo> --jq '{squash:.allow_squash_merge,merge:.allow_merge_commit,rebase:.allow_rebase_merge}'` |
| Default branch name | same call, `.default_branch` |
| `gh stack` extension version | `gh extension list \| grep stack` (v0.1.0 at time of writing) |
| Migration-version list sort order | the tail of the schema dump file — check before re-sorting |
| Frontend codegen entrypoint | the `codegen` script in `package.json` |
| What the worktree setup actually symlinks / copies | **worktree-create** owns this — verify by printing the database the test env resolves to, don't assume |
| A repo hook (e.g. a comment-ratio check) that scores the working-tree diff | `ls .claude/hooks/` and the repo's git hooks |
