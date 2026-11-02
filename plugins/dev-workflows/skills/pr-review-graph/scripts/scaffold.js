#!/usr/bin/env node
'use strict';

// Starts a review-graph data file from the PR's real metadata, so the header, links and
// line counts are never hand-typed. Fill in lanes, nodes, edges and code next (SKILL.md Phase 2-4).
//
// Usage: node scaffold.js <owner/repo> <pr-number> <out-dir>
//   writes <out-dir>/pr<number>.data.json and prints the changed files with their +/- counts
const fs = require('fs');
const { spawnSync } = require('child_process');
const { prettyGenerate } = require('./json_compat');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const [repo, number, outDir] = process.argv.slice(2);
if (!repo || !number || !outDir) abort('usage: node scaffold.js <owner/repo> <pr-number> <out-dir>');
const fields = 'number,title,state,author,headRefName,baseRefName,headRefOid,baseRefOid,additions,deletions,changedFiles,commits,files,mergedAt,url';
const gh = spawnSync('gh', ['pr', 'view', number, '--repo', repo, '--json', fields], {
  encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 1 << 30
});
if (gh.error || gh.status !== 0) abort('gh pr view failed');
const pr = JSON.parse(gh.stdout);

const data = {
  pr: {
    repo, number: pr.number, title: pr.title,
    state: pr.mergedAt != null ? 'merged' : pr.state.toLowerCase(),
    author: pr.author?.login ?? null, headRef: pr.headRefName, baseRef: pr.baseRefName,
    headSha: pr.headRefOid, baseSha: pr.baseRefOid,
    additions: pr.additions, deletions: pr.deletions,
    files: pr.changedFiles, commits: pr.commits.length
  },
  summary: '',
  note: `Code read at head ${pr.headRefOid.slice(0, 10)}.`,
  contextLabel: 'Context',
  lanes: [],
  boundaries: [],
  stack: [],
  modeNotes: { before: '', after: '' },
  nodes: [],
  edges: [],
  findings: [],
  order: [],
  code: {}
};
fs.mkdirSync(outDir, { recursive: true });
const file = `${outDir.replace(/\/+$/, '')}/pr${number}.data.json`; // joined as given, not normalized
if (fs.existsSync(file)) abort(`${file} exists; not overwriting`);
fs.writeFileSync(file, prettyGenerate(data) + '\n');
console.log(`wrote ${file}`);
if (pr.baseRefName !== 'main') console.log(`base ${pr.baseRefName} (not main: review against it)`);
// Not nodes (SKILL.md Phase 1): generated output, lockfiles, docs. Listed so the `note` can name them.
// Extend per repo when it has its own generated outputs (a codegen directory, a schema dump).
const SKIP = [
  [/(^|\/)(structure\.sql|schema\.rb|schema\.graphql|.*\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum)$/, 'generated'],
  [/(^|\/)__generated__\/|\.generated\.\w+$|\.pb\.go$|_pb2\.pyi?$/, 'generated'],
  [/__snapshots__\/|\.snap$/, 'generated'],
  [/^(docs?|manual)\/|\.md$|(^|\/)CHANGELOG/i, 'docs']
];
for (const changed of pr.files) {
  const tag = SKIP.find(([pattern]) => pattern.test(changed.path))?.[1];
  const added = `+${changed.additions}`.padStart(6);
  const deleted = `-${changed.deletions}`.padStart(6);
  console.log(`${added} ${deleted}  ${(tag ? `[${tag}]` : '').padEnd(10)} ${changed.path}`);
}
