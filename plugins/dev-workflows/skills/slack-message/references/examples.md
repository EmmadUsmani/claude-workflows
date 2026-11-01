# Example messages, annotated

Invented messages written from the rules in `voice.md` and `partner-style.md`, to show each shape
in use. The setting: a developer on a small event-signup web app (`potluck`) that uses a
maps/places API, an email-delivery API and a payments provider, who also maintains an open-source
link checker (`hrefcheck`) with a co-maintainer, Sam. Every name, number, id, date and time is
made up. Slack messages are mrkdwn as they'd be pasted; the GitHub ones are Markdown.

Use these for the *shape* — length, order, what each line is doing. Don't reuse the sentences;
write the user's message from the facts in front of you.

## Teammates

### Heads-up before anyone asks (#ops)

```text
Heads-up for tonight's cooking-class signups: confirmation emails are going out about 20 min late. Our email provider is throttling us after this morning's newsletter. Nothing is lost, everything in the queue will still send. I'll post here when it's caught up.
```

- The item by name, then its state, then why in one plain clause, then what happens next.
- "Nothing is lost" answers the worry before ops has to ask it.

### Scoping it for the reporter (@Noah, #support)

```text
@Noah the Saturday waitlist is intact — all 31 people are still on it, in the order they joined. The only thing wrong is the "spots left" number on the event page: it counts cancelled RSVPs as taken, so it shows 0 when there are really 4 open. Your host can keep promoting people from the waitlist as usual while I fix the counter.
```

- Leads with what he's afraid of (the waitlist) and clears it first.
- Says exactly which number is wrong and by how much, in words a host would use.
- Ends on what the host can do today.

### Root cause for someone who raised it (@Leo, group DM)

```text
@Leo good catch, and it's wider than Arizona.

What happened: reminder emails work out the event's local time from a list of UTC offsets that assumes every zone shifts for daylight saving. Arizona and Hawaii don't, so since the clocks changed on Mar 8 their reminders have shown a start time an hour late. The bug's been there since we added reminders, it just had no way to show up until the change.

What was affected: 6 events in those two states had reminders go out with the wrong time. Tonight's pottery class in Tucson is the only one that hasn't happened yet.

What we can do:
• I've switched reminders to the zone database instead of the offset list (#162), so new reminders are right.
• For tonight's class, I can send its 12 attendees a short correction email, or the host can post the right time on the event page. Which would you prefer?

The past events are done, so there's nothing to fix there beyond an apology if a host asks.
```

- An opener that credits them and widens the scope in one line, instead of a formula.
- The three labelled paragraphs come from `voice.md`; the sentences inside them are specific to this bug.
- The one decision for Leo is a real either/or, put where it applies.

### Fixed, hosted app (@Priya, #support)

```text
@Priya fixed — exports work again on events with more than 500 RSVPs. Give it another go and tell me if the file still comes out empty.
```

- One line of what changed in her terms, one line of what to do. Only claim what was checked on
  production.

### Handing work over (#potluck-dev, before a week off)

```text
Handing the waitlist digest to Sam while I'm out next week. Where it stands:

Merged
• #155 waitlist positions — live since Tuesday

Open
• #158 daily digest email — approved, waiting on the copy from Maya
• #159 unsubscribe link — needs review, Sam has context

Not started
• Batching for events with 1k+ people on the waitlist. Notes in the design doc: <link>

Anything urgent, ping Sam first.
```

- Grouped by state rather than by date, because the reader's question is "what do I pick up?".
- One link per bullet, each with its state.

### Calling a pause (#potluck-dev)

```text
I'm pausing the calendar-sync work until after the release. The calendar API change needs more time than I have this sprint, and the release fixes are what hosts are blocked on. Back on it the week of Apr 20.
```

- The decision first, then the honest reason, then when it resumes.

### Asking a peer to decide (DM to Sam)

```text
Should `--ignore` take regexes or globs? No rush.

Today it's a substring match, which surprises people: `--ignore /api` also skips `/apiary`.

Globs (`/api/**`) match how most users already write them in the README examples and are hard to get wrong. Regexes cover more cases but a stray `.` silently widens the match.

I lean globs, with a `--ignore-regex` escape hatch later if anyone asks. The parser change is small either way (`IgnoreRules#match?`). Wdyt?
```

- The question in the first line, then today's behaviour, the trade-off, and the lean.
- Code names are fine because the reader works on the code.

### Deferring to someone (#hrefcheck-dev)

```text
Sam wrote the retry logic so I'll let him confirm, but I think the 429s come from us ignoring Retry-After when it's a date instead of a number of seconds.
```

## Community (public, own project)

### Fix released, on the reporter's issue

```markdown
Thanks for the repro repo, that made it easy to pin down.

Anchors with encoded characters (like `#caf%C3%A9`) weren't decoded before we compared them to the page's ids, so they were always reported missing. That's fixed in **v0.8.2**, out today. `hrefcheck self-update` will pick it up.
```

- Thanks once, then the cause in plain words, then the version and the upgrade command.
- The version was checked against the published release before the message named it.

### Merged, not released yet, with credit

```markdown
Merged @dana-k's fix in #84, thank you! It'll ship in the next release. Until then, `--no-anchor-check` skips these false positives.
```

### Asking for what you need

```markdown
I can't reproduce this on 0.8.2 yet. Could you run it again with `--debug` and paste the lines around the timeout? Your OS and how you installed it would help too.
```

## Partners

### Opening report (email-delivery API, shared channel)

```text
Addresses we add through `POST /suppressions` keep getting our emails when the address has capital letters in it.

For example, `Jo.Smith@example.org` was suppressed on Apr 2 (response `201`), but our Apr 6 reminder to it was delivered (*msg_77a1*). The lowercase addresses we suppressed the same day were all skipped as expected.

We send addresses exactly as the user typed them. If suppressions are matched case-sensitively, could you either match them case-insensitively, or tell us so we lowercase everything before calling you?

Thanks!
```

- First line: the symptom in their terms. Then one concrete record, the control (lowercase works), what we send, and one ask with two acceptable answers.

### A question, not a fault (maps API, shared channel)

```text
Can a place have `business_status: CLOSED_TEMPORARILY` and still return `opening_hours` that look current? *place_5512* (Lakeside Gallery) does today, and we're deciding whether to hide the RSVP button for places like it.

If the status wins, we'll hide it. If the hours win, we'll leave it. Either answer works for us.

Thanks!
```

- The question is the first sentence; the record and why we're asking follow.

### Endpoint failure with a hypothesis (payments provider, support portal)

```markdown
**Webhook signatures fail on large `charge.refunded` events**

Signature verification fails for `charge.refunded` events that include more than 10 refunds, and only for those. Most recent: `evt_9921`, 2026-04-07 16:12 UTC.

We verify against the raw request body, byte for byte. For the failing events the body we receive is cut off at 64 KB, so we suspect the payload is being truncated before signing or before sending.

Events with fewer refunds from the same account verify fine.

Could you check whether `evt_9921` was sent in full?
```

- Portal ticket, so it gets a title and standard Markdown.
- The hypothesis is labelled ("we suspect"), the control is one line, the ask is one question.

### Note-length report (maps API, many records)

```text
*What we're seeing:* 14 venues in the attached CSV have pins in the river next to them. Their addresses are right; only `location` is off, by 150–300 m.
*What we think is causing it:* they were all added on Mar 30, and all sit on streets renamed last year.
*Our ask:* could you re-geocode these 14?
*How to check:* a place is fine when its `location` is inside its `viewport`. All 14 fail that today.

Thanks!
```

- The labelled shape from `partner-style.md`, with a check they can run themselves.

### Reply after they say "works on our end" (email API thread)

```text
Hi Alex, thanks for looking. We still see it, and I think it depends on the sending domain: from `mail.potluck.example` the suppression holds, from `events.potluck.example` it doesn't. Same address, two messages a minute apart: msg_80c2 (skipped) and msg_80c3 (delivered). Could suppressions be stored per domain on our account?
```

- Confirms the disagreement without arguing, gives the variable that splits the cases, and two
  ids they can look up.

### Short follow-ups

```text
Hi Alex, any update on the suppression issue? A host's attendees who opted out are still getting reminders, so we'd like to sort it this week if we can.
```
```text
Thank you! Confirmed on our side: suppressed addresses are skipped now, capital letters included.
```
```text
Thanks, 13 of the 14 pins look right now. *place_6021* is still in the river.
```

## Failure modes these rules guard against

- **Re-checking the copy we don't read.** A partner fixes `viewport`, someone confirms the fix by
  looking at `viewport`, and our pins — drawn from `location` — stay wrong. → partner.md P1 and
  §Know which field you read.
- **A scale claim nobody swept.** "Several other records have the same problem" with no query
  behind it invites "which ones?" and stalls the thread. → partner.md Step 3, Scale.
- **Asking for a direction before checking which value is right.** The cheapest ask for us can
  lock in the wrong value. → partner.md Step 3, The right value.
- **Yesterday's check, today's message.** A fact verified in an earlier session went out after
  the partner had already changed it. → SKILL rule 2.
- **The posted version lost an issue.** The user merged two drafts before posting and one ask
  disappeared; only re-reading the channel caught it. → SKILL rule 6, partner.md Step 7.
