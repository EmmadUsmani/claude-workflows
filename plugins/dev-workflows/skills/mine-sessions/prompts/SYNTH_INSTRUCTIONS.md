# Synthesis task: turn the per-chunk extraction reports into a ranked skill-candidate portfolio

Context: the user had a batch of Claude Code sessions distilled and mined by analyst agents (the orchestrator may add a line here on who the user is and what they work on). Each analyst read one ~55K-token chunk and wrote `reports/NN.json` (schema: sessions, workflows, user_corrections, automation_wishes, domain_knowledge, gotchas, existing_skill_feedback, tools_used). Long sessions were split across several chunks, so the same workflow often appears in several reports under slightly different names — your main job is to **merge across reports** and rank.

Deliverable: skills the user should add to their plugin — or, when clearly team-wide, to a team plugin. A skill = a SKILL.md slash command giving Claude a proven procedure plus the domain facts and gotchas it would otherwise rediscover.

## Inputs
- `EXISTING_SKILLS.md` — what already exists. Never propose a duplicate; propose *improvements* to existing skills separately.
- `views/cluster_G*.md` — the cluster documents, each already merging 5–7 reports (dedup within group, canonical procedures, evidence counts, rules, reference notes). Read all of them fully. The same cluster often appears in several of them under different names — merging *across* them is your main job; when you merge, sum distinct sessions (a session id may appear in more than one group because long sessions were split — count it once).
- Drill-down when needed: `reports/NN.json` (the raw per-chunk reports; `chunk`→`sessions` tells you which sessions each covers) and `digests/<session>.md` (the distilled transcripts; Grep for a `[HH:MM]` timestamp cited by a report). Use these to verify the exact commands/URLs for your top candidates' step outlines and to resolve conflicts — verify the top ~8 candidates' procedures against at least one digest each.

## Method
1. Cluster workflows across all reports by underlying goal (not by name). A cluster's evidence = union of its occurrences (distinct sessions count more than repeated turns in one session).
2. For each cluster decide: **new skill**, **fold into existing skill X**, **belongs in AGENTS.md as a convention (not a skill)**, or **drop** (one-off, or generic coding).
3. Score each new-skill candidate 1–5 on: recurrence (distinct sessions), leverage (turns/time it would have saved; know-how Claude lacked), and codifiability (can the procedure be written down and stay true). Be honest — a strong portfolio is 6–12 real skills, not 30.
4. Mine `user_corrections` for durable rules. Assign each rule to: a specific skill's "rules" section, a cross-cutting personal rule (candidate for a personal CLAUDE.md / plugin-level guidance), or AGENTS.md.
5. Collect `domain_knowledge` + `gotchas` under the skill they'd power. Facts that power no skill but are valuable → "reference notes" bucket.
6. Note conflicts between reports and how you resolved them.

## Output
Write `SYNTHESIS.md` in the work dir (`<workdir>`) with these sections:

### A. Ranked new-skill candidates
For each (best first): name (kebab-case), one-line description (as it would appear in SKILL.md frontmatter — must say *when to use*), scope (personal plugin vs team plugin vs project-level, with reason), evidence (distinct sessions + example trigger quotes, cite `session` ids), score (recurrence/leverage/codifiability), a draft **step outline** (concrete, with the real commands/tools/URLs/service names the reports captured), **domain facts to embed**, **gotchas to embed**, **rules from corrections**, and open questions the skill author must verify against the repo.

### B. Improvements to existing skills
Per existing skill: what evidence shows it fell short / was bypassed, and the concrete change.

### C. Conventions (not skills)
Durable rules from corrections that belong in AGENTS.md or a personal preferences file, each with the citing quote.

### D. Reference notes
Valuable domain facts that don't attach to a skill.

### E. Dropped clusters (one line each, why).

### F. Coverage & confidence
Which reports were thin/missing, where evidence is single-session, what you could not resolve.

Write with the Write tool. Keep it dense — target 1,200–2,500 lines is fine; do not pad. When done, reply with ONLY: `wrote SYNTHESIS.md` + one line listing the top 5 candidate names.
