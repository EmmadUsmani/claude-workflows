#!/usr/bin/env python3
"""Cross-reference audit for a skills directory.

For every skills/<name>/SKILL.md (+ REFERENCE.md): which sibling skills it names (out-links),
which skills name it (in-links), dangling names (looks like a skill reference but no such
skill exists locally or in the known external list), and skills nobody links to.

usage: xref.py <skills dir> [--external name,name,...] [--json]
"""
import os, re, sys, glob, json, collections

skills_dir = sys.argv[1]
external = set()
if "--external" in sys.argv:
    external = set(sys.argv[sys.argv.index("--external") + 1].split(","))
external |= {  # commonly-installed skills / built-ins that are legitimate targets
    "code-review", "simplify", "security-review", "artifact-design", "artifact-diagramming",
    "artifact-capabilities", "update-config", "loop", "schedule", "run", "init", "design",
    "dataviz", "claude-api", "claude-in-chrome", "keybindings-help", "fewer-permission-prompts",
}
local = {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(skills_dir, "*", "SKILL.md"))}
known = local | external

# a reference is `/name`, `**name**`, `` `name` `` or "the name skill" where name is a known skill
pat = re.compile(r"(?<![\w-])(?:/|\*\*|`)?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\*\*|`)?(?![\w-])")
out = {}
mentions = collections.Counter()
dangling = collections.defaultdict(set)
for s in sorted(local):
    text = ""
    for f in ("SKILL.md", "REFERENCE.md"):
        p = os.path.join(skills_dir, s, f)
        if os.path.exists(p):
            text += open(p).read()
    # drop the skill's own frontmatter name line
    text = re.sub(r"^name:.*$", "", text, flags=re.M)
    refs = set()
    for m in pat.finditer(text):
        name = m.group(1)
        if name == s:
            continue
        if name in known:
            refs.add(name)
        elif re.search(r"(?:/|the )" + re.escape(name) + r"(?: skill|\b)", text) and name.count("-") >= 1 and name.endswith(("-pr", "-review", "-doc", "-tool", "-script", "-intake", "-doctor", "-surgery", "-team", "-app", "-probe", "-debug", "-explainer", "-style", "-sessions", "-create", "-server", "-stack", "-work", "-loop", "-data", "-update", "-video", "-graph")):
            dangling[s].add(name)
    out[s] = refs
    for r in refs:
        mentions[r] += 1

in_links = {s: sorted(t for t, refs in out.items() if s in refs) for s in local}
if "--json" in sys.argv:
    print(json.dumps({"out": {k: sorted(v) for k, v in out.items()}, "in": in_links, "dangling": {k: sorted(v) for k, v in dangling.items()}}, indent=1))
    sys.exit()

w = max(len(s) for s in local)
print(f"{'skill':<{w}}  in  out  → out-links (local | external)")
for s in sorted(local, key=lambda s: -len(in_links[s])):
    loc = sorted(r for r in out[s] if r in local)
    ext = sorted(r for r in out[s] if r not in local)
    print(f"{s:<{w}}  {len(in_links[s]):2d}  {len(out[s]):3d}  → {', '.join(loc)}{' | ' + ', '.join(ext) if ext else ''}")
orphans = [s for s in local if not in_links[s]]
print("\nno in-links:", ", ".join(orphans) or "none")
if dangling:
    print("\nPOSSIBLY dangling references (heuristic — hyphenated words that look like skill names but match no skill; expect false positives like self-review):")
    for s, names in sorted(dangling.items()):
        print(f"  {s}: {', '.join(sorted(names))}")
else:
    print("\nno dangling references")
