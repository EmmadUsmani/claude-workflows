# verify-in-app — per-project facts to collect

The method lives in [SKILL.md](SKILL.md). Verification stalls on project facts — which login,
which host, why a real route 404s, how to get a CSRF token — far more often than on method.
This is the checklist of those facts, each with the lesson that made it worth asking. Answer
them from the repo (routes, seeds, config), not from memory, and record the answers in the
project `CLAUDE.md` so the next session starts at Phase 2.

Examples are a Rails + React + GraphQL app; the questions apply to any web stack.

---

## Hosts and ports

| URL | Serves |
|---|---|
| `<dev_url>` | API / GraphQL / server-rendered admin |
| the browser app's origin (same as `<dev_url>`, a subdomain, or a separate dev-server port) | the SPA |
| sidecar services (`localhost:<port>/health`) | anything the app calls locally |
| `http://localhost:6006` | Storybook, if any |

- **Is the frontend pinned to one port?** If its API base comes from an env var set in a shared
  `.env`, a worktree served elsewhere renders a blank page — **worktree-dev-server** explains and
  works around it.
- **Health route?** If none, any HTTP response means reachable. A CSRF-token endpoint or a
  trivial GraphQL query doubles as a cheap API readiness probe:

```bash
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w '%{http_code}' <dev_url>/<cheap-api-endpoint>)
  echo "attempt $i: api=$code"; [ "$code" != "000" ] && break; sleep 5
done
```

## Sign in

Find the **app's dev login / seeded dev user**: the seed file (`db/seeds.rb`, a `dev:seed`
task, `prisma/seed.ts`, a Django fixture), or a "dev login" bypass button on the admin sign-in
page in development. Record per role (end user, admin) — **the URL of the sign-in page, the
email, and where the password comes from** (a seed constant is fine to note; a real credential
never goes in a skill or a doc).

Lessons that recur:

- **The sign-in path may not be `/signin`.** Apps with several audiences often have one per
  audience (`/app/login`, `/admin/sign_in`). Read the router, don't guess.
- **Field labels are not what you'd type in a selector.** An email field labelled "Username or
  email address" defeats `getByLabel('Email')`. Use `browser_find` with
  `{"regex": "mail|Password"}`, then pass the ref in the field the tool's schema names.
- **A fresh browser profile 4xx's the API until you log in**, and a cold session can fire two
  parallel CSRF-token requests that rotate the cookie → a spurious 422 on the first mutation.
  Reload once to prime.
- **A fresh or isolated DB has no dev user** until the seed task runs against it
  (**worktree-create** step 6).

## Routes — get them from the app, don't guess

```bash
bin/rails routes | grep -i <thing>                 # server-rendered + admin (Rails)
git grep -n 'path=' -- '<frontend>/src/**/*Routes*.tsx'   # client-side React routes
python manage.py show_urls | grep <thing>          # Django (django-extensions)
```

**Why a hard load 404s on a route that exists.** Many backends serve the SPA shell only for an
allow-list of paths (or only to a browser-shaped `Accept` header), with a catch-all `not_found`
for everything else. Find that allow-list — it's usually a constant on the controller that
renders the shell. Consequences to plan around:

- **Allow-list entries may be exact paths, not prefixes.** Check whether the entry covers the
  nested route you need before concluding a hard-load 404 is a bug.
- **Prefer the in-app navigation path over a typed URL.** Client-side navigation can carry state
  (router state, query params, setup the previous step performed) that a deep link skips.
- **Build URLs with the app's own route helpers**, not by hand — helpers may add or omit prefixes
  (locale, tenant) per section.
- **Layout / nested routes keep parent components mounted** — account for that when counting
  re-renders or asserting on which request fired.

## Admin

- Base URL, and how admin auth differs from end-user auth (separate model, a dev-bypass login).
- **Never hand-build an admin URL.** In ActiveAdmin, `register_page 'reports/summary'` mounts at
  the **underscored** `/admin/reports_summary`; the slash form collides with the `reports`
  resource's `show` action and 500s. Confirm with `bin/rails routes | grep admin`.
- **Filters may be plain params, not ransack.** Read the page's controller before trusting an
  old note's `?q[..._eq]=` URL.
- An admin page that reads a **production-only env var** can blow up locally — set a local value
  for that var in your own override (append blind; never read the `.env`).
- System dashboards (Sidekiq Web, Flipper UI, PgHero) are often mounted top-level, not under
  `/admin`, and gated on a role your dev user may lack.
- Screenshot admin with a scoped `target` — full-page shots catch a hover-expanding sidebar
  mid-animation.

## API / GraphQL

- Endpoint path, and **where the CSRF token comes from** — a dedicated endpoint whose token
  arrives in a **response header**, not the JSON body, is a common surprise. Or a `<meta>` tag.
- Mutation argument shape (Relay-style mutations wrap everything under `input`).
- From an already-authenticated page, the cheapest way to fire a real request is `fetch` inside
  `browser_evaluate` with the page's own credentials (`credentials: 'include'`), rather than
  rebuilding auth in `curl`.
- **Schema dumps / generated types** that must be regenerated after an API change, and whether
  regeneration needs a running dev server (it often does — introspection).

## Ground truth — cross-checks that actually prove something

**Replicate the resolver, never a simplified scope.** Find the service / query object the
resolver calls and invoke it with the resolver's real arguments:

```bash
bin/rails runner 'r = Posts::Search.call(<the resolver'"'"'s real kwargs>); puts r.count'
node -e 'require("./dist/posts/search").search({ /* real args */ }).then(r => console.log(r.length))'
```

Compare against the frontend's `totalCount` and print a number table.

Other ground-truth reads worth locating per project:

- **Generated files**: where an export / report / document records the options it was built
  with. The file's URL rarely tells you; the record does.
- **Async work**: which jobs a flow enqueues — poll for their rows instead of asserting
  immediately.
- A local-DB MCP tool or `psql` reads the **local** DB. It is not prod; prod reads go through
  **warehouse-data**.

## Seeding state for a flow

- **What the dev DB does and doesn't contain.** A dev DB seeded with lookup tables and sample
  content but **no activity records** (invoices, comments, audit events) means you build those
  from the test factories (`FactoryBot.create` in a runner, a factory module in Node,
  `factory_boy` in Python).
- **Factory defaults are minimal.** Before calling an empty or inert surface a bug, check that
  the record you built has the associations that surface reads.
- **Go through the real input when the app processes what you give it** (uploads, imports): a
  direct DB write skips that processing.
- **Feature flags**: the CLI or runner call to list / enable / disable, and verify state with a
  runner (`Flipper.enabled?(:flag)`), not the UI.
- **Don't delete to "reset"** without checking dependents (foreign keys, `dependent:` options);
  prefer creating fresh records.

## Signed-out / anonymous flows

- Use an isolated, signed-out browser instance (`mcp__playwright-isolated__*`, if configured).
- Find where the app keeps an anonymous visitor id (`localStorage`, a cookie) so you can attach
  seeded state to that visitor with a runner.
- To reset, **sign out through the real UI** — the session cookie is usually httpOnly.
- An isolated instance can't render authed state; for a component that needs it, use Storybook
  or inject a faithful DOM reproduction.

## Busting stale output between before/after captures

Note which caches can serve stale output for the surface you're capturing (a result stored on
the record, the app's cache store, a CDN copy, the browser; a sidecar service with its own
cache — check its health and clear it per its docs) and how to clear each one — dry-run first,
scoped to one record, never in production. **dev-doctor** Phase D has the general rules;
**render-pipeline-debug** owns multi-stage generation pipelines.

## Env-var names that matter for local verification

Never read `.env*`; reference by name from a runner (`ENV['NAME']`, `process.env.NAME`). Note the
names of: the frontend's API-URL var, `DATABASE_URL`, `REDIS_URL`, the app-server concurrency
vars (`WEB_CONCURRENCY`, `RAILS_MAX_THREADS`), and any var that switches an integration between a
local stub and the real service.
