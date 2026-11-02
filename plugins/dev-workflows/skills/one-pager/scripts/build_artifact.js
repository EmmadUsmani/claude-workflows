#!/usr/bin/env node
'use strict';

if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log("usage: node build_artifact.js path/to/sheet.html   (writes path/to/sheet.artifact.html)");
  process.exit(0);
}

// Builds the publishable Claude Artifact page from a one-pager sheet.
//
// The sheet is a full HTML document with a fixed-size .canvas (the PNG source). A published
// Artifact is a fragment (the publisher adds <html>/<head>/<body>) that must fit any viewport
// without horizontal scroll, so this keeps the same sheet and scales the canvas to the width.
//
// Usage: node build_artifact.js path/to/sheet.html   # writes path/to/sheet.artifact.html
const fs = require('fs');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const sheet = process.argv[2] ?? abort('usage: node build_artifact.js path/to/sheet.html');
const source = fs.readFileSync(sheet, 'utf8');

function extract(text, pattern, label) {
  const match = text.match(pattern) ?? abort(`could not find ${label} in the sheet`);
  return match[1];
}

const title = extract(source, /<title>(.*?)<\/title>/s, '<title>');
const head = extract(source, /<head>(.*?)<\/head>/s, '<head>');
const style = extract(source, /<style>(.*?)<\/style>/s, '<style>');
let body = extract(source, /<body>(.*?)<\/body>/s, '<body>');
const [width, height] = (source.match(/<meta name="one-pager:size" content="(\d+x\d+)"/)?.[1] ?? '1680x1050').split('x').map(Number);
if (!body.includes('id="canvas"')) abort('the sheet has no #canvas wrapper; start from assets/template.html');
// The ?lint self-check only serves render.js; viewers never pass ?lint, so drop it.
// (Sheets made before the Node port name scripts/render.rb in its comment.)
body = body.replace(/<script>\s*\/\/ Self-check, read by scripts\/render\.(?:rb|js).*?<\/script>\s*/s, '');
// Trims ASCII whitespace only (String#trim would also eat a leading &nbsp; character).
const strip = (text) => text.replace(/^[\0\t\n\v\f\r ]+|[\0\t\n\v\f\r ]+$/g, '');
const fontLinks = (head.match(/<link [^>]*>/g) ?? []).join('\n');

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fontLinks}
<style>${style}
/* Artifact wrapper: the fixed canvas scaled to the available width, 16px+ side gutter. */
body { margin: 0; padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.fit { position: relative; width: 100%; max-width: ${width}px; margin: 0 auto; aspect-ratio: ${width} / ${height}; overflow: hidden; }
.fit > .canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
</style>
<div class="fit" id="fit">
${strip(body)}
</div>
<script>
(function () {
  var fit = document.getElementById('fit'), canvas = document.getElementById('canvas');
  function scale() { canvas.style.transform = 'scale(' + (fit.clientWidth / ${width}) + ')'; }
  scale();
  if (window.ResizeObserver) new ResizeObserver(scale).observe(fit); else window.addEventListener('resize', scale);
})();
</script>
`;

// The fragment has no <meta charset>, so any non-ASCII character renders as mojibake.
const quote = (char) => `"${/[\p{Cc}\p{Cn}\u2028\u2029]/u.test(char) ? `\\u${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : char}"`;
const nonAscii = [...new Set([...page].filter((char) => char.codePointAt(0) > 127))];
if (nonAscii.length) abort(`non-ASCII characters would garble in the fragment form; use HTML entities: [${nonAscii.map(quote).join(', ')}]`);

const out = sheet.replace(/\.html$/, '.artifact.html');
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${Buffer.byteLength(page)} bytes)`);
