#!/usr/bin/env node
'use strict';

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log("usage: node render.js [--dir <workdir>] [--per-group 6] [--groups \"G1=01,04,06;G2=02,03\"]");
  process.exit(0);
}

// Render reports/NN.json into compact markdown group views for the cluster stage.
//
// usage: render.js [--dir <workdir>] [--per-group 6] [--groups "G1=01,04,06;G2=02,03"]
//
// <workdir> (default: cwd) holds reports/NN.json; views/G<n>.md is written beside it. By default
// reports are split into groups of --per-group (5-7 is right). Pass --groups explicitly when a long
// session was split across chunks: keep all [part i/N] slices of one session in the SAME group
// (chunks/plan.json shows which chunks hold which session).

const fs = require('fs');
const path = require('path');
const { strip, bytes, sorted, repr, str, truthy, get, int, readText, globDir, join } = require('./lib');

const args = process.argv.slice(2);
const base = args.includes('--dir') ? path.resolve(args[args.indexOf('--dir') + 1]) : process.cwd();
const GROUPS = new Map();
if (args.includes('--groups')) {
  for (const g of args[args.indexOf('--groups') + 1].split(';')) GROUPS.set(g.split('=')[0], g.split('=')[1].split(','));
} else {
  const per = args.includes('--per-group') ? int(args[args.indexOf('--per-group') + 1]) : 6;
  const nums = sorted(globDir(path.join(base, 'reports'), '.json').map((p) => path.basename(p)).filter((n) => /^\p{Nd}{2}/u.test(n)).map((n) => n.slice(0, -5)));
  for (let i = 0; i < nums.length; i += per) GROUPS.set(`G${Math.floor(i / per) + 1}`, nums.slice(i, i + per));
}
fs.mkdirSync(path.join(base, 'views'), { recursive: true });

// Python iterates a string's characters where a list was expected.
const seq = (v) => (typeof v === 'string' ? Array.from(v) : v || []);

function li(items, key = null) {
  return seq(items).map((it) => `  - ${key === null ? str(it) : str(get(it, key, ''))}`).join('\n');
}

function renderReport(r) {
  const L = [`\n\n# REPORT ${str(r.chunk)}  (file reports/${r.chunk.replaceAll('.md', '.json')})\n`];
  L.push('## Sessions');
  for (const s of get(r, 'sessions', [])) {
    L.push(`- **${str(get(s, 'id'))}** — ${str(get(s, 'title', ''))} (${str(get(s, 'date', ''))}) [${seq(get(s, 'task_types', [])).join(', ')}]\n  ${str(get(s, 'summary', ''))}`);
  }
  L.push('\n## Workflows');
  for (const w of get(r, 'workflows', [])) {
    L.push(`\n### ${str(get(w, 'name'))}  (worth ${str(get(w, 'skill_worthiness'))}; overlap: ${str(get(w, 'existing_skill_overlap', 'none'))})`);
    L.push(`- goal: ${str(get(w, 'goal'))}`);
    L.push(`- why: ${str(get(w, 'worthiness_reason', ''))}`);
    if (truthy(get(w, 'trigger_examples'))) L.push('- triggers: ' + seq(w.trigger_examples).slice(0, 4).map((t) => `“${str(t)}”`).join(' | '));
    L.push('- steps:\n' + li(get(w, 'steps')));
    if (truthy(get(w, 'tools'))) L.push('- tools: ' + seq(w.tools).join(', '));
    if (truthy(get(w, 'domain_facts_needed'))) L.push('- domain facts needed:\n' + li(w.domain_facts_needed));
    if (truthy(get(w, 'gotchas'))) L.push('- gotchas:\n' + li(w.gotchas));
    const occ = get(w, 'occurrences', []);
    L.push('- occurrences: ' + occ.map((o) => strip(`${str(get(o, 'session'))}@${str(get(o, 'time', ''))} ${truthy(get(o, 'note')) ? '— ' + get(o, 'note', '') : ''}`)).join('; '));
  }
  L.push('\n## User corrections');
  for (const c of get(r, 'user_corrections', [])) {
    L.push(`- [${str(get(c, 'session'))}@${str(get(c, 'time', ''))}] “${str(get(c, 'quote'))}” — context: ${str(get(c, 'context', ''))} → RULE: ${str(get(c, 'rule'))}`);
  }
  if (truthy(get(r, 'automation_wishes'))) {
    L.push('\n## Automation wishes');
    for (const a of r.automation_wishes) L.push(`- [${str(get(a, 'session'))}@${str(get(a, 'time', ''))}] “${str(get(a, 'quote'))}”`);
  }
  L.push('\n## Domain knowledge');
  for (const d of get(r, 'domain_knowledge', [])) {
    L.push(`- **${str(get(d, 'topic'))}**: ${str(get(d, 'fact'))} (where: ${str(get(d, 'where', '?'))}; ${str(get(d, 'session'))})`);
  }
  L.push('\n## Gotchas');
  for (const g of get(r, 'gotchas', [])) {
    L.push(`- ${str(get(g, 'symptom'))} ⇐ ${str(get(g, 'cause'))} ⇒ FIX: ${str(get(g, 'fix'))} (${str(get(g, 'session'))})`);
  }
  if (truthy(get(r, 'existing_skill_feedback'))) {
    L.push('\n## Existing-skill feedback');
    for (const e of r.existing_skill_feedback) L.push(`- ${str(get(e, 'skill'))}: ${str(get(e, 'observation'))} (${str(get(e, 'session'))})`);
  }
  if (truthy(get(r, 'tools_used'))) {
    L.push('\n## Tools used');
    L.push(r.tools_used.map((t) => `${str(get(t, 'tool'))} (${str(get(t, 'purpose', ''))}, ~${str(get(t, 'count_estimate', '?'))})`).join(', '));
  }
  return L.join('\n');
}

let total = 0;
for (const [g, nums] of GROUPS) {
  const parts = [];
  for (const n of nums) {
    const p = join(base, 'reports', `${n}.json`);
    if (!fs.existsSync(p)) {
      console.log('MISSING', p);
      continue;
    }
    parts.push(renderReport(JSON.parse(readText(p))));
  }
  const out = join(base, 'views', `${g}.md`);
  const txt = `# Group ${g}: reports ${nums.join(', ')}\n` + parts.join('');
  fs.writeFileSync(out, txt);
  total += bytes(txt);
  console.log(`${g}: ${Math.floor(bytes(txt) / 1024)}KB  reports ${repr(nums)}`);
}
console.log('total', Math.floor(total / 1024), 'KB');
