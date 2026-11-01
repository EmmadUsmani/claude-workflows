#!/usr/bin/env python3
"""Validate reports/*.json and build a compact cross-chunk aggregate for synthesis."""
import json, glob, os, sys, collections
# usage: aggregate.py [--dir <workdir>] [--expect N] [--names] [--merge]
# <workdir> (default: cwd) is the scratch dir holding reports/*.json; --expect N lists any of
# reports 01..N that are missing.
args = sys.argv[1:]
base = os.path.abspath(args[args.index("--dir") + 1]) if "--dir" in args else os.getcwd()
reports = sorted(p for p in glob.glob(os.path.join(base, "reports", "*.json")) if os.path.basename(p)[:2].isdigit())
ok, bad = [], []
for p in reports:
    try:
        r = json.load(open(p)); r["_file"] = os.path.basename(p); ok.append(r)
    except Exception as e:
        bad.append((os.path.basename(p), str(e)))
print(f"{len(ok)} valid reports, {len(bad)} invalid: {bad}")
n_expected = int(args[args.index("--expect") + 1]) if "--expect" in args else 0
expected = {f"{i:02d}.json" for i in range(1, n_expected + 1)}
missing = sorted(expected - {os.path.basename(p) for p in reports})
if missing:
    print("missing:", ", ".join(missing))

wf = collections.Counter(); corr = 0; facts = 0; wishes = 0; gotchas = 0
names = collections.Counter()
for r in ok:
    wf[r["_file"]] = len(r.get("workflows", []))
    corr += len(r.get("user_corrections", [])); facts += len(r.get("domain_knowledge", []))
    wishes += len(r.get("automation_wishes", [])); gotchas += len(r.get("gotchas", []))
    for w in r.get("workflows", []):
        names[w.get("name", "?")] += 1
print(f"workflows: {sum(wf.values())}  corrections: {corr}  domain facts: {facts}  wishes: {wishes}  gotchas: {gotchas}")
print("total report bytes:", sum(os.path.getsize(p) for p in reports))
if "--names" in args:
    for n, c in names.most_common():
        print(f"  {c}× {n}")
if "--merge" in args:
    # single merged file for synthesizers
    merged = {"reports": ok}
    out = os.path.join(base, "ALL_REPORTS.json")
    json.dump(merged, open(out, "w"), indent=1)
    print("wrote", out, os.path.getsize(out), "bytes")
