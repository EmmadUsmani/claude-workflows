# Imaging reference for sandbox samplers and audits

Long-tail facts the image-pipeline samplers and measurement harnesses depend on. Load when the
tool being built renders, measures, or transforms images.

## ImageMagick

- Needs the install dir on `PATH` in any non-login shell (e.g. `PATH=/opt/homebrew/bin:$PATH` on
  Apple-silicon Homebrew).
- **Use `magick`, never `convert`, locally** — but know your deploy target. In Ruby,
  `MiniMagick::Tool::Magick` works locally and **fails in CI/production images whose distro
  package is ImageMagick 6** (no `magick` binary). Code that ships must use
  `MiniMagick::Tool::Convert` (or detect the binary); sampler-only code can use `magick`.
- `%[fx:mean.a]` returns **0, not 1**, when the image has no alpha channel — so every opaque
  image classifies as transparent. Gate alpha stats on `%A` channel presence first.
- Quantize / posterize / dither **destroys alpha** on transparent-padded PNGs unless the
  histogram excludes transparent pixels. Near-transparent padding also outvotes small solid
  regions in population-weighted clustering (a small white shape on a large coloured field loses
  its white to k-means). Filter near-transparent pixels and parse hex tokens explicitly; take the top-N *fully
  opaque* colours of the cluster pass.
- Transparent PNGs **flatten to black** during crop/compose — flatten to white explicitly.
  Segmenting a photo on "distance from white" fails when the background is transparent; segment
  on **alpha**.
- `montage` / `annotate` fails with `unable to read font Helvetica-Bold` unless an installed font
  is named explicitly (`-font /System/Library/Fonts/Supplemental/Arial.ttf` on macOS). When
  `montage` fails outright, build side-by-side strips with `magick … +append`.
- Synthetic ground-truth inputs:
  ```sh
  magick -size 800x600 xc:white -fill '#3355cc' -draw "rectangle 120,90 680,510" synthetic_padded.png
  magick -size 800x600 xc:none  -fill '#3355cc' -draw "rectangle 120,90 680,510" synthetic_transparent.png
  ```
- If ImageMagick is unavailable at all, generate test PNGs in a **pure-Ruby PNG writer (zlib, ~15 lines)** —
  an untested fallback nobody has to run is a fallback that rots, so run it once.

## Hosted image-transform APIs (Cloudinary-style CDNs)

- Probe the primitive directly before designing around it: build the transformation URL from a
  runner script (`bin/rails runner -e 'puts Cloudinary::Utils.cloudinary_url(...)'`) and fetch it.
- Check which analysis features your plan actually includes before designing around one: some
  (focus/blur, perceptual hash, colour) may be on the base tier while others (object detection)
  are gated and return an authorization error.
- **A trim transformation plus an info flag (`e_trim` + `fl_getinfo`) beats an AI detector** for
  pixel-exact padding: a detector's box is approximate by construction, trim returns the exact
  non-background extent.  Cross-check the hosted trim against a local ImageMagick trim on a small trial; they should
  agree to within a pixel or two.
  - What defeats trim is lack of **uniformity**, not lack of transparency. A JPEG on a plain white
    background trims perfectly; a lifestyle scene or gradient does not. So classify backgrounds
    three ways (transparent / uniform+colour / non-uniform) rather than as a transparency
    boolean, and give non-uniform its own verdict.
- **Asset dedup silently omits analysis fields** when re-uploading identical content. Force a
  fresh `public_id` per probe.
- **A hosted API may lack the primitive you need (e.g. colour-profile conversion).** Do it as a
  server-side ImageMagick step against a vendored profile file, and vendor the file into the repo
  — third-party download URLs go stale. Don't ship a cheaper approximation when the sampler
  measured the full conversion.

### Size parameters: resolve them per image

Hosted transformations usually take absolute pixels, but inputs arrive at any resolution. Resolve a
percentage of the image's **shorter** edge per input rather than passing one constant: on a
4800x500 site-header banner, 2% of the longer edge is a 96px effect on 500px of image, while 2% of
the shorter edge is 10px. Wide inputs may need their own tuning on top. If a transformation grows
the canvas, the derivative's aspect ratio changes and nudges placement downstream — badge it per
cell. A reversed/knockout input (light shapes on a transparent background) needs an explicit
make-transparent step or interior shapes flatten away.

## Sidecar services behind a local stack

When a sampler renders through a separate local service (a container, an emulator), every
dependency must be up or every cell fails identically and reads as a treatment bug:

- Rendering may be lazy: the URL is generated instantly and the work happens on first fetch, so
  the first visit is slow and later ones are cache hits.
- A containerised service reaches the host app at `host.docker.internal:<port>`, so a one-shot
  runner alone is not enough — the dev server must be listening.
- Probe with the same verb the real client uses. A health probe with an unsupported method can
  fail in a way that leaves the service's own state (a lock, a half-written cache entry) behind
  and makes later requests look broken.
- Preflight every dependency and abort with a remediation hint (an `assert_services_reachable!`
  helper, bypassable with a `SKIP_PREFLIGHT=1` env var).
- Bound it: one expensive external call per cell, so gate behind an env var (`RENDER=1`) and limit
  to the first input and the first few variants.

## Caches a sampler will fight

A render or transform pipeline usually has several caches (derived-artifact rows keyed by an
input fingerprint, URLs persisted on the owning record, and any cache inside a sidecar service).
A sampler must know every layer and clear them in dependency order, in a `cache_clear`-style
script that documents each layer. A stale persisted URL is the usual culprit: when one is stored,
the app serves it directly and nothing renders at all.

Never delete the user-uploaded source rows themselves.
