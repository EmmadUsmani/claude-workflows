#!/usr/bin/env node
'use strict';

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log("usage: node xref.js <skills dir> [--external name,name,...] [--json]");
  process.exit(0);
}

// Cross-reference audit for a skills directory.
//
// For every skills/<name>/SKILL.md (+ REFERENCE.md): which sibling skills it names (out-links),
// which skills name it (in-links), dangling names (looks like a skill reference but no such
// skill exists locally or in the known external list), and skills nobody links to.
//
// usage: xref.js <skills dir> [--external name,name,...] [--json]

const fs = require('fs');
const path = require('path');
const { len, sorted, dumps, readText, globDir, Counter } = require('./lib');

const argv = process.argv.slice(1); // like sys.argv
const skillsDir = argv[1];
if (!skillsDir) {
  console.error("usage: node xref.js <skills dir> [--external name,name,...] [--json]");
  process.exit(1);
}
const external = new Set(argv.includes('--external') ? argv[argv.indexOf('--external') + 1].split(',') : []);
for (const s of [ // commonly-installed skills / built-ins that are legitimate targets
  'code-review', 'simplify', 'security-review', 'artifact-design', 'artifact-diagramming',
  'artifact-capabilities', 'update-config', 'loop', 'schedule', 'run', 'init', 'design',
  'dataviz', 'claude-api', 'claude-in-chrome', 'keybindings-help', 'fewer-permission-prompts',
]) external.add(s);
// skill names, sorted so every listing below is deterministic
const local = sorted(globDir(skillsDir).filter((d) => fs.existsSync(path.join(d, 'SKILL.md'))).map((d) => path.basename(d)));
const known = new Set([...local, ...external]);

const W = '[\\p{L}\\p{N}_]'; // Python's Unicode \w
// a reference is `/name`, `**name**`, `` `name` `` or "the name skill" where name is a known skill
const pat = new RegExp(`(?<!${W}|-)(?:/|\\*\\*|\`)?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\\*\\*|\`)?(?!${W}|-)`, 'gu');
const ENDINGS = ['-pr', '-review', '-doc', '-tool', '-script', '-intake', '-doctor', '-surgery', '-team', '-app', '-probe', '-debug', '-explainer', '-style', '-sessions', '-create', '-server', '-stack', '-work', '-loop', '-data', '-update', '-video', '-graph'];
const out = new Map();
const mentions = new Counter();
const dangling = new Map();
for (const s of local) {
  let text = '';
  for (const f of ['SKILL.md', 'REFERENCE.md']) {
    const p = path.join(skillsDir, s, f);
    if (fs.existsSync(p)) text += readText(p);
  }
  // drop the skill's own frontmatter name line
  text = text.replace(/(?<=^|\n)name:[^\n]*/g, '');
  const refs = new Set();
  for (const m of text.matchAll(pat)) {
    const name = m[1];
    if (name === s) continue;
    if (known.has(name)) {
      refs.add(name);
    } else if (new RegExp(`(?:/|the )${name}(?: skill|(?!${W}))`, 'u').test(text) && name.includes('-') && ENDINGS.some((e) => name.endsWith(e))) {
      if (!dangling.has(s)) dangling.set(s, new Set());
      dangling.get(s).add(name);
    }
  }
  out.set(s, refs);
  for (const r of refs) mentions.add(r);
}

const inLinks = new Map(local.map((s) => [s, sorted([...out].filter(([, refs]) => refs.has(s)).map(([t]) => t))]));
if (argv.includes('--json')) {
  const obj = (m, f) => new Map([...m].map(([k, v]) => [k, f(v)]));
  console.log(dumps(new Map([['out', obj(out, sorted)], ['in', inLinks], ['dangling', obj(dangling, sorted)]]), { indent: 1 }));
  process.exit(0);
}

if (!local.length) {
  process.stderr.write('ValueError: max() arg is an empty sequence\n');
  process.exit(1);
}
const w = Math.max(...local.map(len));
const pad = (s) => s + ' '.repeat(Math.max(0, w - len(s)));
console.log(`${pad('skill')}  in  out  → out-links (local | external)`);
for (const s of [...local].sort((a, b) => inLinks.get(b).length - inLinks.get(a).length)) {
  const loc = sorted([...out.get(s)].filter((r) => local.includes(r)));
  const ext = sorted([...out.get(s)].filter((r) => !local.includes(r)));
  console.log(`${pad(s)}  ${String(inLinks.get(s).length).padStart(2)}  ${String(out.get(s).size).padStart(3)}  → ${loc.join(', ')}${ext.length ? ' | ' + ext.join(', ') : ''}`);
}
const orphans = local.filter((s) => !inLinks.get(s).length);
console.log('\nno in-links:', orphans.join(', ') || 'none');
if (dangling.size) {
  console.log('\nPOSSIBLY dangling references (heuristic — hyphenated words that look like skill names but match no skill; expect false positives like self-review):');
  for (const s of sorted(dangling.keys())) console.log(`  ${s}: ${sorted(dangling.get(s)).join(', ')}`);
} else {
  console.log('\nno dangling references');
}
