# pr-triage — command reference

`<owner>/<repo>` is the PR's repository throughout. Every command here was run for real;
prefer these shapes over inventing your own.

---

## 1. Review threads (GraphQL) — the only way to resolve

REST can post replies but **cannot** mark a thread resolved. Get node ids first:

```bash
gh api graphql -f query='
query {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <n>) {
      reviewDecision
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { id body author { login } createdAt } }
        }
      }
    }
  }
}'
```

- `first: 50` for a normal PR; `last: 40` when you only care about the newest rounds; bump to `100` on a long-lived PR.
- Several PRs in one call with aliases:

```bash
gh api graphql -f query='
{ repository(owner:"<owner>", name:"<repo>") {
    a: pullRequest(number: <n1>) { reviewDecision reviewThreads(last: 40) { nodes { id isResolved path } } }
    b: pullRequest(number: <n2>) { reviewDecision reviewThreads(last: 40) { nodes { id isResolved path } } }
} }'
```

Resolve:

```bash
gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"PRRT_kwDO..."}){thread{isResolved}}}'
```

Failure mode: `{"data":{"resolveReviewThread":null},"errors":[{"type":"NOT_FOUND", …"Could not resolve to a node with the global id of ''"}]}`
⇒ the id was empty or wrong. Echo `$thread_id` before the mutation; never build it with
`${var#prefix}` surgery.

`resolvedBy { login }` tells you *who* resolved it — a `cursor[bot]` self-resolve after a
restack carries **zero** signal that the issue was fixed.

---

## 2. Comments and reviews (REST)

```bash
# Inline review comments (the ones with path/line), newest-first filtering
gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate \
  --jq '.[] | select(.created_at > "<SINCE>") | "\(.id) | \(.user.login) | \(.path):\(.line) | \(.body[0:200])"'

# High-water mark for the seen-set
gh api repos/<owner>/<repo>/pulls/<n>/comments --jq 'map(.id)|max'

# Staleness triage
gh api repos/<owner>/<repo>/pulls/<n>/comments --jq '.[] | {id, line, original_commit_id, created_at, in_reply_to_id}'

# One comment, full body (never act on a truncated notification)
gh api repos/<owner>/<repo>/pulls/comments/<id> --jq '.body'

# PR-level reviews (bot summaries, approvals, change requests)
gh pr view <n> --json reviews,reviewDecision
gh api repos/<owner>/<repo>/pulls/<n>/reviews/<id> --jq '.body'

# Reply into the originating inline thread
gh api -X POST repos/<owner>/<repo>/pulls/<n>/comments/<comment_id>/replies -f body="$(cat reply.md)"

# PR-level comment (also the bot re-trigger channel)
gh pr comment <n> --body 'bugbot run'

# Undo a double-post
gh api repos/<owner>/<repo>/pulls/comments/<id> --method DELETE
```

Write reply bodies to a file and `-f body="$(cat file)"` — transient GitHub failures
(curl exit 28) otherwise lose the text you just composed.

---

## 3. Checks, runs, jobs

```bash
gh pr checks <n> --json name,bucket,state
gh pr checks <n> --watch --interval 30            # blocking; prefer a Monitor

# Tally by column — a naive `grep fail` matches a job named `notify-failure`
gh pr checks <n> | awk -F'\t' '{print $2}' | sort | uniq -c

# Did CI actually run on this SHA?
gh api repos/<owner>/<repo>/actions/runs?head_sha=<sha>
gh api repos/<owner>/<repo>/actions/runs?branch=<branch>

# Infra-vs-code: zero executed steps + died at "Set up job" = runner outage
gh api repos/<owner>/<repo>/actions/jobs/<id> --jq '.steps'
curl -s https://www.githubstatus.com/api/v2/incidents/unresolved.json

# Reruns — one job at a time; --job is rejected while the parent run is in progress
gh run rerun <run_id> --failed
gh run view --job <id> --log-failed | grep -B2 -A8 'Failure/Error'   # adjust to your test runner

# Mergeability (async — reads UNKNOWN briefly)
gh pr view <n> --json mergeable,mergeStateStatus,changedFiles
```

Buckets: `pass` · `fail` · `cancel` · `skipping` · `pending`. **`cancel` ≠ `fail`** —
cancels are usually collateral from a concurrent rerun or an outage.

---

## 4. Learn the repo's CI shape (once per repo)

Read `.github/workflows/*.yml` and write down, for the watcher's settle predicate:

| Question | Why it matters |
|---|---|
| Which jobs fan out into shards, and how many? | The registered-check count on a PR is the sum — fewer than that means the matrix hasn't registered yet |
| Which jobs are gated to the default branch (`if: github.ref == 'refs/heads/main'`)? | They always skip on a PR; they are not failures |
| Triggers: `push` / `pull_request` / `workflow_dispatch` | A `workflow_dispatch` run binds to the **branch**, not the PR — it never attaches to the merge box, so it cannot satisfy branch protection |
| How are tests split across shards? | To approximate shard *k* of *N* locally: `find <test dir> -name '*_spec.rb' \| sort \| awk -v N=<shards> -v k=<index> 'NR % N == k'` (a bare `N`/`k` inside awk is an unset variable → modulo by zero) |

Cross-check against the default branch's latest run and one sibling PR before declaring "CI is
complete".

---

## 5. Bot / check roster

| Actor | What it posts | Re-trigger | Notes |
|---|---|---|---|
| `cursor[bot]` — Bugbot | Inline defect claims + a whole-PR summary re-posted on every push | `bugbot run` or `@cursor review` (PR comment) | "Skipping" = already reviewed this SHA. A shifting pass/skip count is not a regression. |
| `cursor[bot]` — auto-approve | PR-level risk assessment ("medium risk — held for a human") | none (fires on PR events only; a new head SHA re-evaluates) | Separate product. Declining a diff that touches auth / permissions / money / migrations is **correct**, not stuck (where this product is enabled). Answer with evidence, not a code change. |
| `coderabbitai[bot]` | Walkthrough first, inline later (free tier) | `@coderabbitai review` | **Does not auto-review a PR whose base isn't the default branch** — stack layers above the bottom get Bugbot + humans only. Its check reports `status=none` and looks perpetually pending. Can also be *paused* per repo/PR. |
| `cubic-dev-ai[bot]` | Inline findings | — | |
| any other review bot (e.g. `sourcery-ai`, `claude[bot]`) | Summary as an issue comment, findings as inline review comments | per the bot's docs | Check both `issues/<n>/comments` and `pulls/<n>/comments`. |
| Graphite AI Reviews | Named check + review | — | |
| Socket Security | Named check | — | Dependency/supply-chain. |

`POST /repos/<owner>/<repo>/check-runs/{id}/rerequest` **404s** for the Cursor app — only
the comment trigger works.

**A passing check ≠ an approval.** These report `pass` when the agent *completed*. Confirm
with `gh pr view <n> --json reviewDecision,reviews`; `REVIEW_REQUIRED` with zero `APPROVED`
reviews means it declined. Never push an empty commit to farm an auto-approval.

---

## 6. Monitor skeleton

`ToolSearch 'select:Monitor'` and `ToolSearch 'select:TaskStop'` first — both are deferred.
Arm with `persistent: true` for a session-length watch. State lives **outside** the
scratchpad because the scratchpad is wiped on a Claude Code process restart.

```bash
REPO=<owner>/<repo>
STATE=$HOME/.cache/pr-monitor
mkdir -p "$STATE"; touch "$STATE/seen" "$STATE/reported-fails"
while true; do
  for PR in <n1> <n2> <n3>; do
    # new inline comments, deduped on id
    gh api "repos/$REPO/pulls/$PR/comments" --paginate \
      --jq '.[] | "\(.id)\t\(.user.login)\t\(.path):\(.line)\t\(.body[0:180])"' 2>/dev/null |
      while IFS=$'\t' read -r id who where body; do
        grep -qx "$id" "$STATE/seen" && continue
        echo "$id" >> "$STATE/seen"
        case "$who" in
          <your-github-login>) continue ;;              # your own gh-posted replies
        esac
        printf 'PR %s NEW %s %s :: %s\n' "$PR" "$who" "$where" "$body"
      done
    # absolute failure detection, not transition detection
    s=$(gh pr checks "$PR" --json name,bucket 2>/dev/null || true)
    [ -n "$s" ] && jq -r '.[] | select(.bucket=="fail") | "'"$PR"' FAIL \(.name)"' <<<"$s" |
      while read -r line; do
        grep -qxF "$line" "$STATE/reported-fails" && continue
        echo "$line" >> "$STATE/reported-fails"; echo "$line"
      done
  done
  sleep 90
done
```

Rules baked into that shape:

- **Never name a variable `status`** — it is read-only in zsh and the script aborts
  silently at arm time (a recurring trap).
- Every `gh` call gets `|| true` / `2>/dev/null` so one transient failure doesn't kill the watch.
- Dedupe on **id**, persisted to a file, never on a body hash and never on `path:line`.
- Emit failures **absolutely**, not on transition — a stale baseline hid a real regression.
- `TaskStop` the old monitor before arming a retuned one, and re-arm after every push.
- Monitors die silently across compaction / MCP teardown. Silence means "not watching",
  not "calm CI" — re-poll with `gh` and say you re-armed.

---

## 7. One-shot sweep ("is anything outstanding?")

When the ask is *"confirm there are no outstanding comments we haven't addressed"*, don't
arm a watcher. Run one deterministic pass:

```bash
SHA=$(gh pr view <n> --json headRefOid --jq .headRefOid)
gh pr checks <n> --json name,bucket,state
gh api repos/<owner>/<repo>/actions/runs?head_sha=$SHA --jq '.total_count'
gh api graphql -f query='query { repository(owner:"<owner>",name:"<repo>"){ pullRequest(number:<n>){
  reviewDecision
  reviewThreads(first:50){ nodes{ id isResolved isOutdated path comments(first:1){nodes{author{login} body}} } }
}}}'
```

Then report either "nothing outstanding" or the exact remaining items with a verdict each.
Reconcile against **live GitHub state**, not against your own earlier tracking notes.
