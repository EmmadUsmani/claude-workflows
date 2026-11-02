---
name: visual-explainer
description: Build a self-contained, highly visual HTML page in <sandbox_dir> that makes one thing understandable at a glance — mode `explain` for a bug / RCA / mechanism handed to a triager or reviewer, mode `explore` for a solution space or a grid of candidate treatments rendered through the real pipeline — plus, by default, a one-pager spec sheet of the same subject; optionally publishes both as Claude Artifacts kept in sync with the local files (same path, same URL). Use for "output a visual, interactive .html explainer of the exact bug in that sandbox subdir", "write the explanation of X and your approach to a new .html file", "explain how this existing code works in an html file like the rack-builder one", "generate an html page that shows me all the example values so I can choose", "prep an exploration sampler html preview". NOT the Markdown write-ups (research-doc) and NOT the generating scripts behind a sampler (sandbox-tool) — this skill owns the page itself.
argument-hint: "explain|explore <topic>"
---

# Visual explainer

One self-contained HTML page that makes a single thing understandable at a glance —
built from verified facts, kept in `<sandbox_dir>` beside the data that proves it,
and optionally published as a Claude Artifact so it can be shared as a link.

Two modes, one core:

| mode | question it answers | typical trigger |
|---|---|---|
| **explain** | "What exactly is broken / how exactly does this work?" | a bug RCA for triage, a mechanism handed to a reviewer, an approach written up before it ships |
| **explore** | "Which of these should we pick?" | candidate visual treatments, colour or easing values, design options — every candidate rendered through the **real** pipeline |

When **bug-intake** produces an RCA (its Phase 3), this page is the visual half — expect to be
invoked by it (and by **firefighter-loop** dispatches), not only by the user.

**The shipped example** is `examples/rack-builder-stack/rack-builder-stack.html`: an `explain`
page about existing code (how `Rack::Builder` turns `config.ru` into nested middleware, at
rack/rack @ da90464), with the recorded output of the Ruby probes that checked its claims beside
it and its one-sheet in one-pager's `examples/rack-builder-stack.new.html`. Serve it (Phase 4) and read it before
writing your first page: verdict block, glossary, numbered `h2`s with claims, figures with
measured captions, a simulator checked against a recorded Ruby ground truth, the contents sidebar.

**Every explainer ships with a one-sheet.** Alongside the scrolling page, build a single
full-screen spec sheet of the same subject with the **one-pager** skill: the page is for the
reader who wants the whole argument, the sheet for the one who will look at a single image.
Both come from the same verified facts. Phase 4b owns it; skip it only when the user says so
("no one-pager", "just the explainer").

## Hard rules

- **Deliver the conclusion, not the journey.** *"skip all the long journey of debugging and
  investigation we did to get there, just give me the final explanation please."* No
  chronological debug narrative. Keep a falsified theory only when disproving it *is* part of
  the argument (the reader would otherwise ask "but isn't it just the provider?").
- **Use the real names from the code.** Actual classes, methods, `file:line` — not paraphrases
  like "the routing layer" for `Rack::URLMap`. Correction verbatim: *"can you just please use the real model
  names from our code (maybe with a brief intro explaining what each model is very briefly)."*
  That parenthetical is a requirement: a **short glossary** introducing each model in one line,
  placed before the first section that leans on it.
- **Never use ambiguous tense about a fix's state.** *"'what we now serve' language is
  ambiguous, is this what we were erroneously serving, or 'now' as in now that we fixed it?"*
  Every statement carries its state explicitly: **live in production today** / **fixed on
  branch `<x>`, not deployed** / **proposed** — or, for a page about existing code with nothing
  proposed, **as built at `<ref>`** (the branch/tag/sha you read).
- **Cite the exact source per claim, not a general link.** *"Can you please specifically link
  the exact sources where you got each statement from the docs that you mentioned? Its more
  helpful than a general docs link."* Exact doc anchor per third-party claim; `file:line` for
  code; endpoint URL + a real payload excerpt for API claims; a direct link to the raw
  artifact (the SVG, the JSON) next to the figure that discusses it.
- **Label verified vs unverified, and never guess a number.** A figure you haven't measured
  gets a loud `[PENDING] / not yet measured` callout **in the exact place it belongs**, so the
  page can't be sent half-finished and the number can be dropped in later without a redesign.
- **Show the thing; don't describe it.** If you claim two images differ, put both images on the
  page. And don't give one object two names — "the stack" and "the onion" for the same figure
  cost a correction.
- **Short sentences and bullets over prose.** *"Use simple, easy to understand language. Prefer
  shorter sentences and bullet points over lengthy, hard to digest prose."* The reader is
  skimming to make a decision.
- **The local `.html` is the source of truth.** Every revision edits the file in the sandbox dir
  — never the Claude scratchpad — and republishes from that same path. Same path = same
  Artifact URL, so say *"same URL, no new link."*
- **Publishing is a decision, not a default.** A page describing a live production defect and
  naming internal identifiers stays local unless the user wants a shareable link — offer it,
  don't assume. Never put customer/org names, emails, or prod identifiers in a page that will
  be published; use `<org_id>` placeholders. Never include unmerged/WIP work in anything shared
  (*"Don't include those in our reports, they're still WIP"*).
- **Don't touch the code while writing the page.** This skill produces a document. Fixes go
  through a worktree and **ship-pr**, on a separate go-ahead.
- **The one-sheet is part of the deliverable, not an extra.** Every explainer, in either mode,
  gets its **one-pager** sheet unless the user opts out for that page. The sheet never says more
  than the explainer: no fact on it that the page, or the sources it cites, doesn't back.

---

## Phase 0 — mode, destination, publish target

**Destination** (`<sandbox_dir>`, default `~/projects/sandbox`, ideally its own git repo with
`out/` gitignored):

| situation | path |
|---|---|
| explaining an active investigation | `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/<name>.html` — the **same dir as the investigation's scripts and JSON** |
| durable per-topic write-up, or a mechanism explainer of existing code | `<sandbox_dir>/tickets/<topic>/<topic>.html` — one subdir per topic, with the probe scripts that back it beside the page |
| exploration sampler output | `<sandbox_dir>/tickets/<name>-preview/out/` — the generator emits it (**sandbox-tool** owns the script) |

*"in sandbox move your files into their own subdir, then commit them"* — a bare
`tickets/<topic>.html` gets moved; write it into its own subdir from the start.

The one-sheet lives beside the explainer in a `one-pager/` subfolder:
`<explainer dir>/one-pager/<slug>-one-pager.{html,png,artifact.html}`. For a generator-built
sampler, that is `tickets/<name>-preview/one-pager/`, beside the generator and never inside the
gitignored `out/`; it condenses the newest run plus the README.

**Publish target, decided before the first line** — it changes the file's shape:

- **Artifact-published** → write the **fragment** form: start at `<title>`, no `<!doctype>`,
  no `<html>`/`<head>`/`<body>` (the publisher wraps it). Consequence: there is no
  `<meta charset>`, so serving it locally makes the browser guess the encoding — **every
  non-ASCII character must be normalized to an HTML entity or escape** before it renders
  correctly in both places.
- **Local-only** → the full document: `<!doctype html>`, `<html lang="en">`,
  `<meta charset="utf-8">`, `<meta name="viewport" …>`, an inline `data:image/svg+xml` emoji
  favicon. This form opens straight from `file://` for the user.

If unsure, build local-only and offer the link — converting to fragment form later is a
head-strip plus the non-ASCII sweep.

## Phase 1 — get the facts before you open the editor

The page is a rendering of an already-proven mechanism. Building one on an unverified
mechanism costs a full rewrite when the real cause turns up.

- The investigation itself → **bug-intake** (intake → RCA → remediation → fix → follow-ups; this
  page *is* the visual half of its RCA-artifacts phase, **research-doc** the markdown half);
  an image/render pipeline → **render-pipeline-debug**; production numbers → **warehouse-data**
  first, then the `<ops_bot>` if your team runs one, then **prod-script** (scrub every
  customer/org identifier before publishing); a vendor's actual API behavior →
  **vendor-api-probe**; a reproduction, a measured number or before/after screenshots →
  **verify-in-app**; a PR's context and findings → **deep-pr-review** (its visual report is this
  skill in `explain` mode, kept local); a CI/bot mechanism worth explaining → **pr-triage**.
- Have in hand, per claim: the `file:line`, the real payload, the measured number, the
  screenshot. Anything still missing becomes a `[PENDING]` slot (Hard rules), not prose.

## Phase 2 — design plan before you build

1. **Load `artifact-design` and `artifact-diagramming` first** — they own design and diagram
   craft; this skill does not repeat them. (`artifact-capabilities` only if the page needs
   runtime behavior static HTML can't give.)
2. **Pick a visual metaphor from the subject's own vernacular** and commit to it. Proven
   examples: nested **onion shells** for a middleware stack (the shipped example); a **tide
   table** (time bands, high and low marks) for a cache or TTL window; a **departures board** (one row per job, status and delay
   columns, the stuck row flashing) for a stuck job queue. The metaphor is what keeps ten rounds of
   content edits from turning into a redesign.
3. **State the plan in one message before writing — and treat it as a checkpoint.** In an
   interactive session, wait for a go/no-go unless the user already said "just build it"; when
   another skill or an unattended run calls this one, state it and proceed. Include the palette (with roles: which colour
   means *what users actually got* vs *what we expected*), type stack, layout, and the **centerpiece**:
   the one figure that is the whole argument. Include the **heading outline** (the `h2`s and
   their `h3`s): it becomes the contents sidebar, so a muddled outline shows up right away.
4. **Write down what the reader must be able to do after reading.** Triage explainer: state
   the severity, name the class to fix, and quote the blast radius. Explore page: pick a
   candidate and know the exact parameter value to implement.
5. Reuse an existing page's structure when the user points at one (*"like the rack-builder
   one"*) — read it first and match its section idiom.

## Phase 3 — write the page

Full section spines for both modes, the citation formats, and the verification snippets are in
**[REFERENCE.md](REFERENCE.md)**. In brief:

- **explain**: verdict/TL;DR (never withheld) → the symptom as the user saw it → a glossary of
  the real models → the mechanism as the centerpiece figure → where each input actually comes
  from → the fix, illustrated at the API/data level → remediation → user impact, severity
  and the measured blast radius → a footer listing the sources and the sibling scripts/JSON.
  Numbering appears only on things that genuinely are a sequence.
- **explore**: the generator that produces the candidates — e.g. a `build_sampler.rb`, its
  `MODE=`/`CANDIDATES=` env-var surface, driving candidates through the **real** production
  service chain, and proving the measurement harness against synthetic ground truth — is
  **sandbox-tool**. This skill owns what the page must say and how it is verified; that skill
  owns what fills it. The page itself: a lede that **defines every axis in prose** → a controls
  toolbar → a candidate grid where every cell carries its **exact parameter values and measured
  numbers** → a click-to-enlarge lightbox captioned with the full parameter string. A `none`
  **control row is mandatory**, and it must fingerprint identically to what ships today. State
  the bar a candidate has to clear.

Mechanics that apply to both:

- **A contents sidebar beside the document, by default, on every hand-authored page in either
  mode.** One scrolling page, with a sticky contents rail on the left from 1100px and a sticky
  "Contents" bar with a drop-down panel below that. The TOC is **built from the headings at load** (h2 entries, h3s
  nested under them), with scroll-spy highlighting the section you're in. No tabs. Copy the
  skeleton in **REFERENCE.md §8** rather than writing one. Drop it **only when the user asks**
  for a single-panel / no-TOC page. **Exempt: sampler pages emitted by a sandbox-tool
  generator** (the candidate grid rendered through the real pipeline) never get one; a
  hand-written `explore` page does.
- **A real heading hierarchy, because the TOC is generated from it.** Exactly one `h1` (the
  title); an `h2` per spine section; `h3` for subsections; `h4` for card and figure titles,
  never in the TOC. Never skip a level for looks. Every `h2`/`h3` gets a **hand-written,
  stable slug `id`** (`root-cause`, `fix-api`), since people link to them.
- **Headings are full sentences with a claim** ("The first use is the outermost layer.", "A use
  after a map never sees the mapped paths"), and every `figcaption` carries the **measurement**, not
  a restatement of the figure. The TOC rail is 220px wide, so cut the padding: a heading that
  wraps past three lines there is too long.
- **Diagrams are hand-authored inline SVG** whose `fill`/`stroke` reference the page's CSS
  custom properties, so they theme automatically; `role="img"` plus a full-sentence
  `aria-label` on each. No mermaid, no canvas, no charting library. A screenshot or vendor
  render is *evidence underneath an overlay*, never the diagram itself.
- **Explainers are self-contained**: embed every image as a base64 `data:` URI — a published
  Artifact's CSP blocks every external host except Google Fonts. Keep under the 16 MB publish
  cap (the shipped example, all-SVG, is about 50 KB; screenshots as base64 add up fast). **Sampler pages are the opposite**: they
  reference real renderer/CDN URLs or relative `renders/*.png`, are browsed locally, and
  are never published as Artifacts.
- **Theme-aware.** Define the full light palette on bare `:root`, redefine only the tokens
  under `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. Give `body` an explicit token background.
- **Interactivity earns its place.** A simulator that applies the code's real rules (the
  shipped example's Fig. 2), a sortable blast-radius table, a TTL slider that replays the window — each one exists because it
  makes a specific claim checkable. Decorative motion does not.
- **Wide content scrolls inside its own `overflow-x: auto` container.** The body never scrolls
  horizontally.
- **A sampler ships with a `README.md` beside it** — purpose in one line, the run command, an
  env-var options table, a "what to look for" judging rubric, and an explicit honesty section
  naming which parts are the real production chain and which are approximated. Outputs are
  append-only timestamped files in a gitignored `out/` (`thumbs-<%Y%m%d-%H%M%S>.html`, with
  the swept parameter in the name), kept side by side so runs stay comparable.

## Phase 4 — verify before anyone sees it

**`file://` is blocked in Playwright** — serve it on loopback, on a free port, and remember the
PID you started (other sessions run static servers too; never `pkill` by pattern):

```bash
PORT=$(node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { process.stdout.write(String(s.address().port)); s.close(); })')
cd <page dir> && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
echo $! > /tmp/explainer-server.pid; sleep 1
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/<file>.html"
```

`--bind 127.0.0.1` keeps an internal page off the LAN (the default binds every interface).

**The browser is shared, even the "isolated" one.** A Playwright MCP server is one browser for
every session that talks to it: another agent can navigate your tab, resize the viewport, or run
its `browser_evaluate` against your page mid-check, and screenshots are only written under the
MCP server's own allowed roots (often another repo's `.playwright-mcp/`). So do each check as
**one `browser_run_code_unsafe` call in a private tab**:

```javascript
async (page) => {
  const p = await page.context().newPage();           // your own tab, nobody else's
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto('http://127.0.0.1:<port>/<file>.html');
  if (!p.url().includes('<file>.html')) throw new Error('wrong page: ' + p.url());
  const result = await p.evaluate(() => ({ /* the assertions below */ }));
  await p.screenshot({ path: '<absolute page dir>/screens/fig1-light.png' });  // absolute path
  await p.close();
  return result;
}
```

When you do use the plain `browser_*` tools, check `location.href` in the same call before
trusting any value it returns.

1. `browser_console_messages` with `onlyErrors` (a local favicon 404 is expected noise).
2. **Drive the interactive logic with `browser_evaluate` and assert the computed values** —
   move the slider, click every sort header, flip every toggle, and read the numbers back.
   A screenshot cannot catch a sort indicator that accumulates across columns.
3. **Both themes explicitly**: `document.documentElement.setAttribute('data-theme','dark')`,
   or `page.emulateMedia({colorScheme:'dark'})` via `browser_run_code_unsafe`. Screenshot each
   figure plate up close — dark mode is where token bugs surface.
4. **Read the screenshots back.** Broken images, wrong badge colours, two words run together
   by collapsed flex whitespace ("statusnull") only show up when you look.
5. Sweep for non-ASCII and normalize (mandatory for the fragment form, cheap insurance
   otherwise):
   ```bash
   node -e 'console.log([...new Set(require("fs").readFileSync(process.argv[1], "utf8"))].filter((c) => c.codePointAt(0) > 127).sort())' <file>.html
   ```
6. **The contents sidebar** (snippet in REFERENCE.md §7; skip for a generator-built sampler):
   every non-mock `h2`/`h3` has an entry, no duplicate ids, and scrolling to a mid-page `h3` marks it `aria-current` with its
   `h2` expanded. At ~1280px the rail is sticky; at ~390px the bar shows the current section and
   its panel opens, links and closes.
7. Check ~390 px width for horizontal overflow, then stop the server you started:
   `kill $(cat /tmp/explainer-server.pid)` — only that PID.

## Phase 4b — the one-sheet (one-pager skill)

Build it after the explainer is verified, so both carry the same facts. Load **one-pager** and
follow it, with the explainer and its sources as the input in place of a plan:

- **What the sheet condenses** depends on the explainer:
  - an RCA or bug: the one-pager RCA/bug-fix recipe (the defect drawn, cause, fix, blast
    radius, remediation, status) — its `examples/cache-key-collision-rca.new.html` is the shape;
  - an approach or design: the default plan spine;
  - a mechanism (how existing code works, nothing proposed): the one-pager mechanism recipe
    (state, build vs run time, traces, contract, the surprise drawn, gotchas; red = the surprise)
    — its `examples/rack-builder-stack.new.html` is the one-sheet of this skill's example page;
  - an `explore` page or sampler: the exploration recipe (the axes, the candidates with their
    measured numbers, the bar a candidate must clear, the recommendation or "pick one").
- **Mode:** let one-pager infer it. An explainer revised because new evidence changed the
  conclusion is a `revision`, with the earlier verdict as Rev A.
- **Status uses the explainer's state vocabulary** (live in production today / fixed on branch
  `<x>`, not deployed / proposed / **as built** for a mechanism page — existing behaviour at
  `<ref>`, nothing proposed), but it must be **true today**. If the fix has moved on since
  the page was written (merged, rolled out), the sheet says what is true now, and the explainer
  itself is stale: tell the user and sweep the page in the same round (Phase 6), so the two never
  disagree once delivered.
- **A sampler or `explore` page has no fix state.** Use the exploration statuses in one-pager
  (`NO PICK YET`, `PICKED · <key> · NOT BUILT`, `PICKED · SHIPPED`, `SUPERSEDED · <PR>`), and check
  main for anything merged since the run that settled part of the choice.
- **Sources** are the page and what it cites (its README, scripts, JSON dumps, datafix reports).
  Prefer a production measurement over a dev-DB estimate when both exist, and label which one the
  sheet uses.
- Run `render.js` and read the PNG as one-pager requires; the explainer's Phase 4 doesn't cover
  the sheet.

## Phase 5 — publish and keep in sync

```
Artifact[publish]  file_path: <the sandbox .html>   icon: <one generic word>
```

- **Republish the same file path → the same URL.** Report it as *"updated at the same URL"* —
  a new link on every revision is the failure mode this pattern exists to avoid.
- Keep `icon` and `<title>` **stable** across redeploys; the title is a short noun-phrase
  name, not a summary.
- The published page is **private until shared**; say so when handing over the link.
- **The one-sheet follows the explainer's publish decision.** Publish both or neither. When both
  are published, the explainer's masthead or footer links the one-sheet's Artifact, and the
  sheet's SOURCE line names the explainer. Either way, send the PNG to the user, and commit the
  sheet's files with the explainer's.
- **Audience-specific deliverables when the audiences differ**: an internal visual explainer
  *and* a short partner-shareable `.md` with real captured request/response pairs, in the same
  dir. Sample payloads in the shareable doc must be **complete** — include the working case
  beside the broken one, not a truncated excerpt. Offer the second deliverable; don't assume it.
- When the explainer becomes a PR's explanation, the PR description **links the artifact** and
  carries a screenshot or two from it rather than re-explaining the bug (see **ship-pr**).
- **Sandbox writes auto-commit — never ask** (when `<sandbox_autocommit>` is on, the default, and
  `<sandbox_dir>` is a git repo; `adhoc/` and `tickets/` pages alike, each revision included).
  After each meaningful write, `git -C <sandbox_dir> add <only the paths you wrote>` and commit
  with a short descriptive message, no prompt. Never `add -A`/`.` — other sessions leave
  uncommitted work there; never commit, revert, stash or clean theirs. No remote, no push;
  secrets get gitignored, never committed. Cloud runs: the state repo's own commit rule applies
  (**cloud-runtime**).

## Phase 6 — iteration etiquette

Explainers get corrected many times; a ten-round session is normal.

- **Fix the specific thing.** On a precision correction, change the exact wording, caption or
  citation — never rewrite broadly. Then re-verify and republish.
- **New material goes in as a new section**, matching the existing style and reusing the
  established semantic classes (if cyan already means *what users actually got*, the new section's
  cards use cyan for the same meaning). Renumber sections after inserting.
- **Fold thin sections in rather than leaving stubs** when their content moves elsewhere.
- **An older explainer with no TOC gets the contents sidebar and heading hierarchy (REFERENCE.md
  §8) the next time it is revised.** Do it in the same round as the requested change. Never
  retrofit a page nobody is touching, and never retrofit a generator-built sampler.
- **When new data lands, sweep the whole page for statements that data changes** — the number,
  the severity badge, the `[PENDING]` callout, the summary line. Don't patch only the table.
  Then sweep the one-sheet the same way, re-render it and republish it from its own path: a
  stale sheet beside a corrected page is worse than no sheet.
- **When a correction reveals you were sloppy, say what was wrong before fixing it.** Silently
  re-rendering hides an error the reader may already have acted on.
- Re-verify (Phase 4) and republish after every substantive round.

---

## Verified gotchas

- **Non-ASCII + fragment form = mojibake.** No `<meta charset>` reaches the browser when the
  page has no `<head>` — normalize every non-ASCII character to an entity or escape.
- **`file://` is blocked in Playwright.** Always serve over a local HTTP server. Kill it after.
- **The Write/Edit tools turn a `\u203A` escape in your JS into the literal `›`**, and in the
  fragment form that is mojibake. Run the non-ASCII sweep after every write, not only at the end.
- **Editing an HTML file the tool hasn't read fails.** Either `Read` it first, or patch it with
  a script that **asserts the anchor string was found exactly once** (REFERENCE.md §7) — a silent
  no-match patch is the classic way an "applied" edit never lands.
- **Playwright screenshot paths land relative to the MCP server's real cwd**, which is often
  some other repo, and absolute paths outside its allowed roots are refused. The private-tab
  pattern in Phase 4 (`p.screenshot({ path: <absolute> })`) avoids both. `find`/`ls` before `Read`, and `mv` any stray screenshot out of that repo
  immediately — never leave one there.
- **Verify a caption against the actual image before writing it.** Measuring the reference
  chart turned "the chart's axis" into "a second, secondary axis on the same chart" — the
  caption was wrong until the pixels were checked.
- **Lazy-loaded images inside a `display:none` row never fire their request**, which reads as
  "still pending" in a candidate grid.
- **Always show a candidate at the size it ships**, not only as a zoomed crop — a compression
  preset that looked clean in a 4x crop showed visible banding once the image filled a
  full-width hero slot.
- **The scratchpad gets cleared between sessions.** Anything the page depends on (source SVGs,
  reference renders, JSON) must live in the sandbox dir, not the scratchpad — and the page
  should embed it rather than link to a local path.

## When not to use / hand off

- **The one-sheet itself** (layout, design system, render lint, artifact build) → **one-pager**.
  This skill decides that there is one and what it must agree with; that skill builds it. A
  one-sheet of a plan with no explainer is one-pager on its own.
- **A markdown write-up** — a note in `<notes_dir>`, a page in `<docs_site>`, a design doc →
  **research-doc**. It hands this destination back to this skill; come back to it when the same
  investigation also needs a `.md`.
- **The generating script behind a sampler** — the generator, its `MODE=`/`CANDIDATES=` env-var
  interface, driving candidates through the real production service chain, proving a
  measurement harness against synthetic ground truth → **sandbox-tool**. That skill builds the
  instrument and emits the page; this skill governs what the page has to say and how it gets
  verified and shared.
- **The investigation that feeds the explainer** → **bug-intake**, which owns the arc intake →
  RCA → remediation → fix → follow-ups; this page is one of the two RCA artifacts its `--to rca`
  phase produces (**research-doc** is the other). Also **render-pipeline-debug**,
  **warehouse-data** (then the `<ops_bot>` / **prod-script**), **vendor-api-probe**.
- **Reproducing the bug, measuring it, before/after screenshots** → **verify-in-app**.
- **A PR review's visual report** → **deep-pr-review** supplies the numbered findings and the
  "not exercised" section; build the page here, in `explain` mode, and keep it **local-only** —
  a report naming a colleague's code is never published as an Artifact.
- **Explaining a CI or bot mechanism on a live PR** → **pr-triage** owns the verdict per
  finding; come back here when the mechanism is worth a page, and link it from the PR body.
- **A page built by a delegated agent** → **agent-team**: docs agents get scope *and* tone
  constraints, and the lead verifies substance — grep for required content and for leakage of
  unmerged work, then drive the page itself.
- **Design and diagram craft** → the built-in `artifact-design` / `artifact-diagramming`
  (and `artifact-capabilities` for runtime behavior). Load them; don't reinvent them here.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
- **A multi-artboard visual design, mockup or wireframe** → the Artifact tool's `quickstart`
  with intent `design`, where your Claude Code has Artifacts; otherwise a design tool, not this
  page. A chart or dashboard → the `dataviz` skill, if installed.
- **Shipping the fix the explainer describes** → **worktree-create**, then **ship-pr** — on a
  separate approval.
- **A team-facing design doc or PRD** → your team's design-doc template, if there is one; this
  skill's page can be linked from it.
