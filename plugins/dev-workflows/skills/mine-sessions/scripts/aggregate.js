#!/usr/bin/env node
'use strict';

// Validate reports/*.json and build a compact cross-chunk aggregate for synthesis.
// usage: aggregate.js [--dir <workdir>] [--expect N] [--names] [--merge]
// <workdir> (default: cwd) is the scratch dir holding reports/*.json; --expect N lists any of
// reports 01..N that are missing.

const fs = require('fs');
const path = require('path');
const { sorted, repr, str, dumps, int, readText, globDir, Counter } = require('./lib');

const args = process.argv.slice(2);
const base = args.includes('--dir') ? path.resolve(args[args.indexOf('--dir') + 1]) : process.cwd();
const isNum = (p) => /^\p{Nd}{2}/u.test(path.basename(p));
const reports = sorted(globDir(path.join(base, 'reports'), '.json').filter(isNum));

// json.load + r["_file"] = …; the message mirrors Python's for a report that isn't an object.
function load(p) {
  const r = JSON.parse(readText(p));
  if (r === null || typeof r !== 'object' || Array.isArray(r)) {
    const type = r === null ? 'NoneType' : Array.isArray(r) ? 'list' : typeof r === 'string' ? 'str' : typeof r === 'boolean' ? 'bool' : Number.isInteger(r) ? 'int' : 'float';
    throw new Error(type === 'list' ? 'list indices must be integers or slices, not str' : `'${type}' object does not support item assignment`);
  }
  r._file = path.basename(p);
  return r;
}

const ok = [];
const bad = [];
for (const p of reports) {
  try {
    ok.push(load(p));
  } catch (e) {
    bad.push([path.basename(p), e.message]);
  }
}
console.log(`${ok.length} valid reports, ${bad.length} invalid: [${bad.map(([f, e]) => `(${repr(f)}, ${repr(e)})`).join(', ')}]`);
const nExpected = args.includes('--expect') ? int(args[args.indexOf('--expect') + 1]) : 0;
const have = new Set(reports.map((p) => path.basename(p)));
const missing = sorted(Array.from({ length: Math.max(nExpected, 0) }, (_, i) => `${String(i + 1).padStart(2, '0')}.json`).filter((n) => !have.has(n)));
if (missing.length) console.log('missing:', missing.join(', '));

const len = (v) => (v === undefined ? 0 : v.length);
let wf = 0;
let corr = 0;
let facts = 0;
let wishes = 0;
let gotchas = 0;
const names = new Counter();
for (const r of ok) {
  wf += len(r.workflows);
  corr += len(r.user_corrections);
  facts += len(r.domain_knowledge);
  wishes += len(r.automation_wishes);
  gotchas += len(r.gotchas);
  for (const w of r.workflows || []) names.add('name' in w ? w.name : '?');
}
console.log(`workflows: ${wf}  corrections: ${corr}  domain facts: ${facts}  wishes: ${wishes}  gotchas: ${gotchas}`);
console.log('total report bytes:', reports.reduce((a, p) => a + fs.statSync(p).size, 0));
if (args.includes('--names')) {
  for (const [n, c] of names.mostCommon()) console.log(`  ${c}× ${str(n)}`);
}
if (args.includes('--merge')) {
  // single merged file for synthesizers
  const out = path.join(base, 'ALL_REPORTS.json');
  fs.writeFileSync(out, dumps({ reports: ok }, { indent: 1 }));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
