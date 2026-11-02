#!/usr/bin/env node
'use strict';

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log("usage: node excerpt.js <repo> <base> <head> excerpts.json [--into data.json]");
  process.exit(0);
}

// Cuts verbatim, diff-marked code excerpts for the data file's `code` block, so no excerpt is
// ever hand-copied. Ranges are new-file line numbers; removed lines that sit inside a range are
// kept in place (marked `-`). A file the PR didn't touch comes out as plain context; a file the PR
// deleted takes old-file numbers (`"old": true`).
//
// Spec (JSON): { "c-formPairs": [ { "path": "lib/rack/request.rb", "from": 597, "to": 606, "label": "request.rb" } ] }
// (`[path, from, to]` arrays work too; `label` defaults to the path.)
//
// Usage:
//   node excerpt.js <repo dir> <base sha> <head sha> excerpts.json                      # prints {key: [lines]}
//   node excerpt.js <repo dir> <base sha> <head sha> excerpts.json --into graph.data.json  # merges into `code`
const fs = require('fs');
const { spawnSync } = require('child_process');
const { parse, prettyGenerate, toS } = require('./json_compat');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const argv = process.argv.slice(2);
const [repo, base, head, specPath] = argv;
if (!repo || !base || !head || !specPath) abort('usage: node excerpt.js <repo> <base> <head> excerpts.json [--into data.json]');
const intoIndex = argv.indexOf('--into');
const spec = parse(fs.readFileSync(specPath, 'utf8'));

function git(...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 1 << 30 });
  if (result.error || result.status !== 0) abort(`git ${args.join(' ')} failed`);
  return result.stdout;
}

// Lines with their newline kept; the last one may have none.
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const chomp = (line) => line.replace(/(\r\n|\n|\r)$/, '');

// Every line of the file as [marker, text, new_number, old_number], in diff order.
function annotated(path) {
  const diff = git('diff', '-U99999', `${base}...${head}`, '--', path);
  if (diff === '') {
    return linesOf(git('show', `${head}:${path}`)).map((line, index) => [' ', chomp(line), index + 1, index + 1]);
  }
  let newNumber = 0;
  let oldNumber = 0;
  const rows = [];
  const lines = linesOf(diff);
  const start = lines.findIndex((line) => line.startsWith('@@'));
  for (const line of start === -1 ? [] : lines.slice(start)) {
    const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (match) {
      oldNumber = Number(match[1]) - 1;
      newNumber = Number(match[2]) - 1;
    } else if (line.startsWith('+')) {
      rows.push(['+', chomp(line.slice(1)), ++newNumber, null]);
    } else if (line.startsWith('-')) {
      rows.push(['-', chomp(line.slice(1)), null, ++oldNumber]);
    } else if (line.startsWith(' ')) {
      rows.push([' ', chomp(line.slice(1)), ++newNumber, ++oldNumber]);
    }
  }
  return rows;
}

const cache = new Map();
const code = {};
for (const [key, ranges] of Object.entries(spec)) {
  const lines = ranges.flatMap((range) => {
    if (Array.isArray(range)) range = { path: range[0], from: range[1], to: range[2] };
    if (!cache.has(range.path)) cache.set(range.path, annotated(range.path));
    const rows = cache.get(range.path);
    const column = range.old != null && range.old !== false ? 3 : 2;
    const first = rows.findIndex((row) => row[column] != null && row[column] >= range.from);
    const last = rows.findLastIndex((row) => row[column] != null && row[column] <= range.to);
    if (first === -1 || last === -1 || first > last) abort(`${key}: ${toS(range.path)} has no lines ${toS(range.from)}-${toS(range.to)}`);
    return [`@ ${toS(range.label ?? range.path)}:${toS(range.from)}`, ...rows.slice(first, last + 1).map(([marker, text]) => `${marker}${text}`)];
  });
  if (lines.length > 60) console.error(`${key}: ${lines.length} lines (keep excerpts under ~60)`);
  code[key] = lines;
}

if (intoIndex !== -1) {
  const dataPath = argv[intoIndex + 1];
  const data = parse(fs.readFileSync(dataPath, 'utf8'));
  data.code = Object.assign({}, data.code ?? {}, code);
  fs.writeFileSync(dataPath, prettyGenerate(data) + '\n');
  console.log(`merged ${Object.keys(code).length} excerpt(s) into ${dataPath}`);
} else {
  console.log(prettyGenerate(code));
}
