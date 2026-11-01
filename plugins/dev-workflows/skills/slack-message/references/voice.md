# The user's message voice

A default voice for technical chat and issue replies. **Write like this, not like Claude.** It's a
starting point: if the user has posted messages you can read, check a few against these rules,
and where they differ, their own messages win. Specific tics below (`Lmk`, the emoji names) are
examples of the register, not requirements — drop any the user doesn't use.

The messages are short, plain, specific and friendly. They say what's true, what's next, and what
the user needs.

## Always

- **"I" for what the user did or thinks, "we" for the team or project.** "I confirmed it's an
  issue with the data the maps provider is sending us", "We'll skip anyone the host already
  refunded by hand".
- **Plain words, contractions, short sentences.** "it should be fixed now", "that's why it's only
  showing up now", "Lmk if it still doesn't work". One idea per sentence.
- **Concrete over abstract.** Name the feature, the field, the count, the date: "23 attendees
  were charged twice", not "a number of payments were affected".
- **Honest about certainty.** "It seems like…", "I think…", "Need to confirm this first though".
  One hedge, then the evidence. Never a stack of hedges, and never confidence that hasn't been
  earned.
- **Honest about themselves.** "sorry for the delay here", "I'm not super familiar with how the
  payout reports are built", "I don't think I'll have enough time to work on this".
- **No filler.** Never "I hope this finds you well", "just circling back", "please advise",
  "kindly", "as per", "great question", or a closing summary of what was just said.
- **Emoji are rare and reactive**, at the end of a line, if the user uses them at all. Zero is the
  default; never in a partner report or a public issue reply.

## Teammate register (default mode)

Teammates span non-engineers (ops, support, sales, design) and engineers (peers, a lead).
Write for the person who asked, in product words, not engineering ones.

- **Tag the person you're answering**, at the start, when they're waiting on you: "@Name sorry
  for the delay here. So I've confirmed…", "@Name it should be fixed now". In a thread that's
  already a back-and-forth, plain text is fine.
- **Lead with the answer.** Answer the question they actually asked (often the latest one in the
  thread, like "any eta?") in the first lines. Confirm what they saw before explaining it, in a line of your own ("good catch, and it's wider than Arizona").
- **Speak to their stake.** If there's a customer, a deadline or a launch in the thread, say what
  the finding means for it ("the guest list your host sees is right, it's only the count on the
  dashboard that's off").
- **Separate our side from theirs.** "I've confirmed this is only an issue with the attendee count
  on the host dashboard. The RSVP list itself is correct, e.g. if you open the guest list everyone
  is there once…"
- **Tell them what they can do now.** "you should be able to send the reminder if you try again",
  "Btw you should be able to do this from the event settings now, there's a "Re-open RSVPs"
  button at the bottom".
- **Say what's still pending, and roughly when.** "Some banks take a few business days to show
  the refund on statements."
- **Point to the partner thread** rather than retelling it: "Going to start a thread with them on
  this shortly so they can fix it", then the link once it's posted.
- **Lowercase fragments for acks:** "taking a look", "will take a look shortly", "should be
  refreshed now", "Will look into it". No period.
- **Defer openly when it's someone else's area:** "I'll let <name> confirm since I'm not super
  familiar with…", "Hmm seems like an edge case, will let <name> chime in on how to resolve
  tomorrow".
- **Name the risk in a suggestion:** "I think it may be fixable from the admin… we'd just need to
  be careful and make sure we don't touch events that already happened."

### Longer explanation (someone raised an issue; we found the cause)

`examples.md` § Root cause for someone who raised it shows it in use. Use this order, and a plain-text label at the start of
each paragraph:

1. `@Name` + the verdict on what they reported: "You were right: … Here's what happened."
2. **What happened:** the cause in plain words, with dates and the PRs as links. Say why it's only
   showing up now.
3. **What was affected:** the count, and the examples they named.
4. **What we can do:** bullets, one per outcome, each with its count. Put a question to them
   inside the bullet it's about ("Can you confirm those three?").
5. What happens to related things automatically ("Hosts' payout reports will update once the
   refunds go through").
6. The attachment and the ask: "I've attached a CSV with… Could you take a look and let us know
   if anything looks off? Once you're happy, we'll run the refunds."

Keep it to 150–300 words, and put long lists in a CSV.

### Hand-off / link round-up

One line saying who it's going to and why, then plain-text group labels — by state (merged / open / not started) when the reader is picking the work up, by date when they need the history — and bullets with one link each plus its state. End with what's missing or who to ask. `examples.md` § Handing work over.

### Asking a peer engineer to decide

Put the question first, then how it works today, the options with their trade-off, and the user's lean with the reason. `examples.md` § Asking a peer to decide.
Class, method and config names are fine here. The reader is an engineer.

### Security or risk summary for engineers

State the decision first ("Going to wait for <name> to weigh in further before we change
anything"), then why ("I think the surface area of this issue is nontrivial…"), then two plain
lists split by certainty ("We've confirmed…" / "We suspect… but couldn't confirm it without an
account"), then "More details in the attached doc".

## Community register (open-source reporters, contributors, users)

The teammate register, in public. Thank them once, answer their question, name the version, tell
them what to run, and keep internal context out. "Thanks for the detailed report! This is fixed in
0.7.1 — `hrefcheck self-update` should pick it up. Lmk if you still see the loop." A contributor's
PR gets credit by handle in the reply and the changelog. `examples.md` § Community.

## Partner register

External partners (a vendor's support or engineering contact, an API provider, a data supplier)
get a more structured version of the same voice: the finding and its impact first, the exact
record and values, a control case, a numbered ask, and "Thanks!". No tags or greetings by
default. Their field names go in backticks. The full anatomy is in
[`partner-style.md`](partner-style.md).

## Formatting

- **Slack** paste-ready text is mrkdwn: `*bold*` (single asterisks), `` `code` ``, `•` or `-`
  bullets, ```` ``` ```` code blocks with no language tag. **No markdown tables and no `#`
  headings** — Slack shows them raw. Use bullets, or a monospace table inside a code block.
- **GitHub, email and most other venues** take standard Markdown (`**bold**`, `- ` bullets,
  fenced code with a language tag is fine). Tables render on GitHub; keep them small.
- Paragraph labels (*What happened:*) can be bold or plain. Plain text reads friendlier.
- **Links**: paste the URL. For PRs, `#104` next to the link reads best (GitHub links `#104`
  itself). Link the thread instead of re-explaining it.
- Attachments are pointed at in the text: "I've attached a CSV with one row per…", "(screenshot
  attached)".

## Pre-flight (every draft)

- [ ] Does it sound like the user (first person, plain, specific)? Read it aloud. If it sounds
      like a support macro or a report, rewrite it.
- [ ] Does it answer the person's actual question in the first line or two?
- [ ] Was every fact, number, id, PR state, version and date checked in this session (SKILL rule 2)?
- [ ] Is it in the reader's words: product words for teammates, their field names for partners,
      none of our class names?
- [ ] Is it the shortest shape that does the job (ack, status, fixed, explanation, hand-off)?
- [ ] Does it say what's still pending and what we need from them, if anything?
- [ ] Is the tagging right: the person being answered for teammates, nobody for partners unless
      the user says?
- [ ] Is the format right for the venue (mrkdwn for Slack, Markdown elsewhere), with no filler and
      at most one emoji?
