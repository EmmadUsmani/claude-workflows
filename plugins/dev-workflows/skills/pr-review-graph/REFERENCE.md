# PR review graph — reference

§1 Page anatomy · §2 Data schema · §3 Lane presets · §4 What a node is, per stack · §5 Relations ·
§6 Change kinds · §7 Screenshot annotation · §8 Quality checklist · §9 Examples

## 1. Page anatomy

| Part | What it shows | Driven by |
|---|---|---|
| Header (one row) | repo, title, number, state pill, branches, head SHA, GitHub tabs, `+/−`, review progress | `pr` |
| Toolbar | Diff / Before / After; one filter chip per relation group the PR uses; Findings, Edge labels (`C`), Hide untouched (`X`); Review panel button with the finding count | `edges[].rel`, `findings`, `modeNotes` |
| Canvas | lane headers, boundary lines, node cards, typed edges with labels, reviewed badges | `lanes`, `boundaries`, `nodes`, `edges` |
| Legend (toggle `L`) | node kinds, the relations actually used, change colours | derived |
| Drawer (`P`, opens on click) | overview (summary, stack strip, tiles, "Worth a close look", changed-node list) or a node / edge view | everything |
| Lightbox | full-size annotated screenshot, arrow keys step through the node's set | `nodes[].images` |

Card treatments: changed nodes are solid and full strength; `unchanged` nodes are always dashed grey,
see-through and dimmed (full strength on hover or selection); reviewed nodes fade further, lose their
colour and carry a blue check badge. The PR title in the header links to the PR.

Modes: **Diff** colours by change; **Before** hides added nodes/edges (the base); **After** hides removed
ones (the head), both in neutral colours, with the `modeNotes` line shown. **Keys:** `R` mark reviewed ·
`E` next unreviewed · `A`/`D` previous/next in `order` · `X` hide untouched · `C` edge labels · `F` full view (fills the
browser, not OS fullscreen) · `L` legend · `P` panel · `Esc` close drawer, then leave full view. Review
marks and the legend choice live in the viewer's localStorage, keyed `prgraph:<repo>#<number>:`.
`page.html#<node-id>` opens that node.

## 2. Data schema

One JSON file. `scripts/scaffold.rb` writes the `pr` block from `gh`; everything else is yours.

```jsonc
{
  "pr": { "repo": "acme/todo-app", "number": 412, "title": "…", "state": "open|merged|closed",
          "author": "login", "headRef": "branch", "baseRef": "branch", "headSha": "40-char sha",
          "baseSha": "…", "additions": 640, "deletions": 52, "files": 14, "commits": 3 },
  "slug": "pr412-review-graph",            // output file name (default pr<n>-review-graph)
  "title": "#412 Review Graph",            // optional; the Artifact name
  "summary": "2–4 sentences: what the PR does, where the new code lives, what it builds on.",
  "note": "Code read at head 4c1e7a90bd. Screenshots from … Generated files left out: ….",
  "contextLabel": "Lower layer",           // the label for `context` nodes (Lower layer, Server, Vendor, Rack env…)
  "lanes": [ { "id": "screens", "label": "Screens", "note": "L1" } ],
  "boundaries": [ { "afterLane": 4, "label": "browser | server" } ],
  "stack": [ { "number": 411, "label": "shared-lists API" }, { "number": 412, "label": "this page", "current": true } ],
  "modeNotes": { "before": "What the base looks like", "after": "What ships" },
  "nodes": [ {
    "id": "sharedLists",                   // unique, used in edges/findings/order/hash links
    "lane": "screens", "row": 2,           // or "x"/"y" in px to place it by hand
    "type": "Screen",                      // the chip
    "name": "SharedLists",                 // the real identifier
    "sub": "lists/shared/SharedLists.tsx",
    "kind": "added|modified|behavior|removed|unchanged|context",
    "layer": "#411",                       // optional chip suffix (lower-layer PR, engine, vendor)
    "unused": true,                        // optional: added but nothing consumes it
    "add": 187, "del": 0,                  // optional line counts for the card
    "file": "web/src/…/SharedLists.tsx", "line": 31,
    "bullets": ["≤45 chars", "≤45 chars"],
    "summary": "…",
    "changes": ["…"],
    "sig": ["before signature or —", "after signature"],
    "facts": [["key", "value"]], "factsTitle": "State · hooks",
    "code": "c-sharedLists", "codeTitle": "Excerpts",
    "images": [ { "src": "img/a/sharedLists__after-03-empty.webp", "cap": "<b>Empty state.</b> No shared lists yet.", "side": "after|before", "wide": true } ]
  } ],
  "edges": [ {
    "id": "e10", "from": "sharedLists", "to": "sharedListsQuery",
    "rel": "render|nav|call|use|net|resolve|read|write|async|test",
    "kind": "added|removed|modified|impacted|unchanged|context",
    "label": "useQuery · cache-and-network",
    "detail": "One or two sentences for changed edges.",
    "code": "c-sharedLists"                // optional call-site excerpt
  } ],
  "findings": [ { "id": "F1", "sev": "high|med|low|nit", "node": "sharedLists", "alsoNodes": ["pagination"],
                  "title": "…", "text": "The defect and the fix, one paragraph." } ],
  "order": ["sharedLists", "listRow", "…"], // review order; defaults to changed nodes by lane
  "code": { "c-sharedLists": ["@ SharedLists.tsx:31", "+const SharedLists = () => {", " context line", "-removed line"] }
}
```

Code lines start with `+` added, `-` removed, a space for context, or `@` for a hunk header (shown
as `@@ <text>`); `scripts/excerpt.rb` writes them. Captions (`cap`) may contain `<b>`; every other
string is escaped.

Field notes:
- `row` may be fractional (`1.5`) or negative; `y = row × 160`. `--optimize-rows` rewrites rows.
- `x`/`y` place a node by hand and take it out of `--optimize-rows` (e.g. a dense cluster you want to arrange yourself).
- `add`/`del` are per node; leave them off when one file is split across nodes.
- `unused` goes on an added unit nothing consumes, or a modified one whose new member nothing reads.
- `order` lists changed nodes only; unchanged and context nodes are never "reviewed".
- Lengths the card can show: `name` ≈ 24 characters, each bullet 45, an edge label ≈ 32.

## 3. Lane presets

Left = where a request, render or command enters; right = where it ends (storage, network, vendor).
Adapt names to the codebase's own vocabulary; drop lanes the PR doesn't touch.

| Stack shape | Lanes (left → right) | Boundary |
|---|---|---|
| SPA / frontend layer | Route · menu → Screens → Components → Shared · leaf → Hooks · utils → API docs (GraphQL/REST clients) → Server (`context`) | after API docs: browser \| server |
| Server monolith (Rails, Django, Laravel…) | Entry (routes, controllers, GraphQL mutations/resolvers, jobs, rake/CLI, admin) → Services → Models (incl. callbacks, concerns) → Persistence (tables, migrations, indexes) → External (vendor clients, mailers, queues, ENV/config) | before External: app \| vendor |
| Full-stack PR | Screens → Components → Hooks/API docs → *boundary* → Resolvers/endpoints → Services → Models/tables | browser \| server |
| Service / microservice (Go, Node, Python…) | Transport (HTTP/gRPC handlers, consumers) → Handlers/use cases → Domain → Repositories/clients → Datastores/brokers | service \| datastore |
| Library / SDK | Public API → Internal modules → Helpers | public \| internal |
| Data / batch pipeline | Trigger (schedule, event) → Steps → Transforms → Sinks (tables, files, topics) | job \| storage |
| Infra / config PR | Entry config → Resources → Dependents → Consumers | — |

- **Specs** sit in their target's lane, in rows below the main graph (or beside the target), not in a
  Tests lane: a far-right lane makes every `test` edge run under the cards on its row. A Tests lane is
  fine only when the specs' targets all sit in the lane next to it.
- **A thin side** (1–3 files on one side of a full-stack PR) gets one lane: Screens and API docs together.
- **Edges pointing left are fine** when the code really calls back up the lanes (a model callback
  enqueuing an entry-lane job).

## 4. What a node is, per stack

A node is what a reviewer reads as one unit. Choose the coarsest grain at which the dependencies
differ.

| Stack | Typical nodes |
|---|---|
| React / Vue / Svelte | screen/page, component, custom hook, util module, GraphQL/REST document, store slice, route entry, shared component it touches |
| Rails | controller action group, GraphQL type/field/mutation, service object, model (or a concern, a callback, a scope when it carries the change), job, mailer, migration, table, admin page, helper, rake task, ENV/credential read, spec file |
| Django / Flask / FastAPI | view/router, serializer/schema, service, model, migration, task, test module |
| Go / Rust / Java services | handler, use-case/service, interface + implementation, repository, client, proto/schema message, migration, test file |
| Libraries | public function/class/type, internal module, test file |
| SQL / data | table, view, migration, query, job step |
| Config / infra | config file section, resource, the code that reads it |

## 5. Relations

| `rel` | Line | Means | Examples |
|---|---|---|---|
| `render` | solid | composes / renders / mounts | component renders child; layout includes partial; admin page renders a component |
| `nav` | dash-dot | routes or links to | menu item → screen; route → controller; CLI subcommand → handler |
| `call` | solid thin | direct call, or a framework hook firing | service calls service; handler calls use case; `after_create_commit` runs a callback (edge from the writer, `impacted` when the writer is unchanged) |
| `use` | dashed | uses a hook, helper, util, mixin, concern, or a field of fetched data | component uses hook; class includes a concern; a component reads `post.author.avatarUrl` that a resolver fills (label it with the field) |
| `net` | dotted, heavy | crosses the network | GraphQL/REST/gRPC request, HTTP client call to a vendor |
| `resolve` | solid hairline | the server side that answers a network edge | GraphQL document → resolver field; REST client → controller |
| `read` | short dash | reads persisted state | query, `find`, cache read, file read |
| `write` | solid heavy | writes persisted state | insert/update/delete, migration altering a table, cache write |
| `async` | long dots | enqueues or publishes | job enqueue, event publish, webhook dispatch, `refetchQueries`-style deferred effects |
| `test` | fine dash | a test that pins the unit | spec file → service |

Relation groups (toolbar filters): Structure (render, nav) · Calls (call, use) · Network (net,
resolve) · Data (read, write) · Async · Tests. Only groups the PR uses appear.

## 6. Change kinds — deciding the hard cases

- A file renamed with edits → `modified` with the new path; mention the old path in `changes`.
- A shared unit whose diff is one prop but whose behavior for every caller changed → `behavior`, and
  its callers' edges `impacted`.
- A feature deleted from inside a surviving unit (a helper, a mode, a rail) → its own `removed` node,
  attached to the survivor by a `removed` edge.
- An added endpoint/query/export nobody calls in this PR or above it → `added` + `"unused": true`.
- A lower-layer PR in the same stack → `context` nodes with `"layer": "#<n>"`.
- A call that sits inside a prop (`badges={tileBadges(template)}`) → two edges: the `render` edge
  (its own kind) and a `call` edge for the call (`added`/`modified` as the call changed).
- An unchanged caller of a function whose return value grew (a new field it now passes through) →
  `impacted`.
- Code moved from one unit to another (a function body extracted into a new method, the old one
  now a one-line delegate) → the old unit `modified`, the new one `added`; keep the old outgoing
  edges as `removed` and draw the same dependencies again from the new unit as `added`, so Before and
  After both read correctly. Unchanged callers of the old unit get `impacted` edges, and an untouched
  spec suite that pins it is the regression net — give it an `impacted` `test` edge.
- A framework hook (an ORM callback, a lifecycle method, middleware) → `call` from what triggers it;
  `impacted` if the trigger's code didn't change.
- ENV / credentials / a feature flag the new code branches on → a `context` node with a `read` edge.

## 7. Screenshot annotation (`scripts/annotate.rb`)

```json
{
  "source_dir": "<sandbox_dir>/adhoc/<run>/screenshots",
  "output_dir": "img/a",
  "max_width": 1280,
  "shots": [
    { "node": "sharedLists", "src": "after/03-empty.png", "boxes": [[96, 180, 640, 64], [760, 120, 140, 40]] }
  ]
}
```

- Boxes are `[x, y, width, height]` in the source image's pixels (a 1280×800 CSS-scale capture has
  1280×800 pixels; check with `magick identify`). The script pads each box by 4 px, dims everything
  outside the boxes slightly, and draws a red rounded ring with a soft glow.
- Output names are `<node>__<dir>-<file>.webp`, relative to the spec's directory; put that path in the
  node's `images[].src`.
- Measuring: open the image, read the element's edges off the pixels, and box the element plus its
  trigger when the point is the interaction (menu + its button, toast + the click that raised it).
- `side: "before"` captures come from the base, `after` from the head; pair them in the node's list
  (before then after) so the drawer shows them side by side.

## 8. Quality checklist

- [ ] Every changed, non-generated unit is a node; folded or skipped units are named in `note`.
- [ ] Every edge cites a line you read; changed edges have `detail` and, where useful, `code`.
- [ ] Two bullets per card, ≤ 45 characters; names are real identifiers.
- [ ] Every changed node has a summary and a verbatim excerpt.
- [ ] Lanes read left → right in dependency order; `build.rb` reports no overlaps.
- [ ] `order` walks entry → leaves.
- [ ] Findings (if any) map to the node where the fix goes; high/med ones are the top of the drawer.
- [ ] Every screenshot is boxed on its node's element, captioned only with what it shows.
- [ ] One rendered look with a node open; no console errors.
- [ ] Published private; sandbox paths committed (when `<sandbox_autocommit>` is on).

## 9. Examples

| File | Shape | Notes |
|---|---|---|
| `examples/fastify-pr7139-head-web-response.data.json` | **Review mode.** fastify/fastify#7139, a bug fix in a Node framework (open when reviewed): an onSend hook gains a web-`Response` branch, a log controller gains an overridable method, plus its d.ts, and three spec/type-test files. Lanes Route setup → HEAD onSend hook → LogController → Reply pipeline → Leaves · runtime, boundary `fastify \| runtime` | 16 nodes, 16 edges, 3 findings (two with `alsoNodes`, one nit), 12 excerpts, `order` over the 7 changed nodes, runtime APIs (`Response`, `ReadableStream#cancel`, `Buffer.byteLength`, a logger, a server option) as `context` nodes, a `behavior` node whose input changed, a `removed` edge beside its replacement. No screenshots. Zero warnings |
| `examples/rack-pr2497-multipart-parser-config.data.json` | **`--explain` mode.** rack/rack#2497, merged library PR: a public method body moved into a new class method with overridable default hooks, a new per-request config lookup, a default subclass, one new spec. Lanes Request API → Request config → Multipart → Multipart::Parser → Parser defaults → Rack env, boundaries `Request \| Multipart` and `code \| env hash` | 21 nodes, 27 edges, 15 excerpts, no findings, no screenshots, `lane` + `row` from `--optimize-rows`. Shows `removed` edges kept beside their `added` replacements, `impacted` edges into an unchanged caller and an unchanged spec suite, env keys as `context` nodes with `read`/`write` edges, and a subclass override as a `use` edge. Zero warnings |

Neither example has screenshots (both PRs are libraries with no visible surface). For the
`annotate.rb` spec format see §7; output paths go in `nodes[].images[].src` as in §2.
