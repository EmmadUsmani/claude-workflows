# Extraction task (code-style lens): mine one chunk of user turns for the user's code-quality preferences

You are one of several analysts. Each reads ONE chunk of **user turns** from the user's Claude Code sessions.

> **<CONTEXT>** (the orchestrator fills this in once: the user's stack, repos and domain.)

Each turn shows a short tail of what Claude had just said, then the user's message. The goal of the whole project: write a `code-style` skill that captures **how the user wants code shaped** — so Claude writes it that way the first time and can self-review a diff against it.

## What counts
Any place the user reacts to the *shape* of code (their own or Claude's) — approving or, far more often, correcting. Signals: "I don't like…", "why not just…", "this feels hacky / too imperative / too programmatic / obtuse", "can we instead…", "extend the existing…", "that belongs in the model", "remove this comment", "make it declarative", "abstraction barrier", "too clever", "simpler", "is it idiomatic to…", approvals like "yes exactly", "much better", "I like this approach because…".

Themes to look for (do not force-fit; record what's actually there):
- **Abstraction barriers / API surface**: export the decision not the ingredients; collapse an API to what is consumed; one method that encapsulates a precedence/hierarchy instead of callers re-deriving it; method interfaces (params, return shapes, naming).
- **Domain boundaries**: logic declared at the domain level (model / concern / value object) vs imperative code higher up (services, controllers, jobs, API resolvers, UI components); when a service is warranted vs when it's a smell; avoid re-declaring or duplicating existing logic — extend the existing method/abstraction instead of a parallel one; fix the shared method rather than bypass it.
- **Declarative over imperative**: hiding imperative operations behind the right method; scopes/associations/callbacks vs manual loops; `.each + next` patterns; early returns; "assign what you need at the end".
- **One source of truth**: always-correct source over fallback chains; derive from constants/config, not magic numbers; don't add a second cache/flag/mechanism when one exists.
- **Frontend shape**: component-per-variant + thin dispatcher vs generic branching components; templates render pre-computed values; no redundant state for derivable values; hooks/refs bookkeeping; API typing (e.g. a JSON scalar vs ad-hoc strings); colocated helpers.
- **Comments**: sparse; short; reserved for non-obvious logic; no narrating the obvious; no dev-history comments; reasoning goes in PR/thread not code.
- **Readability & size**: readable over one-liners; smallest blast radius; simplest thing that meets the literal ask; general solution *now* when cheap; no defensive machinery for cases that can't occur; no speculative flexibility.
- **Naming & domain language**: domain-agnostic names where the concept is generic; consistent terminology; disambiguate colliding class names.
- **Framework/language idiom**: where query logic lives (model scopes vs inline queries in callers), presenters/delegators, callbacks vs explicit calls, `rescue` scope, migration/schema conventions, specs (what to assert, shared fixtures, stubbing internal surfaces).
- **Testing preferences**: what a spec should pin (property vs symptom), when to add a spec, mutation-testing your fix.
- **Data/queries**: N+1s, preloading, deriving in SQL vs Ruby, cache keys.

## Inputs (read these and nothing else)
- Your chunk: `ut_chunks/<NN>.md` — read it fully (Read with offset/limit until the end).
- Optional, sparingly: `digests/<session>.md` to recover the code Claude had written when a correction is otherwise unintelligible (Grep for the `[HH:MM]` timestamp) — only when the before/after code would make a great example.

## Output — write `reports/codestyle_<NN>.json` (valid JSON, Write tool)
```json
{
  "chunk": "NN.md",
  "preferences": [
    {
      "principle": "one sentence, imperative, general (e.g. 'Expose one method that encodes the precedence hierarchy; callers must not re-derive it')",
      "theme": "abstraction | domain-boundary | declarative | single-source | frontend | comments | readability | naming | lang-idiom | testing | data | other",
      "quote": "the user's words, verbatim (trim to the relevant sentence(s))",
      "context": "what Claude had done / what code shape triggered it (1-2 sentences; include class/method names if present)",
      "preferred_shape": "what the user wanted instead, concretely (method names, where the logic should live, the shape of the call site)",
      "example_before": "short code or pseudo-code of the rejected shape, if recoverable, else null",
      "example_after": "short code or pseudo-code of the accepted shape, if recoverable, else null",
      "strength": "correction | strong-correction (repeated / emphatic / capitalized) | approval | nuance (a limit on another rule)",
      "session": "<project>__xxxxxxxx", "time": "HH:MM"
    }
  ],
  "approvals": [{"quote": "...", "what_was_good": "...", "session": "...", "time": "..."}],
  "nuances": [{"rule": "...", "limit": "when it does NOT apply, in the user's words", "session": "...", "time": "..."}],
  "non_code_notes": "1-3 sentences on anything strong you saw that is about process rather than code shape (already covered elsewhere; just flag it)"
}
```
Rules: quote verbatim; every entry cites session+time; prefer 8–25 well-evidenced preferences per chunk over 60 vague ones; one entry per distinct correction (a repeated correction within the chunk → one entry, note "repeated ×N" in context). Skip pure process corrections ("don't commit", "don't code yet") unless they carry a code-shape point. When done reply with ONLY: `wrote reports/codestyle_NN.json` and `N preferences / M approvals / K nuances`.
