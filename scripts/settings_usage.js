#!/usr/bin/env node
'use strict';

// Checks that SETTINGS.md's "Used by" column matches which skills reference each `<key>`.
//   node scripts/settings_usage.js          # print the computed mapping
//   node scripts/settings_usage.js --check  # exit 1 when SETTINGS.md is out of date
//   node scripts/settings_usage.js --write  # rewrite the column

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'plugins', 'dev-workflows');
const settingsPath = path.join(ROOT, 'SETTINGS.md');
const settings = fs.readFileSync(settingsPath, 'utf8');
const skillsDir = path.join(ROOT, 'skills');
const skills = fs.readdirSync(skillsDir)
  .filter((d) => fs.statSync(path.join(skillsDir, d)).isDirectory())
  .sort();

function walk(dir) {
  return fs.readdirSync(dir).sort().flatMap((name) => {
    if (name.startsWith('.')) return [];
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const files = Object.fromEntries(skills.map((s) => [s, walk(path.join(skillsDir, s)).map((f) => fs.readFileSync(f, 'latin1')).join('')]));
const usedBy = (key) => {
  const used = skills.filter((s) => files[s].includes(`<${key}>`));
  return used.length ? used.join(', ') : '—';
};

const ROW = /^(\| `([a-z_]+)` \| .*? \| .*? \| )(.*?)( \|)$/gm;
const rows = [...settings.matchAll(ROW)].map((m) => ({ key: m[2], listed: m[3] }));
const args = process.argv.slice(2);

if (args.includes('--write')) {
  fs.writeFileSync(settingsPath, settings.replace(ROW, (_, head, key, _listed, tail) => `${head}${usedBy(key)}${tail}`));
  console.log(`SETTINGS.md Used by rewritten (${rows.length} keys)`);
} else if (args.includes('--check')) {
  const stale = rows.filter(({ key, listed }) => usedBy(key) !== listed.trim()).map((r) => r.key);
  if (stale.length) {
    console.error(`SETTINGS.md Used by is stale for: ${stale.join(', ')}`);
    process.exit(1);
  }
  console.log(`SETTINGS.md Used by is current (${rows.length} keys)`);
} else {
  for (const { key } of rows) console.log(`${key.padEnd(20)} ${usedBy(key)}`);
}
