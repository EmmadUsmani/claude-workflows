#!/usr/bin/env python3
"""Build a compact "user turns only" view from distilled digests, for targeted mining lenses
(code-style corrections, communication preferences, …) where the user's own words carry the
signal and the full tool trace is noise.

For every USER turn keep: the tail of the assistant text that preceded it (what the user is
reacting to, truncated), then the user's prompt in full (as distilled). Drops tool lines,
errors, slash commands. Typically ~10× smaller than the digests.

usage: userturns.py <digests dir> <out dir> [--context 500]
"""
import os, re, sys, glob

src, out = sys.argv[1], sys.argv[2]
ctx = int(sys.argv[sys.argv.index("--context") + 1]) if "--context" in sys.argv else 500
os.makedirs(out, exist_ok=True)

total = 0
index = []  # chunk.py-compatible index so the user-turn view can be chunked the same way
for path in sorted(glob.glob(os.path.join(src, "*.md"))):
    text = open(path).read()
    head, _, body = text.partition("## Transcript (distilled)")
    header = "\n".join(l for l in head.splitlines() if l.startswith("# ") or l.startswith("- custom title") or l.startswith("- ai titles") or l.startswith("- span") or l.startswith("- project"))
    blocks = re.split(r"\n(?=### \[\d\d:\d\d\] USER)", body)
    turns = []
    last_assistant = ""
    for b in blocks:
        m = re.match(r"### \[(\d\d:\d\d)\] USER(?: (/\S.*))?\n?(.*)", b, re.S)
        if not m:
            # leading chunk before the first user turn: capture any assistant text
            a = re.findall(r"\*\*ASSISTANT:\*\* (.*)", b)
            if a:
                last_assistant = a[-1]
            continue
        hm, cmd, rest = m.group(1), m.group(2), m.group(3)
        # split the user's prompt from the assistant/tool lines that follow it
        parts = re.split(r"\n(?=\*\*ASSISTANT:\*\*|  → |  ✗ |> \(compaction)", rest, maxsplit=1)
        prompt = parts[0].strip()
        following = parts[1] if len(parts) > 1 else ""
        if cmd is None and prompt and prompt != "[task-notification]":
            ctx_text = last_assistant.strip()
            if len(ctx_text) > ctx:
                ctx_text = "…" + ctx_text[-ctx:]
            turns.append(f"\n### [{hm}] USER\n" + (f"> (Claude had just said) {ctx_text}\n\n" if ctx_text else "") + prompt)
        a = re.findall(r"\*\*ASSISTANT:\*\* (.*)", following)
        if a:
            last_assistant = a[-1]
    if not turns:
        continue
    name = os.path.basename(path)
    result = header + f"\n- user turns: {len(turns)}\n" + "\n".join(turns) + "\n"
    open(os.path.join(out, name), "w").write(result)
    total += len(result.encode())
    index.append({"digest": name, "digest_bytes": len(result.encode()), "user_prompts": len(turns)})
    print(f"{len(result.encode())//1024:5d}KB {len(turns):4d} turns  {name}")
import json
json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
print(f"total {total/1e6:.2f}MB across {len(index)} sessions with user turns")
