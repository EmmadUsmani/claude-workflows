---
name: slack-message
description: 'Draft the messages the user posts about technical work, in their voice, with every fact verified, and see them through: replies to teammates who raised an issue (ack, "it should be fixed now", a plain-language explanation, a hand-off round-up, a decision to ask for), replies to open-source reporters and contributors, and issue reports to external partners (a vendor, API provider or data supplier). **partner** mode adds the full report process: read the shared venue for settled topics, re-verify live, one standalone thread per issue, paste-ready file, reconcile what was posted, verify every partner reply. Drafts only; never sends. Use for "draft a reply explaining what happened", "reply that it''s fixed", "write up everything so far for the hand-off", "draft concise messages to the API provider explaining the issue", "one thread per issue", "they replied — verify their claims", "/slack-message". NOT for the periodic status post (status-update) or PR review comments (pr-triage, deep-pr-review).'
argument-hint: "[--mode teammate|community|partner] <who/where: person, channel, thread or issue link> [what to say: findings, sandbox dir, or 'from this conversation']"
---

# Chat message: findings → a message the user would write

The user posts a lot of technical messages: answering the teammate who raised an issue, saying
it's fixed, explaining a root cause to someone non-technical, handing work off, replying to
people who reported a bug in their open-source project, and reporting data or API problems to
external partners. This skill drafts those messages in their voice. The facts are checked before
they're stated, the shape fits the reader, and nothing is sent without them.

Written for Slack (`<chat>: slack`, the default). The voice, shapes and verification carry to any
venue; what changes elsewhere is the read/draft tool calls (Steps 2, 6, 7) **and the formatting**:
Slack takes mrkdwn (`*bold*`, `•`), while GitHub, most other chat tools and email take standard
Markdown or plain text — draft in whatever the destination renders.

- **The user's voice** (all registers): [`references/voice.md`](references/voice.md). **Read it before drafting anything.**
  If the user has their own posted messages to learn from, read a few of those too — theirs win.
- **Annotated example messages:** [`references/examples.md`](references/examples.md).
- **Partner mode** (process, verification, follow-through): [`references/partner.md`](references/partner.md), with
  its message anatomy in [`references/partner-style.md`](references/partner-style.md) and lookup patterns in
  [`references/queries.md`](references/queries.md).

## Hard rules (every mode)

1. **Never send.** Draft in the terminal or a file. Create a chat draft
   (`slack_send_message_draft`) only when the user asks, in the channel or thread they named.
   Never post an issue or PR comment, an email or a forum reply yourself. Approval of the wording
   is not permission to create a draft. A go-ahead for one channel doesn't carry to another, and
   "hold off on X" holds until they lift it.
2. **Every stated fact is checked today** against its source of truth: the thread or issue itself,
   the code on `origin/main`, the release history, the warehouse (**warehouse-data**) if the
   project has one, the partner's API (**vendor-api-probe**), GitHub for PR state. A finding from
   earlier in the session is a lead until re-checked. A fact another skill or agent verified today
   can be used as handed in, with its source and time in the Facts ("bug-intake run, 14:20 UTC").
   When something can't be checked, the message says so plainly ("not confirmed yet"), or it's left out.
3. **Never cite an identifier from memory.** Every id, PR number, version, count, date and name is
   copied from a lookup made in this session.
4. **The reader's words.** A teammate outside engineering gets product words ("the RSVP page",
   "the settings page", "the export"). A partner gets their own field names. Nobody gets our class
   names, table names or internal tool names unless they're engineers who use them.
5. **One topic per message or thread.** Two problems for two audiences are two messages, each in
   its own mode (see Mixed asks).
6. **Posted is not drafted.** After the user posts, re-read what's actually there. They edit and
   combine. Reconcile it against what needed saying, and flag anything that's no longer covered.
7. **Sandbox writes auto-commit** (own paths only), per **sandbox-tool**'s Hard rules, when
   `<sandbox_autocommit>` is on.

## Step 1: pick the mode (and say it)

Decide from **who will read it** and **where it goes**, not from the topic. A message to a
teammate *about* a partner's API is a teammate message.

| Signal | Mode |
|---|---|
| Destination is a venue shared with another organization (Slack Connect, the partner's own workspace or forum, their support portal, an issue on their repo, email to their support), or the thread lives there | **partner** |
| The ask is for an external party to change their data, API, catalogue or config | **partner** |
| A reply to a partner's person in an existing thread | **partner**, reply shape |
| A public reply in the user's own open-source project: an issue reporter, a contributor, a user in the project's discussions, forum or community chat | **community** |
| Anything to people in the user's own org: a project channel, a support channel, a group DM, a reply to a teammate or their lead | **teammate** |
| Unclear destination, internal topic | **teammate** (the default) |

Open the first draft with one line: `Mode: partner (data issue, the shared channel with <partner>)`,
`Mode: community (reply on issue #76)` or `Mode: teammate (reply to <name> in the export thread)`.
`--mode` or a word from the user overrides it. When the evidence points to a partner's data but no
destination was given, draft the message they asked for and offer the partner one: "This is
<partner>'s data. Want a partner-mode thread for them too?" If the partner has already been
contacted, don't offer a new one. Point to it: link the thread if there is one, or say how it
went ("I've sent them a note asking them to fix those three") and ask the user for the link.

**community mode** uses the teammate register and shapes, plus:
- **It's public and permanent.** No internal links, teammate names, customer details or private
  context; nothing you wouldn't put in the changelog.
- **Thank the reporter or contributor first**, once ("Thanks for the detailed report!"), and credit
  a contributor's PR by handle.
- **Name versions, not branches.** "Fixed in 0.7.1" (or "merged, will ship in the next release")
  — never "fixed on main" to someone who installs from a package registry.
- **Close the loop on what they can do**: upgrade command, a workaround until the release, or
  what extra info would help ("could you share the output of `hrefcheck --debug`?").
- Standard Markdown (GitHub renders it); no Slack mrkdwn, no `@` of people who aren't in the
  thread.

**Mixed asks** ("tell the reporter, and get the partner to fix it") produce **two drafts, one per
mode**, in the order they'd be posted. Usually that's the status to the reporter first, with a
placeholder for the partner thread link, then the partner thread. The status says
whose data it is, how wide it goes, and that the partner thread is coming; the link follows in
a reply once it exists.

## Step 2: read the context

- The message being replied to, and its whole thread (`slack_read_thread`, `detailed`; for an
  issue, `gh issue view <n> --comments`). Who asked, what exactly they asked (the latest question,
  often "any eta?"), what's at stake for them (a customer, a deadline, a launch), what's already
  been said, and whether the user already promised something ("will pick this up after the
  import one"). Passing only `latest` to `slack_read_thread` returns no replies at all, so pass
  `oldest` (the parent ts) with it.
- For a new top-level message, the recent channel (`concise`) to see what's settled and what
  thread it belongs in.
- **No thread to read** (the user pasted the context, or the venue isn't connected): work from
  what they pasted, say so in the draft file's Facts ("thread context: pasted by the user"), and
  ask for anything the reply depends on that isn't there.
- **No message to reply to yet** (a heads-up before someone asks): find where that person last
  heard about it. Search chat for the feature, id or topic with them (`with:<@id>`), which could
  be a DM, a group DM or a channel thread. Propose that spot. If it's unclear, ask the user rather
  than guess.
- **partner mode:** follow `partner.md` Step 2. It's stricter: settled topics, open threads on the
  same issue, precedent answers.

## Step 3: gather and verify the facts

Go back to the investigation (this conversation, its sandbox dir, the PRs) and re-check each
claim the message will make (rule 2). Decide what the reader needs:

- **What happened, in one line**, and whether it's on our side or someone else's.
- **Scope**: who or what is affected, and how many ("23 events showed the wrong RSVP count"). A
  number makes it real. Only use one you just checked.
- **What's done, what's next, and when.** Use real states, from GitHub, the release history or
  the run's output: "merged", "fix is live", "running the backfill in batches" for a hosted app;
  for a library or package, **"released in <version>"** (check the tag/registry —
  `gh release list`, the package registry's API) — merged is not released.
- **What we need from them**, if anything: a decision, a confirmation, a retry, an upgrade.

When the topic involves a partner's data or API, read `partner.md` §Know which field you read
even in teammate mode. It's domain discipline (which of the partner's fields our code actually
consumes), not a register. Re-check anything from it that the message states.

Investigation output is shaped for engineers or partners (UUIDs, record ids, tables, numbered
asks). For a teammate or community reader, keep only what they need to act on, in their words.

**partner mode:** `partner.md` Step 3 adds the control case, the exact failing request, scale
sweeps, and the field-the-way-our-code-reads-it check.

## Step 4: draft in the right shape

Pick the shape from what the message has to do. All of these are in `voice.md` with examples.

| Purpose | Shape (teammate / community mode) | Length |
|---|---|---|
| Ack / on it | lowercase fragment, no period: "taking a look", "will take a look shortly" | 1 line |
| Heads-up before they ask | the item by name, where it stands in one line, why in plain words, what happens next and who's doing it | 2–4 lines |
| Status while investigating | what it looks like so far, whose side it seems to be on, and what's still unconfirmed | 1–3 lines |
| Fixed / done (hosted app) | tag them, what works now in their terms, what to retry, and an invitation to say if it doesn't | 1–2 lines |
| Fixed / released (library, CLI, package) | "This is fixed in 0.7.1, which just went out — `<upgrade command>` should pick it up. Lmk if you still see it" — or "merged, it'll be in the next release" when it isn't released yet | 1–2 lines |
| Scoping the result for the reporter | tag them, what's actually broken vs what's fine (in places they can check), what's being done, what it means for their customer or deadline | 3–6 lines, prose |
| Explanation for someone who raised it (a root cause, several outcomes, a decision for them) | tag them, confirm what they saw ("You were right: …"), then *What happened* / *What was affected* / *What we can do*, then one ask | 120–300 words |
| Hand-off / link round-up | who it's going to, plain-text group labels (by state or by date), one link per bullet with its state | as long as the links |
| Decision or honest capacity | the call first, the honest reason, and when (or whether) it comes back | 2–4 lines |
| Asking a peer engineer to decide | the context in one line (link the thread), how it works today with file or class names, the options and their trade-off, the question ("Wdyt?"); extras they didn't ask for are flagged as cuttable | 80–200 words |
| Deferring to someone | "I'll let <name> confirm since I'm not super familiar with …", then the best guess | 2–3 lines |

**partner mode:** use `partner-style.md`'s opening report, in-thread reply and follow-up shapes,
one thread per issue (`partner.md` Step 4, which also has the file template).

**Where it'll be posted**, when they didn't say: the thread or issue where the topic was last
discussed. Else, a DM for a question for one engineer that nobody else needs to see, or a thread
in the project channel when ops or others will care. Propose it in the Mode line; the user
decides.

**Where the draft goes:**
- A single message of a few lines, with no numbers or ids that need a record, is drafted in the
  terminal only.
- More than one message, partner mode, or anything stating counts, ids or dates goes in the
  investigation's sandbox dir as the next numbered file (`NN_message_<who>.md`, or
  `NN_<partner>_messages.md` in partner mode). It holds a Facts list (one bullet per fact: claim,
  source, check time), each message as a paste-ready ```` ````text ```` block in the destination's
  format, and Notes (tags, attachments, open questions). Commit it. A mixed ask keeps both drafts
  in one file, the reporter's first. With no investigation dir, create
  `<sandbox_dir>/adhoc/<today>-<slug>/` only if a file is needed. Otherwise the terminal is enough.

## Step 5: show, iterate

Show each draft as a blockquote with real formatting (code blocks outside the quote). Then list
the decisions the user has to make: who to tag, attachments, anything you couldn't verify, the
other mode's message if there is one. Then apply their feedback:

- **A wording note applies to every draft unless they scope it.** "Remove the Hi team" means from
  every message.
- **A content correction is a fact correction.** Fix it everywhere, Facts and Notes included, and
  re-check what relied on it.
- **"Not the shape of real messages"** means rebuild from `examples.md`, not padding.

## Step 6: chat drafts (only when asked)

Slack: `slack_send_message_draft` takes **standard markdown**, so convert from the paste-ready
mrkdwn: `*bold*` → `**bold**`, `•` → `- `, and a newline after an opening ```` ``` ````. Pass
`thread_ts` for a reply. A channel holds **one attached draft at a time**
(`attached_draft_exists`), so a series goes one draft at a time: wait for "sent", then draft the
next.

| Error | Meaning | Do |
|---|---|---|
| `not_in_channel` | The user isn't a member | Ask them to join; retry when they say so |
| `attached_draft_exists` | A draft is already in that channel | Ask them to send or delete it |
| `mcp_externally_shared_channel_restricted` | A send was attempted in a shared external channel | Rule 1. Make a draft instead |

Typed `@Name` text doesn't become a mention when pasted, so the user has to pick the person from
Slack's @ list. Say so when the draft tags someone.

Venues without a draft tool (GitHub issues, email, forums): the paste-ready block in the terminal
or draft file is the deliverable; the user posts it.

## Step 7: after they post, and replies

- Re-read the channel, thread or issue (rule 6). Note where it was posted in the draft file and
  update the investigation's status file.
- When someone replies, read it, check each claim or question against the facts, and draft the
  follow-up in the matching shape.
- **partner mode:** `partner.md` Step 7. Every partner claim is verified live, ask by ask, and
  followed through to our records before anything is called fixed.

## When not to use / hand off to

- The periodic status post → **status-update**.
- A question for a read-only production assistant (the `<ops_bot>`, if your team runs one) →
  **warehouse-data** owns that rung.
- Investigating the issue in the first place → **bug-intake** (this skill writes up its results).
- Proving what a partner's API does → **vendor-api-probe**.
- PR review comments and replies → **pr-triage** / **deep-pr-review**.
- Durable docs and write-ups → **research-doc**.
