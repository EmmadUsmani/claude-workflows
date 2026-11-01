#!/usr/bin/env python3
"""Group digests into agent-sized work units (~TARGET bytes each).
Big digests are split at user-turn boundaries; small ones are batched together.
Writes chunks/<NN>.md plus chunks/plan.json."""
import json, os, sys, re

TARGET = int(sys.argv[3]) if len(sys.argv) > 3 else 230_000
HARD = int(TARGET * 1.15)
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
index = json.load(open(os.path.join(src, "index.json")))
# Keep small sessions (a short session can carry the one correction that matters): they simply
# bin-pack together. Only sessions with no user prompt at all carry nothing to mine; drop and say so.
dropped = [m["digest"] for m in index if m.get("user_prompts", 1) == 0]
index = [m for m in index if m.get("user_prompts", 1) > 0]
if dropped:
    print(f"WARNING: dropped {len(dropped)} digest(s) with zero user prompts: {', '.join(dropped[:8])}{' …' if len(dropped) > 8 else ''}", file=sys.stderr)
tiny = [m["digest"] for m in index if m["digest_bytes"] < 1500]
if tiny:
    print(f"note: {len(tiny)} very small digest(s) kept and merged into shared chunks: {', '.join(tiny[:8])}{' …' if len(tiny) > 8 else ''}")

units = []  # list of (label, text)
for m in sorted(index, key=lambda m: -m["digest_bytes"]):
    text = open(os.path.join(src, m["digest"])).read()
    header_end = text.find("## Transcript (distilled)")
    header = text[:header_end]
    body = text[header_end:]
    if len(text.encode()) <= HARD:
        units.append((m["digest"], text))
        continue
    # split body at user-turn boundaries
    turns = re.split(r"(?=\n### \[)", body)
    parts, cur = [], ""
    for t in turns:
        if len((cur + t).encode()) > TARGET and cur:
            parts.append(cur); cur = t
        else:
            cur += t
    if cur:
        parts.append(cur)
    for i, p in enumerate(parts, 1):
        note = f"\n> NOTE: this is PART {i} of {len(parts)} of a long session (split at user-turn boundaries; earlier/later parts are read by other agents).\n\n"
        units.append((f"{m['digest']} [part {i}/{len(parts)}]", header + note + p))

# bin-pack: big units alone, small ones grouped (first-fit decreasing)
units.sort(key=lambda u: -len(u[1].encode()))
bins = []
for label, text in units:
    size = len(text.encode())
    for b in bins:
        if b["size"] + size <= TARGET:
            b["items"].append((label, text)); b["size"] += size; break
    else:
        bins.append({"items": [(label, text)], "size": size})

plan = []
for i, b in enumerate(bins, 1):
    name = f"{i:02d}.md"
    with open(os.path.join(out, name), "w") as fh:
        for label, text in b["items"]:
            fh.write(f"\n\n<!-- ===== DIGEST: {label} ===== -->\n\n")
            fh.write(text)
    plan.append({"chunk": name, "bytes": b["size"], "sessions": [l for l, _ in b["items"]]})
json.dump(plan, open(os.path.join(out, "plan.json"), "w"), indent=1)
print(f"{len(units)} units → {len(bins)} chunks (target {TARGET//1000}KB)")
for p in plan:
    print(f"  {p['chunk']}  {p['bytes']//1024:4d}KB  {len(p['sessions'])} unit(s): {', '.join(s[:48] for s in p['sessions'][:4])}{' …' if len(p['sessions'])>4 else ''}")
