# prod-script — reference

Long-tail detail for the **prod-script** skill: full script templates (Rails), the payload
extractor, console mechanics per platform, the log-search recipe, and the checked-in
data-migration pattern.

Every template follows the one-statement rule: constants on top, the whole body in a single
`begin … end` whose last expression is `nil`. Pasted into a REPL, each top-level statement runs on
its own, so only a single-statement body guarantees that a `raise` stops everything after it.

---

## 1. Read-only diagnostic template

Save as `<sandbox_dir>/adhoc/<YYYY-MM-DD>-<slug>/NN_diagnose.rb`.

```ruby
# frozen_string_literal: true

# <One line: the question this answers.>
#
# <What the previous script established, and the falsifiable hypothesis this tests.>
#
# Run on production:
#   <prod_console_cmd>
#   ...then paste this whole file at the prompt. Exit the console afterwards --
#   it quiets the SQL logger for the session.
#
# Reads only. Prints one JSON payload between whole-line markers; save the transcript and hand it back.

require 'json'

begin
  revision = '<slug>-v1'
  $stdout.sync = true
  $run_started = Time.current

  def log(message) = $stdout.puts(format('--> %7.1fs  %s', Time.current - $run_started, message))

  # One bad section must not destroy the output of every good one.
  def safe
    yield
  rescue => e
    "ERROR: #{e.class}: #{e.message}"
  end

  # Quiet SQL so progress and payload stay readable.
  ActiveRecord::Base.logger.level = Logger::WARN if ActiveRecord::Base.logger

  # Positive read-only guard: name every lazy-write accessor this script could reach.
  Address.class_eval do
    def geocode!
      raise('read-only script: refusing to call the geocoding API and save')
    end
  end

  $stdout.puts "revision: #{revision}  (SQL logging quieted, geocode! guarded)"
  out = { revision: revision, database: ActiveRecord::Base.connection_db_config.database }

  out[:subject] = safe do
    record = Invoice.find_by(id: '<id>')
    record && { id: record.id, status: record.status, created_at: record.created_at }
  end

  out[:related] = safe do
    # ... one section per question; log() between long ones. Trailing dots on chains:
    # Invoice.kept.
    #   where(account_id: '<account_id>').
    #   pluck(:id, :status)
  end

  log 'complete -- result below'
  $stdout.puts ['================== COPY FROM HERE ==================',
                JSON.pretty_generate(out),
                '=================== COPY TO HERE ==================='].join("\n")
  nil   # the REPL echoes this once, after the payload
end
```

**Very large output** — write to the console host instead of the terminal, then print once (still
inside the `begin … end`):

```ruby
path = '/tmp/<slug>_dump.jsonl'
File.open(path, 'w') { |file| rows.each { |row| file.puts(JSON.generate(row)) } }
$stdout.puts ['================== COPY FROM HERE ==================',
              File.read(path),
              '=================== COPY TO HERE ==================='].join("\n")
```

**Restore anything you changed for the run** in an `ensure` on the `begin … end`, and say in the
header that the console should be exited afterwards.

### The payload extractor (`extract_payload.js`)

Save once per investigation dir; Phase 3 and Phase 5 both use it. It anchors on lines that are
**exactly** a marker, because a paste echoes the source line that *contains* the marker text.
It runs locally in plain Node (the repair/diagnose scripts stay in the app's language).

```js
#!/usr/bin/env node
'use strict';
// Extracts the JSON payload from a console transcript (a pasted run or a paste rehearsal).
// Usage: node extract_payload.js <transcript.txt> [out.json]
const fs = require('fs');

function abort(message) {
  console.error(message);
  process.exit(1);
}

const [transcript, outFile] = process.argv.slice(2);
if (!transcript) abort('usage: node extract_payload.js <transcript.txt> [out.json]');
const lines = fs.readFileSync(transcript, 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => /^=+ COPY FROM HERE =+$/.test(line));
if (start === -1) abort('no COPY FROM HERE line');
const stop = lines.findIndex((line) => /^=+ COPY TO HERE =+$/.test(line));
if (stop === -1) abort('no COPY TO HERE line');
const pretty = JSON.stringify(JSON.parse(lines.slice(start + 1, stop).join('\n')), null, 2);
if (outFile) fs.writeFileSync(outFile, pretty);
console.log(pretty);
```

(Exiting on error is fine here — this runs locally, not in the user's console.)

---

## 2. Guarded repair template — single record

Save as `NN_<action>.rb` beside the inspect script.

```ruby
# frozen_string_literal: true

# <What this changes, and what NN_inspect.rb (output in NN-output.json) confirmed.>
#
# DRY RUN (default, no writes):  paste this whole file.
# APPLY:                         type `DRY_RUN = false` at the prompt, then paste the file again.
#   NB: DRY_RUN and every flag below are sticky for the rest of the console session -- open a
#   fresh console afterwards. Re-pasting prints "already initialized constant" warnings for the
#   plain constants; they are harmless.
#
# Flags -- each one is a side effect or scope the original ask did not cover. Off until confirmed;
# to approve one, type e.g. `EMAIL_CUSTOMERS_APPROVED = true` at the prompt before pasting:
#   EMAIL_CUSTOMERS_APPROVED  <what it does and who has to agree>
#
# What APPLY does:
#   1. ...
#   2. ...
#
# UNDO: <the versioning library's call, if the app has one, e.g.
#   record.versions.reorder(:created_at).last.reify.<attr>>
#   plus the BACKUP dump printed below -- keep this output.

require 'json'

DRY_RUN = true unless defined?(DRY_RUN)
EMAIL_CUSTOMERS_APPROVED = false unless defined?(EMAIL_CUSTOMERS_APPROVED)

TARGET_RECORD_ID = '<id>'
TARGET           = '<value>'
EXPECTED_BEFORE  = '<value the inspect script saw>'

begin
  halt = ->(message) { raise "HALT: #{message}" }     # never abort/exit: they kill the console

  $stdout.puts DRY_RUN ? '*** DRY RUN — no writes ***' : '*** APPLY MODE ***'
  $stdout.puts "revision: <slug>-v1  flags: EMAIL_CUSTOMERS_APPROVED=#{EMAIL_CUSTOMERS_APPROVED}"

  record = Model.find(TARGET_RECORD_ID)
  was = record.attribute
  $stdout.puts "record: #{record.id} status=#{record.status}  current: #{was.inspect}  target: #{TARGET.inspect}"

  # --- preconditions: raise, never proceed ---------------------------------------
  halt.('already on target — nothing to do') if was == TARGET
  halt.("unexpected current value #{was.inspect}") unless was == EXPECTED_BEFORE
  halt.('this would email the customer — get sign-off, then set EMAIL_CUSTOMERS_APPROVED = true') \
    if <change_emails_customer> && !EMAIL_CUSTOMERS_APPROVED

  # --- live-check the external provider, if one is involved ----------------------
  remote = PaymentsApi.fetch(TARGET)
  halt.("provider says #{remote['status'].inspect}, not active") unless remote['status'] == 'active'

  # --- assign IN MEMORY either way, so the dry run previews the POST-fix state ----
  record.attribute = TARGET
  $stdout.puts ['', '== diff (- current / + new) ==',
                "  attribute: - #{was.inspect}",
                "             + #{record.attribute.inspect}",
                "  computed:  #{record.computed_value.inspect}"].join("\n")   # what the fix should produce

  $stdout.puts "\n== BACKUP: pre-change state (keep this output) =="
  $stdout.puts JSON.generate({ id: record.id, attribute: was })

  if DRY_RUN
    record.restore_attributes
    $stdout.puts "\nDRY RUN — nothing written. Paste this output back before applying."
  else
    record.save!
    record.reload
    $stdout.puts "\n== after save ==\n  attribute: #{record.attribute.inspect}  " \
                 "#{record.attribute == TARGET ? 'OK' : '!! MISMATCH'}"
  end
  nil
end
```

---

## 2b. Guarded repair template — bulk (N candidates)

The common case. Decide up front what halts the **whole run** (an empty population, a population
bigger than anything the dry run or the warehouse showed, missing data a computed value needs) and
what merely **skips one row** (it moved on since the dry run). Re-check eligibility under a row lock
at apply time; rescue per row so one bad row doesn't stop the rest.

```ruby
# frozen_string_literal: true

# <What this settles, the root cause, and the evidence: warehouse NN (N rows as of <as-of>),
#  NN_diagnose (M live).>
#
# DRY RUN (default): paste this file.   APPLY: `DRY_RUN = false` at the prompt, then paste again.
# Flags (off until confirmed; set at the prompt):
#   EMAIL_CUSTOMERS_APPROVED  the model's after_update_commit emails the customer. Default false:
#                             delivery is suppressed for this run and restored in `ensure`.
# What APPLY does, per candidate (derived via <Model#eligible?>, the same rule the app's writer uses):
#   1. locks the row, reloads it, re-checks eligibility (skips anything that moved on)
#   2. calls <the app's authoritative writer>; the versioning library records the change as WHODUNNIT
# UNDO: <Version.where(whodunnit: WHODUNNIT)> lists every touched row and its previous values;
#   the BACKUP dump below is the independent copy.

require 'json'

DRY_RUN = true unless defined?(DRY_RUN)
EMAIL_CUSTOMERS_APPROVED = false unless defined?(EMAIL_CUSTOMERS_APPROVED)

WAREHOUSE_EXPECTED = <n>          # from warehouse-data, with its as-of
MAX_CANDIDATES     = <cap>        # halt if the population is bigger than anything measured
WHODUNNIT          = 'repair:<slug>'

begin
  halt = ->(message) { raise "HALT: #{message}" }
  $stdout.puts DRY_RUN ? '*** DRY RUN — no writes ***' : '*** APPLY MODE ***'
  ActiveRecord::Base.logger.level = Logger::WARN if ActiveRecord::Base.logger

  candidates = Model.kept.
                 includes(:association).
                 order(:id).
                 select(&:eligible?)

  # --- whole-run preconditions -----------------------------------------------------
  halt.('nothing to do — no eligible rows (already applied?)') if candidates.empty?
  halt.("#{candidates.size} candidates > MAX_CANDIDATES #{MAX_CANDIDATES} — re-measure first") \
    if candidates.size > MAX_CANDIDATES
  $stdout.puts "candidates: #{candidates.size}  (warehouse expected #{WAREHOUSE_EXPECTED}; " \
               "delta #{candidates.size - WAREHOUSE_EXPECTED})"

  # --- per-row diff, assigned IN MEMORY, then reset ---------------------------------
  backup = []
  tally = Hash.new(0)
  candidates.each do |row|
    before = { 'id' => row.id, 'status' => row.status, 'updated_at' => row.updated_at.iso8601(6) }
    backup << before
    row.status = :settled
    bucket = row.duplicate_of_another? ? :duplicate : :fixable
    tally[bucket] += 1
    $stdout.puts format('  %-10s %-12s status: %s -> %s', bucket, row.id, before['status'], row.status)
    row.restore_attributes
  end
  $stdout.puts "tally: #{tally.sort.to_h.to_json}"
  $stdout.puts "\n== BACKUP: pre-change state (keep this output) ==\n#{JSON.generate(backup)}"

  if DRY_RUN
    $stdout.puts "\nDRY RUN — nothing written. Compare the tally with the expected numbers, paste this back."
  else
    original_deliver = CustomerMailer.method(:deliver)
    CustomerMailer.define_singleton_method(:deliver) { |*| nil } unless EMAIL_CUSTOMERS_APPROVED
    PaperTrail.request.whodunnit = WHODUNNIT
    applied = Hash.new(0)
    begin
      candidates.each do |row|
        row.with_lock do
          row.reload
          if row.eligible?
            <AppWriter>.call(row)
            applied[:settled] += 1
          else
            applied[:skipped_moved_on] += 1
          end
        end
      rescue => e
        applied[:"errored(#{e.class})"] += 1
        $stdout.puts "  ERROR #{row.id}: #{e.class}: #{e.message}"
      end
    ensure
      PaperTrail.request.whodunnit = nil
      CustomerMailer.define_singleton_method(:deliver, original_deliver)
    end
    remaining = Model.kept.select(&:eligible?).size
    $stdout.puts "\n== after apply ==\napplied: #{applied.to_json}  still eligible: #{remaining} " \
                 "#{remaining.zero? ? 'OK' : '!! CHECK'}"
  end
  nil
end
```

Write the matching rollback (`NN_rollback.rb`) in the same shape: it reads the tagged versions (or
the BACKUP dump), has its own dry run, and its apply is verified by re-running the diagnose script
and diffing against the pre-repair output.

### Blast-radius sweep (`NN_blast_radius.rb`)

Read-only, capped, one line per record (with an admin link if you have an admin UI), tallied into
named buckets — inside the same single `begin … end`, reusing `safe` from §1:

```ruby
begin
  limit = 50
  tally = Hash.new(0)
  candidates.first(limit).each do |record|
    bucket = safe { classify(record) }        # :fixable / :duplicate / :errored / ...
    tally[bucket] += 1
    $stdout.puts format('%-10s %-24s %s', bucket, record.id, '<admin URL for this record, if any>')
  end
  $stdout.puts "tally: #{tally.inspect}  (showing #{[candidates.size, limit].min} of #{candidates.size})"
  nil
end
```

---

## 3. Production console mechanics — what to check for your platform

Fill in `<prod_console_cmd>` once, then verify these properties of it:

| Platform | Typical console command | Instance it lands on | Getting a file there for `load` |
|---|---|---|---|
| Heroku | `heroku run rails console -a <app>` | a **one-off dyno**, separate from serving traffic | none built in — paste instead |
| Fly.io | `fly ssh console -a <app> -C "bin/rails console"` | a **running machine** — a deploy can replace it mid-session | `fly ssh sftp shell -a <app>`, then `put` |
| Kubernetes | `kubectl exec -it deploy/<web> -- bin/rails console` | a **serving pod** — a rollout kills the session; prefer a dedicated one-off pod/Job if your team has one | `kubectl cp f.rb <pod>:/tmp/f.rb` |
| ECS / Nomad / bespoke wrapper | your team's command | check: one-off or live? | ask; a shell heredoc (`cat > /tmp/f.rb <<'EOF'`) works anywhere you have a shell |

Properties worth knowing (and writing into the project's `CLAUDE.md`):

- **Does it need a TTY?** Most do and refuse non-interactive stdin — which is also why Claude can't
  (and mustn't) run it.
- **Is there a default environment?** A wrapper that requires the environment explicitly and
  confirms it before connecting is the safe shape.
- **One-off vs live instance.** A live instance can be replaced by any deploy. One-off/ephemeral
  instances are also why read-only work there is safe from deploy churn.
- **Does the wrapper type the console command for you?** Some platforms can't run a remote command
  over their SSH, so a wrapper opens a shell and *types* `bin/rails console` into it. The user's
  paste then lands in a REPL inside a shell — harmless, but it explains odd echo.
- **A read-only debug box**, if your team runs one (a SELECT-only DB URL, no app secrets), is the
  right target for `diagnose` scripts that don't need app side effects. It is still a human's
  session, not Claude's.

---

## 4. Log search — log-shaped questions (`<log_search>`)

Exceptions and stack traces usually live in `<error_tracker>`, not the log search.

### The recipe

1. **Discover, never guess.** List the sources (one per service/process type: web, worker,
   admin…), then read the chosen source's **field schema** — most log tools have a "fields" /
   "query help" call that prints the real column and JSON paths. Never guess a collection name or a
   field path.
2. **Know the storage split.** Many backends serve a recent window from a fast "hot" store and
   everything older from an archive with a different table/function and sometimes a row-type
   filter (logs vs spans vs events). An empty hot-store result is not "no data". To cover a window
   that runs up to now, query both and `UNION ALL` them.
3. **Extract from the payload, not the top level.** Structured app logs (SemanticLogger, lograge,
   structlog, pino) nest the useful fields under a payload key. When the payload arrives as
   JSON-in-a-string, nest the extraction. Use nullable types so a missing field is NULL, not an
   error.
4. **Filter on payload fields** — request path, GraphQL operation name, job class, job id — **not
   HTTP status**: GraphQL errors return HTTP 200.
5. **Pin, then widen.** Find one failing request/job, take its id, read its full trail; then widen
   the same predicate over time to measure blast radius. If the tool can group structurally
   identical messages with ids stripped (a "pattern" column), group by it to see the shape of a
   failure.

A worked query in ClickHouse-flavored SQL (the dialect several hosted log tools expose); replace
the table expressions with what step 1 printed:

```sql
SELECT
  dt,
  JSONExtract(raw, 'message', 'payload', 'params', 'graphql', 'operationName', 'Nullable(String)') AS operation,
  JSONExtract(JSONExtract(raw, 'message', 'String'), 'latency_ms', 'Nullable(Float64)')         AS latency_ms,
  JSONExtract(raw, 'message', 'payload', 'status', 'Nullable(Int64)')                             AS status
FROM <archive table expression for the web source>
WHERE <row-type filter for logs, if the archive mixes types>
  AND dt BETWEEN now() - INTERVAL 7 DAY AND now()
  AND JSONExtract(raw, 'message', 'payload', 'params', 'graphql', 'operationName', 'Nullable(String)') = '<GraphQLOperation>'
ORDER BY dt DESC
LIMIT 100
```

Background jobs log on the worker sources (job class, job id, queue, duration).

**When `<log_search>` is Better Stack:** its MCP exposes the discovery steps directly — list
sources, then the per-source query-help call (it prints the table expressions for the hot store and
the archive, the row-type codes, and the field list), then query. Read all of it from query-help
each time rather than from memory.

---

## 5. Checked-in data migrations — the formal alternative

Default to the console paste. Promote to a class only when the remediation must be auditable or
repeatable. Mirror your repo's existing precedents rather than inventing an API — find two or
three and read them first.

Common shapes: a backfill service class with a preview/apply pair of entry points; the
`maintenance_tasks` gem (Rails, with a UI and dry-run support); `data-migrate`; a rake task with a
`DRY_RUN` env var; a Django data migration with a management command for the dry run.

Footguns seen in practice — check whether yours has them:

- **A dry-run path that ends in failure by design** (to make "nothing was written" loud) will
  *raise* if invoked through a raise-on-failure (bang) entry point. Read the base class and hand
  over the exact command for each mode.
- **A report/counter helper that ignores its argument** (an `increment(key, value)` that always
  adds 1). Derive counts from the write's own return value — `update_all` returns the affected row
  count — or an explicit accumulator, never from a helper you haven't read.
- **The class doesn't exist in prod until the PR deploys.** Confirm the deploy before handing the
  command over.
- **Size it first** with a read-only count using the migration's *exact* predicate, bucketed
  (total / will-change / will-delete), then translate to plain-language feasibility
  (rows × queries-per-row → wall clock; single-row atomic updates with no long transactions are
  safe alongside live traffic).

---

## 6. Local-only tools (never prod)

| Tool | Hits |
|---|---|
| `bin/rails runner` / `bin/rails console` / `python manage.py shell` / `php artisan tinker` locally | local dev DB |
| `psql -h 127.0.0.1 …` | local dev DB |
| a postgres MCP server configured for development | local dev DB |
| a bespoke query script reading `$DATABASE_URL` | whatever that variable points at — usually dev; check before trusting |

A read-only local query tool earns its safety from a read-only transaction
(`default_transaction_read_only`), single-statement enforcement and a row cap — not from a
statement blacklist. A tool that evaluates app-language code (to render the SQL a scope produces,
say) is not read-only by construction; don't auto-allow it for agents.
