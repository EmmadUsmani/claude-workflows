# Authoring task: the `code-style` skill — the user's code-quality preferences as a working guide + self-review checklist

Read `SKILL_AUTHOR_INSTRUCTIONS.md` first (voice, frontmatter, verification and review-note rules). Then the evidence:

1. `reports/codestyle_*.json` — preferences mined from every user turn across the sessions (principle / theme / verbatim quote / context / preferred shape / before-after examples / strength). Read them all fully. Merge duplicates across chunks; **count how many distinct sessions support each principle** — that is the ranking signal.
2. `SYNTHESIS.md`'s code-shape and comments conventions (Grep for them), plus the `user_corrections` in `views/cluster_G*.md` §2 (Grep `code|method|abstraction|comment|imperative|declarative|model|service`).
3. The repo the orchestrator names, read-only, to ground examples. When you cite a pattern as "how this codebase does it" (scopes on models, concerns, service-object conventions, API scalar types, component dispatch), grep to confirm it exists and name a real file as the exemplar. Never modify the repo; never read `.env*`.

What the user asked for (the orchestrator pastes their words; typical): analyze past conversations for code-style preferences — good abstraction barriers, APIs and method interfaces; declarative over imperative; hiding imperative operations behind the right abstraction or domain boundary; sparse comments; respecting domain boundaries (declare logic at the domain level, e.g. the model, rather than in imperative code higher up; avoid services where the logic belongs on the model; avoid redeclaring or duplicating existing logic; prefer extending existing methods). Treat that list as the themes to organize around, but let the evidence decide the content and the emphasis — include principles the user actually corrected, with their words.

## Write `<skills dir>/code-style/SKILL.md`
- Frontmatter `description`: what it is (the user's code-shape preferences for their stack), when to load it (writing any non-trivial code in the user's repos; "review this for style", "does this follow my preferences", "clean this up", "is this idiomatic", "this feels hacky"; and as the self-review pass before presenting a diff), and what it is NOT (bug hunting → `code-review`; formatting → rubocop/eslint; process rules → the user's CLAUDE.md).
- Body shape:
  1. **Posture** (3–5 lines): apply while writing; when asked to review, report numbered findings and propose — don't edit until told (this is the strongest process rule).
  2. **Principles by theme** — abstraction barriers & API surface; domain boundaries (model vs service vs resolver vs component); declarative over imperative; one source of truth; frontend shape; comments; readability & blast radius; naming & domain language; framework/language idiom; testing. For each principle: the rule in one imperative sentence, **the user's words** (one short verbatim quote, no session ids), the smell that triggers it, and a compact **before → after** example in the user's main language (generalize names; no customer/org data; real repo class names are fine when they illustrate the codebase's own convention). Order principles within a theme by how many sessions corrected them; drop anything supported by a single ambiguous quote unless it's emphatic.
  3. **Nuances / limits** — where a rule stops (e.g. accept an occasional redundant refetch over defensive machinery; don't over-verify low-stakes changes; local one-liners can be in any language; "implement the general solution now when cheap" vs "smallest blast radius" — say how the user resolves that tension, from evidence).
  4. **Self-review checklist** — 12–20 yes/no questions a future Claude runs over its own diff before presenting it, each mapping to a principle above.
  5. **Hand-offs**: `code-review` (bugs), `deep-pr-review` (someone else's PR), `pr-triage` (bot findings), `research-doc` (design doc before code).
- Length 200–350 lines; if the before/after examples push past that, move the long-tail examples to `REFERENCE.md` and keep one example per theme in SKILL.md.
- Write `<workdir>/skill_notes/code-style.md`: which principles have how many sessions of support, which repo exemplars you verified, judgment calls, anything left out.

Reply with ONLY the paths you wrote.
