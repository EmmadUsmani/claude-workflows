---
name: verify-in-app
description: Prove a change works by driving the real running app and asserting on captured payloads, measured numbers and persisted DB rows — sign in with the app's dev login, reach the surface the real way, patch window.fetch to capture API/GraphQL requests and responses, measure with getBoundingClientRect/getComputedStyle, cross-check persisted rows with a runner (`bin/rails runner`, `node -e`, `python manage.py shell -c`), and capture matched before/after evidence without losing the fix. Use when asked to "self verify with playwright", "drive the FE and confirm the query/filter is actually passed", "verify this yourself, mock an error via db state if needed", "reproduce it first", "take before/after screenshots", "test via backend only, don't run the dev server", or before claiming any fix works; takes a depth argument (backend / browser / evidence-pack). NOT for booting or repairing a broken local stack (dev-doctor), NOT for opening the PR (ship-pr).
argument-hint: "[--depth backend|browser|evidence-pack] [url-or-surface]"
---

# Verify in the app

Tests and typecheck are necessary, never sufficient. A verification claim is only worth making
if it is **falsifiable**: a captured request payload, a measured number, a queried row, a pixel
probe. "It rendered and no error modal appeared" is weak evidence when the button may be inert.

This file is the method plus the Playwright-MCP harness mechanics. The per-project facts it
needs — dev login, hosts, how routes are served, admin URLs, the API's CSRF dance, the
ground-truth queries, how to seed state — are a checklist in [REFERENCE.md](REFERENCE.md); fill
it in once per project and keep the answers in the project `CLAUDE.md`.

The runner, the fetch patch and the measurements work against any web stack — swap
`bin/rails runner` for `node -e`, `python manage.py shell -c`, `psql -c` as your app needs.

## Hard rules

- **Reproduce before you fix.** Prove the bug with a deterministic check first, fix, then re-run
  the *identical* check. Never fix on suspicion. When the fix already exists (you're verifying
  after the fact), reproducing means toggling back to the pre-fix code — Phase 6 shows how to do
  that **without losing the fix**.
- **Never claim verified without an artifact.** Quote the captured request, the measured value,
  the row you read back. No artifact ⇒ say "not verified".
- **Never take a contested resource.** Ports, Docker, the shared dev DB, the shared browser
  profile and the main checkout are shared with other sessions. Identify the owner read-only,
  run elsewhere, and get explicit permission before reclaiming. Never switch the branch in the
  main checkout.
- **Only one agent may hold the browser and the pinned dev port.** If this verification runs
  inside a fan-out, the lead assigns the browser to exactly one track and the others use
  `--depth backend` — see **agent-team**.
- **Verifying doesn't change the commit default.** Once the change verifies, commit it (staged
  precisely — `git add <the change's files>`, never `-A`/`-u`); leave it uncommitted only when
  the user explicitly says so. Never commit what you mutated *for* verification: restore any data
  or files you touched and prove it (`git status --short`).
- **When your tooling reports failure but the user's session works, re-diagnose the tooling
  first** — a stale dev server or a wedged Playwright instance, not the code.
- **Don't over-verify low-stakes things.** Structurally-correct links do not need a browser.

---

## Phase 0 — Pick the depth (the user sets this, not you)

Both of these are reasonable instructions from the same person on different days: *"test this
via the backend only — don't boot the dev server and a browser"* and *"drive it through the
frontend with Playwright"*. Also honored: *"ship it without self-verification, we'll check later."*

| depth | what it means | when |
|---|---|---|
| `backend` | runner scripts + specs only. No dev server, no browser. | Logic-only change with no user-visible surface; someone else owns the dev port. |
| `browser` | Sign in, drive the surface, capture payloads, assert on the DB. | **Default for anything with a user-visible surface.** |
| `evidence-pack` | `browser` + matched before/after captures on identical DB state, into `<screenshots_dir>`. | The change is going into a PR description, or the user asked for screenshots. |

**Discriminator: does the change have a user-visible surface?** If yes, backend verification is
*not* sufficient — even if you must first fix an env blocker to get the frontend up. If the user
named a depth, obey it and say what you therefore did not check.

Verification answers "does it work". **code-style** answers "is it the right shape" — run its
self-review checklist over the same diff before you hand the evidence pack to **ship-pr**. A
change can be provably correct and still be a finding; they are siblings, not substitutes.

## Phase 1 — Reach a healthy app

```bash
curl -s -o /dev/null -w '%{http_code}' <dev_url>/                       # API
curl -s -o /dev/null -w '%{http_code}' \
  -H 'Accept: text/html,application/xhtml+xml' <dev_url>/<a-frontend-route>
```

- **No health route? Any HTTP response means reachable.** A wedged app server times out for
  reasons unrelated to your change.
- Frontend SPA routes can **404 a default `curl`**: a backend that only serves the SPA shell to a
  browser-shaped `Accept` header. Send the header.
- Not up, up and wrong, or the *wrong app* answering? That is a **dev-doctor** problem — port
  ownership, Docker infra, wedged workers, the pinned port. Don't debug your diff first.

## Phase 2 — Instrument BEFORE you act

Install the recorder with `browser_evaluate` **before** the click or navigation you want to
observe — installing it after a navigation misses that load's first request. (A full page load
wipes `window`; re-install after every hard navigation, or use `browser_network_requests` for
the load itself.)

```js
() => {
  window.__rec = { t0: performance.now(), calls: [], states: [] }
  window.__recReset = () => { window.__rec.calls = []; window.__rec.states = [] }
  if (!window.__patched) {
    window.__patched = true
    window.__origFetch = window.fetch
    window.fetch = function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url
      const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET'
      let body = null
      try { body = args[1] && args[1].body ? JSON.parse(args[1].body) : null } catch (e) {}
      const at = Math.round(performance.now() - window.__rec.t0)
      const p = window.__origFetch.apply(this, args)
      if (url.includes('/graphql') || url.includes('/api/')) {   // match your API's paths
        p.then((res) => res.clone().json().then((json) => ({ status: res.status, json }))
                         .catch(() => ({ status: res.status, json: null })))
         .then(({ status, json }) => {
          window.__rec.calls.push({
            at, ms: Math.round(performance.now() - window.__rec.t0) - at, method, url, status,
            op: body && body.operationName, variables: body && (body.variables || body), data: json,
          })
        })
      }
      return p
    }
  }
  return { installed: true }
}
```

Then read it back: `() => window.__rec.calls.map(c => ({ op: c.op || c.method + ' ' + c.url, vars: c.variables }))`.
For REST, the method + URL *is* the operation. Apps that use `XMLHttpRequest` (axios in some
setups) need the same patch on `XMLHttpRequest.prototype.open` / `send`.

- **Assert on the exact nested path.** `variables.filter.status`, not `variables.status` — one
  session read the top-level key, saw blank, and nearly filed a non-bug. **Hook parameter names
  mislead**: a `filter` prop is often already the built API input.
- **Loader / async state**: poll a specific element's `getComputedStyle(el).animationName` and
  compare against **the loader's own keyframe name** (unrelated UI shares the class and other
  animations exist), scoped precisely. Track the Save/submit button's `disabled` too.
- **Numeric measurement over screenshots** for layout and animation bugs:
  `getBoundingClientRect`, `getComputedStyle`, or a polled read on a timer. State the diagnosis
  numerically *before* writing the fix ("height steps 48 → 12 → 48 px within ~200 ms after the
  click instead of staying at 48"), then re-run the identical measurement after.
  **Screenshot only once the numbers agree.**

## Phase 3 — Drive it

- Sign in with the **app's dev login / a seeded dev user** (REFERENCE § Sign in) — the real form,
  not a cookie you forged.
- Get URLs from the app's route listing (`bin/rails routes | grep <thing>`, the frontend router
  file, `python manage.py show_urls`) — **never hand-build an admin URL** (REFERENCE § Admin has
  the 500 that taught this).
- **Reach the surface the way a user does.** Client-only routes can 404 on a hard load; navigate
  in-app from the entry page. Some flows also *create* the state the next page needs. See
  REFERENCE § Routes.
- Find elements with `browser_find` + a regex on visible text, not raw CSS — raw selectors are
  brittle and throw strict-mode violations.
- **Use real `browser_click`s** when framework handlers must fire — a synthetic in-page
  `.click()` skips pointer events that some components listen for instead.
- **Fallback for an ambiguous locator**: `browser_evaluate` with hand-written JS filtering on
  `offsetParent !== null` + exact `textContent`, then `.click()` / `form.submit()` in-page. Or tag
  the node first (`el.id = 'shot-target'`) and target that.
- **Custom widgets** (drag-and-drop boards, rich-text editors, custom date pickers): read the
  component's key handler before pressing keys — shortcuts are often registered globally and act
  on more than the focused element. Controls with no accessible role can be reached with
  `document.elementFromPoint(x, y)` and dispatched pointer events. Assert on the app's own state
  (the API response, the store) rather than on what the widget happens to render.

## Phase 4 — Assert against ground truth

Pick whichever makes the claim falsifiable:

1. **Replicate the exact resolver path** in a runner — the real service object / query function
   with the real args, never a simplified scope. A simplified replica manufactures false
   discrepancies (a hand-written `where` returned 212 rows where the real query, with its default
   scope and permission filter, returned 187). Compare against the frontend's own `totalCount` and
   **report a number table** as the proof. When the same replication script will be wanted again
   — a parity sweep, a fixture setup you must undo, a measurement harness — build it under
   **sandbox-tool** instead (`MODE=report|apply|revert`, read-only mode first, and prove the
   instrument against synthetic ground truth before pointing it at real data).
2. **Query the persisted row.** For a backend outcome, read the record back with a runner; the UI
   can look fine while the mutation no-oped.
3. **Both directions, both surfaces, for shared code.** Drive read *and* write on the surface you
   changed **and** the untouched one with the same script. A shared hook can pass every read check
   and still regress the write/staleness path. "The reference surface is bit-for-bit identical
   (same param name, same casing, same query variables)" is the primary no-regression proof.
4. **Probe generated output numerically** rather than eyeballing — for a server-rendered chart,
   a PDF export or a theme change, rasterize or `curl` the output and check exact values (RGB at a
   known region, page count, a text extract) against what the input says they should be. Use a
   synthetic input built to make the difference obvious.
5. **Read the stored parameters, not the output URL.** A generated file's URL rarely tells you
   which options produced it; the record that produced it does.
6. **Poll for async jobs.** Post-flow DB assertions fail because the work was enqueued
   (`perform_later`, a BullMQ job, a Celery task). Poll until it settles rather than asserting
   immediately — and if it never settles, check the queue (**dev-doctor** Phase E).
7. **If a result matches pre-fix behavior, verify the running bundle before hunting a
   regression**: fetch the live dev-server-served module from inside the page (or `curl` it) and
   grep for your new code. It is often just not loaded.

## Phase 5 — Negative and failure paths

- **Failure injection (frontend paths):** monkey-patch `window.fetch`, match the target operation
  by body substring, return a forced failure (`ok: false` or a rejected promise), pass everything
  else through. Add an artificial delay to test optimistic-removal timing. Restore with
  `window.fetch = window.__origFetch` and reload.
- **Backend failure paths: break the backing data instead** (e.g. point a record's file key at a
  missing object) — assets may be cached, so intercepting fetch proves nothing. Restore afterwards
  and verify.
- **Race repro:** patch fetch to delay/reorder specific responses; if inconclusive add real
  queueing pressure by occupying other in-flight slots; then confirm the symptom independently
  (reload; the persisted state disagrees).
- **Feature flags:** drive ON, screenshot, **verify server state via a runner, not the UI**
  (`Flipper.enabled?(:flag)`, your flag library's equivalent), disable the flag, **destroy the
  ON-run record and start from a fresh one**, drive OFF, verify, restore the flag's original state.
- **Test the negative case** explicitly (the action that should *not* trigger the loader / should
  *not* fire a request).

## Phase 6 — Before/after on identical DB state (`--depth evidence-pack`)

This phase is the canonical before/after capture procedure for the plugin — **ship-pr** defers to
it and keeps only the foldering, the one-pair rule and private-repo image hosting.

**Order follows the hard rule.** If the fix doesn't exist yet, the "before" capture *is* your
reproduction: capture before → fix → capture after on the same DB state. Only when the fix
already exists do you toggle back to capture "before" — and then the fix must survive the toggle.

**Toggling back without losing the fix.** The tempting recipe —
`git checkout origin/<default> -- <files>`, capture, `git checkout HEAD -- <files>` — restores the
last *commit*, not your working tree: it silently discards an uncommitted fix, and
`git status --short` then reports clean, *confirming* the loss. It also fails outright for files
the fix added. Instead:

Save the fix as a patch, reverse it for "before", re-apply it, and prove it's back. One flow
covers a committed fix, an uncommitted one, or both, including files the fix added:

```bash
cd <abs-worktree>; PATCH="${TMPDIR:-/tmp}/fix-<slug>.patch"
BASE=HEAD                                             # fix is uncommitted; if it's committed on this branch:
# BASE=$(git merge-base origin/<default-branch> HEAD)
git add -N <new-untracked-files>                      # intent-to-add, so the patch includes brand-new files
git diff "$BASE" -- <fix-paths> > "$PATCH" && test -s "$PATCH"
git apply -R "$PATCH"                                 # working tree back to pre-fix (index and commits untouched)
#   reload, confirm the bug reproduces on identical inputs → capture "before"
git apply "$PATCH"
git diff "$BASE" -- <fix-paths> | cmp - "$PATCH" && echo "fix restored"   # MUST print "fix restored"
```

"Clean" is the wrong check — an uncommitted fix is *supposed* to be in the working tree; the
`cmp` is what proves nothing was lost. Keep the patch file until the fix is committed.
(`git reset -- <new-files>` undoes the intent-to-add if you want them untracked again.)
- The auto-mode permission classifier has **blocked `git stash`** in some sessions, and the stash
  is repo-wide and shared across worktrees — `stash pop` has grabbed another session's WIP. If you
  do stash, `git stash push -m <note> -- <files>` and check `git stash list` before popping.
- **Bust caches between toggles** or you shoot stale output (**dev-doctor** Phase D lists the
  layers; **render-pipeline-debug** owns multi-stage generation pipelines).
- **Wait on real readiness signals** — no spinners, buttons enabled, image `naturalWidth` over a
  threshold. After a checkout, poll for a 200 so the dev server's HMR / autoreload caught up, and
  re-check the served bundle (Phase 4 #7) — a watcher that missed the change shoots "after" twice.
- **Isolated components** (hover-dependent UI, overlapping mounts): use Storybook, if the project
  has it.
  ```bash
  (cd <abs-repo>/<frontend-dir> && npm run storybook > "${TMPDIR:-/tmp}/sb.log" 2>&1 &)
  # poll until the log shows it listening (default :6006), then
  # navigate to http://localhost:6006/iframe.html?id=<story-id>&viewMode=story
  ```
  Edit the shared fixture file if no story exercises the new prop.
- **Screenshots** — scoped `target`, saved inside the Playwright MCP's allowed root, then copied
  out:
  ```jsonc
  { "filename": ".playwright-mcp/<slug>-01-after.png", "target": "#the-container",
    "element": "the panel under test", "type": "png", "scale": "css" }
  ```
  `<screenshots_dir>` names a before/after pair of folders (default `~/Desktop/<TICKET>/{before,after}/`).
  Copy each shot into the matching one:
  ```bash
  cp <allowed-root>/.playwright-mcp/<slug>-*-after.png  ~/Desktop/<TICKET>/after/    # <screenshots_dir> with {before,after} → after
  cp <allowed-root>/.playwright-mcp/<slug>-*-before.png ~/Desktop/<TICKET>/before/
  ```
  Then **`Read` the PNG** to confirm it isn't blank/half-built before citing it.
  `<allowed-root>` is whatever the "outside allowed roots" error lists — the MCP server's own
  launch directory, which may be an unrelated repo (see gotchas). Clean `.playwright-mcp/` up
  *there* when done.
- `scale: "device"` for crisp images; to frame one component, tag it (`el.id = 'shot-target'`) and
  screenshot that element — but **portaled content (tooltips, popovers) won't appear in an element
  screenshot**; use a viewport shot for those.
- If the user finds the example unconvincing (*"this example is hard to read — pick something
  clearer"*), **switch to a more legible subject and redo** — do not defend the proof.

Hand the finished pack to **ship-pr** for the PR description and private-repo image hosting.

## Phase 7 — Regression gate and cleanup

- Run the **full relevant** suite, not just the file you touched. Baseline it: "the same 6
  failures before and after, all pre-existing" is what stops a false regression chase.
- `git status` in **both** the worktree and the main checkout — dev watchers rewrite generated
  files (compiled CSS, schema dumps) on page load ⇒ `git checkout -- <that file>`.
- Clean up scratch artifacts: `.playwright-mcp/` (in the MCP's allowed root), stray PNGs, any
  records you seeded or mutated, the saved patch. Report what you restored.
- An evidence pack that explains a *mechanism* (a race, a stale-cache interaction, a measured
  regression) is worth more as a page than as scrollback: offer **visual-explainer** (mode
  `explain`, the measurements become the figcaptions) or a **research-doc** write-up. Offer it;
  don't assume it.
- Commit the verified change by default (precise staging, `git show --stat HEAD` to check);
  uncommitted only if the user explicitly said so. Pushing and opening a PR is **ship-pr**'s.

---

## Verified gotchas — Playwright MCP harness

- **Two namespaces, if both are configured.** A default `mcp__playwright__*` server drives one
  browser shared across all Claude sessions; a second server launched with `--isolated` (named
  e.g. `playwright-isolated`) is a fresh, **signed-out** instance. Switch to isolated on
  `Error: Browser is already in use for …/mcp-chrome-<hash>`. A stale process can hold the profile
  lock after an MCP disconnect ⇒ `pkill -f "mcp-chrome-<hash>"` (only once you've confirmed no
  other session is using it). Playwright tools are often deferred: load them with
  `ToolSearch 'select:mcp__playwright__browser_click,…'` first.
- **Load the tool's schema before guessing argument names — they change between MCP versions.**
  `browser_click` / `browser_fill_form` have taken the element ref as `ref`, as `target`, and (in
  one version) required both — `ref` alone then failed with
  `Invalid input: expected string, received undefined → at target`, while a later version rejects
  `ref` outright. Pass the ref in whichever field the loaded schema names:
  ```jsonc
  { "element": "Sign in button", "target": "e85" }                         // + "ref": "e85" only if the schema has it
  { "fields": [ { "name": "Email", "target": "e79", "type": "textbox", "value": "…" } ] }
  ```
  Get the refs from `browser_find` (`{"regex": "Email|Password"}`) or the saved
  `.playwright-mcp/page-*.yml` snapshot — prefer aria-ref over a CSS text selector.
- **`browser_run_code_unsafe` accepts exactly a bare `async () => { … }` arrow expression** — not
  an IIFE, not invoked, not top-level `const`/`await`.
- **A `/regex/flags` literal inside `browser_evaluate` throws `Invalid regular expression flags`**
  ⇒ `new RegExp(pattern, flags)` or `String.prototype.includes`.
- **`strict mode violation: locator resolved to N elements`** from mobile+desktop duplicate
  mounts, or a badge that shares text with its button ⇒ filter in-page. select2's
  `input.select2-search__field` matches 2 ⇒ scope by `aria-controls`.
- **A floating support-chat widget's iframe intercepts clicks** → 5s TimeoutError. Find it
  (`document.querySelectorAll('iframe')`) and remove it first:
  ```js
  document.querySelectorAll('iframe[title*="chat" i], iframe[title*="message" i]').forEach(el => el.remove())
  ```
- **A JS `.click()` never moves focus**, so Escape never reaches a react-modal ⇒ `.focus()` the
  modal content first.
- **`getComputedStyle(el).opacity` misses ancestor-hidden elements** ⇒
  `el.checkVisibility({ opacityProperty: true, visibilityProperty: true })`.
- **Tooltips are often `pointer-events: none`**, so `elementFromPoint` sees straight through them
  — judge stacking with a screenshot. **Hover state silently drops between separate Playwright
  calls** ⇒ re-hover immediately before the shot, or pin it (Tippy:
  `el._tippy.setProps({trigger:'manual', animation:false}); el._tippy.show()`). A synthetic
  `mouseenter` does not trigger CSS `:hover`.
- **`getImageData` is blocked once a cross-origin image taints the canvas** ⇒ use screenshots,
  the DOM, or the network log instead.
- **`scrollIntoView` smooth-scroll races the screenshot** ⇒
  `window.scrollTo({ top: y, behavior: 'instant' })`.
- **`fullPage: true` composites fixed-position elements over the content** (nav flyouts, an admin
  sidebar that expands on hover) ⇒ scoped `target` shot.
- **Screenshot paths are sandboxed to the MCP server's allowed roots** — by default its launch
  directory, which may be a different repo from the one you're verifying. `~/Desktop/x.png` →
  `File access denied: … is outside allowed roots. Allowed roots: <dir>/.playwright-mcp, <dir>`.
  Save inside a listed root, then `cp`. That root's `.playwright-mcp/` may not be gitignored —
  snapshots and console logs then show up as untracked files in *that* repo; delete them when done.
  The PNG can also land in the *process* cwd — if `Read` says "File does not exist",
  `find ~ -maxdepth 4 -name '<file>.png' -newermt '-5 minutes'`, then move it.
- **`browser_file_upload`** only accepts paths under the allowed roots, and only fires
  immediately after a native file picker opened.
- **`browser_navigate` blocks `file://`** ⇒ serve the directory with a Node one-liner
  (run from that directory, `PORT=<port>`; serves `index.html` for `/`, guards path traversal):
  ```sh
  node -e 'const [h,f,p,x]=[require("http"),require("fs"),require("path"),{".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml"}];h.createServer((q,r)=>{const u=decodeURIComponent(q.url.split("?")[0]);const t=p.join(process.cwd(),u.endsWith("/")?u+"index.html":u);if(!t.startsWith(process.cwd()))return r.writeHead(403).end();f.readFile(t,(e,d)=>e?r.writeHead(404).end():r.writeHead(200,{"content-type":x[p.extname(t)]||"application/octet-stream"}).end(d))}).listen(process.env.PORT||8000)'
  ```
  and use `http://127.0.0.1:<port>/…`. Ad hoc static servers are themselves sometimes blocked by the
  permission classifier ⇒ fall back to injecting the content into an already-permitted http
  origin via `browser_evaluate`.
- **Don't trust layout or mount measurements from a dev server hot-reloaded through dozens of
  structural edits** — restart for a clean baseline. One session's "root cause" evaporated on
  restart, after it had already contradicted the user.

## When not to use / hand off

- **The app won't boot, a page is stuck loading, the wrong app answers, ports or Docker are
  wrong** → **dev-doctor**. Boot a branch's server → **worktree-dev-server**; isolated env →
  **worktree-create**.
- **Generated output (exports, documents, images) is itself wrong or stale through a multi-stage
  pipeline** → **render-pipeline-debug**. This skill only tells you *that* it's wrong.
- **Opening the PR, description, before/after image hosting** → **ship-pr** (+ **gh-stack** /
  **stack-surgery** for the branch mechanics).
- **Triaging CI and bot review findings on an open PR** → **pr-triage**.
- **The fact you need is in production** → **warehouse-data** first (it owns the `<ops_bot>`
  rung, if your team runs one), **prod-script** last. You have no live prod connection: never call
  local output "prod" or "prod-synced".
- **A reusable harness or a multi-mode investigation script** → **sandbox-tool**.
- **A chat-thread or ticket report you have not yet reduced to a falsifiable claim** →
  **bug-intake** first; come back here for the repro.
- **Is the change the right *shape*, not just correct?** → **code-style**, run before you hand
  the pack to ship-pr.
- **Turning the evidence into a shareable page or a durable doc** → **visual-explainer** (mode
  `explain`) / **research-doc**.
- **The verification runs inside a parallel fan-out** (one browser, one dev port) → **agent-team**.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
