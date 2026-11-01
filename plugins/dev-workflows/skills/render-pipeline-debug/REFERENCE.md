# render-pipeline-debug — reference

Templates for mapping your own render pipeline, plus the long-tail lessons that generalize. Fill
the templates in once per app, keep them in the project's `CLAUDE.md` or memory with an as-of date
and the commit (or library version) you verified against, and re-grep anything load-bearing before
you act on it. The filled-in column uses the worked example from SKILL.md (ActiveStorage 7.2
variants and previews).

---

## 1. Map the pipeline layers

| # | Layer | Worked example (ActiveStorage) | Yours |
|---|---|---|---|
| 1 | **Where the URL is produced** (view helper, serializer, API field) | `url_for(photo.image.variant(:thumb))` / `rails_representation_url` | |
| 2 | **Read path** — does it ever render inside a request? | redirect/proxy controllers call `processed`, which renders on a miss | |
| 3 | **Fingerprint** — what the derivative is keyed by | `Variation#digest` = SHA1 of `Marshal.dump(transformations)` | |
| 4 | **Transform** — the processor and its options | `ImageProcessingTransformer` on vips or mini_magick | |
| 5 | **Derivative store** — the record + file | `VariantRecord` + attached image under a new key | |
| 6 | **Delivery** — URL lifetime and who caches it | signed redirect (expires) or proxy (`http_cache_forever`) | |
| 7 | **External renderer**, if any | — (previews shell out to poppler/mupdf/ffmpeg) | |

Also list **every entry point that creates a derivative** (`grep -rn 'variant(\|preview(\|\.processed'`
or your library's equivalent): the views, preprocessed named variants (a job after attach), batch
jobs, admin "regenerate" actions, console helpers. Admin paths often take a different route than
the user's path — trace the user's.

Questions to answer for the read path and the store:

- **Is the derivative reused forever?** A reused derivative means a bad render persists until
  something busts it.
- **Are concurrent first requests deduplicated?** Two simultaneous misses can both render and both
  write; ActiveStorage resolves the race when it creates the variant record — check what yours does.
- **What does the read path do when nothing is ready?** Render inline (slow requests, timeouts on
  huge inputs) or return a placeholder and let a job fill it (pollers, spinners)?

### Processor matrix

| Input kind | Processor | Notes |
|---|---|---|
| raster images in `variable_content_types` | ImageProcessing (vips or mini_magick) | `variant_processor` setting |
| PDF | poppler (`pdftoppm`) or mupdf (`mutool`) → image → variant | first page only by default |
| video | ffmpeg → frame → variant | |
| anything else | none — the original is served | the silent-fallback surface |

### Transform options in use

List every distinct transformation hash the app uses (named variants make this one grep), with its
call sites. Two call sites spelling the same transform differently (key order, `[800, 800]` vs
`[800, 800.0]`) are two derivatives.

---

## 2. Map the cache layers

### In-process (worked example)

| # | Cache | Key | How to bust | Notes |
|---|---|---|---|---|
| 1 | Derivative record + file | variation digest | `record.image.purge; record.destroy` | never touch the original blob |
| 2 | Loaded association in memory | — | `parent.reload` | bites in consoles and long-lived processes |
| 3 | App-level caches holding URLs/HTML | fragment/cache key | expire the fragment / clear the column | check for stored *signed* URLs |
| 4 | Storage object | object key | delete the object (layer 1's purge does it) | written once, never overwritten |
| 5 | Signed redirect target | URL | wait for expiry, or new key | lifetime = `service_urls_expire_in` |
| 6 | CDN / browser | URL | **new key only** (or a CDN purge API, if you control the CDN) | proxy mode is cached forever |
| 7 | Preview image (PDF/video) | blob | purge the preview image | reused until purged |

### External renderer — a headless-Chrome PDF service with a URL-keyed cache

| # | Cache | Key | How to bust | Notes |
|---|---|---|---|---|
| 1 | The rendered file the app stored (an attachment on the record) | per record | purge the attachment | regenerated on the next request or by a job |
| 2 | URLs or HTML the app stored or fragment-cached | per record | expire them | |
| 3 | The service's response cache | the request URL, query string included | change the URL — add `v=<content hash of the inputs>` — or use the service's documented purge | check whether it caches at all, and for how long |
| 4 | CDN / browser | URL | new URL | as above |

**What the URL doesn't capture is outside the key.** The HTML or template the service fetches, the
fonts in its container, the source image behind a stable source URL: change any of them and the
cached response stays. Put a content hash of those inputs into the URL.

URL-signed image processors (imgproxy, thumbor) encode the transform options in the URL, so a new
transform is a new URL automatically — but a source image replaced at the same source URL is
outside that key. Version the source URL.

### Fingerprint design (and why params bite)

A sound design digests a **stable serialization** of everything the output depends on:

```ruby
Digest::SHA256.hexdigest(
  JSON.generate([input_id, steps.map { |step| [step.key, step.version, step.params.sort.to_h] }])
)
```

Properties that matter: params serialized in a stable (sorted) order; every step's key and version
in the digest; **and every external input either in the digest or versioned by name**. Run the
"outside the key" checklist (SKILL.md §4) against your own digest: referenced files, processor and
library versions, defaults merged later, transform code. Consequences of getting it right:

- any byte difference in params is a cache miss, even when output is identical — normalize by
  deleting params that are nil or equal to the default;
- bumping a step's version invalidates every row for it at once — needed only when output for
  existing params changes.

---

## 3. Cache-bust tool — the design that's safe to hand around

If your repo or sandbox doesn't have one, build it with **sandbox-tool**; it pays for itself the
second time. Properties:

- **Dry run by default** — prints per-layer counts, deletes nothing. `CONFIRM=yes` to commit.
- **Refuses production** (`abort if Rails.env.production?` — this is a local tool, so `abort` is
  fine here, unlike a console paste).
- **Never touches originals.**
- **Writes parent records with `update_columns`** so no save callback re-enqueues work or notifies
  anyone.
- **Narrowing flags**: `RECORD=<id>` (scoped — and therefore must skip shared rows, which it says
  in its output), `APP_LAYERS_ONLY=1` (leave the renderer's caches alone).
- **Reloads what it busted** and prints what it did per layer, so the user can match it against the
  positive signal (new record id/key, instrumentation event, a cache-status header).
- **Says what it can't reach**: CDN and browser copies of the old URL. If those matter, the fix is a
  new key, not this tool.

---

## 4. External renderers

Fill in for yours:

- **How to run it locally** (e.g. `docker compose up -d` in its repo → container name, port, health
  URL).
- **What is its cache key?** Usually the request URL. List what the service reads that the URL
  doesn't capture (§2) — those are your staleness sources.
- **How to see a hit vs a miss.** Prefer a standard response header — `Cache-Status` (RFC 9211),
  `X-Cache`, `Age` — or the service's access log with a render time. A near-zero response time on a
  "fresh" request is a hit.
- **Env var names** (never values; never read `.env`): the service URL, any signing key, any
  upstream API key.

### Headless-Chrome PDF renderers

- **Wait for fonts and images before printing.** Print as soon as the DOM is ready and web fonts
  fall back silently; wait on `document.fonts.ready` and image `load` events (or a "render done"
  flag the page sets).
- **Relative asset URLs don't resolve** when the HTML is passed as a string rather than loaded from
  a URL — set a `<base href>` or inline the assets.
- **Fonts missing from the renderer's container** produce a fallback font only in the rendered PDF,
  never in your browser. Check the container's installed fonts.
- **Timezones and locales** come from the renderer's environment, not the user's — dates printed in
  a PDF are a classic "correct locally, wrong in prod" bug.

### Local object-storage emulators (LocalStack, MinIO)

- If a setup script creates the buckets and wires credentials, **run the script; don't read the env
  file yourself**.
- Restarts may recreate buckets but **not objects** — every upload 404s afterwards. Keep durable
  copies of fixtures and a restore script.

---

## 5. Defect classes to recognise, not re-diagnose

- **EXIF orientation ignored** — a phone photo renders sideways in the derivative but upright in the
  browser's view of the original (browsers apply EXIF; some pipelines don't). Auto-orient as the
  first step.
- **Colour profile dropped** — CMYK or wide-gamut inputs shift colour when the ICC profile is
  stripped or not converted to sRGB.
- **Alpha flattened to black** — converting a transparent PNG to JPEG (or quantizing it) without an
  explicit background fills transparency with black. Flatten onto a chosen colour.
- **Animated inputs lose frames** — a GIF/WebP transform that silently keeps only the first frame.
- **Pixel/memory limits** — very large inputs hit the processor's limits (ImageMagick `policy.xml`,
  libvips' unlimited-access settings, a function's memory cap) and fail only on the big ones.
- **Fonts and codecs differ between machines** — a transform that renders text or decodes video uses whatever fonts/codecs the worker has; an output that differs only on one host usually means a missing package there.
