# one-pager — reference

The design system, component snippets, layouts and panel archetypes behind `SKILL.md`. Snippets
are lifted from the sheets in `examples/` and from `assets/template.html`; copy from those files
when in doubt. Section 8 indexes the examples.

---

## 1. Design system

**Metaphor:** an engineering drawing sheet (aircraft or mechanical spec): one 1.5px frame, a
header band, numbered panels separated by hairlines, and a title block bottom-right. Minimal,
polished, dense. No zone-tick border (1–8 across, A–F down): it was dropped so the content gets
the space.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f5f6f3` | page behind the sheet |
| `--sheet` | `#fbfbf9` | the sheet |
| `--ink` | `#16191d` | text, frames, primary strokes |
| `--ink-2` | `#4a5058` | secondary text, notes |
| `--ink-3` | `#7b828b` | labels, types, meta |
| `--rule` / `--hair` | `#b9bec4` / `#dde0e3` | panel sub-rules / table hairlines |
| `--sig` / `--sig-wash` | `#d1431c` / `#fbe9e3` | the ONE signal colour and its wash |
| `--tint` | `#eef0ec` | table header strips, interface boxes |

**Type:** `IBM Plex Sans Condensed` (prose, diagram notes) + `IBM Plex Mono` (identifiers, code,
meta). Scale at the 1680 canvas: h1 26px caps · panel heading 13px caps tracked .09em · body
12–12.5px · SVG notes 10.5–11.2px · code 10.2–10.6px · labels 8.5–9.5px mono uppercase tracked
.1em. Never below 10px for content or 8.5px for labels.

**Strokes:** frame 1.5px; inner border and panel dividers 0.75px; sub-rules 0.5px; diagram boxes
0.75px, or 1.4–1.6px when emphasised (owner, changed, new); arrows 0.9px. Dashed means
"implements", "optional", "reused / existing" or "external store / schema"; say which in a note
when it isn't obvious.

**Signal colour discipline:**
- `revision`: red = what changed in the current revision. Changed boxes get a red border and a △
  delta, the current revision row is red, and one sentence may be red.
- `new`: red = the new parts against what exists. When nearly everything is new, draw existing and
  reused pieces dashed and grey and the new ones solid with red borders, so the contrast still
  reads (`rate-limiter.new.html`: `api_keys` and the Redis hash dashed, the new tiers table red).
- RCA / bug sheet: red = the fault (the wrong key, the bad step, the faulty value) and the
  verdict sentence. The fix is drawn in ink, not red (`cache-key-collision-rca.new.html`).
- Mechanism sheet (how existing code works, nothing new, nothing broken): red = the surprise —
  the one step or branch a reader would predict wrong (in `rack-builder-stack.new.html`, the
  pending map flushed into `@use`, and the layer a mapped path never reaches). Everything else is
  ink; there is nothing to mark as new.
- More than about a sixth of the sheet in red means it has stopped meaning anything.

## 2. Components

**Panel shell**
```html
<section class="panel">            <!-- .r on the last column, .b on the bottom row -->
  <div class="ph"><span class="n">01</span><h2>Data model</h2>
    <span class="delta" data-rev="B"></span>      <!-- revision mode, changed panels only -->
    <span class="s">Postgres &middot; red = changed in B</span></div>
  <!-- one diagram or one stack of blocks -->
</section>
```
An SVG that shares a panel with other blocks needs an explicit height (`style="height:300px"`) or
it takes the whole row.

**ERD table card** (SVG; header strip, mono columns with grey types)
```html
<rect x="0.5" y="0.5" width="200" height="74" fill="#fff" stroke="#16191d" stroke-width="0.75"/>
<rect x="0.5" y="0.5" width="200" height="18" fill="var(--tint)" stroke="#16191d" stroke-width="0.75"/>
<text x="8" y="13.5" class="m" font-size="10" font-weight="600">table_name</text>
<text x="8" y="34" class="m" font-size="9.5">id <tspan fill="#7b828b">bigint PK</tspan></text>
<text x="8" y="49" class="m" font-size="9.5">owner_id <tspan fill="#7b828b">FK NN &middot; CASCADE</tspan></text>
```
Variants:
- **Owner / central:** 1.6px stroke, solid ink header (`fill="#16191d"`), header text
  `fill="#fff"` (`notification_deliveries` in the revision example).
- **New or changed:** `stroke="var(--sig)" stroke-width="1.6"`, `--sig-wash` header, a right-aligned
  `NEW` or `NEW · any job class` tag.
- **External store / existing schema / code constant:** `stroke-dasharray="3 2"` (a Redis hash, a
  table this plan doesn't touch, a `DEFAULT` constant that stands in for a row).

For the main table, use a two-column body (name at x+8, type at x+120…150, `<g class="m"
font-size="9.6">`), then a hairline and `UNIQUE (…)` / "Removed vs Rev A:" lines in condensed
10.8px. Columns that changed can be red (`fill="var(--sig)"`) instead of carrying deltas; a new
column on an existing table can be a red `+ column_name` row.

**Relationship line** (crow's feet)
```html
<line x1="251" y1="70" x2="300" y2="70" stroke="#16191d" stroke-width="0.9" marker-start="url(#one)" marker-end="url(#many)"/>
<text x="259" y="62" class="m" font-size="8.5" fill="#7b828b">1 : N</text>
```
`#one`, `#many` and `#ar` (arrowhead) are defined once, in the first SVG's `<defs>`. A reference
with no foreign key (an id inside a jsonb column) is a dashed line with no markers and a label
saying so ("args.delivery_id · no FK").

**SVG delta marker** (top-right corner of a changed box)
```html
<g transform="translate(501,-10)"><path d="M0,13 L7.5,0 L15,13 Z" fill="var(--sig)"/><text x="4.3" y="11.2" class="m" font-size="7.5" font-weight="700" fill="#fff">B</text></g>
```

**Boundary line** (where layer-, provider-, store- or backend-specific code starts)
```html
<line x1="0" y1="150" x2="516" y2="150" stroke="var(--sig)" stroke-width="1.1" stroke-dasharray="6 4"/>
<text x="0" y="143" font-size="10.5" font-weight="700" fill="var(--sig)">&#9650; STORE-NEUTRAL &#183; middleware, limiter, headers</text>
<text x="0" y="164" font-size="10.5" fill="#4a5058">&#9660; STORE-SPECIFIC &#183; adapters only</text>
```
Keep captions under about 50 characters. Cross the line with **vertical** arrows placed past the
captions' right end, or right-align the captions (`text-anchor="end"` at the right edge) when the
arrows sit on the left. A plan with two boundaries (entry per source, shared middle, delivery
per source) gets two dashed lines.

**Call box** (a method on a class): mono 9.3–10px bold first line `Class#method(args)`, mono 9px
grey second line saying what it returns or delegates to. Label arrows between call boxes with the
argument or condition (`api_key`, `decision`, `:retry`, `implements`, `hit` / `miss`).

**Trace steps** (HTML)
```html
<div class="lbl" style="margin-bottom:4px">R &middot; every API request</div>
<div class="trace">
  <div class="step"><span class="i">R2</span><span class="t">key = <b>key_for</b>(env) &#8594; key:&lt;id&gt; | ip:&lt;addr&gt;<br><small><b>Why the IP fallback:</b> anonymous traffic is limited too</small></span></div>
  <div class="step sub"><span class="i">R3</span><span class="t">tier = <b>TierResolver#for</b>(api_key)</span></div>
</div>
```
Prefix letters by path: W write, R read/request, S switch/state, J job, F failure, M migration,
U upload, D derive, P publish/place, A admin, H history (RCA), K rollback/replay, T tests. Define
any new letter in the `.lbl` line, and pick letters that don't clash with the plan's own prefixes
(if its PRs are E1–E5, the editor path isn't E). `.sub` (dashed circle) = an inner step of the
step above. `<small>` = the one-line why. A changed step in revision mode gets an inline
`<span class="delta" data-rev="B"></span>`; the faulty step in an RCA gets its `<small>` in
`color:var(--sig)`.

**Code box:** `<div class="box code">` with `<span class="k">` keywords (red), `<span class="c">`
comments (grey), `<b class="b">` defined names. Keep lines under about 60 characters; a box that
is too tall is clipped at the bottom, and the lint reports it. A raw HTTP exchange (status line,
headers, body) works as a contract code box.

**Why notes** (every panel gets at least one; pick the form that fits the panel):
- **Panel-foot note** (under a diagram): a mono label then one to three lines of reason.
  ```html
  <div class="why"><span class="lbl">WHY FAIL OPEN &middot; D6</span>
    <p>A limiter outage must not become an API outage. The 50 ms timeout caps what a slow store can add.</p></div>
  ```
  Inside an SVG, the same shape as text: an 8.5px mono `WHY …` label, then condensed 11.2px lines.
- **Bullet lead** (in a list): `<li><span><b>Why a token bucket &middot; D1:</b> a fixed window
  lets twice the limit through across a window edge.</span></li>`.
- **Key-WHY box** (one per sheet, at most two): the decision the whole sheet turns on, in a
  red-bordered box: `<div class="why key"><span class="lbl">SEVERITY: HIGH</span><p>…</p></div>`.
- **Key-WHY box inside an SVG panel:** a rect with `stroke="var(--sig)" stroke-width="0.75" fill="none"`,
  an 8.5px mono label in `fill="var(--sig)"`, then condensed 11.2px lines in ink, 9px inside the rect,
  ending in the sheet's one red sentence.
- **Trace step:** append the reason to the step's `<small>` as `<b>Why …:</b> one line` (put a space
  after any `<br>` before it). Give a reason to the one or two steps that surprise a reader, not
  every step: trace panels are already full.
- **Rejected alternative:** say it in the same note ("own table, not jsonb: …", "rejected: the
  queue's own dead set …"). This is often the most useful why on the sheet.
- Keep each to three lines. The full argument stays in the plan; the label points to it.
- **Move a reason, don't repeat it.** If the panel already states the reason in passing, turn that
  line into the WHY instead of adding a second copy; each reason appears once on the sheet.
- **The `no-why` advice only checks that a panel says "why" somewhere.** A heading like "WHY IT
  HAPPENED" or "the sources don't say why" satisfies it without giving a reason, so read each panel:
  the question is whether a reviewer learns the reason for that panel's key choice.

**Bullets:** `<ul class="inv"><li><span>…</span></li></ul>`, bold the lead phrase; `O1`, `O2` for
open questions; `Risk:` / `Accepted:` / `Removed vs Rev A:` / `Follow-up:` as lead phrases.

**Data table** (blast radius, decisions, a request/response map): `<table class="t">` with
`th.n` / `td.n` for right-aligned mono numbers, `tr.tot` for a total row, `.g` for grey cells.
A number nobody measured is a grey `[PENDING]` cell with "not measured" as its source.

**Stack / rollout strip** (06's middle band, or under a trace):
```html
<div class="stack" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
  <div><span class="k">L1 &middot; S</span><span class="v">tiers table + resolver</span><span class="s">inert</span></div>
  <div class="sig"><span class="k">L3 &middot; M</span><span class="v">Redis store + headers</span><span class="s">the switch</span></div>
</div>
```
In revision mode `.sig` marks the reworked layers (`reworked &#9651;B`); in an RCA keep the strip
in ink (merge → release → disclose), since red there means the fault.

**Wireframe callouts:** grey SVG boxes with real labels and numbered circles, then
`<ol class="co"><li><b class="n">1</b><span>what it is and which part of the plan it comes
from</span></li></ol>` (two columns).

**Title block:** `.tb` cells separated by grid-gap hairlines: TITLE (`.w3`), PROJECT, DWG, REV
(red), STACK, DATE (the current revision's date), SHEET, SOURCE (`.w3`).

**Mechanism figure** (05): a 140–160px-wide SVG beside the code. Draw the mechanism with the
plan's own quantities, label every mark, and add a 3-line legend under it. Proven figures:
- tokens over time for one key: capacity line, burst, empty (429) zone, refill slope (rate limiter);
- retries per minute after an outage, synchronized spikes vs a jittered band, marked "shape only ·
  not to scale" because the plan gives no numbers (job retries);
- the symptom drawn as two callers sharing one cache entry, the second served the first one's output (cache-key RCA);
- nested shells for a middleware fold, with the request path through them and the skipped layer marked (Rack::Builder mechanism);
- a state diagram of polling or job states;
- a timeline of incident windows (an ops remediation).

## 3. Layouts

All at 1680x1050, header 82px, body below. Grid values go on `.body`.

| Layout | `.body` grid | When |
|---|---|---|
| **3x2 default** | `columns: 560fr 540fr 520fr; rows: 538px minmax(0,1fr)` | the spine; most plans |
| **hero + 4** | `columns: repeat(4, 1fr); rows: 538px minmax(0,1fr)`, 01 `grid-column: span 2` | one dominant diagram |
| **wide top** | `columns: repeat(3, 1fr); rows: 470px minmax(0,1fr)`, 01 `grid-column: span 3` | a long flow or timeline |
| **4x2** | `columns: repeat(4, 1fr); rows: 1fr 1fr` | 8 small panels, decision-heavy plans |
| **2 + 3** | `columns: 1fr 1fr; rows: 538px minmax(0,1fr)`, bottom row a nested 3-col grid | two hero diagrams |

Fix `.r` / `.b` when the layout changes, so only interior borders are drawn. A 16:9 sheet
(1920x1080) is available for slides: change `<meta name="one-pager:size">` and `.canvas` together.

## 4. Panel archetypes (substitutions for the spine)

| Plan genre | Replace | With |
|---|---|---|
| No persistence | 01 | **Component map**: modules or components, arrows labelled with props, events or calls; new solid, reused dashed |
| Ops / datafix / remediation | 01, 04, 05 | **Windows + blast radius** (timeline + `table.t` of populations with sources), **Retire/replace** before → after, **Where it lives** (copy → handler table), **Decisions**, **Rollback** (K steps) |
| Bug fix | 01, 04, 05 | **The defect drawn** (input → bad output → fixed output, with measured values), **Where the fix lives** (pipeline with the new step), **Scope / cache key** (what changes, what stays byte-identical) |
| Migration / backfill | 01 | **Before → after schema** with red on changed columns; a **cutover** trace |
| UI-heavy | 05 | **Wireframe** with numbered callouts (`ol.co`) and the route code |
| Async / pipeline | 02 | **Pipeline**: stages left to right; request vs background split by a dashed line; retry and idempotency notes |
| State machine | 05 figure | **States and transitions**, arrows labelled with the event or method |
| Decision-heavy | 06 bullets | **Decisions** table with the plan's own labels |
| Stacked rollout | 06 middle band | **Stack strip** (`.stack`) or a 3-row PR table |
| Vendor / API probe | 04 | **Request/response** pair: method + URL, load-bearing fields bolded |
| RCA / incident (a visual-explainer `explain` page) | spine | **Verdict** in the header dek; 01 **the symptom drawn** (what the user saw, with the real evidence image or measured numbers, plus the reproduction); 02 **mechanism** (the code path with the faulty step in red); 03 **why it happened** (history and reproduction traces, what was ruled out); 04 **the fix** at the API or data level, with its state; 05 **blast radius** (`table.t` of populations and sources) and severity in the key-WHY box; 06 **remediation + follow-ups**, a rollout strip and the title block. See `cache-key-collision-rca.new.html` |
| Mechanism / how it works (a visual-explainer `explain` page about existing code) | spine, re-aimed | Header dek = the mechanism in one sentence, ending on the surprise; status `AS BUILT · NOTHING PROPOSED` (or `AS BUILT · <ref>`). 01 **what it stores** (the state the mechanism builds, with the surprising entry red); 02 **when things happen** (build time vs request time, or setup vs steady state, split by the boundary line); 03 **trace paths** (load, build, request, teardown — real calls with `file:line`); 04 **the contract** (the API or DSL the reader writes against); 05 **the surprise drawn** (the figure that makes the counter-intuitive case obvious, measured by a probe); 06 **guarantees and gotchas** (what the code promises today, what to do about the surprise), and the title block. Every fact is backed by a probe or a spec, named in the panel. See `rack-builder-stack.new.html` |
| Pull request (deep-pr-review) | spine, re-aimed at the PR | Header dek = the PR's goal in one line (the user-visible or system outcome, not the diff); kicker "UI layer of a stack" / "Backend change" / "Full-stack feature". 01 **what it stores or reads** (the tables/fields it adds, or the API contract it consumes from a lower layer, existing parts dashed; with no migrations, the existing tables it now writes rows into, those rows in red; the contract folds in here rather than taking its own panel); 02 **the system it touches** with the PR's new units in red and its boundary (browser \| server, app \| engine \| vendor); 03 **trace paths** for the PR's main flows, numbered, real calls; 04 and 05, in either order, **the mechanism** the PR hinges on (a query shape, a state machine, a gesture window, a threshold rule) and **how it's used** (the consumer, the screen as a wireframe, the job schedule, a table of the read sites) — when the PR has two mechanisms and its consumer is already the screen in 02, both go to 04 and 05; 06 **guarantees, rollout and what it leaves for later** (the stack strip, or for a single PR a rollout strip: merge → config → first effect) and the title block. When the product's own UI uses red (a negative balance), draw it red and label it, so it isn't read as the signal colour. The sheet's key-WHY box goes on the mechanism panel; 02's why then argues the boundary or batching choice, so the two don't repeat one decision. No review findings: the sheet explains the change. See `pr2497-multipart-parser.new.html` |
| Exploration (a visual-explainer `explore` page or sampler) | spine | 01 **the axes** defined in one line each; 02-04 **the candidate grid** condensed (control row first, each cell with its parameter string and measured number); 05 **the bar** a candidate must clear and how each one did (when the sampler is judged by eye with no score, list the rubric checks and say so; never invent a verdict); 06 **the recommendation** (or "pick one") and the exact parameter value to implement. A large grid condenses better as one panel per candidate family plus one for the test set (inputs, fixtures) |

## 5. Revision mode specifics

- **Revision table:** REV A = what existed and what sent it back (about 60 mono characters fits
  before the cell clips); REV B (`.cur`, red) = the changes, `&middot;`-separated; key row = what
  △B means, plus the status in its last cell. Later revisions add rows (C, D), and the delta
  letter follows.
- **Delta budget:** heading deltas only on panels whose substance changed; element deltas only on
  new or reshaped boxes, rows and steps, about 8 per sheet at most, headings included. Red columns
  inside an already-marked table don't need their own deltas. If every panel changed, drop the
  heading deltas and write "All panels revised · △B marks changed elements" in the key row.
  Removed things get a "Removed vs Rev A:" line, never a delta.
- **Every changed decision gets its WHY**, using the plan's reason. In revision mode the why is
  usually "what was wrong with Rev A" ("Rev A retried every exception, so a permanent 4xx got 25
  tries"), which is exactly what a reviewer of the revision wants to read.
- **Rev A facts** come from Rev A's plan or its built code (the code wins when they drifted), never
  from Rev B's summary of it. An earlier plan version in git history counts as Rev A only if it was
  shared, reviewed or built. Same-day drafting is internal history, so the sheet stays `new`.

## 6. New mode specifics

- Header right is the `.status` block: STATUS (from the Phase 0 vocabulary), DELIVERY (PRs or
  phases), CODE READ AT (branch @ sha from the plan), NUMBERS (sources, or "none measured · plan
  estimates").
- No deltas. Red marks the new pieces against existing ones (§1).
- 06 leans on open questions, risks and what is deferred, since nothing has been reviewed yet; its
  middle band carries the delivery plan (stack strip or PR table) rather than an empty spacer.

## 7. Sizing cheatsheet

- Mono 9.5px ≈ 5.8px per character; mono 10.6px ≈ 6.4px; condensed 11px ≈ 5.2px; condensed 12px
  ≈ 5.7px. Size a box from its longest label plus 16px. The lint flags a label within 5 units of
  its box's right edge.
- Top-row panels give about 536x470 (01), 516x470 (02) and 500x470 (03) SVG units at the default
  columns. Bottom-row panels have about 355px of height under the heading.
- Keep 6px clear inside every viewBox edge for descenders and stroke widths.
- The header dek holds one line of about 150 condensed characters at 13px; a second line overflows
  into the panels (the lint reports `header-overflow`).
- The revision table's description cell fits about 60 mono characters at 9.5px.
- A top-row trace panel fits about 14 two-line steps. A `table.t` row in a bottom panel is about
  22px tall, 36px when it wraps.

## 8. Examples, by genre and mode

Every sheet in `examples/` is a finished, lint-clean sheet with a WHY on every panel (look at how
each panel states its reason as much as at the layout). Three are built from **illustrative plans
for fictional projects** — the names, PR numbers and SHAs are invented to show the form, and each
sheet's SOURCE line says so. Two are built from real public code and cite it: the PR sheet
(rack/rack#2497) and the mechanism sheet (rack/rack `Rack::Builder`, the one-sheet of
visual-explainer's `examples/rack-builder-stack/` page, whose probe scripts back its numbers). Copy from the one closest to your plan's genre and mode, then render it
(`--out` into your scratchpad) to see it.

| File | Mode | Genre | Look at it for |
|---|---|---|---|
| `rate-limiter.new.html` | new | feature (model + middleware + HTTP contract) | the default spine; an ERD mixing a new table, an existing one and an external store; a store boundary with three adapters and the key-WHY box; three trace paths (request, admin, failure); a raw HTTP contract; the token-bucket figure; a stack strip with the switch layer in red |
| `job-retry-v2.revision.html` | revision | feature reworked after review | Rev A / Rev B table; the delta budget (four headings, four elements); red columns instead of deltas; "Removed vs Rev A"; review labels (R1–R5) on every why; a queue-backend boundary; a class-level DSL as the contract; a "shape only" figure; an accepted risk |
| `pr2497-multipart-parser.new.html` | new | pull request (a library change, from deep-pr-review) | the PR recipe on real code: goal-as-dek, status `MERGED <date>` with the head/base SHAs, 01 as the env contract the PR reads (existing keys dashed, the new key red), 02 the Request \| Multipart boundary with added/modified units red and unchanged ones dashed, the PR body quoted as the why, the key-WHY on the mechanism panel, a precedence table as "how it is used", a merge → release → first-effect strip; no findings, no author name |
| `rack-builder-stack.new.html` | new | mechanism / how it works (a visual-explainer `explain` page) | the mechanism recipe: `AS BUILT · NOTHING PROPOSED`, red = the surprise, state as an ERD-style card, a build-time vs request-time boundary, four trace paths with `file:line`, the fold drawn as nested shells, gotchas in 06; every claim backed by a probe case |
| `cache-key-collision-rca.new.html` | new | RCA / bug fix (a visual-explainer `explain` page) | the RCA recipe: verdict dek, the symptom drawn with the reproduction, the faulty step in red and the fix in ink, history trace + ruled-out list, blast-radius table with a `[PENDING]` cell, severity in the key-WHY box, a rollout strip; status for a library (`FIX ON BRANCH · NOT RELEASED`) |

For a genre with no example (ops/remediation, UI-heavy, exploration), start from the spine
example and swap panels per §4.
