# Cluster task: merge one group of extraction reports into a deduplicated, evidence-weighted cluster document

Context: the user had a batch of Claude Code sessions distilled and mined by analyst agents (the orchestrator may add a line here on who the user is and what they work on), each writing `reports/NN.json` for one ~55K-token chunk. Long sessions were split across chunks, so the same workflow appears in several reports under different names. You are one of several cluster agents; each gets a group of 5–7 reports rendered as markdown (`views/G<n>.md`). A final synthesizer will merge the cluster documents into a ranked skill portfolio — your output is its input, so **precision and evidence matter more than prose**.

End goal (for orientation): new SKILL.md slash commands for the user's plugin (personal or team-shared), plus improvements to existing skills and durable conventions. A skill = a proven multi-step procedure + the domain facts/gotchas Claude would otherwise rediscover.

## Inputs
1. `EXISTING_SKILLS.md` — what already exists. Do not propose duplicates; record shortfalls/bypasses as "existing-skill feedback".
2. `views/G<n>.md` — your group. Read it fully (Read with offset/limit until the end; ~4–6k lines).
3. Optional, sparingly: `digests/<session>.md` to verify a claim or recover exact commands when two reports conflict (Grep for the `[HH:MM]` timestamp cited).

## Method
1. **Cluster workflows by underlying goal**, not by name. E.g. `pr-ci-bot-triage-loop`, `watch-pr-comments`, `triage-bot-review-findings`, `watch-pr-and-respond-with-evidence` are one cluster. Keep genuinely different procedures separate even if they share a tool (a *production read-only investigation* is not the same as a *production data fix with dry-run*; a *rebase after squash-merge* is not the same as *splitting one branch into a stack*).
2. For each cluster, compute evidence = set of **distinct sessions** (ignore `[part i/N]` — parts of one session are one session) and the total occurrences. Recurrence across distinct sessions is the primary signal.
3. Merge steps into one **canonical procedure**: the union of concrete steps, ordered, keeping the real command shapes, service/class names, URLs, MCP tool names. Where reports disagree, note both variants.
4. Attach to each cluster: the domain facts it depends on, the gotchas (symptom ⇐ cause ⇒ fix), and the user-correction rules that constrain it.
5. Corrections that don't attach to any workflow → "cross-cutting rules" (working-style preferences: how the user wants Claude to communicate, verify, stage, ask, etc.). Quote each.
6. Domain facts that power no workflow → "reference notes", grouped by topic.
7. Rate each cluster: recurrence (distinct sessions), leverage (how much back-and-forth / rediscovery a skill would remove; did Claude get it wrong first?), codifiability (can it be written as stable steps). Recommend: NEW SKILL / FOLD INTO <existing skill> / CONVENTION (AGENTS.md or personal rules) / DROP. Be honest; most clusters are not skills.

## Output
Write `views/cluster_G<n>.md` (Write tool). Target 25–45KB; dense, no filler. Structure:

```
# Cluster document G<n> — reports NN, NN, …
## 0. Sessions covered  (one line each: id — title — date — what it was)
## 1. Workflow clusters (ordered by recurrence × leverage)
### <cluster-name>
- recommendation: NEW SKILL | FOLD INTO <skill> | CONVENTION | DROP — one-line reason
- evidence: N distinct sessions [ids], M occurrences; example triggers: “…” “…”
- scores: recurrence x/5, leverage x/5, codifiability x/5
- canonical procedure: (numbered, concrete)
- variants / conflicts:
- domain facts it depends on:
- gotchas:
- rules from corrections:
- source workflow names merged: [names from the reports]
## 2. Cross-cutting rules from corrections  (quote — rule — sessions; group similar ones; count how many sessions each rule shows up in)
## 3. Automation wishes (verbatim quotes with session)
## 4. Existing-skill feedback (per skill)
## 5. Reference notes (domain facts by topic, deduplicated, with where-it-lives)
## 6. Notes for the synthesizer (thin evidence, conflicts, things you could not resolve, anything that looks like it continues in another group — e.g. a session split across groups)
```

When done, reply with ONLY: `wrote views/cluster_G<n>.md` and one line naming the top 3 clusters. Nothing else — only your file matters.
