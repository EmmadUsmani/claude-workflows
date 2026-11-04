# claude-workflows

Personal [Claude Code plugins](https://docs.anthropic.com/en/docs/claude-code/plugins) — engineering workflows distilled from real Claude Code sessions, packaged so they install in any environment and work on any codebase. Each skill encodes a procedure that kept getting rebuilt from scratch, plus the verification gates and gotchas Claude otherwise rediscovers every time.

Nothing here assumes a particular company, product or stack. Anything that differs per person or project — where notes live, which chat tool you use, how you open a production console — is a **setting** (see [Settings](#settings)).

## Plugins

| Plugin | Description |
|--------|-------------|
| [dev-workflows](#dev-workflows) | PRs and stacks, worktrees and local dev recovery, in-app verification, guarded production investigation, bug intake, docs and visual explainers, writing, and multi-agent delegation |

## Installation

```
/plugin marketplace add /path/to/claude-workflows
/plugin install dev-workflows@claude-workflows
```

Or load it into a single session without installing: `claude --plugin-dir /path/to/claude-workflows/plugins/dev-workflows`.

### Working-style preferences (`personal-CLAUDE.md`)

Plugins can't ship always-on context, so the cross-cutting rules the skills assume (act, then report — with a short gated list for posts others see, merges, production writes and product/architecture forks; commit verified work by default, staged precisely; never reclaim shared local state; no direct production access; never read `.env`) live in [`personal-CLAUDE.md`](personal-CLAUDE.md). Append it to your user-level `~/.claude/CLAUDE.md`, then fill in its settings block:

```bash
cat /path/to/claude-workflows/personal-CLAUDE.md >> ~/.claude/CLAUDE.md
```

### Settings

Skills refer to settings as `<setting_name>` — `<sandbox_dir>`, `<notes_dir>`, `<warehouse>`, `<prod_console_cmd>`, `<cloud_agent>` and so on. Put them in a `## dev-workflows settings` section of `~/.claude/CLAUDE.md` (or a project `CLAUDE.md` to override per repo). Every key, its default and which skills use it: [`plugins/dev-workflows/SETTINGS.md`](plugins/dev-workflows/SETTINGS.md). A skill that needs an unset key with no default asks once; it never guesses an outward-facing value (a channel, a push target, a production command).

---

## dev-workflows

Skills compose rather than duplicate. Every skill that produces code runs the `code-style` self-review checklist before presenting a diff; anything with a user-visible surface goes through `verify-in-app`; every PR ends in `pr-triage`; every production fact goes through `warehouse-data` first and every production write through a `prod-script` repair the user runs; isolated work goes through `worktree-create` / `worktree-dev-server`, with `dev-doctor` when the stack misbehaves; investigations offer `research-doc` / `visual-explainer` write-ups and promote reusable scripts via `sandbox-tool`; multi-part work runs through `agent-team`. `bug-intake` is the entry point for incoming issues; `firefighter-loop` watches your channels and dispatches an agent per issue through that same intake → ship-pr → pr-triage chain, and anything running away from the laptop defers to `cloud-runtime` for what degrades.

Mode-bearing skills share one autonomy vocabulary — `--report-only` | `--approval-gated` | `--autonomous` — and default to **act, then report** (`--autonomous`): execution within the ask runs without approval, while anything on the gated list (posting where others see it, merges, production writes, product/architecture forks) and the skills whose whole job is a gated action (`prod-script` repair, `vendor-api-probe` creates, destructive `stack-surgery` / `worktree-create` operations) stay draft-then-wait. Questions still get answers, not edits; `pr-triage` stays report-only on other people's PRs. The one standing exception: anything a skill writes into `<sandbox_dir>` is committed there immediately (own paths only, never pushed) when `<sandbox_autocommit>` is on. `firefighter-loop` runs unattended, so running it is the autonomy grant; it states its exceptions in its own hard rules.

### Shipping & reviewing PRs

| Skill | What it does |
|-------|--------------|
| `/ship-pr` | End-to-end PR: branch (stacked when needed), implement, code-style self-review, verify by driving the app, before/after screenshots embedded so they render in private repos, non-draft PR, hand-off to pr-triage. Delegates to `cloud-agent-work` when `<cloud_agent>` is set. |
| `/cloud-agent-work` | Delegate a PR-shaped change to a cloud coding agent (Niteshift, Claude Code on the web…): self-contained brief, dispatch, watch until the PR settles, independently verify every CI failure / review comment / agent commit, steer fixes — never push yourself. |
| `/pr-triage` | Watch an open PR (or stack) for CI and bot findings (Bugbot, CodeRabbit, …), verify each claim against the code, then fix + reply + resolve — autonomously on PRs you or the cloud agent opened; on anyone else's PR it reports verdicts and holds. |
| `/deep-pr-review` | Context-gathered review of someone else's PR into a numbered local review doc in `<review_dir>`; posts nothing. Builds the review graph and a PR one-pager by default. |
| `/pr-review-graph` | Interactive, pannable review graph of a PR: every changed code unit a node, every dependency a typed edge, a drawer with the verbatim diff, findings and screenshots. |
| `/code-style` | Code-shape preferences — abstraction barriers, domain boundaries, declarative over imperative, one source of truth, sparse comments — with before/after examples and a self-review checklist. |
| `/stack-surgery` | Split a branch into a stack losslessly, restack past a squash-merged base, cascade fixes, adopt hand-built branches, prove a safe merge order — every operation ends in a proof. |
| `/gh-stack` | Reference for the `gh stack` CLI extension plus verified agent gotchas. |

### Local environment

| Skill | What it does |
|-------|--------------|
| `/worktree-create` | `git worktree add` plus a per-project provisioning checklist: env symlinks verified (never read), own port, isolated Docker Compose project, optional own DB, deps. |
| `/worktree-dev-server` | Boot `<dev_cmd>` from a worktree in the background on the right port, readiness polling that can't be fooled, clean shutdown of only what you started. |
| `/dev-doctor` | Symptom-first diagnosis of a broken local stack — who owns the port, is shared infra up, was it booted right, is the output cached, is the queue starved — before blaming your diff. |

### Verification & investigation

| Skill | What it does |
|-------|--------------|
| `/verify-in-app` | Prove a change by driving the real app: capture API payloads via a `window.fetch` patch, measure the DOM, cross-check persisted rows, matched before/after evidence. |
| `/bug-intake` | Own a bug end to end: intake → reproduce/localize → RCA against real production facts → falsifiable verdict → RCA artifacts → guarded remediation → permanent fix → follow-ups. |
| `/warehouse-data` | **First stop for any production fact.** Read-only SQL against `<warehouse>` (a warehouse or replica), with a schema-map procedure, freshness check, PII handling — and the hierarchy: warehouse → optional `<ops_bot>` → prod-script. |
| `/prod-script` | Guarded production repairs (and last-resort reads) via a script the user runs in `<prod_console_cmd>`: diagnose read-only; repair = rehearse → DRY_RUN → paste back → confirm → apply, with blast radius and rollback. |
| `/vendor-api-probe` | Settle a claim about a third-party API empirically: one numbered script per hypothesis, raw request/response saved, claim-by-claim verdicts, every created resource cleaned up and proven gone. |
| `/render-pipeline-debug` | Debug a multi-stage image/PDF/video render pipeline: identify the surface first, trace the stages, bust every cache layer before blaming code. |

### Docs, explainers & tooling

| Skill | What it does |
|-------|--------------|
| `/research-doc` | Turn an investigation or design into a durable doc — a note in `<notes_dir>`, a page in `<docs_site>`, or an HTML explainer. |
| `/visual-explainer` | A self-contained, highly visual HTML page that makes one bug, mechanism or solution space understandable at a glance (`explain` / `explore` modes), plus its one-pager. |
| `/one-pager` | Condense a plan into one full-screen engineering spec sheet (six numbered panels, every one with a WHY), rendered to PNG by headless Chrome after a layout lint. |
| `/sandbox-tool` | Durable local tools in `<sandbox_dir>`: report-first, dry-run-by-default scripts, apply → revert → re-verify fixture toolkits, exploration samplers. |
| `/demo-video` | Narrated, edited demo videos of a feature from real footage, using the engine at `<demo_engine>`. |

### Writing

| Skill | What it does |
|-------|--------------|
| `/slack-message` | Chat messages about technical work in the user's voice, every fact verified — teammate mode by default, partner mode for issue reports to external providers. Drafts only; never sends. |
| `/status-update` | The periodic status update for `<status_channel>` from whatever notes you have, research filling the gaps; posts only on an explicit "post it". |
| `/daily-summary` | The `## Summary` of a day's note, reconstructed from Claude Code transcripts (bundled digest script) and cross-checked against GitHub and your tools. |

### Delegation, automation & meta

| Skill | What it does |
|-------|--------------|
| `/agent-team` | Lead a team of subagents: partition by file ownership, brief with hard constraints, verify every diff yourself, recover when an agent drifts into the main checkout. |
| `/firefighter-loop` | Watch `<watch_channels>` for incoming issues and dispatch one agent per actionable item through bug-intake, as far as it can go unattended; dashboard + day log. |
| `/cloud-runtime` | Probe local vs cloud runtime and apply the degradation rules for running any of the above off-laptop, labelling what couldn't be verified. |
| `/mine-sessions` | Mine your past Claude Code transcripts for recurring workflows and corrections and turn them into new or improved skills. |

---

## Development

```
node scripts/lint_skills.js                      # structure, frontmatter, cross-references
node scripts/lint_skills.js --denylist FILE      # also scan for private terms (keep FILE outside the repo)
node scripts/settings_usage.js --check           # SETTINGS.md "Used by" matches the skills (--write fixes it)
claude plugin validate plugins/dev-workflows
```

`lint_skills.js --denylist` takes a private file of case-insensitive regexes (one per line, optional `glob :: regex` scoping). Keep that file outside the repo — its whole point is to list terms that must never appear here.

### Adding another plugin

1. `mkdir -p plugins/my-plugin/.claude-plugin` and add `plugin.json` (`name`, `description`, `version`, `author`).
2. Add capabilities: **skills** in `skills/<name>/SKILL.md`, **commands** as `.md` files in `commands/`, **hooks** in `hooks.json`, **MCP servers** in `.mcp.json`.
3. Register it in `.claude-plugin/marketplace.json`.

A `CLAUDE.md` at a plugin's root is **not** loaded as context — put always-on rules in a skill or in your user-level `~/.claude/CLAUDE.md` (that's why `personal-CLAUDE.md` exists).

### Writing a skill

Create `plugins/dev-workflows/skills/<name>/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does and when to use it — include the phrasings you actually use (≤1024 chars; avoid an unquoted " #", which YAML treats as a comment)
argument-hint: "[optional argument description]"
---

# Skill Title

Orientation, hard rules, then the procedure with real commands, verified gotchas, and hand-offs to neighboring skills.
```

Long-tail reference goes in a sibling `REFERENCE.md`; bundled scripts in `scripts/`. Restart Claude Code (or `claude plugin update dev-workflows@claude-workflows`) to pick up changes.
