---
name: dev-doctor
description: Diagnose and recover a broken local dev stack before blaming your diff — blank page, "stuck loading", a page that times out, the wrong app answering on your port, specs that can't reach the database, generated output that never appears, backed-up job queues. Walks a symptom-first tree (who owns the port → is shared infra up → is it booted right → is the output just cached → is the queue starved) and covers handing the dev server off to another session. Use for "I can't see anything at localhost:3000, please fix", "everything is just stuck loading, debug this", "make sure everything on my dev ports is killed", "kill your dev server, I'm giving it to another thread", "can you clear my queues". NOT for creating a worktree (worktree-create), booting one the happy-path way (worktree-dev-server), or grounding a symptom that arrived as a chat thread or ticket (bug-intake) — this is the backward path from a symptom you are seeing yourself.
argument-hint: "[symptom: blank-page | stuck-loading | wrong-app | wont-boot | specs-cant-connect | queue | handoff]"
---

# Dev doctor — recover the local dev stack

When the local app is broken, the cause is almost never the diff you just wrote. Walk the phases
**in order** and stop at the first one that explains the symptom.

Commands below use a Rails + Sidekiq + Postgres + Redis + Vite stack as the worked example
wherever the gotcha is stack-specific, because that's where it was verified; the port, process and
Docker commands are stack-neutral. [REFERENCE.md](./REFERENCE.md) has the Node / Python
equivalents and a template for mapping **your** project's ports, hosts, process formation,
containers and env-var names. Fill that map in once and keep it in the project `CLAUDE.md`.

Set these once per Bash call (shell state doesn't persist between calls):

```bash
PORT=$(node -e 'const u = new URL(process.argv[1]); console.log(u.port || (u.protocol === "https:" ? 443 : 80))' '<dev_url>')     # the main dev port
PORTS="$PORT $((PORT+1)) $(find <worktrees_dir> -maxdepth 2 -name .dev-port -exec cat {} + 2>/dev/null)"   # + every worktree's base (worktree-create step 2)
```

## Hard rules

- **Local state is contested.** Ports, Docker, the shared dev DB, the shared test DB, job
  queues, the browser-automation profile, and the main checkout are all shared with other Claude
  sessions and with the user. **Identify the owner read-only first. Never kill, restart, or
  reclaim a server you did not start without explicit go-ahead** — granted per occasion, never
  carried to the next turn. **Never work in the main checkout** or change its branch; use a
  worktree (**worktree-create**).
- **Never read `.env*`.** Reference `ENV['NAME']` in a runner script, or
  `grep -o '^NAME[A-Z_]*' .env` for presence only. Never `docker compose config` against a
  compose file that interpolates the app's `.env`: it prints every secret.
- **`cd` does not persist between Bash tool calls.** Use absolute paths, or `cd` in the same
  call. This has silently booted the *main checkout* instead of a worktree more than once.
  Sanity-check with `pwd` / `git -C <path> status`.
- **Diagnose, don't wait.** If something has been running unreasonably long, inspect it
  (`ps -o pid,etime,time,stat,%cpu -p <pid>`) instead of backgrounding another wait on top of
  the wait. And investigating is not fixing — report the diagnosis and the proposed repair; never
  apply a destructive repair (queue clear, cache bust, DB reseed) unasked.
- **When a diagnosis turns into a code change** (a guard, an initializer, a script fix), run
  **code-style**'s self-review checklist over it before presenting the diff — a repair written
  under time pressure is exactly where shortcuts sneak in. `code-review` (built-in) is the
  correctness pass; `code-style` is the shape pass.

## Phase A — Who owns the port?

Do this **before** debugging your diff. A blank page — or the *wrong* page — right after your
change is very often another checkout's stale server holding the port.

```bash
for p in $PORTS; do lsof -nP -iTCP:$p -sTCP:LISTEN; done 2>/dev/null
lsof -a -p <pid> -d cwd -Fn | sed -n 's/^n//p'           # which checkout owns it
ps -o ppid= -p <pid>                                      # walk up to the supervisor (foreman, overmind, npm, nodemon)
ps -o lstart= -p <pid>                                    # how long has it been up
```

The listener's **cwd** says whose it is. If it isn't your worktree, stop and tell the user; run
your verification elsewhere on another port and drive the browser from an isolated profile
(`mcp__playwright-isolated__*`, if configured) so you don't fight over the shared one.

**More than one listener on one port is a split brain, not a curiosity.** On macOS a process can
bind IPv6 `*:P` while another already holds IPv4 `*:P` — the second boot "succeeds", its log says
Listening, and `localhost` requests go to one server or the other depending on address family.
Symptom: the browser shows your app while `curl` shows another (or the reverse), or an instant
readiness 200 from a page that isn't yours. Attribute each family separately:

```bash
lsof -nP -iTCP:$PORT -sTCP:LISTEN                       # note the TYPE column: IPv4 vs IPv6, one PID each?
curl -4 -s -o /dev/null -w 'v4 %{http_code}\n' "http://127.0.0.1:$PORT/<a-route-only-your-app-has>"
curl -6 -s -o /dev/null -w 'v6 %{http_code}\n' "http://[::1]:$PORT/<a-route-only-your-app-has>"
```

The foreign half is someone else's — same rule: report it, don't kill it; move your server to a
free port.

**Kill supervisors first** (only what's yours) — a Procfile runner respawns any worker you kill
individually. Order: the process group you launched (**worktree-dev-server** § Shutdown) →
remaining processes whose cwd is your worktree → `kill -9` survivors. An orphaned Puma worker
outlives its master and keeps the socket; Puma cluster workers *inherit* the socket, so several
PIDs show on one port and killing the master takes them all. A broad `pkill -f foreman` /
`pkill -f puma` / `pkill -f node` kills unrelated stacks and still misses a stray frontend dev
server.

**A "kill everything" script needs a dry run.** A stack-kill script that matched processes by
command signature, independent of port and cwd, took down *every* dev stack on the machine —
including another session's worktree server on a different port — and running it once "to verify
it works" killed the user's own server. Enumerate owners with `lsof` first and get go-ahead. If you
build such a script, build it under **sandbox-tool**: dry-run by default (print what it would
kill), scoped by cwd, supervisors before children, `sleep` then sweep the ports, escalate to
`SIGKILL` only for survivors, protect browsers / editors / terminals / itself, and **exit non-zero
if any listener survives** — that last property is what makes "all clear" trustworthy.

## Phase B — Is the shared infra up?

A whole stack can exit overnight; the tell is
`connection to server at 127.0.0.1, port 5432 failed` (or `ECONNREFUSED 127.0.0.1:6379`).

```bash
docker info >/dev/null 2>&1 || open -a Docker            # then poll `docker info` until it answers
docker compose -f <main-checkout>/<shared-infra-compose-file> -p <shared-project> up -d
docker ps --format '{{.Names}}\t{{.Status}}'
pg_isready -h 127.0.0.1 -p 5432
redis-cli -h 127.0.0.1 ping
```

- Know which container holds **every** local database — dev, test, and every worktree's isolated
  DB usually live in one shared Postgres container. Restarting it affects everyone.
- The database and Redis alone are enough for a runner script **and** the test suite — you do
  not need the app server for either, so say so instead of booting a server someone else owns.
- If the dev command brings shared infra up as part of booting, booting normally is also the
  repair. A "stop" command that only brings down the branch's *app* project is safe; one that
  takes shared infra with it is not — read it before running it.

**Object-storage emulators (LocalStack, MinIO).** A boot task may recreate missing *buckets*
automatically, but nothing brings back the **objects** after a container recreate — uploaded
files then 404, and **it looks exactly like a CORS failure but isn't**. Confirm before
theorizing:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 s3 ls s3://<bucket>/<prefix>/
```

Repair is the project's setup task (idempotent bucket creation) plus whatever restores fixture
objects. A record that still points at a lost object (an attachment's stored key, an export
marked `done`) is usually **never regenerated automatically** — reset or delete that record so the
app produces it again.

**Helper services** (a local search engine, a mail catcher, any sidecar the app calls): check
each one's health endpoint as its docs describe, with a plain `GET`, and read its container logs
(`docker logs --since 5m <container>`) before assuming the app is at fault.

## Phase C — Is it booted correctly?

### C0. Read the boot output first

Before theorizing, read the last screenful of the dev server's own output — crashes print there:

```bash
tail -40 "${TMPDIR:-/tmp}/dev-<slug>.log"         # worktree-dev-server's log; or the terminal / `docker compose logs --tail 40 <svc>`
```

`MODULE_NOT_FOUND`, `LoadError`, `EADDRINUSE`, a migration-pending error, `app crashed - waiting
for file changes` — most of C1–C8 is recognizable from this alone.

### C1. The pinned port, or nothing (for anything browser-facing)

If the server ignores `PORT`, or the frontend's API URL is pinned to `<dev_url>`'s port (and
sometimes server-side code calls back into the app on it too), "just use another port" fails
several different ways. Symptoms: blank page or infinite spinner, plus background jobs failing
with connection refused. Backend, admin pages and specs on another port are unaffected when only
the frontend is pinned. **The frontend dev server must be on the port the backend proxies to**
(Vite with `--strictPort`); off by one and every asset 500s. How to find every pin and the boot
recipe: **worktree-dev-server**.

### C2. Port resolution — know which source wins

`ENV['PORT']`, a per-worktree port marker, a `Procfile` default, `config/puma.rb`,
`vite.config`, a hard-coded `listen(…)` — read the boot script and record the precedence. Where
`PORT` wins, **do not back up and rewrite the marker file** — just pass `PORT=…`.

### C3. Rails on macOS: `WEB_CONCURRENCY=0`

Forked Puma workers on macOS can hang on outbound TLS: the page hangs about a minute until
`Net::OpenTimeout`, `curl` returns `000`, and the process looks healthy to `ps` (a long dev
`worker_timeout` means it is never reaped).

```bash
WEB_CONCURRENCY=0 RAILS_MAX_THREADS=5 PORT=$PORT bin/dev
kill -INFO <puma-pid>     # dump thread backtraces of a wedged puma
```

Set it on the invocation, never by editing `config/puma.rb`. The per-worktree boot form:
**worktree-dev-server**. For pages that fire many outbound calls per row, a client-side
concurrency limiter helps too. (Node and Python equivalents of "a worker that looks alive but is
wedged" are in REFERENCE §3.)

### C4. Know your supervisor — it fails one of two opposite ways

- **Group-killing runners** (foreman, overmind, `concurrently --kill-others`) kill the whole
  formation when any one child fails — one crashing auxiliary process (a sub-workspace watcher)
  reads as "the server won't boot", not as the real cause. Pick the smallest formation that
  answers the question: frontend work → the full `<dev_cmd>`; API / admin only → the web process
  alone (`bin/rails server -p $PORT`, `npm run dev:api`).
- **Watch-mode supervisors** (nodemon, `node --watch`, `uvicorn --reload`, air, cargo-watch) do
  the **opposite**: the child crashes, the supervisor stays alive "waiting for file changes", the
  port is dead, and `ps` looks healthy. C0's log tail is the only quick tell.

### C5. Env files

A worktree setup that symlinks `.env`, `.env.local` and `.env.development.local` but not
`.env.test.local` makes specs silently run against the development DB. **worktree-create**
gotcha 0 owns these facts; verify rather than assume — this kind of gap gets "fixed" and still
bites:

```bash
RAILS_ENV=test bin/rails runner 'puts ActiveRecord::Base.connection_db_config.database'
ls -la <worktree>/.env <worktree>/.env.local <worktree>/.env.development.local   # symlink targets, not contents
```

A missing local override can also silently point a third-party integration at its **real,
production** endpoint instead of the local stub — when every feature backed by one integration is
broken locally at once, check this before the code.

- `ln -sfn` into a worktree can be permission-denied ⇒ pass the vars inline on the command.
- **dotenv will not override an already-exported process env var**, and a Procfile runner's own
  env beats the app's dotenv load. When server-side URL generation needs an override, export it
  directly on the `<dev_cmd>` invocation.
- **The frontend bundler's env dir `(verify)`** — Vite reads from its `envDir` (the Vite root by
  default). A `frontend/.env.local` has been observed ignored while a **worktree-root**
  `.env.local` worked. Write the override, `git check-ignore -v` it, and confirm the value reached
  the browser.
- Env is baked in at process start: after any env change, **kill and restart the whole stack**,
  not one process.

### C6. Backgrounding that survives

Background Bash tasks and their whole process group have been observed being SIGTERM'd by the
harness after a while, and a foreground command's timeout SIGTERMs its process group too — this
has silently killed a dev server just before it was needed. Relaunching after a reap just
restarts the clock. The detach recipe (its own process group via a Node `detached: true` spawn, a
per-worktree log and pgid file) lives in **worktree-dev-server** step 3; use it rather than
re-deriving one here.

**For a session the user drives themselves, suggest they run `<dev_cmd>` via `!` passthrough** —
then nothing reaps it.

### C7. Readiness — poll the process and the port, never sleep blind

Poll a real page on the backend **and** the frontend dev server through the backend's proxy, and
**stop the moment the process exits** — the loop is in **worktree-dev-server** step 4. A 500 on
the asset probe means the frontend dev server isn't up or is on the wrong port. **A boot faster
than this stack normally takes is suspicious** — confirm ownership (Phase A) before believing it.
**Never trust a log-tail `grep 'Listening'`**: it silently missed a whole-stack exit and cost a
long wait on a server that could never come up.

### C8. When `<dev_cmd>` refuses to start at all

- **Boot scripts that anchor at the main checkout.** A dev command that resolves its
  shared-infra compose file from the *main checkout's currently checked-out branch* dies before
  the Procfile runner starts if that branch predates the file ⇒ bypass with the Procfile runner
  directly (`foreman start -f Procfile.dev`), setting `PORT` and friends by hand.
- `cannot resolve <pkg>` / `MODULE_NOT_FOUND` ⇐ a sub-workspace's `node_modules` symlinked from a
  main checkout that never ran the install there, or simply a stale install ⇒ install **inside
  that workspace**, then **revert the lockfile diff before committing** if you didn't mean to
  change it. Only the frontend dev server died? Restart just it, on the port the backend proxies to.
- **A backgrounded formation that hangs silently at start** may be waiting on an interactive
  prompt nobody can see — Corepack asking to download a package manager is the classic. Set
  `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` (or run the install once in the foreground).
- **Autoload roots are computed at boot.** In Rails (Zeitwerk), a newly added `app/<something>`
  directory 500s "uninitialized constant" forever and reload can never fix it ⇒
  `kill -USR2 <puma_pid>` (in-place re-exec) or restart. **Background workers (Sidekiq, Celery,
  BullMQ processors) don't hot-reload** — restart them after changing job code.

**"Is this spec failure mine or pre-existing?"** Run the same spec on a detached checkout of the
default branch (`git worktree add --detach <tmp-dir> origin/<default-branch>`, provisioned per
**worktree-create**) before blaming the diff. Spec failures that only appear locally often trace
to an unset third-party credential env var or the test-DB identity (C5), not to code.

## Phase D — Still the wrong output? It's cached, not broken

Anything the app *generates* — exports, reports, compiled assets, cached API responses — can be
served from a cache long after the code changed: a result stored on the record, a cache store
(`Rails.cache`, Redis, a memoized file on disk), a CDN or object-store copy, the browser. A
sidecar service with its own cache: check its health and clear its cache the way its docs say.
List the caches your symptom passes through, then bust **dry-run first, always**, scoped to one
record before all of them:

- **Never touch the source data** — only what was generated from it.
- Refuse to run in production, and avoid firing callbacks or webhooks that would propagate the
  bust elsewhere.
- Build anything reusable under **sandbox-tool** (`CONFIRM=yes` to commit).

A cold frontend dependency re-bundle right after a clear looks exactly like a dead server — warm
it with a direct `curl` to the asset path. For a multi-stage generation pipeline, hand off to
**render-pipeline-debug**.

## Phase E — Queue health, before blaming the code

If async work "isn't happening", check the queues **first** — before reading a line of the diff.

If that report came from a chat thread or a ticket rather than from your own session, run
**bug-intake** first — the thread's screenshots and the prior instance it links usually name the
queue, and half of these reports are a stale cached copy rather than a starved queue.

```bash
ps aux | grep -c "[s]idekiq"
ps -o pid,etime,time,stat,%cpu -p <pid>
SCAN_LIMIT=1000 bin/rails runner - <<'RUBY'                      # READ ONLY
require "sidekiq/api"
Sidekiq::Queue.all.each do |q|
  flag = (q.latency > 600 || q.size > 500) ? "   <-- backed up" : ""
  puts format("%-20s %8d jobs %8ds latency%s", q.name, q.size, q.latency, flag)
end
puts "in flight: #{Sidekiq::Workers.new.size}"
limit = Integer(ENV.fetch("SCAN_LIMIT"))
{ "retry" => Sidekiq::RetrySet.new, "dead" => Sidekiq::DeadSet.new }.each do |name, set|
  recent = set.first(limit).select do |j|                               # dead: j.at = time of death; retry: j.at = NEXT retry
    t = name == "dead" ? j.at : Time.at(j["retried_at"] || j["failed_at"])
    t > Time.now - 6 * 3600
  end
  puts "#{name}: #{set.size} total; last 6h by error class: #{recent.group_by { |j| j["error_class"] }.transform_values(&:size)}"
end
RUBY
```

(Node / BullMQ, Python / Celery / RQ equivalents: REFERENCE §5.) Tune the thresholds to your app;
the scan cap keeps the command fast on a huge dead set.

- **Large elapsed + low CPU% = I/O-blocked on an external API, not hung** — a worker whose
  elapsed time is several times its CPU time, at low CPU%, is waiting on network calls (an LLM
  API, a slow third-party service), not deadlocked.
- Read per-queue depth **and** latency together, plus retry/dead grouped by error class.
  Failing-and-retrying is not progressing. Sidekiq's dead set keeps jobs for months by default —
  filter by `j.at` (time of death) to the last few hours before drawing conclusions; `failed_at`
  is the *first* failure and hides jobs that died recently after long retries.
- **Queues and Redis are shared across every worktree unless one was isolated**, so another
  branch's leftovers starve current work — a low-priority queue with tens of thousands of jobs and
  hours of latency looks exactly like "my change broke the async path".
- If a browser tab is polling and enqueuing every few seconds, close it before clearing.
- The real exception in the worker log:
  `grep -oE "Cause: [A-Za-z:]+[^\"]{0,200}|Exception: [^\"]{0,200}" log/sidekiq.log`.

Clearing discards jobs permanently — they do not run later, and it affects every worktree
sharing that Redis DB. Confirm nothing is in progress (it would be stranded), leave worker-claimed
jobs alone. The clear is **dry-run by default** — run it without `CONFIRM`, show the user the
counts, get go-ahead, then re-run with `CONFIRM=yes`:

```bash
QUEUES=<queue>[,<queue>] SETS=<retry|dead|scheduled,…> bin/rails runner - <<'RUBY'
require "sidekiq/api"
abort "refusing to run in production" if Rails.env.production?
sets = { "retry" => Sidekiq::RetrySet, "dead" => Sidekiq::DeadSet, "scheduled" => Sidekiq::ScheduledSet }
targets = ENV.fetch("QUEUES", "").split(",").map { |q| Sidekiq::Queue.new(q) } +
          ENV.fetch("SETS", "").split(",").map { |s| sets.fetch(s).new }
abort "name QUEUES and/or SETS explicitly — there is no 'everything' default" if targets.empty?
targets.each { |t| puts format("%-12s %8d", t.name, t.size) }
if ENV["CONFIRM"] == "yes" then targets.each(&:clear); puts "CLEARED"
else puts "DRY RUN — nothing cleared. Re-run with CONFIRM=yes after go-ahead." end
RUBY
```

Requeue against a rate-limited external API with a stagger:
`<Job>.set(wait: index * 2.minutes).perform_later(id)`.

## Phase F — Hand off cleanly

When the user says *"kill your dev server, I'm giving it to another thread"* — shut down **only
your** stack, supervisor included, exactly as **worktree-dev-server** § Shutdown does: kill the
process group you launched, then review and kill the stragglers whose cwd is inside your worktree
(that list includes the background worker and any supervisor). Then:

```bash
for p in $PORTS; do lsof -nP -iTCP:$p -sTCP:LISTEN; done 2>/dev/null | grep . || echo "all clear"
```

**Leave shared Docker infra and shared helper services up** — other threads depend on them.
Confirm the ports are actually free before reporting the handoff done, and name the URLs now
available.

**Before you report a fix.** A repair that changes what a user sees (a cache bust, a restored
object, a requeue) is not done until it's proven on the surface — **verify-in-app** at
`--depth browser`, or a runner read-back for a backend-only repair. "The server is up" is not
the claim.

---

## Verified gotchas

- **A repo `SessionEnd` hook that stops the dev stack** tore a worktree's Docker stack down
  between user turns, mid-QA, more than once. Check `.claude/settings.json`; if a stack must
  survive, say so and bring it back up next turn.
- **`gh stack sync --prune` silently relocates another worktree** that had the pruned branch
  checked out, keeping its old directory name. If a worktree "moved", check this before
  re-provisioning.
- `tmp/` and `log/` can be Read-denied or Write-denied by repo permissions ⇒ pipe a script via
  `bin/rails runner - <<'RUBY'` instead of writing a file; `truncate -s 0` where `rm -f
  log/test.log` is sandbox-blocked.
- `docker compose exec -T app sh -c "pkill -STOP -f 'sidekiq'"` **matches its own invoking
  shell** and self-suspends — find the `T` state in `ps -eo pid,stat,args` and kill that PID.
- A fresh worktree's first Docker boot takes minutes (image build); later worktrees reuse the
  built images from cache. Do **not** set `COMPOSE_PROJECT_NAME` to another checkout's project to
  skip the build — that attaches to its running containers. The port marker files
  (**worktree-create** step 2) attribute a mystery listener to a worktree.
- If your team rebuilds dev DBs from a production snapshot, soft-delete / `archived_at` flags
  come along and can leave records' associations looking empty — that looks like a code bug and
  isn't. Check the flag before the code. (And any "rebuild dev DB from snapshot" task **drops the
  shared dev DB** — never run it without go-ahead.)

---

## When not to use this / hand off to

- **Creating** an isolated worktree → **worktree-create**. **Booting** one the happy-path way on
  the pinned port → **worktree-dev-server**. Come back here when it doesn't come up, or to find
  out who already owns the port.
- Stale generated output past Phase D, through a multi-stage pipeline → **render-pipeline-debug**.
- Production facts → **warehouse-data** first (it owns the `<ops_bot>` rung, if your team runs
  one), **prod-script** last; a guarded production fix → **prod-script** `repair`. Never reach
  for prod credentials from here.
- Proving a fix works in the running app → **verify-in-app**. Turning a one-off diagnostic into
  a reusable script → **sandbox-tool**.
- The symptom arrived as a chat thread or a ticket rather than from your own session →
  **bug-intake** first; it grounds the report before you go hunting.
- The repair became a code change → **code-style** (shape pass) → **ship-pr** (→ **pr-triage**).
- Several sessions or agents are fighting over the same ports and worktrees → **agent-team**
  (file-ownership partition + the freeze-and-relocate runbook).
- A rebase/restack is why the specs won't run, not the environment → **stack-surgery**.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
