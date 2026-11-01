---
name: render-pipeline-debug
description: Debug a multi-stage media render pipeline — in-process (ActiveStorage, Shrine, Sharp/libvips) or via an external renderer (imgproxy, a headless-Chrome PDF service) — when an output looks raw/untreated, a thumbnail or PDF preview is stale, a transform "isn't working", or a page waiting on a render spins forever. Identify which surface you're actually looking at first (some surfaces intentionally serve the original), trace input → transform → fingerprinted derivative → storage → URL → CDN, list every input that sits outside the cache key, and bust every cache layer (prefer a new key over a purge) before concluding the code is wrong. Use for "the watermark isn't applied on these thumbnails", "I changed the transform and the old image still shows", "is the resize even running — debug it and verify yourself", "the PDF preview never appears". NOT for generic local-stack failures (ports, Docker, workers down → dev-doctor) and NOT for opening the fix as a PR (ship-pr).
argument-hint: "[record-id | blob-id] [--surface <name>]"
---

# Debug a multi-stage render pipeline

Image, PDF and video pipelines share a shape: an **input** (an upload) passes through a
**transform** (resize, crop, composite, watermark, rasterise a PDF page), the result is stored as a
**fingerprinted derivative**, served from **storage** under a **URL**, often through a **CDN** —
with a cache at almost every hop. Two archetypes:

- **In-process** — ActiveStorage variants and previews, Shrine derivatives, CarrierWave versions,
  Django imagekit, a Sharp/libvips call in a Node route. The app runs the transform itself.
- **External renderer** — imgproxy or thumbor in front of storage, a headless-Chrome PDF service.
  The app builds a URL or request and the service does the work, usually with a cache keyed by
  that URL.

Most "the transform isn't working" reports are one of three things: the **wrong surface** (one
that intentionally serves the original), a **stale cache**, or an **input outside the cache key**
(the transform changed, the fingerprint didn't). Prove which before reading a line of transform
code.

**Worked example, reproduced end to end:** a Rails 7.2 app attaches photos with ActiveStorage and
shows `photo.image.variant(resize_to_limit: [800, 800], composite: "watermark.png")`. Someone
replaces `watermark.png` with new art at the same path — and every thumbnail keeps the old
watermark, forever. ActiveStorage fingerprints a variant as a digest of the *transformation hash*;
the hash holds the watermark's path, not its bytes, so the new art is a fingerprint hit that serves
the old derivative. Each section below shows the method on this example; `REFERENCE.md` has
templates for mapping your own pipeline and the external-renderer layers.

## Hard rules

- **Don't code yet.** A question about the pipeline gets analysis with pros/cons and zero edits.
  Once a fix is approved and verified, commit it by default (staged precisely, never `-A`/`-u`);
  leave it uncommitted only when the user explicitly says so. Pushing and opening the PR is
  **ship-pr**.
- **Never work in the main checkout** when other sessions may be using it. The dev server port, the
  dev DB, local object storage and job queues are shared. Diagnose read-only, run elsewhere
  (**worktree-create** / **worktree-dev-server**), and never reclaim a contested port or server
  without explicit permission.
- **Never read `.env*`.** Reference env vars by name from a runner script instead.
- **Never delete the originals** (the source blobs/uploads). Every derivative references them;
  dropping them orphans everything downstream. Bust derivatives only — a cache-bust tool exists so
  nobody reaches for `.delete_all` in a console (`REFERENCE.md` §3).
- **No live production access.** Local runners and DB tools hit **dev only** — never describe their
  output as "prod". Production reads go to **warehouse-data** first ("how many variant records were
  created since the deploy?"), then the `<ops_bot>` if your team runs one, then **prod-script**
  last; every repair is a **prod-script** `repair`.
- **If this arrived as a chat thread or a ticket, run bug-intake first.** It owns intake → RCA, and
  the thread's screenshots usually identify the surface (§1).
- **Don't mutate derivative bookkeeping through callbacks you haven't read.** Destroying an
  attachment can enqueue purge jobs for the original; re-saving a parent can re-enqueue every
  preprocessed variant. Use the narrowest call (purge the derivative's own file, destroy the
  derivative's own row) or the cache-bust tool.

---

## 1. Identify the surface before you debug it

**Debugging the wrong surface has burned whole sessions.** Do this first, every time. Make a table
for your app — one row per place the output appears. For the worked example:

| Surface | URL shape | What serves it | Transformed? | Cached where |
|---|---|---|---|---|
| Variant, redirect mode | `/rails/active_storage/representations/redirect/:signed_blob_id/:variation_key/*filename` | `RedirectController` → 302 to a signed storage URL (`expires_in service_urls_expire_in`) | yes | derivative record + storage object; the signed URL until it expires |
| Variant, proxy mode | `/rails/active_storage/representations/proxy/…` | `ProxyController`, sent with `http_cache_forever public: true` | yes | all of the above **plus every CDN and browser, forever, by URL** |
| Original | `/rails/active_storage/blobs/…` | blob controller | **no — by design** | storage object |
| PDF / video preview | a representation of a non-image blob | a previewer (poppler, mupdf, ffmpeg) renders an image, then a variant of it | yes | the preview image attached to the blob, plus the variant layers |

What to look for in any app:

- **Places that deliberately hand out the original** — a download link, an email attachment, an
  API export, the file sent to a third party. "The watermark is missing" can be correct there.
- **Silent fallbacks to the original** — a helper that renders the variant only when the blob is
  `variable?` (content type in `ActiveStorage.variable_content_types`) and the original otherwise.
- **The URL tells you which pipeline served it** — and whether the fingerprint moved: ActiveStorage
  carries the `variation_key` in the path, imgproxy carries the processing options. Compare the
  URL before and after the change; same URL means same key.

## 2. Inspect state before touching anything

If the repo ships a debug/inspect helper for these records (in `lib/`, a rake task, an admin
"inspect" page), use it instead of hand-rolling a snapshot — and under a context budget, ask it for
a subset of sections. Note which sections call third parties live (slow, rate-limited, and "no
answer" ≠ "fine") and drop those to keep the call local.

Otherwise, a scratchpad runner script that marks its own output so it survives noisy logs:

```bash
bin/rails runner - <<'RUBY'
def say(message) = puts("@@@ #{message}")
blob = Photo.find(<id>).image.blob
transformations = { resize_to_limit: [800, 800], composite: 'watermark.png' }   # copy from the code
variant = blob.variant(transformations)
record = blob.variant_records.find_by(variation_digest: variant.variation.digest)
say "blob=#{blob.id} type=#{blob.content_type} variable=#{blob.variable?} processor=#{ActiveStorage.variant_processor}"
say "digest=#{variant.variation.digest} record=#{record&.id} image_key=#{record&.image&.key} created=#{record&.created_at}"
say "watermark sha=#{Digest::SHA256.file('watermark.png').hexdigest[0, 12]} mtime=#{File.mtime('watermark.png')}"
RUBY
```

A derivative record created *before* the input changed (compare `created` with the input's
mtime/commit) is the stale-cache signature. (`RAILS_LOG_LEVEL=warn` quiets the runner. The repo's
`tmp/` may be write-denied — pipe a heredoc rather than writing a file into the repo.)

## 3. Reproduce on the real surface

- **Reach the surface the way a user does.** A navigation button may fire a prerequisite request
  (creating a record the next page expects) before pushing the route; hard-navigating to the URL
  skips it and the page misbehaves for unrelated reasons.
- **Use real input events** — a Playwright `browser_click`, not a synthetic DOM `.click()`, which
  may not fire the framework's handlers. Upload through the real file input.
- For image/colour claims, pixel-probe the rendered output (download it, read the exact RGB at a
  known point) rather than eyeballing a screenshot — see **verify-in-app**. In the worked example,
  pixel-probing also caught a fixture mistake: a grayscale source made the composite colourless,
  which a glance at a thumbnail would have missed. For PDFs, rasterise the page first
  (`pdftoppm -png -r 72 -f 1 -l 1 out.pdf page`) and probe the PNG.

## 4. Trace the pipeline — and list what the fingerprint doesn't cover

Write the spine for your app once (`REFERENCE.md` §1). The worked example, read from the
ActiveStorage 7.2 source:

```
photo.image.variant(t)                       Blob#variant → Variation.wrap(t)
  → VariantWithRecord#processed
       processed? = record.present?          record = blob.variant_records.find_by(variation_digest:)
                                             (or the already-LOADED association, if loaded)
       digest     = SHA1(Marshal.dump(transformations))      ActiveStorage::Variation#digest
  → process → ImageProcessingTransformer (vips or mini_magick) → instrument "transform.active_storage"
  → record.image.attach(output)              a new storage key; existing keys are never overwritten
  → url: representation route (redirect → signed service URL, or proxy → streamed, cached forever)
```

Walk it with **numbered** scratchpad runner scripts (`trace_01.rb` → `trace_09.rb`), each one layer
deeper along the **real** call path — never an admin tool's shortcut, which often takes a
different route. The derivative's stored record (id, key, created_at) is ground truth; the page can
hide which derivative it shows.

**Then list every input the transform reads, and mark which ones are in the fingerprint.** Anything
outside it is a staleness source: changing it is a fingerprint *hit* that serves the old output.

| Input the transform reads | In the ActiveStorage digest? |
|---|---|
| the transformation hash as written (keys, values, **key order**) | yes |
| the original blob | yes (derivatives hang off the blob) |
| **the bytes of a referenced file** (watermark, font, ICC profile, LUT) | **no** — only its path string |
| **the processor** (`variant_processor` vips ↔ mini_magick) and library versions | **no** |
| defaults merged at process time (output format, saver/quality options) | only if they end up in the hash |
| the transformer's own code | **no** |

The cure for an input outside the key is to **put a version of it into the key** — a content hash
in the referenced file's name (`watermark_<sha8>.png`), or an explicit version param in the
transformation hash. A new key busts every layer at once, including CDNs (§5). "Bump the version"
only works if a version is in the key at all.

**Three fast diagnoses before you go deep:**

- **"It's raw / untreated."** You're on a surface that serves the original (§1), or a fallback
  chose it (`variable?` false, a missing processor, a rescue that returns the original URL on
  error). Check that before suspecting the transform.
- **No transform ran at all.** A fingerprint hit: an existing derivative record was found. Prove it
  — the record id/key didn't change, and no `transform.active_storage` event fired.
- **"No change" can be correct.** `resize_to_limit` never upscales, so an image already smaller than
  the limit comes back at its own size; transforms with guards (only-if-transparent,
  only-if-larger) legitimately do nothing for some inputs.

## 5. Output stale? Bust every cache layer before blaming the code

List your layers (`REFERENCE.md` §2 has the table for both archetypes). The worked example has six:

1. **The derivative record and its stored file** (`VariantRecord` + its attached image) — keyed by
   the variation digest. `record.image.purge` then `record.destroy`.
2. **The in-memory loaded association** — after a bust in the same process, `blob.variant_records`
   may still hold the destroyed row, so `processed?` says true and the download is empty.
   `blob.reload` after any bust in a console or runner.
3. **Anything the app persisted or cached** — a URL stored in a column, a fragment cache around the
   `<img>` tag, a cached API response.
4. **The storage object** — written once under its key and never overwritten; a new derivative gets
   a new key.
5. **URLs held downstream** — signed redirect targets stay valid until they expire; proxy-mode
   responses are cached forever by every CDN and browser that saw them.
6. **Preview images** for PDFs/videos — attached to the blob and reused until purged.

An external renderer adds its own layers — its response cache, keyed by the request URL, plus
whatever it reads that the URL doesn't capture — `REFERENCE.md` §2.

**Purge vs new key.** A purge (delete the derivative, regenerate under the *same* key/URL) fixes
what you can reach — your DB, your storage — but nothing downstream that cached the URL. When a CDN
or long-lived browser cache sits in front (proxy mode, `Cache-Control: immutable`, a long
`max-age`), **only a new key reaches those copies**. Prefer changing the fingerprint (version the
input, §4) over a purge; use a purge for local debugging and for layers no one else caches. In the
worked example both were reproduced: the purge re-rendered locally but kept the same URL; the
versioned watermark produced a new record, a new key and a new URL.

Use a cache-bust tool for the purge path (dry run by default, `CONFIRM=yes` to commit, refuses
production, never touches originals — design in `REFERENCE.md` §3). **A scoped run usually can't
clear shared rows**: if many records point at one shared derivative, a per-record bust
must skip it.

**Prove the bust landed with a positive signal that a transform actually ran** — never the
browser:

- the derivative record's id/key changed;
- an instrumentation event fired (ActiveStorage emits `transform.active_storage` and
  `preview.active_storage`; it writes no log line for a transform, so subscribe:
  `ActiveSupport::Notifications.subscribe('transform.active_storage') { |*| puts '@@@ transformed' }`);
- for an external renderer, a cache-status response header (`Cache-Status`, `X-Cache`, `Age`) or
  its access log showing a miss and a real render time (`REFERENCE.md` §4).

The multi-layer bust is usually the most-repeated explanation in an area like this — when you've
just walked someone through it, offer a **visual-explainer** page or a **research-doc** note rather
than re-deriving it next session.

## 6. Page spinning forever? Check the background job, not the renderer

When a page waits for a render that happens in a job — preprocessed variants
(`variant :thumb, …, preprocessed: true` runs `ActiveStorage::TransformJob` after attach), preview
images (`ActiveStorage::PreviewImageJob`), a queued external render — a **dead job** presents as an
infinite spinner or a permanently missing image.

- Read the failed jobs and their actual backtraces (`Sidekiq::DeadSet` / the retry set, GoodJob or
  Solid Queue failed executions). Know the job's retry policy — a custom "retry once after a fixed
  delay" option is not the framework's default backoff.
- If several worktrees point at one Redis or one jobs table, another worktree's backlog starves
  yours.
- **Batch generation can look stalled when it isn't** — items can sit pending and complete together
  at the end. Time a known-good run before calling a mid-flight check "stuck".
- Missing system binaries fail only inside the job: `vips`/`magick` for variants, `pdftoppm` or
  `mutool` for PDF previews, `ffmpeg` for video previews. Check them on the worker, not your shell.

## 7. Nothing to reproduce with? Seed a realistic fixture

- Upload through the **real upload path** (the file input or direct upload), not a factory that
  writes rows directly — the attach callbacks are part of the pipeline.
- Use inputs that stress the transform: a transparent PNG, a CMYK JPEG, a phone photo with EXIF
  rotation, a very large image, an animated GIF, a multi-page PDF. Make the colours distinct enough
  to pixel-probe.
- Confirm the processor/renderer is healthy first (`vips --version`, `magick -version`, the
  external renderer's health URL).
- A dev DB rebuild silently wipes prior fixtures; a local object-storage emulator (LocalStack,
  MinIO) may recreate buckets on restart but **not objects**, so uploads 404 afterwards.

Write the seed as a **sandbox-tool** *toolkit* rather than a `/tmp/seed.rb`:
`<sandbox_dir>/tickets/<TICKET>/<tool>/` with `MODE=report|apply|revert`, a baseline captured before
the first mutation, a durable copy of anything uploaded to local object storage plus a standalone
restore script, and a README. If `sandbox_autocommit` is on, commit only the paths you wrote.

## 8. After the fix

0. **Run code-style's self-review checklist over the diff** first — fixes here pull toward a
   fallback chain, a bespoke one-caller service, and a param default that silently changes every
   fingerprint. **code-review** is the correctness pass; code-style is the shape pass.
1. **Restart the workers** — most job runners don't hot-reload.
2. Re-verify with a runner script asserting the derivative record is new (id/key) and its output
   has the expected property (dimensions, pixel colour) — not just that the page looks right.
3. Re-check visually on the surface from step 1.
4. **Update the spec's doubles** so the same regression can't be masked again.
5. For a refactor, prove **byte-identical output** across a fixed input set before/after — "tests
   pass" is a different claim.
6. **Prove it on the surface from step 1** with **verify-in-app** (`--depth browser`, or
   `evidence-pack` when it goes into a PR) — pixel-probe the derivative and read the derivative
   record back. Bust the caches between the before and after shots or you will compare two stale
   renders.
7. **Shipping → ship-pr** (which may route to **cloud-agent-work** when `<cloud_agent>` is set). Put
   this skill's findings in the brief: the surface, the wrong layer, the input outside the key, the
   property to assert. A cloud sandbox may lack the processor binaries or an external renderer, so
   the task should prove the fix at the **derivative** level — the real transform run, outputs side
   by side. When the proof needs the full pipeline or your local caches, ask the user whether to
   stay local.

---

## Verified gotchas

- **A referenced file changed at the same path → stale forever** (the worked example). The digest
  covers the path string, not the bytes. ⇒ Content-hash the file name, or put a version in the hash.
- **Key order is part of the ActiveStorage digest.** `Marshal.dump` of the hash as written — the
  same transformations in a different key order are a different variant, so two call sites that
  spell it differently store two derivatives. ⇒ Define each variant once (named variants) and reuse
  it.
- **Switching `variant_processor` doesn't invalidate anything** — existing derivatives keep the old
  processor's output until busted.
- **A loaded association outlives a bust in the same process** — `reload` the parent.
- **Preview 403 AccessDenied** ⇐ a cached copy of a *signed* storage URL (a fragment cache, a stored
  column, an external service's cache) outlived its expiry ⇒ cache the representation route, not
  the signed target; or mint a new key.
- **Any byte difference in a transform's params is a cache miss**, even when the output is
  identical — whenever the fingerprint covers serialized params. *Absence* of a param is the
  cache-stable "use the default": normalize by deleting a param that's nil or equal to the default.
  So `params['k'] ||= …` is wrong — `h['k'] ||= nil` **creates** the key and changes every
  fingerprint. A version bump invalidates everything at once and is **not** needed when adding an
  optional param whose default reproduces old output byte-for-byte.
- **Attributes assigned in `before_validation` are nil on unsaved records** — and preview code is
  often exactly the code that builds unsaved records. Read the source the callback copies from.
- **A default keyword argument doesn't apply when the caller passes an explicit `nil`.**
  `def thumbnail(size: default_size)` silently dropped the fallback when a resolver forwarded
  `nil`; the fix is `size: nil` + `|| default_size`. When adding behaviour to a `SimpleDelegator`
  wrapper, override **every** entry point — a wrapper that overrode two methods but not the URL
  method silently dropped its context. A delegator can't dispatch calls made *within* a delegated
  method back into the wrapper; `super` inside a delegator subclass does work.
- **Shared scopes without a nil guard** raise for the records that lack the association; guard at
  your call site, not in the shared scope. `.sole` raises on two matches.
- **RSpec's global `describe` is loaded in `rails runner`** and shadows a top-level
  `def describe(record)` — rename the helper.
- **`jsonb_object_keys` errors on array-shaped JSONB** — check `jsonb_typeof()` first.
- **Zeitwerk:** a backward-compat constant alias defined *inside* a renamed file is never autoloaded
  when a queued job payload references the old constant. It needs its own file at the old path.

## Design rules this area enforces

These are **code-style** principles with a render-pipeline instantiation; cite the principle.

- *One always-correct source beats a fallback chain* → one method returns the watermark/transform
  for a record; no `record.custom_transform || account.transform || DEFAULT` repeated at call sites.
- *Export the decision, not the ingredients* → precedence (record override → account setting →
  default) lives in exactly one method that takes the objects the caller already holds.
- *Default ON, with one explicit opt-out* → derivatives everywhere, the original only on the
  surfaces that must hand out the original (§1), each one named.

## When not to use this / hand off to

- Stack down, ports/Docker/workers broken, white screen → **dev-doctor** first. A cold frontend
  dependency re-bundle right after a cache clear looks exactly like a dead server.
- An isolated env to test the fix → **worktree-create**; the frontend on `<dev_url>` for Playwright
  → **worktree-dev-server**.
- Proving the fix in the running app with identical DB state → **verify-in-app**.
- A chat/ticket report you haven't traced to code yet → **bug-intake**.
- Shape review of the fix → **code-style**.
- A visual page explaining the pipeline or the cache layers → **visual-explainer**.
- Many records swept in parallel → **agent-team**.
- A prod fact about these records → **warehouse-data** (then the `<ops_bot>`, then **prod-script**).
  A third-party renderer/API claim → **vendor-api-probe**.
- Making the debug script reusable → **sandbox-tool**. Writing up the RCA → **research-doc**.
- Opening the PR → **ship-pr** (+ **gh-stack**); reviewing one → **deep-pr-review**.
- CI + bot findings once the fix is a PR → **pr-triage**.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime**.

Templates for mapping your own pipeline, both archetypes' cache layers, the cache-bust tool
design, external-renderer notes and defect classes worth recognising: **[REFERENCE.md](REFERENCE.md)**.
