#!/usr/bin/env node
'use strict';

// Structural lint for every skill in the repo.
//
//   node scripts/lint_skills.js                      # structure + cross-references
//   node scripts/lint_skills.js --denylist FILE      # also scan for private terms
//   node scripts/lint_skills.js --json               # machine-readable report
//
// The denylist is a private file kept OUTSIDE this repo: one case-insensitive regex per line,
// `#` comments allowed. A line may be scoped with `path-glob :: regex`.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugins', 'dev-workflows', 'skills');

const args = process.argv.slice(2);
const json = args.includes('--json');
const di = args.indexOf('--denylist');
const denylistPath = di >= 0 ? args[di + 1] : null;

const skills = fs.readdirSync(SKILLS_DIR)
  .filter((d) => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory())
  .sort();
const issues = {};
const add = (key, msg) => (issues[key] ||= []).push(msg);

// Walk a directory; `dotfiles` mirrors Ruby's Dir.glob with/without FNM_DOTMATCH.
function walk(dir, { dotfiles = false, skip = () => false } = {}) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!dotfiles && name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (skip(full)) continue;
    const st = fs.lstatSync(full);
    if (st.isDirectory()) out.push(...walk(full, { dotfiles, skip }));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const looseUtf8 = new TextDecoder('utf-8');
function readUtf8(file, { strict }) {
  const buf = fs.readFileSync(file);
  if (!strict) return looseUtf8.decode(buf);
  try { return strictUtf8.decode(buf); } catch { return null; }
}

// Minimal YAML front-matter reader: top-level `key: value` pairs with plain, quoted or block
// (| >) scalars; indented nested blocks are skipped. Raises like a YAML parser on the mistakes
// that matter here (a plain scalar containing ": ").
function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const body = text.split(/^---\s*$/m)[1] ?? '';
  const lines = body.split('\n');
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#') || /^\s/.test(line)) continue;
    const m = line.match(/^([^:\s][^:]*):(?:\s+(.*))?$/);
    if (!m) return { __error: `could not find expected ':' while scanning a simple key at line ${i + 1}` };
    const key = m[1].trim();
    let raw = (m[2] ?? '').trim();
    if (raw === '' ) { data[key] = null; continue; }
    if (/^[|>][+-]?$/.test(raw)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      data[key] = raw.startsWith('|') ? block.join('\n') : block.join(' ').trim();
      continue;
    }
    if (raw.startsWith('"')) {
      try { data[key] = JSON.parse(raw); } catch { return { __error: `invalid double-quoted scalar at line ${i + 1}` }; }
      continue;
    }
    if (raw.startsWith("'")) {
      if (!raw.endsWith("'") || raw.length < 2) return { __error: `unterminated single-quoted scalar at line ${i + 1}` };
      data[key] = raw.slice(1, -1).replace(/''/g, "'");
      continue;
    }
    const hash = raw.search(/\s#/);
    if (hash >= 0) raw = raw.slice(0, hash).trimEnd();
    if (/:\s/.test(raw)) {
      const col = line.indexOf(': ', line.indexOf(':') + 1) + 1;
      return { __error: `mapping values are not allowed in this context at line ${i + 1} column ${col}` };
    }
    data[key] = raw;
  }
  return data;
}

const KNOWN_EXTERNAL = new Set(['code-review', 'simplify', 'security-review', 'artifact-design', 'artifact-capabilities',
  'artifact-diagramming', 'dataviz', 'skill-creator', 'loop', 'schedule', 'run', 'init']);
const SKILLISH = /^(?:[a-z]+-){1,3}(?:review|triage|surgery|stack|create|server|doctor|app|script|intake|debug|probe|doc|explainer|tool|style|sessions|loop|runtime|work|summary|update|message|data|pager|graph|video|bot|team|pr)$/;

for (const name of skills) {
  const dir = path.join(SKILLS_DIR, name);
  const skillMd = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) { add(name, 'missing SKILL.md'); continue; }

  const src = fs.readFileSync(skillMd, 'utf8');
  const fm = frontmatter(src);
  if (fm === null) add(name, 'SKILL.md has no frontmatter');
  else if (fm.__error) add(name, `frontmatter YAML error: ${fm.__error}`);
  else {
    if (fm.name !== name) add(name, `frontmatter name '${fm.name ?? ''}' != directory '${name}'`);
    const desc = String(fm.description ?? '');
    if (!desc) add(name, 'description missing');
    if ([...desc].length > 1024) add(name, `description is ${[...desc].length} chars (> 1024 — may be truncated in listings)`);
    const raw = (src.match(/^description:(.*)$/m)?.[1] ?? '').trim();
    if (!/^['"|>]/.test(raw) && raw.includes(' #')) {
      add(name, "unquoted description contains ' #' — YAML silently truncates it at the comment marker");
    }
  }

  for (const file of walk(dir)) {
    const rel = path.relative(ROOT, file);
    const text = readUtf8(file, { strict: true });
    if (text === null) continue;

    // `plugin:skill` references must point at this plugin.
    for (const [, plugin, skill] of text.matchAll(/\b([a-z][a-z0-9-]*):([a-z][a-z0-9-]+)\b/g)) {
      if (!['-tools', '-eng', '-workflows'].some((s) => plugin.endsWith(s))) continue;
      if (plugin === 'dev-workflows' && skills.includes(skill)) continue;
      add(name, `${rel}: cross-plugin reference ${plugin}:${skill}`);
    }
    // Backticked/bold names that look like skills of ours but don't exist.
    const refs = [...new Set([...text.matchAll(/(?:`|\*\*)([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:`|\*\*)/g)].map((m) => m[1]))];
    for (const ref of refs) {
      if (skills.includes(ref) || KNOWN_EXTERNAL.has(ref) || !SKILLISH.test(ref)) continue;
      add(name, `${rel}: references unknown skill \`${ref}\``);
    }
  }
}

// fnmatch(pattern, path) with FNM_PATHNAME semantics plus `**/` recursion.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

if (denylistPath) {
  const rules = fs.readFileSync(denylistPath, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [glob, re] = l.includes(' :: ') ? [l.slice(0, l.indexOf(' :: ')), l.slice(l.indexOf(' :: ') + 4)] : ['**/*', l];
      return { glob, globRe: globToRegExp(glob), re: new RegExp(re, 'i') };
    });
  const files = walk(ROOT, { dotfiles: true, skip: (f) => path.basename(f) === '.git' });
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = readUtf8(file, { strict: false }).split(/(?<=\n)/);
    lines.forEach((line, idx) => {
      for (const { glob, globRe, re } of rules) {
        if (!(glob === '**/*' || globRe.test(rel))) continue;
        const m = line.match(re);
        if (!m) continue;
        const key = rel.startsWith('plugins/dev-workflows/skills/') ? rel.split('/')[3] : '(repo)';
        add(key, `LEAK ${rel}:${idx + 1}: /${re.source}/ matched ${JSON.stringify(m[0])}`);
      }
    });
  }

  // Commit messages are published with the repo too.
  let log = '';
  try { log = execFileSync('git', ['-C', ROOT, 'log', '--format=%h%x09%B'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* not a repo yet */ }
  for (const line of log.split(/(?<=\n)/)) {
    for (const { re } of rules) {
      const m = line.match(re);
      if (!m) continue;
      add('(git log)', `LEAK commit message: /${re.source}/ matched ${JSON.stringify(m[0])} in ${JSON.stringify(line.trim().slice(0, 80))}`);
    }
  }
}

for (const k of Object.keys(issues)) issues[k] = [...new Set(issues[k])];
const total = Object.values(issues).reduce((n, l) => n + l.length, 0);

if (json) {
  console.log(JSON.stringify({ skills, issues }, null, 2));
} else {
  console.log(`${skills.length} skills`);
  for (const [k, list] of Object.entries(issues)) {
    console.log(`\n${k} (${list.length})`);
    for (const i of list.slice(0, 40)) console.log(`  - ${i}`);
    if (list.length > 40) console.log(`  … ${list.length - 40} more`);
  }
  console.log(total === 0 ? '\nclean' : `\n${total} issue(s)`);
}
process.exit(total === 0 ? 0 : 1);
