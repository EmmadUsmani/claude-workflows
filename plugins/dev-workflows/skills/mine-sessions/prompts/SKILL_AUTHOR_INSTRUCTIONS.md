# Skill authoring task: write one production-quality SKILL.md from synthesized evidence

You are drafting ONE Claude Code skill for the user's plugin. A skill is a `SKILL.md` (markdown with YAML frontmatter) that Claude loads when the user runs `/<name>` or when the description matches the request. It must give a future Claude a proven procedure plus the domain facts and gotchas it would otherwise have to rediscover — written from real evidence, not imagination.

## Inputs
- Your assignment (in the prompt): skill name, target directory, and which section of `SYNTHESIS.md` to work from.
- `SYNTHESIS.md` — the ranked portfolio. Read your candidate's section closely (step outline, domain facts, gotchas, rules, open questions) and skim sections B–D for rules/facts that touch your skill.
- Drill-down for exact details: `views/cluster_G*.md` (Grep for your cluster/workflow names), `reports/NN.json`, and `digests/<session>.md` (Grep a cited `[HH:MM]` timestamp to read the actual turns). Recover the *real* command shapes, file paths, service names, admin URLs, MCP tool names from the digests — do not paraphrase them into something plausible.
- Style references (read two): the orchestrator names two existing, well-regarded skills in the target skills directory (e.g. `ship-pr` and `worktree-create`). Match that voice: terse, imperative, phase-structured, hard rules up top, "verified gotchas" called out, real commands in fenced blocks.

## Verify against the repo (read-only)
The skill will run against the repo(s) the orchestrator names. Before finalizing, confirm every concrete artifact you cite exists: `grep`/`ls` for class names, service objects, `bin/*` scripts, CLI subcommands (`<cli> --help`), admin routes, API/query operation names, rake tasks, env-var *names*. Mark anything you cannot confirm with `(verify)` rather than deleting it or inventing an alternative.
Hard limits: **do not modify anything in the target repo**, do not run the app, do not run migrations/seeds/console against any environment, and **never read `.env*` files** (a standing rule — referencing `ENV['NAME']` by name is fine).

## Write the skill
Path: `<target dir>/SKILL.md` (create the directory). Frontmatter:
```yaml
---
name: <kebab-name>
description: <1–3 sentences: what it does AND when to use it — include the trigger phrasings the user actually uses (from the evidence) so Claude auto-selects it; say what it is NOT for if there's a neighboring skill>
argument-hint: "[...]"   # only if the skill takes an argument
---
```
Body guidance:
- Open with 2–4 lines of orientation (what/why), then **hard rules** (things the user corrected Claude on — phrase as rules, e.g. "Never read .env; use ENV['X'] in a runner script").
- Then the procedure as numbered phases/steps with real commands in fenced blocks. Prefer the canonical form from the evidence; show variants only when they matter.
- **Domain facts** the procedure depends on, stated plainly with where they live (file/service/URL).
- **Verified gotchas**: symptom ⇐ cause ⇒ fix, from the evidence.
- **When not to use / hand off to**: name neighboring skills (`ship-pr`, `gh-stack`, `worktree-create`, `worktree-dev-server`, and any team or project skills for commits, PRs or review) so the skills compose instead of overlapping.
- Length: 120–350 lines. If there's valuable long-tail reference (command tables, API shapes, many admin URLs), put it in `REFERENCE.md` beside SKILL.md and link it; keep SKILL.md focused.
- No provenance clutter in the skill (no session ids, no "evidence:" lines). No secrets, no customer PII (org names/emails/IDs from production investigations must not appear — use placeholders like `<org_id>`).

## Also write a review note (for the orchestrator, not the user)
`<workdir>/skill_notes/<name>.md`: 10–30 lines — which sessions the procedure came from, which repo facts you verified vs. marked `(verify)`, judgment calls you made, and anything in the evidence you deliberately left out and why.

Reply with ONLY two lines: the SKILL.md path and the notes path.
