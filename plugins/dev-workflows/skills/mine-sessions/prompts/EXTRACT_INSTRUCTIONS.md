# Extraction task: mine one chunk of Claude Code session digests for skill candidates

You are one of N analysts. Each of you reads ONE chunk file of distilled Claude Code session transcripts belonging to the user.

> **<CONTEXT>** (the orchestrator fills this in once per run: who the user is, which repos/stack they mostly work in, which product area, and any vocabulary an outsider would not know.)
 The goal of the whole project: discover **recurring workflows, runbooks, and hard-won know-how that should be turned into reusable Claude Code skills** (SKILL.md files = slash commands that give Claude a proven procedure + domain knowledge).

## Inputs (read these and NOTHING else — do not open raw ~/.claude JSONL files, do not browse the user's repos)
1. `EXISTING_SKILLS.md` in the work dir (`<workdir>`) — skills/commands that already exist. Never propose one of these as new; DO record evidence that one of them fell short or was worked around.
2. Your chunk: `chunks/<NN>.md`. It contains one or more session digests (marked `<!-- ===== DIGEST: ... ===== -->`). Digest format: header (title, dates, branches, tool counts), then `### [HH:MM] USER` prompts, `**ASSISTANT:**` text (truncated), `→` one-line tool calls, `✗` tool errors. `[task-notification]` = a subagent finished. A `[part i/N]` digest is a slice of a long session; other analysts read the other parts — analyze what you see and note it's partial.

Read the chunk file in full (use Read with offset/limit in several calls if it's long; it may be ~4-6k lines). Don't skim the first half and extrapolate.

## What to extract — be concrete, evidence-based, cite sessions
Think like someone deciding "if the user had a `/something` command, which turns in this chunk would have been one command instead of 20 minutes of back-and-forth?" Also think "what did Claude have to rediscover here that a skill could have pre-loaded?"

Look for:
- **Workflows**: multi-step procedures actually performed (investigations, QA/verification loops, data fixes via prod console, debugging a rendering problem, setting up envs, reviewing PRs a particular way, answering a chat/ticket ask by tracing code, writing announcements, etc.). Record the *actual* step sequence with the concrete commands/tools/paths used, not a generic description.
- **Repeated patterns within the chunk**: same kind of task done more than once, same command shapes, same files/services touched, same verification ritual.
- **User corrections & preferences**: places the user redirected Claude ("no, do X", "always Y", "don't Z", "I prefer…", "next time…"). Quote them. Derive the generalizable rule.
- **Explicit automation wishes**: any place the user says something like "can you make a skill/command for this", "remember this", "we do this a lot", "this is annoying".
- **Domain knowledge Claude had to discover**: non-obvious facts about the codebase/business that a skill could pre-load (e.g. "the dev server must listen on a fixed port", "the admin page that does X", "how the renderer is invoked locally", "how to find a feature flag"). Include the fact and where it lives.
- **Gotchas / failure→fix pairs**: tool errors, wrong first attempts, and what fixed them.
- **Existing-skill feedback**: when an existing skill/command was used, did it work? Was it bypassed or supplemented manually?
- **Tools & integrations used**: MCP servers (chat, tracker, docs, design, browser automation, error tracker, logs, database…), CLIs (`gh`, the dev-server command, the test runner, a production console…), with their purpose.

Skip: generic coding (edit file, run tests) unless it's part of a distinctive repeatable ritual; anything already fully covered by an existing skill; pure chit-chat; `/model` switches.

## Output
Write ONE file: `reports/<NN>.json` (same NN as your chunk; create the `reports/` dir under `<workdir>` if needed) with exactly this shape:

```json
{
  "chunk": "NN.md",
  "sessions": [
    {"id": "<project>__xxxxxxxx [part 1/4]", "title": "...", "date": "YYYY-MM-DD", "summary": "2-3 sentences: what the session was about and what got done", "task_types": ["bug-investigation", "feature-impl", "data-migration", "code-review", "qa-verification", "support-question", "env-setup", "writing", "..."]}
  ],
  "workflows": [
    {
      "name": "short kebab-case name",
      "goal": "what the user was trying to accomplish (1 sentence)",
      "trigger_examples": ["near-verbatim ways the user asked for it"],
      "steps": ["concrete ordered steps as actually performed, with real commands/tools/paths/services"],
      "tools": ["production console", "chat MCP read-thread", "browser automation", "..."],
      "domain_facts_needed": ["non-obvious facts the procedure depends on"],
      "gotchas": ["what went wrong / had to be retried / learned"],
      "occurrences": [{"session": "<project>__xxxx", "time": "HH:MM", "note": "..."}],
      "existing_skill_overlap": "none | <skill name>: how it overlaps and how it fell short",
      "skill_worthiness": 1,
      "worthiness_reason": "1-5 where 5 = clearly recurring + multi-step + needs know-how Claude lacked; explain"
    }
  ],
  "user_corrections": [
    {"session": "...", "time": "HH:MM", "quote": "what the user said", "context": "what Claude had done", "rule": "generalizable rule"}
  ],
  "automation_wishes": [{"session": "...", "time": "HH:MM", "quote": "..."}],
  "domain_knowledge": [{"topic": "...", "fact": "...", "where": "file/service/URL if known", "session": "..."}],
  "gotchas": [{"symptom": "...", "cause": "...", "fix": "...", "session": "..."}],
  "existing_skill_feedback": [{"skill": "...", "session": "...", "observation": "worked / bypassed / fell short because ..."}],
  "tools_used": [{"tool": "...", "purpose": "...", "count_estimate": 0}]
}
```

Rules:
- Every workflow, correction, and fact must cite at least one session id (+ time when possible). No invented content. If the chunk is thin, return short arrays — that's fine.
- Prefer 4–10 well-evidenced workflows over 25 vague ones. Merge near-duplicates within your chunk.
- Steps must be reproducible by a future Claude: include actual command shapes (the exact CLI invocations, `gh pr view …`-style queries, URLs, API/operation names, class or function names) as they appear in the digest.
- Valid JSON only (no trailing commas, no comments). Write it with the Write tool.

When done, reply with ONLY 3 lines: `wrote reports/NN.json`, `N workflows / M corrections / K domain facts`, and the single most skill-worthy workflow name. Nothing else — your reply is not shown to the user, only your file matters.
