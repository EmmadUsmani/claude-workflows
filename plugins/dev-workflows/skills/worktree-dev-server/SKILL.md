---
name: worktree-dev-server
description: Run the project's dev server (`<dev_cmd>` — `npm run dev`, `bin/dev`, `docker compose up`…) from a git worktree, detached so it survives, on the port the app's pinned URLs expect (derived from `<dev_url>`), with readiness polling that watches the process and can't be fooled by someone else's listener, and a shutdown that kills only what you started. Use when the user asks to run / start / boot the dev server for a worktree, try out a branch's changes in the browser, or spin up a worktree's app — especially when the worktree lives outside the default worktrees dir. Covers finding port pins, single ownership of the shared port, backgrounding, readiness polling, and clean shutdown. NOT for creating the worktree (worktree-create) or for diagnosing one that won't boot, serves the wrong app, serves stale output, or whose port someone else owns (dev-doctor).
argument-hint: "[worktree path or name]"
---

# Run the dev server from a worktree

Boot `<dev_cmd>` from a git worktree — the whole formation (web server, plus whatever else the
project runs in dev: a frontend dev server, a background worker, a CSS watcher) — at `<dev_url>`,
so the user can try a branch's changes in a browser.

Every command below uses these, set once per call (the harness resets shell state between calls):

```bash
WT=<abs-worktree-path>                                          # absolute, always
PORT=$(node -e 'const u = new URL(process.argv[1]); console.log(u.port || (u.protocol === "https:" ? 443 : 80))' '<dev_url>')
SLUG=$(basename "$WT"); LOG="${TMPDIR:-/tmp}/dev-$SLUG.log"; PGF="${TMPDIR:-/tmp}/dev-$SLUG.pgid"
```

Per-worktree log and pid files, so two worktrees (or two sessions) never clobber each other's.
The formation's other ports are offsets from `$PORT` — record the project's scheme (e.g. frontend
dev server = `PORT+1`) in its `CLAUDE.md`; `$((PORT+1))` below stands for "the formation's other
ports".

## The one hard constraint: find out what is pinned to the port

This section is the canonical explanation of port pins for the plugin — **dev-doctor** C1 and
**worktree-create** gotcha 2 state the symptom and point here.

A port is **pinned** when something other than the server's own `PORT` setting hard-wires it.
Look for all three shapes before choosing a port:

1. **The server ignores `PORT`.** `app.listen(3000)`, `port: 3000` in a config file,
   `runserver 3000` in a script. Then neither `PORT=` nor a port marker does anything.
2. **The frontend's API base is pinned.** It builds its API URL from an env var
   (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`, `REACT_APP_API_URL`) that a **symlinked** `.env` sets
   to the main checkout's port. Served anywhere else, the frontend calls the main port
   cross-origin → **CORS-blocked or connection refused → blank page or an endless spinner**.
   Check the fallback first: if the code does `env.VITE_API_URL || location.origin` (or builds
   the URL from the served port), **unsetting** the var in a worktree-local override makes the
   frontend follow whatever port it's served on — cheaper than overriding every pin.
3. **Server-side code calls back into the app.** A background job, a report/export generator or a
   containerized helper that fetches from `localhost:<port>` or `host.docker.internal:<port>`.
   These break silently: the page loads, the job fails later.

Search the code and config (never the env files):

```bash
cd "$WT" && git grep -nwE "$PORT" -- ':!*lock*' ':!*.min.*' ':!*.md'      # -w is portable; macOS git grep -E has no \b
cd "$WT" && git grep -nE 'listen\(|host\.docker\.internal|_API_URL|API_BASE' -- ':!*lock*' ':!*.md'
```

And **the frontend dev server must be on the port the backend proxies to**. If it drifts to its
own default (Vite 5173, CRA 3000) every proxied asset 500s and the page is blank.

**If the server ignores `PORT` (shape 1)**, the minimal fix is one line —
`const port = process.env.PORT || 3000` or the framework's equivalent. Ask before making it, and
keep it in its own commit, separate from the feature.

Therefore **only one dev server can own a pinned port at a time.** Before booting the worktree's
server, confirm the port is free (stop the main checkout's server, or ask the user to). Don't
silently kill a server you didn't start — check first, and if something's there, tell the user.

## Steps

1. **Confirm the worktree exists and the ports are free.**
   ```bash
   git -C "$WT" worktree list                            # confirm the path + branch
   lsof -nP -iTCP:$PORT -iTCP:$((PORT+1)) -sTCP:LISTEN | grep . || echo "free"   # test output: lsof exits 1 if ANY port is unmatched
   ```
   `-sTCP:LISTEN` matters: without it a browser's client connection to the port counts as an
   owner. If anything is listening, stop — surface the owner (**dev-doctor** Phase A) to the user
   rather than killing it.

2. **Provision the worktree** — env symlinks, dependencies, isolated DB if needed. This is
   **worktree-create**'s checklist (idempotent); its gotcha 0 owns which `.env*` files are actually
   covered and the check that settles it. Use the project's own setup script if it has one, and
   still run that check.

3. **Boot detached, in its own process group**, pinning the port:
   ```bash
   cd "$WT" && PORT=$PORT node -e 'const fs = require("fs"); const log = fs.openSync(process.argv[2], "w"); const child = require("child_process").spawn("sh", ["-c", process.argv[1]], { detached: true, stdio: ["ignore", log, log] }); fs.writeFileSync(process.argv[3], String(child.pid)); child.unref()' \
     '<dev_cmd>' "$LOG" "$PGF"   # detached => setsid: the child PID (written to $PGF) leads its own group; shutdown kills the whole group
   ```
   Put any stack flags inside the quoted command or before `node`
   (`WEB_CONCURRENCY=0 RAILS_MAX_THREADS=5 PORT=$PORT node -e …`). It returns at once; the server is
   not ready yet.

   - **Why detached.** Background tasks and their process group have been observed being
     SIGTERM'd by the harness after a while, and a foreground command's timeout (2 minutes by
     default in Claude Code) SIGTERMs its group too — which has silently killed a dev server just
     before it was needed. macOS has no `setsid` CLI, hence the Node `detached: true` spawn (which calls `setsid`). Relaunching after a
     reap just restarts the clock — for a session the user drives themselves, suggest they run
     `<dev_cmd>` via `!` passthrough instead.
   - **Vite:** `--port $((PORT+1)) --strictPort`, so it fails loudly instead of drifting to a port
     the backend doesn't proxy to. **Django / FastAPI:** `python manage.py runserver 127.0.0.1:$PORT`,
     `uvicorn app:app --port $PORT`.
   - **Rails / Puma on macOS: `WEB_CONCURRENCY=0`.** A `config/puma.rb` that does
     `workers ENV.fetch('WEB_CONCURRENCY', 2)` runs clustered **even in development**, and forked
     Puma workers on macOS can hang on outbound TLS (S3, KMS, any HTTPS API client): the page
     hangs about a minute until `Net::OpenTimeout`, `curl` returns `000`, and the process looks
     healthy to `ps`. Diagnose with `kill -INFO <puma-pid>` (dumps thread backtraces). Pair it
     with a higher `RAILS_MAX_THREADS` — one process, more threads. Set both per invocation; don't
     edit `config/puma.rb`. (**dev-doctor** C3 keeps the symptom and points here.)
   - **`PORT=` vs a per-worktree port marker.** If the boot script also reads a marker file
     (**worktree-create** step 2), read the script to see which wins. Where `PORT` wins, the env
     var is enough. Where the file wins, back it up, write the port, boot, restore.

4. **Poll until it answers — and bail the moment the process dies.**
   ```bash
   for i in $(seq 1 60); do
     kill -0 "$(cat "$PGF")" 2>/dev/null || { echo "EXITED"; tail -30 "$LOG"; break; }
     code=$(curl -s -o /dev/null -w '%{http_code}' "<dev_url>")
     [ "$code" != "000" ] && { echo "up: $code"; break; }
     sleep 5
   done
   curl -s -o /dev/null -w '%{http_code}\n' "<dev_url>/<frontend-asset-path>"   # e.g. …/@vite/client through the backend's proxy
   ```
   (Or run the same until-loop under the harness's Monitor tool.) Watching the PID is the point:
   a server that crashed during boot can never come up, and polling it just burns minutes. If the
   backend proxies frontend assets, probe both — a 500 on the asset probe ("Failed to open TCP
   connection to localhost:<PORT+1>") means the frontend dev server isn't up or crashed: read
   `$LOG`.

   **Never `sleep` blind, and never trust a log-tail `grep 'Listening'`** — it has silently missed
   a whole-stack exit, and a "Listening" line can be true while someone else also listens on the
   port. Many apps have **no health route** (Rails ≥ 7.1 ships `/up`; older apps don't): any HTTP
   response at all means reachable. A 404 on a frontend SPA route can be a route constraint that
   only serves the SPA shell to a browser-shaped request, not a dead server
   (`curl -H 'Accept: text/html,application/xhtml+xml'`).

   **Confirm every listener is yours.** A boot faster than this stack normally takes is suspicious
   — that's somebody else's server already on the port. On macOS one process can hold IPv4
   `*:PORT` while another holds IPv6 `*:PORT`, and `localhost` then flips between them — so check
   **all** listeners, not the first:
   ```bash
   for pid in $(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t); do
     printf '%s  ' "$pid"; lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p'    # every one must be inside $WT
   done
   curl -4 -s -o /dev/null -w 'v4 %{http_code}\n' "http://127.0.0.1:$PORT/"; curl -6 -s -o /dev/null -w 'v6 %{http_code}\n' "http://[::1]:$PORT/"
   ```
   Any listener whose cwd isn't inside `$WT`, or v4 and v6 answering differently, is a squatter
   — stop and hand it to **dev-doctor** Phase A.

5. **Hand off the URLs** — `<dev_url>`, plus the frontend origin if it's served separately.
   Mention the first page load is slow (dev bundlers compile on demand), which dev login to use if
   the page needs one, and where the log is (`$LOG`).

## When `<dev_cmd>` won't come up

Read `$LOG` first — crashes print there. Then the symptom-first tree is **dev-doctor** (who owns
the port → shared infra → booted correctly → cached output → queue health); the boot failures
specific to this flow are its **C8**: a boot script that resolves shared-infra config from the
*main checkout's* branch, a Procfile runner group-killing the whole formation when one child fails
(often a stale sub-workspace `node_modules`), a watch-mode supervisor that stays alive after its
child crashed, and a new autoload root needing a restart rather than a reload. Fast local outs:
boot only the web process (`bin/rails server -p $PORT`, `npm run dev:api`) for API-only work. If
only the frontend dev server died, restart just it — and give it the **backend's** port variable
too if its proxy config reads one, or it proxies to the wrong place.

## Shutdown

Kill the process group you launched, then anything else whose **cwd** is inside the worktree.
Matching on argv (`pkill -f <path>`) misses children started with relative paths, and misses
worktrees that live outside `<worktrees_dir>` entirely.

```bash
kill -TERM -- -"$(cat "$PGF")" 2>/dev/null                                 # the whole group you started
pids=$(lsof -d cwd -Fpn 2>/dev/null | awk -v wt="$WT" '/^p/{p=substr($0,2)} /^n/{n=substr($0,2); if (n==wt || index(n, wt"/")==1) print p}')
echo "$pids"                                                              # stragglers with cwd in $WT — review before killing
[ -n "$pids" ] && kill $pids
lsof -nP -iTCP:$PORT -iTCP:$((PORT+1)) -sTCP:LISTEN | grep . || echo "all clear"
```

Review the straggler list before the `kill` — your own editor or shell can have its cwd in the
worktree. `kill -9` only orphans that ignored TERM. **Leave shared infra (Docker Postgres / Redis
/ emulators, any shared helper service) up** — other sessions depend on them. A broad
`pkill -f foreman` / `pkill -f node` kills unrelated stacks.

## Running alongside the main checkout's server

If the user needs the worktree's server up **at the same time** as main's, serve it on a free
port and move every pin with it:

```bash
cd "$WT" && PORT=4040 VITE_API_URL=http://localhost:4040 <dev_cmd>   # then browse http://localhost:4040
```

This needs the server to honour `PORT` (pin shape 1 above). Pins you can't move by env (shape 3)
still point at the main server — say which features will therefore talk to main's backend.
Consider an isolated worktree (**worktree-create** step 4) if it shouldn't share the dev DB either.

## Notes & caveats

- **Isolated worktrees vs this skill.** **worktree-create** gives a worktree its own port, its own
  Compose project and optionally its own DB — the right tool for isolated **backend / API / spec /
  migration** work and running several branches at once. But its stack serves on its *own* port,
  and a frontend pinned to `<dev_url>` won't work there. This skill (one server, on the pinned
  port) is what you want specifically for a **working frontend** — e.g. driving it with Playwright
  for screenshots.
- **Shared state:** a worktree booted this way shares the dev DB, Redis, emulators **and the job
  queues** with main by default; migrations and destructive data changes hit the main dev DB too,
  and another branch's leftover jobs can starve yours. Isolate them (**worktree-create** step 4)
  when that matters — and confirm the DB actually exists.
- **Don't stage generated files a watcher rewrites** (compiled CSS, a regenerated schema dump)
  just because the dev server touched them — `git checkout -- <file>`.
- **`cd` does not persist between Bash tool calls.** A `cd` in an earlier call is gone, and
  `<dev_cmd>` then silently boots the **main checkout** instead. Use `$WT` (or `cd` in the same
  call) and confirm with `git -C "$WT" status`.
- **Env overrides are fussy.** dotenv will **not** override an already-exported process env var,
  and a Procfile runner hands children an explicit env that beats the app's own dotenv load — so
  export URL overrides on the `<dev_cmd>` invocation when server-side URL generation needs them.
  Vite loads env from its own `envDir` (the Vite root by default, which in a monorepo may not be
  the repo root) — a `frontend/.env.local` has been observed ignored while a worktree-root
  `.env.local` worked. Write the override, check it with `git check-ignore -v`, and confirm the
  value reached the browser. Never read `.env*`; append blind with `printf` if you must set
  something.
- **Sharing the machine with another session:** if someone else owns the pinned port, don't
  reclaim it — run backend-only verification, or drive their server from an isolated, signed-out
  browser (`mcp__playwright-isolated__*`, if configured) rather than the shared browser profile.
  Permission to take a port is granted explicitly and per occasion.
- **A repo `SessionEnd` hook that stops the dev stack** will tear a worktree's server down between
  turns, mid-QA. If a server must survive the turn, expect this and re-check liveness at the start
  of the next one.

## When not to use / hand off

| Situation | Skill |
|---|---|
| Creating the worktree in the first place, isolated DB, lifecycle | **worktree-create** |
| It won't boot, the port is someone else's, the wrong app answers, output is stale, queues are starved | **dev-doctor** |
| Driving the app once it's up (payloads, measurements, screenshots) | **verify-in-app** |
| The branch's changes are ready to ship | **ship-pr** (→ **pr-triage**) |
| The stack must survive across agents, or one agent owns the browser and the pinned port | **agent-team** |
| Generated output (exports, reports, documents) comes out stale through a multi-stage pipeline | **render-pipeline-debug** |
| **Non-local environment** (cloud session, routine, fresh VM)? | Load **cloud-runtime** for what degrades and how to label it. |
