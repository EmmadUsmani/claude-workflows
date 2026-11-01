# cloud-runtime — reference

Three things live here: the **platform trial checklists** (what must be answered empirically
before a platform is trusted to run an unattended loop), the **routine recipe**, and the **state
repo** contract.

The checklists start unanswered. Fill each `Answer` cell in a real trial and paste the result back
into your copy of this file (or your settings notes) — they are meant to be edited, not admired.

---

## What is known vs. unknown

**From Claude Code's documentation (routines), at the time of writing — re-check, these change:**
account-level MCP connectors attach to a routine; GitHub auth goes through the Claude GitHub App;
plugin installs are repo-scoped; results surface as PRs, chat messages, or artifacts; **schedules
are hourly minimum**; **every fire is a fresh VM with no state carried across runs**; the test
suite needs its DB provisioned by the environment setup script; daily run caps apply per plan
(check yours — it bounds how many fires a night can use).

**Unknown — any other platform** (a cloud coding agent's scheduler, a CI runner, a VM). Execution
model, cron granularity, persistence, chat read/write, GitHub auth, plugin-marketplace support and
cost are all genuine unknowns until tested. Rows a platform's real code tasks have already
answered (`gh` auth, Docker/DB availability — see **cloud-agent-work** REFERENCE §4) can be filled
from that evidence. Do not design around an assumed answer.

**Known local-only dependencies (every platform):** `<sandbox_dir>` usually has no remote,
`<notes_dir>` is often not a git repo, and the dev/test DB usually runs in local containers.
Making those cloud-reachable is explicitly **out of scope** — the state repo replaces them.

---

## Checklist A — a cloud agent platform as loop host

| # | Question | Why it decides something | How to test | Answer |
|---|---|---|---|---|
| A1 | **Session model**: one long-lived session, or discrete runs per fire? | Long-lived ⇒ `start` + `CronCreate` work unchanged. Discrete ⇒ treat exactly like routines (`sweep --since 2h` per fire) | Start a session, `CronCreate` a 5-min job, come back in 20 min: did it fire more than once? | |
| A2 | **Minimum schedule interval** | 5-min ticks vs hourly changes the `--since` window and the DM volume | Try to schedule at 5 min; note what the UI/API refuses | |
| A3 | **Persistent storage across runs** — is any filesystem path preserved? | Nice to know, but not load-bearing: the state repo is the home in both profiles, so a wiped filesystem costs nothing | Write a sentinel file, wait for the next fire, read it back | |
| A4 | **Chat connector**: channel reads + search available? | A watch loop depends on reading channels and searching mentions | Read one channel and run the mention search | |
| A5 | **Chat DM-to-self**: can it message the user's own id? | The DM thread is often the only outward reporting channel | Send one DM to self, thread a reply under it | |
| A6 | **GitHub / `gh` auth**: is `gh` authenticated, and can it push? | Needed for the state repo push *and* for **ship-pr** | `gh auth status`; push an empty commit to the state repo | |
| A7 | **Plugin install** from the user's plugin marketplace | Without the plugin none of these skills exist in the run | `claude plugin marketplace add <marketplace url> && claude plugin install dev-workflows` | |
| A8 | **Carry-over of `~/.claude`** — settings, `CLAUDE.md`, memory directory | Personal rules (no prod, settings keys, worktree discipline) must survive, or be restated in the prompt | Check for `~/.claude/CLAUDE.md` and the memory dir in a fresh run | |
| A9 | **Cost / limits** — per-run cost, concurrency cap, daily cap | Overnight volume vs cap decides whether it can run all night | Read the plan page; run one night and total it | |
| A10 | **Docker / DB availability** | Decides whether tests run or the row degrades to static checks | `docker info`; `pg_isready` (or the DB's equivalent) | |
| A11 | **Network reach** to private services the skills use | Decides the private-network row of the degradation table | One request to each such host | |

## Checklist B — Claude Code routines (claude.ai/code)

| # | Question | Why it decides something | How to test | Answer |
|---|---|---|---|---|
| B1 | **Plugin availability**: do synced plugins carry `dev-workflows` to a routine, or is it repo-scoped `.claude/settings.json` only? | If repo-scoped only, the fallback is the environment setup script (B2). **Never** add a personal marketplace to a team repo's settings | Enable synced plugins; in a routine run, check that `/cloud-runtime` resolves | |
| B2 | **Marketplace install in the environment setup script** | The fallback path when B1 is no | Put the marketplace add + plugin install in the setup script; confirm it survives to the run | |
| B3 | **DB in the environment setup script** — can it provision one for the test suite? | Decides whether the worktree row gets tests or static checks only | Add the DB to the setup script; run one test file in a routine | |
| B4 | **Hourly routine firing `sweep --since 2h`** | Confirms the overlap-plus-dedupe design actually holds | Schedule it hourly for one night; check the log for duplicate dispatches | |
| B5 | **Daily run cap vs expected overnight volume** | At hourly fires, the cap *is* the hours of coverage per day — usually enough for a night, not a night plus a day | Count fires used during one overnight window | |
| B6 | **Connector availability to routines** — do account-level connectors (chat, issue tracker, `<warehouse>`) attach to a *scheduled* run, not just an interactive one? | If connectors don't attach unattended, the loop can't watch anything; without `<warehouse>` prod facts fall to the `<ops_bot>` or `[PENDING]` | Schedule a routine whose only job is one channel read plus a trivial warehouse query, and read the output | |
| B7 | **How results surface** — PR, chat message, artifact, or a run log only? | Decides whether the DM protocol is redundant or essential | Inspect one completed routine run | |
| B8 | **Git identity / push permissions** for the private state repo | Cloud state lives in a repo the routine must push to | Push a commit to `<state_repo>` from a routine | |

---

## Claude Code routine recipe

A routine is a claude.ai/code cloud session fired on a UTC cron (hourly minimum), created through
the built-in **schedule** skill's `RemoteTrigger` tool (`{action: "create", body: …}`) — never via
curl. (Tool and action names as of writing; the schedule skill is authoritative.) Keep the
create body in the calling skill (an example JSON next to its scripts), with: the schedule in UTC
(your overnight window converted from local time — e.g. `0 9-15 * * *` is seven hourly fires;
check the count against your plan's daily cap), the lead model, the connectors it needs, the
source repos (the project, the plugin repo, `<state_repo>`), and a **self-contained prompt** — the
VM starts with zero context, so the prompt tells it to read the skills from the plugin checkout;
plugin-install support in the VM is then not required.

Prerequisites, in order — the create call is refused until the first is done (the refusal reads
like `HTTP 401 Connect your GitHub account before saving a routine that uses a GitHub
repository`):

1. Connect GitHub on claude.ai and install the Claude GitHub App on **every** source repo
   (claude.ai/code's onboarding has a GitHub-app setup step).
2. Seed the state repo (below) so the first fire has something to pull.
3. Connect the chat (and any other) connectors the routine needs at claude.ai/customize/connectors.
4. Create the routine **disabled**, then `run` it once by hand and read `list_runs` →
   `get_run_log` to confirm the connectors attached (B6) and the state-repo push succeeded (B8);
   only then enable it. A fire that fails repo access may leave no run row — check the routine
   itself with `get`.
5. Environment: the default cloud environment may have no DB; tests degrade to static checks until
   its setup script provisions one (B3).

Manage, pause and delete routines at claude.ai/code/routines (the API may not delete). Cloud pushes
to branches without the platform's own prefix (`claude/…` at the time of writing) are checked
against branch protection — so have the prompt push to `claude/<slug>` branches.

## State repo

One-time creation (the user, on the laptop):

```bash
gh repo create <owner>/<name> --private      # then set state_repo: <owner>/<name>
```

It is not cloud-only: the laptop uses the same repo through a local clone. Layout:

```
state.json                        # watermarks, items, leases, scheduler metadata
days/<YYYY-MM-DD>/LOG.md          # one file per day, same table shape in both profiles
dashboard.html                    # regenerated each run; published as an Artifact
artifacts/<YYYY-MM-DD>-<slug>/    # RCA markdown/HTML, drafted prod scripts, reply drafts (cloud)
dryrun/                           # --dry-run rehearsals; gitignored
```

Per-run cycle — prefer the owning loop's sync command; when there is none, it is exactly:

```bash
git -C "$STATE_DIR" pull --rebase --autostash    # --autostash: the tick's writes are uncommitted
git -C "$STATE_DIR" add -A -- state.json days dashboard.html artifacts README.md .gitignore
git -C "$STATE_DIR" commit -m "tick <UTC timestamp>: <n> new, <n> dispatched"
git -C "$STATE_DIR" push || { git -C "$STATE_DIR" pull --rebase --autostash && git -C "$STATE_DIR" push; }
```

and fails the run (exit 1) if that second push also fails; a clean no-op is success.

Rules:

- **One scoped commit per run.** Not per item — a run is the atomic unit, so a failed push rolls
  back a coherent whole. The `add` names its paths; never a bare `add -A`.
- **A failed push does not advance watermarks.** Report the failure; the next run redoes the
  window and the item key dedupes.
- **Never force-push.** Two runs racing is a bug to fix (leases), not to overwrite.
- **Nothing secret in the repo.** It is private, but it is still a repo: no tokens, no `.env`
  contents, no customer identifiers in artifact filenames.

Ledger fallback (state repo unreachable): rebuild `items` from the last 24h of self-DMs and floor
watermarks at `now − 24h`. The format belongs to the loop that writes it; for
**firefighter-loop** the pickup DM's first line is exactly
`🔥 Picked up: <title> | <permalink> | <class> | <channel_id>:<ts>` — anchor on the `🔥 Picked up: `
prefix (emoji included) and take the last ` | `-separated field as the item key. The rebuild is best-effort: it recovers *what was picked
up*, not statuses or artifacts, so every rebuilt item is reported as such.
