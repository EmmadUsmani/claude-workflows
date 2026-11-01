#!/usr/bin/env python3
"""Distill a Claude Code session JSONL (main thread only) into a compact markdown digest.

Keeps: session metadata, every real user prompt, assistant text, one-line tool calls,
tool errors, slash commands / skills / agent spawns. Drops: thinking, tool results
(except errors), hook noise, file snapshots, queue ops, system-reminders.
"""
import json, os, re, sys, glob, collections

READ_ONLY = {"Read", "Grep", "Glob", "LS"}
MAX_USER = 3000
MAX_ASSIST = 1100
MAX_CMD = 180

def trunc(s, n, tail=0):
    s = s.strip()
    if len(s) <= n:
        return s
    if tail:
        return s[: n - tail] + f"\n…[{len(s) - n} chars elided]…\n" + s[-tail:]
    return s[:n] + f"…[+{len(s) - n} chars]"

def strip_noise(text):
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    text = re.sub(r"<task-notification>.*?</task-notification>", "[task-notification]", text, flags=re.S)
    text = re.sub(r"<local-command-caveat>.*?</local-command-caveat>", "", text, flags=re.S)
    return text.strip()

def user_text(content):
    """Return (kind, text). kind in {'prompt','command','skip'}"""
    if isinstance(content, str):
        parts = [content]
    else:
        parts = []
        for b in content:
            t = b.get("type")
            if t == "text":
                parts.append(b.get("text", ""))
            elif t == "image":
                parts.append("[image attached]")
            elif t == "tool_result":
                return "skip", ""
    text = strip_noise("\n".join(parts))
    if not text:
        return "skip", ""
    m = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if m:
        name = m.group(1).strip()
        args = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        args = args.group(1).strip() if args else ""
        out = re.search(r"<local-command-stdout>(.*?)</local-command-stdout>", text, re.S)
        out = (" → " + trunc(out.group(1), 160)) if out else ""
        return "command", f"{name} {args}".strip() + out
    if text.startswith("[Request interrupted"):
        return "command", "[user interrupted]"
    m = re.fullmatch(r"<local-command-stdout>(.*?)</local-command-stdout>", text, re.S)
    if m:
        return "command", "(cmd output) " + trunc(m.group(1), 120)
    return "prompt", text

def tool_line(b):
    name = b.get("name", "?")
    inp = b.get("input") or {}
    if name == "Bash":
        d = inp.get("description")
        cmd = trunc((inp.get("command") or "").replace("\n", " ⏎ "), MAX_CMD)
        return f"Bash: {cmd}" + (f"  # {d}" if d else "")
    if name in ("Read", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        return f"{name}: {inp.get('file_path') or inp.get('notebook_path')}"
    if name in ("Grep", "Glob"):
        return f"{name}: {inp.get('pattern')} in {inp.get('path') or '.'}"
    if name == "Agent":
        return f"Agent[{inp.get('subagent_type','')}]({inp.get('description','')}): {trunc(inp.get('prompt',''), 400)}"
    if name == "Skill":
        return f"Skill: /{inp.get('skill')} {inp.get('args','') or ''}".rstrip()
    if name == "Workflow":
        return f"Workflow: {inp.get('name') or trunc(inp.get('script',''), 200)}"
    if name == "AskUserQuestion":
        qs = inp.get("questions") or []
        return "AskUserQuestion: " + " | ".join(trunc(q.get("question", ""), 140) for q in qs)
    if name in ("SendMessage",):
        return f"SendMessage→{inp.get('to')}: {trunc(str(inp.get('message','')), 200)}"
    if name == "TodoWrite":
        todos = inp.get("todos") or []
        return "TodoWrite: " + "; ".join(trunc(t.get("content", ""), 80) for t in todos[:8])
    if name == "WebFetch":
        return f"WebFetch: {inp.get('url')}"
    if name == "WebSearch":
        return f"WebSearch: {inp.get('query')}"
    if name == "Artifact":
        return f"Artifact[{inp.get('action','publish')}]: {inp.get('file_path') or inp.get('url') or ''}"
    # MCP + everything else: name + compact json
    return f"{name}: {trunc(json.dumps(inp, ensure_ascii=False), 220)}"

def distill(path):
    sid = os.path.basename(path).replace(".jsonl", "")
    titles = []
    custom = None
    cwds = collections.Counter()
    branches = collections.OrderedDict()
    first_ts = last_ts = None
    events = []  # (ts, kind, payload)
    tool_names = collections.Counter()
    skills = collections.Counter()
    commands = collections.Counter()
    agents = 0
    n_user = 0
    n_assist = 0
    pending_tools = {}  # tool_use_id -> name
    errors = 0
    models = collections.Counter()

    with open(path, "rb") as fh:
        for raw in fh:
            try:
                o = json.loads(raw)
            except Exception:
                continue
            t = o.get("type")
            if t == "ai-title":
                if o.get("aiTitle") and o["aiTitle"] not in titles:
                    titles.append(o["aiTitle"])
                continue
            if t == "custom-title":
                custom = o.get("customTitle")
                continue
            if t == "summary":
                events.append((o.get("timestamp"), "summary", o.get("summary", "")))
                continue
            if t not in ("user", "assistant"):
                continue
            if o.get("isSidechain"):
                continue
            ts = o.get("timestamp")
            if ts:
                first_ts = first_ts or ts
                last_ts = ts
            if o.get("cwd"):
                cwds[o["cwd"]] += 1
            if o.get("gitBranch"):
                branches[o["gitBranch"]] = True
            msg = o.get("message") or {}
            content = msg.get("content")
            if t == "user":
                if o.get("isMeta"):
                    continue
                # tool errors
                if isinstance(content, list):
                    for b in content:
                        if b.get("type") == "tool_result" and b.get("is_error"):
                            c = b.get("content")
                            s = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                            tname = pending_tools.get(b.get("tool_use_id"), "tool")
                            events.append((ts, "error", f"{tname}: {trunc(strip_noise(s), 260)}"))
                            errors += 1
                kind, text = user_text(content)
                if kind == "prompt":
                    n_user += 1
                    events.append((ts, "user", trunc(text, MAX_USER, tail=400)))
                elif kind == "command":
                    cmd = text.split()[0] if text else ""
                    commands[cmd] += 1
                    events.append((ts, "command", trunc(text, 300)))
            else:  # assistant
                if msg.get("model"):
                    models[msg["model"]] += 1
                if not isinstance(content, list):
                    continue
                for b in content:
                    bt = b.get("type")
                    if bt == "text":
                        txt = b.get("text", "").strip()
                        if txt:
                            n_assist += 1
                            events.append((ts, "assistant", trunc(txt, MAX_ASSIST, tail=300)))
                    elif bt == "tool_use":
                        name = b.get("name", "?")
                        tool_names[name] += 1
                        pending_tools[b.get("id")] = name
                        if name == "Skill":
                            skills[(b.get("input") or {}).get("skill", "?")] += 1
                        if name == "Agent":
                            agents += 1
                        events.append((ts, "tool", (name, tool_line(b))))

    # collapse consecutive read-only tool calls
    out = []
    i = 0
    while i < len(events):
        ts, kind, payload = events[i]
        if kind == "tool" and payload[0] in READ_ONLY:
            j = i
            paths = []
            while j < len(events) and events[j][1] == "tool" and events[j][2][0] in READ_ONLY:
                paths.append(events[j][2][1])
                j += 1
            if len(paths) >= 4:
                shown = "; ".join(p.split(": ", 1)[-1] for p in paths[:6])
                out.append((ts, "tool", f"{len(paths)}× read-only lookups ({shown}{'; …' if len(paths) > 6 else ''})"))
            else:
                out.extend((events[k][0], "tool", events[k][2][1]) for k in range(i, j))
            i = j
        else:
            if kind == "tool":
                payload = payload[1]
            out.append((ts, kind, payload))
            i += 1

    proj = cwds.most_common(1)[0][0] if cwds else "?"
    def hm(ts):
        return (ts or "")[11:16]
    lines = []
    lines.append(f"# Session {sid}")
    lines.append(f"- project cwd: {proj}")
    if custom:
        lines.append(f"- custom title: {custom}")
    if titles:
        lines.append(f"- ai titles: {' | '.join(titles[:6])}")
    lines.append(f"- span: {(first_ts or '')[:16]} → {(last_ts or '')[:16]}")
    if branches:
        lines.append(f"- git branches: {', '.join(list(branches)[:8])}")
    lines.append(f"- counts: {n_user} user prompts, {n_assist} assistant texts, {sum(tool_names.values())} tool calls, {agents} subagents, {errors} tool errors")
    if models:
        lines.append(f"- models: {', '.join(f'{m}×{c}' for m, c in models.most_common(3))}")
    if tool_names:
        lines.append("- tools: " + ", ".join(f"{k}×{v}" for k, v in tool_names.most_common(14)))
    if commands:
        lines.append("- slash commands: " + ", ".join(f"{k}×{v}" for k, v in commands.most_common()))
    if skills:
        lines.append("- skills invoked: " + ", ".join(f"{k}×{v}" for k, v in skills.most_common()))
    lines.append("")
    lines.append("## Transcript (distilled)")
    for ts, kind, payload in out:
        if kind == "user":
            lines.append(f"\n### [{hm(ts)}] USER\n{payload}")
        elif kind == "command":
            lines.append(f"\n### [{hm(ts)}] USER /{payload.lstrip('/')}")
        elif kind == "assistant":
            lines.append(f"\n**ASSISTANT:** {payload}")
        elif kind == "tool":
            lines.append(f"  → {payload}")
        elif kind == "error":
            lines.append(f"  ✗ {payload}")
        elif kind == "summary":
            lines.append(f"\n> (compaction summary) {trunc(payload, 800)}")
    return "\n".join(lines) + "\n", {
        "session": sid, "project": proj, "custom_title": custom, "titles": titles[:6],
        "first": first_ts, "last": last_ts, "user_prompts": n_user, "tool_calls": sum(tool_names.values()),
        "subagents": agents, "errors": errors, "commands": dict(commands), "skills": dict(skills),
        "branches": list(branches)[:8],
    }

def main():
    """usage: distill.py <outdir> [--since YYYY-MM-DD] [--project <substring>] [--projects-dir <path>]

    --since   keep only sessions with activity on/after the date (compares the session's LAST
              timestamp, so a session that started earlier but continued past the date is kept).
              Pass the date of your previous sweep to mine only what is new.
    --project keep only sessions whose ~/.claude/projects/<dir> name contains the substring.
    --projects-dir  transcript root (default ~/.claude/projects; override for a test fixture
              or a copied archive).
    """
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        sys.exit(main.__doc__)
    outdir = args[0]
    since = args[args.index("--since") + 1] if "--since" in args else None
    project = args[args.index("--project") + 1] if "--project" in args else None
    root = args[args.index("--projects-dir") + 1] if "--projects-dir" in args else "~/.claude/projects"
    os.makedirs(outdir, exist_ok=True)
    index = []
    skipped = 0
    for path in sorted(glob.glob(os.path.join(os.path.expanduser(root), "*", "*.jsonl"))):
        proj_dir = os.path.basename(os.path.dirname(path))
        if project and project not in proj_dir:
            continue
        # project dirs are the cwd with "/" -> "-"; drop the home prefix to get a short label
        home = os.path.expanduser("~").replace("/", "-")
        short = proj_dir[len(home) + 1:] if proj_dir.startswith(home + "-") else proj_dir.lstrip("-")
        short = short[:40]  # keep digest file names short (cwds outside $HOME keep their full dashed path otherwise)
        short = short.replace("projects-", "", 1)
        md, meta = distill(path)
        if since and (not meta["last"] or meta["last"][:10] < since):
            skipped += 1
            continue
        meta["project_dir"] = proj_dir
        meta["raw_bytes"] = os.path.getsize(path)
        name = f"{short}__{meta['session'][:8]}.md"
        with open(os.path.join(outdir, name), "w") as fh:
            fh.write(md)
        meta["digest"] = name
        meta["digest_bytes"] = len(md.encode())
        index.append(meta)
    with open(os.path.join(outdir, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
    tot_raw = sum(m["raw_bytes"] for m in index)
    tot_dig = sum(m["digest_bytes"] for m in index)
    print(f"{len(index)} sessions; raw {tot_raw/1e6:.1f}MB → digests {tot_dig/1e6:.2f}MB ({tot_raw/max(tot_dig,1):.0f}× smaller)"
          + (f"; skipped {skipped} sessions with no activity since {since}" if since else ""))
    for m in sorted(index, key=lambda m: -m["digest_bytes"]):
        print(f"{m['digest_bytes']/1024:7.0f}KB  {m['user_prompts']:4d}p {m['tool_calls']:5d}t  {m['digest']}  {(m['custom_title'] or (m['titles'][0] if m['titles'] else ''))[:60]}")

if __name__ == "__main__":
    main()
