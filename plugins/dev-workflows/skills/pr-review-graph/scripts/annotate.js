#!/usr/bin/env node
'use strict';

// Draws a red highlight box around each node's element on its screenshots, and dims
// the rest of the frame a little so the box reads at thumbnail size. One output per
// (node, screenshot) pair, because two nodes sharing a screenshot point at different
// parts of it. Needs ImageMagick 7 (`magick`).
//
// Spec (JSON):
//   { "source_dir": "~/…/screenshots", "output_dir": "img/a", "max_width": 1280,
//     "shots": [ { "node": "sharedLists", "src": "after/02-shared-lists.png", "boxes": [[x, y, w, h], …] } ] }
// Boxes are in the source PNG's pixels. output_dir is relative to the spec file.
//
// Usage: node annotate.js path/to/annotate.json
//   prints each output path, relative to the spec's directory, for the node's `images[].src`
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse, inspect, toS } = require('./json_compat');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function fetch(object, key, ...fallback) {
  if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  if (fallback.length) return fallback[0];
  return abort(`key not found: ${inspect(key)}`);
}

const expandPath = (file, base) => path.resolve(base, file.replace(/^~(?=$|\/)/, os.homedir()));

const PAD = 4;
const specPath = process.argv[2] ?? abort('usage: node annotate.js annotate.json');
const spec = parse(fs.readFileSync(specPath, 'utf8'));
const specDir = path.dirname(path.resolve(specPath));
const sourceDir = expandPath(fetch(spec, 'source_dir'), specDir);
const outputDir = expandPath(fetch(spec, 'output_dir', 'img/a'), specDir);
const maxWidth = fetch(spec, 'max_width', 1280);
const version = spawnSync('magick', ['-version'], { stdio: ['inherit', 'ignore', 'inherit'] });
if (version.error || version.status !== 0) abort('ImageMagick 7 (`magick`) is required');
fs.mkdirSync(outputDir, { recursive: true });

function dimensions(file) {
  const result = spawnSync('magick', ['identify', '-format', '%w %h', file], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  return (result.stdout || '').split(/\s+/).filter(Boolean).map((value) => parseInt(value, 10) || 0);
}

for (const shot of fetch(spec, 'shots')) {
  const input = `${sourceDir.replace(/\/+$/, '')}/${fetch(shot, 'src').replace(/^\/+/, '')}`;
  let isFile = false;
  try { isFile = fs.statSync(input).isFile(); } catch { isFile = false; }
  if (!isFile) abort(`missing screenshot ${input}`);
  const parts = shot.src.replace(/\.[a-z]+$/i, '').split('/');
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const output = path.join(outputDir, `${toS(fetch(shot, 'node'))}__${parts.join('-')}.webp`);
  const [width, height] = dimensions(input);
  const stroke = width < 600 ? 3 : 4;
  const boxes = fetch(shot, 'boxes').map(([x, y, w, h]) => {
    if (x >= width || y >= height) abort(`box ${inspect([x, y, w, h])} is outside ${toS(shot.src)} (${width}x${height})`);
    return [Math.max(x - PAD, 0), Math.max(y - PAD, 0), Math.min(x + w + PAD, width - 1), Math.min(y + h + PAD, height - 1)];
  });
  // Even-odd fill: the whole frame minus each box, so only the outside is dimmed.
  const holes = boxes.map(([x0, y0, x1, y1]) => `M ${x0},${y0} L ${x0},${y1} L ${x1},${y1} L ${x1},${y0} Z`).join(' ');
  const dim = `fill-rule evenodd path 'M 0,0 L ${width},0 L ${width},${height} L 0,${height} Z ${holes}'`;
  const rings = boxes.map(([x0, y0, x1, y1]) => `roundrectangle ${x0},${y0} ${x1},${y1} 8,8`);
  const command = [input,
    '-fill', 'rgba(15,17,21,0.32)', '-stroke', 'none', '-draw', dim,
    '-fill', 'none', '-stroke', 'rgba(255,59,48,0.35)', '-strokewidth', String(stroke + 6), ...rings.flatMap((ring) => ['-draw', ring]),
    '-stroke', '#FF3B30', '-strokewidth', String(stroke), ...rings.flatMap((ring) => ['-draw', ring])];
  if (width > maxWidth) command.push('-resize', `${toS(maxWidth)}x`);
  command.push('-quality', '82', output);
  const result = spawnSync('magick', command, { stdio: 'inherit' });
  if (result.error || result.status !== 0) abort(`Command failed with exit ${result.status}: magick`);
  console.log(output.startsWith(`${specDir}/`) ? output.slice(specDir.length + 1) : output);
}
