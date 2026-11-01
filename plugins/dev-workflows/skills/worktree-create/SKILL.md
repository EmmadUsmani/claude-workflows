---
name: worktree-create
description: Create an isolated git worktree for a project and provision it so it can actually run — plain `git worktree add` under `<worktrees_dir>`, then a per-project checklist (ignore rules, env-file symlinks verified rather than assumed, a collision-free port, an isolated Docker Compose project, an optional per-worktree database and job-queue namespace, dependency install). Use when the user wants a parallel worktree, an isolated env to run a branch's backend / specs / migrations without disturbing the main checkout, or to work several branches at once. Covers the provisioning checklist, lifecycle and safe teardown order, and the verified gotchas (env symlink coverage, Docker memory OOM, servers and frontends that pin a fixed port, job queues shared across worktrees). NOT for booting the frontend dev server from a worktree (worktree-dev-server), for a stack that's already broken (dev-doctor), or for a worktree-per-agent fan-out (agent-team).
argument-hint: "[branch name] [--base <ref>] [--isolated]"
---

# Create a worktree that can actually run the app

A bare `git worktree add` gives you source files and nothing else: no env files, no installed
dependencies, the same ports and containers as the main checkout, and the same database. This
skill is that command **plus** the provisioning checklist that turns the directory into a
runnable, isolated copy — so several branches can run at once on distinct ports / containers /
databases without stopping and restarting each other's servers.

Arguments: `--base <ref>` picks the fork point (golden path, third line); `--isolated` means do
checklist step 4 (own database + queue namespace). Without `--isolated`, step 4 is skipped and the
worktree shares the dev DB and queues — say so when you hand it over.

If the project already ships a worktree helper (a `bin/worktree-setup`, a `make worktree`, a
`scripts/new-worktree`), prefer it and use this checklist to **audit what it does and doesn't
cover**. Record the project's answers (port scheme, which env files exist, the shared DB
container's name, its config env vars) in the project `CLAUDE.md` so the next run doesn't
rediscover them.

**Propose → wait → act.** Creating a worktree is cheap; `git worktree remove --force`,
`docker compose down -v`, `docker stop` and dropping a database are not. Say which worktrees,
containers and databases you intend to touch and wait — another session may own the one whose
name looks stale. If interrupted mid-operation, leave state exactly as-is and report it.

## Golden path

```bash
MAIN=<abs-main-checkout>; WT=<worktrees_dir>/<branch-with-slashes-as-dashes>
git -C "$MAIN" check-ignore -v .worktrees/       # trailing slash: without it a not-yet-created dir never matches `.worktrees/`
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree add -b <branch> "$WT" origin/<default-branch>   # new branch off the default
git -C "$MAIN" worktree add "$WT" <existing-branch>                     # or check out an existing one
git -C "$MAIN" worktree add -b <branch> "$WT" origin/<base-ref>         # or --base: a teammate's / a stacked base
git -C "$WT" status                                                     # sanity: right dir, right branch
```

`<worktrees_dir>` defaults to `<repo>/.worktrees`. If the `check-ignore` prints nothing, the
directory isn't ignored and every `git status` in main will fill with a nested checkout. Ignore it
**locally** — `printf '.worktrees/\n' >> "$MAIN/.git/info/exclude"` (no repo diff) — or propose a
`.gitignore` change as its own PR. Add the port marker, any per-worktree data dir, and
`node_modules/` the same way if the repo doesn't already ignore them. The slug (branch with `/`
→ `-`) is also the name you reuse for the Compose project, the database suffix and the logs.

Then run the checklist below, in order. Each step is idempotent; re-running it on an existing
worktree is how you repair one.

## Provisioning checklist

### 1. Config — symlink env files (never read them), then verify what the app resolves

```bash
ls -a "$MAIN" | grep -E '^\.env'            # names only — never cat/read them
for f in .env .env.local .env.development.local .env.test.local; do
  [ -e "$MAIN/$f" ] && ln -sfn "$MAIN/$f" "$WT/$f"
done
```

Link **every** per-environment override the main checkout has, not just `.env`. Some tool-config
files need the same treatment (Bundler's `.bundle/`, a local `.npmrc`). Then find out which env
vars the app actually reads, **and their defaults** — config is often plain
`process.env.X || '<default>'` / `ENV.fetch('X', …)` / `os.getenv('X', …)` with no env file at all:

```bash
cd "$WT" && git grep -nE 'process\.env\.[A-Z_]+|ENV(\.fetch)?\[?\(?.[A-Z_]+|os\.(getenv|environ)' -- ':!*lock*' | head -50
```

A default that points **outside the repo** (`/var/lib/app/app.db`, `~/.app/cache`, a fixed
`localhost:<port>`) is shared state across every checkout — step 4 has to override it. Then prove
the worktree resolves config the way you expect — through the app, not by opening a file:

```bash
cd "$WT" && node -e 'console.log(require("./src/config").db)'              # the app's own config module
cd "$WT" && RAILS_ENV=test bin/rails runner 'puts ActiveRecord::Base.connection_db_config.database'
cd "$WT" && python manage.py shell -c 'from django.db import connection; print(connection.settings_dict["NAME"])'
```

See gotcha 0 for why this check is mandatory. If `ln` is permission-denied, pass the value inline
per command (`DATABASE_URL=… npm test`) instead.

### 2. A collision-free port

Choose a base port for the worktree that clears the main checkout's range, the ports sibling
worktrees have claimed, and anything listening now. Reserve one port per process in the formation
(`K` below — e.g. 2 for web + frontend dev server). This picks the next free base, stepping by 10
from `<dev_url>`'s port + 1000:

```bash
MAINPORT=$(ruby -ruri -e 'puts URI(ARGV[0]).port' '<dev_url>'); K=2; STEP=10
claimed=$(find "<worktrees_dir>" -maxdepth 2 -name .dev-port -exec cat {} + 2>/dev/null)   # find, not a glob: zsh errors on an unmatched */.dev-port
p=$((MAINPORT + 1000))
while echo "$claimed" | grep -qx "$p" || lsof -nP -iTCP:$p-$((p+K-1)) -sTCP:LISTEN | grep -q .; do p=$((p+STEP)); done
echo "$p" > "$WT/.dev-port" && git -C "$WT" check-ignore -v .dev-port && echo "base port $p"
```

Persist the choice in a gitignored marker so later boots (**worktree-dev-server**) and **dev-doctor**
(when it attributes a mystery listener) can read it back. If the project's helper already uses a
marker of its own, use that name instead.

**Does the server honour `PORT`?** `git grep -nE 'listen\(|port:' -- ':!*lock*'`. A hard-coded
`app.listen(3000)` ignores both `PORT` and the marker; the minimal fix is
`process.env.PORT || 3000` (or the framework's equivalent) — ask first, and keep it in its own
commit, separate from the feature. If the boot script reads both `PORT` and a marker, read it to
see which wins and note it in the project `CLAUDE.md`.

### 3. An isolated Docker Compose project

Containers are keyed by Compose project name, which defaults to the **directory name** — two
checkouts of one repo in differently named dirs get separate stacks, but two named alike collide.
Name it explicitly:

```bash
cd "$WT" && PORT=$(cat "$WT/.dev-port") docker compose -p <slug> up -d     # or COMPOSE_PROJECT_NAME=<slug>
docker compose ls                                                          # every project, and its status
```

- Host ports in the compose file must be parameterized (`"${PORT:-3000}:3000"`), or the second
  stack fails to bind. If they're hardcoded, run only shared infra in Docker and the app on the host.
- Keep **shared infra** (Postgres, Redis, an S3/queue emulator) in one long-lived project that
  every worktree points at, and only the **app** stack per worktree. Never `down -v` the shared one.
- A fresh worktree's first `up` builds images and takes minutes. Built **images** are reused
  across projects when the build context and tag match — so a second worktree's build is mostly
  cache. Don't "speed it up" by setting the project name to another checkout's: that attaches to
  **its containers** and throws away the isolation this step exists for.

### 4. Optional (`--isolated`): a per-worktree database and queue namespace

Use this for migrations, destructive data changes, or anything that enqueues heavily — anything
that must not touch the shared dev DB or the shared job queues (gotcha 3).

```bash
# Postgres in a shared container
docker exec <shared-postgres-container> createdb -U postgres <app>_dev_<slug>
docker exec <shared-postgres-container> createdb -U postgres -T <seeded-db> <app>_dev_<slug>   # or clone a seeded DB nobody is connected to
cd "$WT" && DATABASE_URL=postgres://postgres@127.0.0.1:5432/<app>_dev_<slug> bin/rails db:prepare
#   npx prisma migrate deploy · npx knex migrate:latest · python manage.py migrate
# File-backed DBs (SQLite, DuckDB, a JSON store): point the app's path var inside the worktree
mkdir -p "$WT/.data" && <APP_DB_PATH_VAR>="$WT/.data/app.db" <migrate-or-init-cmd>
```

Same shape for the test DB (`<app>_test_<slug>`). Give the worktree its own Redis DB number
derived from its port, so two worktrees never pick the same one:
`REDIS_URL=redis://127.0.0.1:6379/$(( ($(cat "$WT/.dev-port") / 10) % 15 + 1 ))` (DB 0 stays
main's). Or a key prefix, if the job library supports one.

- **A flag or marker that says "isolated" is not a database.** A worktree helper that writes its
  `isolated` marker immediately but creates the DB only on the next full boot leaves a runner-only
  workflow silently on the shared DB. Confirm the DB exists (`psql -l`, the file exists, or the
  step-1 check) before running anything destructive.
- An initializer that queries the DB at boot can make `db:prepare` fail on an empty database.
  If the app has an env switch to skip it, set it for the prepare command only.

### 5. Dependencies

```bash
cd "$WT" && npm ci        # / pnpm install --frozen-lockfile / yarn install --frozen-lockfile
cd "$WT" && bundle install                       # or `bundle check || bundle install`
cd "$WT" && uv sync                              # / pip install -r requirements.txt into the worktree's venv
```

Install per workspace in a monorepo (each dir with its own lockfile). Symlinking `node_modules`
from main saves minutes but is only safe when the lockfile is **byte-identical**
(`cmp "$MAIN/<dir>/package-lock.json" "$WT/<dir>/package-lock.json"`) **and** main actually ran
the install there — a symlink to a sub-workspace main never installed fails as
`cannot resolve <pkg>` at boot. Lockfile churn from an install you only needed locally gets
reverted before committing.

### 6. Seed a dev login, if the app needs one

If the app has a seed task for its dev user / admin bypass, run it against the worktree's DB
(isolated DBs start without it). If the seed goes through the running app, wait until it answers
(**worktree-dev-server** step 4) before seeding. Record the login in the project `CLAUDE.md`.

If a webhook from an outside service must reach the worktree, expose its port with a tunnel
(`ngrok http <port>`, `cloudflared tunnel --url http://localhost:<port>`) — and tear it down after.

## Lifecycle

```bash
git -C "$MAIN" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do
  printf '%-60s port=%s\n' "$w" "$(cat "$w/.dev-port" 2>/dev/null || echo -)"
done
docker compose ls                                 # which Compose projects are up
```

**Teardown** (propose first — every step here destroys something). Order matters: the
non-forced `worktree remove` goes **first**, because its refusal on uncommitted changes is the
only guard you get — drop the DB first and you can't take that back when it refuses.

```bash
git -C "$MAIN" worktree remove "$WT"              # refuses with uncommitted changes — stop there and ask
docker compose -p <slug> down                     # app stack only; never the shared infra project
docker exec <shared-postgres-container> dropdb -U postgres <app>_dev_<slug>   # isolated DB, if any
git -C "$MAIN" worktree prune
```

(`docker compose -p <slug> down` works without the directory, since the project name is
explicit.) `--force` on `worktree remove` discards uncommitted work; ask first. If removal fails
because a container still holds the directory, bring that stack down first, then retry; git
metadata may already be pruned, leaving a stray directory to delete by hand.

**Hooks can tear stacks down for you.** Check the repo's `.claude/settings.json`: a `SessionEnd`
hook that stops the dev stack will stop a worktree's containers between turns. Re-check with
`docker compose ls` rather than assuming the stack is still up.

**Every command takes an absolute path.** The harness resets Bash's cwd between tool calls, so a
`cd` from an earlier call is gone and the next `bin/…` silently runs in the **main checkout**.
Sanity-check with `git -C <abs-worktree-path> status` before anything that writes.

## Verified gotchas

0. **The env symlinks may not cover the file you need — verify, don't assume.** A worktree
   helper that linked `.env`, `.env.local` and `.env.development.local` but not
   `.env.test.local` made specs in fresh worktrees silently run against the **development**
   database. The gap was "fixed" more than once for neighbouring files and still bit — so run the
   step-1 check every time rather than trusting either story. The same check matters for local
   overrides that point a third-party integration at a local stub: without the override file, the
   dev environment silently sent its requests to the **real, production** third-party endpoint.
   Never read `.env*` to work this out — introspect through the app's own config.

1. **Docker memory / OOM (exit 137).** Docker Desktop's memory cap fills fast: a couple of heavy
   containers (a search engine, a local model server) plus shared infra plus one full app stack can
   use all of it, so a second app stack — or a leftover dev server from the main checkout — gets
   OOM-killed. The container shows `Exited (137)` and the boot hangs waiting for an app that never
   comes up. Fix: `docker stats --no-stream`, stop what you don't need (propose it first if it
   isn't yours), then bring the new stack up. Raise Docker's memory limit if this is routine.

2. **Servers and frontends that pin a fixed port.** If the server hard-codes its listen port, or
   the frontend reads its API base from an env var (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`…) that
   the symlinked `.env` sets to the main checkout's port, a worktree on its own port either can't
   bind there or calls main's server → connection refused or CORS-blocked → blank page / endless
   spinner. Backend, admin pages and specs on the worktree's own port are unaffected when only the
   frontend is pinned. Use isolated worktrees for **backend / API / spec / migration** work; to
   drive the **frontend** in a browser, serve that worktree on the pinned port —
   **worktree-dev-server** owns the full explanation, including the cheap "unset it and let it
   fall back" fix.

3. **Job queues and Redis are shared across every worktree unless you isolated them.** Every
   worktree pointing at the same Redis DB feeds the same queues, so one branch's leftover jobs
   starve another's — a low-priority queue backed up by tens of thousands of jobs and hours of
   latency looks exactly like "my change broke the async path". Check queue depth before blaming
   the code (**dev-doctor** Phase E), and give heavy-enqueue work its own Redis DB (step 4).

## When NOT to use this

- Pure UI/frontend iteration or browser screenshots for one branch → **worktree-dev-server**
  (serve that worktree on the pinned port), which sidesteps gotcha 2.
- A quick throwaway branch you'll develop in place → plain `git switch -c`.
- **Pure git/PR work that never runs the app** (a revert, a rebase, reading a branch's diff) →
  the golden-path `git worktree add` alone, no checklist. Ports, containers and a seeded login
  are overhead you'd then have to tear down.
- **Something's already broken** — blank page, stuck spinner, specs that can't reach the DB, a
  stack that won't boot → **dev-doctor** first. Another worktree on top of a wedged environment
  just adds a second broken thing.
- **A worktree per parallel agent** (ownership lists, NEVER-touch lists, freeze-and-relocate) →
  **agent-team**; it drives this skill rather than replacing it.
- **Siblings off a stacked base, or restacking** → **stack-surgery**; the branch/PR mechanics
  once the worktree exists → **ship-pr** / **gh-stack**.
- **A toolkit that will mutate dev data** → design it under **sandbox-tool**; create its worktree
  here with `--isolated` (step 4), which is exactly what that case needs.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
