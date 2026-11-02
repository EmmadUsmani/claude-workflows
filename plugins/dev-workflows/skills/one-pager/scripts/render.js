#!/usr/bin/env node
'use strict';

// Renders a one-pager sheet to PNG with headless Chrome, after running the sheet's own
// self-check (the ?lint script in assets/template.html).
//
// Usage:
//   node render.js path/to/sheet.html                 # lint + PNG beside the HTML (2x)
//   node render.js path/to/sheet.html --out x.png     # choose the PNG path
//   node render.js path/to/sheet.html --scale 1       # 1x instead of 2x
//   node render.js path/to/sheet.html --lint-only     # report issues, no PNG
//
// Exit status: 0 = clean, 1 = lint issues found (the PNG is still written, so you can look),
// 2 = could not render. Set CHROME_BIN to override the browser.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseOptions } = require('./options');

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const expandPath = (file) => path.resolve(file.replace(/^~(?=$|\/)/, os.homedir()));
const present = (value) => value !== null && value !== undefined && value !== false;
const toS = (value) => (value === null || value === undefined ? '' : String(value));

const { options, args } = parseOptions([{ name: 'out', arg: 'PATH' }, { name: 'scale', arg: 'N', float: true }, { name: 'lint-only' }]);
let sheet = args[0] ?? abort('usage: node render.js path/to/sheet.html [--out x.png] [--scale 2] [--lint-only]');
sheet = expandPath(sheet);
if (!fs.existsSync(sheet)) abort(`no such file: ${sheet}`);
// The scale as Chrome's flag gets it: the default 2, or the --scale value as a decimal ("1.0").
const scale = options.scale === undefined ? '2' : (Number.isInteger(options.scale) ? `${options.scale}.0` : String(options.scale));

const executable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
const listDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

function chromeBinary() {
  // Playwright's Chrome for Testing builds, newest first.
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const playwright = listDir(cache).filter((name) => name.startsWith('chromium-')).flatMap((build) =>
    listDir(path.join(cache, build)).filter((name) => name.startsWith('chrome-mac')).map((platform) =>
      path.join(cache, build, platform, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
    .filter((file) => fs.existsSync(file)).sort().reverse();
  const onPath = ['google-chrome', 'chromium', 'chromium-browser'].map((name) =>
    (process.env.PATH || '').split(':').filter(Boolean).map((dir) => path.join(dir, name)).find(executable));
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...playwright,
    ...onPath
  ];
  return candidates.filter(Boolean).find(executable) ?? abort('no Chrome found; set CHROME_BIN');
}

const html = fs.readFileSync(sheet, 'utf8');
const strip = (line) => line.replace(/^[\0\t\n\v\f\r ]+|[\0\t\n\v\f\r ]+$/g, '');
const nonAscii = (html.match(/[^\n]*\n|[^\n]+$/g) || []).flatMap((line, index) =>
  /[^\x00-\x7F]/.test(line) ? [`line ${index + 1}: ${[...strip(line)].slice(0, 70).join('')}`] : []);
const nonAsciiIssue = nonAscii.length > 0 &&
  { kind: 'non-ascii', detail: `${nonAscii.length} line(s); build_artifact.js will refuse them; use HTML entities. First: ${nonAscii[0]}` };
const [width, height] = (html.match(/<meta name="one-pager:size" content="(\d+x\d+)"/)?.[1] ?? '1680x1050').split('x').map(Number);
const chrome = chromeBinary();
const url = `file://${sheet}`;

// Chrome leaves crashpad/updater helpers running that inherit its stdout; reading a pipe would then
// never see EOF and the render hangs. So: output to a file, its own process group, a timeout, and
// the whole group killed afterwards. Resolves [output, {code, signal} or null on timeout].
async function runChrome(command, timeout = 90) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-pager-chrome-out'));
  const logPath = path.join(logDir, 'log');
  const log = fs.openSync(logPath, 'w');
  try {
    const child = spawn(command[0], command.slice(1), { stdio: ['ignore', log, log], detached: true });
    const exited = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
      child.on('error', () => resolve({ code: null, signal: null }));
    });
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout * 1000); });
    const status = await Promise.race([exited, timedOut]);
    clearTimeout(timer);
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // the group is already gone
    }
    if (!status) await exited;
    return [fs.readFileSync(logPath, 'utf8'), status];
  } finally {
    fs.closeSync(log);
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

const lintDom = (base) => runChrome([chrome, ...base, '--dump-dom', `${url}?lint`]);

function parseLint([dom, status]) {
  const json = dom.match(/<pre id="one-pager-lint">(.*?)<\/pre>/s)?.[1];
  if (json !== undefined) {
    return JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')).issues;
  }
  const chromeState = status ? `exit ${toS(status.code)}` : 'timed out';
  return [{ kind: 'lint-missing', detail: `no #one-pager-lint output (did the sheet keep the template's self-check script?) chrome ${chromeState}` }];
}

function formatIssue(issue) {
  const where = [present(issue.panel) && `panel ${toS(issue.panel)}`, present(issue.svg) && `svg ${toS(issue.svg)}`].filter(Boolean);
  return `  - ${toS(issue.kind)}${where.length ? ` [${where.join(', ')}]` : ''}: ${toS(issue.detail)}`;
}

async function main() {
  // A throwaway profile keeps this off the user's Chrome profile and its caches.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'one-pager-chrome'));
  try {
    const base = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`, '--virtual-time-budget=10000'];

    let issues = parseLint(await lintDom(base));
    // A cold first run can lint before Google Fonts arrive; a real fallback fails twice.
    if (issues.some((issue) => issue.kind === 'font-fallback')) issues = parseLint(await lintDom(base));
    if (nonAsciiIssue) issues.push(nonAsciiIssue);

    const advice = issues.filter((issue) => present(issue.advisory));
    issues = issues.filter((issue) => !present(issue.advisory));
    if (issues.length === 0) {
      console.log(`lint: clean (${width}x${height})`);
    } else {
      console.log(`lint: ${issues.length} issue(s)`);
      for (const issue of issues) console.log(formatIssue(issue));
    }
    if (advice.length) {
      console.log(`advice: ${advice.length} (does not fail the render)`);
      for (const issue of advice) console.log(formatIssue(issue));
    }

    if (!options['lint-only']) {
      const out = expandPath(options.out ?? sheet.replace(/\.html$/, '.png'));
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const [, shotStatus] = await runChrome([chrome, ...base, `--force-device-scale-factor=${scale}`, `--screenshot=${out}`, url]);
      if (!(shotStatus && shotStatus.code === 0 && fs.existsSync(out))) return 2;
      // PNG IHDR: width and height are big-endian uint32s at bytes 16..23 (no macOS-only sips).
      const header = Buffer.alloc(24);
      const fd = fs.openSync(out, 'r');
      const read = fs.readSync(fd, header, 0, 24, 0);
      fs.closeSync(fd);
      const isPng = read === 24 && header.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const dimensions = isPng ? `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}` : '';
      console.log(`png: ${out}${dimensions ? ` (${dimensions})` : ''}`);
    }
    return issues.length === 0 ? 0 : 1;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().then((code) => { process.exitCode = code; });
