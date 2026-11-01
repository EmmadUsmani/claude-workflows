---
name: pr-review-graph
description: Build an interactive review graph of a pull request — one dark, pannable page where every code unit the PR adds, changes or removes is a node in left-to-right lanes (entry points → logic → data/external), every dependency is a typed edge (renders, calls, uses, network, resolves, reads/writes, async, tests) coloured by how the PR changed it, and a review drawer shows each node’s summary, verbatim diff, findings and annotated screenshots, with Diff/Before/After modes. Any language. Built from a JSON data file by the bundled scripts (scaffold, excerpt, build + validate + lay out, annotate) and published as a private Claude Artifact; deep-pr-review builds one by default. Use for "make the diagram review artifact for this PR", "build the review graph for PR 123", "a review map of the changed methods and what calls them", "add the screenshots to the graph with boxes on the right element". NOT the review doc (deep-pr-review), NOT a mechanism explainer (visual-explainer), NOT a plan one-sheet (one-pager).
argument-hint: "<PR url or number> [--explain] [--findings <review doc>] [--screenshots <dir>] [--no-publish]"
---

# PR review graph — a pull request as a map of its code units

One page that lets a reviewer see the whole PR at once and then walk it node by node:

- **The canvas.** Lanes left to right from entry points to storage and external systems. Each changed
  unit is a card coloured by its change kind, with one hop of untouched context around it. Edges say
  *how* two units depend on each other (line style) and *how the PR changed that* (colour).
- **The drawer.** Click a node: what it is and why it changed, the findings on it, before/after
  screenshots with a red box on its element, signature before/after, key facts, the verbatim diff, and
  what it depends on / what depends on it. Click an edge: the call site.
- **Review state.** Mark nodes reviewed (`R`), jump to the next unreviewed (`E`), step through the
  review order (`A`/`D`). Reviewed nodes fade and carry a check badge that stays readable zoomed out.

**Worked examples** (REFERENCE.md §9). Open the closer one before writing a new graph:
- `examples/fastify-pr7139-head-web-response.data.json` is fastify/fastify#7139, a **review-mode**
  graph. It is a 7-file bug-fix PR in a Node framework: a hook gains a new branch, a log controller
  gains a method, and there are types and three spec files. It has 16 nodes, 16 edges and 3 findings
  (F1 and F2 with `alsoNodes`, F3 a nit), runtime APIs as `context` nodes, and no screenshots. Read it
  for findings pills, the "Worth a close look" list and `order`.
- `examples/rack-pr2497-multipart-parser-config.data.json` is rack/rack#2497, an **`--explain`**
  graph of a 4-file library PR. It moves a function body into a new class method and makes that
  method configurable per request. It has 21 nodes in 6 lanes and 27 edges, including `removed`
  edges kept beside their `added` replacements, `impacted` edges, and env keys as `context` nodes.

Both validate with zero warnings. To build one, write to a scratch folder, not the repo:
`ruby scripts/build.rb examples/<file>.data.json --out <sandbox_dir>/adhoc/<date>-review-graph-example/<name>.html`

`assets/template.html` is the page engine; you never edit it per PR. The scripts are part of the
skill: run them by path, don't copy them into the output.

## Hard rules

- **Every identifier and every edge comes from the code at the head SHA.** Node names, paths, signatures
  and excerpts are copied from `git show <head>:<path>` / the diff, never from memory. An edge exists
  only if you read the line that creates the dependency (the call, the import + use, the render, the
  query, the enqueue). No "probably calls". An edge you can't cite is left out.
- **Excerpts are cut by `scripts/excerpt.rb`, never hand-copied.** It keeps removed lines in place and
  marks every hunk break, which hand copies get wrong.
- **Scope is this PR.** Changed units are the nodes; untouched neighbours appear one hop out as
  `unchanged`, and code from lower stack layers or other systems as `context`. Don't graph the whole
  codebase: a reviewer needs what the diff touches and what it touches next.
- **Any language.** A node is whatever a reviewer reads as one unit in that stack (REFERENCE.md §4).
  Pick lanes that fit the PR (§3) — never force the React lane set onto a Go service or a migration.
- **Findings come from a review, never from this skill.** With a deep-pr-review doc, map its findings
  onto nodes. Without one (`--explain`), the page has no findings, and says so in its summary. An
  observation you make while reading the code goes in a node's `summary` as a fact ("a parser that
  subclasses X directly inherits Y instead"), not as a finding.
- **Screenshots are real captures, boxed on the node's element.** Every screenshot goes through
  `scripts/annotate.rb` with a box around the part that node renders or affects — one copy per node,
  because two nodes sharing a capture point at different parts of it. Captions describe only what the
  image shows: a toast that had already faded is not "two toasts".
- **The validator must pass, and you look once before publishing.** `scripts/build.rb` checks every
  reference; read its warnings too. Then one rendered look (Phase 8) — the validator can't see an
  unreadable cluster or a box on the wrong element.
- **Private by default.** Publish as a private Claude Artifact. The page names a colleague's code and
  may carry review findings: never share it, post it, or link it on GitHub without the user asking.
  The header carries the PR author's login and branch name (from `gh`, via `scaffold.rb`); they are
  already public on the PR, but they are one more reason the page stays private. If the user wants a
  shareable copy, blank `pr.author` and `pr.headRef` before building.
- **Read the PR in a detached worktree, never by switching branches in a shared checkout**
  (deep-pr-review Hard rules). Re-read the head SHA right before you build: a force-push between
  reading and publishing silently moves every line link.
- **Sandbox writes auto-commit** when `<sandbox_autocommit>` is on and `<sandbox_dir>` is a git repo:
  after each meaningful write, `git -C <sandbox_dir> add <only your paths>` and commit, never asking
  (`sandbox-tool`).

---

## Phase 0 — inputs, base, destination

**Inputs:** the PR link (required — ask if missing); optionally a review doc with findings
(deep-pr-review passes it), a screenshots directory (deep-pr-review §5 / verify-in-app captures),
and emphasis from the user ("focus on the data path").

```bash
ruby scripts/scaffold.rb <owner/repo> <number> <out-dir>   # data file with real PR metadata; lists files, tags [generated]/[docs]
gh pr view <n> --repo <owner/repo> --json baseRefName,baseRefOid,headRefOid,mergedAt   # --repo: works outside a checkout
git -C <repo> fetch origin pull/<n>/head
git -C <repo> worktree add --detach <worktrees_dir>/pr<n>-graph <headRefOid>
git -C <repo> diff <baseRefOid>...<headRefOid> --stat     # must match the PR's file count and +/-
```

- **No local checkout?** A public or reviewable repo can be cloned just for this:
  `git clone --filter=blob:none <url> <scratch>/<repo>` fetches blobs on demand, so `git show` and
  `excerpt.rb` work without downloading full history. Put the clone in its own empty directory.
- **Base.** Diff against `baseRefOid`, not a branch name: it works for open, merged and stacked PRs,
  including a stacked child whose base branch was deleted after merging. Confirm with
  `git merge-base <baseRefOid> <headRefOid>`; if it isn't `baseRefOid`, diff from the merge-base and
  check the stat matches the PR.
- **Destination.** For a PR review (called from deep-pr-review, or any review of PR `<N>`), use
  `<sandbox_dir>/tickets/<repo>-pr<N>/review-graph/`. `<repo>` is the repo name without its owner, for example
  `fastify-pr7139`. The review doc itself lives in `<review_dir>` and links to the graph there. For an
  `--explain` map that isn't part of a review, use `<sandbox_dir>/adhoc/<date>-<repo>-pr<N>-review-graph/`.
  The data file, page and `img/` live together; the page references images relative to itself.

## Phase 1 — inventory the units

List every changed file and decide what reviewable units it holds (REFERENCE.md §4 per stack):
components, hooks, services, models, callbacks, jobs, endpoints/resolvers, queries/mutations,
migrations, tables, CLI commands, config. Then add one hop of context: the callers and callees of each
changed unit that the diff doesn't touch, and the lower-layer API the PR consumes.

- **Target 15–40 nodes.** Fold trivial companions into their owner (a CSS module into its component, a
  one-line type into its user, a constant into the function that uses it). Split a big file into units
  only when they have different dependencies (a model's new callback and its new public method). A
  small PR reaches the range through its one-hop context — rack/rack#2497 changes 4 files and graphs
  as 21 nodes, 12 of them untouched neighbours or env keys.
- **Not nodes:** generated files (schema dumps, lockfiles, generated API types, snapshots) and docs
  (`docs/`, READMEs, CHANGELOGs). `scaffold.rb` tags them; name them in the `note`.
- **Tests:** a spec that pins a changed unit's behaviour gets a node with a `test` edge — on backend PRs
  the specs are much of the review. One node per spec file, not per example. An *untouched* suite that
  now exercises moved code is worth an `unchanged` node with an `impacted` test edge: it is the
  regression net for the move.
- **Deleted units stay on the graph** as `removed` nodes with `removed` edges; a deletion is something
  to review.
- **Config the code reads** (an ENV var, a credential, a feature flag, a request-env key) is a
  `context` node with a `read` edge when the PR's behaviour turns on it ("an unset key falls back to
  the default").

## Phase 2 — classify each node

| kind | Meaning |
|---|---|
| `added` | New in this PR |
| `modified` | Exists on the base, its code changed |
| `behavior` | Its code barely changed (or didn't) but what it does for callers changed — a shared component that lost a feature, a callee whose contract moved |
| `removed` | Deleted by this PR (also a feature cut out of a surviving unit, as its own node) |
| `unchanged` | Untouched, shown because a changed unit depends on it or it depends on one |
| `context` | From another layer or system (lower stack PR, server side of a frontend PR, vendor API, ENV); label it with `layer` |

Flag `"unused": true` on a unit nothing consumes — an added export, or a modified unit whose new member
nothing reads.

## Phase 3 — the relationships

For each node, read its code and list what it depends on. Each edge gets `rel` (REFERENCE.md §5), a
change `kind`, a short `label` (≈ 32 chars; a verbatim identifier may run longer), and for changed
edges a one-to-two sentence `detail` plus a call-site `code` excerpt. A `test` edge needs neither:
its label ("4 HEAD + Response tests") and the spec node's summary carry it, and `build.rb` doesn't
ask for one.

| edge kind | When |
|---|---|
| `added` | A dependency this PR creates |
| `removed` | A dependency this PR deletes (keep the removed path visible — "writes after await" → dashed red) |
| `modified` | Both ends exist on the base, the call site changed (new argument, new condition) |
| `impacted` | Call site unchanged, but the callee's behaviour (or what it returns) changed under it |
| `unchanged` | Context edge, untouched |
| `context` | Inside the context layer (e.g. a GraphQL document resolving to its server field) |

REFERENCE.md §6 settles the hard cases (a call inside a prop, a framework callback, a field read off
fetched data, code moved from one unit to another).

## Phase 4 — lanes and layout

Choose 4–8 lanes ordered by dependency direction: whatever is entered first on the left, storage and
external systems on the right (REFERENCE.md §3 has presets for SPA, server monolith, full-stack,
services, libraries and data pipelines). Add a `boundary` where a process or network boundary sits
(browser | server, app | engine, service | vendor, code | env). When one side of a full-stack PR is
only 1–3 files, give it one lane.

Give each node a `lane` (id or index) and a `row`. `build.rb` lays them out on a 300 × 160 px grid with
232 × 120 px cards — so **an edge that skips a lane, or runs vertically inside one, passes under a card
unless that row is empty.** Lay out with that in mind:

- **Place by hand first, then optimize.** Put each callee beside its caller (same row, next lane),
  then run `--optimize-rows`. Optimizing a naive placement usually leaves a couple of hidden edges.
  After any manual move, re-run `--optimize-rows` and `build.rb` again.
- Put a node on the row of what it talks to most; ≤ 8 cards per lane, empty rows are fine; `row` may be
  fractional or negative.
- **One node that calls three or more siblings in its own lane** can't be laid out cleanly: at most two
  sit adjacent, the rest are reached by vertical edges under the middle cards. Split the lane (the
  rack example's "Multipart::Parser" entry points vs. "Parser defaults" hooks) so those calls run side
  to side. If moving one sibling into a neighbouring lane is cheaper, name that lane for what it
  holds (the fastify example's "Leaves · runtime"); a lane name that its cards contradict misleads.
- Put each spec **in its target's lane, in rows below the main graph** (or directly beside it) rather
  than in a far-right Tests lane, whose edges would cross every card on their row.
- A job a model enqueues still lives in the entry lane; expect that `async` edge to point left.
- Then run `ruby scripts/build.rb <data> --optimize-rows`: it re-rows the lane-placed nodes to cut edges
  hidden under cards and saves the rows to the data file. Fix what's left by hand if it matters. If you
  regenerate the data file from a script, the script's rows overwrite the optimized ones — re-run it
  after every fill.

Set `order` to the review order — changed nodes only. Usually entry → leaves; when the PR's centre of
gravity is a leaf (a model rule that a dozen nodes funnel into), core → callers. It drives "N of M",
`A`/`D` and "Next unreviewed".

## Phase 5 — node content

Per node (REFERENCE.md §2 has every field):
- `sub` — the path with the app root stripped (`app/`, `src/`, `lib/`, `spec/`); `name` — the shortest
  unambiguous real identifier, ≤ ~24 characters to fit the card (for `Class#method`, put the class in
  `sub` and the method in `name`); `type` — the chip (Component, Hook, Service, Model, Callback, Job,
  Migration, Resolver, Endpoint, Query, Table, Method, Class method, Spec, Config, Env key…).
- `bullets` — exactly two, ≤ 45 characters each: what it is, what changed.
- `summary` — 2–4 sentences: what it does, what this PR changed, and why it matters to a reviewer.
- `changes` — the concrete edits as a list; `sig` — before/after signature, props, arguments or schema.
- `facts` + `factsTitle` — the stack's key facts (state and hooks for a component; inputs, side effects
  and transaction boundaries for a service; columns, indexes and locks for a migration; queue, retries
  and idempotency for a job; arguments and auth for an endpoint).
- `code` + `codeTitle` — cut with `excerpt.rb` (below), ≤ ~60 lines. Unchanged one-hop nodes may carry a
  short context excerpt when the dependency isn't obvious from the name.
- `add` / `del` — per node; omit them when one file is split into several nodes.
- `file` + `line` — link target at the head SHA.

```bash
# excerpts.json: { "c-formPairs": [ { "path": "lib/rack/request.rb", "from": 597, "to": 606, "label": "request.rb" } ] }
ruby scripts/excerpt.rb <repo> <baseRefOid> <headRefOid> excerpts.json --into <dir>/pr<n>.data.json
```

Ranges are new-file line numbers (`"old": true` for a deleted file); removed lines inside a range come
along marked `-`. Several ranges under one key concatenate with a hunk header each — useful for a hook
plus the constant it returns, or a new method beside the existing one it mirrors.

## Phase 6 — findings (when reviewing)

Map each finding of the review onto its primary `node` (and `alsoNodes`), with `sev` `high` / `med` /
`low` / `nit`, a title and one paragraph that states the defect and the fix. Keep the review doc's
numbering (`F1`…) — this page is for the reviewer, not the author. Findings show as pills on cards,
cards in the drawer, and the "Worth a close look" list (high and medium first). A fix that spans several
nodes goes on the node where the first change lands, the rest in `alsoNodes`. When a finding's fix is
an existing helper the code doesn't call yet (a `with_lock` wrapper, a `retry_with_backoff` util), add
it as an `unchanged` node in its lane with no edge, and mention it in the finding — `build.rb`'s
"no edges" warning is expected there.

## Phase 7 — screenshots (PRs with a visible surface)

Sources, in order: the review's before/after captures (deep-pr-review §5, verify-in-app); the PR
description's own media (GitHub attachments, a cloud agent's uploaded captures) — download them into
`img/src/`; new captures, which need a running app (`verify-in-app` / `worktree-dev-server`; never take
over a shared stack). No visible surface (pure backend, library), or no captures available → no
screenshots, and the `note` says so and names the nodes that would benefit.

1. Map each capture to the nodes it evidences (a capture can serve several).
2. Read each image and measure a box `[x, y, w, h]` in its pixels around the node's element — the
   menu, not the page; the toast and the button that raised it. Use two boxes when the point is a
   relationship (the overflowing bar *and* the clipped column).
3. Write `annotate.json` (REFERENCE.md §7) and run `ruby scripts/annotate.rb annotate.json`; it prints
   each output path for the node's `images[].src`.
4. Spot-check the tightest boxes by opening the outputs.

## Phase 8 — build, look, publish

```bash
ruby scripts/build.rb <dir>/pr<n>.data.json            # errors stop it; read every warning
cd <dir> && python3 -m http.server <free port> --bind 127.0.0.1   # file:// is blocked
```

Look once with Playwright at `http://127.0.0.1:<port>/<page>.html?v=1#<node-id>`. Bump `?v=` after a
rebuild, or the browser serves the cached page. Take two views: one with a node open, and one zoomed
out with the drawer closed. Even the "isolated" Playwright MCP server is **shared by every concurrent
session**: another agent can navigate your tab or resize its viewport between two of your calls. Its
own screenshot tool also only writes under the server's working directory (`.playwright-mcp/`, often some
other repo, not gitignored there). So:

- **Do the whole look in one `browser_run_code_unsafe` call, on a page you open yourself.** Open it
  with `page.context().newPage()`, then in that same call:
  - `setViewportSize`, `goto`, a short wait;
  - `evaluate(() => location.href)` to confirm you are on your own page before you trust anything
    else an evaluate returns;
  - collect console errors with `p.on('console', …)`;
  - `p.screenshot({ path: '<absolute path in your output folder>' })`;
  - `p.close()`.

  Return `{ href, errors }`. Because the screenshot is Playwright's own API, it writes to the absolute
  path directly.
- **Clean up after the MCP tools, if you used them.** `browser_navigate` / `browser_take_screenshot`
  leave `page-*.yml`, `console-*.log` and PNGs in `.playwright-mcp/`. Move the files *your* calls wrote
  (match the timestamps) into your output folder. Leave other sessions' files where they are.
- **What to expect:** a `favicon.ico` 404 is the only console error. Fix what the look shows, then stop
  the server with `kill $(lsof -ti tcp:<port>)`.

```js
async (page) => {
  const p = await page.context().newPage(); const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setViewportSize({ width: 1600, height: 1000 });
  await p.goto('http://127.0.0.1:<port>/<page>.html?v=1#<node-id>'); await p.waitForTimeout(800);
  const href = await p.evaluate(() => location.href);
  await p.screenshot({ path: '<out>/look/node-open.png' });
  await p.close(); return { href, errors };
}
```

Publish with the Artifact tool: `file_path` = the page, `root` = its directory, `files` = the list
`build.rb` printed, `icon: "graph"`, a one-sentence description. To update, rebuild and publish the
same `file_path`. Commit the sandbox paths. **`--no-publish`** stops after the look and reports the
page path and `root` instead.

## Phase 9 — report

Give the Artifact link (or the local path), the node/edge/finding counts, what the graph leaves out
(generated files, docs, folded units, uncited edges you dropped), whether screenshots are included and
from where, and the keys: `R` reviewed · `E` next unreviewed · `A`/`D` prev/next · `X` hide untouched · `C` edge labels ·
`F` full view · `L` legend · `P` panel · `Esc` close.

---

## Variants

- **`--explain`** — no review, no findings: a map for understanding a PR (your own before shipping, a
  teammate's before pairing, a merged one you inherited). Same phases minus 6. The rack example is one.
- **A stack** — one graph per layer, each scoped to its own diff against its own base, with `stack`
  filled in so the strip links the layers. Don't merge layers into one page; the reviewer reviews
  layers.
- **Re-review after a force-push** — rebuild at the new head and republish to the same Artifact. Review
  marks live in the viewer's browser keyed by repo and PR number, so they carry over.

## Verified gotchas

- **zsh ties `path` to `PATH`.** A shell loop variable named `path` makes every following command
  "not found". Name it `file_path`.
- **`| head` kills a long-running script by SIGPIPE.** Don't pipe `annotate.rb` or `--optimize-rows` into
  `head`; you get a partial result.
- **WebP doesn't attach to GitHub comments.** Convert the annotated copies with `magick x.webp x.png`
  when a screenshot is going into a PR comment.
- **A capture's caption can outlive its content.** QA screenshots named "toasts" sometimes show none
  (the toast had faded). Look at the image before you caption it.
- **A force-push between the review and the graph moves line numbers.** Re-run `gh pr view --json
  headRefOid` before building; if it moved, re-cut the excerpts from the new head.
- **`build.rb` escapes `</` in the data**, so excerpts may contain `</script>`; never hand-paste JSON
  into the page.
- **`--optimize-rows` is a polish step, not a layout.** On a naive placement it typically still leaves a
  couple of hidden edges; place callees beside callers by hand, then optimize, then re-check.
- **`--optimize-rows` can't fix a fan-out inside one lane.** On the rack example, three default-value
  hooks called from one method in the same lane left 3 hidden edges whatever the rows; splitting them
  into their own lane took the layout cost from 10.8 to 2.6 and the hidden-edge count to zero.
- **A name right at 24 characters still truncates** on the card with an ellipsis
  (`default_tempfile_factory`). The validator doesn't warn; the full name shows in the drawer. Shorten
  only if the ellipsis hides the part that distinguishes it from a sibling.

## When not to use this — hand off to

- **The review itself** (context, findings, verdict, the local doc) → `deep-pr-review`, which calls this
  skill by default.
- **Explaining one mechanism, bug or solution space in depth** → `visual-explainer`.
- **A one-sheet summary of a plan** → `one-pager`.
- **Capturing screenshots or recordings in a running app** → `verify-in-app`.
