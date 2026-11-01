# Partner mode: issue → verified chat thread → verified fix

Loaded by `slack-message` when the reader is outside the user's organization (SKILL.md Step 1):
a vendor, an API provider, a data supplier, an integration partner. SKILL.md's hard rules and
Steps 1–7 still apply. This file adds what partner threads need, under the same step numbers,
plus the P-rules below.

Partners are reached through a **shared channel** (Slack Connect, the partner's own community
workspace), or through their support portal, an issue on their public repo, or email to their
support address. Data and API issues get reported there in a consistent shape, and the shape
works: a batch of focused, standalone threads tends to get fixed fast. The reader knows **their** API and data, not our code. Every message stands
alone, names the exact record, shows the exact value, says what it breaks for us, and asks for one
concrete change. Then the thread is followed until the fix is verified on our side.

- Message anatomy, wording and formatting: [`partner-style.md`](partner-style.md). **Read it before drafting.**
- Lookup patterns (warehouse, the partner's API through our client, public endpoints): [`queries.md`](queries.md).
- Annotated partner messages and the failure modes these rules guard against: [`examples.md`](examples.md) § Partners, § Failure modes.

## Where partners are reached

Ask the user which channel, portal, repo or address reaches this partner the first time (never
guess an outward-facing destination), and note it in the draft file's header. A chat draft needs
channel membership (`not_in_channel`: ask the user to join; don't look for another channel).
Shared external channels can be invisible to search and may block sends entirely — that's fine,
this skill only drafts.

**Other venues** keep the same anatomy and P-rules, with two changes:
- **Format**: standard Markdown for GitHub issues and portals, plain text for email — not Slack
  mrkdwn (`partner-style.md` §Formatting).
- **"One thread per issue" becomes one issue / ticket / email per issue**, each with a subject
  line that names the record and the symptom. Step 6's chat-draft mechanics don't apply; the
  paste-ready blocks in the draft file are the deliverable.

## P-rules (in addition to SKILL.md's)

- **P1. Check the field the way our system uses it.** When the claim is "X doesn't match Y",
  compare every place the partner carries that value, and check which one our code reads
  (§Know which field you read). Checking the wrong pair once produced a wrong "they fixed it"
  (examples.md § Failure modes). Our side too: a summary health flag on our records often only asks
  whether each item has a match *somewhere*. A record missing most of its matches reads clean,
  so count matches per sub-key (`queries.md`) — e.g. a venue with hours for only one weekday and
  none for the other six still passes a "has opening hours" flag.
- **P2. Read the channel before drafting.** Don't raise what's settled there (a field the partner
  already explained they leave blank on purpose). Reply in an existing thread when the issue
  follows on from it and the thread is still about it. When the old thread has drifted, or the
  new report is broader (more records, a new cause), open a new top-level message that points
  back ("following up on the thread from last month"), and offer the user the in-thread option.
- **P3. One issue per thread, each standalone.** The same issue across several records is one
  thread. Two problems on one record are two threads. Two symptoms that need the same single ask
  (two webhooks we never receive: one is disabled on their side, one points at a URL we retired) may share a thread; say so in Notes
  so the user can split them.
- **P4. Tags and greetings are the user's call.** No @-mention of a partner's person unless the
  user says so. In a series, the user's own lead message tags the contact. No "Hi team" on each
  thread of a series. A lone top-level message may open with "Hi team," when nobody on our side
  has posted in the channel that day. In-thread replies use the person's first name in plain text
  ("Thanks Alex, …").
- **P5. The partner's words, not ours.** Their field names in backticks, as their API spells them.
  Never our internal names (model names, tables, job names, the warehouse). Say "our listing",
  "our import", "set up on our side".
- **P6. A partner reply is a claim.** "Fixed", "adjusted" or "looks okay on our end" is verified
  against the live API before anything is called fixed. A partner's "that record looks okay" can
  be followed by the same 500 for weeks. A claim only a write can prove ("the 500 is
  fixed", "the endpoint accepts partial refunds") is either probed under **vendor-api-probe**'s gate,
  or labelled with the indirect evidence used ("our nightly sync has imported it cleanly since") and
  marked unproven. Account-scoped claims ("API access turned on") checked with a local or sandbox
  key are inferred, not verified, when that key belongs to a different partner account from
  production's.

## Step 2 (partner): read the channel

Read the last ~30 top-level messages (`slack_read_channel`, `concise`, because some posts are
whole JSON payloads), then `slack_read_thread` (`detailed`) on any that touch the same records,
fields or endpoints. Search the record ids too (with `in:<#channel>`), because old threads fall
off the last 30. Note down:

- **Settled topics.** Drop them, and say in Notes which thread settled each one (ts). If what's
  left is a bug on **our** side (their data is as intended, we handle it badly), tell the user and
  hand it to **bug-intake**.
- **Open threads on the same issue** (P2).
- **Precedent answers.** If the partner already confirmed a rule ("`day` 7 is accepted as Sunday"),
  don't ask again.

Earlier drafts in the investigation dir are context. Read them to avoid contradicting what was
already sent, but every fact in the new message is re-checked.

## Step 3 (partner): verify every fact live

Re-run the lookup behind each claim today (SKILL rule 2): **vendor-api-probe** for the partner's
API, **warehouse-data** for our records. Record each in the Facts list with its source and UTC
time. A fact that can't be re-checked (the record now 403s, a one-off failure) keeps its original
date and says so: "(<date>, not re-checkable today)".

- **GETs need no gate.** Reproducing a failing write (a `POST` that 500s) creates resources in
  the shared partner account, so it follows **vendor-api-probe**'s propose → wait → act and
  cleanup rules. Otherwise quote the latest failure from our logs (`<log_search>`), with its time.
- **Run partner lookups through our own API client** where one exists (a `bin/rails runner`,
  `node -e`, `python manage.py shell -c` script calling the client class), from a checkout you
  own. **Check first whether booting the app has side effects** on the shared dev DB (seeds,
  initializers or callbacks that re-save integration records) and switch them off with whatever
  env flag the app provides — a boot like that can silently re-save shared rows on every run.
  Public endpoints are plain `curl`. **If you quote an endpoint that isn't the partner's
  documented public API** (an internal endpoint their own web app calls), say so in the message,
  so they don't chase a contract they never published. Keep scripts and raw JSON next to the draft.

For each issue, also find:

- **The control**: a sibling that's fine (the other values on the same record, another record
  with the same shape, the same request with one field changed). It proves the problem is the
  record, not our call.
- **The exact request**, if an endpoint fails: the minimal body, plus the time (UTC) of the latest
  failure.
- **Scale**: is it these records only, or a pattern? Only claim what you swept. A sweep of the
  partner's listing supports "other records in your catalogue have the same…". A sweep of our own
  records supports only "among the records we import…". With no sweep, make no scale claim. Name
  2–4 examples inline, and put a long list in an attached CSV. "The same shape" is not "the same 500" unless you checked.
- **The record's display name**, from the same lookup. If the API refuses the record (403/404),
  take it from the partner's public page and say so in Facts.
- **The right value**, before asking for a direction. When two values disagree, check which one
  is true against something independent (the partner's public page, a standards list such as ISO
  codes, the raw file they host). The direction that's cheapest for us ("just copy field A into
  field B") can lock in the wrong value when it's field A that is wrong. If the right value can't
  be checked, offer both directions and say which is easier for us.

## Step 4 (partner): shape the threads, write the file

- One thread per issue (P3). Order by impact (customers blocked, then records we can't use, then
  questions), or keep the given order if impact is unknown.
- **Is it cheaper to fix on our side?** Before asking a partner to change data, check whether a
  small tolerance on our side would do it (accepting both spellings, normalizing a value, falling back to a second field). If so, tell the user in one line, and they decide. Don't hide our behaviour from
  the partner: "Our request refunds the captured amount" is honest. Omitting it to make the
  ask look cleaner is not.
- **A series** (3+ threads at once) works best with a one-line lead from the user that tags the
  contact (how many threads are coming and why they are
  separate, in the user's own words). Offer it; the
  user writes it.
- **A direction** is asked for only once it's right (Step 3), and with the reason it's easier
  for us.
- **An issue a combined message dropped** (Step 7) is still its own problem. Give it its own
  thread, unless it's the same problem the posted message asks about.

The file is `NN_<partner>_messages.md` in the investigation dir. `NN` is one more than the highest
numbered file there, and `<partner>` is a short slug for the partner. For a mixed ask, the
teammate draft goes first in the same file, as "Message 1 (teammate: <where>)".

```markdown
# <Partner>: <topic> (<state: "drafted <date>" | "threads 1–3 sent <date>; 4 drafted">)

<Venue> (`<channel id>` shared channel | <portal / repo / address>): paste each block as a new top-level message, issue or email. Attach `<files>`.

Facts:
- <claim>: `<call>`, checked live <YYYY-MM-DD HH:MM> UTC (<evidence file>)

---

## Thread 1: <short title>

````text
<the message, in the venue's format, exactly as it should be pasted>
````

---

Notes:
- <dropped topics and the thread that settled them; tags; attachments; our-side follow-ups>
```

Reply drafts later go in a `## Replies` section of the same file, one block per thread, each
headed with the thread ts and "reply in thread".

## Step 6 (partner): chat drafts for a series

A channel holds one draft at a time, so a series goes one thread at a time: draft thread 1, wait
for "sent thread 1", then draft thread 2. Conversion and errors are in SKILL.md Step 6.

## Step 7 (partner): after posting, and replies

**After the user posts.**
1. Capture each message's text, ts and permalink. Add "sent <date>" and the ts to the file's
   title line.
2. Diff the posted text against the issue list (SKILL rule 6). Read posted attachments
   (`slack_read_file`, using the file ids from a `detailed` read) to see what they actually
   cover. Once, a posted CSV listed a record only for an unrelated wrong value, not for the
   mismatch the thread was supposed to raise. Tell the user exactly what's no longer covered.
3. Set the investigation's status to "waiting on <partner>", with the date.

**When they reply.**
1. Read every thread in the series. Quote each claim, and note what the user already did since
   (in the thread or the status files). Don't redo it.
2. Check every numbered ask got an answer. A skipped ask (a second record, "a few more charges have the same shape") is still open. Re-measure any scale claim yourself.
3. Verify each claim live (P6), with the Step 3 lookup. Label each one ✅ verified (what you
   checked, and when), ⚠️ partly fixed or unproven (what's left), or ❌ not fixed.
4. Follow the fix through to our side. A partner fix rarely heals our records by itself:
   - **Records our sync skips** (inactive, draft, archived) keep the old data until a targeted
     re-sync — on production that's a **prod-script** `repair`, one record at a time. A UI
     "re-sync" button may do more than re-sync — check what else it triggers before suggesting it.
   - **Fixes change what we key on.** A corrected code is a new key to us. A renamed field value
     (`net 30` → `Net 30`) is a new value, and the old one lingers.
   - **Count matches per sub-key** (P1), not the summary flag.
5. Report a per-thread table (claim, verdict, evidence and time, what it means for our records),
   then **verified fixed → still broken → what the user needs to do**. Update the status file.
   Offer reply drafts for what's still broken.

## Know which field you read

Before claiming any mismatch, write down — in the draft file's Notes — for each partner field the
message mentions:

- **Every place the partner carries the value** (a top-level list, each item's nested copy, the
  images or attachments, a fallback list). Partners often duplicate a value in two or three
  places, and they drift apart.
- **Which one our code reads**, with the `file:line` that reads it (grep the client and the
  normalizer that maps their payload into our records), and what we match it against (exact
  string, case-insensitive, trimmed).
- **What our side does to it before sending it back** (trimming whitespace, lowercasing,
  re-encoding). That's the honest "Our request sends…" line in the message.
- **Whether we key on a display name.** If our code matches on a name, label or other value the
  partner treats as cosmetic, add an ask to every related report: "please keep these names
  stable on any re-upload or rename" — otherwise their next tidy-up silently breaks the match.
- **No app client or warehouse?** Grep the integration code for the field name and read the raw
  response with `curl` (`queries.md`) — the point is the code path, not the tooling.

This is the step that stops a "they fixed it" which healed nothing: the partner fixed the copy we
don't read.

## Verified gotchas

- Markdown tables don't render in Slack. A thread drafted with one gets posted as bullets — draft
  it as bullets from the start.
- A draft built by an Explore agent or subagent that cites ids it didn't look up breaks SKILL
  rule 3. Re-verify before it goes in the file.
