# Apply task: implement your group's section of INTEGRATION_PLAN.md as surgical edits

You own a GROUP of skills (named in your prompt) under the skills directory the orchestrator names (`<skills dir>/<skill>/`). Other agents own the other skills concurrently — **edit only the files in your group** (SKILL.md and, if it exists, REFERENCE.md). Never create new skills. Never touch a skill the orchestrator says is being rewritten separately, any application repo, or `<sandbox_dir>`. Do not commit — editors share one checkout; the orchestrator commits once reconcile passes.

## Inputs
1. `INTEGRATION_PLAN.md` in `<workdir>`: read §1 (cross-cutting patterns and their canonical wording) and §2 for each skill in your group, plus §4 (open questions) to see whether any affect your files.
2. Each skill's current SKILL.md in full before editing it.
3. The sibling skills you will reference — open the target skill's frontmatter (and the phase you point at) so the reference is accurate: name the right mode/argument/phase, not a guess. Sibling skill names: the directory listing of `<skills dir>` (the orchestrator pastes it). External targets you may reference but not edit: any team/project skills the orchestrator lists, and built-ins such as `code-review`, `simplify`, `security-review`, `artifact-design`, `artifact-diagramming`, `update-config`.

## Rules
- **Surgical `Edit`s, not rewrites.** Preserve each skill's voice, structure, and hard rules. Insert the plan's proposed text where it says, adapting a phrase or two so it reads naturally in place; do not pad.
- Use the plan's **canonical wording** for the cross-cutting passes (the code-style self-review pass, the verify-in-app step, the pr-triage hand-off, the production-data routing (warehouse-data first, then the `<ops_bot>` if there is one, prod-script last; writes via prod-script `repair`), the worktree/dev-doctor pointers) so every skill phrases them the same way. When replacing a compressed duplicate of another skill's procedure with a delegation, keep a 3–6 line summary so the skill still reads standalone, then point to `/X` for the full procedure.
- Update the skill's "When not to use / hand off" section to the plan's routing table for that skill (add missing hand-offs; keep existing correct ones).
- If the plan's edit is wrong for the actual file (section doesn't exist, contradicts a hard rule, target skill's mode name differs), fix the reference rather than inserting something inaccurate, and record the deviation in your notes.
- Frontmatter: if the plan adds a hand-off that changes what the skill is NOT for, update the `description`'s NOT clause too — keep descriptions to 1–3 sentences plus triggers.
- Keep SKILL.md files under ~400 lines; if an edit would push over, move long-tail material to REFERENCE.md.
- No session ids, no PII, no customer names.

## Output
Apply the edits, then write `<workdir>/skill_notes/apply_<group>.md` (≤40 lines): per skill, what you changed (section → one line each), any plan items you deviated from or skipped and why. Reply with ONLY the list of files you edited.
