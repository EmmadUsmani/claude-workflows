#!/usr/bin/env node
'use strict';

// Build a compact "user turns only" view from distilled digests, for targeted mining lenses
// (code-style corrections, communication preferences, …) where the user's own words carry the
// signal and the full tool trace is noise.
//
// For every USER turn keep: the tail of the assistant text that preceded it (what the user is
// reacting to, truncated), then the user's prompt in full (as distilled). Drops tool lines,
// errors, slash commands. Typically ~10× smaller than the digests.
//
// usage: userturns.js <digests dir> <out dir> [--context 500]

const fs = require('fs');
const path = require('path');
const { strip, len, slice, bytes, sorted, fixed, dumps, int, readText, globDir } = require('./lib');

const argv = process.argv.slice(1); // like sys.argv
const [src, out] = [argv[1], argv[2]];
const ctx = argv.includes('--context') ? int(argv[argv.indexOf('--context') + 1]) : 500;
fs.mkdirSync(out, { recursive: true });

// str.splitlines(): every Unicode line boundary, no trailing empty element.
function splitlines(s) {
  const lines = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
// re.findall(r"\*\*ASSISTANT:\*\* (.*)", s) — "." stops only at \n in Python.
const assistantTexts = (s) => [...s.matchAll(/\*\*ASSISTANT:\*\* ([^\n]*)/g)].map((m) => m[1]);
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const TURN = new RegExp(`^### \\[(\\p{Nd}\\p{Nd}:\\p{Nd}\\p{Nd})\\] USER(?: (/[^${WS}][\\s\\S]*))?\\n?([\\s\\S]*)`, 'u');
const FOLLOWING = /\n(?=\*\*ASSISTANT:\*\*| {2}→ | {2}✗ |> \(compaction)/;

let total = 0;
const index = []; // chunk.js-compatible index so the user-turn view can be chunked the same way
for (const file of sorted(globDir(src, '.md'))) {
  const text = readText(file);
  const at = text.indexOf('## Transcript (distilled)');
  const head = at === -1 ? text : text.slice(0, at);
  const body = at === -1 ? '' : text.slice(at + '## Transcript (distilled)'.length);
  const header = splitlines(head).filter((l) => l.startsWith('# ') || l.startsWith('- custom title') || l.startsWith('- ai titles') || l.startsWith('- span') || l.startsWith('- project')).join('\n');
  const blocks = body.split(/\n(?=### \[\p{Nd}\p{Nd}:\p{Nd}\p{Nd}\] USER)/u);
  const turns = [];
  let lastAssistant = '';
  for (const b of blocks) {
    const m = b.match(TURN);
    if (!m) {
      // leading chunk before the first user turn: capture any assistant text
      const a = assistantTexts(b);
      if (a.length) lastAssistant = a[a.length - 1];
      continue;
    }
    const [, hm, cmd, rest] = m;
    // split the user's prompt from the assistant/tool lines that follow it
    const f = FOLLOWING.exec(rest);
    const prompt = strip(f ? rest.slice(0, f.index) : rest);
    const following = f ? rest.slice(f.index + 1) : '';
    if (cmd === undefined && prompt && prompt !== '[task-notification]') {
      let ctxText = strip(lastAssistant);
      if (len(ctxText) > ctx) ctxText = '…' + slice(ctxText, -ctx);
      turns.push(`\n### [${hm}] USER\n` + (ctxText ? `> (Claude had just said) ${ctxText}\n\n` : '') + prompt);
    }
    const a = assistantTexts(following);
    if (a.length) lastAssistant = a[a.length - 1];
  }
  if (!turns.length) continue;
  const name = path.basename(file);
  const result = header + `\n- user turns: ${turns.length}\n` + turns.join('\n') + '\n';
  fs.writeFileSync(path.join(out, name), result);
  total += bytes(result);
  index.push({ digest: name, digest_bytes: bytes(result), user_prompts: turns.length });
  console.log(`${String(Math.floor(bytes(result) / 1024)).padStart(5)}KB ${String(turns.length).padStart(4)} turns  ${name}`);
}
fs.writeFileSync(path.join(out, 'index.json'), dumps(index, { indent: 1 }));
console.log(`total ${fixed(total / 1e6, 2)}MB across ${index.length} sessions with user turns`);
