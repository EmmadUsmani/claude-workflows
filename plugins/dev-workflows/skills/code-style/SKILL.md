---
name: code-style
description: The user's code-shape preferences — abstraction barriers, domain boundaries, declarative over imperative, one source of truth, sparse comments — with stack-tagged sections (any language, Rails, React, GraphQL, libraries/public APIs) so a review knows which apply. Load it while writing any non-trivial change, when asked "review this for style", "does this follow my preferences", "clean this up", "is this idiomatic", "this feels hacky", "simplify this PR" — and always as the self-review pass before presenting a diff, and as the shape lens of every PR review. NOT for hunting correctness bugs (use `code-review`), NOT formatting (rubocop/eslint/prettier decide that), NOT process/workflow rules (those live in the personal CLAUDE.md).
---

# Code style — the user's preferences

How code should be *shaped*. If the repo has its own rulebook — `AGENTS.md` / `CLAUDE.md` /
`CONTRIBUTING.md`, root or per directory — or an **established in-file convention** (every sibling
method carries the same doc block; every module uses the same accessor idiom), that wins for
whatever it covers. This skill carries the preferences the user has corrected Claude on
repeatedly, which repo rulebooks usually don't state.

**Stack tags.** Every section is tagged: **[any]** applies everywhere; **[Rails]**, **[React]**,
**[GraphQL]** apply when the diff is in that stack; **[library]** applies when the code ships a
public API to other people's code (a gem, an npm package, a framework). A JS library review runs
the [any] and [library] sections and skips the rest. Examples use small neutral apps — a blog, a
task tracker, a notification service, a feed reader, an HTTP client — and the quoted lines are
typical corrections, paraphrased.

## Posture [any]

- Apply these while writing. Don't ship a diff you haven't run the checklist over.
- **When asked to review, review — don't edit.** Report numbered findings with file:line and a
  proposed shape, then stop. This is the most-repeated correction across sessions:
  *"Consider this and let me know what you think — DO NOT CHANGE CODE YET."*
  A question ("does this make sense?", "why not X?") is a request for analysis, not a patch.
  This is the plugin-wide default (propose → wait → act), not a code-style quirk.
- A question phrased as *"why not just…"* is a correction with a question mark. Answer it
  honestly — if the simpler shape is right, say so and propose it; if it isn't, say why.
- Never assert "this is the convention here" from memory. Grep first, and count:
  *"Is there a strict standard in this codebase for this? Is there precedent elsewhere?"*
  Grepping cuts both ways — what looks like reaching into internals may be the house idiom at
  a dozen call sites, and then it isn't a finding.

## When this runs

This is a **gate**, not a reference: every skill that produces code runs the checklist below before
presenting a diff.

| Caller | When |
|---|---|
| **ship-pr** §2.5 | over `git diff <base>...HEAD`, before screenshots and the PR body |
| **pr-triage** Phase 7 | over any fix you propose — and as the basis for *refuting* a bot's shape claim |
| **agent-team** §4 / §8 | in every agent's brief, and by the lead over the *combined* diff (shape defects are composition defects) |
| **stack-surgery** | over every hand-resolved conflict hunk |
| **sandbox-tool**, **prod-script**, **vendor-api-probe** | over the scripts a human will run and read (Node for standalone ones; §9 for app-runtime Ruby) |
| **dev-doctor**, **render-pipeline-debug** | over a repair before proposing it |
| **deep-pr-review** §6 | as the rubric for shape findings on any PR, and as the self-review picklist |
| **research-doc** (design mode) | the proposed design must land on shapes from §1–§5 |
| **bug-intake** Phase 5 | over the root-cause fix, before it goes to `verify-in-app` and `ship-pr` |

`code-review` (built-in) is the correctness pass; this is the shape pass. Run both.

---

## 1. Abstraction barriers & API surface [any]

- **Export the decision, not the ingredients.** When two callers need the same precedence or
  derivation, one method owns it and both call it.
  > *"The digest job and the settings page both work out whether a user is in quiet hours, and
  > each re-implements the time-zone → quiet-window → default ordering. Export one
  > `Notifications.quiet_now?(user)` and call it from both."*

  Smell: a caller reaching past the public API for an internal helper and rebuilding the ordering
  around it.

- **The interface takes domain objects, not pre-resolved arguments.** If every call site has to
  know which value maps to which internal role, the leak just moved into the call sites.
  > *"Every caller of `send_digest` now has to know where the time zone, the quiet hours and the
  > locale live. Just pass the user."*

  ```ruby
  # before — each caller digs out the pieces
  send_digest(time_zone: user.settings.time_zone || account.time_zone,
              quiet_hours: user.settings.quiet_hours,
              locale: user.locale.presence || I18n.default_locale)

  # after — the caller hands over what it already holds
  send_digest(user)
  ```

- **Collapse a multi-step sequence into one intent-named method.** The caller states *what*, the
  domain object figures out *how*.
  > *"The controller checks email opt-in, then loops over push channels, then writes the inbox row.
  > Why not one `Notifications.deliver(event, to: user)` that does all of that?"*

- **A method called from another class must not be private.** Private-but-externally-called
  (`send(:parse_header_row, …)`, or a TS `private` worked around with a cast) is itself the
  abstraction break; make it public and sit it with the other primary methods.

- **Hide an internal concept behind one call rather than exposing it to subclasses.** A base
  `Importer` keeps its column-mapping constant to itself; subclasses call `row_attributes(row)`
  and get a hash back.

- **Delete pass-throughs, one-line aliases and thin render-wrappers.** A hook that returns the
  setter it was handed, `def slugify(text) = Slug.slugify(text)`, or a `renderTagPill` that only
  wraps `<TagPill>` — all indirection with no barrier behind it.

## 2. Domain boundaries — model vs service vs controller/resolver vs component [any; examples Rails]

- **Declare behavior at the level that owns it; higher layers are thin delegates.** Controllers,
  GraphQL resolvers, presenters and route handlers call one domain method and branch on the result.

  ```ruby
  # before — the controller filters and reshapes the registry itself
  ExportFormats.all.select { |format| format.enabled_for?(current_user) }
                   .map { |format| { key: format.key, label: format.label } }

  # after — the domain module owns it; the controller delegates
  ExportFormats.menu_for(current_user)
  ```

- **Fix the shared method; don't bypass it.** If the corrected behavior is semantically right for
  every caller and low blast radius, change the method itself rather than setting its attribute by hand.
  > *"The bulk job sets `active = false` directly instead of calling `deactivate`. If the new
  > behavior is right for every caller — it is — change `deactivate` and call it."*

- **Behavior that must always accompany an operation belongs inside that operation.** If every
  call site does `prepare; act!`, the preparation is part of `act!`'s contract.
  > *"Every caller generates the slug and then calls `publish!`. Shouldn't `publish!` guarantee
  > the slug itself?"*

- **Don't add a service for logic with exactly one caller.** A private method on the existing job or
  model is the better design, not a shortcut. Check for external callers first, out loud.

- **Put an attribute on the entity it's actually a characteristic of**, not wherever it was
  convenient to persist — a per-locale date format belongs on `Locale`, not on the `EmailTemplate`
  that needed it first.

- **Reuse the existing lifecycle hook over a bespoke service** — `post.destroy!` plus the existing
  `after_destroy_commit :purge_cdn_cache`, not a new `DeletePostService`.

- **Query logic belongs in the model as a scope** (or the repository/query object the codebase
  already uses), not hand-built in a caller. Asked "is this idiomatic?" — grep and answer honestly,
  pointing at an in-repo model that already does it.

- **Encode a terminal state instead of rescuing the I/O it makes pointless.** A `rescue` wrapping a
  call you already know shouldn't happen is a design smell, not error handling.
  > *"We rescue the timeout when posting to a webhook endpoint the user already disabled. A disabled
  > endpoint is a valid terminal state — check it and don't make the request."*

## 3. Declarative over imperative [any]

- **No `.each` + `next` (or `for` + `continue`) accumulate-and-skip loops.** Assign the final value
  directly with `select`/`map`/`filter`/`slice`.

- **`.map` when you're deriving a new collection**; `.each`/`forEach` signals side effects.

- **Config-driven registries, not long if/else chains.** Small units with a shared interface,
  registered by key.
  > *"Code should be clean, programmatic and config-driven — no long manual if/else in one method;
  > validation should look like a registry of validators."*

  Target shape: `Validators.register(:email, EmailValidator)` + `Validators.for(:email)`, with
  `register` checking that the class implements the shared interface — enforced at registration,
  not by convention.

- **Collapse near-identical branches into one pass-through.** Don't split a failure into cases only
  to reassemble the same call.

  ```ruby
  # before — two branches that build the same error
  return error(:rate_limited, response.message) if response.error? && response.code == :rate_limited
  return error(response.code, response.message, retry_after: response.retry_after) if response.error?

  # after
  return error(response.code, response.message, retry_after: response.retry_after) if response.error?
  ```

- **A predicate that reduces to one condition is one boolean expression**, not a multi-step derivation.

- **Wrap paired imperative bookkeeping in a declarative operation.** A ref mutation and a helper call
  that always happen together become one named method on a small sub-hook or object.

## 4. One source of truth [any]

- **One always-correct source beats a fallback chain.** Fix the broken source separately.
  > *"Just use `user.time_zone`, not `(detected_browser_zone || user.time_zone)`. The profile value
  > is guaranteed; fix the browser detection in its own PR."*

- **A type has exactly one definition, imported everywhere.** A `SortOption` type redefined in three
  files gets deduped to one export.

- **Mirror the existing resolution design instead of inventing a parallel one.** If posts already
  resolve `comments_policy` as post-level override → blog-level default, a new per-post
  `reply_window` follows the same two layers.

- **Extend the existing declarative config; don't special-case one item.**
  > *"Don't special-case the Archived tab with its own branch. If it needs a new visibility key,
  > add one to the tabs config."*

- **Reuse the existing generic mechanism before adding new state.** Prefer the soft-delete the app
  already has over a new `hidden_reason` column, unless the distinction is load-bearing for behavior.

- **Derive from the source of truth, never a magic number.**
  > *"Don't hardcode `z-index: 9301` to sit above the drawer — reference the drawer's layer constant
  > so this survives the next layering change."*

- **Fix the general gap before patching the known cases.**
  > *"We keep patching individual errors. When an error *isn't* caught, what should happen? The
  > user should get a real error message, not a blank 500 page. Fix that first."*

- **A refactor of a fingerprinted or cached derivation must be provably output-identical** — an
  exhaustive sweep against `HEAD`, not just green tests. A changed cache-key input silently
  invalidates (or worse, collides) every cached entry.

## 5. Frontend shape [React] [GraphQL]

- **One component per variant + a thin dispatcher**, not one generic component branching
  internally — a blog editor gets `ImageBlock.tsx`, `QuoteBlock.tsx`, `EmbedBlock.tsx` and a
  type → component map.

- **JSX renders pre-computed values.** Lookups, guards and early returns go in the component body.

  ```tsx
  // before — lookup + guard + return inside the render tree
  {blocks.map(({ type, props }) => {
    const Component = BLOCKS[type];
    if (!Component) return null;
    return <Component {...props} />;
  })}

  // after — resolve above the return; the JSX just renders
  const renderable = blocks.filter(({ type }) => BLOCKS[type]);
  ```

- **No React state wrapping a derivable value.** `const isDraft = post?.status === "draft"`, not a
  `useState` kept in sync by an effect.

- **Single-use helpers stay colocated with their sole caller** (tests too); a helper only moves to
  `utils/` once it genuinely has multiple call sites. Check what the repo's `utils/` actually holds
  before deciding — that's precedent, not opinion.

- **Don't import a pure helper out of a hook.** If two unrelated modules need it, it's a util
  (`@/editor/utils/parseEmbedUrl`).

- **[GraphQL] Widen a wire type when a concrete near-future shape is already named** (a JSON scalar
  over `String` for a value that will be an object) — match the repo's existing idiom. This is the
  one sanctioned form of speculative flexibility.

## 6. Comments [any]

If the repo has a comments rule, a repo hook that limits comments, or an established in-file convention (e.g.
every sibling method carries the same JSDoc block), that's the rulebook. Absent one, the default: no
comment; 1–2 lines when there is one; comment lines a small fraction of added code. Additions from
the user's corrections:

- **Reasoning goes in the PR body or a review-thread reply, not in code.** *"Reply to the reviewer
  explaining why — don't put it in a comment."*
- **Delete comments that narrate what the code already shows.**
- **State real cardinality, honestly.** "Comment → post is 1:1" is wrong when a post has many
  comments; say "a comment belongs to exactly one post".
- **Frame defensive code as defensive, not as a fact about current data.** "No user has a blank
  email" → "Defensive: imported users may have a blank email."
- **Do comment a deliberate placeholder**, saying plainly that it's temporary and what replaces it.
- **Never trim comments the user is hand-writing.** Establish authorship on a co-edited file first;
  prove a comment-only edit by diffing code-only lines.

## 7. Readability & blast radius [any]

- **Readable beats terse.** *"This reads obtuse. Write it the easy-to-follow way — it's fine if
  it's not a one-liner."*
- **Simpler and imperfect beats complex and exact.** An occasional redundant refetch (the user
  re-selects the same sort order) is an acceptable price for a small diff.
- **Don't guard a provably unreachable state.** Name the invariant instead of coding around it —
  the bulk-edit toolbar only renders when a row is selected, so `selection.length === 0` can't
  happen inside it.
- **Cut speculative subsystems entirely, don't scale them back.** *"Remove it from the plan — too
  much scope and risk."*
- **Delete dead indirection**: a method whose value is discarded downstream, a redundant `= []` next
  to an `Array()` wrap, a partial that shrank to nothing, a compat branch for old URL params.
- **Don't ship stubs for adjacent unrequested features** — no placeholder RSS exporter in a PR
  about CSV export.
- **A "cleaner" rewrite that balloons the diff is the wrong call mid-PR.** *"Removing the
  `SimpleDelegator` is far too big a change. Revert to the old `__getobj__` approach for now."*
- **Never build on an unverified premise.** If the justification depends on a claim about a vendor
  API, a record, or production data, confirm it — or revert the code that rests on it.

## 8. Naming & domain language [any]

- **Name for the generic concept, not the first case.** When `TwitterEmbed` grows to cover three
  networks, rename the whole surface — `SocialEmbed`, its registry key, constants, predicates, admin
  labels, specs — not just the class.
- **Pick the domain-agnostic word when the concept is broader than the casual name** — `contact`,
  not `email`, when a contact can be an email address or a phone number.
- **A name may not imply precision the code doesn't use.** If only the *order* of
  `PRIORITY_WEIGHTS = { 'urgent' => 3, ... }` is ever consumed, encode an ordering, not weights.
- **File name matches its primary export** (`formatRelativeDate.ts`, not `relativeDate.ts`) — check
  that sibling files follow the same pattern.
- **Full words, never abbreviations** (`index` not `i` outside a tight loop, `quantity` not `qty`).

## 9. Ruby / Rails idiom [Rails]

- **Implicit returns.** Drop a trailing `return nil` when the previous expression is the value.
- **Hash destructuring over positional arrays** — no ordering or trailing-comma fragility.
- **Don't return a bool from a mutator** unless a caller consumes it.
- **Class constants sit at the top** of the class, before associations — not inline above the
  private method that uses them.
- **Migrations use `def change`** plus `if_not_exists: true` for idempotency — not `def up`/`def down`
  for a manual rollback story.
- **Follow the repo's service-object convention** (its result type, how failure is signalled) —
  read the convention doc or two sibling services before writing a third.
- **Standalone scripts are Node** (plain JavaScript, `node file.js`, built-ins only) — not Ruby or Python — for any script the user runs or reads; code that runs inside the app (a runner/console script, a model) uses the app's language, so the Ruby idioms above apply to that. *(The user's personal rule.)*

## 10. Testing [any]

- Follow the repo's test conventions (its spec doc, or the shape of sibling tests); grep before
  introducing a new helper or matcher style. Everywhere: **no test-only code in production classes**.
- Colocate a component's tests with the component (`PostEditor.test.tsx`) when the helper under test
  is colocated too.
- A plan for a non-trivial change names both automated tests *and* the manual verification path
  (a runner script against the backend; the frontend driven with Playwright). The manual half is
  **verify-in-app** (`--depth backend` or `browser`); a fingerprint/caching parity sweep is a
  **sandbox-tool** instrument, proved against synthetic ground truth before it's pointed at real data.
- For a refactor with a caching/fingerprint contract, a combinatorial parity sweep against `HEAD` is
  the test — specs alone don't prove it.

## 11. Libraries & public APIs [library]

When the code is consumed by other people's code, the API surface *is* the product.

- **Semver impact of every public change.** A new public method on a class users subclass can
  collide with their subclasses' methods — that's a minor bump at best, and worth saying in the PR.
  A changed default, a removed export, a narrowed accepted type or a new thrown error is a major.
  Name the impact in the review; don't leave it for the release manager to discover.
- **Type declarations move in lockstep with the code.** `.d.ts`, RBS/Sorbet sigs, or typed stubs
  change in the same diff as the behavior; a type test (`tsd`, `expect-type`, `dtslint`) covers a
  new overload. Out-of-sync types are a bug for every typed consumer.
- **Hot-path cost.** In code that runs per request/per call, a guard that looks redundant may be a
  deliberate cheap short-circuit — check (grep, blame, benchmark) before calling it dead. Equally,
  an allocation, closure or `try/catch` added to a hot path needs a reason.
- **Undocumented behavior change is a finding.** A logging, error-message or ordering change that a
  consumer can observe belongs in the PR body and the changelog.
- **Internal ≠ private.** Symbols, `_underscore` names and internal modules exist to keep the public
  surface small — new cross-module access goes through the existing internal accessor, not a new
  export.

---

## Nuances — where these rules stop

- **"General solution now" vs "smallest blast radius."** The user resolves this by *cost*, not by
  principle: implement the general shape when it's cheap **and** a concrete near-term use case is
  already named (the wire-type widening in §5). When the general solution grows the diff or the risk
  (circuit breakers, delegator removals, refetch-avoidance machinery), cut it and ship the simple thing.
- **Colocation vs `utils/`** flips on call-site count, not on file type. One caller → colocate. Two → extract.
- **Reuse-the-existing-mechanism** yields when the new state is genuinely load-bearing (it drives
  retries, say) — but the burden of proof is on the new field, and it usually loses.
- **Comment-trimming** is off while the user is hand-editing the same file.
- **Don't force an abstraction for symmetry.** Passing context through an extra layer with one caller
  is redundant, not consistent.
- **Severity follows blast radius.** A duplication that a mid-PR rewrite would fix is a follow-up
  nit, not a blocking ask (§7).
- **Verification effort tracks risk.** Don't over-verify a low-stakes change; do drive the real app
  for anything user-visible.

## Self-review checklist

Run this over your own diff *before* presenting it. Any "no" is a finding to fix or to raise.
**Reviewing someone else's diff:** read "I" as "the author", and skip items whose stack tag doesn't
match the diff.

1. [any] Does every new public method take domain objects the caller already holds, not pre-resolved ingredients?
2. [any] Is any precedence/derivation logic written in more than one place?
3. [any] Does any caller reach past a public API into an internal helper — or call a private method across classes?
4. [any] Could a multi-step sequence at a call site be one intent-named method on the domain object?
5. [any] Is the logic declared at the layer that owns it, with controllers, resolvers and presenters as thin delegates?
6. [any] Did I add a service, hook, wrapper or file that has exactly one caller and no barrier behind it?
7. [any] Am I bypassing an existing method by setting its attribute directly, instead of fixing the method?
8. [any] Is there an accumulate-and-skip loop, a branch-then-reassemble, or an if/else chain that wants a `map`, a pass-through, or a registry?
9. [app] Does any new attribute live on the entity it's genuinely a characteristic of?
10. [any] Does a fallback chain (`a || b`) exist where one source is guaranteed correct?
11. [any] Is any type, constant, or shape defined twice instead of imported?
12. [any] Am I special-casing one item where the existing declarative config could take a new key?
13. [React] Does JSX contain control flow that belongs in the component body? Any state wrapping a derivable value?
14. [any] Do names describe the general concept, and does every file name match its primary export?
15. [any] Is every comment carrying knowledge the code can't show, honest about cardinality, and within the repo's convention or budget? Did I touch a comment the user wrote?
16. [any] Did I add a guard for a state that can't happen, a stub for something unrequested, or a compat branch nobody needs?
17. [any] Is any part of this diff bigger than the ask — a rewrite, a flag, an optimization — that a simpler imperfect version would cover?
18. [any] Is every claim this code rests on verified, not inferred?
19. [any] If this changes a fingerprinted or cached derivation, have I proven the output is identical?
20. [any] Did I grep this codebase for the convention I'm about to call idiomatic?
21. [library] Have I named the semver impact, kept the type declarations in sync, and justified any hot-path cost or observable behavior change?

## Hand-offs

- **`code-review`** (built-in) — correctness bugs in the current diff. This skill is shape, not defects; run both.
- **`deep-pr-review`** — reviewing someone else's PR with gathered context and a numbered review doc.
- **`pr-triage`** — verifying and answering bot findings on a live PR (many of which are style claims worth refuting).
- **`research-doc`** — when the answer is a design, not a diff: write the doc before the code.
- **`bug-intake`** — a `<chat>` / `<issue_tracker>` report that isn't traced to code yet; it owns
  intake → RCA → remediation → fix, and hands its fix diff back here for the shape pass.
- **`ship-pr`** — once the diff passes this checklist and the user has approved it.
- **`verify-in-app`** — driving the change to prove it works; this skill only answers *shape*.
- **`sandbox-tool`** — a parity/fingerprint sweep, or any script a human reruns.
- **`agent-team`** — agents writing the code: put this skill in every brief, and run the checklist over the combined diff too.
- **`stack-surgery`** — conflict resolutions during a rebase are unreviewed authored code; they get this pass.
- Long-tail before/after examples per theme: [`REFERENCE.md`](REFERENCE.md).
