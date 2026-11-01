---
name: research-doc
description: Turn a code investigation, an end-to-end trace, or a pre-implementation design into a durable personal document — a Markdown/Obsidian note under `<notes_dir>`, a page in a static docs site (`<docs_site>` — Astro, Docusaurus, MkDocs…), or an interactive HTML explainer in `<sandbox_dir>` (delegated to the visual-explainer skill; a markdown doc plus an HTML explainer for one investigation is welcome). Explore agents map the code, you personally verify the core files against origin/main, then match the destination's existing idiom. Use for "write the full analysis of both flows to a new .md in my notes", "create a new docs page explaining how X works, make it highly visual", "don't code this yet — do a thorough design doc first and interview me as needed", "do a design exploration of what X would look like, output it to a new .md", "document this and also give me a visual explainer". NOT a team-facing doc in your team's own design-doc/PRD template, and NOT a PR review write-up (deep-pr-review).
argument-hint: "trace|design <topic> [--dest notes|docs-site|sandbox-html|multiple]"
---

# Research doc

Two modes, one shape. **`trace`** documents what exists (an investigation, an end-to-end code
path, an RCA). **`design`** proposes what should exist, *before* any code, behind two gates. Both
spend their first half on verification and their second half matching a destination that already
has a house style — the failure mode is a confidently-worded doc built on a stale checkout, not a
badly formatted one.

## Hard rules

- **Propose → wait → act.** "Do a design doc first" / "don't code this yet" means the
  deliverable is the doc. Implement only on explicit approval, and then in a fresh worktree,
  **committed** by default (staged precisely) — uncommitted only if the user explicitly says so.
  Pushing and the PR wait for their own go-ahead.
- **Verify, don't relay.** An Explore agent's report is a map, not a fact. Personally `Read` the
  1–2 core files it flagged, and re-derive from `git show origin/main:<path>` (or `git pull`
  first) — a stale local checkout has produced wrong doc claims. When a premise gets corrected,
  re-examine every argument that rested on it, not just the line.
- **Never cite an identifier from memory** — class names, PR numbers, file paths, counts all get
  grepped. Never read `.env*` (reading a value through the app — `ENV['NAME']` in a runner
  script, `process.env.NAME` in a node one-liner — is fine).
- **Prod numbers carry their source.** Any number in the doc that came from production came from
  a `<warehouse>` query (**warehouse-data**) or a script the human ran (**prod-script**) — put the
  exact SQL or script in the doc beside the claim, with its as-of time. Never label local output
  "prod" or "prod-synced".
- **Only document merged work.** Verify per topic against `origin/main` before including it; WIP
  branches stay out unless the doc is explicitly about the plan.
- **Scope to the ask.** "Just add a section with the steps and the important caveats" means a
  section, not a rewrite. Conversely, don't over-verify low-stakes content — structurally correct
  links don't each need a fetch.
- **Reasoning lives in the doc, not in code comments.** If the investigation produced code, the
  *why* goes in the doc or PR body.

## Phase 1 — pick the destination first

It changes the idiom, the verification bar, and whether there's a PR.

| Destination | Path | For |
|---|---|---|
| **Notes — docs** | `<notes_dir>/docs/[<ticket>-]<topic>.md` (the ticket prefix only when there is one) | Durable personal reference: traces, flow analyses, footguns. Most common. |
| **Notes — output** | `<notes_dir>/output/<YYYYMMDD>-<slug>-design.md` | Design explorations, execution plans, multi-PR tracking docs. Dated files use compact `YYYYMMDD`; long-lived ones can be slug-only. |
| **Notes — code review** | `<review_dir>/<repo>-<ticket>-review.md` | PR reviews → use **deep-pr-review**, not this skill. |
| **Docs site** | `<docs_site>/<its pages dir>/<slug>.<ext>` | Team-readable guide, highly visual, opens a PR. Read the site's own CLAUDE.md / README first. |
| **Sandbox explainer** | `<sandbox_dir>/tickets/<topic>/` (committed) or the investigation's own `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/` | Interactive HTML explainer for a bug/RCA/design, optionally published as an Artifact. |
| **In-repo docs** | the project's own `docs/` (or a runbook folder the app serves) | Operator/dev runbooks that ship with the code. |

If `<notes_dir>` already has its own folder layout, follow it over the `docs/` / `output/` default
— `ls` it first. If `<docs_site>` is unset and the user asks for a docs-site page, ask for the
path once.

Destination facts worth checking before you write:

- **Is the in-repo docs folder auto-discovered?** Many apps serve a docs folder through a glob
  (`Dir.glob(root.join('**', '*.md'))`, a static-site content collection). Grep for the loader
  before hunting for an index or nav file to update — if it globs, dropping the file in is the
  whole wiring.
- `<sandbox_dir>` (if it is a git repo — check with `git -C <sandbox_dir> rev-parse`): `adhoc/<YYYY-MM-DD>-<slug>/` per investigation (**one**
  subdir, not several), `tickets/<topic>/` for committed exploration write-ups, `scripts/` for
  reusable tools. Loose files at a directory root get moved into their own subdir before commit.
- **Sandbox writes auto-commit — never ask** (when `<sandbox_autocommit>` is on, the default).
  After each meaningful write under `<sandbox_dir>`, `git -C <sandbox_dir> add <only the paths you
  wrote>` and commit with a short descriptive message, no prompt. Never `add -A`/`.` — other
  sessions leave uncommitted work there; never commit, revert, stash or clean theirs. No remote,
  no push; secrets get gitignored, never committed. Cloud runs: the state repo's own commit rule
  applies (**cloud-runtime**). `<notes_dir>` and `<docs_site>` keep their own rules.

When two audiences differ, produce **two deliverables**, not one compromise — e.g. an internal
visual RCA explainer *and* a short vendor-shareable `.md` with real captured request/response pairs. Offer the second rather than assuming it.

## Phase 2 — map the code (both modes)

1. **Dispatch `Agent[Explore]` with a specific brief**, one per flow: *every* file referencing the
   feature/model, reported as **path + line number**, plus services, API clients, jobs, and
   callbacks. Demand file:line citations and short quoted snippets. Keep working the main thread
   (grep the obvious things yourself, pull the ticket/chat context) until the notification lands
   — don't re-run a search you delegated. The briefing and verification discipline is
   **agent-team** §1/§7: one agent per independent question, `file:line` citations demanded, an
   idle notification is not a report. This fan-out is read-only research and stays here; parallel
   *implementation* is that skill's job.
   Keep the fan-out small (one agent per independent flow, rarely more than three) and run it on a
   cheaper model than the main thread.
2. **Personally read the 1–2 core files** each agent flagged. Cross-validate agents against each
   other and against `origin/main`. **When a behavioural claim carries the doc** ("X runs before
   Y", "this path never fires"), prove it with a small runnable probe (a script against the
   checkout, a failing/passing test) and mark the claim *(probe)* — reading code alone can miss a
   misread that a run catches. Keep probes next to the investigation in
   `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/`, and have the doc link them by absolute path (a
   notes vault and the sandbox are different roots).
3. **UI trace recipe** (for "explain the code path behind this screen/message"): grep the exact
   copy string → read the component → read its hook/store → grep the hook's callers → read the
   API call (GraphQL document/fragments, REST client, server action) → grep the backend handler
   (resolver, controller, route) → read the model → `git log -p` / `git blame` the load-bearing
   lines for intent.
4. If the subject has a database: for real schema, enum values, and order-of-magnitude counts, query the **local dev DB**
   read-only (a read-only DB MCP if one is connected, else `psql`/`bin/rails runner`/the
   framework's shell) rather than guessing. Say "local dev DB" in the doc when a number came from
   there; real prod counts come from **warehouse-data**.

## Mode `trace` — document what exists

5. **Match the destination's idiom before writing a word**: `ls -la` the target dir and `Read`
   (or `head -30`) a neighbouring doc.
6. Write it. Lead with the mental model, then the mechanism.
7. **If the reader is not purely an engineer, open with the product/business framing.** A doc
   that starts cold on model internals gets sent back:
   > *"the doc is too low level and technical … it should at least start by introducing the
   > concept … from a product/business perspective, why we need it, what it accomplishes, then
   > use that to transition into the technical details."*
8. Flag stale claims you found in neighbouring docs; the code wins.
9. If the subject is an app with record pages, enrich with derived links on request (the app page or admin page for each record): build the
   URL shape from the route definitions and the frontend's route helpers — grep them, never guess
   a path — and pull the ids with a follow-up **warehouse-data** query, or a console script
   emitting JSON lines when the warehouse lacks a column.

### Notes house idiom (Markdown / Obsidian)

Copy the shape of the existing docs in `<notes_dir>`. Absent one, this shape works:

- **TL;DR** at the top — the one distinction that makes the rest click.
- **Numbered flows**, one `##` per flow, each step naming the real class/method.
- **A contrast table** when the doc compares two paths (`| Aspect | A | B |`).
- **Gotchas** section.
- **Key files** table (layer → path) and **Key specs** table.
- Any data claim carries the exact query or script that produced it.

## Mode `design` — propose what should exist

**Gate 0 — sanity check.** Before writing anything, answer "is this a sound approach?" plainly
and surface the real tensions with concrete numbers ("one email per failed webhook = a few hundred a day at today's volume"). **Reject it if it deserves rejecting** — that is explicitly what was asked for.
Wait for the go-ahead.

**Gate 1 — interview.** First pin the code facts the design depends on (the *actual* cron, the
*actual* retry semantics — e.g. whether a job's retry setting means a single retry or the queue's full backoff schedule), so the questions and the doc are accurate. Then
`AskUserQuestion` on the decisions the user's notes leave genuinely open — **each phrased with
its concrete technical trade-off**, not as a preference poll. Mirror existing codebase idioms
(registry + base class) instead of inventing a parallel structure. Those idioms are enumerated in
**code-style** — abstraction barriers, logic declared at the layer that owns it, config-driven
registries over if/else chains, one source of truth. A design doc that proposes a shape that skill
rejects will be rejected at review; check the proposal against its checklist before writing the
phased PR plan.

**Gate 2 — write** `<notes_dir>/output/<YYYYMMDD>-<slug>-design.md` (or the destination the user
named), with numbered sections so corrections can be addressed by section:

goals · **decisions record** · per-component mechanism · edge cases · **phased PR plan** ·
testing plan · open questions.

State explicitly what was kept from the user's notes as-is vs. changed and why. Note what you
deliberately excluded (unreachable edge cases, speculative flag infrastructure) rather than
silently building it.

### The correction protocol (this is where design mode earns its keep)

- **Every correction = targeted edit, then a grep-sweep of the whole doc for the stale
  terminology.** A design change ripples through sections that don't mention it by name:
  ```bash
  grep -n -iE "soft delete|after the grace period|instead of purging|<OldClassName>" \
    <notes_dir>/output/<doc>.md
  ```
  Expect to need it several times in one session; each sweep tends to find real leftovers.
- **Periodically run a full top-to-bottom audit** ("audit the doc for old design vestiges") —
  re-read every line and report each fix **by section number**, separating real inconsistencies
  (would confuse an implementer) from cosmetic ones. One such pass routinely turns up several.
- **When challenged on a specific element, answer with analysis and edit nothing** until told to.
  "Explain, don't change yet" is a distinct instruction.
- After approval: implement in a fresh worktree (**worktree-create**), run **code-style**'s
  checklist over the diff, self-verify with runner scripts (`bin/rails runner`, `node -e`,
  `python manage.py shell -c` …) that deliberately trigger the new path end-to-end — and with
  **verify-in-app** (`--depth browser`) if it has a surface a person sees — and **commit** it
  (`git add <the files you changed>`, never `-A`/`-u`), leaving it uncommitted only when the user
  explicitly says so. Pushing and the PR itself are **ship-pr** (which ends in **pr-triage**), on a
  separate go-ahead.

## Destination playbook — docs site (`<docs_site>`)

Read the site's own `CLAUDE.md` / README first; it is authoritative over this section. The
workflow that works for a static docs site (Astro, Docusaurus, MkDocs, VitePress…):

```bash
cd <docs_site>
ls <pages dir>                                  # survey for overlap + the diagram idiom
gh pr list --state open                         # nav/sidebar file conflicts with in-flight docs PRs
git switch -c docs/<slug>                       # plain branch unless the repo uses a stack tool
# write the page, add ONE entry to the nav/sidebar config if pages aren't auto-listed
<build command>                                 # e.g. npm run build — THE correctness gate; any error is must-fix
L=<scratch dir>/docs-preview.log
nohup <preview command> > "$L" 2>&1 & disown   # e.g. npm run preview; must outlive this shell
cat "$L"                                         # once it has started: read the port it printed
```

Only stop a preview server you started; if the port is already taken, find the owner read-only
and use another port rather than killing it.

Then verify with an isolated browser profile (an isolated Playwright MCP, not a shared one)
against `http://localhost:<port>/<slug>?v=N` — bump `?v=N` between rebuilds, Playwright caches:

1. Full-page light screenshot + `browser_console_messages({onlyErrors: true})`. A site-wide asset 404 that every page has
   is pre-existing; ignore it.
2. **Up-close element screenshots of every custom diagram.** The build does not catch layout bugs
   (see gotchas).
3. **Dark-mode contrast audit**, if the site has a dark theme. In `browser_evaluate`: switch the
   theme the way the site does (often `document.documentElement.setAttribute('data-theme','dark')`),
   walk `body *` for elements with direct text, compare `getComputedStyle(el).color` against the
   nearest opaque-background ancestor, flag contrast `< 3.0`, **skip SVG elements** (they color via
   `fill` — false positives). A correct page reports zero failures.
4. `browser_resize({width:390})` and check
   `document.documentElement.scrollWidth > window.innerWidth + 1`. **If it overflows, load an
   existing page at the same width before touching shared styles** — an identical `scrollWidth`
   means it's the site-wide baseline, not yours.
5. Stage only your files, commit, and — on the user's go-ahead — `gh pr create --base main --head
   docs/<slug> --body-file <file>`. Then stop the preview server you started and delete any stray
   screenshot dir.

## Destination playbook — sandbox HTML explainer (via **visual-explainer**)

This is a first-class destination of this skill, **produced by handing off to the
visual-explainer skill — load it and follow it** for the page itself. It owns the HTML-page craft:
the `explain` (bug/RCA/mechanism) and `explore` (solution space, candidate sampler) modes, the
design-plan step that loads `artifact-design` + `artifact-diagramming`, the serve-and-drive
verification loop, the local-`.html` ↔ Claude-Artifact sync, and the precision rules (real class
names with a glossary, no ambiguous tense about a fix's deploy state, exact doc anchors per
third-party claim).

What stays here: the research itself (Phase 2's code map and your own verification against
`origin/main`) feeds the explainer — do it once and reuse the same verified facts for every
artifact. **Default to producing the pair — markdown + visual explainer — for any trace, investigation or RCA; single-artifact is the exception, only when the user says so.** A `<notes_dir>` write-up
for the durable record, an HTML explainer for the visual/handoff version, and the short vendor-shareable `.md` when there's an external audience (see Phase 1's
two-audiences-two-deliverables rule). Produce all requested destinations from the same facts and
cross-link them (the `.md` links the `.html` path or Artifact URL and vice versa).

## Verified gotchas

- **Playwright MCP screenshot paths are sandboxed to the tool's allowed roots**, and the PNG can
  still land in the *process* cwd — writing one into a repo outside those roots fails with
  "outside allowed roots". Write into an allowed scratch dir, `Read` it, `cp` it out, and delete
  that dir at the end. Never leave a screenshot inside a project repo. Full harness gotchas:
  **verify-in-app**.
- **CSS counters auto-number markers.** If a site's step markers are numbered by a CSS counter,
  putting a literal digit inside doubles every number (11, 22, 33). Leave markers empty.
- **Flex collapses whitespace before a `<b>`**, rendering "total**nil**" as one word. The
  build never catches it; an up-close element screenshot does.
- A regex stripping a UI sort-indicator silently failed to match (missing leading space) and
  indicators accumulated across columns — again, only `browser_evaluate` caught it.
- A nav/sidebar file with one line per page **conflicts whenever a concurrent docs PR merges
  first**. Check `gh pr list --state open` before branching.
- A commit can land on `main` instead of your docs branch. Recover:
  ```bash
  git branch -f <branch> <sha>; git switch <branch>; git branch -f main origin/main
  ```
- Editing an HTML file the tool hasn't read yet fails; either `Read` it first or patch it with a
  small script that asserts the anchor string was found.
- You cannot switch your own model mid-session — a `/model` change has to come from the user.

## When not to use / hand off

- **A team-facing doc in your team's own template** (an engineering design doc or PRD that lives
  in the team's docs tool) → write it in that template, if there is one. This skill is for
  *personal, durable, or exploratory* docs in the user's own destinations.
- **A PR review write-up** → **deep-pr-review** (it owns `<review_dir>`).
- **The investigation itself** → **bug-intake**, which owns the whole arc: intake → RCA →
  remediation → fix → follow-ups. Its RCA-artifacts phase (`--to rca`) hands the durable markdown
  record straight back here and the visual half to **visual-explainer**; both come from one set of
  verified facts. Also **render-pipeline-debug** (image/render pipeline bugs), **warehouse-data**
  (production facts, then the `<ops_bot>` if your team runs one, then **prod-script**),
  **vendor-api-probe** (validating a third-party API claim). Come back here with findings in hand.
- **Checking a proposed design's shape before writing the phased PR plan** → **code-style**.
- **Proving the implemented design actually works**, and the Playwright harness mechanics behind
  the docs-site verification → **verify-in-app**.
- **A reusable script or a preview/sampler harness** rather than prose → **sandbox-tool**. That
  skill builds the instrument; this one writes up what it showed.
- **Shipping the code the design doc proposes** → **worktree-create** for the isolated env, then
  **ship-pr** / **gh-stack**. A docs-site PR is usually plain `git switch -c` + `gh pr create`, not
  the stacked flow.
- **Running many parallel implementation agents** → **agent-team**. The Explore fan-out in Phase
  2 is read-only research and stays here.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
