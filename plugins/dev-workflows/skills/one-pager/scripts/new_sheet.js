#!/usr/bin/env node
'use strict';

// Starts a one-pager sheet from assets/template.html with the header block for the mode.
//
// Usage:
//   node new_sheet.js <sandbox_dir>/tickets/<topic>/one-pager/<slug>-one-pager.html --mode new
//   node new_sheet.js <dest>.html --mode revision
//
// Refuses to overwrite an existing file: iterate on the sheet you already have.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseOptions } = require('./options');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const { options, args } = parseOptions([{ name: 'mode', arg: 'MODE', values: ['new', 'revision'] }]);
const mode = options.mode;
let dest = args[0] ?? abort('usage: node new_sheet.js <dest>.html --mode new|revision');
if (!mode) abort('pass --mode new or --mode revision (say which you inferred, and why)');
dest = path.resolve(dest.replace(/^~(?=$|\/)/, os.homedir()));
if (fs.existsSync(dest)) abort(`${dest} already exists; edit it instead of starting over`);

const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'template.html'), 'utf8');
const revisionBlock = template.match(/      <!-- REVISION MODE:.*?\n      <div class="rev">.*?\n      <\/div>\n/s)?.[0] ?? abort('template revision block not found');
const newBlock = template.match(/      <!-- NEW MODE: use this instead of \.rev\.\n(.*?)      -->\n/s)?.[1] ?? abort('template new-mode block not found');
const statusNote = '      <!-- NEW MODE: .status block. Revision mode would use the .rev table instead (see REFERENCE.md). -->\n';
const newModeComment = /      <!-- NEW MODE: use this instead of \.rev\.\n.*?      -->\n/s;

const sheet = mode === 'new'
  ? template
    .replace(revisionBlock, () => statusNote + newBlock)
    .replace(newModeComment, '')
    .replace('<span class="v sig">B &middot; PROPOSED</span>', () => '<span class="v sig">A &middot; PROPOSED</span>')
  : template.replace(newModeComment, '');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, sheet);
console.log(`wrote ${dest} (${mode} mode). Replace every REPLACE, then: node ${path.join(__dirname, 'render.js')} ${dest}`);
