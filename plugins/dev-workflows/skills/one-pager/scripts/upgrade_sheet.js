#!/usr/bin/env node
'use strict';

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log("usage: node upgrade_sheet.js path/to/sheet.html [more sheets...]");
  process.exit(0);
}

// Brings an existing sheet up to the current template without touching its content: replaces its
// ?lint self-check script with the template's, and adds any component CSS block it lacks (why
// notes, data table, stack strip, wireframe callouts).
//
// Usage: node upgrade_sheet.js path/to/sheet.html [more sheets...]
const fs = require('fs');
const path = require('path');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'template.html'), 'utf8');
// Sheets made before the Node port name scripts/render.rb in the self-check's comment.
const lintPattern = /<script>\s*\/\/ Self-check, read by scripts\/render\.(?:rb|js).*?<\/script>/s;
const lint = template.match(lintPattern)?.[0] ?? abort('template self-check script not found');

// Each component block starts with its comment and runs to the next blank line.
const components = new Map(Object.entries({
  '.why {': '/\\* why notes:.*?\\n\\n',
  'table.t {': '/\\* data table.*?\\n\\n',
  '.stack {': '/\\* stack / rollout strip.*?\\n\\n',
  'ol.co {': '/\\* wireframe callouts.*?\\n(?=\\n|</style>)'
}).map(([selector, source]) =>
  [selector, template.match(new RegExp(source, 's'))?.[0] ?? abort(`template block not found: ${source.slice(0, 30)}`)]));

const sheets = process.argv.slice(2);
if (sheets.length === 0) abort('usage: node upgrade_sheet.js path/to/sheet.html [...]');
for (const file of sheets) {
  let sheet = fs.readFileSync(file, 'utf8');
  if (!lintPattern.test(sheet)) abort(`${file}: no self-check script to replace (not built from the template?)`);
  sheet = sheet.replace(lintPattern, () => lint);
  const added = [...components].filter(([selector]) => !sheet.includes(selector));
  if (added.length) sheet = sheet.replace('</style>', () => '\n' + added.map(([, block]) => block).join('\n') + '</style>');
  fs.writeFileSync(file, sheet);
  console.log(`${file}: lint script synced${added.length ? `; added ${added.map(([selector]) => selector).join(', ')}` : ''}`);
}
