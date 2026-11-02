---
name: sandbox-tool
description: Build a durable local tool in `<sandbox_dir>` instead of a throwaway — a reusable dev-ops script in scripts/, a per-ticket fixture toolkit with MODE=report|apply|revert|break|restore, or an exploration/preview sampler that renders every candidate through the real pipeline into a browsable HTML page. A read-only report mode always runs first; destructive scripts are dry-run by default behind CONFIRM=yes; toolkits round-trip apply → revert → re-verify; any measurement harness is proved against synthetic ground truth first. Use for "write a reusable script for this in my sandbox", "prep an exploration sampler html preview like the last one", "make a script I can rerun whenever we need to do this", "a pair of scripts, one to check X and one to clear it". NOT for a one-off production-console script (prod-script), NOT for a broken local stack (dev-doctor), NOT the sampler page design (visual-explainer).
argument-hint: "script|toolkit|sampler <name>"
---

# Build a sandbox tool

`<sandbox_dir>` (setting; default `~/projects/sandbox`) is the user's own repo of durable local
instruments. Things built here get reused — a fixture-setup toolkit gets re-run across later
sessions, a cache-clearing script becomes the standard one the user points *Claude* at. So the bar is a tool with a documented CLI surface and a README, not a scratch file.

Three shapes, chosen by what's being asked for:

| Shape | Home | Example |
|---|---|---|
| **script** — reusable dev-ops tool, no ticket | `scripts/` | `scripts/queue_status.js`, `scripts/kill-dev-stack.sh` |
| **toolkit** — per-ticket fixture setup you must undo | `tickets/<TICKET-SLUG>/` | `tickets/INV-142-late-fee-fixtures/fixture_setup/` |
| **sampler** — render N candidates, judge by eye | `tickets/<name>-preview/` | `tickets/thumbnail-sharpen-preview/` |

Settings used: `<sandbox_dir>`, `<sandbox_autocommit>` (default `true`). If `<sandbox_dir>` does
not exist, ask once where durable tools should live and suggest adding the setting. If it is not
a git repo, autocommit is a no-op: say so in the hand-off.

## Hard rules

- **Read the existing convention before writing a line.** `ls <sandbox_dir>/`, then open the
  closest sibling and match it; the request is often literally "like `<previous-preview>` but in
  a new directory". **Empty sandbox?** There is nothing to copy: create `scripts/`, start from the
  skeleton in §2 and a short `scripts/README.md`, and treat the examples in the tables below as
  names to aim for, not files that exist.
- **Default to plain Node (`node file.js`, built-ins only) or bash** for any standalone script the
  user runs or reads — not Ruby or Python; use the app's runner (`bin/rails runner`,
  `manage.py shell`…) only when the tool needs the app's models. If the user's project is in another language, match it, but
  keep the env-var CLI surface below. Your own throwaway one-liners and an independent *validator*
  are fine in whatever language is convenient.
- **These scripts are read by a human, so they get the `code-style` pass too** — implicit
  returns, full words not abbreviations, hash destructuring over positional arrays, class
  constants at the top, and comments that carry knowledge the code can't show. Run its
  self-review checklist before handing the script over.
- **Env vars are the CLI surface.** No flag parsers, no positional args in scripts. `MODE=`,
  `STEPS=`, `CONFIRM=yes`, `LIMIT=`, `OPEN=0`. A smoke run and a full sweep are then the same
  script.
- **A pure-read mode always exists and always runs first.** `MODE=report` for a toolkit; the
  whole script for a status script.
- **Destructive = dry-run by default behind `CONFIRM=yes`, and the first verification pass uses
  the dry run.** Verifying a kill-the-dev-stack script by running it live once took down the dev
  server the user had up for other work. Never live-test a destructive tool on a stack someone is
  using.
- **The header comment block is the documentation.** Purpose, the exact copy-pasteable
  invocations, every env knob, the blast radius, and a production refusal. A queue-clearing
  script's header (see §2) is the canonical shape.
- **Nothing writes into the application repo.** Scripts live in the sandbox and are invoked by
  absolute path, so `git status` in the app repo stays clean.
- **Do not read `.env*`.** Reference `ENV['NAME']` by name in the script instead.
- Everything except `out/` is committed. `out/` is gitignored. Move loose files into their own
  subdir before committing.
- **Sandbox writes auto-commit when `<sandbox_autocommit>` is `true` (the default) — never ask.**
  After each meaningful write under `<sandbox_dir>` (when it is a git repo),
  `git -C <sandbox_dir> add <only the paths you wrote>` and commit with a short descriptive
  message, no prompt. Never `add -A`/`.` — other sessions may have left uncommitted work there;
  never commit, revert, stash or clean theirs. No remote, no push; secrets get gitignored, never
  committed. If `<sandbox_autocommit>` is `false`, leave the files uncommitted and say so in the
  hand-off. Cloud runs: the state repo's own commit rule applies (**cloud-runtime**).

## 1. Place it correctly

```
<sandbox_dir>/
├── scripts/          reusable dev-ops tools, no ticket, no expiry
├── tickets/<SLUG>/   per-ticket fixtures, samplers, write-ups (committed)
├── adhoc/<YYYY-MM-DD>-<slug>/   one-off production investigations  → see warehouse-data / prod-script
└── code-snippets/    loose reference snippets
```

`tickets/` vs `adhoc/` is the split that gets mis-filed. A **numbered, date-stamped, throwaway**
script for a live production question belongs in `adhoc/` and follows the **prod-script**
skill's conventions (`01_inspect.rb`, `02_<action>.rb`, top-level `DRY_RUN = true`). The same
dir holds warehouse evidence (`NN_<probe>.sql` + `NN_<probe>.json`, per **warehouse-data**).
Anything meant to be re-run later belongs in `scripts/` or `tickets/`.

The two guard styles are *not* interchangeable:

| | Home | Guard |
|---|---|---|
| Reusable local tool | `scripts/`, `tickets/` | `CONFIRM=yes` env var, dry-run default |
| One-off production console script | `adhoc/` | top-level `DRY_RUN = true` constant |

**Path gotcha:** once the `tickets/` segment was omitted when creating a directory, and the
misnamed directory later had to be deleted — and READMEs written before the move kept printing
the old path. Write the full `<sandbox_dir>/tickets/<SLUG>/…` path in every README invocation.

## 2. Shape "script" — a reusable dev-ops tool

Read the closest existing one before writing. Typical members of a `scripts/` directory (aim for
these shapes; they may not exist yet):

| File | What it is |
|---|---|
| `scripts/queue_status.js` | **read-only** job-queue health — depth, latency, retry/dead grouped by error class. `SCAN_LIMIT=`, `ALL=1` |
| `scripts/queue_clear.js` | destructive queue wipe. `CONFIRM=yes`, `QUEUES=`, `RESET_STATS=1` |
| `scripts/cache_clear.js` | destructive multi-layer cache bust. `CONFIRM=yes`, `RECORD=<id>`, `APP_LAYERS_ONLY=1` (same knobs as **render-pipeline-debug**'s cache-bust tool) |
| `scripts/kill-dev-stack.sh` | kill the whole local dev stack, supervisors first |
| `scripts/dev-up.sh` | boot a checkout on a chosen port. `-d/--dir`, `-p/--port`, `-b/--background` |

Ask for them **in pairs** when the job is inspect-then-act — one to check, one to change. Write
both. Give each script a short entry in `scripts/README.md` (what it does, the invocation, the
knobs); a script without a README line is half-delivered.

**Primary skeleton — plain Node, no framework** (a stale-file mover; swap the body for your job):

```js
#!/usr/bin/env node
// Move stale files out of DIR into a trash folder — reversible, never unlinks.
//
// Report only (default MODE — reads, changes nothing):
//   DIR=/abs/path/logs node /abs/path/<sandbox_dir>/scripts/stale_files.js
// Dry-run the change (default for apply — prints what it WOULD move):
//   MODE=apply DIR=/abs/path/logs node .../stale_files.js
// Do it:
//   MODE=apply CONFIRM=yes DIR=/abs/path/logs node .../stale_files.js
// Undo a run:
//   MODE=revert RUN_ID=<id printed by apply> DIR=/abs/path/logs node .../stale_files.js
// Knobs: DAYS=30 (staleness threshold), MODE=report|apply|revert
// Blast radius: files directly under DIR only; moved, never deleted. Refuses DIR=/ or $HOME.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TRASH_DIRNAME = '.stale-trash';

function abort(message) {
  console.error(message);
  process.exit(1);
}

const mode = process.env.MODE || 'report';
if (!process.env.DIR) abort('DIR=<absolute path> is required');
const dir = path.resolve(process.env.DIR);
if ([path.parse(dir).root, os.homedir()].includes(dir)) abort(`REFUSING: ${dir} is too broad.`);
if (!['report', 'apply', 'revert'].includes(mode)) abort(`unknown MODE=${mode} (report|apply|revert)`);
const confirmed = process.env.CONFIRM === 'yes';
const days = Number(process.env.DAYS || 30);
console.log(`mode=${mode} confirmed=${confirmed} dir=${dir}`);

function staleFiles() {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => fs.statSync(file).mtimeMs < cutoff);
}

if (mode === 'report') {
  const files = staleFiles();
  files.forEach((file) => console.log(`stale: ${file}`));
  console.log(`${files.length} stale file(s) older than ${days} days`);
} else if (mode === 'apply') {
  const files = staleFiles();
  const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const runDir = path.join(dir, TRASH_DIRNAME, runId);
  const manifest = files.map((file) => ({ from: file, to: path.join(runDir, path.basename(file)) }));
  manifest.forEach(({ from, to }) => console.log(`${confirmed ? 'moving' : 'WOULD move'}: ${from} -> ${to}`));
  if (confirmed) {
    fs.mkdirSync(runDir, { recursive: true });
    manifest.forEach(({ from, to }) => fs.renameSync(from, to));
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`RUN_ID=${runId}  (undo: MODE=revert RUN_ID=${runId})`);
  } else {
    console.log('dry run — add CONFIRM=yes to move');
  }
} else {
  const runId = process.env.RUN_ID || abort('RUN_ID=<id printed by apply> is required');
  const manifestPath = path.join(dir, TRASH_DIRNAME, runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) abort(`no manifest at ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.forEach(({ from, to }) => {
    console.log(`restoring: ${to} -> ${from}`);
    fs.renameSync(to, from);
  });
}
```

The same shape in bash: `set -uo pipefail`, env vars for knobs, a refusal guard, and `--help`
implemented by `awk`-ing the script's own header comment so the docs can't drift. For a kill-style
script add a `PROTECT_RE` of things never to kill (browsers, editors, the terminal) and kill
supervisors before workers so nothing respawns.

**App-runner variant (Rails example).** When the tool needs the app's models, keep the same header
and env-var surface but run it through the runner (`bin/rails runner <abs path>`; `node -e`/
`python manage.py shell` are the analogues) and add an environment guard:

```ruby
abort 'REFUSING: this script never runs in production.' if Rails.env.production?
ActiveRecord::Base.logger = nil          # silence the ORM log in the report
```
Use callback-skipping writes (`update_columns`-style) for local flag flips so callbacks and
outbound syncs don't fire, and name what the script deliberately does **not** touch (a
cache-clearing script should say so about the source-of-truth rows it must never delete).

**Reversible by default.** Prefer move-aside + a manifest (what was changed, with the previous
values) + a `MODE=revert` over unlinking or overwriting, whenever feasible — the same
baseline/revert discipline as the toolkit's rules in §3. Where a change is inherently
irreversible (a queue wipe, a cache bust), say so in the header and keep the dry-run and
`CONFIRM=yes` gate.

**Verify with the dry run, then narrow-scope live, then revert, then report.** `node --check` (or
`bash -n`) first, then run with no `CONFIRM` and read the output, then a scoped `CONFIRM=yes` run
on a fixture, then `MODE=revert` and confirm the tree/state matches the original (hash it before
and after). Filter framework noise from the output (`2>&1 | grep -vE "<noisy logger prefixes>"`).
Every shape is handed over with `Rehearsed locally: <modes run → result>. Not exercised: <…>` —
never "here's the script" on a first run. A tool that will **also run in production** (a
console-invoked service object, below) gets **prod-script**'s rehearsal gate on top.

## 3. Shape "toolkit" — `MODE=report|apply|revert|break|restore`

For "write a reusable script that does all the steps to set this up from the original dev
database state." The deliverable takes a stock dev database to a state you can drive in the app,
and puts it back exactly.

Layout:

```
fixture_setup/
├── setup_fixtures.rb   entry point — MODE / STEPS dispatch only
├── restore_files.rb    standalone restore after an object-store wipe
├── lib/fixture_setup.rb  every operation, plus the reasoning per step
├── baseline/           pre-mutation state; the restore point for revert
├── uploaded-files/     durable copies of what was uploaded to the local object store
└── README.md
```

A toolkit mutates the **shared dev DB**. Run it from an isolated worktree with its own
database and queue namespace (see **worktree-create**) whenever another session may be using dev
data, and never against a stack someone else is driving. If the DB or object store is already
wrong before you start, that's **dev-doctor**, not your script.

The modes:

```sh
cd <app repo>
MODE=report bin/rails runner <sandbox_dir>/tickets/<SLUG>/<tool>/setup_fixtures.rb
MODE=apply  bin/rails runner ...   # STEPS=schema,records,files for a subset
MODE=revert bin/rails runner ...
```

1. **`MODE=report` first, and it must be pure-read.** It also prints the URL for each object it
   touched, so the human can go look.
2. **Capture the baseline before the first mutation, and never overwrite it** — otherwise a
   second `apply` launders an already-modified state into "the original". Save **full attribute
   hashes, not ids**, id-keyed JSON.
3. **Verify the baseline's shape by reading it back.** One baseline was written as an array of
   hashes while the reader did `dig(slug, id)` — revert would have silently restored nothing and
   reported success.
4. **Discover targets dynamically from the DB** (every distinct combination actually present)
   rather than hardcoding today's findings. Keep a `SLUGS=`/`ONLY=` override. Use callback-skipping
   writes for flag flips so callbacks and outbound syncs stay quiet.
5. **Revert in reverse order** of apply, restore *per-record* values (some rows were already
   enabled before you started — they must come back that way), and delete only the objects you
   created.
6. **Round-trip the toolkit itself before declaring it done**: `apply` → verify in the browser →
   `revert` → confirm every field is back → `apply` again → verify again. Write the round-trip
   result into the README.
7. **Keep a durable copy in the sandbox of anything uploaded to ephemeral dev infra, plus a
   standalone restore script.** A local cloud emulator (LocalStack, MinIO…) loses its objects on
   restart, so `uploaded-files/` holds the generated files and `restore_files.rb` re-uploads them
   from disk — reading the files, not the DB state that may since have been reverted.
8. **Add `MODE=break` / `MODE=restore`** when the feature has a failure path worth exercising.
   Break the *backing data* (point a file URL at a missing object key), not the network layer —
   intercepting fetch lies when assets are cached.
9. Write a README per subdir: the three commands, a table of what it touches, *why* each step is
   needed, the options table, and what revert guarantees.

## 4. Shape "sampler" — exploration/preview harness

For "prep an exploration sampler html preview + supporting scripts, similar to the last one, in a
new directory." Deliverable: one self-contained HTML page where every candidate treatment is
rendered on real inputs, so the decision is made by looking rather than arguing.

Structural template — any existing `tickets/<name>-preview/`. Running example below: comparing
image-compression presets (JPEG/WebP quality settings) by file size and SSIM against the original.

```
<name>-preview/
├── fetch_inputs.rb      pull real inputs out of the dev DB into inputs/
├── render_sample.rb     run every preset, measure, emit the page into out/
├── inputs/              real-<id>.png, synth-<case>.png, manifest.json
├── out/                 gitignored; timestamped <name>-YYYYMMDD-HHMMSS.html
└── README.md
```

1. **Probe the underlying primitive first**, before designing anything — call the vendor SDK or
   API directly from a runner script to learn what it can and cannot do. Half the design falls
   out of that. Pull exact reference values from the design source (e.g. the Figma MCP's
   metadata tool) rather than guessing them.
2. **Drive the actual production code path, don't reimplement it.** Call the app's real
   image-processing entry point with each preset (override only the one setting you are sweeping),
   so defaults, caching and fallbacks behave exactly as they ship, and include a control row — the
   current production preset — that must reproduce production's output **byte for byte**. Say so
   in the README ("Nothing here is simulated"); it's what makes the page decision-grade.
3. **Inputs = real + synthetic.** Real inputs from the dev DB chosen for diversity (size, format,
   content type), plus deliberate stress cases (`synth-flat`, `synth-noise`, `synth-gradient`,
   `synth-text`, a transparent PNG). Record both in `inputs/manifest.json`.
4. **Prove the instrument before trusting its output** — see §5.
5. **Small trial first (limit 5–8).** Download every artifact and actually `Read` the images and
   every CSV row — not summary statistics. When a row looks wrong, re-derive the expected answer
   independently (e.g. a second tool's size and SSIM numbers) before calling it a bug.
6. **Quantify where you can.** A similarity metric (e.g. SSIM) and the byte size, against a stated
   ground-truth row (the original), are what let presets be ranked, not eyeballed.
7. **Emit one self-contained HTML page.** `system('open', path)` at the end unless `OPEN=0`;
   cache renders on mtime so re-runs are cheap; write to a gitignored `out/` as an append-only
   timestamped file with the swept parameter in the name (`quality-<%Y%m%d-%H%M%S>.html`) so runs
   stay comparable. **The page's own design — the controls toolbar, the per-cell exact parameter
   values and measured numbers, the mandatory `none` control row, the click-to-enlarge lightbox,
   the theme tokens — is owned by `visual-explainer` (mode `explore`).** Load it before emitting
   the template; this skill owns the generator, that one owns the page.
8. **Verify the page** with **visual-explainer**'s verification phase (a Node static server — the one-liner is in **verify-in-app**'s gotchas,
   drive every toggle with the browser tool and assert the computed values, both themes, read the
   screenshots back, a ~390 px overflow check, kill the server).
9. **Bound expensive sweeps.** A full pass can run tens of minutes. Launch detached —
   `nohup <runner> … > all_inputs.log 2>&1 &` — and watch with a `Monitor` until-loop on a
   completion marker the script prints (`^RESULT flagged=`), with `|| ! kill -0 <pid>` as the
   abort arm. A foreground `Bash` call would hit the 2-minute timeout. (The reaping rules behind
   this — background tasks SIGTERM'd on a timer, a foreground timeout killing the whole process
   group — are in **worktree-dev-server**.)
10. **Deliver to a stable browsable path** under `tickets/<name>/` in addition to any presigned
    cloud-storage link — those expire (at most 7 days for S3's SigV4 presigned URLs).

## 5. Prove the instrument before trusting its output

Non-negotiable for anything that *measures*. Build the ground-truth harness **before** pointing
the tool at real data, and re-run it after every change to the measurement code.

1. **Construct inputs whose answer you already know exactly** — an image with a drawn rectangle
   at a known position, known-transparent vs known-opaque vs known-blurred files, a flat
   single-colour image a lossless preset must reproduce byte-identically, a file compared with
   itself (SSIM must be exactly 1). Recipes in [REFERENCE.md](REFERENCE.md).
2. **Assert the tool reproduces the constructed facts**, to the pixel/byte. This is the kind of
   check that catches a transparency test misreporting every opaque image as transparent.
3. **Only then** run the small real trial, then the full pass.
4. **Write an independent validator** that re-derives every computed column from the raw columns
   and re-checks every verdict rule — a different language is fine here. Require **zero
   violations** across the whole output, and sanity-check the validator against the *trial* CSV
   before the big run lands. Then visually spot-check a random sample of flagged and edge rows.
5. **When a flaw surfaces later at real scale, fix the maths and explicitly correct the earlier
   claim.** Silently re-running hides that a previous recommendation was wrong. Claude's own
   arithmetic and wiring are a recurring failure source: a sign error that ranks the worst preset
   first, a ratio inverted so two presets tie, a unit mix-up (KB vs KiB, or width vs height)
   that skews a size column.
6. **Compare in the real surface at real display size, never only on a magnified crop.** A
   difference that is obvious zoomed in can be invisible where the image ships (and vice versa).
7. **When the sampler's chosen candidate becomes code, prove the shipped result reproduces the
   sampler's measured effect** — same input set, same measurement, at real scale on the real
   surface (**verify-in-app**, and bust any render/derivative caches first via **render-pipeline-debug**). A
   visually similar cheaper approximation is a different result.

## Domain facts

- **Run everything from the app repo** via the runner with an absolute sandbox path
  (`bin/rails runner <abs path>`, or the equivalent for your stack). Scripts that need no DB
  (pure ImageMagick samplers) run as plain `node <path>`.
- **A tool that must also run in production is a console-invoked service object or data-fix
  class following the repo's own convention, not a rake task or a loose script** — check the
  repo's contributor docs (e.g. an `AGENTS.md`/`CONTRIBUTING.md`) for how data fixes are
  structured (a base class that supplies `dry_run` and a report is common), and follow
  **prod-script**.
- **Dev object storage is often an emulator** (LocalStack, MinIO) whose buckets do not survive a
  restart. A record already marked `complete` is **never re-uploaded automatically** — destroy
  it and let the pipeline regenerate. Inspect an emulator with the vendor CLI pointed at its
  endpoint (`AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 aws --endpoint-url=http://localhost:4566 s3 ls`).
- **Imaging tools** — ImageMagick invocation and its alpha/quantize traps, hosted image-API
  constraints and render-cache layers: see [REFERENCE.md](REFERENCE.md), before building any
  sampler that renders or measures images.

## Verified gotchas

- **Live-testing a destructive script kills the user's work.** The dry run *is* the verification
  path.
- **A foreground `Bash` 2-minute timeout SIGTERMs the whole process group**, which can silently
  kill a dev server backgrounded from that same shell — breaking renders minutes later in a way
  that reads as a treatment bug. Launch long-lived processes in their own session, and preflight
  reachability so the tool aborts fast with a remediation hint instead of filling a page with
  connection errors.
- **Missing object-storage files look exactly like CORS.** An image that 404s renders nothing and
  the browser reports `ERR_BLOCKED_BY_ORB` or a CORS error — almost always an emulator restart,
  not a CORS policy. Check the bucket before theorising, and **don't shortcut by dropping
  generated assets into `public/`** on an assumed restriction — re-serve through the app's own
  storage layer.
- **RSpec's global `describe` DSL is loaded inside `rails runner`** and shadows a top-level
  `def describe(item)`. Rename the helper. (Rails/RSpec example; watch for the analogous clash in
  any runner that preloads a test framework.)
- **Lazy-loaded images inside `display:none` rows never fire their request**, which reads as
  "still pending" in the sampler.
- The measurement traps (mean-alpha on images with no alpha, quantize destroying alpha, hosted
  API dedup dropping analysis fields, transparent PNGs flattening to black, `montage`'s font
  failure, a `HEAD` request on a render URL leaving a lock behind) are all in
  [REFERENCE.md](REFERENCE.md).
- Prefer algorithmic geometry detection to hand-tuned offsets — "this looks off-center, can you
  fix it please" is what hand-tuning earns.

## When NOT to use this / hand off

- **A one-off production question** → **warehouse-data** first (query it yourself), then the
  `<ops_bot>` if your team runs one, **prod-script** last: numbered scripts in
  `adhoc/<YYYY-MM-DD>-<slug>/`, `DRY_RUN = true`, pasted into `<prod_console_cmd>`. Claude has no
  live production connection.
- **The local stack is broken right now** → **dev-doctor**. It *runs* the status/kill/boot scripts
  this skill writes.
- **Proving a change works in the running app** → **verify-in-app**.
- **A vendor API claim needs settling** → **vendor-api-probe** (its throwaway numbered probes plus
  the mandatory resource cleanup).
- **A render isn't showing the expected result** → **render-pipeline-debug** before building a
  sampler; it may just be a cache layer.
- **Turning findings into a durable doc** → **research-doc**.
- **The tool's conclusion becomes a code change** → **ship-pr**, and mirror the sampler's measured
  effect in the implementation.
- **The script's shape / idiom before handing it over** → **code-style** (its self-review
  checklist is the gate before any deliverable is presented).
- **The sampler's HTML page and its verification** → **visual-explainer** (mode `explore`) — this
  skill owns the generator, that one owns the page.
- **An isolated DB for a toolkit that mutates dev data** → **worktree-create** (isolated
  database/queue setup).
- **A long sweep run by a delegated agent** → **agent-team** (brief with absolute paths and a
  mandated report format).
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.
