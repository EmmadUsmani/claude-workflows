---
name: prod-script
description: Make guarded production repairs — and, as the LAST resort, get production facts — through a script the user pastes into their production console (`<prod_console_cmd>`; a Rails console is the worked example). Prod reads go to the warehouse first (warehouse-data), then the `<ops_bot>` if your team runs one, and only then this paste-back round trip; writes always come here. Mode `diagnose` is strictly read-only; mode `repair` adds the DRY_RUN → paste back → confirm → apply gate, a blast-radius sweep, links into your admin UI and a rollback path. Use when asked to "write rails console code I can run in prod", "write a prod script and I'll paste the output back", "generate a script to fix this in production", any production write, or a read the warehouse and ops bot cannot answer. NOT for local dev-DB questions (`bin/rails runner`, psql on localhost), NOT for log/exception questions (`<log_search>` / `<error_tracker>`).
argument-hint: "diagnose|repair <slug>"
---

# Production scripts (Claude writes, the user runs)

Claude cannot run anything against production from this machine. This skill is the
human-in-the-loop path: you write a self-contained script into a dated
`<sandbox_dir>/adhoc/` directory, the user pastes it into `<prod_console_cmd>`, and pastes the
output back. A repair is the same round trip with a `DRY_RUN` gate in the middle.

Things that have already gone wrong in real use drive most of the rules below: a script *called*
read-only wrote to production through a lazy accessor; a dry run printed the record's
**unchanged** value, re-confirming the bug instead of testing the fix; and a pasted repair kept
running its APPLY block after a guard printed `HALT`, because a console paste runs each top-level
statement on its own.

**The worked example is Rails** (`bin/rails console`, ActiveRecord, Ruby). The mechanics map to
any framework with a production REPL — see § Other frameworks. Write the script in the app's own
language; the rules don't change.

**Routing — this is rung 3 of 3 for reads, and the only rung for writes.** Every production
*read* goes first to **warehouse-data** (queried directly, no manual step), then to the
`<ops_bot>` if your team runs one (owned by **warehouse-data**), and only then here. The point is
to avoid a manual step whenever the data can be had without one. Before writing a `diagnose`
script, state in one line why the others can't answer it (`<warehouse> can't: audit history isn't
mirrored`, …). This skill remains the **only** path for repairs, and the evidence-grade path when
a fact needs application logic run against live rows. When a warehouse number and a pasted script
disagree, report the discrepancy — it's usually mirror lag or a predicate mismatch, and the script
is the live read.

**Settings.** `<prod_console_cmd>` is the command the user runs to open a production console
(e.g. `heroku run rails console -a <app>`, `fly ssh console -C "bin/rails console"`,
`kubectl exec -it deploy/<web> -- bin/rails console`). It has no default and is never guessed:
ask once, then suggest adding it to the settings section.

---

## Hard rules

1. **Warehouse first; you have no live prod DB connection.** Production reads go to
   **warehouse-data** before anything here. `bin/rails runner`, `psql` on localhost, and any
   dev-DB MCP tool all hit **local dev**. Never describe their output as "prod" or
   "prod-synced". Dev is a stale, partial snapshot.
2. **The user runs the script, always.** Never run `<prod_console_cmd>` yourself, never ssh into a
   production host, and never try to sign into an admin UI. If you need a prod fact, write a file
   and hand it over.
3. **Read-only first.** Never propose a write before the root cause is confirmed against real
   prod data: a warehouse query (**warehouse-data**) or a read-only script's dump.
4. **"Read-only" is a claim you must audit, not a label you apply.** Grep every accessor the
   script touches for lazy writes and inline jobs before you call it read-only (see gotchas).
5. **The dry run must print the would-be-*new* value.** Assign the target in memory, print the
   before/after diff, then `reload` (or `restore_attributes`) without saving. A dry run that prints
   current state is re-confirming the bug, not testing the fix.
6. **The body is one statement.** Everything after the constants lives inside a single
   `begin … end`. A raise only stops a paste when it aborts the whole body (Phase 2).
7. **The script is a deliverable** in the app's language (Ruby for Rails). Run **code-style**'s
   self-review checklist over it — full words, implicit returns, hash destructuring over positional
   arrays, a named halt lambda rather than `abort`, comments that carry knowledge the code can't
   show. Your own local one-liners may be whatever.
8. **Never read `.env*`.** Reference secrets as `ENV['NAME']` inside a script instead.
9. **Propose → wait → act.** Present the script and the expected numbers; do not tell the user to
   flip `DRY_RUN = false` until they have pasted the dry-run output back and you have checked every
   field-level diff.
10. **Flag anything the ask didn't cover** — a visibility/policy change, an extra record swept in, a
    callback that emails a customer or moves money. Each one gets its own off-by-default flag and
    explicit confirmation.
11. **Never cite an identifier from memory.** Record ids, vendor ids, PR numbers, class names —
    read them from the dump, from `gh api`, or from the code.
12. **Rehearse before you hand over, through the same entry point the user will use.** Every script
    is pasted into a local console (Phase 3) and the hand-off says what ran. One that couldn't be is
    labeled `[UNREHEARSED — <reason>]`, never passed on silently.

---

## Phase 0 — route the question before writing anything

| Question shape | Goes to |
|---|---|
| "here's a chat thread / ticket — what's going on?" | **bug-intake** first — it owns intake → RCA and hands off to remediation. Reach a falsifiable claim and a discriminating check *before* writing a script. |
| "what does this row look like / how many records / what's the blast radius" | **warehouse-data** — query it yourself, first, always |
| a read the warehouse can't answer (unmirrored audit history, a hashed column, a just-added table, a change in the last few minutes) | the `<ops_bot>`, if your team runs one (**warehouse-data**) |
| a read neither can answer — application logic over live rows, or a bot answer that must be watched executing | **this skill**, mode `diagnose` |
| any write to production | **this skill**, mode `repair` |
| "what happened during that request / job" (logs, timings, SQL) | `<log_search>` — recipe in `REFERENCE.md` §4 |
| "what exception fired / stack trace" | `<error_tracker>`. Exceptions are usually *not* in the log search. |
| "does the code do X" | read the code; no prod needed |
| "does the third-party API return X" | **vendor-api-probe** — if dev shares the vendor's credentials with prod (verify first), replay locally instead of paste-back rounds |
| "is the local stack broken" | **dev-doctor** |

Then read the implicated model/service code and **write a falsifiable hypothesis first**. Expect
hypothesis #1 to be wrong; the loop is only cheap when each script tests one thing.

## Phase 1 — one dated directory per investigation

```bash
mkdir -p <sandbox_dir>/adhoc/$(date +%F)-<slug>/
ls <sandbox_dir>/adhoc/            # re-read the naming convention first
```

- **One subdir per investigation**, never several. The slug names the problem, not the customer.
- Scripts are **numbered and single-purpose**: `01_diagnose.rb`, `02_<probe>.rb`,
  `03_blast_radius.rb`, `NN_<action>.rb`. If the dir already has numbered files (warehouse
  queries from **warehouse-data**, say), **continue its numbering** rather than restarting at 01.
- Pasted-back output is saved beside them as `NN-output.json` / `NN-output.txt`.
- Findings go in `notes.md` or `README.md` (run order, findings, any chat draft).
- **Read a prior adhoc dir on the same integration before starting** — API shapes, credential
  sourcing and provider quirks are often already solved there.

## Phase 2 — write the read-only script

Every item below is load-bearing; skipping one has cost a round trip or an incident. Full templates:
`REFERENCE.md` §1–2.

- **One statement: constants on top, everything else in one `begin … end`.** Pasted into IRB (or
  any REPL), each top-level statement is evaluated on its own. A `raise` aborts *only the statement
  it is in*, and the REPL carries on with the next line — so a top-level `halt.(…)` guard prints
  `HALT` and the APPLY block below it still runs (reproduced). Inside one `begin … end`, the same
  raise aborts the whole body. Make `nil` the block's last expression so the REPL echoes one
  `=> nil` at the very end.
- **No leading-dot method chains** (a line starting with `.where(`). At the top level of a paste,
  the line before it is evaluated alone and the `.where` line fails — the result is silently the
  unfiltered relation. Put the dot at the end of the line instead (`Invoice.kept.` / `where(...)`);
  inside the single `begin … end` it's safe either way, but trailing dots are safe everywhere.
- **No top-level `return`** (IRB raises `LocalJumpError` on a pasted `return`).
- **Never `abort` / `exit`.** They raise `SystemExit` and end the user's whole console session.
  Use a halt lambda: `halt = ->(message) { raise "HALT: #{message}" }`.
- **Per-section `rescue`** so one bad query doesn't destroy all prior output — wrap each section
  as `out[:thing] = safe { ... }`:
  ```ruby
  def safe
    yield
  rescue => e
    "ERROR: #{e.class}: #{e.message}"
  end
  ```
- **Revision banner as the literal first output line**, plus a `revision` field in the JSON — so a
  stale paste is instantly identifiable when the user reports an already-fixed error.
- **Progress lines with a distinct prefix and elapsed time**, visually distinct from the payload
  the user has to copy:
  ```ruby
  $stdout.sync = true
  $run_started = Time.current
  def log(message) = $stdout.puts(format('--> %7.1fs  %s', Time.current - $run_started, message))
  ```
- **Quiet SQL logging** for the run:
  `ActiveRecord::Base.logger.level = Logger::WARN if ActiveRecord::Base.logger` (say in the header
  that the console should be exited afterwards, since this persists for the session).
- **Print the fence and the payload in one statement**, with each marker on a line of its own:
  ```ruby
  $stdout.puts ['================== COPY FROM HERE ==================',
                JSON.pretty_generate(out),
                '=================== COPY TO HERE ==================='].join("\n")
  ```
  Three separate `puts` lines let the REPL interleave echoed source and `=> nil` *inside* the
  fence, and the echoed source line itself contains the marker text — so the parser in Phase 5
  anchors on lines that are **exactly** a marker. If the output is genuinely large, write it to
  `/tmp/<name>.jsonl` on the console host and print the file once between the same markers.
- **Install a positive read-only guard** on anything with a lazy write path, e.g.
  ```ruby
  Address.class_eval do
    def geocode!
      raise('read-only script: refusing to call the geocoding API and save')
    end
  end
  ```
- **Header comment carries**: what it answers, what the previous script established, how to run
  it, and the literal words `Reads only.` (or the DRY RUN / APPLY instructions).
- **Scope to APIs that exist on *deployed* code.** A prod console can be running pre-deploy code,
  so a newly-merged keyword argument raises `ArgumentError`. Merged ≠ deployed — check your
  platform's release list (`heroku releases`, `fly releases`, the deploy dashboard, GitHub
  deployments). Detect arity and fall back rather than assuming.
- Models whose table lives in another schema (`self.table_name = 'reporting.events'`, or a Rails
  engine's `table_name_prefix`) break hash-condition joins with `PG::UndefinedTable` — use
  `.merge(Reporting::Event.where(...))`, not `where(reporting_events: {...})`.
- Use `<<~'SQL'` (single-quoted heredoc) or Ruby mangles `%q{}` inside it.

## Phase 3 — rehearse locally (mandatory, every script)

No script reaches the user until it has **executed on this machine through the same entry point
the user will use** — a paste into a console. A paste-back that dies on a `NameError`, a
misspelled column, a leading-dot chain or a halt that didn't halt costs a console session and a
round trip, or worse; the rehearsal catches it for free. Reading the script carefully is not a
rehearsal, and neither is `bin/rails runner … load` on its own: `load` runs the file as one unit,
so it hides every paste-only failure above.

**Where.** If the repo is a git repo, the worktree that already exists for this work — a fix PR in
progress means that PR's worktree. Only when none exists, create one from the default branch
(**worktree-create**). Never the main checkout, which other sessions may share. Never stash, reset
or switch branches in a worktree to make it "clean" — it may hold someone's uncommitted work. Bash
cwd may reset between calls, so `cd <abs-worktree> &&` every time and print where you landed. If
the app runs in Docker, `docker info` first — `bin/rails runner` can fail silently when Docker is
down; a broken shared stack is **dev-doctor**'s, and never a reason to restart shared infra
yourself.

**A fix branch runs code prod doesn't** (nor does the default branch until it deploys), so a script
leaning on it passes locally and raises in prod. If the repo is git, diff the worktree — committed
*and* uncommitted — against its merge base with the default branch and check the script against
what the branch adds:

```bash
S=<sandbox_dir>/adhoc/<date>-<slug>; WT=<worktrees_dir>/<existing-worktree>
DEFAULT=$(git -C $WT symbolic-ref --short refs/remotes/origin/HEAD)     # e.g. origin/main
BASE=$(git -C $WT merge-base "$DEFAULT" HEAD)
git -C $WT diff --stat $BASE; git -C $WT ls-files --others --exclude-standard   # files the branch touches
git -C $WT diff $BASE | grep -E '^\+' | grep -oE 'def (self\.)?[a-z_][A-Za-z0-9_]*[?!]?|(class|module) [A-Z][A-Za-z0-9:]*|[A-Z][A-Z0-9_]{2,} =' | sort -u
```

Grep the script for every name that prints, and read the branch's hunks in any touched file whose
class the script calls — a changed method body doesn't show up as a new `def`. The script must use
only what deployed code has: rewrite around a hit, and if one is unavoidable, the hand-off says
`leans on <name>, added by <branch> — raises in prod until it deploys`. If the branch carries a
migration touching a table the script reads, add one line: `dev schema may be ahead of prod for
<table>`.

Static checks, then the paste rehearsal:

```bash
ruby -c $S/01_diagnose.rb
grep -nE '^\s*(return|abort|exit)\b|^\s*\.[a-z_]' $S/01_diagnose.rb   # paste traps: return/abort/exit, leading dots
cd $WT && git branch --show-current && \
  bin/rails console < $S/01_diagnose.rb > $S/01-rehearsal-paste.txt 2>&1   # the paste, non-interactively
node $S/extract_payload.js $S/01-rehearsal-paste.txt > /dev/null && echo 'payload parses'
```

Piping a file into the console's stdin is a faithful paste rehearsal: IRB evaluates it statement by
statement exactly as a terminal paste would (it also echoes each source line, which is why the
extractor anchors on whole-line markers). `extract_payload.js` is the Phase 5 extractor, saved once
per investigation dir (`REFERENCE.md` §1). Print the dev DB name somewhere in the output so the
rehearsal proves which database it hit.

- **Diagnose — run it for real.** The output must have the shape the user will paste back:
  revision banner first, then JSON between whole-line fences that the extractor parses. A section
  printing `ERROR:` locally is a bug to fix before handover — unless it is a prod-only record, and
  then say so.
- **Repair — paste the dry run, then the apply path, then the guard path.** Dry run: the diff
  prints the would-be-**new** value, the `== BACKUP:` dump appears, row counts are unchanged. Guard
  path: feed it bad state (or temporarily lower the population cap) and confirm that **nothing
  after the HALT line ran**. Apply: on an isolated worktree DB (**worktree-create**), or — on a
  shared dev DB — only inside a rollback wrapper kept beside the script (never handed over):

  ```ruby
  # NN_rehearse.rb — local only.  Dry run: bin/rails runner <abs>/NN_rehearse.rb
  #                               Apply:   APPLY=1 bin/rails runner <abs>/NN_rehearse.rb
  if defined?(Sidekiq)                       # or your job framework's test/fake mode
    require 'sidekiq/testing'
    Sidekiq::Testing.fake!                   # enqueues stay out of shared job queues
  end
  DRY_RUN = ENV['APPLY'] != '1'
  ActiveRecord::Base.transaction(joinable: false) do
    load '<sandbox_dir>/adhoc/<date>-<slug>/NN_<action>.rb'   # absolute path
    # assert the post-state you expect (zero writes on a dry run), then:
    raise ActiveRecord::Rollback
  end
  ```

  The wrapper uses `load` because it must sit around the script; that's why the paste rehearsal
  above is separate and also mandatory. Use your job framework's equivalent of
  `Sidekiq::Testing.fake!` (ActiveJob's `:test` adapter, Celery's eager mode off with a stub
  broker…). `joinable: false` is load-bearing (checked against ActiveRecord 7.2): by default a
  nested `transaction` *joins* the outer one, so the script's own `raise ActiveRecord::Rollback` is
  swallowed and its "rolled-back" rows stay visible — rehearsing different semantics from prod.
  Non-joinable makes each inner `transaction` and `save!` a real savepoint, as in prod. It also
  means **`after_commit` hooks fire**, so their side effects run for real: only the database rolls
  back. Faked job queues hold the enqueues; inline third-party calls (if dev shares any vendor
  credentials with prod, they hit the live account), object-storage uploads and mail escape — stub
  them (the Phase 8 `zzz_*` initializer) or confirm the path makes none. Keep it short; it holds
  row locks on a DB other sessions may use.
- **Dev has no matching rows** (it usually won't — the ids are prod's). At minimum, run it with the
  prod ids as given and confirm every section degrades to nil / `[]` / "not found" instead of
  raising. For anything load-bearing — a repair's apply path, a blast-radius predicate — seed a
  minimal realistic fixture (`FactoryBot.create(...)` inside the rehearsal, or the repo's seed
  helpers) and point the script at its id. Seed historical values the way prod got them
  (`update_all`, past the setter) — a fixture built through today's validations can't reach a
  legacy branch. On a shared DB, seed inside the rollback wrapper or delete what you made; never
  leave dev mutated.

Also grep that every method and column you referenced exists on deployed code — real columns vs
JSON-backed accessor keys. If a query can't be exercised anywhere, stub
`ActiveRecord::Base.connection.select_all` to print the generated SQL instead.

**Say what ran.** The hand-off (Phase 4 / Phase 9) carries one line:
`Rehearsed locally (<worktree or dir> @ <sha>, <db>): ruby -c ok; paste rehearsal → <result>;
branch-diff check: <clean | leans on … | not a git repo>. Not exercised: <…>.` If no local backend
exists (a cloud run — **cloud-runtime**), label the script `[UNREHEARSED — no local backend]` in its
header and the hand-off, after `ruby -c` and the grep; any other gap is `[UNREHEARSED — <reason>]`.
Never skip it silently.

## Phase 4 — hand it off

```bash
pbcopy < <sandbox_dir>/adhoc/<date>-<slug>/01_diagnose.rb     # xclip/wl-copy on Linux
```

Then tell the user: open `<prod_console_cmd>` and paste the whole file at the prompt. Pasting is
the default entry point because it needs nothing on the console host; `load '/tmp/<file>'` works too
but first needs the file copied there (per-platform commands in `REFERENCE.md` §3). Lead the
hand-off with Phase 3's `Rehearsed locally: …` line (or the `[UNREHEARSED — …]` label).

Console mechanics worth checking once for your platform (`REFERENCE.md` §3):

- **Consoles need a TTY** and most refuse non-interactive stdin from a remote session — one more
  reason the user runs them, not Claude.
- **Prefer a one-off / ephemeral console instance** where the platform offers one (Heroku's `run`
  starts a one-off dyno). On platforms where a console attaches to a live serving instance, a deploy
  can replace it and kill the session mid-command.
- A wrapper that requires an explicit environment and confirms it before connecting is the safe
  shape; keep it.
- Don't suggest `rails console --sandbox` for a read — it just holds a pointless open transaction.

## Phase 5 — parse the paste-back

- Ignore unrelated console noise (connection resets, deprecation warnings, echoed source).
- Save the transcript as `NN-output.txt` and the extracted payload as `NN-output.json` beside the
  script.
- **Parse with a tool, not by eye**, anchoring on whole-line markers — the `extract_payload.js` in
  `REFERENCE.md` §1, or as a one-liner:
  ```bash
  node -e 'const l = require("fs").readFileSync(process.argv[1], "utf8").split(/\r?\n/); const a = l.findIndex((x) => /^=+ COPY FROM HERE =+$/.test(x)); const b = l.findIndex((x) => /^=+ COPY TO HERE =+$/.test(x)); console.log(JSON.stringify(JSON.parse(l.slice(a + 1, b).join("\n")), null, 2))' NN-output.txt > NN-output.json
  ```
- **Cross-check each prod id against dev individually.** Dev catalog counts diverge from prod
  materially, and some records exist only in prod. Say explicitly which facts are prod-verified.
- If the hypothesis died, write the *next numbered script* for the corrected question rather than
  defending the first answer.
- Durable findings get *offered* in two forms: a **research-doc** write-up (with the exact script
  beside each claim) and — when the finding is a mechanism someone has to *see* — a
  **visual-explainer** page (mode `explain`) in the same `adhoc/` dir. Never put customer/account
  names, emails or prod identifiers in anything that will be published; use `<account_id>`
  placeholders.

If `<sandbox_dir>` is a git repo and `sandbox_autocommit` is on, commit each drafted script and
each pasted-back output file as you write it — only the paths you wrote, never `add -A` (full rule:
**sandbox-tool**). Committing the script is not running it; the repair gate is unchanged.

---

# Mode `repair` — writes to production

Everything above still applies. Do not enter this mode until root cause is confirmed against real
prod data — a warehouse query or a read-only dump. Pull the expected candidate counts and the
blast-radius preview from **warehouse-data** first; the dry run must reproduce them, and a
divergence is a finding (mirror lag or a predicate mismatch) to explain before applying.

## Phase 6 — map what the write touches

```bash
grep -n 'foreign key\|fk_rails' db/structure.sql | grep <table>      # every FK to handle first
```
- Confirm the owning model classes for each reference.
- **Read the model's `after_create` / `after_commit` / `before_save` callbacks** and report any
  money-adjacent, email-sending or outbound-API side effect *before* green-lighting the flip. Each
  one the ask didn't cover becomes an off-by-default flag (rule 10).
- Grep for the single authoritative reader/writer of the field you're changing, and derive
  candidates through **the same eligibility logic the real fix uses** — not a hand-rolled query.

## Phase 7 — write the guarded repair

Separate `01_inspect.rb` (read-only) from `NN_<action>.rb`. Full templates: `REFERENCE.md` §2
(single record) and §2b (bulk — the common case: N candidates, a population cap, a per-row lock
and re-check, per-row rescue into an `errored` bucket). The spine:

```ruby
# DRY RUN (default, no writes):  paste this file
# APPLY:                         DRY_RUN = false   (at the prompt), then paste again
DRY_RUN = true unless defined?(DRY_RUN)
EMAIL_CUSTOMERS_APPROVED = false unless defined?(EMAIL_CUSTOMERS_APPROVED)  # one flag per uncovered side effect

begin
  halt = ->(message) { raise "HALT: #{message}" }   # aborts the WHOLE body, because it is one statement
  $stdout.puts DRY_RUN ? '*** DRY RUN — no writes ***' : '*** APPLY MODE ***'

  halt.('unexpected state: …') unless <precondition>          # guards raise, never proceed
  halt.('already applied — nothing to do') if <change_already_made>

  was = record.attribute
  record.attribute = target                                    # assign in memory EITHER WAY
  $stdout.puts "  attribute: #{was.inspect} -> #{record.attribute.inspect}"
  $stdout.puts '== BACKUP: pre-change state (keep this output) =='
  $stdout.puts JSON.generate(<everything needed to undo>)

  if DRY_RUN
    record.restore_attributes
    $stdout.puts 'DRY RUN — nothing written. Paste this output back before applying.'
  else
    record.save!
    record.reload
    $stdout.puts "  after save: #{record.attribute.inspect} #{record.attribute == target ? 'OK' : '!! MISMATCH'}"
  end
  nil
end
```

Flags use `unless defined?` like `DRY_RUN`, so every flag is flipped the same way — at the prompt,
before pasting again — and the file never has to be edited between dry run and apply. Re-pasting in
the same session prints `already initialized constant` warnings for the plain constants; they're
harmless, and the header says so.

Also required:
- **Blast-radius sweep** — every other record matching the pattern, live-checked against the
  external provider where one is involved, capped (a screenful — say 50 lines), each line carrying a **link into
  your admin UI, if you have one, for the object a human acts on** (the user-facing record, not an
  internal join row).
- **Tally into named buckets** (`fixable` / `unchanged` / `duplicate` / `errored`) rather than a
  single count.
- **Document the undo path in the script header.** If the app has a versioning library (PaperTrail,
  `audited`, django-simple-history), name the exact call
  (`record.versions.reorder(:created_at).last.reify.<attr>`) and tag the repair's versions
  (`PaperTrail.request.whodunnit = 'repair:<slug>'`) so a rollback can find exactly them; always
  also print the `BACKUP` dump.

## Phase 8 — test all three paths locally before delivery

Against dev data, never the main checkout — the mechanics (where, the rollback wrapper, seeding
fixtures, the paste rehearsal) are Phase 3's:

1. **Guard path** — feed it bad state **through a paste**; confirm it raises and that nothing after
   the HALT ran.
2. **Dry-run path** — correct counts, zero writes. Stub the external API with a throwaway
   `config/initializers/zzz_*.rb` if the script live-checks a vendor.
3. **Destructive path** — against locally recreated fixtures, expected result, zero orphans — on an
   isolated DB, or under Phase 3's `joinable: false` rollback wrapper on shared dev.

## Phase 9 — hand over with expected numbers

State the dry-run numbers you expect, explicitly and per bucket ("expect N fixable, M skipped, zero
errored"), and tell the user to **stop and report back if the real dry run differs** before
flipping `DRY_RUN = false`. Include the `Rehearsed locally: …` line naming each of the three paths
and what it ran against — and what was *not* exercised (faked jobs, a stubbed vendor call,
prod-only records) — so the user knows which parts prod will be the first to run.

## Phase 10 — apply, then verify by re-run + diff

- Apply only after they paste the dry-run output back and you confirm every field-level diff.
- **Verify by re-running the read-only script and diffing against the saved prior output** — don't
  build bespoke verification tooling.
- **Audit every denormalized copy of the changed value.** Renaming does not regenerate a slug
  generated `before_validation … if: :new_record?`, and associated records (cached names, search
  documents, copies on child rows) can still carry the old value.
- **State that is set by hand is cleared by hand.** A manual hold or flag usually has no automatic
  clear — read the code that evaluates it to confirm, then clear it explicitly in the repair,
  attributed to a real admin user. Re-drive the failing action the way a user would, not with a
  hand-rolled imitation.
- If a human has to follow up per record, emit a list (record identifiers, plus admin links if you
  have an admin UI) saved as a draft in the adhoc dir. Don't post it.

## Phase 11 — then ship the permanent fix

The console repair patches the data; the code still has the bug. In its own worktree: reproduce the
exact prod failure locally against old code, confirm identical failure, apply the fix, confirm
silence — then **verify-in-app** if it has a surface a person sees, run **code-style**'s
self-review checklist over the diff, and **ship-pr** (which ends in **pr-triage**). Commit the
verified fix by default, staged precisely (never `git add -A`/`-u`); leave it uncommitted only when
the user explicitly says so. Pushing and opening the PR still waits for the user to ask.

Prefer the console paste for one-offs. Promote to a checked-in data migration (your repo's
convention — a `backfills/` directory, the `maintenance_tasks` or `data-migrate` gem, a rake task,
a Django data migration) only when it must be auditable or repeatable. Its dry-run footguns are in
`REFERENCE.md` §5.

---

## Environment facts to establish once per app

Write these into the project's `CLAUDE.md` the first time you learn them; never guess them.

- **`<prod_console_cmd>`** and its environments (production, staging, a read-only debug replica if
  one exists). A wrapper with **no default environment** is safer — you can't hit prod by accident.
- **How to tell what's deployed** (merged ≠ deployed).
- **Which local tools hit which DB.** Every local query tool — `bin/rails runner`, `psql`, a
  postgres MCP server, a bespoke `query` script reading `$DATABASE_URL` — hits dev unless proven
  otherwise. Note which env var each reads.
- **The admin UI's URL pattern**, if you have one. Behind SSO — hand the link to a human, never sign
  in.
- **Conventions in `<sandbox_dir>`**: `adhoc/<YYYY-MM-DD>-<slug>/` is the home for prod scripts.
  Reusable local tools (**sandbox-tool**) use `CONFIRM=yes` rather than `DRY_RUN` — keep the two
  conventions in their own lanes.

Postgres/Rails facts that bite repeatedly:
- Postgres array columns (`character varying[]`) have no model scope: use `'x' = ANY(col)` or
  `col @> ARRAY['x']::varchar[]`.
- `find_each` forces primary-key batching and silently overrides `.order(...)`.

## Other frameworks

The Rails example maps directly; keep every rule, change the mechanics. Commands in the last two
columns are starting points — confirm them on your stack the first time.

| Framework | Console | Halt without killing the session | Rollback wrapper for rehearsal | Static check + paste rehearsal |
|---|---|---|---|---|
| Rails | `bin/rails console` | `raise` (never `abort`/`exit`) | `ActiveRecord::Base.transaction(joinable: false) { …; raise ActiveRecord::Rollback }` | `ruby -c f.rb`; `bin/rails console < f.rb` |
| Django | `python manage.py shell` | `raise RuntimeError(...)` (never `sys.exit`) | `with transaction.atomic(): …; transaction.set_rollback(True)` | `python -m py_compile f.py`; `python manage.py shell < f.py` |
| Laravel | `php artisan tinker` | `throw new \RuntimeException(...)` | `DB::beginTransaction(); …; DB::rollBack();` | `php -l f.php`; pipe the file into tinker (check your version reads stdin) |
| Phoenix / Ecto | `bin/<app> remote` (release) or `iex -S mix` | `raise "HALT: ..."` | `Repo.transaction(fn -> …; Repo.rollback(:rehearsal) end)` | `mix compile`; `iex -S mix < f.exs` |
| Node (Prisma, Sequelize, Knex…) | a REPL script that boots the app's DB layer | `throw new Error(...)` | the ORM's interactive transaction, then throw to roll back | `node --check f.js`; pipe into the same REPL script |

The one-statement rule applies to every REPL: wrap the body in one block (a function invoked once,
an `if True:` block in Python, a `do`/`fn` in Elixir) so a raise stops all of it. Pasted-code traps
differ per REPL — Python's blank lines inside an indented block end the block in the interactive
shell, so prefer `exec(open('/tmp/x.py').read())` there; Node's REPL needs `.editor` mode or a
wrapper for multi-line pastes. Rehearse with the same entry point the user will use.

## Verified gotchas

- **A pasted repair applied after a guard printed HALT.** The guard was a top-level statement; the
  REPL raised on that line and carried on with the next. ⇒ One `begin … end` body (rule 6), and a
  guard-path rehearsal through a real paste.
- **A pasted sweep silently ran unfiltered.** A line starting with `.where(` was evaluated on its
  own and failed; the line above had already assigned the unfiltered relation. ⇒ Trailing dots, and
  the leading-dot grep in Phase 3.
- **The fenced payload wasn't parseable.** The fence spanned several statements, so echoed source
  and `nil` landed inside it. ⇒ One `puts` for fence + payload; whole-line-anchored extraction.
- **A "read-only" script wrote to production.** A `coordinates` reader called `geocode!` when its
  cached latitude/longitude was blank, and `geocode!` made a live call to a geocoding API and saved
  the row. Everything reading the derived coordinates went through it. ⇒ Pre-read the raw columns,
  and install a guard on the lazy writer regardless.
- **The dry run re-confirmed the bug.** The verification block ran *after* the `if DRY_RUN` branch,
  so it printed the record's unchanged value. ⇒ Assign in memory before the branch; reset inside
  it.
- **`DRY_RUN` is sticky across a console session.** With `DRY_RUN = true unless defined?(DRY_RUN)`,
  once the user sets `DRY_RUN = false` it stays false for every later paste or `load` in that
  session. Say so in the header; a fresh console resets it.
- **Top-level `return` → `LocalJumpError`**; `abort`/`exit` kill the console session.
- **An unguarded script loses all output when one section raises** — per-section `rescue`.
- **The console runs pre-deploy code** → `ArgumentError` on a just-merged keyword argument.
- **`bin/rails runner` fails silently when Docker itself is down** — `docker info` first.
- **A datafix dry run using `LIKE` against `jsonb::text` found 0 rows** — Postgres renders
  `jsonb::text` with a space after each colon. Use an exact JSONB containment predicate
  (`where("col @> ?", value.to_json)`).
- **Writing the repair script can be blocked by the permission classifier.** Say what the file does
  and let the user accept the edit; don't route around it.
- **A log query on a field that isn't at that path returns zero rows with no error** — see
  `REFERENCE.md` §4.

## When not to use / hand off to

- Any prod read the warehouse can answer — a row, a count, a sweep, a blast-radius preview →
  **warehouse-data**.
- A small read the warehouse lacks → the `<ops_bot>`, if your team runs one (**warehouse-data**).
- A chat/ticket report → code trace → verdict (before any prod script) → **bug-intake**.
- Proving a change works in the running app → **verify-in-app**.
- Local stack broken, ports/Docker/queues → **dev-doctor**.
- A reusable local script or preview harness (not a one-off prod paste) → **sandbox-tool**.
- Validating a third-party API claim with real credentials → **vendor-api-probe**.
- Writing up the finding durably → **research-doc**; a page that makes the mechanism legible,
  scrubbed of identifiers → **visual-explainer**.
- Shipping the permanent fix → **ship-pr** (+ **worktree-create**, **gh-stack**).
- The script's shape before handing it over → **code-style**.
- A long blast-radius sweep, or several parallel investigations → **agent-team**.
- **Non-local environment** (cloud session, routine, fresh VM)? Load **cloud-runtime** for what
  degrades and how to label it.

Long-tail reference (full script templates incl. the bulk repair and the payload extractor, console
mechanics per platform, the log-search recipe, the data-migration class pattern):
**[REFERENCE.md](REFERENCE.md)**.
