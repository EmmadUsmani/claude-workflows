'use strict';

// A small long-option parser for new_sheet.js and render.js. Options may sit anywhere among the
// positional arguments (`--` ends them), take `--name value` or `--name=value`, and may be
// abbreviated to any unique prefix (`--lint` for `--lint-only`, `-m` for `--mode`); a value from a
// fixed list may be abbreviated too. `-h`/`--help` prints the option summary and exits.
//
// specs: [{ name: 'mode', arg: 'MODE', values: ['new', 'revision'] }, { name: 'scale', arg: 'N', float: true },
//         { name: 'lint-only' }]  ->  { options: { mode: 'new', ... }, args: [...] }
const path = require('path');

function parseOptions(specs, argv = process.argv.slice(2)) {
  const program = path.basename(process.argv[1], '.js');
  const fail = (message) => {
    process.stderr.write(`${program}: ${message}\n`);
    process.exit(1);
  };
  const builtins = [{ name: 'help' }, { name: 'version' }];
  const all = [...specs, ...builtins];
  const options = {};
  const args = [];
  const queue = [...argv];
  while (queue.length) {
    const word = queue.shift();
    if (word === '--') { args.push(...queue); break; }
    const long = word.match(/^--([^=]+)(=([\s\S]*))?$/);
    const short = !long && word.match(/^-([^-])([\s\S]*)$/);
    if (!long && !short) { args.push(word); continue; }
    const typed = long ? long[1] : short[1];
    const exact = all.find((spec) => spec.name === typed);
    const matches = exact ? [exact] : all.filter((spec) => spec.name.startsWith(typed));
    if (matches.length > 1) fail(`ambiguous option: ${word}`);
    const spec = matches[0] || fail(`invalid option: ${word}`);
    let value = long ? long[3] : (short[2] === '' ? undefined : short[2]);
    if (spec.name === 'help') {
      const lines = specs.map((each) => `        --${each.name}${each.arg ? ` ${each.arg}` : ''}`);
      process.stdout.write(`Usage: ${program} [options]\n${lines.join('\n')}\n`);
      process.exit(0);
    }
    if (spec.name === 'version') fail('version unknown');
    if (!spec.arg) {
      if (value !== undefined) fail(`needless argument: ${word}`);
      options[spec.name] = true;
      continue;
    }
    let quoted = word; // how an error quotes the option: as typed, plus a separate value
    if (value === undefined) {
      if (!queue.length) fail(`missing argument: ${word}`);
      value = queue.shift();
      quoted = `${word} ${value}`;
    }
    if (spec.values) {
      const chosen = spec.values.includes(value) ? [value] : spec.values.filter((each) => each.startsWith(value));
      if (chosen.length > 1) fail(`ambiguous argument: ${quoted}`);
      if (!chosen.length) fail(`invalid argument: ${quoted}`);
      value = chosen[0];
    }
    if (spec.float) {
      if (!/^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(value)) fail(`invalid argument: ${quoted}`);
      value = Number(value);
    }
    options[spec.name] = value;
  }
  return { options, args };
}

module.exports = { parseOptions };
