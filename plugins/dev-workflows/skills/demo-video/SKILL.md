---
name: demo-video
description: Make an edited, narrated, high-production demo video of a feature, PR or branch with the narrated demo-video engine at `<demo_engine>` (default `~/projects/demo-reel`) — real footage of the running app, camera moves, callouts and a synthesized voiceover, rendered to MP4. Runs locally by default; dispatches to `<cloud_agent>` only when one is set and the user asks. Starts immediately; "show me the script/storyboard first" means draft the treatment and wait. Use for "make an edited demo video of this PR", "a narrated 30-second video of the export flow for the launch", "a polished demo reel of this branch", "a demo video with a voiceover", or any video meant for an audience beyond the PR's reviewers (users, a launch, the team). NOT for a plain screen recording — "add a recording to the PR", "record a demo", "show it working", "a GIF for the reviewers", or an unqualified "demo video of my PR"; those are ordinary PR recordings (ship-pr, verify-in-app). When it's unclear which is meant, it's the recording.
argument-hint: "[PR number | branch | feature] [--cloud] [--show-prompt | --script-first] [--audience <who>] [--length <secs>]"
---

# Edited demo videos with the demo engine

`<demo_engine>` (default `~/projects/demo-reel`) is the engine for produced demo videos made from
real footage of a running web app. **The engine owns the video itself** — its `README.md`,
`CLAUDE.md` and `docs/WORKFLOW.md` are the procedure (brief → treatment → app state → capture →
scenes → checks → narration → render → deliver, with a checklist), and they win over this file.
Read them; don't restate them here or in prompts. This skill owns only what the engine can't:
**whether** a request is a produced video, **where** it runs, **how** it's started or dispatched,
and **how the result reaches the user**.

Settings: `<demo_engine>`, `<dev_url>`, `<cloud_agent>`, `<cloud_env>`.

## Step 0: is this a demo video or just a recording?

**Decide by what the request asks for, not by the words "demo video".**

| The ask | What it is | Route |
|---|---|---|
| "demo video of my PR", "record a demo", "show it working", "add a recording to the PR", "a GIF/video for the reviewers", QA before/after recordings | **Screen recording** (the default) | **Not this skill.** **ship-pr** / **verify-in-app** evidence locally, or **cloud-agent-work** `--record` / `--qa`, made however the agent normally would. Simple editing is welcome. |
| "**edited**", "**polished**", "**narrated**" / "**with a voiceover**", "a **reel**", a **produced** demo video, an audience beyond the PR's reviewers (users, a launch, the team), or it names the engine | **Edited demo video** | **This skill.** |
| Ambiguous | Screen recording | Make (or dispatch) the recording, and say in the report that a produced version can be made on request. |

When the request goes to a cloud agent, the word **edited** (or narrated, polished, reel) is
load-bearing: without it an agent reasonably makes a plain screen recording and never touches the
engine.

## Hard rules

1. **Local by default.** Run the engine on this machine. Use `<cloud_agent>` only when it is set
   (not `none`), its `<cloud_env>` has the engine repo available, and the user asked for the cloud
   run (`--cloud`, "do it in the cloud"). If the video needs a service the cloud environment
   lacks, say so before dispatching and let the user pick the runtime; don't switch on your own.
2. **Start immediately by default.** `/demo-video …`, or any request that lands in the "edited
   demo video" row above, *is* the go-ahead. Only `--show-prompt` and `--script-first` stop for
   the user (*Gates*).
3. **The engine's own rules are hard rules here too.** In particular: every pixel of UI is real
   footage, never mocked or redrawn; a render you didn't open is unverified; a narration line that
   overruns its beat means a shorter line or a longer beat, never a forced mix.
4. **Honesty.** The narration and labels claim only what the footage shows. Anything behind a
   flag, not yet merged, sped up, or faked for the take (seeded data, a stubbed third party,
   something hidden for filming) is said on screen, in the narration, or in the report.
5. **Never film real customer data, secrets or credentials.** Seed plausible, made-up records with
   the app's own seed tooling, or film a public demo instance; sign in as a demo account.
6. **Delivery is a link or a path, never a GIF.** Locally: the MP4's absolute path (and an
   Artifact or upload only if the user asks). From the cloud: the agent's hosted artifact link
   and/or a release URL. No GIF conversion, and no MP4 pushed to an assets branch.
7. **Never merge, approve or request reviewers** on the engine's PR (if a run opens one). Posting
   the video anywhere beyond the report waits for the user.
8. **Shared local state is never reclaimed** — the dev server on `<dev_url>`, the main checkouts,
   the browser profile. Film a worktree's own server instead (*Local*, step 3).

## Gates

| The user says | Do |
|---|---|
| Nothing special (the default) | **Start.** Locally: run the engine's workflow and report the MP4. Cloud: dispatch, reply with the task URL, model/effort and a one-line summary, and arm the watch in the same turn. |
| "Show me the prompt first" (`--show-prompt`) | Cloud: draft the full dispatch call, show it, and **wait**; dispatch, with their edits, only on their go-ahead. Locally there is no prompt — treat it as `--script-first`. |
| "Show me the script / storyboard first" (`--script-first`) | Write the **treatment** (the engine's workflow, step 1) and stop. Locally: show it and wait. Cloud: dispatch with the script-first line appended, relay the treatment when the task stops, and wait. Their notes or go-ahead go back as one follow-up: *"Apply these notes to the treatment, then continue from capture to delivery."* |

---

## Local (default)

1. **Check the engine is there.** `test -f <demo_engine>/docs/WORKFLOW.md` and
   `command -v bun ffmpeg` (plus the browser the engine's README names). Missing engine ⇒ stop and
   say so (point at the `demo_engine` setting); don't improvise a pipeline. Missing tools ⇒ name
   them and stop.
2. **Work in a worktree of the engine, not its main checkout** — another session may be using it:
   `git -C <demo_engine> worktree add ../<engine-dir>-<edit> -b video/<edit>` off its default
   branch. A new worktree needs **its own dependency install** (`bun install` — dependencies are
   gitignored, not shared), and it carries committed footage *manifests* but not the gitignored
   plates, so an existing edit won't preview or render there until it is re-captured.
3. **Run the app you'll film** on the build you're demoing. A branch or PR: its own worktree and
   its own dev server (**worktree-create**, **worktree-dev-server**; **dev-doctor** if it won't
   boot) — never the shared one on `<dev_url>`. A public site can be filmed directly.
4. **Always set `BASE_URL`** to that server for every engine command that touches the app —
   capture scripts *and* the page-exploration tool. Unset, they fall back to a default local port,
   which is likely the shared dev server you must not drive.
5. **Follow `<demo_engine>/docs/WORKFLOW.md` end to end**, gate by gate, including its checklist.
   Use an existing edit's treatment in `docs/edits/` as the worked example. Open every still, sheet
   and contact sheet it tells you to produce.
6. **Report** what the workflow's *Deliver* step names — the MP4's absolute path and length, the
   beats, every honesty note, anything you couldn't verify or left out — plus the worktree path.
   Commit on the `video/<edit>` branch what the engine's docs say to commit, and only if the user
   asked for a commit; the MP4 stays where the workflow puts it unless the user named a place.

---

## Cloud (`<cloud_agent>` set and asked for)

Follow **cloud-agent-work** for the shared mechanics: load the agent's tools, dispatch is not
idempotent, the reply carries the task URL, and the watch arms in the same turn. Video-specific
parameters: the environment that has the engine repo (and can run the app being filmed); the
strongest model at high effort passed explicitly (an agent's catalog default effort is often
lower); a dedicated project/folder for video tasks if the agent has one; `branch: <PR head>` when
filming an open PR saves a step; a task name like `Video: <subject>`.

**One line is enough** when the environment's agent instructions route edited videos to the
engine; otherwise add one sentence naming the engine repo and its `docs/WORKFLOW.md`:

```
Make an edited, narrated demo video of <PR #n | the branch `x` | <feature>, which is already live>.
[For <audience>. About <n> seconds.]                <- only what the user specified; the engine has defaults
[Honesty: <behind flag X / anything the PR state doesn't show>.]
[When it's done, comment the video link on PR #n.]  <- only if the user asked
If the video goes into any PR description, use only the hosted video link — no GIF, no MP4 file.
```

`--script-first` appends — the task **ends its turn** rather than asking, because questions to a
cloud agent can expire unanswered:

```
Script first: stop once the treatment is written and pushed on video/<edit>. Put it in full in
your final message and end your turn. Don't capture until a follow-up says go ahead. Don't ask a
question; just stop.
```

**Watch** per cloud-agent-work §5, with these differences:

- **The PR being watched is the engine repo's**, the task's own PR on `video/<edit>`. Every Phase B
  `gh` call needs `--repo <engine owner>/<engine repo>`. The subject PR isn't the task's, so don't
  watch it.
- **Never merge it.** The watch doesn't wait for the merge; it stops once the PR settles.
- **At the `--script-first` stop there is no PR yet.** Relay the treatment; the task is now
  blocked on the user, which is settled, so the watch stops. Sending their notes re-arms it.
- **The latest message may not be the video report** — opening the PR can trigger an automatic
  review-fix turn that ends with "nothing to do". Search the task's assistant messages for the
  artifact link (Niteshift: `read_task_messages {kinds: ["assistant"], grep: "artifact"}`) to find
  the real report.

**Verify, then report:** open the artifacts the task published before calling it done, and hold
them to the engine's checklist. Relay the artifact link (the thing the user clicks), the release
and engine-PR URLs, and the task's summary: length, beats, the calls it made, honesty notes,
anything it couldn't film — plus any side findings about the subject PR, which are often real
bugs. State plainly that the engine PR is **open, not merged**. Changes to a finished video go to
the same task as one follow-up, per the workflow's *Iterating on feedback*.

---

## How this composes

- **cloud-agent-work** owns the cloud mechanics (dispatch, the watch that stops once settled,
  follow-ups) and routes edited videos here.
- **ship-pr** / **verify-in-app** / cloud-agent-work `--record` own a PR's verification
  recording. A produced reel of the same change is a separate run of this skill.
- **worktree-create** / **worktree-dev-server** / **dev-doctor** provide the app to film locally.
- **agent-team**: several videos at once — one agent (or one cloud task) per video, each in its
  own engine worktree.
