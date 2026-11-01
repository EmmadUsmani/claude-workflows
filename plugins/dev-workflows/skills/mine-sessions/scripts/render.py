#!/usr/bin/env python3
"""Render reports/NN.json into compact markdown group views for the cluster stage.

usage: render.py [--dir <workdir>] [--per-group 6] [--groups "G1=01,04,06;G2=02,03"]

<workdir> (default: cwd) holds reports/NN.json; views/G<n>.md is written beside it. By default
reports are split into groups of --per-group (5-7 is right). Pass --groups explicitly when a long
session was split across chunks: keep all [part i/N] slices of one session in the SAME group
(chunks/plan.json shows which chunks hold which session)."""
import json, os, sys, glob
args = sys.argv[1:]
base = os.path.abspath(args[args.index("--dir") + 1]) if "--dir" in args else os.getcwd()
if "--groups" in args:
    GROUPS = {g.split("=")[0]: g.split("=")[1].split(",") for g in args[args.index("--groups") + 1].split(";")}
else:
    per = int(args[args.index("--per-group") + 1]) if "--per-group" in args else 6
    nums = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(base, "reports", "*.json")) if os.path.basename(p)[:2].isdigit())
    GROUPS = {f"G{i // per + 1}": nums[i:i + per] for i in range(0, len(nums), per)}
os.makedirs(os.path.join(base, "views"), exist_ok=True)

def li(items, key=None, n=None):
    out = []
    for it in (items or [])[: n or len(items or [])]:
        out.append(f"  - {it if key is None else it.get(key, '')}")
    return "\n".join(out)

def render_report(r):
    L = [f"\n\n# REPORT {r['chunk']}  (file reports/{r['chunk'].replace('.md', '.json')})\n"]
    L.append("## Sessions")
    for s in r.get("sessions", []):
        L.append(f"- **{s.get('id')}** — {s.get('title','')} ({s.get('date','')}) [{', '.join(s.get('task_types', []))}]\n  {s.get('summary','')}")
    L.append("\n## Workflows")
    for w in r.get("workflows", []):
        L.append(f"\n### {w.get('name')}  (worth {w.get('skill_worthiness')}; overlap: {w.get('existing_skill_overlap','none')})")
        L.append(f"- goal: {w.get('goal')}")
        L.append(f"- why: {w.get('worthiness_reason','')}")
        if w.get("trigger_examples"):
            L.append("- triggers: " + " | ".join(f"“{t}”" for t in w["trigger_examples"][:4]))
        L.append("- steps:\n" + li(w.get("steps")))
        if w.get("tools"):
            L.append("- tools: " + ", ".join(w["tools"]))
        if w.get("domain_facts_needed"):
            L.append("- domain facts needed:\n" + li(w["domain_facts_needed"]))
        if w.get("gotchas"):
            L.append("- gotchas:\n" + li(w["gotchas"]))
        occ = w.get("occurrences", [])
        L.append("- occurrences: " + "; ".join(f"{o.get('session')}@{o.get('time','')} {('— ' + o.get('note','')) if o.get('note') else ''}".strip() for o in occ))
    L.append("\n## User corrections")
    for c in r.get("user_corrections", []):
        L.append(f"- [{c.get('session')}@{c.get('time','')}] “{c.get('quote')}” — context: {c.get('context','')} → RULE: {c.get('rule')}")
    if r.get("automation_wishes"):
        L.append("\n## Automation wishes")
        for a in r["automation_wishes"]:
            L.append(f"- [{a.get('session')}@{a.get('time','')}] “{a.get('quote')}”")
    L.append("\n## Domain knowledge")
    for d in r.get("domain_knowledge", []):
        L.append(f"- **{d.get('topic')}**: {d.get('fact')} (where: {d.get('where','?')}; {d.get('session')})")
    L.append("\n## Gotchas")
    for g in r.get("gotchas", []):
        L.append(f"- {g.get('symptom')} ⇐ {g.get('cause')} ⇒ FIX: {g.get('fix')} ({g.get('session')})")
    if r.get("existing_skill_feedback"):
        L.append("\n## Existing-skill feedback")
        for e in r["existing_skill_feedback"]:
            L.append(f"- {e.get('skill')}: {e.get('observation')} ({e.get('session')})")
    if r.get("tools_used"):
        L.append("\n## Tools used")
        L.append(", ".join(f"{t.get('tool')} ({t.get('purpose','')}, ~{t.get('count_estimate','?')})" for t in r["tools_used"]))
    return "\n".join(L)

total = 0
for g, nums in GROUPS.items():
    parts = []
    for n in nums:
        p = os.path.join(base, "reports", f"{n}.json")
        if not os.path.exists(p):
            print("MISSING", p); continue
        parts.append(render_report(json.load(open(p))))
    out = os.path.join(base, "views", f"{g}.md")
    txt = f"# Group {g}: reports {', '.join(nums)}\n" + "".join(parts)
    open(out, "w").write(txt)
    total += len(txt.encode())
    print(f"{g}: {len(txt.encode())//1024}KB  reports {nums}")
print("total", total // 1024, "KB")
