---
name: mine-sessions
description: Mine past Claude Code sessions (~/.claude/projects/*/*.jsonl) for recurring workflows, corrections, and hard-won domain facts, and turn them into new SKILL.md skills or improvements to existing ones. Use for "look through my past sessions and find skills to create", "what should I turn into a skill", "meta-analysis of my Claude conversations", "re-run the skill-mining sweep since last time". Orchestrates a deterministic pre-processing step plus a map-reduce over cheap agents; the orchestrator itself should be a strong model. NOT for running the agent fan-out generally (agent-team) and NOT for writing a skill from a spec you already have.
argument-hint: "[--since YYYY-MM-DD] [--project <dir-substring>] [--pilot] [--out <skills dir>]"
---

# Mine past sessions for skills

A deterministic pre-processing step plus a four-stage agent map-reduce. A full sweep over a few
dozen long sessions takes hours of wall-clock and millions of agent tokens (budget accordingly,
and tell the user the rough cost before launching the fleet); it yields new skills, edits to
existing ones, and a conventions file. Scripts and prompts
live in this skill's base directory (printed when the skill loads): `scripts/{distill,chunk,render,aggregate,userturns,xref}.py`
and `prompts/*_INSTRUCTIONS.md`. The scripts are internal tooling (Python, stdlib only).

**Output target:** new skills go to `--out <dir>` if given, otherwise the `plugins/dev-workflows/skills/`
of this plugin's **source checkout** (or whichever skills directory the user names). Ask once if
none is clear. **Never write into the installed plugin cache.** When the skill is loaded from an
installed plugin, its base directory is under `~/.claude/plugins/cache/…`, and anything written
there is silently lost on the next plugin update. If the resolved target path contains
`/.claude/plugins/cache/`, refuse it and ask for the source checkout path instead. `<workdir>` below is a scratch directory (use the session scratchpad) that holds
`digests/ chunks/ reports/ views/ skill_notes/` and the instruction copies.

## Hard rules

- **You are the orchestrator; agents do the reading.** Never read raw `.jsonl` or a full digest
  yourself — 1 KB of transcript per ~4 tokens adds up to millions. Read only summaries, plans,
  one sample report for QA, and the final synthesis. The general orchestration discipline —
  briefing, the mandated report format, "idle is not done is not reported", reviving with
  `SendMessage` rather than respawning — is **agent-team**. This skill is that pattern
  specialized for transcript mining: read-only agents, no worktrees, no repo writes until step 7.
- **Transcripts are private data.** They hold company names, emails, ids, tokens and pasted logs.
  Never paste raw transcript text into a skill, a commit message or a chat post. Everything that
  leaves the scratch dir is paraphrased and scrubbed (see the PII rule below).
- **Model policy: strong models for the judgment stages.** Before the first spawn, check the
  user's CLAUDE.md for a model they never want used for agents and honor it. Cheaper model (e.g. Sonnet) for
  extraction (grunt reading), the strongest available for clustering, synthesis and skill authoring.
  Agent calls get a short prompt that points at the instruction file — don't paste instructions
  into 30 prompts.
- **Pilot before the fleet.** (`--pilot` runs only this stage: do steps 0–3 with 3–4 chunks, show
  the one sample report, and stop for the user's go-ahead before launching the rest.) Run 3–4 extractors on diverse chunks, read one report, fix the
  prompt, then launch the rest. A bad extraction prompt is paid for once per chunk.
- **Respect the concurrency cap** (check the harness's current limit; about 20 concurrent subagents is typical). Launch in waves; an
  over-cap launch errors and must be re-issued when a slot frees. A killed agent can be resumed
  with `SendMessage` to its id ("continue exactly where you left off") — cheaper than restarting.
- **The scratchpad is ephemeral.** Copy `SYNTHESIS.md`, cluster docs, `skill_notes/` and
  `proposed-*.md` to a durable place before the session ends (`<sandbox_dir>/tickets/skill-mining/<date>/`
  if that setting is set and is a git repo — committing per **sandbox-tool**'s rule when
  `<sandbox_autocommit>` is on — otherwise a dated folder under `<notes_dir>`).
- **No PII or customer identifiers in a skill.** Scan the output before calling it done:
  `grep -rnoE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'`, an email regex, and
  the 8-hex session-id prefixes the digests use (`<project>__<8 hex>`). Local dev-seed logins
  are fine.
- **Commit the new skill files by default once QA passes; never push or open the PR
  unprompted.** Commit on a branch (never the default branch), staged precisely
  (`git add <the files you wrote>`, never `-A`/`-u`); leave them uncommitted only when the user
  says so, and say plainly what is committed versus not. Pushing waits — the user reviews 10+ new
  files first.

## 0. Inventory and the incremental window (you, ~5 min)

**Start from the last run, not from the beginning of history.** The previous sweep's date lives in
one durable state file, one line `YYYY-MM-DD`:

- `<sandbox_dir>/tickets/skill-mining/LAST_RUN` if `<sandbox_dir>` is set and exists;
- otherwise `~/.local/state/mine-sessions/LAST_RUN`.

Never keep it in `<workdir>` (the ephemeral scratchpad) and never inside the skills directory it
helps produce (per-user state is not skill content). Read it at the start and pass it as
`--since`; only sessions with activity on/after that date are mined. Missing file = first run =
full sweep (ask the user if they want a narrower window). An explicit `--since` argument wins.
**At the end of a successful run (after QA, step 8), write today's date back to the same file**
(and commit it with the durable analysis copy when it lives in the sandbox repo).

```bash
STATE=<sandbox_dir>/tickets/skill-mining/LAST_RUN   # or ~/.local/state/mine-sessions/LAST_RUN
SINCE=$(cat "$STATE" 2>/dev/null || echo 1970-01-01)
for d in ~/.claude/projects/*/; do echo "$(find "$d" -maxdepth 1 -name '*.jsonl' -newermt "$SINCE" | wc -l) sessions since $SINCE  $d"; done
```
(Against a fixture, point the loop at the fixture root instead of `~/.claude/projects`, as
`distill.py --projects-dir` does.)
A small incremental window (fewer than ~8 sessions) usually doesn't justify the full five-stage
pipeline: distill, run extractors, and go straight to authoring/updating skills from the reports.
With a single report there is nothing to cluster or synthesize — skip steps 5–6 and author from
the report directly (steps 7–8 still apply in full).
Session subdirs (`<id>/subagents/`, `<id>/tool-results/`) are subagent transcripts — skip them;
the main thread has each Agent prompt and the assistant's summary of the result.

Write `<workdir>/EXISTING_SKILLS.md`: every skill/command that already exists, so analysts don't
re-propose them. Sources: `ls ~/.claude/plugins/cache/*/*/*/skills`, each project's
`.claude/skills` and `.claude/commands`, hooks in `.claude/settings.json`, and the built-in skills
listed in the system prompt.

## 1. Distill (deterministic, seconds)

```bash
python3 <skill>/scripts/distill.py <workdir>/digests --since "$SINCE"     # add --project <substring> to scope
```
`--projects-dir <path>` points it at a copied archive or a test fixture instead of
`~/.claude/projects`. Keeps: metadata (titles, dates, branches, tool counts), every real user
prompt (3 000 chars), assistant text (1 100), one-line tool calls (`Bash` 180 chars, collapsed
read-only runs), tool errors, slash commands. Drops thinking, tool results, hook noise,
snapshots. Expect roughly **two orders of magnitude smaller**. Prints a per-session table — the `custom title` column is the
fastest triage. Read one small digest (Read, `limit: 120`) to confirm the format is clean before
spending agents.

## 2. Chunk (deterministic)

```bash
python3 <skill>/scripts/chunk.py <workdir>/digests <workdir>/chunks 230000
```
~225 KB ≈ 55 K tokens per chunk: long sessions split at user-turn boundaries with a
`PART i/N` banner, small ones (including very short sessions, which can hold the one correction
that matters) bin-packed together. Only sessions with zero user prompts are dropped, with a
warning on stderr. `chunks/plan.json` records which sessions
landed where — you need it for step 4.

### Targeted lenses: the user-turns view

When mining for one specific thing the user *said* (code-style preferences, communication
preferences, review habits) rather than for workflows, don't feed agents the full digests:

```bash
python3 <skill>/scripts/userturns.py <workdir>/digests <workdir>/userturns --context 500
python3 <skill>/scripts/chunk.py <workdir>/userturns <workdir>/ut_chunks 180000
```
Keeps every USER turn in full plus a 500-char tail of what Claude had just said; drops tool
traces. ~10× smaller, so a handful of extractors instead of dozens. Write a lens-specific
extraction prompt — `prompts/CODESTYLE_EXTRACT_INSTRUCTIONS.md` and
`prompts/CODESTYLE_AUTHOR_INSTRUCTIONS.md` are a worked example (schema: principle / theme /
verbatim quote / context / preferred shape / before-after example / strength) that produces a
**code-style** skill from corrections.

## 3. Extract (cheaper model, one agent per chunk; each reads a whole chunk, so budget ~tens of K tokens per chunk)

Prompt (identical for every chunk, `subagent_type: general-purpose`, a cheaper model):
> Work dir: <path>. First Read `EXTRACT_INSTRUCTIONS.md` and `EXISTING_SKILLS.md` and follow
> them exactly. Your chunk is `chunks/NN.md` → write `reports/NN.json`. Read the whole chunk file
> (use Read with offset/limit repeatedly until you reach the end).

Copy `prompts/*_INSTRUCTIONS.md` into `<workdir>` first, fill in `EXTRACT_INSTRUCTIONS.md`'s one `<CONTEXT>`
paragraph, and substitute any `<setting>` placeholders (e.g. `<sandbox_dir>`) with real paths — agents cannot resolve settings (who the user is, which repos, which product area). Pilot 4 chunks (one giant single
session, one `[part i/N]`, two multi-session batches), then:
```bash
python3 <skill>/scripts/aggregate.py --dir <workdir> --expect <N chunks>   # validates JSON, lists missing reports
python3 <skill>/scripts/aggregate.py --dir <workdir> --names               # workflow-name distribution — themes show up here
```
Read one report's `workflows[].steps` and `user_corrections` before launching the rest: steps must
carry real command shapes and session citations, not paraphrase.

## 4. Merge and render (deterministic)

```bash
python3 <skill>/scripts/aggregate.py --dir <workdir> --merge      # → ALL_REPORTS.json (too big for one agent)
python3 <skill>/scripts/render.py --dir <workdir> --per-group 6   # → views/G1.md … (markdown, ~25% smaller than JSON)
# a long session split across chunks must land in ONE group — pass explicit groups instead:
python3 <skill>/scripts/render.py --dir <workdir> --groups "G1=01,04,06;G2=02,03,05"
```

## 5. Cluster (strongest model, one agent per group)

Prompt points at `CLUSTER_INSTRUCTIONS.md` and `views/G<n>.md` → `views/cluster_G<n>.md`.
Expect output well over the 25–45 KB target — the overflow is evidence, not prose; accept it.
Tell them explicitly that `[part i/N]` slices are one session.

## 6. Synthesize (strongest model, one agent)

Prompt points at `SYNTH_INSTRUCTIONS.md` and the cluster docs → `SYNTHESIS.md` (ranked
candidates with step outlines, domain facts, gotchas, correction-derived rules, open questions;
then improvements to existing skills, conventions, reference notes, dropped clusters, confidence).
Remind it: a session id appearing in several groups is one session; overlap across groups is
independent evidence. Ask for `argument-hint` + 3–5 trigger phrasings per candidate.

**Read `SYNTHESIS.md` yourself** — corpus accounting, one full candidate, the evidence/score
lines of the rest, the "what to build first" table, and the conventions. This is the decision
point: which candidates become skills, which fold into existing skills, which are conventions.

## 7. Author (strongest model, one agent per skill + one maintainer for existing skills)

Prompt points at `SKILL_AUTHOR_INSTRUCTIONS.md`, names the skill, its `SYNTHESIS.md` section,
the target dir, and the sibling skills being written in parallel (so they cross-link by name).
Authors must **verify every cited artifact read-only against the repo** and mark the rest
`(verify)` — in practice this corrects several stale synthesis claims (renamed constants,
non-existent flags, changed admin params). Every authored skill ends in a **"When not to use /
hand off"** table that names the sibling skills it should route to, and every code-producing
skill names **code-style** as its self-review gate. Tell each author which siblings exist
(`EXISTING_SKILLS.md`) and require reciprocal links: if A routes to B, B's table gets the
reverse row. Each writes `skill_notes/<name>.md` for you. The maintainer applies the
"improvements to existing skills" section as surgical `Edit`s. Conventions (working-style rules)
go in a user-level `CLAUDE.md` snippet — a plugin-root `CLAUDE.md` is **not loaded**
(`claude plugin validate` warns about it).

## 8. QA (you)

```bash
claude plugin validate plugins/<plugin>
wc -l plugins/<plugin>/skills/*/SKILL.md          # 120–350 each; long tail → REFERENCE.md
grep -rc "(verify)" plugins/<plugin>/skills        # honest unknowns, fine to ship
```
Check cross-links resolve (every `/name` mentioned exists), scan for PII/session ids, skim each
`skill_notes/*.md` for "could not verify / conflict / left out", regenerate any README skill
table, and bump the plugin version. Copy the analysis outputs somewhere durable (see the
scratchpad rule), **write today's date to the `LAST_RUN` state file (step 0)**, and report to the user: what was built, scope suggestions (personal vs team),
the unresolved conflicts, the new `LAST_RUN` date, and what is committed versus
explicitly left uncommitted.

Check the graph, not just the links:
```bash
python3 <skill>/scripts/xref.py plugins/<plugin>/skills     # in/out-link table, orphans, dangling names
```
Flag any skill with **zero in-links** (it will never be reached from another skill) and any
one-directional pair. A skill nothing routes into is a skill that will not be used. The
"possibly dangling" list is a heuristic — ordinary hyphenated words are
false positives. Pass `--external a,b,c` for legitimate targets that live outside the directory.

## 9. Composition audit (after a batch of new skills lands)

New skills arrive as islands; the value is in how they compose. Run this pass whenever ≥3 skills
were added or a skill's role changed (a typical pass is one mapper, a handful of group editors and one reconciler). Prompts: `prompts/AUDIT_INSTRUCTIONS.md`,
`prompts/APPLY_INSTRUCTIONS.md`, `prompts/RECONCILE_INSTRUCTIONS.md`.

1. **Map** (one strong agent, reads every SKILL.md): current graph, duplicated procedures, the
   cross-cutting gates every skill should carry (the gates your plugin set defines, if
   present — e.g. a code-style self-review before any diff; verify-in-app for user-visible
   changes; pr-triage after every PR; production reads through the warehouse first and writes only
   through prod-script; worktree/dev-doctor pointers; research-doc/visual-explainer artifact
   offers; agent-team for multi-part work; the propose → wait → act posture) with **canonical wording** so every skill phrases each gate
   identically, a per-skill edit list, and edit groups with **one owner per file**. Decide the
   contradictions it surfaces yourself before launching editors.
2. **Apply** (one editor per group, strongest model for substantive steps / cheaper for
   cross-link-only groups, all in parallel): surgical `Edit`s; delegation stubs keep 3–6 lines of
   the decisions that matter, then point at the owner; routing tables updated; deviations recorded.
3. **Reconcile** (one strong agent, after every editor finishes — never concurrent): every
   "X Phase N / §Y / `--flag` / mode" reference must match the target's current headings and
   argument-hint; delegation stubs must not contradict their owner (owner wins); required routing
   pairs resolve in one hop both ways; one autonomy vocabulary
   (`--report-only | --approval-gated | --autonomous`). Editors introduce real defects here, including files
   asserting a flag the owner says does something else.
4. Re-run `xref.py` and §8; bump the plugin version; commit (precise staging) if asked; report
   what changed and anything explicitly left uncommitted.

## Verified gotchas

- `stat -f %z` fails inside a `for` over globbed paths on macOS when a filename contains
  spaces — use `wc -c <` or Python for byte counts.
- An `ai-title` line is emitted per compaction; `custom-title` is the user's name for the
  session and is the better label.
- Assistant `text` blocks after compaction can be a 1-line "compaction summary" — the distiller
  keeps `type: summary` entries as `> (compaction summary)`.
- The same underlying work often appears as two session ids (a branched conversation or a
  parallel thread) — the synthesizer should list such pairs and discount recurrence.
- Extractors that finish with "JSON is valid" in their reply did an extra self-check; those
  reports were never the broken ones. The broken ones are silent — always run `aggregate.py`.
- Test the scripts on a tiny synthetic transcript (`--projects-dir <fixture>`), never on real
  transcripts you are about to paste somewhere.

## When not to use / hand off

| Situation | Skill |
|---|---|
| Running the agent fan-out itself (briefs, waves, verification, revival) | **agent-team** |
| The shape of code inside an authored skill's examples | **code-style** |
| Publishing the analysis outputs somewhere durable | **research-doc** / `<sandbox_dir>/tickets/` (**sandbox-tool** conventions) |
| Pushing and opening the PR for the new skills | **ship-pr** — separately approved; the user reviews 10+ new files first |
