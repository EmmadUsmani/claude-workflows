---
name: vendor-api-probe
description: Settle a claim about a third-party API empirically by driving the live API — preferably through the app's own API client from a local runner (`bin/rails runner`, `python manage.py shell`, a node script), else plain HTTP — instead of trusting docs or a vendor's word. Break the claim into testable assertions, one small numbered script per hypothesis, save raw request/response JSON under `<sandbox_dir>` with a claim-by-claim verified/not README, and delete every resource you created — proving it existed (GET 200) before the delete and is gone (re-GET 404) after. Use for "verify the vendor's claims about their API change", "query their API using our local client, dev has the same creds", "write the sample request + response to a sandbox dir so I can inspect, plus a readme", "check whether the API actually supports X", "probe what the API really returns". NOT for production database facts (warehouse-data first, then prod-script) and NOT for driving your own app's UI (verify-in-app).
argument-hint: "<vendor> <claim-or-endpoint> [--sandbox-dir <sandbox_dir>/...]"
---

# Probe a third-party API for real

Vendor claims ("we shipped support for X", "that field was never returned", "your resource was
dropped") are settled by sending the request, not by reading docs. Drive the **live** API —
through the app's own API client when it has one (e.g. `bin/rails runner` loading the client
class), so you're testing the exact code path production uses and the answer transfers straight
into the fix. Plain `curl` / `gh api` / an SDK one-liner is fine when there is no client, no app,
or the question is about the raw wire format.

**Find out whose account — and whose quota — you are hitting before anything else.** Some dev
environments share a vendor's *live* account with production (no sandbox, or nobody set one up);
then colleagues and the vendor see everything you create there, and cleanup is the price of
entry. Where a real test mode exists (Stripe test keys, a vendor "integration" host), confirm the
client actually resolves to it in this environment — don't assume. Unauthenticated probes often
share a per-IP rate limit with everything else on your network; count the calls a probe will
spend before running it, and prefer free introspection endpoints (GitHub's `/rate_limit` costs
nothing against the limit).

---

## Hard rules

0. **Propose → wait → act before the first create.** State the plan first: which resources you
   will create, in whose account, how many, and the cleanup proof. Get a go-ahead. A read-only
   probe (`GET`s, docs, reading the client) needs no gate — a create does.
1. **Never read `.env*`.** Reference variables by name inside a script you run —
   `ENV.fetch('VENDOR_API_KEY')`, `os.environ['VENDOR_API_KEY']`, `process.env.VENDOR_API_KEY`. If
   the permission layer denies a grep of `.env`, don't route around it — read the client's auth
   method instead; it tells you the variable name.
2. **Dev only. Never the production console** for probes. If dev shares production's vendor
   credentials, that's exactly why cleanup matters.
3. **Every resource you create is proved to exist, then deleted and proved gone — before the next
   probe runs.** Existence: a `GET` of the new id returns 200 with the body you expect, saved as
   evidence. Gone: a re-GET returns 404 (or the API's documented deleted marker). A 404 after the
   delete only counts if the pre-delete GET was 200. Not at the end of the session; not "after the
   PR."
4. **Keep a running ledger** in the script's output — `created: […] outstanding: […]` — updated
   after every create and every verified delete, so an interrupted session knows exactly what
   still needs cleaning up.
5. **State explicitly what you kept and why.** If the user asked you to keep a resource ("don't
   delete it this time"), say so in the summary and in the README.
6. **Report cardinality and framing honestly.** "A label can belong to only one repo" ≠ "label↔repo
   is 1:1". If a behavior is unverified-but-defensive, call it defensive, not confirmed. If a check
   couldn't discriminate (a 404 that was already true before the delete), call it vacuous.
7. **A read-only fixture the vendor seeds in *their* account is not the capability you need.** If
   the ticket needs write access, you must be able to create the resource yourself; a resource in
   the vendor's workspace usually 404s under your key.

---

## 1. Break the claim into assertions

If it came from a chat thread or ticket, read it first (and its attachments). Then write the claim
out as **independently testable assertions** — one row per thing that could be separately true or
false ("the cap is 100" splits into "101 is rejected or clamped?", "is the clamp silent?", "does
paging reflect the clamped size?"). That list becomes the README's result table and tells you how
many probes you need.

## 2. Read the docs the fast way

- Many doc sites publish an **`llms.txt`** index and serve raw markdown; readme.io-hosted docs
  return a page's markdown with `.md` appended — faster and more reliable than WebFetch (some doc
  hosts block WebFetch outright):
  ```bash
  curl -s https://<vendor>.readme.io/llms.txt | head -100          # endpoint index
  curl -s https://<vendor>.readme.io/reference/<endpoint-slug>.md
  ```
- Prefer a published **OpenAPI spec** when one exists (Stripe publishes `stripe/openapi`, GitHub
  publishes `github/rest-api-description`) — it's the machine-readable contract. Note where a
  limit lives only in prose and not in the schema; the schema is what generated clients enforce.
- Also read **your own client**, if there is one, before probing — the docs and your client
  disagree more often than you'd like (paths, versions, encodings, which endpoints are wrapped).

## 3. Pick the credential path

**No app client, or a public API with no credentials?** Skip to §4 with plain HTTP, and record the
account as "none / per-IP" in the README.

Otherwise there are two ways to get a client; try them in this order.

```ruby
# A. Through the app's configured integration (preferred — exercises the real prod code path)
client = Integrations::Billing.current.api_client

# B. Straight from ENV (when stored credentials are stale, e.g. after a dev DB rebuild)
client = BillingApiClient.new(token: ENV.fetch('BILLING_API_KEY'))
```

Sanity-check first, without printing secrets:

```bash
bin/rails runner 'i = Integrations::Billing.current; puts "integration=#{i&.id} has_credentials=#{i&.credentials_configured?}"'
```

**Never "fix" a stale credential by editing a shared integration record.** Use path B. (Re-saving
credentials from ENV into the record is a repair to dev — only if the user asks, and say you did
it.)

Path B needs no DB rows, so a read-only probe can run even with a half-broken local stack. If the
app won't boot at all, bring up only the services the client needs
(`docker compose up -d <db> <cache>` — the service names from the repo's compose file) and leave the
rest down; **dev-doctor** owns anything deeper.

## 4. One numbered script per hypothesis

Write `NN_short_description.rb` — in the app's language when you're driving its client, else a
plain Node script (`NN_short_description.js`, `node file.js`) — and run it. Numbered files make the probe sequence readable
afterwards and let you re-run any single step.

```bash
bin/rails runner <probe_dir>/03_create_probe_resource.rb 2>&1 | grep -v -E "warning|DEPRECATION"

# quieter, and the shape to use when you want the JSON on stdout only:
RAILS_LOG_LEVEL=warn bin/rails runner <script>.rb 2>/dev/null > <script>.output.json
```

Reach past the client's public surface when you need an endpoint it doesn't wrap — if the HTTP
verbs are private on a base class, `client.send(:get, "/v2/things/#{id}")` in Ruby. For a public API
with a CLI, the CLI is often the cleanest probe:

```bash
gh api repos/rack/rack -i | head -20      # -i keeps the status line and rate-limit headers
```

These scripts get read and re-run, so give them the **code-style** pass: full words, a header
comment saying what the probe answers. Anything you'd rerun on a schedule belongs in
**sandbox-tool** rather than the probe dir.

**Raw wire dumps** — HTTParty's `debug_output $stdout`, Faraday's `response :logger` with bodies,
`curl -v`, Python `http.client.HTTPConnection.debuglevel = 1` — are priceless for wire-format
questions, but they print the `Authorization` header. **Never paste that output into a doc, PR, or
chat**, and never save it unredacted. If you probe the same vendor often, build the dump into the
client once behind an env toggle (`VENDOR_HTTP_DEBUG=1` → `debug_output $stdout`) instead of
patching it in each time.

**Design one live scenario that exercises several assertions at once** rather than a request per
assertion — fewer created resources, fewer things to delete. Design the *input* to sit on the
capability boundary you're testing: if the question is whether the API combines two inputs into
one output, pick a target that has two slots and send two distinguishable inputs. For claims about
rendered output (an API that returns images or PDFs built from your input), generate **visually
distinct** synthetic inputs — solid squares in clearly different colours — so you can tell them
apart in the result. ImageMagick may be absent locally; a short pure-Node PNG writer (`zlib` + a CRC32 loop) is a
fine fallback, as **sandbox-tool**'s reference describes.

## 5. Create → GET 200 → DELETE → re-GET 404

Run this after **every** probe that created something, before the next probe.

```ruby
# NN_cleanup.rb — each id was GET-verified (200, expected body saved) right after its create.
created_ids.each do |id|
  before = client.send(:get, "/v1/things/#{id}")
  puts "pre-delete GET #{id} -> #{before.code}"
  next puts("  !! not readable before delete — a later 404 would prove nothing") unless before.code == 200

  response = client.send(:delete, "/v1/things/#{id}")
  check = client.send(:get, "/v1/things/#{id}")
  puts "  DELETE -> #{response.code}; re-GET -> #{check.code} #{'OK gone' if check.code == 404}"
end
```

The same shape against a public API, on a scratch repo you own:

```bash
gh api -X POST repos/<owner>/<scratch-repo>/labels -f name=probe-tmp -f color=ededed
gh api repos/<owner>/<scratch-repo>/labels/probe-tmp -i | head -1      # expect "HTTP/2.0 200 OK"
gh api -X DELETE repos/<owner>/<scratch-repo>/labels/probe-tmp
gh api repos/<owner>/<scratch-repo>/labels/probe-tmp -i | head -1      # expect "HTTP/2.0 404 Not Found"
```

- **A 2xx on delete is not proof.** The pre-delete 200 followed by the re-GET 404 is.
- **Fake-write APIs** (JSONPlaceholder and other mock/demo APIs) answer a `POST` with 201 and an id
  but persist nothing: the new id already 404s *before* the delete, and a deleted existing id still
  returns 200 afterwards. The pre-delete GET exposes this; write it up as "writes not persisted",
  never as "created, deleted, verified".
- **Request mirrors** (httpbin-style echo services) have no resource state at all; a
  create/delete proof can't be expressed against them. Use them for wire-format questions only.
- **Soft-delete APIs**: the re-GET returns 200 with a deleted marker instead of 404 (Stripe returns a
  stub with `"deleted": true` for a deleted customer). Then that marker, quoted verbatim, is the
  proof — say so in the tally.
- **Async creates must settle before they can be deleted** — poll the resource until it leaves its
  processing state (a bounded number of tries), then delete.
- **Uploaded files are separate resources.** Deleting the thing that used an upload rarely deletes
  the upload; archive/delete each one too.
- **Recording an HTTP cassette (VCR, Polly, vcrpy) against the real API creates a real resource.**
  After re-recording, extract the created ids from the cassette and clean them up the same way.
- **Read-only vendors** need no cleanup — say "read-only probe, nothing created" in the README so
  the reader doesn't wonder.

Close with a tally you can defend: *"N created; each GET 200 after create; N deleted; each re-GET
404; outstanding: none."*

## 6. Capture the evidence into the sandbox

Two conventions — pick by whether the probe belongs to a ticket:

- `<sandbox_dir>/tickets/<TICKET>-<slug>/` — ticket-scoped verification
- `<sandbox_dir>/adhoc/YYYY-MM-DD-<slug>/` — a support/chat investigation

What goes in:

```
request.json                  # the exact create request (multipart parts listed by name)
get_thing_response.json       # full response body, untrimmed
NN_probe.rb / NN_probe.output.json
render_<id>.png               # downloaded response images, for visual claims
README.md
```

Large list responses: save each full body to its own side file (`NN_probe.body_<n>.json`) and keep
the status, headers, item counts and a few sample items in the main output file, so the probe's
story stays readable.

For visual claims, actually **download and look at the images** (`curl` the URL, then `Read` the
PNG) — "the response contains a preview URL" proves nothing about what's drawn on it.

If `<sandbox_dir>` is a git repo and `sandbox_autocommit` is on, commit after each meaningful write
— only the paths you wrote, never `add -A` (full rule: **sandbox-tool**). No request header, token
or API key ever lands in a saved `.json` — grep the saved files for `authorization` before
committing.

## 7. Write the README: claim by claim

Lead with what the vendor said (quote it), then the test setup (account, quota, date), then a table
with one row per assertion from step 1 — `Claim | Expected | Observed`. Mark each ✅/❌ (or
"vacuous" when the check couldn't discriminate) with the concrete observation
(`POST /v2/things/batch → 201`), not a summary word.

End with **⚠️ Implication** — for shipped code, which class/method now behaves differently and what
the follow-up is; for an integration that doesn't exist yet, what the design must account for. A
verification doc that stops at "claims are true" makes the reader do the work again.

If the **vendor** needs to act, produce a second, short `.md` with real captured request + response
pairs, scrubbed of credentials, written to be pasted to their support engineer. If you already have
such a doc for another vendor, mirror its structure so the pair reads as a set.

For an internal audience, the same facts make a good **visual-explainer** page (mode `explain`) in
the same dir — put two results side by side rather than describing how they differ, and carry the
exact endpoint URL + payload excerpt per claim. Scrub credentials from everything shareable.

Durable findings belong in project memory (or the project's `CLAUDE.md`) — a probe result with an
as-of date is exactly what saves the next session.

---

## Keep a vendor fact sheet

Every vendor you probe twice deserves a short fact sheet (project memory or a `references/` note).
Each fact carries an **as-of date** — vendor behavior changes, so re-probe rather than trusting
either an old fact or an old fix. Sections worth having:

- **Base URL(s) and auth** — header shape, and the *names* of the env vars (never values).
- **Account and quota topology** — does dev share prod's live account? Is there a real
  sandbox/test mode, and what decides which host the client hits (`Rails.env`, a key prefix like
  `sk_test_`)? What rate limit applies, and is it per key or per IP?
- **Wrapped vs probe-discovered endpoints** — what your client actually calls, and what you found
  by probing that isn't in your code yet (*verify before citing*). Feature flags you *think* gate
  something: check they exist on the default branch.
- **Where derived outputs come from.** Some APIs have a dedicated render/preview endpoint; others
  only produce previews as a side effect of a create plus the read-back. Knowing which is half of
  any "why is the preview wrong" question.
- **Encoding quirks** your client hit — e.g. a multipart encoder that mangles nested
  arrays-of-hashes, where flat indexed bracket names (`items[0][name]`) work. Record the library and
  version it was seen with.
- **Metadata vs write disagreements.** A "describe options" endpoint that advertises values the
  write endpoint then rejects is a vendor-side inconsistency, not your bug — record which
  combinations failed and re-probe after the vendor claims a fix (count before/after).
- **Authoritative vs convenient sources.** An authenticated, documented endpoint beats an
  undocumented, unauthenticated one scraped from the vendor's own web app — never settle a question
  on the scraped one.
- **Enum hygiene.** Vendor enum values can be misspelled or extended without notice; handle unknown
  values instead of assuming the documented set.
- **Cleanup recipe** — every call needed to fully remove what a probe creates.

---

## Verified gotchas

- **A resource in the vendor's own workspace 404s under your key.** If a vendor pastes an example
  id, `GET` it first; you probably can't read it, let alone use it as a fixture.
- **Stale stored credentials after a dev DB rebuild** show up as a `401` from a token that used to
  work. That's the DB row, not ENV — switch to the ENV-built client (path B).
- **Runner output is buried in noise** (APM agents, error-tracker init, deprecations).
  `RAILS_LOG_LEVEL=warn` + a `grep -v -E` filter, or redirect stdout to a file and `2>/dev/null`.
- **Runner stdout is not clean JSON** — the framework prints before your `puts`. If you're piping
  to `jq`, slice the JSON block out first (`sed -n '/^{$/,/^}$/p'`) rather than assuming.
- **HTTP cassettes may live outside the app's own spec dir**, and a stale copy at an old path can
  shadow the new one. A file-level `around` hook wrapping a cassette collides with an example
  recording under the same name ⇒ make the hook honor a metadata tag.
- **Code you don't think of as a write may create vendor resources** — a helper that creates a
  sample resource as a side effect of a read, say. So "no resource exists for that option" can mean
  it was never exercisable, not that nobody tried.
- **The checkout may lack the client method your probe needs.** Worktree the branch that has it
  (**worktree-create**), and note the verification worktree may be ahead of local unpushed work.

---

## When not to use this / hand off to

- The fact you need lives in the **production database**, not the vendor ("which provider was this
  record actually sent to") → **warehouse-data** first (it owns the `<ops_bot>` rung too), then
  **prod-script** last (a script the user pastes into the prod console; never run it yourself).
- You're verifying **your own UI or API** behaves correctly → **verify-in-app**.
- The app won't boot, Docker is down, ports are taken → **dev-doctor** first, then come back.
- The probe turns into a reusable instrument or a preview harness → **sandbox-tool**.
- The write-up should become a durable doc for other engineers → **research-doc**.
- The question is "why is this render wrong" across your own multi-stage render pipeline →
  **render-pipeline-debug** (this skill only covers the third-party hop).
- You arrived from a chat/ticket bug report and haven't yet reached a falsifiable claim →
  **bug-intake**, which owns intake → RCA; come back here for the third-party leg.
- The probe script's shape before you hand it over → **code-style**.
- An internal page showing the vendor's actual behavior → **visual-explainer**.
- Probing several endpoints or vendors in parallel → **agent-team** (one agent per vendor; the
  cleanup ledger stays the lead's).
- Shipping the resulting fix → **ship-pr** / **gh-stack**.
