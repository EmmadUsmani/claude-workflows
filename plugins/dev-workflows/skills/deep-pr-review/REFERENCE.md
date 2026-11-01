# deep-pr-review — reference

Long-tail detail for [SKILL.md](SKILL.md): the review-doc skeleton, the GitHub reviews API
payload shape, the command inventory, and the per-repo facts worth establishing once.

---

## Review doc skeleton

`<review_dir>/<repo>-pr<N>-review.md` (see SKILL.md "Where the outputs go")

```markdown
# Code review — `<owner>/<repo>` #<N>

**Title:** <PR title>
**Author:** <name> · **Ticket:** [<TICKET or owner/repo#n>](<link>) (PR 2 of 3 under epic <EPIC>)
**Base branch:** `<base>` (⚠️ *not* `main` — stacked PR: #A → **#B** → #C)
**Head:** `<head-branch>` @ `<sha>`
**Size:** N files, +X / −Y (of which ~Z lines are tests)
**Reviewed:** YYYY-MM-DD
**Artifacts:** [review graph](<sandbox_dir>/tickets/<repo>-pr<N>/review-graph/…) · [one-pager](<sandbox_dir>/tickets/<repo>-pr<N>/one-pager/…) · screenshots — plus private Artifact links once published

---

## 1. Summary
<what it does, in the domain's language>

| Step | Unit | Sync/async |
|---|---|---|
| … | `Some::Service` (new) | in-request |

### Verdict
**Approve with changes.** <one paragraph: what's above bar, then the 2–3 findings that gate merge, by number.>

### Verification I ran
| Suite | Result |
|---|---|
| `test/<area>/…` | **48 tests, 0 failures** |

(Or: "Tests not run locally: <reason>. CI has not run the test suite on `<sha>` — only the
labeler check ran, the test workflows await maintainer approval.")

---

## 2. Findings
Severity key: **High** = fix before merge · **Medium** = fix or consciously accept with a
follow-up · **Low/Nit** = author's call.

### F1 — [High] <one-line claim>
**Where:** `lib/…/thing.js:2917`
**Why it's reachable:** <the concrete chain, not a hypothetical>
**Suggested fix:** <the smallest change that closes it>

---

## 3. Checked and ruled out
- <suspicion> — <why it can't happen, with the file:line that proves it>

## 4. Prior review state
| Finding / event | Status |
|---|---|
| <finding> @ `<sha>` | Fixed in `<sha>` / Still live / Correctly refuted — <why> |
| Competing PR #<m> | Closed — <why this one won> |
```

Notes that make these docs useful later:

- Findings are stable ids. Once `F7` exists, it stays `F7` in the v2 doc, in the inline
  comment, and in conversation.
- Credit the bot findings the author genuinely fixed. After a rebase, GitHub detaches those
  comments and nobody can tell — this table is the only record.
- If a finding was confirmed by driving the app, say so and link the screenshot.

---

## GitHub review payload

`POST /repos/{owner}/{repo}/pulls/{n}/reviews` — one review, N inline comments, one event.

```json
{
  "commit_id": "<head sha — omit to use the current head>",
  "event": "COMMENT",
  "body": "Top-level review body (markdown).",
  "comments": [
    {
      "path": "lib/router/head-route.js",
      "line": 2917,
      "side": "RIGHT",
      "body": "### F1 · <title>\n\n<evidence, then the fix>"
    },
    {
      "path": "app/views/admin/posts/_bulk_status.html.erb",
      "start_line": 30,
      "start_side": "RIGHT",
      "line": 45,
      "side": "RIGHT",
      "body": "### F2 · <title>\n\n…"
    }
  ]
}
```

- `event`: `COMMENT` (default, no verdict) · `APPROVE` · `REQUEST_CHANGES`. Use exactly what
  the user asked for; `COMMENT` leaves `reviewDecision` at `REVIEW_REQUIRED`.
- `line` is the line number **in the file at the head commit**, not a diff position.
  `side: "RIGHT"` = the post-change file; `"LEFT"` only for a deleted line.
- Multi-line comment = `start_line` + `line` (both with their `*_side`). Spanning a whole
  block reads better than pinning a nit to one line.
- Every commented line must be **within the PR's diff hunks**, or the API rejects the whole
  review (HTTP 422) — no partial posts.
- Committable suggestion blocks must reproduce the target lines' **exact leading
  whitespace**. Get it from the head SHA, not the working tree:
  ````bash
  git show <sha>:<path> | sed -n '48,62p' | sed 's/^/|/'   # makes indentation visible
  ````
  ```markdown
  ```suggestion
  <replacement for exactly start_line..line>
  ```
  ```
- Build the payload with a heredoc script into a JSON file and pass `--input` — inline
  `-f body=…` mangles multi-line markdown.

### Post, then verify

```bash
gh api repos/<owner>/<repo>/pulls/<N>/reviews --method POST --input <scratch>/review.json

gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate \
  --jq '.[] | select(.pull_request_review_id == <id>) | "\(.path):\(.start_line // .line)-\(.line) [\(.side)] \(.body[0:80])"'
gh pr view <N> --repo <owner>/<repo> --json reviewDecision,state --jq '{reviewDecision, state}'
```

---

## Command inventory

| Purpose | Command |
|---|---|
| PR metadata + real base | `gh pr view <N> --repo <owner>/<repo> --json baseRefName,baseRefOid,headRefName,headRefOid,additions,deletions,changedFiles,state,isDraft,author,url` |
| PR body | `gh pr view <N> --repo <owner>/<repo> --json body --jq .body` |
| Blobless clone (no checkout yet) | `git clone --filter=blob:none https://github.com/<owner>/<repo>.git <main-checkout>` |
| Fetch the PR's SHAs | `git -C <main-checkout> fetch origin pull/<N>/head <baseRefOid>` |
| Detached worktree at a SHA | `git -C <main-checkout> worktree add --detach <worktrees_dir>/<repo>-pr<N> <sha>` |
| Code-only diff | `git diff <baseRefOid>...<headRefOid> -- <code-only pathspec>` |
| Tests/schema diff (separately) | `git diff <baseRefOid>...<headRefOid> -- <test and schema paths>` |
| Commits in this layer | `git log --oneline <baseRefOid>..<headRefOid>` |
| Files touched | `git diff --name-only <baseRefOid>...<headRefOid>` |
| Was a reviewed SHA rewritten? | `git merge-base --is-ancestor <sha> <headRefOid>` |
| Reviews + top-level comments | `gh pr view <N> --repo <owner>/<repo> --json reviews,comments` |
| Inline review comments | `gh api repos/<owner>/<repo>/pulls/<N>/comments --paginate` |
| Review threads incl. resolved | `gh api graphql -F owner=<owner> -F name=<repo> -F n=<N> -f query='query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:20){nodes{author{login} body}}}}}}}'` |
| Which checks actually ran | `gh pr view <N> --repo <owner>/<repo> --json statusCheckRollup` (a fork PR may show only non-test checks) |
| Stacked layers above | `gh pr list --repo <owner>/<repo> --search "base:<head branch>"` |
| Remove the worktree | `git -C <main-checkout> worktree remove <worktrees_dir>/<repo>-pr<N> --force` |
| Test schema refresh | `RAILS_ENV=test bin/rails db:test:prepare` (or the stack's equivalent) |
| Real route | `bin/rails routes \| grep -i <thing>` (or the framework's route listing) |

## Tools used for context

| Source | Examples |
|---|---|
| `<issue_tracker>` ticket + relations | `gh issue view <n> --repo <owner>/<repo> --comments` · Linear MCP `get_issue` (`{"id": "PROJ-3871", "includeRelations": true}`) · the Jira MCP/CLI |
| `<issue_tracker>` discussion | issue comments · Linear MCP `list_comments` |
| `<chat>` | the Slack MCP's search (then read the thread it finds — thread reads usually need the parent message's timestamp) |
| Design docs | the Notion / Google Docs / Confluence MCP, if the PR links one |
| Production errors referenced by the PR | `<error_tracker>` / `<log_search>` MCP or CLI |

MCP tools often arrive deferred — `ToolSearch` with `select:<name>,<name>` before the first call.

## Repo facts worth establishing once per repo

Write these down (in the repo's agent docs if you own them, or your own notes) the first time
you review in a repo; the procedure leans on each.

- **Where agent context lives** — `AGENTS.md` vs `CLAUDE.md` vs `CONTRIBUTING.md`, root and
  per directory (service-object conventions, test conventions, worktree hooks).
- **How the tests run, and whether they can run here** — the runner, required services, and
  whether CI on fork PRs needs maintainer approval.
- **Whether the test DB is per-worktree.** If its name is hardcoded in config with no override,
  two sessions running tests collide — skip local tests when another session may be running them.
- **Query/perf detectors in the test suite** and their opt-out tags (Rails: Prosopite, Bullet;
  elsewhere, benchmark or leak checks). A cluster of new opt-outs in a diff is worth a finding.
- **The Playwright MCP's writable roots**, if it's sandboxed.
- **Dev hostnames** — whether the app, its admin and the frontend dev server share `<dev_url>` or
  sit on separate hosts/ports.
- **Where runbooks live** (`docs/<area>/`) — check whether a PR's runbook matches the routes it
  actually mounts.
