# Skill-composition audit: map how the plugin's skills should tie together, and produce a per-skill edit plan

Repo: the skills directory the orchestrator names (`plugins/<plugin>/skills/`) — each skill is a `SKILL.md` (+ some `REFERENCE.md`). Read every SKILL.md fully. Also skim the plugin's cross-cutting rules file (a `personal-CLAUDE.md`-style template, if there is one) and the frontmatter descriptions of any team/project skills and commands the orchestrator lists (reference targets only — never edit those).

## The user's brief (the orchestrator pastes the user's actual words here; example of the kind of ask)
"Audit all of our skills and focus on tying them together, referencing and delegating as needed. It's okay to add steps where it makes sense. For example, ship-pr and anything that authors code should reference the code-style skill as a self-review pass over generated code. Don't limit yourself to what I wrote; do a general audit of how skills can cross-reference beneficially."

If any skill is being rewritten by a separate agent right now (the orchestrator will say which; e.g. bug-intake: RCA artifacts via research-doc / visual-explainer, warehouse-data first and prod-script last for production facts, remediation via prod-script repair, root-cause fix via ship-pr, then follow-ups), **do not plan edits to it**, but DO plan how other skills should reference it (hand-offs in and out: prod-script, dev-doctor, render-pipeline-debug, pr-triage …).

## Method
1. Build the current graph: for each skill, its out-links (skills it names) and in-links. Note dangling or one-directional references, stale names, and places where two skills describe the same procedure (duplication → one should delegate).
2. Identify composition opportunities of these kinds, with the concrete insertion point (skill, section/phase, one or two sentences of proposed text):
   - **Delegation**: a skill contains a compressed version of another skill's procedure → replace with a 3–6 line summary + "run /X for the full procedure".
   - **Gate/pass steps**: e.g. every skill that produces code (ship-pr, stack-surgery when it rewrites, sandbox-tool, agent-team's integration step, render-pipeline-debug fixes, vendor-api-probe scripts, prod-script scripts, dev-doctor fixes) gets a `code-style` self-review pass before presenting the diff; every skill that changes user-visible behavior gets a `verify-in-app` step; every skill that opens a PR ends in `pr-triage`; production reads route to `warehouse-data` first (then the `<ops_bot>` if the team runs one, `prod-script` last) and production writes through `prod-script` `repair`; anything that needs an isolated checkout points to `worktree-create` + `worktree-dev-server`, and anything where the local stack misbehaves points to `dev-doctor`.
   - **Artifacts**: investigations that end in an explanation should offer `research-doc` / `visual-explainer`; anything that yields a reusable script should offer `sandbox-tool`.
   - **Orchestration**: multi-part work (stacks, several PRs, parallel investigations) should mention `agent-team` and the model policy.
   - **Entry routing**: the "When not to use / hand off" sections should form a consistent, complete routing table — a request that lands on the wrong skill must be redirected to the right one in ≤1 hop.
3. Also flag: contradictions between skills (e.g. two different defaults for the same thing), a skill that waits for approval on ungated execution, or acts on a gated action (posting where others see it, merges, production writes, product/architecture forks) without a draft-then-wait — see the cross-cutting rules file's autonomy section (act, then report) — and any place a skill duplicates the cross-cutting rules file verbosely (a one-line pointer is enough).

## Output: `INTEGRATION_PLAN.md` in `<workdir>`
```
# Integration plan
## 0. Current graph (compact adjacency list: skill → [out-links]; dangling/stale refs; duplicated procedures)
## 1. Cross-cutting patterns to apply (the gate/pass steps, with exact wording to reuse so all skills phrase it the same way)
## 2. Per-skill edit list — one section per skill, ordered by amount of change
### <skill>
- edit 1: <section / phase> — <insertion or replacement>, proposed text (≤6 lines), why (which pattern / which skill it ties to)
- …
- "When not to use / hand off" routing table: the final list of hand-offs this skill should carry
## 3. Edit groups for parallel workers (assign every skill (except any being rewritten elsewhere) to exactly one group of 3–5 skills; balance by amount of change; note which groups need Opus (substantive new steps) vs Sonnet (mostly cross-links))
## 4. Open questions / contradictions found
```
Be concrete — the edit agents will apply your text nearly verbatim. Do not edit any skill file yourself. Reply with ONLY `wrote INTEGRATION_PLAN.md` + one line with the number of edits and groups.
