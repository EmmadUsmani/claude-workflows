# Settings

Every skill in `dev-workflows` is company-agnostic. Anything that differs per person or per
project — where notes live, which chat tool you use, which cloud agent runs your PRs — is a
**setting**, named in skills as `<setting_name>`.

## Where settings live

Add a `## dev-workflows settings` section to your user-level `~/.claude/CLAUDE.md` (the
`personal-CLAUDE.md` template at the repo root has one), or a project-level `CLAUDE.md` to
override per repo. Format is one `key: value` per line:

```markdown
## dev-workflows settings
sandbox_dir: ~/projects/sandbox
notes_dir: ~/notes
chat: slack
issue_tracker: linear
```

**Resolution order:** project `CLAUDE.md` → user `~/.claude/CLAUDE.md` → the default below.
A setting with no default that a skill needs is asked for **once**, then the skill suggests
adding it to the settings section. Skills never guess a value for an outward-facing setting
(a channel, a repo to push to, a production command).

## Keys

| Key | Default | What it is | Used by |
|---|---|---|---|
| `sandbox_dir` | `~/projects/sandbox` | Your durable scratch repo: scratch work in `<sandbox_dir>/adhoc/YYYY-MM-DD-slug/`, persistent artifacts in `<sandbox_dir>/tickets/<topic>/` | bug-intake, cloud-agent-work, cloud-runtime, deep-pr-review, firefighter-loop, mine-sessions, one-pager, pr-review-graph, prod-script, render-pipeline-debug, research-doc, sandbox-tool, slack-message, status-update, vendor-api-probe, visual-explainer, warehouse-data |
| `sandbox_autocommit` | `true` | Commit what a skill writes into `<sandbox_dir>` immediately (own paths only, never pushed), when it is a git repo | bug-intake, cloud-runtime, firefighter-loop, mine-sessions, one-pager, pr-review-graph, research-doc, sandbox-tool, slack-message, visual-explainer |
| `notes_dir` | `~/notes` | A Markdown / Obsidian vault for durable notes | bug-intake, cloud-runtime, daily-summary, deep-pr-review, mine-sessions, research-doc, visual-explainer |
| `review_dir` | `<notes_dir>/code-review` | Where PR review docs go | deep-pr-review, pr-review-graph, research-doc |
| `docs_site` | *(none)* | Path to a static docs-site repo (Astro, Docusaurus, MkDocs…) | bug-intake, cloud-runtime, research-doc, visual-explainer |
| `screenshots_dir` | `~/Desktop/<TICKET>/{before,after}/` | Before/after evidence for a change; already ends in `{before,after}/` | bug-intake, ship-pr, verify-in-app |
| `dev_url` | `http://localhost:3000` | The app as you open it locally; skills derive the dev port from it | agent-team, bug-intake, deep-pr-review, demo-video, dev-doctor, render-pipeline-debug, ship-pr, verify-in-app, worktree-create, worktree-dev-server |
| `dev_cmd` | detected (`bin/dev`, `npm run dev`, `docker compose up`…) | How the project boots its dev server | dev-doctor, worktree-dev-server |
| `worktrees_dir` | `<repo>/.worktrees` | Where worktrees are created | agent-team, deep-pr-review, dev-doctor, firefighter-loop, pr-review-graph, prod-script, worktree-create, worktree-dev-server |
| `issue_tracker` | `github` | `github` \| `linear` \| `jira` | agent-team, bug-intake, code-style, daily-summary, deep-pr-review, firefighter-loop, ship-pr, status-update |
| `chat` | `slack` | Your team chat (`slack`, …) | agent-team, bug-intake, cloud-runtime, code-style, daily-summary, deep-pr-review, firefighter-loop, slack-message, status-update |
| `status_channel` | *(none)* | Where the periodic status update is posted | status-update |
| `status_cadence` | `fri` | Posting days as a weekday list, e.g. `tue,thu`; bare `weekly` means the skill asks which day once | status-update |
| `watch_channels` | *(none)* | Channels the firefighter loop watches for incoming issues | firefighter-loop |
| `daily_notes` | `<notes_dir>/daily/YYYY-MM-DD.md` | Path pattern of your daily notes | daily-summary, status-update |
| `warehouse` | *(none)* | The MCP tool / CLI that runs read-only SQL against your warehouse or read replica | agent-team, bug-intake, cloud-agent-work, cloud-runtime, daily-summary, deep-pr-review, firefighter-loop, one-pager, pr-triage, prod-script, research-doc, ship-pr, warehouse-data |
| `ops_bot` | *(none)* | An optional read-only production assistant your team runs: `<chat> <#channel> <@handle>`, e.g. `slack #ops-help @opsbot`; record its protocol (mention required? what its ACK looks like) beside it in the project CLAUDE.md | agent-team, bug-intake, cloud-agent-work, cloud-runtime, daily-summary, dev-doctor, firefighter-loop, mine-sessions, one-pager, pr-triage, prod-script, render-pipeline-debug, research-doc, sandbox-tool, ship-pr, slack-message, status-update, vendor-api-probe, verify-in-app, visual-explainer, warehouse-data |
| `prod_console_cmd` | *(none)* | The command a human runs to open a production console (e.g. `heroku run rails c`, `fly ssh console -C "bin/rails c"`, `kubectl exec … -- bin/rails c`) | agent-team, bug-intake, prod-script, sandbox-tool |
| `error_tracker` | *(none)* | `sentry`, `rollbar`, `honeybadger`… | bug-intake, deep-pr-review, firefighter-loop, prod-script, warehouse-data |
| `log_search` | *(none)* | `betterstack`, `datadog`, `cloudwatch`… | bug-intake, deep-pr-review, prod-script, slack-message, warehouse-data |
| `cloud_agent` | `none` | `none` \| `claude-code-web` \| `niteshift` \| any MCP-driven coding agent | agent-team, bug-intake, cloud-agent-work, cloud-runtime, daily-summary, demo-video, firefighter-loop, pr-triage, render-pipeline-debug, ship-pr, status-update |
| `cloud_env` | *(none)* | The environment / repo the cloud agent runs in | cloud-agent-work, cloud-runtime, demo-video, ship-pr |
| `pr_preview_label` | *(none)* | A label that triggers preview deploys, if your CI has one | cloud-agent-work, ship-pr |
| `state_repo` | *(none)* | A private git repo for state when running off-laptop | cloud-runtime, firefighter-loop |
| `demo_engine` | `~/projects/demo-reel` | The narrated demo-video engine repo | demo-video |

_The Used by column is generated from the skills: `node scripts/settings_usage.js --write`._

## Conventions shared by every skill

- **The user** is whoever runs the skill. Skills say "the user", never a name.
- **Act, then report** is the default posture (`personal-CLAUDE.md` § *Autonomy: act, then
  report*). Mode-bearing skills share one autonomy vocabulary: `--report-only` |
  `--approval-gated` | `--autonomous`, and **`--autonomous` is the default** except where a
  skill's whole job is a gated action (prod-script repair, vendor-api-probe creates, destructive
  stack-surgery / worktree-create operations) — those stay draft-then-wait. No mode crosses the
  gated list: posting where others see it, merges, production writes, product/architecture forks.
  Questions get answers, not edits; pr-triage stays report-only on other people's PRs. An explicit
  flag from the user always wins.
- **Outputs of a PR review** (deep-pr-review, pr-review-graph, one-pager): the review doc goes to
  `<review_dir>/<repo>-pr<N>-review.md`; the graph and one-pager go to
  `<sandbox_dir>/tickets/<repo>-pr<N>/{review-graph,one-pager,screenshots}/`, linked from the review doc.
- **Production is read-only from the agent's side.** Facts come from `<warehouse>` first, then
  `<ops_bot>` if one exists, then a console script the user runs (prod-script). Every
  production write is a prod-script `repair` the user runs.
- **Never read `.env*` files.** Read config through the app (`ENV['X']` in a runner script,
  `process.env.X` in a node one-liner).
- **Shared local state** (ports, Docker, the dev DB, the test DB, job queues, the browser
  profile, the main checkout) is never reclaimed without permission.
