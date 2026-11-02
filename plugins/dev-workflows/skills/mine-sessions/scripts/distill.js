#!/usr/bin/env node
'use strict';

// Distill a Claude Code session JSONL (main thread only) into a compact markdown digest.
//
// Keeps: session metadata, every real user prompt, assistant text, one-line tool calls,
// tool errors, slash commands / skills / agent spawns. Drops: thinking, tool results
// (except errors), hook noise, file snapshots, queue ops, system-reminders.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { strip, rstrip, splitWs, len, slice, bytes, cmp, fixed, str, dumps, truthy, get, Counter, expanduser, globDir, isDir } = require('./lib');

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS']);
const MAX_USER = 3000;
const MAX_ASSIST = 1100;
const MAX_CMD = 180;

function trunc(s, n, tail = 0) {
  s = strip(s);
  const l = len(s);
  if (l <= n) return s;
  if (tail) return slice(s, 0, n - tail) + `\n…[${l - n} chars elided]…\n` + slice(s, -tail);
  return slice(s, 0, n) + `…[+${l - n} chars]`;
}

function stripNoise(text) {
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  text = text.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '[task-notification]');
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '');
  return strip(text);
}

// Return [kind, text]. kind in {'prompt','command','skip'}
function userText(content) {
  let parts;
  if (typeof content === 'string') {
    parts = [content];
  } else {
    parts = [];
    for (const b of content) {
      const t = get(b, 'type');
      if (t === 'text') parts.push(get(b, 'text', ''));
      else if (t === 'image') parts.push('[image attached]');
      else if (t === 'tool_result') return ['skip', ''];
    }
  }
  const text = stripNoise(parts.join('\n'));
  if (!text) return ['skip', ''];
  let m = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (m) {
    const name = strip(m[1]);
    const a = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const args = a ? strip(a[1]) : '';
    const o = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    const out = o ? ' → ' + trunc(o[1], 160) : '';
    return ['command', strip(`${name} ${args}`) + out];
  }
  if (text.startsWith('[Request interrupted')) return ['command', '[user interrupted]'];
  m = text.match(/^<local-command-stdout>([\s\S]*?)<\/local-command-stdout>$/);
  if (m) return ['command', '(cmd output) ' + trunc(m[1], 120)];
  return ['prompt', text];
}

function toolLine(b) {
  const name = get(b, 'name', '?');
  const inp = truthy(get(b, 'input')) ? b.input : {};
  const g = (k, d = null) => get(inp, k, d);
  if (name === 'Bash') {
    const d = g('description');
    const cmd = trunc((truthy(g('command')) ? g('command') : '').replaceAll('\n', ' ⏎ '), MAX_CMD);
    return `Bash: ${cmd}` + (truthy(d) ? `  # ${str(d)}` : '');
  }
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    return `${name}: ${str(truthy(g('file_path')) ? g('file_path') : g('notebook_path'))}`;
  }
  if (name === 'Grep' || name === 'Glob') {
    return `${name}: ${str(g('pattern'))} in ${str(truthy(g('path')) ? g('path') : '.')}`;
  }
  if (name === 'Agent') {
    return `Agent[${str(g('subagent_type', ''))}](${str(g('description', ''))}): ${trunc(g('prompt', ''), 400)}`;
  }
  if (name === 'Skill') {
    return rstrip(`Skill: /${str(g('skill'))} ${str(truthy(g('args', '')) ? g('args', '') : '')}`);
  }
  if (name === 'Workflow') {
    return `Workflow: ${str(truthy(g('name')) ? g('name') : trunc(g('script', ''), 200))}`;
  }
  if (name === 'AskUserQuestion') {
    const qs = truthy(g('questions')) ? g('questions') : [];
    return 'AskUserQuestion: ' + qs.map((q) => trunc(get(q, 'question', ''), 140)).join(' | ');
  }
  if (name === 'SendMessage') {
    return `SendMessage→${str(g('to'))}: ${trunc(str(g('message', '')), 200)}`;
  }
  if (name === 'TodoWrite') {
    const todos = truthy(g('todos')) ? g('todos') : [];
    return 'TodoWrite: ' + todos.slice(0, 8).map((t) => trunc(get(t, 'content', ''), 80)).join('; ');
  }
  if (name === 'WebFetch') return `WebFetch: ${str(g('url'))}`;
  if (name === 'WebSearch') return `WebSearch: ${str(g('query'))}`;
  if (name === 'Artifact') {
    const target = truthy(g('file_path')) ? g('file_path') : truthy(g('url')) ? g('url') : '';
    return `Artifact[${str(g('action', 'publish'))}]: ${str(target)}`;
  }
  // MCP + everything else: name + compact json
  return `${str(name)}: ${trunc(dumps(inp, { ensureAscii: false }), 220)}`;
}

// One JSON record per line; lines that are not valid UTF-8 JSON objects are skipped.
function* records(file) {
  const buf = fs.readFileSync(file);
  const dec = new TextDecoder('utf-8', { fatal: true });
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    const line = buf.subarray(start, end);
    start = end + 1;
    let o;
    try {
      o = JSON.parse(dec.decode(line));
    } catch {
      continue;
    }
    if (o !== null && typeof o === 'object' && !Array.isArray(o)) yield o;
  }
}

function distill(file) {
  const sid = path.basename(file).replaceAll('.jsonl', '');
  const titles = [];
  let custom = null;
  const cwds = new Counter();
  const branches = new Set();
  let firstTs = null;
  let lastTs = null;
  const events = []; // [ts, kind, payload]
  const toolNames = new Counter();
  const skills = new Counter();
  const commands = new Counter();
  let agents = 0;
  let nUser = 0;
  let nAssist = 0;
  const pendingTools = new Map(); // tool_use_id -> name
  let errors = 0;
  const models = new Counter();

  for (const o of records(file)) {
    const t = get(o, 'type');
    if (t === 'ai-title') {
      if (truthy(get(o, 'aiTitle')) && !titles.includes(o.aiTitle)) titles.push(o.aiTitle);
      continue;
    }
    if (t === 'custom-title') {
      custom = get(o, 'customTitle');
      continue;
    }
    if (t === 'summary') {
      events.push([get(o, 'timestamp'), 'summary', get(o, 'summary', '')]);
      continue;
    }
    if (t !== 'user' && t !== 'assistant') continue;
    if (truthy(get(o, 'isSidechain'))) continue;
    const ts = get(o, 'timestamp');
    if (truthy(ts)) {
      firstTs = truthy(firstTs) ? firstTs : ts;
      lastTs = ts;
    }
    if (truthy(get(o, 'cwd'))) cwds.add(o.cwd);
    if (truthy(get(o, 'gitBranch'))) branches.add(o.gitBranch);
    const msg = truthy(get(o, 'message')) ? o.message : {};
    const content = get(msg, 'content');
    if (t === 'user') {
      if (truthy(get(o, 'isMeta'))) continue;
      // tool errors
      if (Array.isArray(content)) {
        for (const b of content) {
          if (get(b, 'type') === 'tool_result' && truthy(get(b, 'is_error'))) {
            const c = get(b, 'content');
            const s = typeof c === 'string' ? c
              : (c || []).filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x)).map((x) => get(x, 'text', '')).join(' ');
            const tname = pendingTools.has(get(b, 'tool_use_id')) ? pendingTools.get(get(b, 'tool_use_id')) : 'tool';
            events.push([ts, 'error', `${str(tname)}: ${trunc(stripNoise(s), 260)}`]);
            errors += 1;
          }
        }
      }
      const [kind, text] = userText(content);
      if (kind === 'prompt') {
        nUser += 1;
        events.push([ts, 'user', trunc(text, MAX_USER, 400)]);
      } else if (kind === 'command') {
        const cmd = text ? splitWs(text)[0] : '';
        commands.add(cmd);
        events.push([ts, 'command', trunc(text, 300)]);
      }
    } else { // assistant
      if (truthy(get(msg, 'model'))) models.add(msg.model);
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        const bt = get(b, 'type');
        if (bt === 'text') {
          const txt = strip(get(b, 'text', ''));
          if (txt) {
            nAssist += 1;
            events.push([ts, 'assistant', trunc(txt, MAX_ASSIST, 300)]);
          }
        } else if (bt === 'tool_use') {
          const name = get(b, 'name', '?');
          toolNames.add(name);
          pendingTools.set(get(b, 'id'), name);
          if (name === 'Skill') skills.add(get(truthy(get(b, 'input')) ? b.input : {}, 'skill', '?'));
          if (name === 'Agent') agents += 1;
          events.push([ts, 'tool', [name, toolLine(b)]]);
        }
      }
    }
  }

  // collapse consecutive read-only tool calls
  const out = [];
  const isRO = (e) => e[1] === 'tool' && READ_ONLY.has(e[2][0]);
  let i = 0;
  while (i < events.length) {
    let [ts, kind, payload] = events[i];
    if (isRO(events[i])) {
      let j = i;
      const paths = [];
      while (j < events.length && isRO(events[j])) {
        paths.push(events[j][2][1]);
        j += 1;
      }
      if (paths.length >= 4) {
        const shown = paths.slice(0, 6).map((p) => (p.includes(': ') ? p.slice(p.indexOf(': ') + 2) : p)).join('; ');
        out.push([ts, 'tool', `${paths.length}× read-only lookups (${shown}${paths.length > 6 ? '; …' : ''})`]);
      } else {
        for (let k = i; k < j; k++) out.push([events[k][0], 'tool', events[k][2][1]]);
      }
      i = j;
    } else {
      if (kind === 'tool') payload = payload[1];
      out.push([ts, kind, payload]);
      i += 1;
    }
  }

  const proj = cwds.size ? cwds.mostCommon(1)[0][0] : '?';
  const hm = (ts) => slice(truthy(ts) ? ts : '', 11, 16);
  const toolTotal = toolNames.total();
  const lines = [];
  lines.push(`# Session ${sid}`);
  lines.push(`- project cwd: ${str(proj)}`);
  if (truthy(custom)) lines.push(`- custom title: ${str(custom)}`);
  if (titles.length) lines.push(`- ai titles: ${titles.slice(0, 6).join(' | ')}`);
  lines.push(`- span: ${slice(truthy(firstTs) ? firstTs : '', 0, 16)} → ${slice(truthy(lastTs) ? lastTs : '', 0, 16)}`);
  if (branches.size) lines.push(`- git branches: ${[...branches].slice(0, 8).join(', ')}`);
  lines.push(`- counts: ${nUser} user prompts, ${nAssist} assistant texts, ${toolTotal} tool calls, ${agents} subagents, ${errors} tool errors`);
  if (models.size) lines.push(`- models: ${models.mostCommon(3).map(([m, c]) => `${str(m)}×${c}`).join(', ')}`);
  if (toolNames.size) lines.push('- tools: ' + toolNames.mostCommon(14).map(([k, v]) => `${str(k)}×${v}`).join(', '));
  if (commands.size) lines.push('- slash commands: ' + commands.mostCommon().map(([k, v]) => `${str(k)}×${v}`).join(', '));
  if (skills.size) lines.push('- skills invoked: ' + skills.mostCommon().map(([k, v]) => `${str(k)}×${v}`).join(', '));
  lines.push('');
  lines.push('## Transcript (distilled)');
  for (const [ts, kind, payload] of out) {
    if (kind === 'user') lines.push(`\n### [${hm(ts)}] USER\n${payload}`);
    else if (kind === 'command') lines.push(`\n### [${hm(ts)}] USER /${payload.replace(/^\/+/, '')}`);
    else if (kind === 'assistant') lines.push(`\n**ASSISTANT:** ${payload}`);
    else if (kind === 'tool') lines.push(`  → ${payload}`);
    else if (kind === 'error') lines.push(`  ✗ ${payload}`);
    else if (kind === 'summary') lines.push(`\n> (compaction summary) ${trunc(payload, 800)}`);
  }
  const meta = {
    session: sid, project: proj, custom_title: custom, titles: titles.slice(0, 6),
    first: firstTs, last: lastTs, user_prompts: nUser, tool_calls: toolTotal,
    subagents: agents, errors, commands: commands.m, skills: skills.m,
    branches: [...branches].slice(0, 8),
  };
  return [lines.join('\n') + '\n', meta];
}

const USAGE = `usage: distill.js <outdir> [--since YYYY-MM-DD] [--project <substring>] [--projects-dir <path>]

    --since   keep only sessions with activity on/after the date (compares the session's LAST
              timestamp, so a session that started earlier but continued past the date is kept).
              Pass the date of your previous sweep to mine only what is new.
    --project keep only sessions whose ~/.claude/projects/<dir> name contains the substring.
    --projects-dir  transcript root (default ~/.claude/projects; override for a test fixture
              or a copied archive).
    `;

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }
  if (!args.length || args[0].startsWith('--')) {
    process.stderr.write(USAGE + '\n');
    process.exit(1);
  }
  const outdir = args[0];
  const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const since = opt('--since');
  const project = opt('--project');
  const root = opt('--projects-dir') ?? '~/.claude/projects';
  fs.mkdirSync(outdir, { recursive: true });
  const index = [];
  let skipped = 0;
  const files = globDir(expanduser(root)).filter(isDir).flatMap((d) => globDir(d, '.jsonl')).sort(cmp);
  for (const file of files) {
    const projDir = path.basename(path.dirname(file));
    if (project && !projDir.includes(project)) continue;
    // project dirs are the cwd with "/" -> "-"; drop the home prefix to get a short label
    const home = os.homedir().replaceAll('/', '-');
    let short = projDir.startsWith(home + '-') ? slice(projDir, len(home) + 1) : projDir.replace(/^-+/, '');
    short = slice(short, 0, 40); // keep digest file names short (cwds outside $HOME keep their full dashed path otherwise)
    short = short.replace('projects-', '');
    const [md, meta] = distill(file);
    if (since && (!truthy(meta.last) || slice(meta.last, 0, 10) < since)) {
      skipped += 1;
      continue;
    }
    meta.project_dir = projDir;
    meta.raw_bytes = fs.statSync(file).size;
    const name = `${short}__${slice(meta.session, 0, 8)}.md`;
    fs.writeFileSync(path.join(outdir, name), md);
    meta.digest = name;
    meta.digest_bytes = bytes(md);
    index.push(meta);
  }
  fs.writeFileSync(path.join(outdir, 'index.json'), dumps(index, { indent: 1 }));
  const totRaw = index.reduce((a, m) => a + m.raw_bytes, 0);
  const totDig = index.reduce((a, m) => a + m.digest_bytes, 0);
  console.log(`${index.length} sessions; raw ${fixed(totRaw / 1e6, 1)}MB → digests ${fixed(totDig / 1e6, 2)}MB (${fixed(totRaw / Math.max(totDig, 1), 0)}× smaller)`
    + (since ? `; skipped ${skipped} sessions with no activity since ${since}` : ''));
  for (const m of [...index].sort((a, b) => b.digest_bytes - a.digest_bytes)) {
    const title = truthy(m.custom_title) ? m.custom_title : m.titles.length ? m.titles[0] : '';
    console.log(`${fixed(m.digest_bytes / 1024, 0).padStart(7)}KB  ${String(m.user_prompts).padStart(4)}p ${String(m.tool_calls).padStart(5)}t  ${m.digest}  ${slice(str(title), 0, 60)}`);
  }
}

main();
