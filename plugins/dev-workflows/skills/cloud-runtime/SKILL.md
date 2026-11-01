---
name: cloud-runtime
description: Run any dev-workflows skill where the laptop's resources aren't present — a Claude Code cloud session or scheduled routine, a cloud coding agent's sandbox, a fresh VM, a container. Probes the runtime profile (local vs cloud), swaps the state directory and artifact destinations to a private `<state_repo>`, swaps the session cron for an hourly routine sweep, and applies the degradation table that says which phases run unchanged, which drop to static checks, and which are skipped and labeled `[UNVERIFIED — needs local repro]`. Load it for "we're in the cloud", "no dev server here", "running as a routine", "will this work on a remote runner", or whenever Docker, the project checkout, or `<sandbox_dir>` is missing. NOT a way to get live production access (prod reads go through warehouse-data; prod-script's rule is not overridden), NOT a substitute for local verification (verify-in-app still owns that, later, on the user's machine), and NOT for dispatching code work to a cloud agent (cloud-agent-work).
argument-hint: "[--profile local|cloud]"
---

# Cloud runtime

Settings: `<sandbox_dir>`, `<sandbox_autocommit>`, `<notes_dir>`, `<docs_site>`, `<state_repo>`,
`<chat>`, `<warehouse>`, `<ops_bot>`, `<cloud_agent>`, `<cloud_env>`.

Every other skill in this plugin assumes the user's laptop: the project checkout, a dev stack
(often Docker), `<sandbox_dir>`, `<notes_dir>`, a browser it can drive. In a cloud session none of
that is there. This skill is the portable core — probe the profile once, swap state and artifact
destinations, swap the scheduler, then degrade each phase honestly.

The whole point is **labeling**. A cloud run produces real work (traces, drafted scripts, PRs) but
proves less. The failure this skill exists to prevent is a cloud result being read in the morning
as locally-proven.

## Hard rules

- **Probe before anything else.** Never assume the profile from the prompt, the hostname, or the
  fact that a previous run was local. Run the probe, print the result.
- **A cloud run is never described as verified.** Every claim a skipped tool would have proven
  carries `[UNVERIFIED — needs local repro]`. Never write "verified", "confirmed in the app", or
  "reproduced" for something only statically checked.
- **Stamp `env: cloud` on every outward artifact** — DMs, PR bodies, log rows, dashboard entries,
  doc headers. Never stamp `env: local` unless the probe returned `local`; absence of a stamp means
  local, so an unstamped cloud artifact is a lie.
- **No live production access, in either profile.** Cloud does not loosen this: no prod DB
  connection, no console, no admin sign-in, no writes. **prod-script** still only *drafts*.
  Reading prod data through `<warehouse>` is allowed and preferred.
- **`<warehouse>` is the cloud's first prod-facts path** (**warehouse-data**). If it is an
  account-level MCP connector it works wherever the session has it attached — probe with a trivial
  query (`SELECT CURRENT_USER()` or the engine's equivalent). When present, query it instead of
  leaving a fact `[PENDING]`.
- **The `<ops_bot>`, if your team runs one, works from cloud** — it is just chat, so it needs no
  laptop, no Docker and no checkout. It is the live prod-facts path behind `<warehouse>` (and the
  first one when the connector isn't attached), since nobody is at a console. Read-only, small,
  bounded lookups only (warehouse-data's judgment rule is unchanged in either profile). Only facts
  neither can supply stay `[PENDING — needs prod script <path>]`, a drafted script left for the
  user.
- **A failed state push means the run did not happen.** Do not advance watermarks, do not mark
  items done, on a push that failed. Losing a re-dispatch is cheap; losing an item silently is not.
- **Never read `.env*`** in either profile; reference the variable by name through the app.
- **Never add a personal plugin marketplace to a team repo's `.claude/settings.json`.** Cloud
  plugin availability is solved per-platform (REFERENCE.md), not by editing a shared repo.

---

## Phase 1 — Probe the runtime profile

`local` iff **all** of the laptop's load-bearing resources are present; anything missing ⇒ `cloud`.
Name the checks for your setup once (the project checkout, whatever its dev stack needs, the
sandbox) — the default set. **Substitute the resolved settings before running it**: shell
variables don't read CLAUDE.md, so write the user's actual `sandbox_dir` value (default
`~/projects/sandbox`) and the project's checkout path into the first lines — as `$HOME/…`,
since `~` does not expand inside quotes.

```bash
profile=cloud; why=""
PROJECT_DIR="<the project checkout this run is about>"   # not $PWD: a state-repo clone is a git repo too
SANDBOX_DIR="<sandbox_dir, resolved — e.g. $HOME/projects/sandbox>"
[ -d "$PROJECT_DIR/.git" ] || why="$why; no project checkout at $PROJECT_DIR"
for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  if [ -f "$PROJECT_DIR/$f" ]; then                    # the stack runs in Docker
    docker info >/dev/null 2>&1 || why="$why; no Docker daemon"
    break
  fi
done
[ -d "$SANDBOX_DIR" ] || why="$why; no sandbox at $SANDBOX_DIR"
[ -z "$why" ] && profile=local
echo "runtime profile: $profile${why:+ (${why#; })}"
```

(Works unchanged in bash and zsh.)

In practice the sandbox check carries most of the decision: a cloud session usually *has* a git
checkout and no compose file, so it passes the first two. Strengthen the probe for your setup:

- Add a check for anything else your skills lean on locally (a private-network host answering, a
  browser profile directory, a local-only service port).
- If the platform sets a marker environment variable you have **confirmed** in a real run (record
  which one in the user's CLAUDE.md), check it first and let it force `cloud` — don't rely on a
  variable you haven't seen set.
- A laptop with no `<sandbox_dir>` at all would probe `cloud`; create the directory, or pass
  `--profile local`.

- `--profile local|cloud` overrides the probe (use it to dry-run the degradation table on the
  laptop). An override is printed as such: `runtime profile: cloud (--profile override)`.
- Print *why* on a cloud result — which check failed. "cloud (no Docker daemon)" is a debuggable
  line; "cloud" alone is not.
- Probe once per run and carry the answer. Re-probing mid-run invites a half-local report.
- A partial local box (checkout present, Docker down) is **cloud** by this rule — degrade rather
  than half-run. If it's really a broken local stack, that's **dev-doctor**.

## Phase 2 — State directory and artifacts

When `<state_repo>` is set, **it is the state home in *both* profiles**, not a cloud-only
arrangement: local runs use the user's checkout of it, a cloud run uses that session's own clone.
Same layout, same commits, one history, so a cloud sweep resumes from the laptop's last tick and
vice versa. Only the *artifacts* differ by profile:

| | `local` | `cloud` |
|---|---|---|
| State dir (`state.json`, `days/<date>/LOG.md`, `dashboard.html`) | the local checkout of `<state_repo>` | that run's clone of the same repo |
| RCA / explainers / drafted scripts | `<sandbox_dir>/adhoc/<date>-<slug>/` | `artifacts/<date>-<slug>/` in the state repo |
| Long-form docs | `<notes_dir>` | `artifacts/<date>-<slug>/` + a DM line saying it was not filed to the notes vault |

Commit rule follows the destination. Local sandbox writes auto-commit as written when
`<sandbox_autocommit>` is on — own paths only, never asked, no push (**sandbox-tool** hard rules).
In cloud there is no sandbox: `artifacts/` lands through the state repo's own commit rule instead
(the scoped sync commit below).

Pass the resolved directory explicitly to every script that takes a state dir; never let one
default to the session scratchpad, which is wiped between sessions. Derive the day dir from the
resolved state dir (`<state-dir>/days/<date>`), so the two can never end up in different repos.

The repo's shape (created once by the user, e.g. `gh repo create <owner>/<name> --private`);
layout and the per-run git cycle in [REFERENCE.md](REFERENCE.md):

```
state.json                     # watermarks, items, leases
days/<YYYY-MM-DD>/LOG.md
dashboard.html
artifacts/<YYYY-MM-DD>-<slug>/ # cloud runs only
dryrun/                        # gitignored
```

Each run ends with one sync: `git pull --rebase --autostash` → **one scoped commit** → `git push`,
retrying once on a non-fast-forward. Still failing ⇒ exit non-zero: leave watermarks where they
were, report the failure, and let the next run redo the window; the item key dedupes. Never
`push --force`. (A loop that owns its state, like **firefighter-loop**, ships this cycle as its own
sync command — use that rather than hand-rolling the git.)

**Ledger fallback.** If the state repo is unreachable at all, rebuild `items` from the last 24h of
self-DMs in `<chat>` and floor watermarks at `now − 24h`. Never reconstruct further back than 24h
from the ledger; older items are treated as unknown, not as done. The ledger format is owned by
the loop that writes it — for **firefighter-loop** the pickup DM's first line is, exactly:

```
🔥 Picked up: <title> | <permalink> | <class> | <channel_id>:<ts>
```

Match lines starting `🔥 Picked up: ` (the emoji is part of the prefix), split the rest on
` | `, and take the **last** field as the item key — `<source>:<id>`, which for a chat item is
`<channel_id>:<ts>`. A loop without such a ledger line has no fallback: report the state repo as
unreachable and stop.

## Phase 3 — Scheduler

| Platform | Mechanism | Cadence |
|---|---|---|
| Local session | a session cron (`CronCreate`, where the build has it; else the `loop` skill, `/loop <interval> <tick prompt>`) → the loop's `tick` | minutes, **session-only** (dies with the REPL; session crons also expire after a fixed number of days — see `CronCreate`'s own description) |
| Claude Code routine | the routine's own schedule fires a `sweep` | **hourly minimum**, fresh VM per fire, no state carried |
| A cloud agent's own scheduler (`<cloud_agent>` automations, …) | unknown until tried — run REFERENCE *Checklist A* first | TBD |

- On a routine, each fire runs `sweep --since 2h --profile cloud`. The 2h window deliberately
  overlaps the previous fire; the item key is the dedupe axis, so an overlap costs a few chat
  reads and re-dispatches nothing.
- **Never `CronCreate` inside a routine or a discrete cloud run** — the session ends and the cron
  dies with it, leaving state claiming a schedule that doesn't exist. `start`/`stop` are
  local-only modes.
- Another platform: if it runs a **long-lived** session, `start` works unchanged; if it schedules
  **discrete** runs, treat it exactly like routines. Don't design around a guess about which one it
  is; run the checklist.
- **Two different uses of a cloud agent — don't conflate them.** Hosting *a loop* there is the
  open question above. Dispatching *code work* to it as a task (**cloud-agent-work**) is a
  different thing and is **not a degraded run** when `<cloud_env>` boots the full stack (DB, app
  server, workers, frontend, a browser): a task's in-app verification and before/after evidence
  count, and its PR carries no `UNVERIFIED in-app (cloud run)` banner. From a cloud session,
  that's the way to get a verified fix. The 1-minute PR watch cloud-agent-work arms is a session
  cron, so the "never `CronCreate` in a routine" rule applies: from a routine, each fire does one
  watch-and-steer pass (its §5 Phase B) over the task-owned PRs that haven't settled yet instead.
- **Repos without a `<cloud_env>` stay local** (or degrade per the table below when there's no
  laptop). Don't propose setting one up for personal tooling repos or `<sandbox_dir>`.

---

## Degradation table

| Needs | local | cloud |
|---|---|---|
| `<chat>` reads / search / files, classification, self-DMs, `gh`, **ship-pr**, **pr-triage**, **prod-script** `diagnose`/`repair` **drafting**, Artifact publish | ✓ | **unchanged** — this is the cloud workhorse. A ready-to-paste `prod-script diagnose` in the DM thread is often the most valuable overnight output |
| Isolated worktree with its own containers / per-worktree DB (**worktree-create**) | ✓ | plain `git worktree add` on the session clone; edits plus **static checks only** (linter, `ruby -c` / `tsc --noEmit` / `python -m py_compile`); the test suite only if the environment's setup script provisioned the DB it needs |
| **The local dev DB** — runner scripts (`bin/rails runner`, `node -e`, `manage.py shell`), seeded rows, the test DB | ✓ | **skipped.** Facts about data come from `<warehouse>` (prod) or stay `[UNVERIFIED — needs local repro]` (dev) |
| **The dev server and browser** — **worktree-dev-server**, **dev-doctor**, **verify-in-app** `--depth browser`/`evidence-pack`, the signed-in browser profile | ✓ | **skipped.** Every claim they would have proven gets `[UNVERIFIED — needs local repro]`; the DM's "Your move" asks the user to run the repro; the PR body carries `UNVERIFIED in-app (cloud run)` and ships without before/after screenshots |
| **Local-only services** — a renderer, a sidecar, cache/render checks in **render-pipeline-debug** | ✓ | **skipped**, labeled as above |
| **Private-network services** — hosts reachable only over the user's VPN or office network, internal dashboards, a secret manager | ✓ | **skipped** unless the platform's network policy allows them; probe one request and say which |
| **research-doc** to `<notes_dir>` (or `<docs_site>`), **visual-explainer** → `<sandbox_dir>`, **sandbox-tool** → `<sandbox_dir>/scripts/` | ✓ | write to `artifacts/<date>-<slug>/` in the state repo. Artifact publish still works (the URL may differ from the local one — record both). DM says "not filed to notes (cloud run) — content in the state repo at `<path>`". Promote to sandbox/notes on the user's next local run |
| **warehouse-data** — read-only SQL against `<warehouse>` | ✓ | **unchanged** wherever the session has the connector or credentials (probe with a trivial query). When present it is the cloud's live prod-facts path, ahead of the `<ops_bot>`; when absent, say so and fall to the bot |
| The `<ops_bot>`, if one exists — read-only questions in its chat channel | ✓ | **unchanged** — the live prod-facts path for what the warehouse can't answer, or the first one when the connector isn't attached. Same judgment rule: small bounded lookups only |
| Local **rehearsal** of a drafted script (**prod-script** rehearsal, **sandbox-tool** dry run — a runner against the dev DB) | ✓ | drops to a syntax check (`ruby -c`, …) + a grep for top-level `return`/`abort`/`exit`. The script's header and the DM carry `[UNREHEARSED — no local backend]`, and "Your move" says to rehearse it on the laptop before it is pasted into prod |
| **prod-script** **execution**, admin sign-in | never | never |

## Labeling rules

A cloud run must never be mistaken for locally-proven work. Four surfaces, four stamps:

1. **DMs** — first line carries `env: cloud`; the closing "Your move" names the exact local repro
   the user should run (`verify-in-app --depth browser <surface>`, or the `prod-script` path to
   paste).
2. **PR body** — on an autonomous PR, the shared autonomous-PR banner first (ship-pr; quoted in
   **cloud-agent-work** §3), then this line after it: `UNVERIFIED in-app (cloud run)`. On a PR the
   user opened from a cloud session, the line alone, above the description. No before/after screenshots; say "no screenshots
   (cloud run — no browser)" rather than silently omitting the section.
3. **Docs and RCA artifacts** — a header line `env: cloud · <UTC timestamp>` and, per claim,
   either `file:line` evidence (static reads are real evidence) or
   `[UNVERIFIED — needs local repro]`. Static reading is evidence for *what the code says* and
   never for *what the app does*.
4. **Log rows and dashboard cards** — an `env` column/badge, so a morning skim separates the two
   provenances without opening anything.

Prod facts `<warehouse>` and the `<ops_bot>` can't supply stay
`[PENDING — needs prod script <path>]` — a different label from `[UNVERIFIED]`, and both may
appear on one item. A drafted script that never ran locally adds a third,
`[UNREHEARSED — no local backend]`, on the script itself.

## Hand-offs

| Situation | Skill |
|---|---|
| Local stack present but broken (ports, Docker, job workers) | **dev-doctor** — that's not a cloud profile |
| Turning `[UNVERIFIED]` into proven, back on the laptop | **verify-in-app** (`--depth browser` or `evidence-pack`) |
| Running the drafted prod script | **prod-script** (`diagnose` \| `repair`) — the user pastes it, always |
| Isolated env once local | **worktree-create** |
| Filing the cloud artifacts properly | **research-doc** / **visual-explainer** / **sandbox-tool** |
| Opening the PR / tending it | **ship-pr** (→ **cloud-agent-work** when `<cloud_agent>` is set) / **pr-triage** |
| The loop this mostly exists for | **firefighter-loop** |
| Standing up a platform for the first time | [REFERENCE.md](REFERENCE.md) — *Checklist A — a cloud agent platform* / *Checklist B — Claude Code routines* |
