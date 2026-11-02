#!/usr/bin/env node
'use strict';

// Group digests into agent-sized work units (~TARGET bytes each).
// Big digests are split at user-turn boundaries; small ones are batched together.
// Writes chunks/<NN>.md plus chunks/plan.json.
//
// usage: chunk.js <digests dir> <out dir> [target bytes, default 230000]

const fs = require('fs');
const path = require('path');
const { slice, bytes, dumps, int, readText } = require('./lib');

const argv = process.argv.slice(1); // argv[0] is this script, like sys.argv
const TARGET = argv.length > 3 ? int(argv[3]) : 230000;
const HARD = Math.trunc(TARGET * 1.15);
const [src, out] = [argv[1], argv[2]];
fs.mkdirSync(out, { recursive: true });
let index = JSON.parse(readText(path.join(src, 'index.json')));
// Keep small sessions (a short session can carry the one correction that matters): they simply
// bin-pack together. Only sessions with no user prompt at all carry nothing to mine; drop and say so.
const prompts = (m) => ('user_prompts' in m ? m.user_prompts : 1);
const dropped = index.filter((m) => prompts(m) === 0).map((m) => m.digest);
index = index.filter((m) => prompts(m) > 0);
if (dropped.length) {
  console.error(`WARNING: dropped ${dropped.length} digest(s) with zero user prompts: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ' …' : ''}`);
}
const tiny = index.filter((m) => m.digest_bytes < 1500).map((m) => m.digest);
if (tiny.length) {
  console.log(`note: ${tiny.length} very small digest(s) kept and merged into shared chunks: ${tiny.slice(0, 8).join(', ')}${tiny.length > 8 ? ' …' : ''}`);
}

const units = []; // list of [label, text]
for (const m of [...index].sort((a, b) => b.digest_bytes - a.digest_bytes)) {
  const text = readText(path.join(src, m.digest));
  const headerEnd = text.indexOf('## Transcript (distilled)');
  const header = text.slice(0, headerEnd);
  const body = text.slice(headerEnd);
  if (bytes(text) <= HARD) {
    units.push([m.digest, text]);
    continue;
  }
  // split body at user-turn boundaries
  const turns = body.split(/(?=\n### \[)/);
  const parts = [];
  let cur = '';
  for (const t of turns) {
    if (bytes(cur + t) > TARGET && cur) {
      parts.push(cur);
      cur = t;
    } else {
      cur += t;
    }
  }
  if (cur) parts.push(cur);
  parts.forEach((p, i) => {
    const note = `\n> NOTE: this is PART ${i + 1} of ${parts.length} of a long session (split at user-turn boundaries; earlier/later parts are read by other agents).\n\n`;
    units.push([`${m.digest} [part ${i + 1}/${parts.length}]`, header + note + p]);
  });
}

// bin-pack: big units alone, small ones grouped (first-fit decreasing)
units.sort((a, b) => bytes(b[1]) - bytes(a[1]));
const bins = [];
for (const [label, text] of units) {
  const size = bytes(text);
  const b = bins.find((x) => x.size + size <= TARGET);
  if (b) {
    b.items.push([label, text]);
    b.size += size;
  } else {
    bins.push({ items: [[label, text]], size });
  }
}

const plan = [];
bins.forEach((b, i) => {
  const name = `${String(i + 1).padStart(2, '0')}.md`;
  fs.writeFileSync(path.join(out, name), b.items.map(([label, text]) => `\n\n<!-- ===== DIGEST: ${label} ===== -->\n\n` + text).join(''));
  plan.push({ chunk: name, bytes: b.size, sessions: b.items.map(([l]) => l) });
});
fs.writeFileSync(path.join(out, 'plan.json'), dumps(plan, { indent: 1 }));
console.log(`${units.length} units → ${bins.length} chunks (target ${Math.floor(TARGET / 1000)}KB)`);
for (const p of plan) {
  console.log(`  ${p.chunk}  ${String(Math.floor(p.bytes / 1024)).padStart(4)}KB  ${p.sessions.length} unit(s): ${p.sessions.slice(0, 4).map((s) => slice(s, 0, 48)).join(', ')}${p.sessions.length > 4 ? ' …' : ''}`);
}
