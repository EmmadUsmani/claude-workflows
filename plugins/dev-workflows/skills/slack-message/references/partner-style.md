# Partner mode: message anatomy

The partner-register detail behind `voice.md`. Reports that get fixed share one shape and one
voice; this file describes both. Illustrations come from the invented partners in `examples.md`
(a maps/places API, an email-delivery API and a payments provider behind a small event-signup
app) — use them for shape, not wording.

## Voice

The user sounds like a friendly engineer who has already done the digging and wants it fixed.
Not a ticket system, and not a lawyer.

- **"We" for the team, "I" for the user's own digging.** "We send addresses exactly as the user
  typed them", but "I think it depends on the sending domain".
- **Hypotheses are marked, briefly.** "we suspect the payload is being truncated", "I think it
  depends on…". One hedge per claim, then the evidence. Don't pile hedges up.
- **Plain words, contractions, short sentences.** One idea per sentence.
- **Concrete over abstract.** Name the record, the field, the value, the time: "pins in the river
  next to them", not "a geolocation discrepancy".
- **Say what it costs us, in one line**: who is blocked or confused, and how.
- **Warm, short acknowledgements in threads.** "Thanks for looking.", "Thank you!", "Thanks, that
  helps."
- **Collaborative, never blaming.** Give them the variable that splits the cases and the ids to
  look up, so they can see it themselves.
- **Say when it's not urgent**, and what we've done meanwhile.
- **Close with "Thanks!"** (or "Thank you!" on a long note). Nothing after it.

Never: "I hope this finds you well", "please advise", "kindly", "at your earliest convenience",
"as per", apologies, exclamation marks beyond the thanks, emoji in a report, or our internal
jargon (see Wording).

## The three shapes

### 1. Opening report (a new top-level message, issue or email)

Each element is one or two sentences:

1. **The symptom, in their terms, and what it breaks for us** — or, for a question, the question
   itself. ("Addresses we add through `POST /suppressions` keep getting our emails when…")
2. **The record**: the partner's id in bold, with its display name: `*place_5512* (Lakeside
   Gallery)`, or an id they can search: `msg_77a1`, `evt_9921`.
3. **The evidence**: the exact values, in their own words — one `•` bullet per record or value
   pair, or the request/response in a code block trimmed to the fields that matter. A failure
   carries its time in UTC.
4. **Why it matters to us**: how our side uses the field, in one sentence ("We send addresses
   exactly as the user typed them").
5. **The control**: what's fine, to show it's the record and not our call ("The lowercase
   addresses we suppressed the same day were all skipped").
6. **The ask**: one concrete change, or a numbered list when there's more than one — the fix, the
   direction we'd prefer and why, a rule for next time, or a heads-up when it's done. When two
   answers would both work for us, say so.
7. "Thanks!" (Slack/email; a portal ticket can end on the ask.)

**Length.** About 60–180 words of prose, plus the evidence: every fact the partner needs to act,
and nothing about how we found it. A long list goes in an attached CSV; name 2–4 examples inline.

**A note-length report** (many records with one defect) can use bold labels — *What we're
seeing*, *What we think is causing it*, *Our ask*, *How to check* — and should give a check they
can run themselves.

### 2. In-thread reply (after they answer)

Conversational. First name, a short thanks, then straight to what's different between their test
and ours: the variable that splits the cases, two ids they can look up, and one question. Bold is
allowed on the one finding that carries the argument.

### 3. Short follow-ups (nudge, confirm, close)

One or two lines, no structure: a nudge names who is waiting and why; a confirmation says what we
checked; a partial fix names what's still broken by id. See `examples.md` § Short follow-ups.

## Wording: theirs, not ours

| Don't write (ours) | Write (theirs / plain) |
|---|---|
| model, table, record class names | the thing as they call it: "place", "message", "charge" |
| sync job, importer, re-sync, backfill | our import, "refresh them on our side" |
| our internal ids and join keys | their id, "the `location` on the place" |
| normalize, strip, coerce | what we actually send: "We send addresses exactly as typed" |
| our health flag names | what it stops us doing: "we can't show its hours" |
| the warehouse, prod console, error tracker | (never mentioned) |

Their field names stay exact and in backticks, as their API spells them: `location`,
`viewport`, `business_status`, `opening_hours`. Their endpoints too: `POST /suppressions`,
`GET /v1/places/place_5512`.

## Formatting

- **Slack (mrkdwn):** `*bold*` with single asterisks; `•` bullets; numbered asks as `1.` lines;
  code blocks with ```` ``` ```` and no language tag; **no markdown tables** (Slack shows the
  pipes — use bullets, or a monospace table inside a code block); no `#` headings.
- **GitHub issues, portals:** standard Markdown (`**bold**`, `- ` bullets, fenced code with a
  language tag). A title that names the symptom. A small table is fine on GitHub.
- **Email:** plain text with the same structure; requests in an indented block; a subject that
  names the record and the symptom.
- Everywhere: bold the partner's id, a display name, or a count that matters. Don't bold whole
  sentences. `` `code` `` for every literal value, field, endpoint and id the partner will search
  for.
- Links: bare URLs to the partner's own pages are fine; skip our admin URLs, which they can't
  open.
- Spelling: keep one spelling per message (colour/color, catalogue/catalog). Field names keep the
  API's spelling.

## Series and greetings

- **A series of threads**: offer the user a one-line lead that tags the contact and says how
  many threads are coming and why they're separate (they write it in their own words). Each
  thread then starts straight with the finding: no "Hi team", no tag — a greeting on every thread
  of a series reads as redundant.
- **A lone top-level message**: either no greeting, or a generic "Hi team," when nobody on our
  side has posted in the channel that day. Don't tag a specific person unless the user says to.
- **In a thread**: their first name, in plain text.

## Pre-flight checklist (run on every draft)

- [ ] Does the first sentence say what's wrong **and** what it breaks for us? For a question, is the question the first sentence?
- [ ] Is every id, value and time copied from a lookup made today, and listed in the file's Facts?
- [ ] Is the partner's id bold, with the display name where there is one?
- [ ] Is there a control case showing what works?
- [ ] Is there exactly one problem per thread? Does the thread make sense if it's the only one they read?
- [ ] Is the ask concrete (numbered when there's more than one)? Does it give the preferred direction, if there is one, and is that direction the right value?
- [ ] Is there any internal jargon, class or table name, or warehouse/console mention? Replace it.
- [ ] Does it avoid a tag or greeting the user didn't ask for, and avoid "Hi team" on a thread in a series?
- [ ] Is the format right for the venue (mrkdwn for Slack: no tables, no headings, no language tags on code blocks)?
- [ ] Is it under ~180 words of prose, with long lists moved to an attachment?
- [ ] Does it end with "Thanks!" (or, for a portal ticket, on the ask)?
