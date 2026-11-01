# dev-doctor reference — map your stack once

Companion to [SKILL.md](./SKILL.md). The skill's phases are stack-agnostic; the commands that
make them fast are not. This file is (1) a template for the facts worth recording per project,
read out of the repo rather than guessed, and (2) the Node / Python equivalents of the
Rails-flavoured commands in the skill. Mark anything sources disagree on `(verify)`.

Record the filled-in map in the project `CLAUDE.md` (or a `docs/dev-environment.md` it links
to), so future sessions don't rediscover it under pressure.

---

## 1. Port map

Most dev formations derive every port from one base. Read the boot script, `Procfile.dev`,
`config/puma.rb`, `vite.config.*`, `package.json` scripts and the compose files, then fill in:

| Offset | Process | Env var | Notes |
|---|---|---|---|
| `PORT + 0` | web server (Puma, Express, Django, uvicorn) | `PORT` | |
| `PORT + 1` | frontend dev server (Vite, webpack-dev-server) | e.g. `VITE_PORT` | does the backend proxy assets to it? `strictPort`? |
| `PORT + n` | any other dev process that listens | | a hard-coded default port here collides between stacks |

Port precedence: `ENV['PORT']` vs a per-worktree port marker vs a hard-coded `listen(…)` / config default — which wins?
Does boot refuse to start when anything in the range is listening (good), or drift (bad)?

Fixed ports worth knowing: Postgres 5432, Redis 6379, MySQL 3306, LocalStack 4566, MinIO 9000,
Elasticsearch 9200, Storybook 6006, plus any sidecar services the app calls.

Worktree port allocation: `<dev_url>` port + an offset, stepping per worktree, skipping sibling-claimed and in-use
ports, persisted in a gitignored marker (**worktree-create** step 2), and how many ports one formation needs.

## 2. Hostnames and URLs

| Role | URL | Override env var |
|---|---|---|
| API / admin / GraphQL | `<dev_url>` | |
| Browser app (if a separate origin or subdomain) | | |
| Where the frontend gets its API base | file + env var | e.g. `VITE_API_URL` |

- Is there a health route? (Rails ≥ 7.1: `/up`. Many apps: none — poll a real page.)
- What is the cheapest **API** readiness probe (a CSRF-token endpoint, `/graphql` with a trivial
  query)?
- What is the **frontend** readiness probe through the backend's proxy (e.g.
  `/<asset-prefix>/@vite/client`)?
- Do SPA routes need a browser-shaped `Accept` header to get the shell instead of a 404?

## 3. Process formation

Copy the `Procfile.dev` / `package.json` `dev` script / compose services list here. Then note:

- **Which supervisor**, and whether it kills the whole group when one child fails (foreman and
  overmind do; `concurrently` does with `--kill-others`).
- Any auxiliary process (a sub-workspace watcher, a CSS watcher) that can take the formation down.
- **Puma facts** (Rails): `workers ENV.fetch('WEB_CONCURRENCY', …)` (clustered in dev?),
  `preload_app!`, thread counts, dev `worker_timeout`. Forked workers on macOS + outbound TLS ⇒
  hangs (skill C3); `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` is the related macOS fork-safety
  switch some boot scripts set.
- **"Alive but wedged" equivalents:**
  - Rails / Puma — `kill -INFO <pid>` dumps thread backtraces.
  - Node — `node --inspect` / `kill -USR1 <pid>` to attach the inspector; an `await` on a fetch
    with no timeout looks exactly like a hang. `NODE_OPTIONS=--trace-warnings` for silent rejections.
  - Python — `py-spy dump --pid <pid>`; gunicorn `--timeout`; a sync worker class blocks on I/O.
- What hot-reloads and what doesn't (Rails autoload roots at boot; job workers never).

## 4. Docker topology

| Compose file | Project name | Containers | Volumes | Shared by every worktree? |
|---|---|---|---|---|
| shared infra | | Postgres, Redis, emulators | | yes — never `down -v` |
| per-branch app | derived from branch/dir, or `-p` | | | no |
| sidecar repos | | | | |

- Which databases live in the shared Postgres container (dev, test, each worktree's isolated DB)?
- Does the emulator persist objects across restart (LocalStack `PERSISTENCE=1` + a bind mount)?
  A container **recreate** still loses them.
- Does the dev command's "stop" bring down only the branch's app project, or shared infra too?
- Is shared infra anchored at the main checkout (`git rev-parse --git-common-dir`) even when
  invoked from a worktree? Then volumes follow main.

## 5. Job queues

| Stack | Read-only status | Clear (destructive — go-ahead first) |
|---|---|---|
| Rails / Sidekiq | `Sidekiq::Queue.all.map { [_1.name, _1.size, _1.latency] }`, `Sidekiq::RetrySet.new.size`, `Sidekiq::DeadSet.new.size`, `Sidekiq::Workers.new.size` | `Sidekiq::Queue.new(name).clear`, `Sidekiq::RetrySet.new.clear` |
| Rails / Solid Queue, GoodJob | query the jobs table via `bin/rails runner` | discard via the library's API, not raw `DELETE` |
| Node / BullMQ | `await new Queue(name, { connection }).getJobCounts()` | `queue.drain()` (waiting), `queue.clean(0, 500, 'failed')` (grace ms, limit, type) |
| Python / Celery | `celery -A <app> inspect active` / `reserved`, `redis-cli llen <queue>` | `celery -A <app> purge -Q <queue>` |
| Python / RQ | `rq info --url redis://127.0.0.1:6379/<n>` | `rq empty <queue>` |

Record the queue names in priority order and the worker concurrency — a ~5-thread local worker
serving **all** queues is easy to starve.

## 6. Dev CLI / tasks surface

List the project's dev tasks (`bin/*`, `rake -T dev`, `make help`, `npm run`) with one line each,
and mark which are **read-only** (a `doctor` task that always exits 0 is gold) and which are
**destructive** (anything that drops / rebuilds the dev DB from a snapshot, reseeds, or wipes a
bucket). Note the seeded dev logins by role, not password, if the seed task prints them.

## 7. Node workspaces

| Workspace | Dir | Lockfile | Install |
|---|---|---|---|
| root | `.` | | |
| frontend | | | |
| … | | | |

Note which ones a worktree may symlink from main (lockfile byte-identical **and** installed in
main) and which must install fresh.

## 8. Env files and env-var names

Which `.env*` files exist (names only — `ls -a | grep '^\.env'`), their precedence in the app's
loader and in the Procfile runner (they can disagree), and which ones the worktree setup links.

Env-var **names** worth knowing — never read the files, reference by name:

| Var | Used by |
|---|---|
| `PORT` (+ per-process ports) | port resolution |
| `WEB_CONCURRENCY`, `RAILS_MAX_THREADS` | Puma |
| the frontend's API-URL var | the frontend's API base |
| `DATABASE_URL`, `REDIS_URL` | per-worktree isolation |
| `COMPOSE_PROJECT_NAME` | overrides the dir-derived compose project |
| any var that switches an integration between a local stub and the real service | the "silently hit production" failure (skill C5) |

## 9. Repo `.claude` hooks and permissions that affect the stack

From the repo's `.claude/settings.json`:

- `SessionStart` — does it provision worktrees (`bundle check || bundle install`)?
- `SessionEnd` — does it stop the dev stack? (Then a worktree's stack dies between turns.)
- Read-denied paths (`.env*`, `tmp/**`, `log/**`, lockfiles) — plan to pipe scripts via stdin
  and to grep logs through allowed commands.
- `additionalDirectories` — sidecar repos in scope from this session.
