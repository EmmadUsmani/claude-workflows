---
name: one-pager
description: Condense a technical plan into ONE full-screen spec sheet — a minimalist engineering-drawing-style page (six numbered panels, revision or status block, title block) a reviewer takes in at a glance. Default panels are a data model ERD, boundary diagram with real class names, numbered trace paths, API contract, consumer + key mechanism, guarantees/open items, each with a concise WHY from the plan; they flex to the plan's genre (ops, bug fix/RCA, migration, UI, exploration, pull request) and to what the user asks to emphasise. Modes `new` and `revision` (each change marked with a △B delta), inferred from the plan's history. Renders a 3360x2100 PNG after a layout lint, plus a scaled Artifact page. Use for "make a one-pager of this plan", "condense the plan into a single image I can send", "a spec sheet for the revised plan, mark what changed". Also built by default for every visual-explainer page and every deep-pr-review PR. NOT the scrolling explainer (visual-explainer) or the plan doc (research-doc).
argument-hint: "[new|revision] <plan path or topic> [emphasis notes]"
---

# One-pager — a plan as one engineering spec sheet

One fixed 1680x1050 sheet (16:10, a laptop screen) that carries a whole plan: what is stored,
how the pieces route to each other, the exact calls on each path, the contract, how it is
consumed, and what is guaranteed. It is rendered twice from one HTML source: a 2x PNG to send
anywhere, and a published Artifact that scales the same sheet to any window.

**The worked examples are in `examples/`** — five finished, lint-clean sheets: three built from
illustrative plans for fictional projects, and two built from real public code (rack/rack):

- `examples/rate-limiter.new.html` — `new` mode, the **default spine** (ERD, store boundary,
  three trace paths, HTTP contract, token-bucket figure, stack strip). Start here.
- `examples/job-retry-v2.revision.html` — `revision` mode: Rev A/Rev B table, △B deltas within
  budget, "Removed vs Rev A" lines, whys that say what was wrong with Rev A.
- `examples/cache-key-collision-rca.new.html` — the **RCA / bug-fix** recipe: verdict in the dek,
  the symptom drawn, the faulty step in red, the fix in ink, blast-radius table with a
  `[PENDING]` cell, remediation plus a rollout strip.
- `examples/pr2497-multipart-parser.new.html` — the **pull request** recipe (the sheet
  deep-pr-review builds), from rack/rack#2497 and its review-graph data file in
  **pr-review-graph**'s `examples/`: the PR's goal as the dek, the env contract it reads, the
  Request | Multipart boundary with the PR's units in red, traces, the hook mechanism, a
  precedence table, a rollout strip — and no findings.
- `examples/rack-builder-stack.new.html` — the **mechanism / how it works** recipe (existing
  code, nothing proposed), the one-sheet of visual-explainer's shipped example page: status
  `AS BUILT · NOTHING PROPOSED`, red = the surprise, the fold drawn, gotchas in 06.

Render the closest one (with `--out` into your scratchpad, so the PNG doesn't land in the skill
folder) and look at it before writing a new one: it is the bar for density, wording, diagrams
and markers. None of them has been reviewed by you yet: once you approve one as "the bar", say so
here, so later runs calibrate against a human verdict, not an agent's. `assets/template.html` is
the same design system with empty panels and every
component. REFERENCE.md §8 indexes the examples and maps the other genres onto them.

## Hard rules

- **Every identifier comes from the plan or the code, never from memory.** Class, method, table,
  column, field and PR names are copied from the source. A fact the plan marks unverified keeps
  its marker on the sheet. Don't add facts the plan doesn't state, however plausible: a one-pager
  is read as authoritative, and a plausible-looking example once turned out to be a different
  model entirely.
- **Every panel says why.** A sheet that shows *what* without *why* reads as a diagram dump. Each
  panel carries at least one short WHY (REFERENCE.md §2 "Why notes"): the reason behind that
  panel's key decision, in one to three lines, taken from the plan (its "because", its decision
  table, the alternative it rejected). Concise is fine; missing is not. A panel whose choice the
  plan never explains gets no invented reason: leave it, and list it in your report as "reason
  not stated in the plan". `render.js` reports such panels as `no-why` advice.
- **Condense, don't invent structure.** No data model in the plan means no ERD on the sheet
  (substitute a panel, below). A method the plan never names doesn't appear in a trace.
- **The status must be true today.** Plans go stale: PRs ship, ship differently, or get
  superseded by files written after the plan. Check the plan's real state (Phase 0) and say it in
  the status/revision block. The panels still show the plan as written unless the user asks
  otherwise; drift goes in the status line and in your report, never silently into the content.
- **Keep the style.** The design system in `assets/template.html` is the look of these sheets:
  ink on paper, IBM Plex Sans Condensed + IBM Plex Mono, hairline rules, one signal colour,
  numbered panels, a single frame with no zone-tick border, title block. Don't restyle unless
  the user asks.
- **One signal colour, one meaning.** Revision mode: red = changed in this revision. New mode: red
  = the new parts of the system against what exists (when nearly all of it is new, draw the existing
  and reused pieces dashed and grey). RCA: red = the fault. Mechanism (existing code, nothing
  proposed): red = the surprise, the one step a reader would predict wrong. Never decorative. One red sentence per
  sheet (two at most) carries the point of the whole plan.
- **The lint must pass and the PNG must be read.** `scripts/render.js` lints overflow, clipping,
  label overlaps, labels overrunning their boxes and font fallback. It can't see a line through a
  label drawn by a `polyline` or `path`, a cramped or empty quadrant, or text that's correct but
  misleading, so read the PNG.
- **No customer or org names, people's names, emails, bucket names, tokens or prod identifiers**
  on the sheet. Aggregate prod facts are fine with their source and time ("1,204/1,204 accounts,
  per `<warehouse>`, as of 2026-06-30 07:30 UTC" — **warehouse-data**'s sourcing rule).
  Customer names and other customers' data become "Customer 1", "Customer 2"; your own product
  names are fine.
- **Fragment-safe characters only.** Use HTML entities (`&mdash;`, `&rarr;`, `&middot;`) in
  HTML and CSS comments, `\u` escapes in JS. The Write tool turns `›` into the literal
  character, so re-check after writes; `build_artifact.js` refuses non-ASCII.
- **Sandbox writes auto-commit** when `<sandbox_autocommit>` is on (the default) and
  `<sandbox_dir>` is a git repo: after each meaningful write there,
  `git -C <sandbox_dir> add <only your paths>` and commit, never asking (**sandbox-tool**).

---

## Phase 0 — inputs, real state, mode, destination

**Inputs:** the plan (usually `<sandbox_dir>/tickets/<topic>/PLAN*.md`, or the conversation), or
a visual-explainer page and its sources when that skill calls this one, plus any emphasis the
user gives ("focus on the data model", "show the migration").
Read the whole plan before choosing panels. **Sources:** the plan, its predecessor, and sibling
docs the plan itself points to. Facts that only appear in files written after the plan
(`PR-DRAFT.md`, dry-run output, review responses) describe drift; they go in the status and your
report, not in the panels.

**Check the plan's real state** (a few minutes, read-only):
- PR numbers and branch names in the plan → `gh pr view <n> --json state,mergedAt,title`.
- A `pr-bodies/` folder, `PR-DRAFT.md`, dry-run outputs, or review notes beside the plan.
- The plan's own history: `git -C <sandbox_dir> log --oneline -- <plan path>`; an earlier
  version in git history is a predecessor for revision mode (`git show <sha>:<path>`).
- If the plan cites `file:line`, don't put line numbers on the sheet unless you re-check them;
  file paths and method names age better.

**Status vocabulary** (header and title block): `PROPOSED · NOT BUILT`, `AGREED · NOT RUN`,
`STACK OPEN · NOT MERGED`, `IN REVIEW`, `REWORK IN PLACE`, `PARTLY SHIPPED · SEE NOTE`, `SHIPPED`.
A revision can be built too: mode says what it is diffed against, status says where it stands. Name what
shipped differently in one line of panel 06 when it matters to a reader. For an RCA or bug sheet:
`BUG LIVE`, `FIX ON BRANCH · NOT DEPLOYED` (a library: `· NOT RELEASED`), `FIX SHIPPED · NOT ROLLED OUT`,
`SHIPPED · ROLLED OUT <date>`, with `PARTLY PARKED` when part of the remediation is set aside. For
an exploration: `NO PICK YET`, `PICKED · <key> · NOT BUILT`, `PICKED · SHIPPED`,
`SUPERSEDED · <PR>` (combine when main settled part of it, e.g. `OPTION A MERGED · OPTION B NOT BUILT`).
For a mechanism sheet (how existing code works, nothing proposed or broken):
`AS BUILT · NOTHING PROPOSED`, or `AS BUILT · <ref>` naming the branch/tag/sha read (e.g.
`AS BUILT · main @ da90464`); add `· SEE 06` when 06 lists a gotcha the reader should act on.

**Mode — infer it, then state which you picked and why in one line:**

| Signal | Mode |
|---|---|
| "v2", "revised", "supersedes PLAN.md", a `PLAN-v2.md` beside a `PLAN.md` | `revision` |
| A predecessor PR reviewed with changes requested; review findings the plan answers | `revision` |
| The plan reworks something already built (PRs it changes in place) | `revision` |
| An earlier version of this plan in git history that was shared, reviewed or built, and that the plan says it replaced | `revision` |
| "Proposed, nothing built", no predecessor, no feedback yet | `new` |
| Built as written, PRs open or merged, no feedback-driven change | `new`, status `STACK OPEN` / `SHIPPED` |
| A competing approach or PR the plan replaces (not an earlier version of it) | `new`; name what it replaces in 06 |
| Only internal drafting history ("draft 2 dropped X", same-day versions in git, a "v4" title with no review behind it) | `new`; mention a dropped draft only where it explains a decision |

An explicit `new` / `revision` argument overrides inference. Choose `revision` only when there is
something concrete to diff against; a revision sheet with nothing to mark is noise.

**When the plan contradicts itself** (an old header vs a later status log, a summary table vs the
section that elaborates it), the later and more specific part wins; name the contradiction in
your report.

**Destination:** `<sandbox_dir>/tickets/<topic>/one-pager/<slug>-one-pager.html` (the user may
name another), with the PNG and `.artifact.html` beside it. `<slug>` is short and specific.

**Called from visual-explainer** (its Phase 4b, for every explainer):
- The sheet goes in `<explainer dir>/one-pager/`.
- The facts are the explainer's verified ones; the sheet never says more than the page.
- The status uses the explainer's state words but must be true today; when they disagree, the sheet
  says what's true and the explainer gets swept (visual-explainer Phase 4b).
- The title block's DWG is the explainer's file name, and DATE is the date of its verdict (or its last
  substantive revision).
- The panels come from the RCA, mechanism or exploration recipe (REFERENCE.md §4) when the
  explainer isn't a plan; `examples/cache-key-collision-rca.new.html` is the RCA shape and
  `examples/rack-builder-stack.new.html` the mechanism shape.
- Publishing follows the explainer's decision: both published and cross-linked, or both local.

**Called from deep-pr-review** (for every reviewed PR):
- **The "plan" is the PR itself:** its description and title (from `gh pr view`, never retyped), the
  linked ticket, the diff at the head SHA, and the review's verified context. The richest source is
  the review graph's data file (**pr-review-graph**) — take its node names, `facts`,
  `edges[].detail` and `note`; **don't copy its `summary` or `bullets` text, which carries findings
  in a review run.** Every fact on the sheet comes from the code or those sources.
- **It explains the PR, not the review.** The goal and why it exists, the system it touches, how the
  new code works end to end, and the contract it adds or consumes are the sheet. No findings,
  severities, verdict or finding numbers anywhere. Draw what the code does and quote the author's
  stated intent (PR body, code comments); don't assert what it fails to do. Leave out any fact whose
  only purpose is to support a finding, including neutral-sounding ones a reviewer would file (a
  missing spec, an unfiltered scope, a race window). Prod numbers from the review appear only as
  rollout or status facts, never as a finding's impact count.
- **06's "open items" are only what the PR itself names** — in its body, code comments or manual
  pages (a split-out PR, a flag, a documented trade-off, a later stack layer) — never one the review
  raised. With nothing deferred, 06's WHY can be the reason behind a rollout fact (why no flag, why
  no migration).
- **Panels follow the pull request recipe** (REFERENCE.md §4); `examples/pr2497-multipart-parser.new.html`
  is the worked example. Map the graph's kinds onto the sheet: `added` / `modified` / `behavior` /
  `removed` units are red; `unchanged` and `context` (lower layers, vendors, the other side of a
  boundary) are dashed.
- **Mode is `new`** — including a PR reworked in place after an earlier review (name the replaced
  first version in 06's strip). On a deep-pr-review `--v2` re-review, `revision` against the first
  sheet, marking what the new commits changed.
- **Status is the PR's real state:** `IN REVIEW`; `STACK OPEN · NOT MERGED` (layer N of M in
  DELIVERY); `MERGED <date>`; `MERGED <date> · VIA #<parent>` when it merged into a stack branch;
  `MERGED <date> · INERT UNTIL <gate>` when nothing happens until an ENV var or flag is set and you
  can't confirm it is; `SHIPPED · ROLLED OUT` only when your deploy tool's status or prod data
  (`<warehouse>`) confirms it.
- **Title block:** DWG = the slug `pr<N>-<two or three title words>` (also the file name); DATE = the
  merge date, or the head commit's date while open; SOURCE = `PR #N @ <head sha> vs <base sha> ·
  <graph data file>`; PROJECT = the ticket, or the area when there is none.
- **No people's names:** not the author, not the head branch (`<handle>/…`), not anyone the PR body
  credits — "per review" or "PR body" instead. Name the PR by number.
- **06's band** is the stack strip for a stacked PR; for a single PR, a rollout strip (merge →
  config → first effect), or omit the band.
- **Output location:** `<sandbox_dir>/tickets/<repo>-pr<N>/one-pager/<slug>.{html,png,artifact.html}`
  (e.g. `tickets/rack-pr2497/`), the same folder deep-pr-review and pr-review-graph use for the
  graph — never the notes vault where the review doc lives.
  Publishing, sending (Phase 5 step 3) and committing follow deep-pr-review's flags: published
  privately with the graph by default, it names a colleague's code, so it isn't shared further
  without the user; `--no-publish` builds and lints locally, skips sending and publishing, and
  reports the paths.

## Phase 1 — inventory the plan

Before any layout, list (in a scratch file if the plan is long):

1. **Entities:** tables/models, key columns (types, keys, defaults, ranges), relations and
   cardinalities, ownership, new vs untouched. Cardinalities the plan doesn't state are inferred
   only from constraints it does state (a unique index, "one row per role").
2. **Abstractions and boundaries:** interfaces, adapters, registries, services, and which side of a
   boundary (store / queue backend / external API / client / app / engine) each lives on.
3. **Paths:** each write, state-change and read path as ordered calls with real method names and the
   one-line reason each step exists.
4. **Contract:** API surface (GraphQL types/fields, routes, headers, events, CLI, a class-level DSL),
   what is removed, what stays for compatibility.
5. **Consumers and the mechanism:** the code that uses the contract, and the one thing worth drawing
   (a formula, a state machine, a timeline, a cache key, a before/after of the defect).
6. **Guarantees, rollout, open items:** invariants, how it ships (PRs/stack, flags, migrations,
   datafix gates), open questions with proposed answers, out of scope, accepted risks.
7. **Numbers:** every count and measurement with its source (dev DB, prod via `<warehouse>`, the
   `<ops_bot>` or a **prod-script** run, "the plan" when the plan gives none). Never upgrade a
   source: unlabelled stays "per the plan", never "prod".
8. **Revision mode, the diff:** what Rev A was, what sent it back, and for each change: before →
   after → why. When the built code drifted from Rev A's plan, the built code wins (it is what the
   reviewers saw). Rev A facts come from Rev A's plan or code, not from Rev B's summary of it.
9. **The plan's own labels** for decisions and findings (D12, §2.3, R4, O1): keep them on the sheet
   so readers can find them in the plan.
10. **The whys.** For every decision you will show, the plan's reason in one line, plus the rejected
    alternative when the plan names one ("own table, not jsonb: plain WHEREs and per-row history").
    Collect them before layout; they decide which notes each panel gets.

## Phase 2 — choose the panels

**Default spine (`examples/rate-limiter.new.html`), six panels in a 3x2 grid:**

| # | Panel | Shows | Typical form |
|---|---|---|---|
| 01 | Data model | tables, key columns, relations, cardinality, ownership; a "WHY …" note | SVG ERD with crow's feet |
| 02 | Abstraction / boundary | how calls route through interfaces; where layer-, provider- or store-specific code starts | SVG call boxes, arrows, dashed boundary |
| 03 | Trace paths | write, state-change, read paths as numbered steps with real calls | `.trace` step list |
| 04 | API contract | the schema/route/header surface; removed vs kept | `.box.code` + bullets |
| 05 | Consumer + mechanism | the consuming code and the one figure that makes it work | code + small SVG figure |
| 06 | Guarantees · open items | invariants, open questions, out of scope, title block | `ul.inv` + `.tb` |

**Flex it.** The spine is the default, not a form:
- **Emphasis wins.** When the user asks to emphasise something, give it the big panel (span two
  columns, or the whole top row) and fold the least important panel into 06.
- **Substitute by plan genre** (recipes in REFERENCE.md §4): no persistence → component map;
  ops/remediation/datafix → windows + blast radius, retire/replace, runbook, rollback, decisions;
  bug fix / RCA → the defect drawn (symptom → cause → contract), where the fix lives,
  scope/blast radius; mechanism (how existing code works) → state, boundary, traces, the
  surprise drawn, gotchas; migration → before/after schema and cutover; UI-heavy → wireframe with
  callouts; async → pipeline; decision-heavy → decisions table with the plan's labels; stacked
  rollout → stack strip in 06; a pull request (from deep-pr-review) → the PR recipe.
- **4–8 panels.** Use another layout from REFERENCE.md §3 rather than shrinking type.
- **Density:** packed, not cramped. One diagram or one code block per panel plus about 6 short
  lines. No empty quadrant; a quiet band is fine. Minimum text: 10px for prose, 9px for mono
  identifiers in diagrams (ERD rows), 8.5px for labels.

## Phase 3 — compose the sheet

1. **Scaffold:** `node <skill>/scripts/new_sheet.js <dest>.html --mode new|revision` (copies the
   template with the right header block; refuses to overwrite). Keep the `<style>` design system
   and the lint script; replace every `REPLACE` (`grep -c REPLACE` should end at 0).
2. **Header:** kicker (org or project · area · genre, e.g. "System plan", "Remediation plan",
   "RCA / bug fix" · "one sheet"), the title in caps with the plan label in `<em>` (`PLAN`,
   `PLAN V2`, `RCA`), a one-sentence dek (for an RCA, the verdict).
   - **revision:** `.rev` table: Rev A (what existed + what sent it back, about 60 characters), the
     current rev in `.cur` (3–5 changes, `&middot;`-separated), the key row ("△B marks every element
     that changed in Rev B", or "All panels revised · △B marks changed elements" when they all
     did), and the status in the key row's last cell.
   - **new:** `.status` block: status, delivery, code read at, where the numbers came from.
3. **Panels** from REFERENCE.md components. Headings are short nouns in caps; the claims go in the
notes. **Every panel carries at least one WHY** for its key decision, in the form that fits it
(REFERENCE.md §2 "Why notes"): a "WHY …" note at the panel's foot, a `Why …:` bullet lead, or
one red-bordered key-WHY box for the decision the whole sheet turns on. Name the plan's label
(`WHY ONE ATOMIC CALL · D4`) so a reader can find the full argument.
4. **Revision markers — the delta budget:** a heading `<span class="delta" data-rev="B">` only on
   panels whose substance changed; an element delta only on boxes, rows and steps that are new or
   reshaped (about 8 at most per sheet, headings included). If every panel changed, drop the
   heading deltas and say so in the key row. Deleted things get a "Removed vs Rev A: …" line, not
   a delta.
5. **Title block** (06): title, project, plan file (DWG), rev + status, stack/PRs, DATE = the date of
   the current revision of the plan (not today), sheet, and a SOURCE line naming the plan path and
   where the numbers came from.

## Phase 4 — render, lint, look

```bash
node <skill>/scripts/render.js <sheet>.html          # lint + <sheet>.png at 3360x2100
node <skill>/scripts/render.js <sheet>.html --out <scratch>/x.png   # PNG elsewhere
node <skill>/scripts/render.js <sheet>.html --lint-only
```

- Exit 1 lists issues: `panel-overflow`, `clipped-text`, `svg-text-overlap`,
  `svg-text-outside-viewbox`, `svg-text-exceeds-box`, `svg-line-through-text`, `header-overflow`,
  `tiny-text`, `font-fallback`, `canvas-size`, `non-ascii`.
  Fix every one without shrinking type below the minimums. The PNG is still written, so you can look.
- **Advice** (doesn't fail the render): `no-why` names each panel that never says why. Add the
  plan's reason, or leave the panel and say in your report that the plan gives none.
- **Read the PNG** (Read tool) and fix what the lint can't see: arrows, polylines or paths through
  labels, text touching a panel divider or a box edge, a mono identifier rendered in the condensed
  face, lists stretched to fill a row, red used more than intended, empty or crammed areas. Two to
  four rounds is normal. Each render uses a fresh Chrome profile, so nothing is cached.
- Chrome is found at the macOS default path, a Playwright Chromium cache, or `google-chrome` /
  `chromium` on `PATH`; set `CHROME_BIN` otherwise.

## Phase 5 — deliver

1. `node <skill>/scripts/build_artifact.js <sheet>.html` → `<sheet>.artifact.html` (fragment form,
   canvas scaled to the window, lint script dropped, refuses non-ASCII).
2. Publish it with the Artifact tool (`file_path` = the `.artifact.html`, `icon: "diagram"`, a
   one-sentence `description`). It starts private; say so. Re-publishing the same path updates the
   same URL. Skip publishing when the user says "just the image", or when this sheet belongs to a
   visual-explainer page that stays local.
3. Send the PNG to the user (`SendUserFile` with `display: "render"` where that tool exists;
   otherwise give the absolute path).
4. Commit the sheet, PNG and artifact file in the sandbox (own paths only).
5. Report briefly: mode and why; the real state if it differs from the plan; the panels and any
   substitution; what was left off; where the files are; the artifact link.

## Iterating

Corrections come as "move X", "this label is wrong", "emphasise Y". Change the HTML, re-render,
re-read the PNG, rebuild and re-publish from the same path (same URL), re-send the PNG. Fix the
specific thing; don't redesign an approved sheet.

An older sheet (built before the current template) gets `node <skill>/scripts/upgrade_sheet.js <sheet>.html`
first: it syncs the lint script and adds any component CSS the sheet lacks (why notes, table,
stack strip, callouts) without touching content (on a current sheet it is a no-op). Then add what
the new rules ask for, starting with the whys.

## Verified gotchas

- **A render that never returns was a Chrome helper holding the output pipe**, not the sheet:
  crashpad and updater children outlive Chrome. `render.js` runs Chrome in its own process
  group with a timeout and kills the group, and retries the lint once on `font-fallback` (a cold
  first run can lint before Google Fonts arrive).
- **The lint doesn't see SVG text running into a neighbouring box**, only into its own, and it
  only checks `<line>` elements for crossings — a `polyline` or `path` through a label passes.
  Look for both in the PNG.
- **`svg text { fill: … }` in CSS beats the `fill` attribute** and silently recolours labels (white
  header text vanished, red labels went black). The template uses `svg text:not([fill])`.
- **A class on an SVG `<g>` doesn't reach its texts** if a rule targets `svg text` directly; the
  template's `svg .m, svg .m text` covers both. Check the PNG: mono rows that look condensed are
  this bug.
- **SVG text doesn't wrap.** Size boxes from the longest label (REFERENCE.md §7); the lint flags
  overruns, but only after the fact. A label beside a connector near the viewBox edge goes
  `text-anchor="end"` on the other side of the line rather than past the edge.
- **Marker ids are document-global.** `#ar`, `#one`, `#many` are defined once in the first SVG;
  reuse them.
- **Grid stretch:** a `ul.inv` alone in a `1fr` row spaces its bullets out; the template sets
  `align-content: start`. The 06 spacer row costs a grid gap of height; budget for it.
- **Bottom-row panels have about 355px for content** under the heading, not 390.
- **The revision table's DESCRIPTION cell clips past about 60 characters** of mono text; the lint
  reports it as `clipped-text`.
- **A browser-automation MCP may only be allowed to write inside one configured root**, which is
  why rendering goes through `render.js` and headless Chrome rather than an MCP screenshot.
- **zsh eats `:a`/`:h` after a variable** in `"$sha:path"`; write `"${sha}:path"` when reading git
  history.

## When not to use / hand off

- A long, scrolling, interactive explainer with a contents rail → **visual-explainer**, which in
  turn calls this skill for its one-sheet.
- Writing or revising the plan itself → **research-doc** or the plan's own thread; the one-pager comes
  after the plan exists.
- Prod numbers the plan lacks → **warehouse-data** first, then the `<ops_bot>`, if your team runs
  one, for what the warehouse lacks, **prod-script** last. Mark the source on the sheet ("per
  `<warehouse>`", "per the ops bot").
- A chart of real data inside a panel → the `dataviz` skill, if installed, for the chart itself.
